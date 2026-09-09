export const ExitCode = {
	success: 0,
	failure: 1,
	usage: 2,
	auth: 3,
	notFound: 4,
	conflict: 5,
	validation: 6,
	rateLimited: 7,
	network: 8,
	cancelled: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type CliErrorOptions = {
	code: string;
	message: string;
	exitCode: ExitCodeValue;
	why?: string;
	fix?: string;
	status?: number;
	details?: Record<string, unknown>;
};

export class CliError extends Error {
	readonly code: string;
	readonly exitCode: ExitCodeValue;
	readonly why?: string;
	readonly fix?: string;
	readonly status?: number;
	readonly details?: Record<string, unknown>;

	constructor(options: CliErrorOptions) {
		super(options.message);
		this.name = "CliError";
		this.code = options.code;
		this.exitCode = options.exitCode;
		this.why = options.why;
		this.fix = options.fix;
		this.status = options.status;
		this.details = options.details;
	}
}

export function usageError(
	message: string,
	extra: { code?: string; fix?: string } = {},
): CliError {
	return new CliError({
		code: extra.code ?? "usage_error",
		message,
		exitCode: ExitCode.usage,
		fix: extra.fix,
	});
}

export function configError(message: string, fix?: string): CliError {
	return new CliError({
		code: "config_error",
		message,
		exitCode: ExitCode.failure,
		fix,
	});
}

export function cancelledError(): CliError {
	return new CliError({
		code: "cancelled",
		message: "Cancelled.",
		exitCode: ExitCode.cancelled,
	});
}

export function isCliError(value: unknown): value is CliError {
	return value instanceof CliError;
}

export function toCliError(value: unknown): CliError {
	if (isCliError(value)) {
		return value;
	}
	return new CliError({
		code: "unexpected_error",
		message: value instanceof Error ? value.message : String(value),
		exitCode: ExitCode.failure,
	});
}
