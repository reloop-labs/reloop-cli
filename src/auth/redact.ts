const VISIBLE_PREFIX = 12;

export function maskApiKey(apiKey: string): string {
	if (apiKey.length <= VISIBLE_PREFIX) {
		return "*".repeat(apiKey.length);
	}
	return `${apiKey.slice(0, VISIBLE_PREFIX)}…`;
}
