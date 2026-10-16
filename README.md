# Reloop CLI

The official command line interface for [Reloop](https://github.com/reloop-labs/reloop) — open-source email infrastructure you can self-host or use as a hosted service.

Official npm package: **`reloop-cli`**. Binary: **`reloop`**.

```bash
reloop login
reloop contacts create --email luna@example.com --first-name Luna --last-name Gurnee
reloop contacts list --json | jq -r '.contacts[].email'
```

---

## Reloop CLI vs. Reloop Tools CLI

These are two different products and they do not overlap.

| | `reloop-cli` (this repo) | [`reloop-tools`](https://github.com/reloop-labs/reloop-tool-cli) |
|---|---|---|
| Binary | `reloop` | `reloop-tools` |
| Talks to | Your Reloop account — Cloud or self-hosted | Public Reloop Tools endpoints |
| Needs to sign in | Yes — browser sign-in or an API key | No |
| Purpose | Operate the platform: contacts, and in time every resource the dashboard exposes | Standalone developer utilities, e.g. disposable-address checks |
| Example | `reloop contacts list` | `reloop-tools check user@example.com` |

Install both if you want both. They never conflict — different package names, different binaries, different jobs.

---

## Install

```bash
npm install -g reloop-cli
reloop --help
```

Or run it without installing:

```bash
npx reloop-cli contacts list
```

Requires Node.js 20 or newer.

---

## Authentication

```bash
reloop login
```

Your browser opens on Reloop, you pick an organization and approve the CLI, and you're done. You don't create or copy an API key. This is the same OAuth flow MCP clients use: PKCE plus a one-time redirect to `127.0.0.1`. The CLI stores a short-lived access token and a refresh token, refreshes it on its own, and `reloop logout` revokes it. You can review or revoke the CLI any time under **Settings → Connected Apps**.

On a remote machine, or anywhere the browser can't reach this one, sign in with a code instead:

```bash
reloop login --device
```

It prints a link and a one-time code to confirm from any browser. Over SSH this happens automatically.

API keys still work everywhere:

```bash
reloop login --with-api-key
reloop login --api-key rl_prod_...
RELOOP_API_KEY=rl_prod_... reloop login
```

A key is verified against the endpoint before anything is written to disk. Credentials are stored with `0600` permissions, and nothing ever prints them back to you; keys are masked to a short prefix.

### Credential precedence

Every command resolves its credential in this order, and stops at the first hit:

1. `--api-key <key>`
2. `RELOOP_API_KEY`
3. the selected profile in the config file: its API key, or its browser sign-in

The endpoint is resolved the same way:

1. `--endpoint <url>`
2. `RELOOP_ENDPOINT`
3. the selected profile's endpoint
4. `https://reloop.sh`

`reloop auth status` shows exactly what a command would use, and where each value came from:

```bash
$ reloop auth status
Profile        production
Endpoint       https://mail.example.com (profile)
API key        rl_prod_abcd… (profile)
Key name       deploy-bot
Created by     luna@example.com
```

---

## Self-hosted Reloop

Self-hosting is first class. Nothing in the CLI is hardwired to `reloop.sh` — the hosted URL is only the default when no profile or flag says otherwise.

Point a profile at your own install once:

```bash
reloop login --profile production --endpoint https://mail.example.com
reloop login --profile local      --endpoint https://local.reloop.sh
```

Then pick a target per command, or set a default:

```bash
reloop contacts list --profile local
reloop auth use production
reloop auth list
```

A profile holds a name, an endpoint, and a credential. The organization comes from the API key, or from the organization you approved at sign-in, so there is nothing else to configure.

For a one-off call against a host you do not want to store:

```bash
RELOOP_ENDPOINT=https://mail.example.com RELOOP_API_KEY=rl_prod_... reloop contacts list
```

---

## Output model

**In a terminal**, commands print a readable table or detail view on stdout, with progress and hints on stderr.

```bash
$ reloop contacts list
EMAIL             NAME          STATUS      CREATED
luna@example.com  Luna Gurnee   subscribed  Sep 9, 2026
alex@example.com  Alex Example  subscribed  Sep 8, 2026
```

**Everywhere else** — piped, redirected, in CI — commands emit JSON automatically. You do not need `--json` for scripts to work, though passing it is always safe.

```bash
$ reloop contacts list --limit 1 --json
{
  "object": "contact",
  "contacts": [ { "object": "contact", "id": "con_...", "email": "luna@example.com", ... } ],
  "total": 2,
  "page": 1,
  "limit": 1,
  "totalContacts": 2,
  "subscribedContacts": 2,
  "unsubscribedContacts": 0,
  "event": "contact.list"
}
```

The JSON is the Reloop API response, unwrapped and undecorated, so field names stay stable and match the platform docs and SDKs.

Rules the CLI holds to:

- stdout carries **only** the requested data
- diagnostics, hints, spinners, and prompts go to stderr
- prompts never appear when stdin or stdout is not a terminal
- `--quiet` implies `--json` and silences stderr hints
- `NO_COLOR` and `TERM=dumb` disable colour

---

## Errors and exit codes

Failures print a machine-readable envelope on stderr:

```bash
$ reloop contacts get nobody@example.com --json
{
  "error": {
    "code": "contact_not_found",
    "message": "No contact exists with email nobody@example.com.",
    "exitCode": 4,
    "fix": "Run `reloop contacts list --search <term>` to find the contact."
  }
}
```

In a terminal the same failure reads:

```
Error: No contact exists with email nobody@example.com.
  Run `reloop contacts list --search <term>` to find the contact.
```

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Unexpected failure, or a `5xx` from the API |
| `2` | Usage error — unknown flag, missing argument, conflicting options, confirmation required |
| `3` | Authentication — no credential, or the API rejected it |
| `4` | Not found |
| `5` | Conflict, e.g. the contact already exists |
| `6` | The API rejected the request body |
| `7` | Rate limited (`retry-after` is surfaced in `error.details`) |
| `8` | Network failure or timeout |
| `130` | Cancelled |

Every command documents the error codes it can produce under `Error codes` in its `--help`.

`--debug` prints one line per request to stderr — method, URL, status, duration, and rate-limit headers. It never prints your API key.

---

## Contacts

A contact can be addressed by its ID **or** by its email address. Anything containing `@` is treated as an email and resolved with an exact, case-insensitive match; anything else is used as an ID directly.

### List

```bash
reloop contacts list
reloop contacts list --limit 50 --status subscribed
reloop contacts list --search luna --json
reloop contacts list --channel chn_123
reloop contacts list --all --json > contacts.json
```

`--all` walks every page and is the supported way to export. Without it, the CLI fetches one page — it never downloads the whole database to render ten rows. `--all` cannot be combined with `--page` or `--limit`.

### Create

```bash
reloop contacts create --email luna@example.com --first-name Luna --last-name Gurnee

reloop contacts create \
  --email luna@example.com \
  --property company=LunarLabs \
  --property role=developer

reloop contacts create --email luna@example.com --properties '{"seats":5}' --group-id grp_123
```

Run `reloop contacts create` with no `--email` in a terminal and it walks you through the fields:

```
Create contact
? Email: luna@example.com
? First name (optional): Luna
? Last name (optional): Gurnee
? Add properties? (y/N): y
? Property: company
? Value: LunarLabs
? Add another property? (y/N): n
✓ Contact created: luna@example.com
```

Pass `--email` and the command runs exactly what you asked for with no prompts, so a terminal and a CI job behave identically.

`--property key=value` always sends a string. Use `--properties` with a JSON object when a property must be a number.

### Get

```bash
reloop contacts get luna@example.com
reloop contacts get con_123456789 --json
```

### Update

```bash
reloop contacts update luna@example.com --status unsubscribed
reloop contacts update luna@example.com --property plan=pro
reloop contacts update luna@example.com --unset-property plan
reloop contacts update con_123 --properties '{"plan":"pro"}'
```

Only the fields you pass are changed.

Property semantics matter here, because the Reloop API replaces the whole property set on every update:

- `--property` and `--unset-property` **merge** — the CLI reads the contact's current properties, applies your change, and sends the full set back. Everything you did not mention survives.
- `--properties` **replaces** — this is the raw API behaviour. Any property missing from the JSON object is removed.

The two forms cannot be combined.

Property names must be lowercase letters, numbers, and underscores — the same rule the Reloop server enforces when it stores them.

### Delete

```bash
reloop contacts delete luna@example.com
reloop contacts delete con_123456789 --yes --json
```

In a terminal you get a confirmation prompt. In a script `--yes` is required — without it the command exits `2` with `confirmation_required` rather than hanging or deleting silently. Declining the prompt exits `130` and sends no request.

---

## For AI agents and automation

- `reloop commands` prints the entire command tree as JSON — every subcommand, alias, argument, flag, default, and error code. It always emits JSON, in a terminal or not.
- Argument parsing is deterministic: unknown flags fail with exit `2` and a suggestion rather than being ignored.
- No command ever prompts when stdin or stdout is not a terminal.
- Field names in JSON output come straight from the Reloop API, so they match the platform docs and the official SDKs.

```bash
reloop commands | jq -r '.commands[] | .path'
reloop commands | jq '.commands[] | select(.path=="reloop contacts") | .commands[].flags'
```

---

## Environment variables

| Variable | Effect |
|---|---|
| `RELOOP_API_KEY` | API key, used when `--api-key` is absent |
| `RELOOP_ENDPOINT` | Base URL, used when `--endpoint` is absent |
| `RELOOP_PROFILE` | Profile to use when `--profile` is absent |
| `RELOOP_CONFIG_DIR` | Override the config directory (useful in CI and tests) |
| `RELOOP_NO_PROMPT` | Never prompt, even on a terminal |
| `NO_COLOR` | Disable colour |
| `CI`, `GITHUB_ACTIONS`, `TERM=dumb` | Treated as non-interactive |

## Configuration file

| Platform | Path |
|---|---|
| macOS / Linux | `$XDG_CONFIG_HOME/reloop/config.json`, else `~/.config/reloop/config.json` |
| Windows | `%APPDATA%\reloop\config.json` |

Written atomically with `0600` permissions inside a `0700` directory.

```json
{
  "version": 1,
  "activeProfile": "production",
  "profiles": {
    "production": { "endpoint": "https://mail.example.com", "apiKey": "rl_prod_..." },
    "local": { "endpoint": "https://local.reloop.sh", "apiKey": "rl_prod_..." }
  }
}
```

`reloop logout` removes the stored credential and keeps the endpoint, so the target stays configured.

---

## Scripting examples

```bash
# every subscribed address, one per line
reloop contacts list --all --status subscribed --json | jq -r '.contacts[].email'

# create a contact and capture its ID
id=$(reloop contacts create --email luna@example.com --json | jq -r '.id')

# unsubscribe everyone in a CSV of addresses
while read -r email; do
  reloop contacts update "$email" --status unsubscribed --json > /dev/null
done < emails.txt

# branch on the exit code
if reloop contacts get luna@example.com --json > /dev/null 2>&1; then
  echo "exists"
else
  case $? in
    4) echo "not found" ;;
    3) echo "check your credentials" ;;
    *) echo "something else went wrong" ;;
  esac
fi
```

In CI, set `RELOOP_API_KEY` (and `RELOOP_ENDPOINT` if you self-host) as secrets and skip `reloop login` entirely. When `CI` is set, `reloop login` never opens a browser.

---

## Development

Requires [Bun](https://bun.sh) and Node.js 20+.

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run build
bun run dev contacts --help
```

`bun run format` applies Biome's fixes. The project has **zero runtime dependencies** — everything the CLI needs at runtime is in `src/`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the module layout and how to add a new resource, and [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.

---

## Links

- [Reloop](https://github.com/reloop-labs/reloop) — the platform
- [Documentation](https://reloop.sh/docs)
- [Reloop Tools CLI](https://github.com/reloop-labs/reloop-tool-cli)
- [Discord](https://discord.gg/bHnkBcp7xR)

## License

Apache-2.0
