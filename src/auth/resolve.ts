import type { Env } from "@/cli/context";
import type { ResolvedGlobals } from "@/cli/globals";
import {
	type ConfigFile,
	DEFAULT_ENDPOINT,
	DEFAULT_PROFILE,
	type OAuthGrant,
	type Profile,
} from "@/config/store";
import { CliError, ExitCode, usageError } from "@/errors/cli-error";

export type ValueSource = "flag" | "environment" | "profile" | "default";

export type ResolvedTarget = {
	endpoint: string;
	endpointSource: ValueSource;
	profileName: string;
	profileExists: boolean;
};

export type ResolvedCredential =
	| {
			kind: "api_key";
			apiKey: string;
			source: Exclude<ValueSource, "default">;
	  }
	| { kind: "oauth"; grant: OAuthGrant; source: "profile" };

export type ResolvedAuth = ResolvedTarget & {
	credential: ResolvedCredential;
};

export function validateEndpoint(endpoint: string): string {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw usageError(`"${endpoint}" is not a valid URL.`, {
			code: "invalid_endpoint",
			fix: "Pass a full base URL, for example https://mail.example.com",
		});
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw usageError(`"${endpoint}" must use http or https.`, {
			code: "invalid_endpoint",
		});
	}
	return endpoint.replace(/\/+$/, "");
}

export function selectProfileName(
	globals: ResolvedGlobals,
	env: Env,
	config: ConfigFile,
): string {
	return (
		globals.profile ??
		env.RELOOP_PROFILE ??
		config.activeProfile ??
		DEFAULT_PROFILE
	);
}

function requireProfile(
	globals: ResolvedGlobals,
	env: Env,
	config: ConfigFile,
): { name: string; profile?: Profile } {
	const name = selectProfileName(globals, env, config);
	const profile = config.profiles[name];

	if (!profile && globals.profile !== undefined) {
		const known = Object.keys(config.profiles);
		throw usageError(`Profile "${name}" does not exist.`, {
			code: "profile_not_found",
			fix:
				known.length > 0
					? `Known profiles: ${known.join(", ")}.`
					: `Create one with \`reloop login --profile ${name}\`.`,
		});
	}

	return profile === undefined ? { name } : { name, profile };
}

export function resolveTarget(
	globals: ResolvedGlobals,
	env: Env,
	config: ConfigFile,
): ResolvedTarget {
	const { name, profile } = requireProfile(globals, env, config);

	if (globals.endpoint !== undefined) {
		return {
			endpoint: validateEndpoint(globals.endpoint),
			endpointSource: "flag",
			profileName: name,
			profileExists: profile !== undefined,
		};
	}
	if (env.RELOOP_ENDPOINT) {
		return {
			endpoint: validateEndpoint(env.RELOOP_ENDPOINT),
			endpointSource: "environment",
			profileName: name,
			profileExists: profile !== undefined,
		};
	}
	if (profile?.endpoint) {
		return {
			endpoint: validateEndpoint(profile.endpoint),
			endpointSource: "profile",
			profileName: name,
			profileExists: true,
		};
	}
	return {
		endpoint: DEFAULT_ENDPOINT,
		endpointSource: "default",
		profileName: name,
		profileExists: profile !== undefined,
	};
}

export function resolveAuth(
	globals: ResolvedGlobals,
	env: Env,
	config: ConfigFile,
): ResolvedAuth {
	const target = resolveTarget(globals, env, config);
	const profile = config.profiles[target.profileName];

	const candidates: Array<{
		value: string | undefined;
		source: Exclude<ValueSource, "default">;
	}> = [
		{ value: globals.apiKey, source: "flag" },
		{ value: env.RELOOP_API_KEY, source: "environment" },
		{ value: profile?.apiKey, source: "profile" },
	];

	for (const candidate of candidates) {
		const apiKey = candidate.value?.trim();
		if (apiKey) {
			return {
				...target,
				credential: { kind: "api_key", apiKey, source: candidate.source },
			};
		}
	}

	if (profile?.oauth && profile.endpoint === target.endpoint) {
		return {
			...target,
			credential: { kind: "oauth", grant: profile.oauth, source: "profile" },
		};
	}

	throw new CliError({
		code: "not_authenticated",
		message: "You are not signed in to Reloop.",
		exitCode: ExitCode.auth,
		why: `Checked --api-key, RELOOP_API_KEY, and the "${target.profileName}" profile.`,
		fix: "Run `reloop login` to sign in with your browser, or pass --api-key, or set RELOOP_API_KEY.",
	});
}
