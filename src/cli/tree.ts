import { globalFlags } from "@/cli/globals";
import type { Command, FlagSpec } from "@/cli/spec";
import { BIN_NAME, VERSION } from "@/version";

type SerializedFlag = {
	name: string;
	short?: string;
	kind: FlagSpec["kind"];
	summary: string;
	choices?: readonly string[];
	default?: string | number | boolean;
};

type SerializedCommand = {
	name: string;
	path: string;
	summary: string;
	description?: string;
	aliases: string[];
	arguments: Array<{
		name: string;
		summary: string;
		required: boolean;
		variadic: boolean;
	}>;
	flags: SerializedFlag[];
	errorCodes: string[];
	examples: string[];
	commands: SerializedCommand[];
};

function serializeFlag(flag: FlagSpec): SerializedFlag {
	return {
		name: flag.name,
		...(flag.short !== undefined ? { short: flag.short } : {}),
		kind: flag.kind,
		summary: flag.summary,
		...(flag.choices !== undefined ? { choices: flag.choices } : {}),
		...(flag.defaultValue !== undefined ? { default: flag.defaultValue } : {}),
	};
}

function serializeCommand(command: Command, path: string[]): SerializedCommand {
	const fullPath = [...path, command.name];
	return {
		name: command.name,
		path: [BIN_NAME, ...fullPath.slice(1)].join(" "),
		summary: command.summary,
		...(command.description !== undefined
			? { description: command.description }
			: {}),
		aliases: command.aliases ?? [],
		arguments: (command.args ?? []).map((arg) => ({
			name: arg.name,
			summary: arg.summary,
			required: arg.required === true,
			variadic: arg.variadic === true,
		})),
		flags: (command.flags ?? [])
			.filter((flag) => !flag.hidden)
			.map(serializeFlag),
		errorCodes: command.errorCodes ?? [],
		examples: command.examples ?? [],
		commands: (command.commands ?? []).map((child) =>
			serializeCommand(child, fullPath),
		),
	};
}

export function serializeTree(root: Command): {
	name: string;
	version: string;
	globalFlags: SerializedFlag[];
	commands: SerializedCommand[];
} {
	return {
		name: BIN_NAME,
		version: VERSION,
		globalFlags: globalFlags.filter((flag) => !flag.hidden).map(serializeFlag),
		commands: (root.commands ?? []).map((child) =>
			serializeCommand(child, [root.name]),
		),
	};
}
