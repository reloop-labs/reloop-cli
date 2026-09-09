# Working in reloop-cli

**[AGENTS.md](./AGENTS.md) is the source of truth for this repo. Read it before making any change.**

It covers the architecture, the verified Reloop API contract, the exit-code taxonomy, how to add a resource, testing rules, and the traps.

The non-negotiables, repeated here so they are never missed:

1. Write **zero comments** — no inline comments, no JSDoc, no dividers, no TODOs.
2. This CLI is an **HTTP API client**. No server imports, no database, no monorepo assumptions.
3. **Zero runtime dependencies.**
4. **Never prompt** when stdin or stdout is not a TTY.
5. **Never print, log, or store an API key unmasked.**
6. **stdout carries only the requested data**; everything else goes to stderr.
7. **Read `apps/backend/<service>/src/routes/**` in [reloop-labs/reloop](https://github.com/reloop-labs/reloop) before writing a command.** Never guess an API contract.
8. Commit messages are lowercase with a `feat:`/`fix:`/`chore:`/`docs:` prefix, and **never carry co-author lines or AI attribution**.

Before calling anything done:

```bash
bun run format && bun run lint && bun run typecheck && bun test && bun run build
```
