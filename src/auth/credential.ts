import type { OAuthApi } from "@/auth/oauth";
import type { OAuthGrant } from "@/config/store";

const REFRESH_MARGIN_MS = 60_000;

export type Credential = {
	headers(): Promise<Record<string, string>>;
	renew(): Promise<boolean>;
};

export function apiKeyCredential(apiKey: string): Credential {
	return {
		headers: async () => ({ "x-api-key": apiKey }),
		renew: async () => false,
	};
}

export class OAuthCredential implements Credential {
	#grant: OAuthGrant;
	#renewed = false;
	readonly #oauth: OAuthApi;
	readonly #persist: (grant: OAuthGrant) => void;

	constructor(
		grant: OAuthGrant,
		oauth: OAuthApi,
		persist: (grant: OAuthGrant) => void,
	) {
		this.#grant = grant;
		this.#oauth = oauth;
		this.#persist = persist;
	}

	get grant(): OAuthGrant {
		return this.#grant;
	}

	async headers(): Promise<Record<string, string>> {
		if (this.#grant.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
			await this.#refresh();
		}
		return { authorization: `Bearer ${this.#grant.accessToken}` };
	}

	async renew(): Promise<boolean> {
		if (this.#renewed || !this.#grant.refreshToken) {
			return false;
		}
		await this.#refresh();
		return true;
	}

	async #refresh(): Promise<void> {
		this.#grant = await this.#oauth.refresh(this.#grant);
		this.#renewed = true;
		this.#persist(this.#grant);
	}
}
