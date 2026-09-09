import type { Command } from "@/cli/spec";
import { authCommand } from "@/commands/auth/index";
import { loginCommand } from "@/commands/auth/login";
import { logoutCommand } from "@/commands/auth/logout";
import { commandsCommand } from "@/commands/commands";
import { contactsCommand } from "@/commands/contacts/index";
import { BIN_NAME } from "@/version";

export const rootCommand: Command = {
	name: BIN_NAME,
	summary: "The command line interface for Reloop",
	description:
		"Reloop CLI talks to the Reloop platform API — Reloop Cloud by default, or your own self-hosted install via --endpoint or a profile.\n\nOutput is a human table in a terminal and JSON everywhere else, so commands compose with jq and run unchanged in CI.",
	flags: [
		{
			name: "version",
			short: "v",
			kind: "boolean",
			summary: "Print the CLI version",
		},
	],
	commands: [
		authCommand,
		loginCommand,
		logoutCommand,
		contactsCommand,
		commandsCommand,
	],
	examples: [
		"reloop login",
		"reloop contacts list",
		"reloop contacts create --email luna@example.com --first-name Luna",
		"reloop contacts list --json | jq -r '.contacts[].email'",
	],
};
