import { ReloopApiClient } from "@/api/client";
import { ContactsApi } from "@/api/contacts";
import { type ResolvedAuth, resolveAuth, resolveTarget } from "@/auth/resolve";
import type { CommandInput } from "@/cli/spec";
import { type ConfigFile, readConfig } from "@/config/store";

export type Session = {
	auth: ResolvedAuth;
	config: ConfigFile;
	client: ReloopApiClient;
	contacts: ContactsApi;
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

export function createClient(
	input: CommandInput,
	options: { endpoint: string; apiKey: string },
): ReloopApiClient {
	return new ReloopApiClient({
		endpoint: options.endpoint,
		apiKey: options.apiKey,
		fetch: input.ctx.fetch,
		timeoutMs: input.globals.timeoutMs,
		debug: debugSink(input),
	});
}

export function createSession(input: CommandInput): Session {
	const config = readConfig(input.ctx.env);
	const auth = resolveAuth(input.globals, input.ctx.env, config);
	const client = createClient(input, auth);

	return { auth, config, client, contacts: new ContactsApi(client) };
}

export function readTarget(input: CommandInput) {
	const config = readConfig(input.ctx.env);
	return {
		config,
		target: resolveTarget(input.globals, input.ctx.env, config),
	};
}
