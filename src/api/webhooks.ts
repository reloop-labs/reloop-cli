import type { ReloopApiClient } from "@/api/client";
import { webhookEndpoints } from "@/api/endpoints";
import { readSse, type SseEvent } from "@/api/sse";
import type { ListenResult } from "@/api/types";

export class WebhooksApi {
	readonly #client: ReloopApiClient;

	constructor(client: ReloopApiClient) {
		this.#client = client;
	}

	/** Open the relay stream; events arrive until `signal` aborts or the connection drops. */
	async listen(
		forwardTo: string,
		signal: AbortSignal,
	): Promise<AsyncGenerator<SseEvent>> {
		const response = await this.#client.stream(
			{
				method: "GET",
				path: webhookEndpoints.listenStream,
				query: { forwardTo },
			},
			signal,
		);
		if (!response.body) {
			throw new Error("The listen stream returned no body.");
		}
		return readSse(response.body);
	}

	reportResult(sessionId: string, result: ListenResult): Promise<unknown> {
		return this.#client.request({
			method: "POST",
			path: webhookEndpoints.listenResult(sessionId),
			body: result,
		});
	}
}
