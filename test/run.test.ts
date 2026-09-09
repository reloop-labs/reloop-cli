import { describe, expect, test } from "bun:test";
import { run } from "@/cli/run";
import { ExitCode } from "@/errors/cli-error";
import { VERSION } from "@/version";
import { createTestContext } from "./helpers";

describe("run", () => {
	test("prints root help and exits 0 with no arguments", async () => {
		const ctx = createTestContext();
		expect(await run([], ctx)).toBe(ExitCode.success);
		expect(ctx.stdoutText()).toContain("The command line interface for Reloop");
		expect(ctx.stdoutText()).toContain("contacts");
		expect(ctx.stderrText()).toBe("");
	});

	test("prints the version", async () => {
		const ctx = createTestContext();
		expect(await run(["--version"], ctx)).toBe(ExitCode.success);
		expect(ctx.stdoutText().trim()).toBe(VERSION);
	});

	test("prints group help for a command with subcommands", async () => {
		const ctx = createTestContext();
		expect(await run(["contacts"], ctx)).toBe(ExitCode.success);
		expect(ctx.stdoutText()).toContain("reloop contacts <command>");
	});

	test("suggests a command on a typo and exits 2", async () => {
		const ctx = createTestContext();
		expect(await run(["contact", "list"], ctx)).toBe(ExitCode.usage);
		const error = ctx.stderrJson<{ error: { code: string; fix: string } }>();
		expect(error.error.code).toBe("unknown_command");
		expect(error.error.fix).toContain("contacts");
	});

	test("reports a missing required argument", async () => {
		const ctx = createTestContext({ env: { RELOOP_API_KEY: "rl_prod_x" } });
		expect(await run(["contacts", "get"], ctx)).toBe(ExitCode.usage);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"missing_argument",
		);
	});

	test("writes JSON errors to stderr and nothing to stdout", async () => {
		const ctx = createTestContext();
		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.auth);
		expect(ctx.stdoutText()).toBe("");
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"not_authenticated",
		);
	});

	test("renders human errors when stdout is a terminal", async () => {
		const ctx = createTestContext({
			terminal: { stdinIsTty: true, stdoutIsTty: true, stderrIsTty: false },
		});
		expect(await run(["contacts", "list"], ctx)).toBe(ExitCode.auth);
		expect(ctx.stderrText()).toContain("Error: No Reloop API key found.");
		expect(ctx.stderrText()).not.toContain('"code"');
	});

	test("keeps error output as JSON when --json is set on a terminal", async () => {
		const ctx = createTestContext({
			terminal: { stdinIsTty: true, stdoutIsTty: true, stderrIsTty: true },
		});
		expect(await run(["contacts", "list", "--json"], ctx)).toBe(ExitCode.auth);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"not_authenticated",
		);
	});

	test("rejects an invalid --timeout", async () => {
		const ctx = createTestContext();
		expect(await run(["contacts", "list", "--timeout", "0"], ctx)).toBe(
			ExitCode.usage,
		);
	});

	test("commands emits a JSON tree even on a terminal", async () => {
		const ctx = createTestContext({
			terminal: { stdinIsTty: true, stdoutIsTty: true, stderrIsTty: true },
		});
		expect(await run(["commands"], ctx)).toBe(ExitCode.success);
		const tree = ctx.stdoutJson<{
			name: string;
			commands: Array<{ path: string; commands: Array<{ path: string }> }>;
		}>();
		expect(tree.name).toBe("reloop");
		const contacts = tree.commands.find(
			(entry) => entry.path === "reloop contacts",
		);
		expect(contacts?.commands.map((entry) => entry.path)).toContain(
			"reloop contacts create",
		);
	});
});

describe("subcommand validation", () => {
	test("rejects an unknown subcommand even when --help is passed", async () => {
		const ctx = createTestContext();
		expect(await run(["contacts", "bogus", "--help"], ctx)).toBe(
			ExitCode.usage,
		);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"unknown_command",
		);
	});

	test("points at the right parent command in the suggestion", async () => {
		const ctx = createTestContext();
		await run(["contacts", "zzzzzzzz"], ctx);
		expect(ctx.stderrJson<{ error: { fix: string } }>().error.fix).toBe(
			"Run `reloop contacts --help` to list commands.",
		);
	});

	test("still shows help for a group command", async () => {
		const ctx = createTestContext();
		expect(await run(["contacts", "--help"], ctx)).toBe(ExitCode.success);
		expect(ctx.stdoutText()).toContain("reloop contacts");
	});
});
