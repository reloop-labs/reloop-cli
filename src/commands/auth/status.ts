import { maskApiKey } from "@/auth/redact";
import { resolveAuth } from "@/auth/resolve";
import { createClient, credentialFor } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { verifyCredential } from "@/commands/auth/verify";
import { readConfig } from "@/config/store";

export const statusCommand: Command = {
	name: "status",
	summary: "Show which credentials the CLI would use",
	description:
		"Resolves the credential and endpoint exactly as every other command does, then checks it against that endpoint. Exits non-zero when no usable credential is found.",
	errorCodes: [
		"not_authenticated",
		"invalid_api_key",
		"session_expired",
		"profile_not_found",
		"network_error",
	],
	examples: ["reloop auth status", "reloop auth status --json"],
	async run(input) {
		const { ctx, globals, output } = input;
		const config = readConfig(ctx.env);
		const auth = resolveAuth(globals, ctx.env, config);
		const client = createClient(
			input,
			auth.endpoint,
			credentialFor(input, auth),
		);
		const verification = await verifyCredential(client, auth.credential);
		const { credential } = auth;

		const data = {
			object: "auth_status" as const,
			profile: auth.profileName,
			endpoint: auth.endpoint,
			endpointSource: auth.endpointSource,
			method: credential.kind,
			apiKey:
				credential.kind === "api_key" ? maskApiKey(credential.apiKey) : null,
			apiKeySource: credential.kind === "api_key" ? credential.source : null,
			organizationId:
				credential.kind === "oauth"
					? (credential.grant.organizationId ?? null)
					: null,
			verified: verification.status === "valid",
			keyName: verification.status === "valid" ? verification.keyName : null,
			user: verification.status === "valid" ? verification.userEmail : null,
		};

		if (verification.status === "inconclusive") {
			output.warn(
				`Could not confirm the credential against ${auth.endpoint}: ${verification.reason}`,
			);
		}

		output.emit({
			data,
			render: (value) =>
				value.method === "oauth"
					? [
							`Profile        ${value.profile}`,
							`Endpoint       ${value.endpoint} (${value.endpointSource})`,
							"Signed in      with browser",
							`User           ${value.user ?? "-"}`,
							`Organization   ${value.organizationId ?? "-"}`,
						].join("\n")
					: [
							`Profile        ${value.profile}`,
							`Endpoint       ${value.endpoint} (${value.endpointSource})`,
							`API key        ${value.apiKey} (${value.apiKeySource})`,
							`Key name       ${value.keyName ?? "-"}`,
							`Created by     ${value.user ?? "-"}`,
						].join("\n"),
		});
	},
};
