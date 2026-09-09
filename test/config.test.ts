import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { maskApiKey } from "@/auth/redact";
import { resolveAuth, resolveTarget } from "@/auth/resolve";
import { DEFAULT_TIMEOUT_MS, type ResolvedGlobals } from "@/cli/globals";
import { configFilePath } from "@/config/paths";
import {
	DEFAULT_ENDPOINT,
	emptyConfig,
	readConfig,
	writeConfig,
} from "@/config/store";
import type { CliError } from "@/errors/cli-error";
import { API_KEY, withConfigDir } from "./helpers";

const globals = (over: Partial<ResolvedGlobals> = {}): ResolvedGlobals => ({
	json: false,
	quiet: false,
	debug: false,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	...over,
});

let temp: ReturnType<typeof withConfigDir>;

beforeEach(() => {
	temp = withConfigDir();
});

afterEach(() => {
	temp.cleanup();
});

describe("config store", () => {
	test("returns an empty config when no file exists", () => {
		expect(readConfig({ RELOOP_CONFIG_DIR: temp.dir })).toEqual(emptyConfig());
	});

	test("round-trips profiles and writes the file as owner-only", () => {
		const env = { RELOOP_CONFIG_DIR: temp.dir };
		writeConfig(env, {
			version: 1,
			activeProfile: "prod",
			profiles: {
				prod: { endpoint: "https://mail.example.com", apiKey: API_KEY },
			},
		});

		expect(readConfig(env).profiles.prod?.apiKey).toBe(API_KEY);
		expect(statSync(configFilePath(env)).mode & 0o777).toBe(0o600);
	});

	test("rejects a corrupted config with an actionable error", () => {
		const env = { RELOOP_CONFIG_DIR: temp.dir };
		writeConfig(env, emptyConfig());
		writeFileSync(configFilePath(env), "{not json");

		expect(() => readConfig(env)).toThrow("is not valid JSON");
	});

	test("drops malformed profile entries instead of failing", () => {
		const env = { RELOOP_CONFIG_DIR: temp.dir };
		writeConfig(env, emptyConfig());
		writeFileSync(
			configFilePath(env),
			JSON.stringify({
				version: 1,
				profiles: { good: { endpoint: "https://a.test" }, bad: 5 },
			}),
		);

		expect(Object.keys(readConfig(env).profiles)).toEqual(["good"]);
	});
});

describe("credential resolution", () => {
	const config = {
		version: 1 as const,
		activeProfile: "prod",
		profiles: {
			prod: { endpoint: "https://mail.example.com", apiKey: "rl_prod_stored" },
			local: { endpoint: "http://localhost:8014", apiKey: "rl_prod_local" },
		},
	};

	test("prefers --api-key over the environment and the profile", () => {
		const auth = resolveAuth(
			globals({ apiKey: "rl_prod_flag" }),
			{ RELOOP_API_KEY: "rl_prod_env" },
			config,
		);
		expect(auth.apiKey).toBe("rl_prod_flag");
		expect(auth.apiKeySource).toBe("flag");
	});

	test("prefers the environment over the stored profile", () => {
		const auth = resolveAuth(
			globals(),
			{ RELOOP_API_KEY: "rl_prod_env" },
			config,
		);
		expect(auth.apiKey).toBe("rl_prod_env");
		expect(auth.apiKeySource).toBe("environment");
	});

	test("falls back to the active profile", () => {
		const auth = resolveAuth(globals(), {}, config);
		expect(auth.apiKey).toBe("rl_prod_stored");
		expect(auth.profileName).toBe("prod");
		expect(auth.endpoint).toBe("https://mail.example.com");
	});

	test("--profile selects a different stored endpoint and key", () => {
		const auth = resolveAuth(globals({ profile: "local" }), {}, config);
		expect(auth.apiKey).toBe("rl_prod_local");
		expect(auth.endpoint).toBe("http://localhost:8014");
	});

	test("RELOOP_PROFILE selects a profile when --profile is absent", () => {
		const auth = resolveAuth(globals(), { RELOOP_PROFILE: "local" }, config);
		expect(auth.profileName).toBe("local");
	});

	test("--endpoint wins over the profile endpoint", () => {
		const auth = resolveAuth(
			globals({ endpoint: "https://other.example.com/" }),
			{},
			config,
		);
		expect(auth.endpoint).toBe("https://other.example.com");
		expect(auth.endpointSource).toBe("flag");
	});

	test("RELOOP_ENDPOINT wins over the profile endpoint", () => {
		const auth = resolveAuth(
			globals(),
			{ RELOOP_ENDPOINT: "https://env.example.com" },
			config,
		);
		expect(auth.endpoint).toBe("https://env.example.com");
		expect(auth.endpointSource).toBe("environment");
	});

	test("defaults to Reloop Cloud when nothing is configured", () => {
		const target = resolveTarget(globals(), {}, emptyConfig());
		expect(target.endpoint).toBe(DEFAULT_ENDPOINT);
		expect(target.endpointSource).toBe("default");
	});

	test("fails when an explicitly requested profile does not exist", () => {
		const error = (() => {
			try {
				resolveAuth(globals({ profile: "nope" }), {}, config);
			} catch (cause) {
				return cause as CliError;
			}
			throw new Error("expected a failure");
		})();
		expect(error.code).toBe("profile_not_found");
		expect(error.exitCode).toBe(2);
	});

	test("fails with an actionable auth error when no key is available", () => {
		const error = (() => {
			try {
				resolveAuth(globals(), {}, emptyConfig());
			} catch (cause) {
				return cause as CliError;
			}
			throw new Error("expected a failure");
		})();
		expect(error.code).toBe("not_authenticated");
		expect(error.exitCode).toBe(3);
	});

	test("rejects an endpoint that is not an http(s) URL", () => {
		expect(() =>
			resolveTarget(
				globals({ endpoint: "ftp://example.com" }),
				{},
				emptyConfig(),
			),
		).toThrow("must use http or https");
	});
});

describe("maskApiKey", () => {
	test("keeps only a short prefix", () => {
		expect(maskApiKey(API_KEY)).toBe("rl_prod_test…");
		expect(maskApiKey(API_KEY)).not.toContain(API_KEY.slice(-4));
	});

	test("hides short values entirely", () => {
		expect(maskApiKey("short")).toBe("*****");
	});
});
