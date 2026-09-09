import { maskApiKey } from "@/auth/redact";
import { resolveAuth } from "@/auth/resolve";
import { createClient } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { verifyApiKey } from "@/commands/auth/verify";
import { readConfig } from "@/config/store";

export const statusCommand: Command = {
	name: "status",
	summary: "Show which credentials the CLI would use",
	description:
		"Resolves the API key and endpoint exactly as every other command does, then checks the key against that endpoint. Exits non-zero when no usable credential is found.",
	errorCodes: [
		"not_authenticated",
		"invalid_api_key",
		"profile_not_found",
		"network_error",
	],
	examples: ["reloop auth status", "reloop auth status --json"],
	async run(input) {
		const { ctx, globals, output } = input;
		const config = readConfig(ctx.env);
		const auth = resolveAuth(globals, ctx.env, config);
		const client = createClient(input, auth);
		const verification = await verifyApiKey(client, auth.apiKey);

		const data = {
			object: "auth_status" as const,
			profile: auth.profileName,
			endpoint: auth.endpoint,
			endpointSource: auth.endpointSource,
			apiKey: maskApiKey(auth.apiKey),
			apiKeySource: auth.apiKeySource,
			verified: verification.status === "valid",
			keyName: verification.status === "valid" ? verification.keyName : null,
			user: verification.status === "valid" ? verification.userEmail : null,
		};

		if (verification.status === "inconclusive") {
			output.warn(
				`Could not confirm the key against ${auth.endpoint}: ${verification.reason}`,
			);
		}

		output.emit({
			data,
			render: (value) =>
				[
					`Profile        ${value.profile}`,
					`Endpoint       ${value.endpoint} (${value.endpointSource})`,
					`API key        ${value.apiKey} (${value.apiKeySource})`,
					`Key name       ${value.keyName ?? "-"}`,
					`Created by     ${value.user ?? "-"}`,
				].join("\n"),
		});
	},
};
