import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { run } from "@/cli/run";
import { type OAuthGrant, readConfig, writeConfig } from "@/config/store";
import { ExitCode } from "@/errors/cli-error";
import {
	createTestContext,
	ENDPOINT,
	type FakeLoopback,
	fakeBrowser,
	fakeLoopback,
	listFixture,
	mockApi,
	REDIRECT_URI,
	type Route,
	withConfigDir,
} from "./helpers";

let temp: ReturnType<typeof withConfigDir>;

beforeEach(() => {
	temp = withConfigDir();
});

afterEach(() => {
	temp.cleanup();
});

const RESOURCE = `${ENDPOINT}/mcp`;
const CLIENT_ID = "client_cli";

function jwt(claims: Record<string, unknown>): string {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "EdDSA" })}.${encode(claims)}.signature`;
}

const ACCESS_TOKEN = jwt({ sub: "user_1", org_id: "org_1", aud: RESOURCE });
const ID_TOKEN = jwt({ sub: "user_1", email: "luna@example.com" });

const registerRoute: Route = {
	method: "POST",
	path: "/api/auth/v1/oauth2/register",
	status: 201,
	body: { client_id: CLIENT_ID, resources: [RESOURCE] },
};

const tokenRoute: Route = {
	method: "POST",
	path: "/api/auth/v1/oauth2/token",
	body: {
		access_token: ACCESS_TOKEN,
		refresh_token: "refresh_1",
		id_token: ID_TOKEN,
		expires_in: 3600,
		token_type: "Bearer",
	},
};

function storedGrant(over: Partial<OAuthGrant> = {}): OAuthGrant {
	return {
		clientId: CLIENT_ID,
		resource: RESOURCE,
		accessToken: ACCESS_TOKEN,
		refreshToken: "refresh_1",
		expiresAt: Date.now() + 3_600_000,
		organizationId: "org_1",
		email: "luna@example.com",
		...over,
	};
}

function seedGrant(grant: OAuthGrant = storedGrant()): void {
	writeConfig(
		{ RELOOP_CONFIG_DIR: temp.dir },
		{
			version: 1,
			activeProfile: "default",
			profiles: { default: { endpoint: ENDPOINT, oauth: grant } },
		},
	);
}

function errorCode(ctx: ReturnType<typeof createTestContext>): string {
	const text = ctx.stderrText();
	return JSON.parse(text.slice(text.indexOf('{\n  "error"'))).error.code;
}

function stored() {
	return readConfig({ RELOOP_CONFIG_DIR: temp.dir });
}

function browserLogin(
	routes: Route[],
	answer: (url: URL) => Record<string, string> | undefined,
	env: Record<string, string> = {},
) {
	const api = mockApi(routes);
	const loopback: FakeLoopback = fakeLoopback();
	const browser = fakeBrowser((raw) => {
		loopback.respond(answer(new URL(raw)));
	});
	const ctx = createTestContext({
		env: { RELOOP_CONFIG_DIR: temp.dir, ...env },
		fetch: api.fetch,
		browser,
		loopback,
	});
	return { api, ctx, browser, loopback };
}

const approve = (url: URL) => ({
	code: "code_1",
	state: url.searchParams.get("state") ?? "",
});

describe("login with the browser", () => {
	test("registers the CLI, approves with PKCE, and stores the session", async () => {
		const { api, ctx, browser, loopback } = browserLogin(
			[registerRoute, tokenRoute],
			approve,
		);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);

		const registration = api.calls[0]?.body as Record<string, unknown>;
		expect(registration).toMatchObject({
			client_name: "Reloop CLI",
			redirect_uris: ["http://127.0.0.1/callback"],
			token_endpoint_auth_method: "none",
			application_type: "native",
		});

		const authorize = new URL(browser.opened[0] ?? "");
		expect(authorize.pathname).toBe("/api/auth/v1/oauth2/authorize");
		expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
		expect(authorize.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
		expect(authorize.searchParams.get("resource")).toBe(RESOURCE);
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorize.searchParams.get("scope")).toContain("offline_access");

		const exchange = api.calls[1]?.body as Record<string, string>;
		expect(exchange.grant_type).toBe("authorization_code");
		expect(exchange.code).toBe("code_1");
		expect(exchange.redirect_uri).toBe(REDIRECT_URI);
		expect(
			createHash("sha256")
				.update(exchange.code_verifier ?? "")
				.digest("base64url"),
		).toBe(authorize.searchParams.get("code_challenge") ?? "");

		expect(stored().profiles.default).toEqual({
			endpoint: ENDPOINT,
			oauth: expect.objectContaining({
				clientId: CLIENT_ID,
				resource: RESOURCE,
				accessToken: ACCESS_TOKEN,
				refreshToken: "refresh_1",
				organizationId: "org_1",
				email: "luna@example.com",
			}),
		});
		expect(loopback.closed).toBe(true);
		expect(ctx.stdoutJson()).toEqual({
			object: "profile",
			profile: "default",
			endpoint: ENDPOINT,
			method: "oauth",
			user: "luna@example.com",
			organizationId: "org_1",
		});
		expect(ctx.stdoutText()).not.toContain(ACCESS_TOKEN);
		expect(ctx.stderrText()).not.toContain(ACCESS_TOKEN);
	});

	test("prints the link when no browser can be opened", async () => {
		const api = mockApi([registerRoute, tokenRoute]);
		const loopback = fakeLoopback();
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir, RELOOP_NO_PROMPT: "1" },
			fetch: api.fetch,
			browser: fakeBrowser(
				(url) => loopback.respond(approve(new URL(url))),
				false,
			),
			loopback,
		});

		expect(await run(["login", "--quiet", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(ctx.stderrText()).toContain("Open this link to approve");
		expect(ctx.stderrText()).toContain("/api/auth/v1/oauth2/authorize?");
	});

	test("replaces a stored API key with the browser session", async () => {
		writeConfig(
			{ RELOOP_CONFIG_DIR: temp.dir },
			{
				version: 1,
				profiles: { default: { endpoint: ENDPOINT, apiKey: "rl_prod_old" } },
			},
		);
		const { ctx } = browserLogin([registerRoute, tokenRoute], approve);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(stored().profiles.default?.apiKey).toBeUndefined();
		expect(stored().profiles.default?.oauth?.accessToken).toBe(ACCESS_TOKEN);
	});

	test("reuses the client registered by an earlier login", async () => {
		seedGrant();
		const { api, ctx } = browserLogin([tokenRoute], approve);

		expect(await run(["login"], ctx)).toBe(ExitCode.success);
		expect(api.calls.map((call) => new URL(call.url).pathname)).toEqual([
			"/api/auth/v1/oauth2/token",
		]);
	});

	test("reports a denied request without storing anything", async () => {
		const { ctx } = browserLogin([registerRoute], (url) => ({
			error: "access_denied",
			state: url.searchParams.get("state") ?? "",
		}));

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(errorCode(ctx)).toBe("login_denied");
		expect(stored().profiles).toEqual({});
	});

	test("rejects a callback whose state does not match", async () => {
		const { api, ctx } = browserLogin([registerRoute, tokenRoute], () => ({
			code: "code_1",
			state: "forged",
		}));

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(errorCode(ctx)).toBe("login_failed");
		expect(api.calls).toHaveLength(1);
	});

	test("times out when the browser never returns", async () => {
		const { ctx, loopback } = browserLogin([registerRoute], () => undefined);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(errorCode(ctx)).toBe("login_timeout");
		expect(loopback.closed).toBe(true);
	});

	test("explains when the instance has no OAuth server", async () => {
		const { ctx } = browserLogin([], approve);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(errorCode(ctx)).toBe("oauth_unavailable");
	});
});

describe("login with a device code", () => {
	const deviceRoute: Route = {
		method: "POST",
		path: "/api/auth/v1/device/code",
		body: {
			device_code: "device_1",
			user_code: "ABCD1234",
			verification_uri: `${ENDPOINT}/dashboard/device`,
			verification_uri_complete: `${ENDPOINT}/dashboard/device?user_code=ABCD1234`,
			expires_in: 1800,
			interval: 5,
		},
	};

	function deviceLogin(routes: Route[], env: Record<string, string> = {}) {
		const api = mockApi(routes);
		const browser = fakeBrowser();
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir, ...env },
			fetch: api.fetch,
			browser,
		});
		return { api, ctx, browser };
	}

	test("shows the code, polls until approved, and stores the session", async () => {
		const { api, ctx, browser } = deviceLogin([
			registerRoute,
			deviceRoute,
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				status: 400,
				body: { error: "authorization_pending" },
			},
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				status: 400,
				body: { error: "slow_down" },
			},
			tokenRoute,
		]);

		expect(await run(["login", "--device", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);

		expect(ctx.stderrText()).toContain("ABCD1234");
		expect(browser.opened).toEqual([
			`${ENDPOINT}/dashboard/device?user_code=ABCD1234`,
		]);
		const polls = api.calls.filter((call) =>
			call.url.endsWith("/oauth2/token"),
		);
		expect(polls).toHaveLength(3);
		expect(polls[0]?.body).toMatchObject({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: "device_1",
			client_id: CLIENT_ID,
		});
		expect(stored().profiles.default?.oauth?.organizationId).toBe("org_1");
	});

	test("is used automatically over SSH without opening a browser", async () => {
		const { ctx, browser } = deviceLogin(
			[registerRoute, deviceRoute, tokenRoute],
			{ SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" },
		);

		expect(await run(["login", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.success,
		);
		expect(browser.opened).toEqual([]);
		expect(ctx.stderrText()).toContain("/dashboard/device?user_code=ABCD1234");
	});

	test("registers again when the stored client is gone", async () => {
		seedGrant(storedGrant({ clientId: "client_stale" }));
		const { api, ctx } = deviceLogin([
			{
				method: "POST",
				path: "/api/auth/v1/device/code",
				status: 400,
				body: { error: "invalid_client" },
			},
			registerRoute,
			deviceRoute,
			tokenRoute,
		]);

		expect(await run(["login", "--device"], ctx)).toBe(ExitCode.success);
		expect(api.calls[0]?.body).toMatchObject({ client_id: "client_stale" });
		expect(stored().profiles.default?.oauth?.clientId).toBe(CLIENT_ID);
	});

	test("reports a denied code", async () => {
		const { ctx } = deviceLogin([
			registerRoute,
			deviceRoute,
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				status: 400,
				body: { error: "access_denied" },
			},
		]);

		expect(await run(["login", "--device", "--endpoint", ENDPOINT], ctx)).toBe(
			ExitCode.auth,
		);
		expect(errorCode(ctx)).toBe("login_denied");
	});
});

describe("using a browser session", () => {
	const listRoute: Route = {
		method: "GET",
		path: "/api/contacts/list",
		body: listFixture([]),
	};

	test("sends the access token as a bearer credential", async () => {
		seedGrant();
		const api = mockApi([listRoute]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.success);
		expect(api.calls[0]?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
		expect(api.calls[0]?.headers["x-api-key"]).toBeUndefined();
	});

	test("refreshes an expired token first and saves the rotated one", async () => {
		seedGrant(storedGrant({ expiresAt: Date.now() - 1000 }));
		const refreshed = jwt({ sub: "user_1", org_id: "org_1", v: 2 });
		const api = mockApi([
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				body: {
					access_token: refreshed,
					refresh_token: "refresh_2",
					expires_in: 3600,
				},
			},
			listRoute,
		]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.success);
		expect(api.calls[0]?.body).toMatchObject({
			grant_type: "refresh_token",
			refresh_token: "refresh_1",
			client_id: CLIENT_ID,
			resource: RESOURCE,
		});
		expect(api.calls[1]?.headers.authorization).toBe(`Bearer ${refreshed}`);
		expect(stored().profiles.default?.oauth).toMatchObject({
			accessToken: refreshed,
			refreshToken: "refresh_2",
			email: "luna@example.com",
		});
	});

	test("refreshes once and retries when the server rejects the token", async () => {
		seedGrant();
		const refreshed = jwt({ sub: "user_1", org_id: "org_1", v: 2 });
		const api = mockApi([
			{
				method: "GET",
				path: "/api/contacts/list",
				status: 401,
				body: { message: "Unauthorized" },
			},
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				body: { access_token: refreshed, expires_in: 3600 },
			},
			listRoute,
		]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.success);
		expect(api.calls).toHaveLength(3);
		expect(stored().profiles.default?.oauth?.refreshToken).toBe("refresh_1");
	});

	test("asks to sign in again when the refresh token is revoked", async () => {
		seedGrant(storedGrant({ expiresAt: Date.now() - 1000 }));
		const api = mockApi([
			{
				method: "POST",
				path: "/api/auth/v1/oauth2/token",
				status: 400,
				body: { error: "invalid_grant" },
			},
		]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.auth);
		expect(errorCode(ctx)).toBe("session_expired");
	});

	test("is not sent to a different endpoint", async () => {
		seedGrant();
		const ctx = createTestContext({ env: { RELOOP_CONFIG_DIR: temp.dir } });

		expect(
			await run(["contacts", "list", "--endpoint", "https://other.test"], ctx),
		).toBe(ExitCode.auth);
		expect(errorCode(ctx)).toBe("not_authenticated");
	});

	test("auth status reports the signed-in user and organization", async () => {
		seedGrant();
		const api = mockApi([
			{
				method: "GET",
				path: "/api/api-key/v1/",
				body: { apiKeys: [], total: 0 },
			},
		]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["auth", "status"], ctx)).toBe(ExitCode.success);
		expect(ctx.stdoutJson()).toMatchObject({
			method: "oauth",
			apiKey: null,
			user: "luna@example.com",
			organizationId: "org_1",
			verified: true,
		});
	});

	test("logout revokes the refresh token and clears the session", async () => {
		seedGrant();
		const api = mockApi([
			{ method: "POST", path: "/api/auth/v1/oauth2/revoke", body: {} },
		]);
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: api.fetch,
		});

		expect(await run(["logout"], ctx)).toBe(ExitCode.success);
		expect(api.calls[0]?.body).toEqual({
			token: "refresh_1",
			token_type_hint: "refresh_token",
			client_id: CLIENT_ID,
		});
		expect(stored().profiles.default).toEqual({ endpoint: ENDPOINT });
	});

	test("logout still clears the session when revocation fails", async () => {
		seedGrant();
		const ctx = createTestContext({
			env: { RELOOP_CONFIG_DIR: temp.dir },
			fetch: () => Promise.reject(new Error("ECONNREFUSED")),
		});

		expect(await run(["logout"], ctx)).toBe(ExitCode.success);
		expect(stored().profiles.default).toEqual({ endpoint: ENDPOINT });
	});
});
