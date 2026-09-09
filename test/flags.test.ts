import { describe, expect, test } from "bun:test";
import { parseFlags } from "@/cli/flags";
import type { FlagSpec } from "@/cli/spec";
import { CliError } from "@/errors/cli-error";

const specs: FlagSpec[] = [
	{ name: "email", kind: "string", summary: "" },
	{ name: "limit", kind: "number", defaultValue: 20, summary: "" },
	{ name: "json", kind: "boolean", summary: "" },
	{ name: "quiet", short: "q", kind: "boolean", summary: "" },
	{ name: "property", kind: "list", summary: "" },
	{
		name: "status",
		kind: "string",
		choices: ["subscribed", "blocked"],
		summary: "",
	},
];

describe("parseFlags", () => {
	test("reads separated and inline values", () => {
		const { flags } = parseFlags(
			["--email", "luna@example.com", "--limit=50"],
			specs,
		);
		expect(flags.str("email")).toBe("luna@example.com");
		expect(flags.num("limit")).toBe(50);
	});

	test("applies defaults and tracks whether a flag was provided", () => {
		const { flags } = parseFlags([], specs);
		expect(flags.num("limit")).toBe(20);
		expect(flags.has("limit")).toBe(false);
		expect(flags.bool("json")).toBe(false);
	});

	test("supports short flags and negation", () => {
		expect(parseFlags(["-q"], specs).flags.bool("quiet")).toBe(true);
		expect(parseFlags(["--json", "--no-json"], specs).flags.bool("json")).toBe(
			false,
		);
	});

	test("accumulates repeatable list flags", () => {
		const { flags } = parseFlags(
			["--property", "a=1", "--property", "b=2"],
			specs,
		);
		expect(flags.list("property")).toEqual(["a=1", "b=2"]);
	});

	test("collects positionals and honours the -- terminator", () => {
		const { positionals } = parseFlags(
			["luna@example.com", "--", "--not-a-flag"],
			specs,
		);
		expect(positionals).toEqual(["luna@example.com", "--not-a-flag"]);
	});

	test("rejects unknown options with a suggestion", () => {
		try {
			parseFlags(["--emial", "x"], specs);
			throw new Error("expected a usage error");
		} catch (error) {
			expect(error).toBeInstanceOf(CliError);
			expect((error as CliError).exitCode).toBe(2);
			expect((error as CliError).fix).toContain("--email");
		}
	});

	test("rejects a value flag with no value", () => {
		expect(() => parseFlags(["--email", "--json"], specs)).toThrow(
			"requires a value",
		);
	});

	test("rejects values outside the declared choices", () => {
		expect(() => parseFlags(["--status", "nope"], specs)).toThrow(
			"expects one of",
		);
	});

	test("rejects non-numeric values for number flags", () => {
		expect(() => parseFlags(["--limit", "many"], specs)).toThrow(
			"expects a number",
		);
	});

	test("keeps negative numbers as values", () => {
		expect(parseFlags(["--limit", "-5"], specs).flags.num("limit")).toBe(-5);
	});
});
