import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Env } from "@/cli/context";
import { configDir, configFilePath } from "@/config/paths";
import { configError } from "@/errors/cli-error";

export const DEFAULT_ENDPOINT = "https://reloop.sh";
export const DEFAULT_PROFILE = "default";

export type OAuthGrant = {
	clientId: string;
	resource: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	organizationId?: string;
	email?: string;
};

export type Profile = {
	endpoint: string;
	apiKey?: string;
	oauth?: OAuthGrant;
};

export type ConfigFile = {
	version: 1;
	activeProfile?: string;
	profiles: Record<string, Profile>;
};

export function emptyConfig(): ConfigFile {
	return { version: 1, profiles: {} };
}

function parseProfile(value: unknown): Profile | undefined {
	if (value === null || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const endpoint =
		typeof record.endpoint === "string" && record.endpoint.length > 0
			? record.endpoint
			: DEFAULT_ENDPOINT;
	const apiKey =
		typeof record.apiKey === "string" && record.apiKey.length > 0
			? record.apiKey
			: undefined;
	const oauth = parseGrant(record.oauth);
	return {
		endpoint,
		...(apiKey !== undefined ? { apiKey } : {}),
		...(oauth !== undefined ? { oauth } : {}),
	};
}

function optionalText(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseGrant(value: unknown): OAuthGrant | undefined {
	if (value === null || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const clientId = optionalText(record.clientId);
	const resource = optionalText(record.resource);
	const accessToken = optionalText(record.accessToken);
	if (
		!clientId ||
		!resource ||
		!accessToken ||
		typeof record.expiresAt !== "number"
	) {
		return undefined;
	}
	const refreshToken = optionalText(record.refreshToken);
	const organizationId = optionalText(record.organizationId);
	const email = optionalText(record.email);
	return {
		clientId,
		resource,
		accessToken,
		expiresAt: record.expiresAt,
		...(refreshToken !== undefined ? { refreshToken } : {}),
		...(organizationId !== undefined ? { organizationId } : {}),
		...(email !== undefined ? { email } : {}),
	};
}

export function readConfig(env: Env): ConfigFile {
	const path = configFilePath(env);
	if (!existsSync(path)) {
		return emptyConfig();
	}

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (cause) {
		throw configError(
			`Could not read ${path}.`,
			cause instanceof Error ? cause.message : undefined,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw configError(
			`${path} is not valid JSON.`,
			"Fix the file by hand, or delete it and run `reloop login` again.",
		);
	}

	if (parsed === null || typeof parsed !== "object") {
		throw configError(
			`${path} does not contain a Reloop configuration object.`,
			"Delete the file and run `reloop login` again.",
		);
	}

	const record = parsed as Record<string, unknown>;
	const profiles: Record<string, Profile> = {};
	if (record.profiles !== null && typeof record.profiles === "object") {
		for (const [name, value] of Object.entries(
			record.profiles as Record<string, unknown>,
		)) {
			const profile = parseProfile(value);
			if (profile) {
				profiles[name] = profile;
			}
		}
	}

	return {
		version: 1,
		...(typeof record.activeProfile === "string"
			? { activeProfile: record.activeProfile }
			: {}),
		profiles,
	};
}

export function writeConfig(env: Env, config: ConfigFile): void {
	const directory = configDir(env);
	const path = configFilePath(env);
	const temporary = join(directory, `config.json.${process.pid}.tmp`);

	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(temporary, path);
		chmodSync(path, 0o600);
	} catch (cause) {
		rmSync(temporary, { force: true });
		throw configError(
			`Could not write ${path}.`,
			cause instanceof Error ? cause.message : undefined,
		);
	}
}
