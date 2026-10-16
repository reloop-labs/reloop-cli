# Architecture

The CLI is a client of Reloop's public HTTP API. It never imports server code, never touches the database, and never assumes the Reloop monorepo is installed. Everything it needs is an endpoint and a credential: an API key, or an OAuth session from `reloop login`.

## Layers

```
src/
  index.ts              bin entry — the only file that touches process/globals
  cli/                  argv -> command -> exit code
    context.ts            CliContext: stdout, stderr, env, fetch, terminal, prompter, browser, loopback, sleep
    spec.ts               Command / FlagSpec / ArgSpec, the declarative command model
    flags.ts              the flag parser and typed accessors
    globals.ts            global flags and their resolution
    parse -> help.ts      help rendered from the same specs
    run.ts                resolve, parse, dispatch, catch, map to an exit code
    session.ts            builds an authenticated API client for a command
    tree.ts               serializes the command tree for `reloop commands`
  commands/             one file per command, grouped by resource
    root.ts               the registry
    auth/ contacts/
  api/                  HTTP transport and typed resources
    client.ts             base URL, auth header, User-Agent, timeout, debug, error mapping
    endpoints.ts          every path in one place
    types.ts              request/response contracts
    contacts.ts           the contacts resource
  auth/                 credential + endpoint resolution, OAuth sign-in and refresh, redaction
  config/               config file location, reading, atomic writing
  output/               the only place that writes to stdout/stderr
  errors/               CliError, exit codes, API error mapping
  prompts/              readline-based prompter, and one that refuses to prompt
  platform/             system browser opener and 127.0.0.1 callback server
```

The rule that keeps this maintainable: **a command file parses intent, calls a resource, and hands data to `output`.** It does not build URLs, read the config file, format JSON, or decide whether the terminal is interactive.

## Dependency direction

```
commands  ->  cli/session  ->  api  ->  errors
    |              |
    +-> output     +-> auth -> config
```

Nothing in `api/`, `config/`, `auth/`, `output/`, or `errors/` imports from `commands/`. `cli/run.ts` is the only module that knows the root registry.

## Everything is injected

`CliContext` carries `stdout`, `stderr`, `env`, `fetch`, terminal state, the prompter, the browser opener, the loopback listener, and `sleep`. `run(argv, ctx)` returns an exit code and never calls `process.exit`. That is what makes the whole CLI testable end to end without spawning a process or touching the network — `test/helpers.ts` builds a context with a captured stdout, a scripted prompter, and a routed mock `fetch`.

Outside `src/index.ts`, nothing reads `process.env` or `process.argv`, and nothing writes to `process.stdout` — that is what makes the CLI testable. A few files legitimately touch `process` for platform facts and real I/O: `config/paths.ts` (`process.platform`), `config/store.ts` (`process.pid`, for the temp file name), `prompts/node-prompter.ts`, which owns the real stdin/stderr for readline, and `platform/browser.ts` (`process.platform`, to pick the opener). `platform/loopback.ts` owns the real `127.0.0.1` callback server for browser sign-in.

## Why the CLI has its own transport

Reloop publishes an official Node SDK, [`reloop-email`](https://github.com/reloop-labs/reloop-node), and it was the first thing evaluated for this layer. Its `ReloopClient` exposes no timeout or `AbortSignal`, no way to set a `User-Agent` through the service methods, and no request hook — and the Reloop API *requires* a non-empty `User-Agent`, so a CLI built on it would identify itself as `node` and would hang forever against an unreachable self-hosted host. Reloop CLIs also ship with zero runtime dependencies.

So `src/api/` is the CLI's own transport. Its paths, payloads, and response types mirror the SDK exactly, and both were checked against the `apps/backend/contacts` Elysia models in the Reloop monorepo, which is the source of truth.

## Errors

Every failure is a `CliError` with a stable `code`, an `exitCode`, and optional `why`/`fix`. `api/client.ts` converts HTTP failures into one via `errors/api-error.ts`, which maps status codes onto the exit-code taxonomy and lets a resource override the code per status (`404 -> contact_not_found`). Commands throw; `run.ts` catches once and renders through `output.fail`.

Never throw a bare `Error` from a command — it becomes `unexpected_error` with exit `1` and no guidance.

## Output

`output/output.ts` decides human vs. JSON once, from `--json`, `--quiet`, and whether stdout is a TTY. Commands call `output.emit({ data, render })` and let it pick. `data` is the API response, so JSON field names track the platform. `render` only runs in a terminal.

`note`, `warn`, and `success` write to stderr so stdout stays parseable.

## Adding a resource

Say you are adding domains.

1. **Read the backend first.** `apps/backend/domain/src/routes/**` in the Reloop monorepo defines the real paths, request bodies, and response shapes. Do not infer them from the dashboard or from another provider's API.
2. **`src/api/endpoints.ts`** — add the paths.
3. **`src/api/types.ts`** — add the request and response types, mirroring the Elysia models.
4. **`src/api/domains.ts`** — add a resource class taking a `ReloopApiClient`, one method per endpoint, plus any reference resolution (`resolve()` on contacts turns an email into an ID).
5. **`src/cli/session.ts`** — expose it on `Session`.
6. **`src/commands/domains/*.ts`** — one file per command. Give each a `summary`, a `description`, `flags`, `errorCodes`, and `examples`: they feed `--help` *and* `reloop commands`, so an agent sees the same contract a human does.
7. **`src/commands/domains/index.ts`** — the group command.
8. **`src/commands/root.ts`** — register it.
9. **`test/domains.test.ts`** — drive it through `run()` with a mock API. Assert on the request payload, both output modes, and the failure exit codes.

Conventions worth keeping:

- destructive commands take `--yes` and refuse to prompt when non-interactive
- list commands take `--limit`, `--page`, and `--all` where the API paginates
- commands that accept a resource take an ID *or* the resource's natural key
- `ls` and `rm` are the only aliases; canonical names stay obvious

## Packaging

`tsup` bundles `src/index.ts` into a single ESM file with a shebang, targeting Node 20. Zero runtime dependencies means `npm install -g reloop-cli` pulls one file, and it keeps standalone binaries open: because nothing in `src/` depends on a native module or a bundler-hostile pattern, `bun build --compile` can produce per-platform binaries when release infrastructure is added.

`src/index.ts` sets `process.exitCode` instead of calling `process.exit`, so piped output is never truncated.
