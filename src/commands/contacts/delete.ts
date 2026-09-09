import { isInteractive } from "@/cli/context";
import { createSession } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { contactArg } from "@/commands/contacts/shared";
import { CliError, ExitCode } from "@/errors/cli-error";

export const deleteContactCommand: Command = {
	name: "delete",
	aliases: ["rm"],
	summary: "Delete a contact",
	description:
		"Deleting a contact is permanent. In a terminal the CLI asks for confirmation; in scripts --yes is required.",
	args: [contactArg],
	flags: [
		{
			name: "yes",
			short: "y",
			kind: "boolean",
			summary: "Skip the confirmation prompt (required when not interactive)",
		},
	],
	errorCodes: [
		"not_authenticated",
		"contact_not_found",
		"confirmation_required",
		"cancelled",
	],
	examples: [
		"reloop contacts delete luna@example.com",
		"reloop contacts delete con_123456789 --yes --json",
	],
	async run(input) {
		const reference = input.args[0] ?? "";
		const session = createSession(input);
		const target = await session.contacts.resolveReference(reference);

		if (!input.flags.bool("yes")) {
			if (!isInteractive(input.ctx) || input.output.json) {
				throw new CliError({
					code: "confirmation_required",
					message: "Deleting a contact needs confirmation.",
					exitCode: ExitCode.usage,
					fix: "Pass --yes to confirm in a non-interactive environment.",
				});
			}
			const confirmed = await input.ctx.prompter.confirm({
				message: `Delete contact ${target.label}? This cannot be undone.`,
			});
			if (!confirmed) {
				throw new CliError({
					code: "cancelled",
					message: `The contact ${target.label} was not deleted.`,
					exitCode: ExitCode.cancelled,
				});
			}
		}

		const result = await session.contacts.remove(target.id);

		input.output.emit({
			data: result,
			render: (data) => `Deleted contact ${target.label} (${data.id})`,
		});
	},
};
