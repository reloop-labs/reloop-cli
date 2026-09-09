import { describe, expect, test } from "bun:test";
import { DEFAULT_TIMEOUT_MS, type ResolvedGlobals } from "@/cli/globals";
import { CliError, ExitCode } from "@/errors/cli-error";
import { Output } from "@/output/output";
import { createStyle } from "@/output/style";
import { renderTable } from "@/output/table";
import { createTestContext } from "./helpers";

const globals = (over: Partial<ResolvedGlobals> = {}): ResolvedGlobals => ({
	json: false,
	quiet: false,
	debug: false,
	timeoutMs: DEFAULT_TIMEOUT_MS,
	...over,
});

const tty = {
	stdinIsTty: true,
	stdoutIsTty: true,
	stderrIsTty: true,
	columns: 80,
};

describe("Output", () => {
	test("uses JSON when stdout is not a terminal", () => {
		const ctx = createTestContext();
		const output = new Output(ctx, globals());
		output.emit({ data: { id: "con_1" }, render: () => "human" });

		expect(output.json).toBe(true);
		expect(JSON.parse(ctx.stdoutText())).toEqual({ id: "con_1" });
	});

	test("uses the human renderer on a terminal", () => {
		const ctx = createTestContext({ terminal: tty });
		new Output(ctx, globals()).emit({
			data: { id: "con_1" },
			render: () => "human",
		});
		expect(ctx.stdoutText()).toBe("human\n");
	});

	test("--json forces JSON on a terminal", () => {
		const ctx = createTestContext({ terminal: tty });
		new Output(ctx, globals({ json: true })).emit({
			data: { id: "con_1" },
			render: () => "human",
		});
		expect(JSON.parse(ctx.stdoutText())).toEqual({ id: "con_1" });
	});

	test("notes and successes go to stderr and never to stdout", () => {
		const ctx = createTestContext({ terminal: tty });
		const output = new Output(ctx, globals());
		output.note("hint");
		output.success("done");
		expect(ctx.stdoutText()).toBe("");
		expect(ctx.stderrText()).toContain("hint");
		expect(ctx.stderrText()).toContain("done");
	});

	test("--quiet silences notes", () => {
		const ctx = createTestContext({ terminal: tty });
		const output = new Output(ctx, globals({ quiet: true, json: true }));
		output.note("hint");
		output.warn("careful");
		expect(ctx.stderrText()).toBe("");
	});

	test("serializes errors with the code and exit code", () => {
		const ctx = createTestContext();
		new Output(ctx, globals()).fail(
			new CliError({
				code: "contact_not_found",
				message: "No contact exists with email luna@example.com",
				exitCode: ExitCode.notFound,
				status: 404,
			}),
		);

		expect(JSON.parse(ctx.stderrText())).toEqual({
			error: {
				code: "contact_not_found",
				message: "No contact exists with email luna@example.com",
				exitCode: 4,
				status: 404,
			},
		});
	});
});

describe("renderTable", () => {
	test("aligns columns and uppercases headers", () => {
		const table = renderTable([
			{ header: "email", values: ["a@b.co", "longer@example.com"] },
			{ header: "name", values: ["A", "Longer Name"] },
		]);

		const lines = table.split("\n");
		expect(lines[0]).toBe("EMAIL               NAME");
		expect(lines[1]).toBe("a@b.co              A");
		expect(lines[2]).toBe("longer@example.com  Longer Name");
	});

	test("returns the empty message when there are no rows", () => {
		expect(
			renderTable([{ header: "email", values: [] }], {
				empty: "No contacts found.",
			}),
		).toBe("No contacts found.");
	});

	test("truncates to the terminal width", () => {
		const table = renderTable(
			[
				{
					header: "email",
					values: ["someone.with.a.long.address@example.com"],
				},
				{ header: "name", values: ["A Fairly Long Name Here"] },
			],
			{ width: 40 },
		);

		for (const line of table.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(40);
		}
	});

	test("replaces control characters coming from API data", () => {
		const table = renderTable([
			{ header: "name", values: [`bad${String.fromCharCode(27)}[31mred`] },
		]);
		expect(table).not.toContain(String.fromCharCode(27));
	});
});

describe("createStyle", () => {
	test("disables colour when NO_COLOR is set", () => {
		const style = createStyle(
			createTestContext({ env: { NO_COLOR: "1" }, terminal: tty }),
		);
		expect(style.red("x")).toBe("x");
	});

	test("disables colour when stderr is not a terminal", () => {
		expect(createStyle(createTestContext()).red("x")).toBe("x");
	});

	test("emits colour on a terminal", () => {
		const style = createStyle(createTestContext({ terminal: tty }));
		expect(style.red("x")).toContain(String.fromCharCode(27));
	});
});
