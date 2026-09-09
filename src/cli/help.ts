import { globalFlags } from "@/cli/globals";
import type { ArgSpec, Command, FlagSpec } from "@/cli/spec";
import type { Style } from "@/output/style";
import { BIN_NAME } from "@/version";

const INDENT = "  ";

function argToken(arg: ArgSpec): string {
	const inner = arg.variadic ? `${arg.name}...` : arg.name;
	return arg.required ? `<${inner}>` : `[${inner}]`;
}

function flagToken(flag: FlagSpec): string {
	const lead = flag.short
		? `-${flag.short}, --${flag.name}`
		: `    --${flag.name}`;
	if (flag.kind === "boolean") {
		return lead;
	}
	return `${lead} <${flag.placeholder ?? flag.kind}>`;
}

function definitions(
	entries: Array<{ term: string; description: string }>,
	style: Style,
): string[] {
	const width = Math.max(...entries.map((entry) => entry.term.length));
	return entries.map(
		(entry) =>
			`${INDENT}${entry.term.padEnd(width)}${INDENT}${style.dim(entry.description)}`,
	);
}

function section(title: string, body: string[], style: Style): string[] {
	if (body.length === 0) {
		return [];
	}
	return ["", style.bold(title), ...body];
}

export function usageLine(command: Command, path: string[]): string {
	const parts = [BIN_NAME, ...path.slice(1)];
	if (command.commands && command.commands.length > 0 && !command.run) {
		parts.push("<command>");
	}
	for (const arg of command.args ?? []) {
		parts.push(argToken(arg));
	}
	if ((command.flags ?? []).length > 0 || command.run) {
		parts.push("[options]");
	}
	return parts.join(" ");
}

export function renderHelp(
	command: Command,
	path: string[],
	style: Style,
): string {
	const heading = `${style.bold([BIN_NAME, ...path.slice(1)].join(" "))} — ${command.summary}`;
	const lines: string[] = [heading];

	if (command.description) {
		lines.push("", command.description);
	}

	lines.push(
		...section("Usage", [`${INDENT}${usageLine(command, path)}`], style),
	);

	const subcommands = (command.commands ?? []).filter(
		(entry) => !entry.name.startsWith("_"),
	);
	if (subcommands.length > 0) {
		lines.push(
			...section(
				"Commands",
				definitions(
					subcommands.map((entry) => ({
						term: entry.name,
						description: entry.summary,
					})),
					style,
				),
				style,
			),
		);
	}

	const args = command.args ?? [];
	if (args.length > 0) {
		lines.push(
			...section(
				"Arguments",
				definitions(
					args.map((arg) => ({
						term: argToken(arg),
						description: arg.summary,
					})),
					style,
				),
				style,
			),
		);
	}

	const flags = (command.flags ?? []).filter((flag) => !flag.hidden);
	if (flags.length > 0) {
		lines.push(
			...section(
				"Options",
				definitions(
					flags.map((flag) => ({
						term: flagToken(flag),
						description: flag.summary,
					})),
					style,
				),
				style,
			),
		);
	}

	lines.push(
		...section(
			"Global options",
			definitions(
				globalFlags
					.filter((flag) => !flag.hidden)
					.map((flag) => ({
						term: flagToken(flag),
						description: flag.summary,
					})),
				style,
			),
			style,
		),
	);

	if (command.errorCodes && command.errorCodes.length > 0) {
		lines.push(
			...section(
				"Error codes",
				[`${INDENT}${style.dim(command.errorCodes.join(", "))}`],
				style,
			),
		);
	}

	if (command.examples && command.examples.length > 0) {
		lines.push(
			...section(
				"Examples",
				command.examples.map((example) => `${INDENT}$ ${example}`),
				style,
			),
		);
	}

	return lines.join("\n");
}
