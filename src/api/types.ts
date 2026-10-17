export type ContactStatus = "subscribed" | "unsubscribed" | "blocked";

export type ChannelSubscription = "opt_in" | "opt_out";

export type SuppressionReason = "hard_bounce" | "spam_complaint";

export type ContactProperties = Record<string, string | number>;

export type ContactGroupRef = {
	id: string;
	name: string;
};

export type ContactChannelRef = {
	id: string;
	name: string;
	subscription: ChannelSubscription;
};

export type Contact = {
	object: "contact";
	id: string;
	email: string;
	firstName: string | null;
	lastName: string | null;
	status: ContactStatus;
	properties: ContactProperties;
	groups: ContactGroupRef[];
	channels: ContactChannelRef[];
	suppressionReason: SuppressionReason | null;
	suppressedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type MutatedContact = Contact & {
	event: string;
};

export type ContactChannelInput = {
	channelId: string;
	subscription: ChannelSubscription;
};

export type CreateContactInput = {
	email: string;
	firstName?: string;
	lastName?: string;
	status?: ContactStatus;
	properties?: ContactProperties;
	groupIds?: string[];
	channels?: ContactChannelInput[];
};

export type UpdateContactInput = {
	email?: string;
	firstName?: string;
	lastName?: string;
	status?: ContactStatus;
	properties?: ContactProperties;
};

export type ListContactsQuery = {
	page?: number;
	limit?: number;
	search?: string;
	status?: ContactStatus;
	channelId?: string;
};

export type ContactListResponse = {
	object: "contact";
	contacts: Contact[];
	total: number;
	page: number;
	limit: number;
	totalContacts: number;
	subscribedContacts: number;
	unsubscribedContacts: number;
	event: string;
};

export type DeleteContactResponse = {
	success: boolean;
	object: "contact";
	id: string;
	event: string;
};

export type ApiKeySummary = {
	id: string;
	name: string | null;
	start: string | null;
	enabled: boolean;
	createdBy?: {
		id: string;
		name: string | null;
		email: string;
	} | null;
};

export type ApiKeyListResponse = {
	object: "api_key";
	apiKeys: ApiKeySummary[];
	total: number;
	page: number;
	limit: number;
	event: string;
};

export const CONTACT_STATUSES: readonly ContactStatus[] = [
	"subscribed",
	"unsubscribed",
	"blocked",
];

export const CHANNEL_SUBSCRIPTIONS: readonly ChannelSubscription[] = [
	"opt_in",
	"opt_out",
];

/** SSE `ready` event from GET /api/webhook/v1/listen/stream. */
export type ListenReady = {
	sessionId: string;
	heartbeatMs: number;
};

/** SSE `webhook` event: a signed request to forward. */
export type ListenDelivery = {
	deliveryId: string;
	eventId: string;
	eventType: string;
	headers: Record<string, string>;
	rawBody: string;
};

/** Body of POST /api/webhook/v1/listen/sessions/:id/results. */
export type ListenResult = {
	deliveryId: string;
	status: number | null;
	body: string | null;
	durationMs: number;
	error: string | null;
};
