import { MAX_PAGE_SIZE } from "@/api/contacts";
import type { ContactListResponse } from "@/api/types";
import { createSession } from "@/cli/session";
import type { Command } from "@/cli/spec";
import {
	asStatus,
	renderContactsTable,
	statusFlag,
} from "@/commands/contacts/shared";
import { usageError } from "@/errors/cli-error";

const DEFAULT_LIMIT = 20;

export const listContactsCommand: Command = {
	name: "list",
	aliases: ["ls"],
	summary: "List contacts",
	description:
		"Contacts are returned newest first. Use --search to filter by email, and --all to page through every contact in the organization.",
	flags: [
		{
			name: "limit",
			kind: "number",
			placeholder: "n",
			defaultValue: DEFAULT_LIMIT,
			summary: `Contacts per page (1-${MAX_PAGE_SIZE})`,
		},
		{
			name: "page",
			kind: "number",
			placeholder: "n",
			defaultValue: 1,
			summary: "Page number, starting at 1",
		},
		{
			name: "search",
			kind: "string",
			placeholder: "term",
			summary: "Match contacts whose email contains this term",
		},
		{ ...statusFlag, summary: "Only return contacts with this status" },
		{
			name: "channel",
			kind: "string",
			placeholder: "id",
			summary: "Only return contacts enrolled in this channel",
		},
		{
			name: "all",
			kind: "boolean",
			summary: "Fetch every page (cannot be combined with --page or --limit)",
		},
	],
	errorCodes: [
		"not_authenticated",
		"invalid_limit",
		"conflicting_options",
		"rate_limited",
	],
	examples: [
		"reloop contacts list",
		"reloop contacts list --limit 50 --status subscribed",
		"reloop contacts list --search luna --json",
		"reloop contacts list --all --json | jq -r '.contacts[].email'",
	],
	async run(input) {
		const { flags, output } = input;
		const all = flags.bool("all");

		if (all && (flags.has("page") || flags.has("limit"))) {
			throw usageError("--all cannot be combined with --page or --limit.", {
				code: "conflicting_options",
			});
		}

		const limit = flags.num("limit") ?? DEFAULT_LIMIT;
		const page = flags.num("page") ?? 1;

		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
			throw usageError(
				`--limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
				{
					code: "invalid_limit",
				},
			);
		}
		if (!Number.isInteger(page) || page < 1) {
			throw usageError("--page must be an integer of 1 or more.", {
				code: "invalid_limit",
			});
		}

		const query = {
			search: flags.str("search"),
			status: asStatus(flags.str("status")),
			channelId: flags.str("channel"),
		};

		const session = createSession(input);
		const result = all
			? await session.contacts.listAll(query)
			: await session.contacts.list({ ...query, page, limit });

		output.emit({
			data: result,
			render: (data) => renderContactsTable(data.contacts, output.width),
		});

		if (!output.json) {
			summarize(result, all, output.note.bind(output));
		}
	},
};

function summarize(
	result: ContactListResponse,
	all: boolean,
	note: (text: string) => void,
): void {
	note(
		`${result.contacts.length} of ${result.total} matching · ${result.totalContacts} total · ${result.subscribedContacts} subscribed · ${result.unsubscribedContacts} unsubscribed`,
	);

	if (!all && result.page * result.limit < result.total) {
		note(
			`Next page: reloop contacts list --page ${result.page + 1} --limit ${result.limit}`,
		);
	}
}
