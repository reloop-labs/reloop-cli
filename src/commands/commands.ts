import type { Command } from "@/cli/spec";
import { serializeTree } from "@/cli/tree";

export const commandsCommand: Command = {
	name: "commands",
	summary: "Print the full command tree as JSON",
	description:
		"Always writes JSON to stdout, in both interactive and machine modes, so agents and scripts can discover every command, flag, and error code without parsing help text.",
	examples: ["reloop commands", "reloop commands | jq -r '.commands[].path'"],
	async run(input) {
		input.output.emitJson(serializeTree(input.root));
	},
};
