import { apiKeyCredential } from "@/auth/credential";
import {
	CALLBACK_PATH,
	createPkce,
	createState,
	type OAuthApi,
	type RegisteredClient,
} from "@/auth/oauth";
import { maskApiKey } from "@/auth/redact";
import { selectProfileName, validateEndpoint } from "@/auth/resolve";
import { isCi, isInteractive, isRemoteShell } from "@/cli/context";
import { createClient, createOAuthApi } from "@/cli/session";
import type { Command, CommandInput } from "@/cli/spec";
import { verifyApiKey } from "@/commands/auth/verify";
import {
	type ConfigFile,
	DEFAULT_ENDPOINT,
	type OAuthGrant,
	readConfig,
	writeConfig,
} from "@/config/store";
import { CliError, ExitCode } from "@/errors/cli-error";

const BROWSER_TIMEOUT_MS = 5 * 60_000;
const SLOW_DOWN_STEP_MS = 5_000;

export const loginCommand: Command = {
	name: "login",
	summary: "Sign in to Reloop Cloud or a self-hosted install",
	description:
		"Opens your browser to approve the CLI for one organization, with no API key to create or copy. Over SSH, or with --device, it prints a link and a one-time code to confirm from any browser instead. To use an API key, pass --api-key, set RELOOP_API_KEY, or use --with-api-key to paste one at a hidden prompt. Use --profile to keep separate credentials per environment and --endpoint to point at a self-hosted Reloop.",
	flags: [
		{
			name: "device",
			kind: "boolean",
			summary:
				"Confirm a one-time code in any browser instead of redirecting back to this machine",
		},
		{
			name: "with-api-key",
			kind: "boolean",
			summary:
				"Paste an API key at a hidden prompt instead of using the browser",
		},
	],
	errorCodes: [
		"missing_api_key",
		"invalid_api_key",
		"invalid_endpoint",
		"oauth_unavailable",
		"login_denied",
		"login_timeout",
		"login_failed",
		"network_error",
		"config_error",
	],
	examples: [
		"reloop login",
		"reloop login --device",
		"reloop login --with-api-key",
		"reloop login --profile production --endpoint https://mail.example.com",
		"RELOOP_API_KEY=rl_prod_... reloop login --profile ci",
	],
	async run(input) {
		const { ctx, globals } = input;
		const config = readConfig(ctx.env);
		const profileName = selectProfileName(globals, ctx.env, config);
		const endpoint = validateEndpoint(
			globals.endpoint ??
				ctx.env.RELOOP_ENDPOINT ??
				config.profiles[profileName]?.endpoint ??
				DEFAULT_ENDPOINT,
		);

		const provided = (globals.apiKey ?? ctx.env.RELOOP_API_KEY)?.trim();
		if (provided || input.flags.bool("with-api-key")) {
			await loginWithApiKey(input, config, profileName, endpoint, provided);
			return;
		}

		if (isCi(ctx.env)) {
			throw new CliError({
				code: "missing_api_key",
				message: "No API key provided.",
				exitCode: ExitCode.usage,
				why: "Browser sign-in is not available in CI.",
				fix: "Pass --api-key or set RELOOP_API_KEY.",
			});
		}

		await loginWithOAuth(input, config, profileName, endpoint);
	},
};

async function loginWithOAuth(
	input: CommandInput,
	config: ConfigFile,
	profileName: string,
	endpoint: string,
): Promise<void> {
	const { ctx, output } = input;
	const oauth = createOAuthApi(input, endpoint);
	const profile = config.profiles[profileName];
	const known =
		profile?.oauth && profile.endpoint === endpoint
			? { clientId: profile.oauth.clientId, resource: profile.oauth.resource }
			: undefined;

	const grant =
		input.flags.bool("device") || isRemoteShell(ctx.env)
			? await deviceFlow(input, oauth, known)
			: await browserFlow(input, oauth, known ?? (await oauth.register()));

	const fresh = readConfig(ctx.env);
	fresh.profiles[profileName] = { endpoint, oauth: grant };
	fresh.activeProfile = profileName;
	writeConfig(ctx.env, fresh);

	output.success(
		grant.email
			? `Signed in to ${endpoint} as ${grant.email} (profile "${profileName}")`
			: `Signed in to ${endpoint} as profile "${profileName}"`,
	);
	output.emit({
		data: {
			object: "profile" as const,
			profile: profileName,
			endpoint,
			method: "oauth" as const,
			user: grant.email ?? null,
			organizationId: grant.organizationId ?? null,
		},
		render: (value) =>
			[
				`Profile       ${value.profile}`,
				`Endpoint      ${value.endpoint}`,
				`Signed in as  ${value.user ?? "-"}`,
				`Organization  ${value.organizationId ?? "-"}`,
			].join("\n"),
	});
}

