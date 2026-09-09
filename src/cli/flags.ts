import type { FlagSpec } from "@/cli/spec";
import { closest } from "@/cli/suggest";
import { usageError } from "@/errors/cli-error";

export type FlagValue = string | number | boolean | string[];

export class Flags {
	readonly #values: Map<string, FlagValue>;
	readonly #provided: Set<string>;

	constructor(values: Map<string, FlagValue>, provided: Set<string>) {
		this.#values = values;
		this.#provided = provided;
	}

	has(name: string): boolean {
		return this.#provided.has(name);
	}

	str(name: string): string | undefined {
		const value = this.#values.get(name);
		return typeof value === "string" ? value : undefined;
	}

	num(name: string): number | undefined {
		const value = this.#values.get(name);
		return typeof value === "number" ? value : undefined;
	}

	bool(name: string): boolean {
		return this.#values.get(name) === true;
	}

	list(name: string): string[] {
		const value = this.#values.get(name);
		return Array.isArray(value) ? value : [];
	}
}

function specFor(
	specs: readonly FlagSpec[],
	token: string,
	isShort: boolean,
): FlagSpec | undefined {
	return specs.find((spec) =>
		isShort ? spec.short === token : spec.name === token,
	);
}

function coerce(spec: FlagSpec, raw: string): FlagValue {
	if (spec.kind === "number") {
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			throw usageError(`Option --${spec.name} expects a number, got "${raw}".`);
		}
		return parsed;
	}

	if (spec.choices && !spec.choices.includes(raw)) {
		throw usageError(
			`Option --${spec.name} expects one of: ${spec.choices.join(", ")}. Got "${raw}".`,
		);
	}

	return raw;
}

function needsValue(token: string | undefined): boolean {
	if (token === undefined) {
		return false;
	}
	if (!token.startsWith("-") || token === "-") {
		return true;
	}
	return /^-\d/.test(token);
}

export type ParseResult = {
	flags: Flags;
	positionals: string[];
};

export function parseFlags(
	tokens: readonly string[],
	specs: readonly FlagSpec[],
): ParseResult {
	const values = new Map<string, FlagValue>();
	const provided = new Set<string>();
	const positionals: string[] = [];

	for (const spec of specs) {
		if (spec.kind === "list") {
			values.set(spec.name, []);
		} else if (spec.defaultValue !== undefined) {
			values.set(spec.name, spec.defaultValue);
		} else if (spec.kind === "boolean") {
			values.set(spec.name, false);
		}
	}

	const assign = (spec: FlagSpec, value: FlagValue): void => {
		if (spec.kind === "list") {
			const current = values.get(spec.name);
			const list = Array.isArray(current) ? current : [];
			values.set(spec.name, [...list, String(value)]);
		} else {
			values.set(spec.name, value);
		}
		provided.add(spec.name);
	};

	let index = 0;
	let passthrough = false;

	while (index < tokens.length) {
		const token = tokens[index] ?? "";
		index += 1;

		if (passthrough) {
			positionals.push(token);
			continue;
		}

		if (token === "--") {
			passthrough = true;
			continue;
		}

		if (!token.startsWith("-") || token === "-") {
			positionals.push(token);
			continue;
		}

		const isShort = !token.startsWith("--");
		const body = token.slice(isShort ? 1 : 2);
		const equals = body.indexOf("=");
		const name = equals === -1 ? body : body.slice(0, equals);
		const inlineValue = equals === -1 ? undefined : body.slice(equals + 1);

		if (!isShort && name.startsWith("no-")) {
			const negated = specFor(specs, name.slice(3), false);
			if (negated?.kind === "boolean") {
				assign(negated, false);
				continue;
			}
		}

		const spec = specFor(specs, name, isShort);
		if (!spec) {
			const suggestion = isShort
				? undefined
				: closest(
						name,
						specs.filter((item) => !item.hidden).map((item) => item.name),
					);
			throw usageError(
				`Unknown option "${token}".`,
				suggestion ? { fix: `Did you mean "--${suggestion}"?` } : {},
			);
		}

		if (spec.kind === "boolean") {
			if (inlineValue === undefined) {
				assign(spec, true);
				continue;
			}
			if (inlineValue !== "true" && inlineValue !== "false") {
				throw usageError(
					`Option --${spec.name} is a flag and only accepts "true" or "false".`,
				);
			}
			assign(spec, inlineValue === "true");
			continue;
		}

		if (inlineValue !== undefined) {
			assign(spec, coerce(spec, inlineValue));
			continue;
		}

		if (!needsValue(tokens[index])) {
			throw usageError(`Option --${spec.name} requires a value.`);
		}

		assign(spec, coerce(spec, tokens[index] ?? ""));
		index += 1;
	}

	return { flags: new Flags(values, provided), positionals };
}
