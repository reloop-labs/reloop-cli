import type { Contact, ContactProperties } from "@/api/types";
import { CONTACT_STATUSES, type ContactStatus } from "@/api/types";
import type { FlagSpec } from "@/cli/spec";
import { usageError } from "@/errors/cli-error";
import { renderTable } from "@/output/table";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PROPERTY_KEY = /^[a-z0-9_]+$/;

export const contactArg = {
	name: "contact",
	summary: "Contact ID, or the contact's email address",
	required: true,
} as const;

export const statusFlag: FlagSpec = {
	name: "status",
	kind: "string",
	placeholder: "status",
	choices: CONTACT_STATUSES,
	summary: "Subscription status",
};

export const propertyFlag: FlagSpec = {
	name: "property",
	kind: "list",
	placeholder: "key=value",
	summary: "Set a custom property (repeatable). Values are sent as strings",
};

export const propertiesFlag: FlagSpec = {
	name: "properties",
	kind: "string",
	placeholder: "json",
	summary:
		'Custom properties as a JSON object, e.g. \'{"plan":"pro","seats":5}\'',
};

export function requireEmail(value: string, flag: string): string {
	const email = value.trim();
	if (!EMAIL_PATTERN.test(email)) {
		throw usageError(`"${value}" is not a valid email address.`, {
			code: "invalid_email",
			fix: `Pass a full address to ${flag}, for example luna@example.com`,
		});
	}
	return email;
}

export function asStatus(value: string | undefined): ContactStatus | undefined {
	return value === undefined ? undefined : (value as ContactStatus);
}

export function parsePropertyPairs(
	pairs: readonly string[],
	keyPattern: RegExp,
): ContactProperties {
	const properties: ContactProperties = {};
	for (const pair of pairs) {
		const separator = pair.indexOf("=");
		if (separator < 1) {
			throw usageError(`--property expects key=value, got "${pair}".`, {
				code: "invalid_property",
			});
		}
		const key = pair.slice(0, separator);
		assertPropertyKey(key, keyPattern);
		properties[key] = pair.slice(separator + 1);
	}
	return properties;
}

export function parsePropertiesJson(
	raw: string | undefined,
	keyPattern: RegExp,
): ContactProperties | undefined {
	if (raw === undefined) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw usageError("--properties must be a valid JSON object.", {
			code: "invalid_property",
			fix: `Example: --properties '{"plan":"pro"}'`,
		});
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw usageError("--properties must be a JSON object.", {
			code: "invalid_property",
		});
	}

	const properties: ContactProperties = {};
	for (const [key, value] of Object.entries(parsed)) {
		assertPropertyKey(key, keyPattern);
		if (typeof value !== "string" && typeof value !== "number") {
			throw usageError(`Property "${key}" must be a string or a number.`, {
				code: "invalid_property",
			});
		}
		properties[key] = value;
	}
	return properties;
}

export function assertPropertyKey(key: string, pattern: RegExp): void {
	if (pattern.test(key)) {
		return;
	}
	throw usageError(`"${key}" is not a valid property name.`, {
		code: "invalid_property",
		fix: "Property names must be lowercase letters, numbers, and underscores.",
	});
}

export function fullName(contact: Contact): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

export function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

export function renderContactsTable(
	contacts: readonly Contact[],
	width?: number,
): string {
	return renderTable(
		[
			{ header: "email", values: contacts.map((contact) => contact.email) },
			{
				header: "name",
				values: contacts.map((contact) => fullName(contact) || "-"),
			},
			{ header: "status", values: contacts.map((contact) => contact.status) },
			{
				header: "created",
				values: contacts.map((contact) => formatDate(contact.createdAt)),
			},
		],
		{ ...(width !== undefined ? { width } : {}), empty: "No contacts found." },
	);
}

export function renderContactDetail(contact: Contact): string {
	const rows: Array<[string, string]> = [
		["ID", contact.id],
		["Email", contact.email],
		["Name", fullName(contact) || "-"],
		["Status", contact.status],
		["Created", formatDate(contact.createdAt)],
		["Updated", formatDate(contact.updatedAt)],
	];

	if (contact.suppressionReason) {
		rows.push([
			"Suppressed",
			`${contact.suppressionReason}${contact.suppressedAt ? ` on ${formatDate(contact.suppressedAt)}` : ""}`,
		]);
	}
	if (contact.groups.length > 0) {
		rows.push(["Groups", contact.groups.map((group) => group.name).join(", ")]);
	}
	for (const channel of contact.channels) {
		rows.push([`Channel ${channel.name}`, channel.subscription]);
	}
	for (const [key, value] of Object.entries(contact.properties)) {
		rows.push([`Property ${key}`, String(value)]);
	}

	const width = Math.max(...rows.map(([label]) => label.length));
	return rows
		.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
		.join("\n");
}
