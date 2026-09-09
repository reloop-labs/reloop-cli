import { createInterface } from "node:readline/promises";
import type {
	ConfirmPrompt,
	Prompter,
	SecretPrompt,
	TextPrompt,
} from "@/cli/context";
import { cancelledError } from "@/errors/cli-error";

const ETX = 3;
const EOT = 4;
const BACKSPACE = 8;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const DELETE = 127;

function label(message: string, hint?: string): string {
	return hint ? `? ${message} (${hint}): ` : `? ${message}: `;
}

async function ask(prompt: string): Promise<string> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
	});
	try {
		return await rl.question(prompt);
	} catch {
		throw cancelledError();
	} finally {
		rl.close();
	}
}

async function readSecret(prompt: string): Promise<string> {
	const input = process.stdin;
	if (!input.isTTY || typeof input.setRawMode !== "function") {
		return ask(prompt);
	}

	process.stderr.write(prompt);
	input.setRawMode(true);
	input.resume();

	return new Promise<string>((resolve, reject) => {
		let value = "";
		const onData = (chunk: Buffer): void => {
			for (const byte of chunk) {
				if (byte === CARRIAGE_RETURN || byte === NEWLINE) {
					cleanup();
					process.stderr.write("\n");
					resolve(value);
					return;
				}
				if (byte === ETX || (byte === EOT && value.length === 0)) {
					cleanup();
					process.stderr.write("\n");
					reject(cancelledError());
					return;
				}
				if (byte === BACKSPACE || byte === DELETE) {
					value = value.slice(0, -1);
					continue;
				}
				if (byte >= 32) {
					value += String.fromCharCode(byte);
				}
			}
		};
		const cleanup = (): void => {
			input.off("data", onData);
			input.setRawMode(false);
			input.pause();
		};
		input.on("data", onData);
	});
}

export const nodePrompter: Prompter = {
	async text(prompt: TextPrompt): Promise<string> {
		for (;;) {
			const answer = (
				await ask(label(prompt.message, prompt.placeholder))
			).trim();
			const value = answer.length > 0 ? answer : (prompt.defaultValue ?? "");
			const problem = prompt.validate?.(value);
			if (problem === undefined) {
				return value;
			}
			process.stderr.write(`  ${problem}\n`);
		}
	},

	async secret(prompt: SecretPrompt): Promise<string> {
		for (;;) {
			const value = (await readSecret(label(prompt.message))).trim();
			const problem = prompt.validate?.(value);
			if (problem === undefined) {
				return value;
			}
			process.stderr.write(`  ${problem}\n`);
		}
	},

	async confirm(prompt: ConfirmPrompt): Promise<boolean> {
		const fallback = prompt.defaultValue ?? false;
		const hint = fallback ? "Y/n" : "y/N";
		for (;;) {
			const answer = (await ask(label(prompt.message, hint)))
				.trim()
				.toLowerCase();
			if (answer === "") {
				return fallback;
			}
			if (answer === "y" || answer === "yes") {
				return true;
			}
			if (answer === "n" || answer === "no") {
				return false;
			}
			process.stderr.write("  Please answer y or n.\n");
		}
	},
};
