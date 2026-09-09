import { run } from "@/cli/run";
import { nodePrompter } from "@/prompts/node-prompter";

const exitCode = await run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	fetch: (url, init) => fetch(url, init),
	terminal: {
		stdinIsTty: process.stdin.isTTY === true,
		stdoutIsTty: process.stdout.isTTY === true,
		stderrIsTty: process.stderr.isTTY === true,
		...(process.stdout.columns !== undefined
			? { columns: process.stdout.columns }
			: {}),
	},
	prompter: nodePrompter,
});

process.exitCode = exitCode;
