import type { Flags } from "@/cli/flags";
import type { FlagSpec } from "@/cli/spec";
import { usageError } from "@/errors/cli-error";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const globalFlags: FlagSpec[] = [
	{
		name: "help",
		short: "h",
		kind: "boolean",
		summary: "Show help for this command",
	},
	{
		name: "json",
		kind: "boolean",
		summary: "Force JSON output (default when stdout is not a terminal)",
	},
	{
		name: "quiet",
		short: "q",
		kind: "boolean",
		summary: "Suppress progress and hints on stderr (implies --json)",
	},
	{
		name: "profile",
		short: "p",
		kind: "string",
		placeholder: "name",
		summary: "Stored profile to use (overrides RELOOP_PROFILE)",
	},
	{
		name: "api-key",
		kind: "string",
		placeholder: "key",
		summary: "Reloop API key (overrides RELOOP_API_KEY and the profile)",
	},
	{
		name: "endpoint",
		kind: "string",
		placeholder: "url",
		summary: "Reloop base URL for self-hosted installs",
	},
	{
		name: "timeout",
		kind: "number",
		placeholder: "ms",
		summary: `Request timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS})`,
	},
	{
		name: "debug",
		kind: "boolean",
		summary: "Print request diagnostics to stderr",
	},
];

export type ResolvedGlobals = {
	json: boolean;
	quiet: boolean;
	debug: boolean;
	timeoutMs: number;
	profile?: string;
	apiKey?: string;
	endpoint?: string;
};

export function resolveGlobals(flags: Flags): ResolvedGlobals {
	const timeoutMs = flags.num("timeout") ?? DEFAULT_TIMEOUT_MS;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
		throw usageError(
			"--timeout must be a positive integer number of milliseconds.",
		);
	}

	const quiet = flags.bool("quiet");

	return {
		json: flags.bool("json") || quiet,
		quiet,
		debug: flags.bool("debug"),
		timeoutMs,
		profile: flags.str("profile"),
		apiKey: flags.str("api-key"),
		endpoint: flags.str("endpoint"),
	};
}
