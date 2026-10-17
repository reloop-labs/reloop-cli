import { ReloopApiClient } from "@/api/client";
import { ContactsApi } from "@/api/contacts";
import { WebhooksApi } from "@/api/webhooks";
import {
	apiKeyCredential,
	type Credential,
	OAuthCredential,
} from "@/auth/credential";
import { OAuthApi } from "@/auth/oauth";
import { type ResolvedAuth, resolveAuth, resolveTarget } from "@/auth/resolve";
import type { CommandInput } from "@/cli/spec";
import { type ConfigFile, readConfig, writeConfig } from "@/config/store";

export type Session = {
	auth: ResolvedAuth;
	config: ConfigFile;
	client: ReloopApiClient;
	contacts: ContactsApi;
	webhooks: WebhooksApi;
};

export function debugSink(
	input: CommandInput,
): ((line: string) => void) | undefined {
	if (!input.globals.debug) {
		return undefined;
	}
	return (line) => {
		input.ctx.stderr.write(`${input.output.style.dim(`[reloop] ${line}`)}\n`);
	};
}

export function createOAuthApi(
	input: CommandInput,
	endpoint: string,
): OAuthApi {
	return new OAuthApi({
		endpoint,
		fetch: input.ctx.fetch,
		timeoutMs: input.globals.timeoutMs,
		debug: debugSink(input),
	});
}

export function createClient(
	input: CommandInput,
	endpoint: string,
	credential: Credential,
): ReloopApiClient {
	return new ReloopApiClient({
		endpoint,
		credential,
		fetch: input.ctx.fetch,
		timeoutMs: input.globals.timeoutMs,
		debug: debugSink(input),
	});
}

export function credentialFor(
	input: CommandInput,
	auth: ResolvedAuth,
): Credential {
	if (auth.credential.kind === "api_key") {
		return apiKeyCredential(auth.credential.apiKey);
	}
	return new OAuthCredential(
		auth.credential.grant,
		createOAuthApi(input, auth.endpoint),
		(grant) => {
			const config = readConfig(input.ctx.env);
			const profile = config.profiles[auth.profileName];
			if (profile?.oauth?.clientId !== grant.clientId) {
				return;
			}
			profile.oauth = grant;
			writeConfig(input.ctx.env, config);
		},
	);
}

export function createSession(input: CommandInput): Session {
	const config = readConfig(input.ctx.env);
	const auth = resolveAuth(input.globals, input.ctx.env, config);
	const client = createClient(input, auth.endpoint, credentialFor(input, auth));

	return {
		auth,
		config,
		client,
		contacts: new ContactsApi(client),
		webhooks: new WebhooksApi(client),
	};
}

export function readTarget(input: CommandInput) {
	const config = readConfig(input.ctx.env);
	return {
		config,
		target: resolveTarget(input.globals, input.ctx.env, config),
	};
}
