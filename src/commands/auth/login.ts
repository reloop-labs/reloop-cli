import { maskApiKey } from "@/auth/redact";
import { selectProfileName, validateEndpoint } from "@/auth/resolve";
import { isInteractive } from "@/cli/context";
import { createClient } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { verifyApiKey } from "@/commands/auth/verify";
import { DEFAULT_ENDPOINT, readConfig, writeConfig } from "@/config/store";
import { CliError, ExitCode } from "@/errors/cli-error";

export const loginCommand: Command = {
	name: "login",
	summary: "Store an API key for Reloop Cloud or a self-hosted install",
	description:
		"The key is verified against the target endpoint before it is written to the config file. Use --profile to keep separate credentials per environment and --endpoint to point at a self-hosted Reloop.",
	errorCodes: [
		"missing_api_key",
		"invalid_api_key",
		"invalid_endpoint",
		"network_error",
		"config_error",
	],
	examples: [
		"reloop login",
		"reloop login --profile production --endpoint https://mail.example.com",
		"RELOOP_API_KEY=rl_prod_... reloop login --profile ci",
	],
	async run(input) {
		const { ctx, globals, output } = input;
		const config = readConfig(ctx.env);
		const profileName = selectProfileName(globals, ctx.env, config);
		const endpoint = validateEndpoint(
			globals.endpoint ??
				ctx.env.RELOOP_ENDPOINT ??
				config.profiles[profileName]?.endpoint ??
				DEFAULT_ENDPOINT,
		);

		const apiKey = await readApiKey(input, endpoint);
		const client = createClient(input, { endpoint, apiKey });
		const verification = await verifyApiKey(client, apiKey);

		if (verification.status === "inconclusive") {
			output.warn(
				`Could not confirm the key against ${endpoint}: ${verification.reason}`,
			);
		}

		config.profiles[profileName] = { endpoint, apiKey };
		config.activeProfile = profileName;
		writeConfig(ctx.env, config);

		const data = {
			object: "profile" as const,
			profile: profileName,
			endpoint,
			apiKey: maskApiKey(apiKey),
			verified: verification.status === "valid",
			...(verification.status === "valid"
				? { keyName: verification.keyName, user: verification.userEmail }
				: {}),
		};

		output.success(`Signed in to ${endpoint} as profile "${profileName}"`);
		output.emit({
			data,
			render: (value) =>
				`Profile   ${value.profile}\nEndpoint  ${value.endpoint}\nAPI key   ${value.apiKey}`,
		});
	},
};

async function readApiKey(
	input: Parameters<NonNullable<Command["run"]>>[0],
	endpoint: string,
): Promise<string> {
	const provided = input.globals.apiKey ?? input.ctx.env.RELOOP_API_KEY;
	if (provided?.trim()) {
		return provided.trim();
	}

	if (!isInteractive(input.ctx) || input.output.json) {
		throw new CliError({
			code: "missing_api_key",
			message: "No API key provided.",
			exitCode: ExitCode.usage,
			fix: "Pass --api-key, set RELOOP_API_KEY, or run `reloop login` in an interactive terminal.",
		});
	}

	input.output.note(`Signing in to ${endpoint}`);
	return input.ctx.prompter.secret({
		message: "API key",
		validate: (value) =>
			value.length > 0
				? undefined
				: "Paste the API key from your Reloop dashboard.",
	});
}
