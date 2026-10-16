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

const AUTH_BASE = "/api/auth/v1";

export const oauthEndpoints = {
	register: `${AUTH_BASE}/oauth2/register`,
	authorize: `${AUTH_BASE}/oauth2/authorize`,
	token: `${AUTH_BASE}/oauth2/token`,
	revoke: `${AUTH_BASE}/oauth2/revoke`,
	deviceCode: `${AUTH_BASE}/device/code`,
} as const;
