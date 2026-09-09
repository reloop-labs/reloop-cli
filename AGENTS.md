# Working in reloop-cli

This file is the source of truth for agents working in this repo. `CLAUDE.md` and `GEMINI.md` point here.

## What this repo is

The official CLI for the **Reloop platform** — binary `reloop`, npm package `reloop-cli`. It is an authenticated HTTP client for a Reloop instance: Reloop Cloud by default, or a self-hosted install.

**It is not `reloop-tools`.** That is a separate repo ([reloop-labs/reloop-tool-cli](https://github.com/reloop-labs/reloop-tool-cli)), a keyless client for the public Tools endpoints, binary `reloop-tools`. Never add platform commands there, and never add Tools utilities here.

Shipped today: `auth` (login, logout, status, list, use), `contacts` (list, create, get, update, delete), `commands`. Everything else in the platform — domains, emails, broadcasts, templates, webhooks, logs, api-keys, inbox, workflows — is future work that must follow the patterns below.

## Hard rules

1. **Write zero comments.** No inline comments, no JSDoc, no doc blocks, no section dividers, no TODOs. Names and structure carry the meaning. This is enforced by review, and the existing source has none — keep it that way.
2. **This CLI is an API client.** Never import server code, never touch Postgres, never assume the Reloop monorepo is checked out. A user installs this on a laptop and points it at a URL.
3. **Zero runtime dependencies.** `package.json` has `devDependencies` only. If you think you need a runtime dep, stop and raise it first.
4. **Never prompt when stdin or stdout is not a TTY.** `run.ts` swaps in a prompter that throws, so this is structural — do not work around it.
5. **Never print, log, or store an API key unmasked.** Use `maskApiKey`. `--debug` prints request diagnostics and must never include the key.
6. **stdout carries only the requested data.** Hints, warnings, progress, prompts, and errors go to stderr.
7. **Read the backend before writing a command.** `apps/backend/<service>/src/routes/**` in [reloop-labs/reloop](https://github.com/reloop-labs/reloop) defines the real paths and shapes. Do not infer a contract from the dashboard, from another provider's API, or from memory.
8. **Ship only what was asked.** No speculative endpoints, no unused helpers, no flags "for later". Unused code is deleted in review.

## Commands

```bash
bun install
bun run dev contacts --help
bun run format
bun run lint
bun run typecheck
bun test
bun run build
```

All five checks must pass before a change is done. CI runs the same set.

## How the CLI works

One request flows like this:

```
argv
  -> cli/run.ts          resolve the command, parse flags, build globals + Output
  -> commands/<resource>/<verb>.ts   read intent from flags/args
  -> cli/session.ts      read config, resolve credentials, build the API client
  -> api/<resource>.ts   typed method, one per endpoint
  -> api/client.ts       URL, x-api-key, User-Agent, timeout, JSON, error mapping
  -> output/output.ts    human render or JSON, chosen once
  -> exit code
```

`run(argv, ctx)` returns an exit code and never calls `process.exit`. `CliContext` carries `stdout`, `stderr`, `env`, `fetch`, terminal state, and the prompter, so the whole CLI runs in a test with no process and no network.

Outside `src/index.ts`, nothing reads `process.env` or `process.argv`, and nothing writes to `process.stdout` — that is what makes the CLI testable. Three files legitimately touch `process` for platform facts and real terminal I/O: `config/paths.ts` (`process.platform`), `config/store.ts` (`process.pid`, for the temp file name), and `prompts/node-prompter.ts`, which owns the real stdin/stderr for readline.

A command file reads intent, calls a resource, hands data to `output`. It must not build URLs, read the config file, format JSON, or check TTY-ness itself.

Layout:

```
src/
  index.ts        bin entry, the only place touching process globals
  cli/            context, spec, flags, globals, help, tree, run, session
  commands/       root registry + one file per command
  api/            client, endpoints, types, one file per resource
  auth/           credential + endpoint resolution, masking
  config/         config file location, read, atomic write
  output/         the only writer to stdout/stderr
  errors/         CliError, exit codes, HTTP error mapping
  prompts/        readline prompter, and one that refuses
```

Nothing in `api/`, `config/`, `auth/`, `output/`, or `errors/` may import from `commands/`. Only `cli/run.ts` knows the root registry.

## The Reloop API, as verified against the backend

- Base URL is a bare host. Each service mounts at `/api/<service>`. **Never hardcode `reloop.sh`** outside `DEFAULT_ENDPOINT` in `config/store.ts`.
- Auth is the `x-api-key` header. Organization and team come from the key — there is no tenant to pass.
- **A non-empty `User-Agent` is required** (`requireUserAgentPlugin`). `api/client.ts` sets it; do not bypass the client.
- Errors are `{ message, why, fix, link }` with an HTTP status. `errors/api-error.ts` maps them; a resource can override the code per status.
- Rate limits return `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after`.

Contacts specifics that already shaped this code — do not "fix" them without a backend change:

- Contacts are addressed by **ID only**. `contacts.resolve()` turns an email into an ID via `list?search=` plus an exact client-side match.
- `PATCH` **replaces the whole property set**. That is why `--property`/`--unset-property` read-modify-write and `--properties` is the raw replace, and why they cannot be combined.
- Property keys are `^[a-z0-9_]+$` (`PROPERTY_KEY` in `commands/contacts/shared.ts`). The update endpoint's TypeBox schema advertises `^[a-z_]+$`, but that pattern is **not enforced at runtime** — verified against a live server, `PATCH` accepts `plan_2`. Match the server's real behaviour, not the advertised schema.
- There is **no bulk create route** and **no whoami endpoint**. `auth status` validates by listing API keys and prefix-matching `start`.
- Pagination is offset-based, `limit` capped at 100.

## Output and exit codes

`output.emit({ data, render })` decides once. `data` is the API response, unwrapped — JSON field names must stay identical to the platform so they match the docs and the SDKs. `render` runs only in a terminal. JSON mode is on when `--json`, `--quiet`, or stdout is not a TTY.

Every failure is a `CliError` with a stable `code`, an `exitCode`, and ideally `why`/`fix`. **Never throw a bare `Error` from a command** — it becomes `unexpected_error` with exit 1 and no guidance.

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected, or 5xx |
| 2 | usage: unknown flag, missing argument, conflicting options, confirmation required |
| 3 | auth |
| 4 | not found |
| 5 | conflict |
| 6 | request body rejected |
| 7 | rate limited |
| 8 | network or timeout |
| 130 | cancelled |

Error code strings are part of the public contract: they appear in `--help` and in `reloop commands --json`. Do not rename one without treating it as a breaking change.

## Adding a resource

1. Read `apps/backend/<service>/src/routes/**` in the Reloop monorepo.
2. `api/endpoints.ts` — add the paths.
3. `api/types.ts` — mirror the Elysia models.
4. `api/<resource>.ts` — a class taking `ReloopApiClient`, one method per endpoint, plus any reference resolution.
5. `cli/session.ts` — expose it.
6. `commands/<resource>/<verb>.ts` — one file per command, each with `summary`, `description`, `flags`, `errorCodes`, `examples`. These feed `--help` **and** `reloop commands`, so an agent sees the same contract a human does.
7. `commands/<resource>/index.ts` — the group command.
8. `commands/root.ts` — register it.
9. `test/<resource>.test.ts` — drive it through `run()`.

Conventions to keep:

- destructive commands take `--yes` and refuse to prompt when non-interactive
- list commands take `--limit`, `--page`, and `--all` where the API paginates
- commands accepting a resource take an ID **or** its natural key
- `ls` and `rm` are the only aliases

## Tests

Drive commands through `run(argv, ctx)` with an injected context — see `test/helpers.ts` for the mock `fetch` router, the scripted prompter, and the captured streams. **No test may reach the network or a real Reloop instance.**

A new command covers, at minimum: the request payload it builds, required and conflicting flags, JSON output, human output, non-interactive behaviour, and the exit code for each failure it can produce.

## Commits

- Entirely lowercase except an emphasized identifier, prefixed `feat:` / `fix:` / `chore:` / `docs:` / `refactor:`.
- **Never add `Co-Authored-By`, AI attribution, or any trailer.** Messages read as a human describing what changed.
- Commit only when asked, and only the changes that were asked for.
- Before committing: nothing stray staged, no formatting-only noise, every new file included.

## Traps

- `bun run dev "contacts list"` does not word-split under zsh. Pass separate arguments.
- `process.stdout.columns` can be `0` on a pty; `Output.width` already guards this. Do not read `columns` directly.
- esbuild escapes non-ASCII to `\uXXXX` in the bundle. Unicode in source is fine — verify with `bun run build` if you add more.
- `src/index.ts` sets `process.exitCode` rather than calling `process.exit`, so piped output is not truncated. Keep it that way.
- Editing a file with a script? Assert the pattern matched. A silent no-op replace is the easiest way to think a fix landed when it did not.

## More

- `README.md` — user-facing docs, every flag and scripting examples
- `ARCHITECTURE.md` — layer detail and the reasoning behind the custom transport
- `CONTRIBUTING.md` — contribution workflow
