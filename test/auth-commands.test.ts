import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "@/cli/run";
import { readConfig } from "@/config/store";
import { ExitCode } from "@/errors/cli-error";
import {
	API_KEY,
	createTestContext,
	ENDPOINT,
	mockApi,
	type Route,
	scriptedPrompter,
	withConfigDir,
} from "./helpers";

let temp: ReturnType<typeof withConfigDir>;

beforeEach(() => {
	temp = withConfigDir();
});

afterEach(() => {
	temp.cleanup();
});

const keyListBody = {
	object: "api_key",
	apiKeys: [
		{
			id: "key_1",
			name: "cli",
			start: API_KEY.slice(0, 17),
			enabled: true,
			createdBy: { id: "u1", name: "Luna", email: "luna@example.com" },
		},
	],
	total: 1,
	page: 1,
	limit: 100,
	event: "e",
};

function setup(
	routes: Route[],
	options: {
		env?: Record<string, string | undefined>;
		tty?: boolean;
		answers?: Array<string | boolean>;
	} = {},
) {
	const api = mockApi(routes);
	const ctx = createTestContext({
		env: { RELOOP_CONFIG_DIR: temp.dir, ...options.env },
		fetch: api.fetch,
		terminal: options.tty
			? { stdinIsTty: true, stdoutIsTty: true, stderrIsTty: true, columns: 100 }
			: {},
		...(options.answers ? { prompter: scriptedPrompter(options.answers) } : {}),
	});
	return { api, ctx };
}

describe("login", () => {
	test("verifies the key and stores it against the given endpoint", async () => {
		const { api, ctx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{ env: { RELOOP_API_KEY: API_KEY } },
		);

		expect(
			await run(["login", "--endpoint", ENDPOINT, "--profile", "prod"], ctx),
		).toBe(ExitCode.success);

		expect(api.calls[0]?.headers["x-api-key"]).toBe(API_KEY);
		const config = readConfig({ RELOOP_CONFIG_DIR: temp.dir });
		expect(config.profiles.prod).toEqual({
			endpoint: ENDPOINT,
			apiKey: API_KEY,
		});
		expect(config.activeProfile).toBe("prod");
	});

	test("never echoes the raw key back to the caller", async () => {
		const { ctx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{ env: { RELOOP_API_KEY: API_KEY } },
		);

		await run(["login", "--endpoint", ENDPOINT], ctx);
		expect(ctx.stdoutText()).not.toContain(API_KEY);
		expect(ctx.stderrText()).not.toContain(API_KEY);
		expect(ctx.stdoutJson<{ apiKey: string }>().apiKey).toBe("rl_prod_test…");
	});

	test("refuses to store a key the server rejects", async () => {
		const { ctx } = setup(
			[
				{
					method: "GET",
					path: "/api/api-key/",
					status: 401,
					body: { message: "Authentication required" },
				},
			],
			{ env: { RELOOP_API_KEY: "rl_prod_wrong" } },
		);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"invalid_api_key",
		);
		expect(readConfig({ RELOOP_CONFIG_DIR: temp.dir }).profiles).toEqual({});
	});

	test("refuses to store a key when the endpoint is unreachable", async () => {
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir, RELOOP_API_KEY: API_KEY },
			fetch: () => Promise.reject(new Error("ECONNREFUSED")),
		});

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.network,
		);
		expect(readConfig({ RELOOP_CONFIG_DIR: temp.dir }).profiles).toEqual({});
	});

	test("stores the key with a warning when verification is inconclusive", async () => {
		const { ctx } = setup(
			[
				{
					method: "GET",
					path: "/api/api-key/",
					status: 503,
					body: { message: "down" },
				},
			],
			{ env: { RELOOP_API_KEY: API_KEY } },
		);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(ctx.stderrText()).toContain("Warning:");
		expect(
			readConfig({ RELOOP_CONFIG_DIR: temp.dir }).profiles.default?.apiKey,
		).toBe(API_KEY);
	});

	test("reads the key from a hidden prompt on a terminal", async () => {
		const { ctx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{ tty: true, answers: [API_KEY] },
		);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(
			readConfig({ RELOOP_CONFIG_DIR: temp.dir }).profiles.default?.apiKey,
		).toBe(API_KEY);
	});

	test("fails with missing_api_key instead of prompting in a script", async () => {
		const { ctx } = setup([]);
		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.usage,
		);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"missing_api_key",
		);
	});

	test("rejects a malformed endpoint before touching the network", async () => {
		const { api, ctx } = setup([], { env: { RELOOP_API_KEY: API_KEY } });
		expect(await run(["login", "--endpoint", "mail.example.com"], ctx)).toBe(
			ExitCode.usage,
		);
		expect(api.calls).toHaveLength(0);
	});
});

describe("auth status", () => {
	test("reports the resolved credential and its source", async () => {
		const { ctx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{
				env: { RELOOP_API_KEY: API_KEY },
			},
		);

		expect(await run(["auth", "status", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(ctx.stdoutJson()).toMatchObject({
			endpoint: ENDPOINT,
			endpointSource: "flag",
			apiKeySource: "environment",
			apiKey: "rl_prod_test…",
			verified: true,
			keyName: "cli",
			user: "luna@example.com",
		});
	});

	test("exits with the auth code when nothing is configured", async () => {
		const { ctx } = setup([]);
		expect(await run(["auth", "status"], ctx)).toBe(ExitCode.auth);
	});
});

describe("logout and profiles", () => {
	test("clears the stored key but keeps the endpoint", async () => {
		const { ctx: loginCtx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{ env: { RELOOP_API_KEY: API_KEY } },
		);
		await run(["login", "--endpoint", ENDPOINT, "--profile", "prod"], loginCtx);

		const { ctx } = setup([]);
		expect(await run(["logout", "--profile", "prod"], ctx)).toBe(
			ExitCode.success,
		);

		const config = readConfig({ RELOOP_CONFIG_DIR: temp.dir });
		expect(config.profiles.prod).toEqual({ endpoint: ENDPOINT });
	});

	test("lists profiles and marks the active one", async () => {
		const { ctx: loginCtx } = setup(
			[{ method: "GET", path: "/api/api-key/", body: keyListBody }],
			{ env: { RELOOP_API_KEY: API_KEY } },
		);
		await run(["login", "--endpoint", ENDPOINT, "--profile", "prod"], loginCtx);

		const { ctx } = setup([]);
		await run(["auth", "list"], ctx);
		expect(
			ctx.stdoutJson<{ profiles: Array<{ name: string; active: boolean }> }>(),
		).toMatchObject({
			activeProfile: "prod",
			profiles: [{ name: "prod", active: true }],
		});
	});

	test("auth use rejects an unknown profile", async () => {
		const { ctx } = setup([]);
		expect(await run(["auth", "use", "ghost"], ctx)).toBe(ExitCode.usage);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"profile_not_found",
		);
	});
});
