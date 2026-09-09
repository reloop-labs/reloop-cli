export type Writer = {
	write(chunk: string): unknown;
};

export type Env = Record<string, string | undefined>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Terminal = {
	stdinIsTty: boolean;
	stdoutIsTty: boolean;
	stderrIsTty: boolean;
	columns?: number;
};

export type TextPrompt = {
	message: string;
	placeholder?: string;
	defaultValue?: string;
	validate?: (value: string) => string | undefined;
};

export type SecretPrompt = {
	message: string;
	validate?: (value: string) => string | undefined;
};

export type ConfirmPrompt = {
	message: string;
	defaultValue?: boolean;
};

export type Prompter = {
	text(prompt: TextPrompt): Promise<string>;
	secret(prompt: SecretPrompt): Promise<string>;
	confirm(prompt: ConfirmPrompt): Promise<boolean>;
};

export type CliContext = {
	stdout: Writer;
	stderr: Writer;
	env: Env;
	fetch: FetchLike;
	terminal: Terminal;
	prompter: Prompter;
};

export function isInteractive(ctx: CliContext): boolean {
	if (!ctx.terminal.stdinIsTty || !ctx.terminal.stdoutIsTty) {
		return false;
	}
	const { CI, GITHUB_ACTIONS, TERM, RELOOP_NO_PROMPT } = ctx.env;
	if (CI && CI !== "false" && CI !== "0") {
		return false;
	}
	if (GITHUB_ACTIONS) {
		return false;
	}
	if (TERM === "dumb") {
		return false;
	}
	if (RELOOP_NO_PROMPT && RELOOP_NO_PROMPT !== "0") {
		return false;
	}
	return true;
}
