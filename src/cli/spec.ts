import type { CliContext } from "@/cli/context";
import type { Flags } from "@/cli/flags";
import type { ResolvedGlobals } from "@/cli/globals";
import type { Output } from "@/output/output";

export type FlagKind = "string" | "boolean" | "number" | "list";

export type FlagSpec = {
	name: string;
	short?: string;
	kind: FlagKind;
	summary: string;
	placeholder?: string;
	choices?: readonly string[];
	defaultValue?: string | number | boolean;
	hidden?: boolean;
};

export type ArgSpec = {
	name: string;
	summary: string;
	required?: boolean;
	variadic?: boolean;
};

export type CommandInput = {
	ctx: CliContext;
	root: Command;
	globals: ResolvedGlobals;
	output: Output;
	args: string[];
	flags: Flags;
	path: string[];
};

export type Command = {
	name: string;
	aliases?: string[];
	summary: string;
	description?: string;
	args?: ArgSpec[];
	flags?: FlagSpec[];
	examples?: string[];
	errorCodes?: string[];
	commands?: Command[];
	run?: (input: CommandInput) => Promise<void>;
};

export function findSubcommand(
	parent: Command,
	token: string,
): Command | undefined {
	return parent.commands?.find(
		(command) => command.name === token || command.aliases?.includes(token),
	);
}

export function commandNames(parent: Command): string[] {
	const names: string[] = [];
	for (const command of parent.commands ?? []) {
		names.push(command.name, ...(command.aliases ?? []));
	}
	return names;
}
