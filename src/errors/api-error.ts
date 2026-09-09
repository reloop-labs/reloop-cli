import { CliError, ExitCode, type ExitCodeValue } from "@/errors/cli-error";

export type ApiErrorBody = {
	message?: unknown;
	why?: unknown;
	fix?: unknown;
	link?: unknown;
	errors?: unknown;
};

export type ErrorCodeMap = Partial<Record<number, string>>;

const DEFAULT_CODES: ErrorCodeMap = {
	400: "validation_error",
	401: "not_authenticated",
	403: "forbidden",
	404: "not_found",
	409: "already_exists",
	422: "validation_error",
	429: "rate_limited",
};

const EXIT_CODES: Partial<Record<number, ExitCodeValue>> = {
	400: ExitCode.validation,
	401: ExitCode.auth,
	403: ExitCode.auth,
	404: ExitCode.notFound,
	409: ExitCode.conflict,
	422: ExitCode.validation,
	429: ExitCode.rateLimited,
};

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fieldErrors(
	value: unknown,
): Array<{ field: string; message: string }> {
	if (!Array.isArray(value)) {
		return [];
	}
	const parsed: Array<{ field: string; message: string }> = [];
	for (const entry of value) {
		if (entry === null || typeof entry !== "object") {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const field = text(record.field);
		const message = text(record.message);
		if (field && message) {
			parsed.push({ field, message });
		}
	}
	return parsed;
}

export function apiErrorFromResponse(options: {
	status: number;
	body: ApiErrorBody;
	headers: Headers;
	codes?: ErrorCodeMap;
}): CliError {
	const { status, body, headers } = options;
	const code =
		options.codes?.[status] ??
		DEFAULT_CODES[status] ??
		(status >= 500 ? "server_error" : "api_error");
	const exitCode =
		EXIT_CODES[status] ?? (status >= 500 ? ExitCode.failure : ExitCode.failure);

	const details: Record<string, unknown> = {};
	const fields = fieldErrors(body.errors);
	if (fields.length > 0) {
		details.fields = fields;
	}
	if (status === 429) {
		const retryAfter = headers.get("retry-after");
		if (retryAfter) {
			details.retryAfter = Number(retryAfter);
		}
	}
	const link = text(body.link);
	if (link) {
		details.link = link;
	}

	return new CliError({
		code,
		message: text(body.message) ?? `Reloop API returned HTTP ${status}.`,
		exitCode,
		status,
		why: text(body.why),
		fix: text(body.fix) ?? fallbackFix(status),
		details: Object.keys(details).length > 0 ? details : undefined,
	});
}

function fallbackFix(status: number): string | undefined {
	if (status === 401 || status === 403) {
		return "Check the credential with `reloop auth status`, or run `reloop login` again.";
	}
	if (status === 429) {
		return "Wait for the window in the retry-after header to elapse, then retry.";
	}
	if (status >= 500) {
		return "Retry shortly. If it persists, check the Reloop instance logs or status page.";
	}
	return undefined;
}

export function networkError(endpoint: string, cause: unknown): CliError {
	return new CliError({
		code: "network_error",
		message: `Could not reach Reloop at ${endpoint}.`,
		exitCode: ExitCode.network,
		why: cause instanceof Error ? cause.message : String(cause),
		fix: "Check the endpoint, your network connection, and that the Reloop instance is running.",
	});
}

export function timeoutError(endpoint: string, timeoutMs: number): CliError {
	return new CliError({
		code: "timeout",
		message: `Request to ${endpoint} timed out after ${timeoutMs}ms.`,
		exitCode: ExitCode.network,
		fix: "Raise the limit with --timeout, or check that the Reloop instance is responsive.",
	});
}

export function malformedResponseError(status: number): CliError {
	return new CliError({
		code: "malformed_response",
		message: `Reloop returned a non-JSON response (HTTP ${status}).`,
		exitCode: ExitCode.failure,
		fix: "Verify --endpoint points at a Reloop instance and not a proxy or login page.",
	});
}
