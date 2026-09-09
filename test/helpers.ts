import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliContext, Env, Prompter, Terminal } from "@/cli/context";

export type RecordedCall = {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
};

export type Route = {
	method: string;
	path: string;
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
	delayMs?: number;
};

export type MockApi = {
	fetch: CliContext["fetch"];
	calls: RecordedCall[];
};

export function mockApi(routes: Route[]): MockApi {
	const calls: RecordedCall[] = [];
	const remaining = [...routes];

	return {
		calls,
		async fetch(url, init) {
			const method = init?.method ?? "GET";
			const parsed = new URL(url);
			const headers: Record<string, string> = {};
			for (const [key, value] of Object.entries(
				(init?.headers ?? {}) as Record<string, string>,
			)) {
				headers[key.toLowerCase()] = value;
			}
			calls.push({
				method,
				url,
				headers,
				...(typeof init?.body === "string"
					? { body: JSON.parse(init.body) }
					: {}),
			});

			const index = remaining.findIndex(
				(route) => route.method === method && route.path === parsed.pathname,
			);
			if (index === -1) {
				return new Response(JSON.stringify({ message: "Not found" }), {
					status: 404,
					headers: { "content-type": "application/json" },
				});
			}
			const route = remaining[index];
			if (route === undefined) {
				throw new Error("unreachable");
			}
			if (routes.filter((entry) => entry === route).length === 1) {
				remaining.splice(index, 1);
			}

			if (route.delayMs !== undefined) {
				await new Promise((resolve) => setTimeout(resolve, route.delayMs));
				if (init?.signal?.aborted) {
					throw new DOMException("aborted", "AbortError");
				}
			}

			return new Response(JSON.stringify(route.body ?? {}), {
				status: route.status ?? 200,
				headers: { "content-type": "application/json", ...route.headers },
			});
		},
	};
}

export function scriptedPrompter(answers: Array<string | boolean>): Prompter {
	const queue = [...answers];
	const next = (kind: string): string | boolean => {
		if (queue.length === 0) {
			throw new Error(`scriptedPrompter ran out of answers for ${kind}`);
		}
		return queue.shift() as string | boolean;
	};
	return {
		text: async () => String(next("text")),
		secret: async () => String(next("secret")),
		confirm: async () => next("confirm") === true,
	};
}

export type TestContext = CliContext & {
	stdoutText(): string;
	stderrText(): string;
	stdoutJson<T = unknown>(): T;
	stderrJson<T = unknown>(): T;
};

export function createTestContext(
	options: {
		env?: Env;
		fetch?: CliContext["fetch"];
		terminal?: Partial<Terminal>;
		prompter?: Prompter;
	} = {},
): TestContext {
	let out = "";
	let err = "";

	const terminal: Terminal = {
		stdinIsTty: false,
		stdoutIsTty: false,
		stderrIsTty: false,
		...options.terminal,
	};

	return {
		stdout: {
			write(chunk: string) {
				out += chunk;
			},
		},
		stderr: {
			write(chunk: string) {
				err += chunk;
			},
		},
		env: options.env ?? {},
		fetch:
			options.fetch ??
			(() => {
				throw new Error("fetch was not expected in this test");
			}),
		terminal,
		prompter: options.prompter ?? scriptedPrompter([]),
		stdoutText: () => out,
		stderrText: () => err,
		stdoutJson: <T>() => JSON.parse(out) as T,
		stderrJson: <T>() => JSON.parse(err) as T,
	};
}

export function withConfigDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "reloop-cli-test-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const API_KEY = "rl_prod_testkey1234567890abcdefg";
export const ENDPOINT = "http://reloop.test";

export function contactFixture(
	over: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		object: "contact",
		id: "con_123",
		email: "luna@example.com",
		firstName: "Luna",
		lastName: "Gurnee",
		status: "subscribed",
		properties: {},
		groups: [],
		channels: [],
		suppressionReason: null,
		suppressedAt: null,
		createdAt: "2026-09-08T10:00:00.000Z",
		updatedAt: "2026-09-08T10:00:00.000Z",
		...over,
	};
}

export function listFixture(
	contacts: Array<Record<string, unknown>>,
	over: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		object: "contact",
		contacts,
		total: contacts.length,
		page: 1,
		limit: 20,
		totalContacts: contacts.length,
		subscribedContacts: contacts.length,
		unsubscribedContacts: 0,
		event: "contact.list",
		...over,
	};
}
