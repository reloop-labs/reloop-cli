# Contributing

Thanks for helping build the Reloop CLI.

## Setup

Requires [Bun](https://bun.sh) and Node.js 20+.

```bash
bun install
bun run dev --help
```

## Before you open a pull request

```bash
bun run format
bun run lint
bun run typecheck
bun test
bun run build
```

CI runs the same five, and all five must pass.

## Ground rules

- **The Reloop source is the source of truth.** Before adding a command, read the matching service under `apps/backend/*/src/routes/**` in [`reloop-labs/reloop`](https://github.com/reloop-labs/reloop). Do not guess a request body or a response shape.
- **The CLI is an API client.** No database access, no server-only imports, no monorepo assumptions.
- **Zero runtime dependencies.** If you think you need one, open an issue first.
- **Never prompt in a non-interactive environment**, and never write anything but the requested data to stdout.
- **Never log, print, or store an API key unmasked.**
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) before adding a resource — it has a step-by-step checklist.

## Tests

Tests run through `run(argv, ctx)` with an injected context: captured output streams, a scripted prompter, and a mock `fetch`. See `test/helpers.ts`. No test may reach the network or depend on a real Reloop instance.

A new command should cover, at minimum:

- the request payload it builds
- required and conflicting flags
- JSON output and human output
- non-interactive behaviour
- the exit code for each failure it can produce

## Commits

Prefix with `feat:`, `fix:`, `chore:`, or `docs:` and describe what changed.
