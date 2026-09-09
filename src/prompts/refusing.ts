import type { Prompter } from "@/cli/context";
import { CliError, ExitCode } from "@/errors/cli-error";

function nonInteractive(): CliError {
	return new CliError({
		code: "not_interactive",
		message: "This command needs input that was not provided.",
		exitCode: ExitCode.usage,
		why: "Standard input or output is not an interactive terminal, so the CLI will not prompt.",
		fix: "Pass the missing values as flags.",
	});
}

export const refusingPrompter: Prompter = {
	text: () => Promise.reject(nonInteractive()),
	secret: () => Promise.reject(nonInteractive()),
	confirm: () => Promise.reject(nonInteractive()),
};
