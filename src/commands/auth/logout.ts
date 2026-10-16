import { selectProfileName } from "@/auth/resolve";
import { createOAuthApi } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { readConfig, writeConfig } from "@/config/store";
import { usageError } from "@/errors/cli-error";

export const logoutCommand: Command = {
	name: "logout",
	summary: "Sign out and remove stored credentials",
	description:
		"Revokes a browser sign-in on the server and removes the stored API key or session. The profile and its endpoint are kept so the target stays configured; only the credential is removed.",
	flags: [
		{
			name: "all",
			kind: "boolean",
			summary: "Sign out of every profile",
		},
	],
	errorCodes: ["profile_not_found", "config_error"],
	examples: [
		"reloop logout",
		"reloop logout --profile production",
		"reloop logout --all",
	],
	async run(input) {
		const { ctx, globals, output } = input;
		const config = readConfig(ctx.env);
		const all = input.flags.bool("all");

		const names = all
			? Object.keys(config.profiles)
			: [selectProfileName(globals, ctx.env, config)];

		const cleared: string[] = [];
		for (const name of names) {
			const profile = config.profiles[name];
			if (!profile) {
				if (!all) {
					throw usageError(`Profile "${name}" does not exist.`, {
						code: "profile_not_found",
					});
				}
				continue;
			}
			if (profile.oauth !== undefined) {
				await createOAuthApi(input, profile.endpoint).revoke(profile.oauth);
			}
			if (profile.apiKey !== undefined || profile.oauth !== undefined) {
				config.profiles[name] = { endpoint: profile.endpoint };
				cleared.push(name);
			}
		}

		if (cleared.length > 0) {
			writeConfig(ctx.env, config);
		}

		output.emit({
			data: { object: "logout" as const, profiles: cleared },
			render: (value) =>
				value.profiles.length === 0
					? "No stored credentials to remove."
					: `Signed out of: ${value.profiles.join(", ")}`,
		});
	},
};
