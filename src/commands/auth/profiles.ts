import { selectProfileName } from "@/auth/resolve";
import type { Command } from "@/cli/spec";
import { configFilePath } from "@/config/paths";
import { readConfig, writeConfig } from "@/config/store";
import { usageError } from "@/errors/cli-error";
import { renderTable } from "@/output/table";

export const listProfilesCommand: Command = {
	name: "list",
	aliases: ["ls"],
	summary: "List stored profiles",
	examples: ["reloop auth list", "reloop auth list --json"],
	async run(input) {
		const { ctx, globals, output } = input;
		const config = readConfig(ctx.env);
		const active = selectProfileName(globals, ctx.env, config);

		const profiles = Object.entries(config.profiles).map(([name, profile]) => ({
			name,
			endpoint: profile.endpoint,
			active: name === active,
			hasApiKey: profile.apiKey !== undefined,
		}));

		output.emit({
			data: {
				object: "profile_list" as const,
				configFile: configFilePath(ctx.env),
				activeProfile: active,
				profiles,
			},
			render: (value) =>
				renderTable(
					[
						{ header: "profile", values: value.profiles.map((p) => p.name) },
						{
							header: "endpoint",
							values: value.profiles.map((p) => p.endpoint),
						},
						{
							header: "credential",
							values: value.profiles.map((p) =>
								p.hasApiKey ? "stored" : "none",
							),
						},
						{
							header: "active",
							values: value.profiles.map((p) => (p.active ? "yes" : "")),
						},
					],
					{
						...(output.width !== undefined ? { width: output.width } : {}),
						empty: "No profiles yet. Run `reloop login` to create one.",
					},
				),
		});
	},
};

export const useProfileCommand: Command = {
	name: "use",
	summary: "Set the profile used when --profile is not passed",
	args: [{ name: "profile", summary: "Profile name", required: true }],
	errorCodes: ["profile_not_found", "missing_argument"],
	examples: ["reloop auth use production"],
	async run(input) {
		const { ctx, output } = input;
		const name = input.args[0] ?? "";
		const config = readConfig(ctx.env);

		if (!config.profiles[name]) {
			const known = Object.keys(config.profiles);
			throw usageError(`Profile "${name}" does not exist.`, {
				code: "profile_not_found",
				fix:
					known.length > 0
						? `Known profiles: ${known.join(", ")}.`
						: "Create one with `reloop login --profile <name>`.",
			});
		}

		config.activeProfile = name;
		writeConfig(ctx.env, config);

		output.emit({
			data: { object: "profile" as const, activeProfile: name },
			render: (value) => `Active profile is now "${value.activeProfile}".`,
		});
	},
};
