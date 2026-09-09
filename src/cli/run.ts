import { type CliContext, isInteractive } from "@/cli/context";
import { parseFlags } from "@/cli/flags";
import { DEFAULT_TIMEOUT_MS, globalFlags, resolveGlobals } from "@/cli/globals";
import { renderHelp } from "@/cli/help";
import { type Command, commandNames, findSubcommand } from "@/cli/spec";
import { closest } from "@/cli/suggest";
import { rootCommand } from "@/commands/root";
import { ExitCode, toCliError, usageError } from "@/errors/cli-error";
import { Output } from "@/output/output";
import { refusingPrompter } from "@/prompts/refusing";
import { VERSION } from "@/version";

type Resolution = {
	command: Command;
	path: string[];
	rest: string[];
};

function resolveCommand(root: Command, argv: readonly string[]): Resolution {
	let command = root;
	const path = [root.name];
	let index = 0;

	while (index < argv.length) {
		const token = argv[index];
		if (token === undefined || token.startsWith("-")) {
			break;
		}
		const next = findSubcommand(command, token);
		if (!next) {
			break;
		}
		command = next;
		path.push(next.name);
		index += 1;
	}

	return { command, path, rest: argv.slice(index) };
}

function assertKnownSubcommand(resolution: Resolution): void {
	const { command, rest } = resolution;
	const token = rest[0];
	if (
		token === undefined ||
		token.startsWith("-") ||
		!command.commands ||
		command.commands.length === 0
	) {
		return;
	}

	const parent = ["reloop", ...resolution.path.slice(1)].join(" ");
	const suggestion = closest(token, commandNames(command));
	throw usageError(
		`Unknown command "${[...resolution.path.slice(1), token].join(" ")}".`,
		{
			code: "unknown_command",
			fix: suggestion
				? `Did you mean "${suggestion}"?`
				: `Run \`${parent} --help\` to list commands.`,
		},
	);
}

function assignArguments(command: Command, positionals: string[]): string[] {
	const specs = command.args ?? [];
	const variadic = specs.some((spec) => spec.variadic);

	for (let index = 0; index < specs.length; index++) {
		const spec = specs[index];
		if (spec?.required && positionals[index] === undefined) {
			throw usageError(`Missing required argument <${spec.name}>.`, {
				code: "missing_argument",
				fix: `Run \`reloop ${command.name} --help\` for usage.`,
			});
		}
	}

	if (!variadic && positionals.length > specs.length) {
		throw usageError(`Unexpected argument "${positionals[specs.length]}".`);
	}

	return positionals;
}

export async function run(
	argv: readonly string[],
	ctx: CliContext,
): Promise<number> {
	let output = new Output(ctx, {
		json: false,
		quiet: false,
		debug: false,
		timeoutMs: DEFAULT_TIMEOUT_MS,
	});

	try {
		const resolution = resolveCommand(rootCommand, argv);
		const { command, path } = resolution;
		const specs = [...(command.flags ?? []), ...globalFlags];
		const { flags, positionals } = parseFlags(resolution.rest, specs);
		const globals = resolveGlobals(flags);
		output = new Output(ctx, globals);

		assertKnownSubcommand(resolution);

		if (flags.bool("help")) {
			output.print(renderHelp(command, path, output.style));
			return ExitCode.success;
		}

		if (command === rootCommand && flags.bool("version")) {
			output.print(VERSION);
			return ExitCode.success;
		}

		if (!command.run) {
			output.print(renderHelp(command, path, output.style));
			return ExitCode.success;
		}

		const args = assignArguments(command, positionals);
		const effective: CliContext = isInteractive(ctx)
			? ctx
			: { ...ctx, prompter: refusingPrompter };

		await command.run({
			ctx: effective,
			root: rootCommand,
			globals,
			output,
			args,
			flags,
			path,
		});
		return ExitCode.success;
	} catch (cause) {
		const error = toCliError(cause);
		output.fail(error);
		return error.exitCode;
	}
}
