import { createHash, randomBytes } from "node:crypto";
import { normalizeEndpoint } from "@/api/client";
import { oauthEndpoints } from "@/api/endpoints";
import type { FetchLike } from "@/cli/context";
import type { OAuthGrant } from "@/config/store";
import { networkError, timeoutError } from "@/errors/api-error";
import { CliError, ExitCode } from "@/errors/cli-error";
import { PACKAGE_NAME, USER_AGENT, VERSION } from "@/version";

export const OAUTH_SCOPE = "openid profile email offline_access";
export const CALLBACK_PATH = "/callback";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const CLIENT_NAME = "Reloop CLI";

export type OAuthTransport = {
	endpoint: string;
	fetch: FetchLike;
	timeoutMs: number;
	debug?: (line: string) => void;
};

export type RegisteredClient = {
	clientId: string;
	resource: string;
};

export type Pkce = {
	verifier: string;
	challenge: string;
};

export type DeviceAuthorization = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	expiresInSeconds: number;
	intervalSeconds: number;
};

export type DevicePoll =
	| { status: "approved"; grant: OAuthGrant }
	| { status: "pending" }
	| { status: "slow_down" };

type OAuthReply = {
	ok: boolean;
	status: number;
	body: Record<string, unknown>;
};

type TokenBody = {
	access_token?: unknown;
	refresh_token?: unknown;
	expires_in?: unknown;
	id_token?: unknown;
};

function base64url(buffer: Buffer): string {
	return buffer.toString("base64url");
}