async function browserFlow(
	input: CommandInput,
	oauth: OAuthApi,
	client: RegisteredClient,
): Promise<OAuthGrant> {
	const { ctx, output } = input;
	const server = await ctx.loopback.listen(CALLBACK_PATH, BROWSER_TIMEOUT_MS);
	try {
		const pkce = createPkce();
		const state = createState();
		const url = oauth.authorizeUrl({
			client,
			redirectUri: server.redirectUri,
			state,
			pkce,
		});

		const opened = await ctx.browser.open(url);
		output.notice(
			opened
				? "Opened your browser to approve the Reloop CLI. If nothing appeared, open:"
				: "Open this link to approve the Reloop CLI:",
		);
		output.notice(`  ${url}`);
		output.note("Waiting for approval…");

		const params = await server.result;
		if (!params) {
			throw loginTimeout();
		}
		if (params.get("state") !== state) {
			throw loginFailed(
				"The browser returned a sign-in response for another request.",
			);
		}
		const error = params.get("error");
		if (error === "access_denied") {
			throw new CliError({
				code: "login_denied",
				message: "The sign-in request was denied in the browser.",
				exitCode: ExitCode.auth,
				fix: "Run `reloop login` again and approve the request.",
			});
		}
		const code = params.get("code");
		if (error || !code) {
			throw loginFailed(
				"Reloop did not complete the sign-in.",
				params.get("error_description") ?? error ?? undefined,
			);
		}

		return await oauth.exchangeCode({
			client,
			code,
			redirectUri: server.redirectUri,
			pkce,
		});
	} finally {
		server.close();
	}
}

async function deviceFlow(
	input: CommandInput,
	oauth: OAuthApi,
	known: RegisteredClient | undefined,
): Promise<OAuthGrant> {
	const { ctx, output } = input;
	let client = known ?? (await oauth.register());
	let authorization = await oauth.requestDeviceCode(client);
	if (!authorization && known) {
		client = await oauth.register();
		authorization = await oauth.requestDeviceCode(client);
	}
	if (!authorization) {
		throw loginFailed(`${oauth.endpoint} rejected the CLI's sign-in client.`);
	}

	const link =
		authorization.verificationUriComplete ?? authorization.verificationUri;
	output.notice(
		"Open this link and confirm the code to approve the Reloop CLI:",
	);
	output.notice(`  ${link}`);
	output.notice(`  Code: ${authorization.userCode}`);
	if (!isRemoteShell(ctx.env)) {
		await ctx.browser.open(link);
	}
	output.note("Waiting for approval…");

	const deadline = Date.now() + authorization.expiresInSeconds * 1000;
	let interval = authorization.intervalSeconds * 1000;
	while (Date.now() < deadline) {
		await ctx.sleep(interval);
		const poll = await oauth.pollDeviceToken(client, authorization.deviceCode);
		if (poll.status === "approved") {
			return poll.grant;
		}
		if (poll.status === "slow_down") {
			interval += SLOW_DOWN_STEP_MS;
		}
	}
	throw loginTimeout();
}

function loginFailed(message: string, why?: string): CliError {
	return new CliError({
		code: "login_failed",
		message,
		exitCode: ExitCode.auth,
		...(why !== undefined ? { why } : {}),
		fix: "Run `reloop login` again.",
	});
}

function loginTimeout(): CliError {
	return new CliError({
		code: "login_timeout",
		message: "Timed out waiting for the sign-in to be approved.",
		exitCode: ExitCode.auth,
		fix: "Run `reloop login` again, or `reloop login --device` to confirm from another device.",
	});
}

async function loginWithApiKey(
	input: CommandInput,
	config: ConfigFile,
	profileName: string,
	endpoint: string,
	provided: string | undefined,
): Promise<void> {
	const { ctx, output } = input;
	const apiKey = provided || (await promptApiKey(input, endpoint));
	const client = createClient(input, endpoint, apiKeyCredential(apiKey));
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
		method: "api_key" as const,
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
}

async function promptApiKey(
	input: CommandInput,
	endpoint: string,
): Promise<string> {
	if (!isInteractive(input.ctx) || input.output.json) {
		throw new CliError({
			code: "missing_api_key",
			message: "No API key provided.",
			exitCode: ExitCode.usage,
			fix: "Pass --api-key, set RELOOP_API_KEY, or run `reloop login --with-api-key` in an interactive terminal.",
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
