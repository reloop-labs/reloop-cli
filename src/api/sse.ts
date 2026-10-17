export type SseEvent = {
	event: string;
	data: string;
};

/**
 * Parse a text/event-stream body into events. Comment lines (heartbeats) and
 * `id`/`retry` fields are ignored; multi-line `data` is joined with newlines.
 */
export async function* readSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let event = "message";
	let data: string[] = [];

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				return;
			}
			buffer += decoder.decode(value, { stream: true });

			let newline = buffer.search(/\r?\n/);
			while (newline !== -1) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(
					buffer[newline] === "\r" ? newline + 2 : newline + 1,
				);
				newline = buffer.search(/\r?\n/);

				if (line === "") {
					if (data.length > 0) {
						yield { event, data: data.join("\n") };
					}
					event = "message";
					data = [];
					continue;
				}
				if (line.startsWith(":")) {
					continue;
				}
				const colon = line.indexOf(":");
				const field = colon === -1 ? line : line.slice(0, colon);
				const value =
					colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
				if (field === "event") {
					event = value;
				} else if (field === "data") {
					data.push(value);
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
