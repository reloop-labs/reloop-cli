import type { FetchLike } from "@/cli/context";
import {
	type ApiErrorBody,
	apiErrorFromResponse,
	type ErrorCodeMap,
	malformedResponseError,
	networkError,
	timeoutError,
} from "@/errors/api-error";
import { USER_AGENT } from "@/version";

export type QueryValue = string | number | boolean | undefined;

export type ApiRequest = {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	query?: Record<string, QueryValue>;
	body?: unknown;
	codes?: ErrorCodeMap;
};

export type ApiClientOptions = {
	endpoint: string;
	apiKey: string;
	fetch: FetchLike;
	timeoutMs: number;
	debug?: (line: string) => void;
};

const DIAGNOSTIC_HEADERS = [
	"content-type",
	"retry-after",
	"ratelimit-limit",
	"ratelimit-remaining",
	"ratelimit-reset",
	"traceparent",
];

export function normalizeEndpoint(endpoint: string): string {
	return endpoint.replace(/\/+$/, "");
}

function buildUrl(
	endpoint: string,
	path: string,
	query?: Record<string, QueryValue>,
): string {
	const url = `${normalizeEndpoint(endpoint)}${path}`;
	if (!query) {
		return url;
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) {
			params.set(key, String(value));
		}
	}
	const serialized = params.toString();
	return serialized ? `${url}?${serialized}` : url;
}

export class ReloopApiClient {
	readonly endpoint: string;
	readonly #apiKey: string;
	readonly #fetch: FetchLike;
	readonly #timeoutMs: number;
	readonly #debug?: (line: string) => void;

	constructor(options: ApiClientOptions) {
		this.endpoint = normalizeEndpoint(options.endpoint);
		this.#apiKey = options.apiKey;
		this.#fetch = options.fetch;
		this.#timeoutMs = options.timeoutMs;
		this.#debug = options.debug;
	}

	async request<T>(spec: ApiRequest): Promise<T> {
		const url = buildUrl(this.endpoint, spec.path, spec.query);
		const headers: Record<string, string> = {
			"x-api-key": this.#apiKey,
			accept: "application/json",
			"user-agent": USER_AGENT,
		};
		if (spec.body !== undefined) {
			headers["content-type"] = "application/json";
		}

		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.#timeoutMs);
		const startedAt = Date.now();

		this.#debug?.(`${spec.method} ${url}`);

		let response: Response;
		try {
			response = await this.#fetch(url, {
				method: spec.method,
				headers,
				signal: controller.signal,
				...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
			});
		} catch (cause) {
			if (timedOut) {
				throw timeoutError(this.endpoint, this.#timeoutMs);
			}
			throw networkError(this.endpoint, cause);
		} finally {
			clearTimeout(timer);
		}

		this.#logResponse(response, Date.now() - startedAt);

		if (response.status === 204) {
			return undefined as T;
		}

		const raw = await response.text();
		let parsed: unknown;
		try {
			parsed = raw.length > 0 ? JSON.parse(raw) : {};
		} catch {
			if (response.ok) {
				throw malformedResponseError(response.status);
			}
			parsed = {};
		}

		if (!response.ok) {
			throw apiErrorFromResponse({
				status: response.status,
				body: (parsed ?? {}) as ApiErrorBody,
				headers: response.headers,
				codes: spec.codes,
			});
		}

		return parsed as T;
	}

	#logResponse(response: Response, durationMs: number): void {
		if (!this.#debug) {
			return;
		}
		const parts = [`${response.status} in ${durationMs}ms`];
		for (const name of DIAGNOSTIC_HEADERS) {
			const value = response.headers.get(name);
			if (value) {
				parts.push(`${name}=${value}`);
			}
		}
		this.#debug(parts.join(" "));
	}
}
