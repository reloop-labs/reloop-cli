import { run } from "@/cli/run";
import { systemBrowser } from "@/platform/browser";
import { loopbackListener } from "@/platform/loopback";
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
	browser: systemBrowser,
	loopback: loopbackListener,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	interrupt: () => {
		const controller = new AbortController();
		// once: a second Ctrl-C falls through to the default and kills the process.
		process.once("SIGINT", () => controller.abort());
		return controller.signal;
	},
});

process.exitCode = exitCode;
