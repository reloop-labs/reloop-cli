import type {
	ContactChannelInput,
	ContactProperties,
	CreateContactInput,
} from "@/api/types";
import { CHANNEL_SUBSCRIPTIONS, type ChannelSubscription } from "@/api/types";
import { isInteractive } from "@/cli/context";
import { createSession } from "@/cli/session";
import type { Command, CommandInput } from "@/cli/spec";
import {
	asStatus,
	EMAIL_PATTERN,
	PROPERTY_KEY,
	parsePropertiesJson,
	parsePropertyPairs,
	propertiesFlag,
	propertyFlag,
	renderContactDetail,
	requireEmail,
	statusFlag,
} from "@/commands/contacts/shared";
import { usageError } from "@/errors/cli-error";

export const createContactCommand: Command = {
	name: "create",
	summary: "Create a contact",
	description:
		"Run with no --email in a terminal and the CLI walks you through the fields. Pass --email and it runs exactly what you asked for with no prompts, so scripts and CI behave the same as a terminal.",
	flags: [
		{
			name: "email",
			kind: "string",
			placeholder: "address",
			summary: "Contact email address (required)",
		},
		{
			name: "first-name",
			kind: "string",
			placeholder: "name",
			summary: "First name",
		},
		{
			name: "last-name",
			kind: "string",
			placeholder: "name",
			summary: "Last name",
		},
		{ ...statusFlag, summary: "Subscription status (default subscribed)" },
		propertyFlag,
		propertiesFlag,
		{
			name: "group-id",
			kind: "list",
			placeholder: "id",
			summary: "Add the contact to this group (repeatable)",
		},
		{
			name: "channel",
			kind: "list",
			placeholder: "id[:opt_in|opt_out]",
			summary: "Enrol the contact in this channel (repeatable, default opt_in)",
		},
	],
	errorCodes: [
		"not_authenticated",
		"missing_email",
		"invalid_email",
		"invalid_property",
		"contact_already_exists",
		"validation_error",
	],
	examples: [
		"reloop contacts create --email luna@example.com --first-name Luna --last-name Gurnee",
		`reloop contacts create --email luna@example.com --property company=LunarLabs --property role=developer`,
		`reloop contacts create --email luna@example.com --properties '{"seats":5}' --json`,
	],
	async run(input) {
		const { flags, output } = input;
		const interactive = isInteractive(input.ctx) && !output.json;

		const guided = interactive && !flags.has("email");
		if (guided) {
			output.note("Create contact");
		}

		const email = await resolveEmail(input, guided);
		const firstName = await optionalField(
			input,
			guided,
			"first-name",
			"First name",
		);
		const lastName = await optionalField(
			input,
			guided,
			"last-name",
			"Last name",
		);

		const properties = await collectProperties(input, guided);
		const groupIds = flags.list("group-id");
		const channels = parseChannels(flags.list("channel"));

		const body: CreateContactInput = {
			email,
			...(firstName ? { firstName } : {}),
			...(lastName ? { lastName } : {}),
			...(flags.str("status") ? { status: asStatus(flags.str("status")) } : {}),
			...(properties ? { properties } : {}),
			...(groupIds.length > 0 ? { groupIds } : {}),
			...(channels.length > 0 ? { channels } : {}),
		};

		const session = createSession(input);
		const contact = await session.contacts.create(body);

		output.success(`Contact created: ${contact.email}`);
		output.emit({ data: contact, render: renderContactDetail });
	},
};

async function resolveEmail(
	input: CommandInput,
	interactive: boolean,
): Promise<string> {
	const provided = input.flags.str("email");
	if (provided !== undefined) {
		return requireEmail(provided, "--email");
	}
	if (!interactive) {
		throw usageError("Missing --email.", {
			code: "missing_email",
			fix: "Pass --email <address>, or run the command in an interactive terminal.",
		});
	}

	return input.ctx.prompter.text({
		message: "Email",
		placeholder: "e.g. luna@example.com",
		validate: (value) =>
			EMAIL_PATTERN.test(value) ? undefined : "Enter a valid email address.",
	});
}

async function optionalField(
	input: CommandInput,
	interactive: boolean,
	flag: string,
	message: string,
): Promise<string | undefined> {
	const provided = input.flags.str(flag);
	if (provided !== undefined || !interactive) {
		return provided;
	}
	const answer = await input.ctx.prompter.text({
		message: `${message} (optional)`,
	});
	return answer.length > 0 ? answer : undefined;
}

async function collectProperties(
	input: CommandInput,
	interactive: boolean,
): Promise<ContactProperties | undefined> {
	const fromJson = parsePropertiesJson(
		input.flags.str("properties"),
		PROPERTY_KEY,
	);
	const fromPairs = parsePropertyPairs(
		input.flags.list("property"),
		PROPERTY_KEY,
	);
	const merged: ContactProperties = { ...fromJson, ...fromPairs };

	if (Object.keys(merged).length > 0 || !interactive) {
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	if (!(await input.ctx.prompter.confirm({ message: "Add properties?" }))) {
		return undefined;
	}

	const prompted: ContactProperties = {};
	for (;;) {
		const key = await input.ctx.prompter.text({
			message: "Property",
			validate: (value) =>
				PROPERTY_KEY.test(value)
					? undefined
					: "Use lowercase letters, numbers, and underscores.",
		});
		prompted[key] = await input.ctx.prompter.text({ message: "Value" });
		if (
			!(await input.ctx.prompter.confirm({ message: "Add another property?" }))
		) {
			break;
		}
	}
	return prompted;
}

function parseChannels(entries: readonly string[]): ContactChannelInput[] {
	return entries.map((entry) => {
		const separator = entry.lastIndexOf(":");
		if (separator === -1) {
			return { channelId: entry, subscription: "opt_in" as const };
		}
		const channelId = entry.slice(0, separator);
		const subscription = entry.slice(separator + 1);
		if (!CHANNEL_SUBSCRIPTIONS.includes(subscription as ChannelSubscription)) {
			throw usageError(
				`--channel subscription must be opt_in or opt_out, got "${subscription}".`,
				{ code: "invalid_channel" },
			);
		}
		return {
			channelId,
			subscription: subscription as ChannelSubscription,
		};
	});
}
