import type { Command } from "@/cli/spec";
import { loginCommand } from "@/commands/auth/login";
import { logoutCommand } from "@/commands/auth/logout";
import {
	listProfilesCommand,
	useProfileCommand,
} from "@/commands/auth/profiles";
import { statusCommand } from "@/commands/auth/status";

export const authCommand: Command = {
	name: "auth",
	summary: "Manage credentials and profiles",
	description:
		"Credentials are resolved in this order: --api-key, then RELOOP_API_KEY, then the selected profile. Each profile stores its own endpoint, so Reloop Cloud and self-hosted installs can live side by side.",
	commands: [
		loginCommand,
		logoutCommand,
		statusCommand,
		listProfilesCommand,
		useProfileCommand,
	],
	examples: [
		"reloop auth status",
		"reloop auth login --profile staging --endpoint https://mail.example.com",
		"reloop auth use staging",
	],
};
