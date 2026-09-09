import type { Command } from "@/cli/spec";
import { createContactCommand } from "@/commands/contacts/create";
import { deleteContactCommand } from "@/commands/contacts/delete";
import { getContactCommand } from "@/commands/contacts/get";
import { listContactsCommand } from "@/commands/contacts/list";
import { updateContactCommand } from "@/commands/contacts/update";

export const contactsCommand: Command = {
	name: "contacts",
	summary: "Create, inspect, and manage contacts",
	description:
		"Contacts belong to the organization that owns the API key. Commands that take a contact accept either its ID or its email address.",
	commands: [
		listContactsCommand,
		createContactCommand,
		getContactCommand,
		updateContactCommand,
		deleteContactCommand,
	],
	examples: [
		"reloop contacts list --limit 10",
		"reloop contacts create --email luna@example.com --first-name Luna",
		"reloop contacts get luna@example.com --json",
	],
};
