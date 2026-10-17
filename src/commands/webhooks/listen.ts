import type { ListenDelivery, ListenReady, ListenResult } from "@/api/types";
import type { CliContext } from "@/cli/context";
import { createSession } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { CliError, ExitCode, usageError } from "@/errors/cli-error";
import type { Output } from "@/output/output";

const FORWARD_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_MAX_CHARS = 8_192;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Headers the local fetch computes itself. */
const DROPPED_HEADERS = new Set(["host", "content-length", "connection"]);

/** Accepts `3000`, `localhost:3000/hook`, or a full http(s) URL. */
export function normalizeForwardUrl(raw: string): string {
	const trimmed = raw.trim();
	const withHost = /^:?\d+(\/|$)/.test(trimmed)
		? `localhost:${trimmed.replace(/^:/, "")}`
		: trimmed;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(withHost)
		? withHost
		: `http://${withHost}`;

	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw usageError(`"${raw}" is not a valid URL.`, {
			code: "invalid_forward_url",
			fix: "Pass a URL such as http://localhost:3000/webhooks, or just a port.",
		});
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw usageError(`--forward-to must be an http(s) URL, got "${raw}".`, {
			code: "invalid_forward_url",
		});
	}
	return url.toString();
}

async function forward(
	ctx: CliContext,
	url: string,
	delivery: ListenDelivery,
): Promise<ListenResult> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(delivery.headers)) {
		if (!DROPPED_HEADERS.has(name.toLowerCase())) {
			headers[name] = value;
		}
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
	const startedAt = Date.now();
	try {
		const response = await ctx.fetch(url, {
			method: "POST",
			headers,
			body: delivery.rawBody,
			signal: controller.signal,
		});
		const body = await response.text();
		return {
			deliveryId: delivery.deliveryId,
			status: response.status,
			body: body.slice(0, RESPONSE_BODY_MAX_CHARS),
			durationMs: Date.now() - startedAt,
			error: null,
		};
	} catch (cause) {
		const reason = controller.signal.aborted
			? `timed out after ${FORWARD_TIMEOUT_MS / 1000}s`
			: describeFetchError(cause);
		return {
			deliveryId: delivery.deliveryId,
			status: null,
			body: null,
			durationMs: Date.now() - startedAt,
			error: `Could not reach ${url}: ${reason}`,
		};
	} finally {
		clearTimeout(timer);
	}
}

function describeFetchError(cause: unknown): string {
	if (!(cause instanceof Error)) {
		return String(cause);
	}
	// Node's fetch wraps the socket error ("fetch failed" -> ECONNREFUSED).
	const inner = (
		cause as Error & { cause?: { code?: string; message?: string } }
	).cause;
	return inner?.code ?? inner?.message ?? cause.message;
}

function renderLine(
	output: Output,
	delivery: ListenDelivery,
	url: string,
	result: ListenResult,
): string {
	const { style } = output;
	const time = new Date().toTimeString().slice(0, 8);
	const outcome =
		result.status === null
			? style.red(result.error ?? "failed")
			: result.status >= 200 && result.status < 300
				? style.green(`[${result.status}]`)
				: style.red(`[${result.status}]`);
	return `${style.dim(time)}  ${delivery.eventType}  ${style.dim("→")}  POST ${url}  ${outcome}  ${style.dim(`${result.durationMs}ms`)}`;
}

function isRetryable(error: unknown): boolean {
	if (!(error instanceof CliError)) {
		return true;
	}
	return (
		error.exitCode === ExitCode.network ||
		(error.status !== undefined && error.status >= 500)
	);
}

export const listenWebhooksCommand: Command = {
	name: "listen",
	summary: "Forward webhook events to a local server",
	description:
		"Opens a connection to Reloop and forwards every webhook event sent to this listener to --forward-to, so you can test a server on localhost without exposing it to the internet.\n\nIn the dashboard, open a webhook's Test page and pick this listener as the target. Requests are signed with that webhook's secret, so your signature check runs unchanged. Press Ctrl-C to stop.",
	flags: [
		{
			name: "forward-to",
			short: "f",
			kind: "string",
			placeholder: "url",
			summary: "Local URL to POST events to (a bare port means localhost)",
		},
	],
	errorCodes: [
		"not_authenticated",
		"missing_option",
		"invalid_forward_url",
		"network_error",
	],
	examples: [
		"reloop webhooks listen --forward-to localhost:3000/webhooks",
		"reloop webhooks listen -f 8080",
		"reloop webhooks listen -f http://127.0.0.1:4000/hooks --json",
	],
	async run(input) {
		const raw = input.flags.str("forward-to");
		if (!raw) {
			throw usageError("Missing required option --forward-to.", {
				code: "missing_option",
				fix: "Pass the local URL to forward to, e.g. --forward-to localhost:3000/webhooks",
			});
		}
		const forwardTo = normalizeForwardUrl(raw);
		const { ctx, output } = input;
		const session = createSession(input);
		const signal = ctx.interrupt?.() ?? new AbortController().signal;
		const inFlight = new Set<Promise<void>>();

		const handle = async (sessionId: string, delivery: ListenDelivery) => {
			const result = await forward(ctx, forwardTo, delivery);
			if (output.json) {
				output.print(
					JSON.stringify({
						eventId: delivery.eventId,
						eventType: delivery.eventType,
						url: forwardTo,
						...result,
					}),
				);
			} else {
				output.print(renderLine(output, delivery, forwardTo, result));
			}
			try {
				await session.webhooks.reportResult(sessionId, result);
			} catch {
				output.warn("Could not report the result back to Reloop.");
			}
		};

		let failures = 0;
		while (!signal.aborted) {
			try {
				const events = await session.webhooks.listen(forwardTo, signal);
				let sessionId: string | undefined;
				for await (const event of events) {
					if (event.event === "ready") {
						const ready = JSON.parse(event.data) as ListenReady;
						sessionId = ready.sessionId;
						failures = 0;
						output.notice(
							`${output.style.green("Ready.")} Forwarding webhook events to ${output.style.bold(forwardTo)}`,
						);
						output.note(
							`Listener ${sessionId}. Pick it as the target on a webhook's Test page. Ctrl-C to stop.`,
						);
					} else if (event.event === "webhook" && sessionId) {
						const task = handle(
							sessionId,
							JSON.parse(event.data) as ListenDelivery,
						).finally(() => inFlight.delete(task));
						inFlight.add(task);
					}
				}
			} catch (error) {
				if (signal.aborted) {
					break;
				}
				if (!isRetryable(error)) {
					throw error;
				}
			}
			if (signal.aborted) {
				break;
			}

			failures += 1;
			const delayMs = Math.min(
				1000 * 2 ** (failures - 1),
				MAX_RECONNECT_DELAY_MS,
			);
			output.warn(
				`Connection to Reloop lost. Reconnecting in ${Math.round(delayMs / 1000)}s…`,
			);
			await ctx.sleep(delayMs);
		}

		await Promise.all(inFlight);
		output.note("Stopped listening.");
	},
};
