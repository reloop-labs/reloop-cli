import type { ContactProperties, UpdateContactInput } from "@/api/types";
import { createSession } from "@/cli/session";
import type { Command } from "@/cli/spec";
import {
	asStatus,
	assertPropertyKey,
	contactArg,
	parsePropertiesJson,
	parsePropertyPairs,
	propertiesFlag,
	propertyFlag,
	renderContactDetail,
	requireEmail,
	statusFlag,
	UPDATE_PROPERTY_KEY,
} from "@/commands/contacts/shared";
import { usageError } from "@/errors/cli-error";

export const updateContactCommand: Command = {
	name: "update",
	summary: "Update a contact",
	description:
		"Only the fields you pass are changed. --property and --unset-property merge into the contact's existing properties; --properties replaces the whole property set, which is the raw API behaviour.",
	args: [contactArg],
	flags: [
		{
			name: "email",
			kind: "string",
			placeholder: "address",
			summary: "New email address",
		},
		{
			name: "first-name",
			kind: "string",
			placeholder: "name",
			summary: "New first name",
		},
		{
			name: "last-name",
			kind: "string",
			placeholder: "name",
			summary: "New last name",
		},
		{ ...statusFlag, summary: "New subscription status" },
		{
			...propertyFlag,
			summary: "Set a property, keeping the others (repeatable)",
		},
		{
			name: "unset-property",
			kind: "list",
			placeholder: "key",
			summary: "Remove a property, keeping the others (repeatable)",
		},
		{
			...propertiesFlag,
			summary: "Replace every property with this JSON object",
		},
	],
	errorCodes: [
		"not_authenticated",
		"contact_not_found",
		"nothing_to_update",
		"conflicting_options",
		"invalid_property",
		"validation_error",
	],
	examples: [
		"reloop contacts update luna@example.com --status unsubscribed",
		"reloop contacts update luna@example.com --property plan=pro",
		"reloop contacts update con_123456789 --unset-property plan --json",
	],
	async run(input) {
		const { flags, output } = input;
		const reference = input.args[0] ?? "";

		const replacement = parsePropertiesJson(
			flags.str("properties"),
			UPDATE_PROPERTY_KEY,
		);
		const additions = parsePropertyPairs(
			flags.list("property"),
			UPDATE_PROPERTY_KEY,
		);
		const removals = flags.list("unset-property");
		for (const key of removals) {
			assertPropertyKey(key, UPDATE_PROPERTY_KEY);
		}

		const merging = Object.keys(additions).length > 0 || removals.length > 0;
		if (replacement !== undefined && merging) {
			throw usageError(
				"--properties cannot be combined with --property or --unset-property.",
				{
					code: "conflicting_options",
					fix: "Use --properties to replace every property, or --property/--unset-property to change individual ones.",
				},
			);
		}

		const email = flags.str("email");
		const body: UpdateContactInput = {
			...(email !== undefined ? { email: requireEmail(email, "--email") } : {}),
			...(flags.has("first-name")
				? { firstName: flags.str("first-name") }
				: {}),
			...(flags.has("last-name") ? { lastName: flags.str("last-name") } : {}),
			...(flags.str("status") ? { status: asStatus(flags.str("status")) } : {}),
		};

		if (
			Object.keys(body).length === 0 &&
			replacement === undefined &&
			!merging
		) {
			throw usageError("Nothing to update.", {
				code: "nothing_to_update",
				fix: "Pass at least one of --email, --first-name, --last-name, --status, --property, --unset-property, or --properties.",
			});
		}

		const session = createSession(input);
		const target = await session.contacts.resolveReference(reference);

		if (replacement !== undefined) {
			body.properties = replacement;
		} else if (merging) {
			const current =
				target.contact ?? (await session.contacts.retrieve(target.id));
			body.properties = mergeProperties(
				current.properties,
				additions,
				removals,
			);
		}

		const contact = await session.contacts.update(target.id, body);

		output.success(`Contact updated: ${contact.email}`);
		output.emit({ data: contact, render: renderContactDetail });
	},
};

function mergeProperties(
	current: ContactProperties,
	additions: ContactProperties,
	removals: readonly string[],
): ContactProperties {
	const merged: ContactProperties = { ...current, ...additions };
	for (const key of removals) {
		delete merged[key];
	}
	return merged;
}
