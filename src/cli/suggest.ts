function distance(a: string, b: string): number {
	const rows = a.length + 1;
	const cols = b.length + 1;
	let previous = Array.from({ length: cols }, (_, index) => index);

	for (let i = 1; i < rows; i++) {
		const current = new Array<number>(cols);
		current[0] = i;
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				(current[j - 1] ?? 0) + 1,
				(previous[j] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
		}
		previous = current;
	}

	return previous[cols - 1] ?? 0;
}

export function closest(
	input: string,
	candidates: readonly string[],
): string | undefined {
	let best: string | undefined;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const candidate of candidates) {
		const score = distance(input, candidate);
		if (score < bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	const threshold = Math.max(2, Math.floor(input.length / 3));
	return bestScore <= threshold ? best : undefined;
}
