import { describe, expect, test } from "bun:test";
import { readSse } from "@/api/sse";
import { run } from "@/cli/run";
import { normalizeForwardUrl } from "@/commands/webhooks/listen";
import { ExitCode } from "@/errors/cli-error";
import { API_KEY, createTestContext, ENDPOINT } from "./helpers";

const env = { RELOOP_API_KEY: API_KEY };
const LOCAL = "http://localhost:3000/webhooks";

const delivery = {
	deliveryId: "wltd_1",
	eventId: "whev_test_1",
	eventType: "email.sent",
	headers: {
		"Content-Type": "application/json",
		"Reloop-Signature": "v1,abc",
		"Content-Length": "999",
	},
	rawBody: '{"id":"whev_test_1"}',
};

const encoder = new TextEncoder();

/** An SSE response that emits `chunks`, then stays open until the request aborts. */
function sseResponse(chunks: string[], signal?: AbortSignal | null): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			signal?.addEventListener("abort", () => controller.close());
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

type Call = { method: string; url: string; init?: RequestInit };

function setup(local: (init?: RequestInit) => Promise<Response>) {
	const interrupt = new AbortController();
	const calls: Call[] = [];
	const ctx = createTestContext({
		env,
		async fetch(url, init) {
			calls.push({ method: init?.method ?? "GET", url, init });
			const { pathname } = new URL(url);
			if (pathname === "/api/webhook/v1/listen/stream") {
				return sseResponse(
					[
						": ping\n\n",
						'event: ready\ndata: {"sessionId":"wls_1","heartbeatMs":15000}\n\n',
						`event: webhook\ndata: ${JSON.stringify(delivery)}\n\n`,
					],
					init?.signal,
				);
			}
			if (pathname === "/api/webhook/v1/listen/sessions/wls_1/results") {
				interrupt.abort();
				return Response.json({ received: true });
			}
			if (url === LOCAL) {
				return local(init);
			}
			throw new Error(`unexpected fetch ${url}`);
		},
	});
	ctx.interrupt = () => interrupt.signal;
	return { ctx, calls };
}

const listen = (ctx: ReturnType<typeof setup>["ctx"]) =>
	run(
		[
			"webhooks",
			"listen",
			"--forward-to",
			"localhost:3000/webhooks",
			"--endpoint",
			ENDPOINT,
		],
		ctx,
	);

describe("webhooks listen", () => {
	test("forwards the signed request and reports the result", async () => {
		const { ctx, calls } = setup(
			async () => new Response("ok", { status: 200 }),
		);

		expect(await listen(ctx)).toBe(ExitCode.success);

		const stream = calls[0];
		expect(stream?.url).toBe(
			`${ENDPOINT}/api/webhook/v1/listen/stream?forwardTo=${encodeURIComponent(LOCAL)}`,
		);
		const headers = stream?.init?.headers as Record<string, string>;
		expect(headers["x-api-key"] ?? headers.authorization).toBeTruthy();
		expect(headers.accept).toBe("text/event-stream");

		const local = calls.find((call) => call.url === LOCAL);
		expect(local?.init?.body).toBe(delivery.rawBody);
		expect(local?.init?.headers).toEqual({
			"Content-Type": "application/json",
			"Reloop-Signature": "v1,abc",
		});

		const report = calls.find((call) => call.url.endsWith("/results"));
		expect(JSON.parse(String(report?.init?.body))).toMatchObject({
			deliveryId: "wltd_1",
			status: 200,
			body: "ok",
			error: null,
		});

		const line = JSON.parse(ctx.stdoutText().trim());
		expect(line).toMatchObject({
			eventType: "email.sent",
			status: 200,
			url: LOCAL,
		});
		expect(ctx.stderrText()).toContain("Ready.");
	});

	test("reports an unreachable local server as an error, not a crash", async () => {
		const { ctx, calls } = setup(async () => {
			throw Object.assign(new TypeError("fetch failed"), {
				cause: { code: "ECONNREFUSED" },
			});
		});

		expect(await listen(ctx)).toBe(ExitCode.success);

		const report = calls.find((call) => call.url.endsWith("/results"));
		expect(JSON.parse(String(report?.init?.body))).toMatchObject({
			status: null,
			error: `Could not reach ${LOCAL}: ECONNREFUSED`,
		});
	});

	test("requires --forward-to", async () => {
		const ctx = createTestContext({ env });
		const code = await run(["webhooks", "listen", "--endpoint", ENDPOINT], ctx);
		expect(code).toBe(ExitCode.usage);
		expect(ctx.stderrText()).toContain("missing_option");
	});

	test("does not retry when the API rejects the credential", async () => {
		const ctx = createTestContext({
			env,
			fetch: async () =>
				Response.json({ message: "Authentication required" }, { status: 401 }),
		});
		ctx.interrupt = () => new AbortController().signal;
		const code = await run(
			["webhooks", "listen", "-f", "3000", "--endpoint", ENDPOINT],
			ctx,
		);
		expect(code).toBe(ExitCode.auth);
	});
});

describe("normalizeForwardUrl", () => {
	test.each([
		["3000", "http://localhost:3000/"],
		[":8080/hooks", "http://localhost:8080/hooks"],
		["localhost:3000/webhooks", "http://localhost:3000/webhooks"],
		["https://dev.example.com/hook", "https://dev.example.com/hook"],
	])("%s -> %s", (input, expected) => {
		expect(normalizeForwardUrl(input)).toBe(expected);
	});

	test("rejects non-http schemes", () => {
		expect(() => normalizeForwardUrl("ftp://example.com")).toThrow();
	});
});

describe("readSse", () => {
	test("parses events split across chunks and skips comments", async () => {
		const events = [];
		for await (const event of readSse(
			sseResponse([
				"event: a\nda",
				"ta: 1\n\n: hb\n\r\n",
				"data: x\ndata: y\n\n",
			]).body as ReadableStream<Uint8Array>,
		)) {
			events.push(event);
			if (events.length === 2) break;
		}
		expect(events).toEqual([
			{ event: "a", data: "1" },
			{ event: "message", data: "x\ny" },
		]);
	});
});
