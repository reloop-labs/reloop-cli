import type { ReloopApiClient } from "@/api/client";
import { contactEndpoints } from "@/api/endpoints";
import type {
	Contact,
	ContactListResponse,
	CreateContactInput,
	DeleteContactResponse,
	ListContactsQuery,
	MutatedContact,
	UpdateContactInput,
} from "@/api/types";
import type { ErrorCodeMap } from "@/errors/api-error";
import { CliError, ExitCode } from "@/errors/cli-error";

export const MAX_PAGE_SIZE = 100;

const CONTACT_CODES: ErrorCodeMap = {
	404: "contact_not_found",
	409: "contact_already_exists",
};

export function looksLikeEmail(reference: string): boolean {
	return reference.includes("@");
}

export type ContactReference = {
	id: string;
	label: string;
	contact?: Contact;
};

export class ContactsApi {
	readonly #client: ReloopApiClient;

	constructor(client: ReloopApiClient) {
		this.#client = client;
	}

	create(input: CreateContactInput): Promise<MutatedContact> {
		return this.#client.request<MutatedContact>({
			method: "POST",
			path: contactEndpoints.create,
			body: input,
			codes: CONTACT_CODES,
		});
	}

	list(query: ListContactsQuery = {}): Promise<ContactListResponse> {
		return this.#client.request<ContactListResponse>({
			method: "GET",
			path: contactEndpoints.list,
			query: {
				page: query.page,
				limit: query.limit,
				search: query.search,
				status: query.status,
				channelId: query.channelId,
			},
			codes: CONTACT_CODES,
		});
	}

	async listAll(
		query: Omit<ListContactsQuery, "page" | "limit"> = {},
	): Promise<ContactListResponse> {
		const first = await this.list({ ...query, page: 1, limit: MAX_PAGE_SIZE });
		const contacts = [...first.contacts];
		let page = 1;

		while (contacts.length < first.total && first.contacts.length > 0) {
			page += 1;
			const next = await this.list({ ...query, page, limit: MAX_PAGE_SIZE });
			if (next.contacts.length === 0) {
				break;
			}
			contacts.push(...next.contacts);
		}

		return { ...first, contacts, page: 1, limit: contacts.length };
	}

	retrieve(id: string): Promise<Contact> {
		return this.#client.request<Contact>({
			method: "GET",
			path: contactEndpoints.retrieve(id),
			codes: CONTACT_CODES,
		});
	}

	update(id: string, input: UpdateContactInput): Promise<MutatedContact> {
		return this.#client.request<MutatedContact>({
			method: "PATCH",
			path: contactEndpoints.byId(id),
			body: input,
			codes: CONTACT_CODES,
		});
	}

	remove(id: string): Promise<DeleteContactResponse> {
		return this.#client.request<DeleteContactResponse>({
			method: "DELETE",
			path: contactEndpoints.byId(id),
			codes: CONTACT_CODES,
		});
	}

	async findByEmail(email: string): Promise<Contact | undefined> {
		const needle = email.trim().toLowerCase();
		const page = await this.list({ search: needle, limit: MAX_PAGE_SIZE });
		return page.contacts.find(
			(contact) => contact.email.toLowerCase() === needle,
		);
	}

	async resolve(reference: string): Promise<Contact> {
		if (!looksLikeEmail(reference)) {
			return this.retrieve(reference);
		}
		const contact = await this.findByEmail(reference);
		if (!contact) {
			throw contactNotFound(reference);
		}
		return contact;
	}

	async resolveReference(reference: string): Promise<ContactReference> {
		if (!looksLikeEmail(reference)) {
			return { id: reference, label: reference };
		}
		const contact = await this.resolve(reference);
		return { id: contact.id, label: contact.email, contact };
	}
}

export function contactNotFound(reference: string): CliError {
	return new CliError({
		code: "contact_not_found",
		message: `No contact exists with email ${reference}.`,
		exitCode: ExitCode.notFound,
		fix: "Run `reloop contacts list --search <term>` to find the contact.",
	});
}
