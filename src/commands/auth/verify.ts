import type { ReloopApiClient } from "@/api/client";
import { apiKeyEndpoints } from "@/api/endpoints";
import type { ApiKeyListResponse } from "@/api/types";
import { CliError, ExitCode, isCliError } from "@/errors/cli-error";

export type VerifyResult =
	| { status: "valid"; keyName: string | null; userEmail: string | null }
	| { status: "inconclusive"; reason: string };

export async function verifyApiKey(
	client: ReloopApiClient,
	apiKey: string,
): Promise<VerifyResult> {
	let response: ApiKeyListResponse;
	try {
		response = await client.request<ApiKeyListResponse>({
			method: "GET",
			path: apiKeyEndpoints.list,
			query: { limit: 100 },
		});
	} catch (cause) {
		if (isCliError(cause) && (cause.status === 401 || cause.status === 403)) {
			throw invalidApiKey(client.endpoint);
		}
		if (isCliError(cause) && cause.status === undefined) {
			throw cause;
		}
		return {
			status: "inconclusive",
			reason: isCliError(cause) ? cause.message : String(cause),
		};
	}

	const match = response.apiKeys.find(
		(key) => key.start !== null && apiKey.startsWith(key.start),
	);

	return {
		status: "valid",
		keyName: match?.name ?? null,
		userEmail: match?.createdBy?.email ?? null,
	};
}

export function invalidApiKey(endpoint: string): CliError {
	return new CliError({
		code: "invalid_api_key",
		message: `Reloop at ${endpoint} rejected this API key.`,
		exitCode: ExitCode.auth,
		fix: "Create a new key in the Reloop dashboard under API keys, then run `reloop login` again.",
	});
}
