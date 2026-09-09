const CONTACTS_BASE = "/api/contacts";

export const contactEndpoints = {
	create: `${CONTACTS_BASE}/create`,
	list: `${CONTACTS_BASE}/list`,
	retrieve: (id: string) =>
		`${CONTACTS_BASE}/retrieve/${encodeURIComponent(id)}`,
	byId: (id: string) => `${CONTACTS_BASE}/${encodeURIComponent(id)}`,
} as const;

export const apiKeyEndpoints = {
	list: "/api/api-key/v1/",
} as const;
