import { describe, expect, test } from "bun:test";
import { normalizeEndpoint, ReloopApiClient } from "@/api/client";
import { CliError } from "@/errors/cli-error";
import { USER_AGENT } from "@/version";
import { API_KEY, ENDPOINT, mockApi } from "./helpers";

function client(
	api: ReturnType<typeof mockApi>,
	options: { timeoutMs?: number; debug?: (line: string) => void } = {},
): ReloopApiClient {
	return new ReloopApiClient({
		endpoint: ENDPOINT,
		apiKey: API_KEY,
		fetch: api.fetch,
		timeoutMs: options.timeoutMs ?? 5_000,
		...(options.debug ? { debug: options.debug } : {}),
	});
}

describe("ReloopApiClient", () => {
	test("normalizes trailing slashes on the endpoint", () => {
		expect(normalizeEndpoint("https://mail.example.com//")).toBe(
			"https://mail.example.com",
		);
	});

	test("sends the API key, an explicit User-Agent, and a JSON accept header", async () => {
		const api = mockApi([
			{ method: "GET", path: "/api/contacts/list", body: {} },
		]);
		await client(api).request({ method: "GET", path: "/api/contacts/list" });

		const call = api.calls[0];
		expect(call?.headers["x-api-key"]).toBe(API_KEY);
		expect(call?.headers["user-agent"]).toBe(USER_AGENT);
		expect(call?.headers.accept).toBe("application/json");
		expect(call?.headers["content-type"]).toBeUndefined();
	});

	test("serializes the body and sets a content type for writes", async () => {
		const api = mockApi([
			{ method: "POST", path: "/api/contacts/create", status: 201, body: {} },
		]);
		await client(api).request({
			method: "POST",
			path: "/api/contacts/create",
			body: { email: "luna@example.com" },
		});

		expect(api.calls[0]?.body).toEqual({ email: "luna@example.com" });
		expect(api.calls[0]?.headers["content-type"]).toBe("application/json");
	});

	test("drops undefined query parameters", async () => {
		const api = mockApi([
			{ method: "GET", path: "/api/contacts/list", body: {} },
		]);
		await client(api).request({
			method: "GET",
			path: "/api/contacts/list",
			query: { page: 2, search: undefined, limit: 10 },
		});

		expect(api.calls[0]?.url).toBe(
			`${ENDPOINT}/api/contacts/list?page=2&limit=10`,
		);
	});

	test("maps API error envelopes onto CLI errors", async () => {
		const api = mockApi([
			{
				method: "GET",
				path: "/api/contacts/list",
				status: 404,
				body: {
					message: "Contact not found",
					why: "gone",
					fix: "check the id",
				},
			},
		]);

		const error = (await client(api)
			.request({
				method: "GET",
				path: "/api/contacts/list",
				codes: { 404: "contact_not_found" },
			})
			.catch((cause) => cause)) as CliError;

		expect(error).toBeInstanceOf(CliError);
		expect(error.code).toBe("contact_not_found");
		expect(error.exitCode).toBe(4);
		expect(error.status).toBe(404);
		expect(error.why).toBe("gone");
	});

	test("surfaces retry-after on rate limits", async () => {
		const api = mockApi([
			{
				method: "GET",
				path: "/api/contacts/list",
				status: 429,
				body: { message: "Too many requests" },
				headers: { "retry-after": "30" },
			},
		]);

		const error = (await client(api)
			.request({ method: "GET", path: "/api/contacts/list" })
			.catch((cause) => cause)) as CliError;

		expect(error.code).toBe("rate_limited");
		expect(error.exitCode).toBe(7);
		expect(error.details?.retryAfter).toBe(30);
	});

	test("turns transport failures into network errors", async () => {
		const error = (await new ReloopApiClient({
			endpoint: ENDPOINT,
			apiKey: API_KEY,
			timeoutMs: 1_000,
			fetch: () => Promise.reject(new Error("ECONNREFUSED")),
		})
			.request({ method: "GET", path: "/api/contacts/list" })
			.catch((cause) => cause)) as CliError;

		expect(error.code).toBe("network_error");
		expect(error.exitCode).toBe(8);
		expect(error.why).toBe("ECONNREFUSED");
	});

	test("aborts slow requests once the timeout elapses", async () => {
		const api = mockApi([
			{ method: "GET", path: "/api/contacts/list", body: {}, delayMs: 200 },
		]);

		const error = (await client(api, { timeoutMs: 20 })
			.request({ method: "GET", path: "/api/contacts/list" })
			.catch((cause) => cause)) as CliError;

		expect(error.code).toBe("timeout");
		expect(error.exitCode).toBe(8);
	});

	test("never writes the API key into debug output", async () => {
		const lines: string[] = [];
		const api = mockApi([
			{ method: "GET", path: "/api/contacts/list", body: {} },
		]);
		await client(api, { debug: (line) => lines.push(line) }).request({
			method: "GET",
			path: "/api/contacts/list",
		});

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join("\n")).not.toContain(API_KEY);
	});

	test("reports a non-JSON success body instead of crashing", async () => {
		const error = (await new ReloopApiClient({
			endpoint: ENDPOINT,
			apiKey: API_KEY,
			timeoutMs: 1_000,
			fetch: async () => new Response("<html>login</html>", { status: 200 }),
		})
			.request({ method: "GET", path: "/api/contacts/list" })
			.catch((cause) => cause)) as CliError;

		expect(error.code).toBe("malformed_response");
	});
});