export function createPkce(): Pkce {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

export function createState(): string {
	return base64url(randomBytes(16));
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodeClaims(token: string | undefined): Record<string, unknown> {
	const payload = token?.split(".")[1];
	if (!payload) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		);
		return parsed !== null && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function oauthUnavailable(endpoint: string, status: number): CliError {
	return new CliError({
		code: "oauth_unavailable",
		message: `${endpoint} does not support browser sign-in.`,
		exitCode: ExitCode.auth,
		why: `The authorization server answered HTTP ${status}.`,
		fix: "Sign in with an API key instead: `reloop login --with-api-key`, or pass --api-key.",
	});
}

export function sessionExpired(): CliError {
	return new CliError({
		code: "session_expired",
		message: "Your Reloop sign-in has expired or was revoked.",
		exitCode: ExitCode.auth,
		fix: "Run `reloop login` to sign in again.",
	});
}

function loginFailed(reply: OAuthReply): CliError {
	const error = text(reply.body.error);
	if (error === "access_denied") {
		return new CliError({
			code: "login_denied",
			message: "The sign-in request was denied in the browser.",
			exitCode: ExitCode.auth,
			fix: "Run `reloop login` again and approve the request.",
		});
	}
	if (error === "expired_token") {
		return new CliError({
			code: "login_timeout",
			message: "The sign-in code expired before it was approved.",
			exitCode: ExitCode.auth,
			fix: "Run `reloop login` again.",
		});
	}
	return new CliError({
		code: "login_failed",
		message: "Reloop did not complete the sign-in.",
		exitCode: ExitCode.auth,
		why: text(reply.body.error_description) ?? error,
		fix: "Run `reloop login` again.",
	});
}

export class OAuthApi {
	readonly endpoint: string;
	readonly #transport: OAuthTransport;

	constructor(transport: OAuthTransport) {
		this.endpoint = normalizeEndpoint(transport.endpoint);
		this.#transport = transport;
	}

	async register(): Promise<RegisteredClient> {
		const reply = await this.#post(
			oauthEndpoints.register,
			JSON.stringify({
				client_name: CLIENT_NAME,
				redirect_uris: [`http://127.0.0.1${CALLBACK_PATH}`],
				grant_types: ["authorization_code", "refresh_token", DEVICE_GRANT],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
				application_type: "native",
				scope: OAUTH_SCOPE,
				software_id: PACKAGE_NAME,
				software_version: VERSION,
			}),
			"application/json",
		);
		const clientId = text(reply.body.client_id);
		if (!reply.ok || !clientId) {
			throw oauthUnavailable(this.endpoint, reply.status);
		}
		const resources = Array.isArray(reply.body.resources)
			? reply.body.resources
			: [];
		return {
			clientId,
			resource: text(resources[0]) ?? `${this.endpoint}/mcp`,
		};
	}

	authorizeUrl(options: {
		client: RegisteredClient;
		redirectUri: string;
		state: string;
		pkce: Pkce;
	}): string {
		const params = new URLSearchParams({
			response_type: "code",
			client_id: options.client.clientId,
			redirect_uri: options.redirectUri,
			scope: OAUTH_SCOPE,
			state: options.state,
			code_challenge: options.pkce.challenge,
			code_challenge_method: "S256",
			resource: options.client.resource,
		});
		return `${this.endpoint}${oauthEndpoints.authorize}?${params.toString()}`;
	}

	async exchangeCode(options: {
		client: RegisteredClient;
		code: string;
		redirectUri: string;
		pkce: Pkce;
	}): Promise<OAuthGrant> {
		const reply = await this.#postForm(oauthEndpoints.token, {
			grant_type: "authorization_code",
			code: options.code,
			redirect_uri: options.redirectUri,
			client_id: options.client.clientId,
			code_verifier: options.pkce.verifier,
			resource: options.client.resource,
		});
		if (!reply.ok) {
			throw loginFailed(reply);
		}
		return this.#grantFrom(reply, options.client);
	}

	async requestDeviceCode(
		client: RegisteredClient,
	): Promise<DeviceAuthorization | undefined> {
		const reply = await this.#postForm(oauthEndpoints.deviceCode, {
			client_id: client.clientId,
			scope: OAUTH_SCOPE,
			resource: client.resource,
		});
		if (text(reply.body.error) === "invalid_client") {
			return undefined;
		}
		const deviceCode = text(reply.body.device_code);
		const userCode = text(reply.body.user_code);
		const verificationUri = text(reply.body.verification_uri);
		if (!reply.ok || !deviceCode || !userCode || !verificationUri) {
			throw oauthUnavailable(this.endpoint, reply.status);
		}
		const complete = text(reply.body.verification_uri_complete);
		return {
			deviceCode,
			userCode,
			verificationUri,
			...(complete !== undefined ? { verificationUriComplete: complete } : {}),
			expiresInSeconds:
				typeof reply.body.expires_in === "number" ? reply.body.expires_in : 900,
			intervalSeconds:
				typeof reply.body.interval === "number" ? reply.body.interval : 5,
		};
	}

	async pollDeviceToken(
		client: RegisteredClient,
		deviceCode: string,
	): Promise<DevicePoll> {
		const reply = await this.#postForm(oauthEndpoints.token, {
			grant_type: DEVICE_GRANT,
			device_code: deviceCode,
			client_id: client.clientId,
			resource: client.resource,
		});
		if (reply.ok) {
			return { status: "approved", grant: this.#grantFrom(reply, client) };
		}
		const error = text(reply.body.error);
		if (error === "authorization_pending") {
			return { status: "pending" };
		}
		if (error === "slow_down") {
			return { status: "slow_down" };
		}
		throw loginFailed(reply);
	}

	async refresh(grant: OAuthGrant): Promise<OAuthGrant> {
		if (!grant.refreshToken) {
			throw sessionExpired();
		}
		const reply = await this.#postForm(oauthEndpoints.token, {
			grant_type: "refresh_token",
			refresh_token: grant.refreshToken,
			client_id: grant.clientId,
			resource: grant.resource,
		});
		if (!reply.ok) {
			if (reply.status === 400 || reply.status === 401) {
				throw sessionExpired();
			}
			throw new CliError({
				code: "server_error",
				message: `Reloop could not refresh the sign-in (HTTP ${reply.status}).`,
				exitCode: ExitCode.failure,
				fix: "Retry shortly, or run `reloop login` again.",
			});
		}
		return this.#grantFrom(reply, grant, grant);
	}

	async revoke(grant: OAuthGrant): Promise<boolean> {
		const token = grant.refreshToken ?? grant.accessToken;
		try {
			const reply = await this.#postForm(oauthEndpoints.revoke, {
				token,
				token_type_hint: grant.refreshToken ? "refresh_token" : "access_token",
				client_id: grant.clientId,
			});
			return reply.ok;
		} catch {
			return false;
		}
	}

	#grantFrom(
		reply: OAuthReply,
		client: RegisteredClient,
		previous?: OAuthGrant,
	): OAuthGrant {
		const body = reply.body as TokenBody;
		const accessToken = text(body.access_token);
		if (!accessToken) {
			throw loginFailed(reply);
		}
		const access = decodeClaims(accessToken);
		const identity = decodeClaims(text(body.id_token));
		const refreshToken = text(body.refresh_token) ?? previous?.refreshToken;
		const organizationId = text(access.org_id) ?? previous?.organizationId;
		const email = text(identity.email) ?? previous?.email;
		const expiresIn =
			typeof body.expires_in === "number" ? body.expires_in : 3600;
		return {
			clientId: client.clientId,
			resource: client.resource,
			accessToken,
			expiresAt: Date.now() + expiresIn * 1000,
			...(refreshToken !== undefined ? { refreshToken } : {}),
			...(organizationId !== undefined ? { organizationId } : {}),
			...(email !== undefined ? { email } : {}),
		};
	}

	#postForm(path: string, fields: Record<string, string>): Promise<OAuthReply> {
		return this.#post(
			path,
			new URLSearchParams(fields).toString(),
			"application/x-www-form-urlencoded",
		);
	}

	async #post(
		path: string,
		body: string,
		contentType: string,
	): Promise<OAuthReply> {
		const url = `${this.endpoint}${path}`;
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.#transport.timeoutMs);

		this.#transport.debug?.(`POST ${url}`);

		let response: Response;
		try {
			response = await this.#transport.fetch(url, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": contentType,
					"user-agent": USER_AGENT,
				},
				body,
				signal: controller.signal,
			});
		} catch (cause) {
			if (timedOut) {
				throw timeoutError(this.endpoint, this.#transport.timeoutMs);
			}
			throw networkError(this.endpoint, cause);
		} finally {
			clearTimeout(timer);
		}

		this.#transport.debug?.(`${response.status}`);

		let parsed: unknown;
		try {
			const raw = await response.text();
			parsed = raw.length > 0 ? JSON.parse(raw) : {};
		} catch {
			parsed = {};
		}
		return {
			ok: response.ok,
			status: response.status,
			body:
				parsed !== null && typeof parsed === "object"
					? (parsed as Record<string, unknown>)
					: {},
		};
	}
}
