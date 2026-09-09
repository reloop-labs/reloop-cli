import { createSession } from "@/cli/session";
import type { Command } from "@/cli/spec";
import { contactArg, renderContactDetail } from "@/commands/contacts/shared";

export const getContactCommand: Command = {
	name: "get",
	summary: "Show a single contact",
	description:
		"Accepts a contact ID or an email address. An email is resolved with an exact, case-insensitive match against the contact list.",
	args: [contactArg],
	errorCodes: ["not_authenticated", "contact_not_found", "missing_argument"],
	examples: [
		"reloop contacts get luna@example.com",
		"reloop contacts get con_123456789 --json",
	],
	async run(input) {
		const reference = input.args[0] ?? "";
		const session = createSession(input);
		const contact = await session.contacts.resolve(reference);

		input.output.emit({ data: contact, render: renderContactDetail });
	},
};
