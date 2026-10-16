import type { CliContext } from "@/cli/context";
import type { ResolvedGlobals } from "@/cli/globals";
import type { CliError } from "@/errors/cli-error";
import { createStyle, type Style } from "@/output/style";

const MIN_TABLE_WIDTH = 40;

export type EmitPayload<T> = {
	data: T;
	render: (data: T) => string;
};

export class Output {
	readonly style: Style;
	readonly json: boolean;
	readonly #ctx: CliContext;
	readonly #quiet: boolean;

	constructor(ctx: CliContext, globals: ResolvedGlobals) {
		this.#ctx = ctx;
		this.#quiet = globals.quiet;
		this.json = globals.json || !ctx.terminal.stdoutIsTty;
		this.style = createStyle(ctx);
	}

	get width(): number | undefined {
		if (!this.#ctx.terminal.stdoutIsTty) {
			return undefined;
		}
		const columns = this.#ctx.terminal.columns;
		return columns !== undefined && columns >= MIN_TABLE_WIDTH
			? columns
			: undefined;
	}

	emit<T>(payload: EmitPayload<T>): void {
		if (this.json) {
			this.emitJson(payload.data);
			return;
		}
		this.#writeLine(this.#ctx.stdout, payload.render(payload.data));
	}

	emitJson(data: unknown): void {
		this.#writeLine(this.#ctx.stdout, JSON.stringify(data, null, 2));
	}

	print(text: string): void {
		this.#writeLine(this.#ctx.stdout, text);
	}

	note(text: string): void {
		if (this.#quiet) {
			return;
		}
		this.#writeLine(this.#ctx.stderr, this.style.dim(text));
	}

	notice(text: string): void {
		this.#writeLine(this.#ctx.stderr, text);
	}

	warn(text: string): void {
		if (this.#quiet) {
			return;
		}
		this.#writeLine(
			this.#ctx.stderr,
			`${this.style.yellow("Warning:")} ${text}`,
		);
	}

	success(text: string): void {
		if (this.json || this.#quiet) {
			return;
		}
		this.#writeLine(this.#ctx.stderr, `${this.style.green("✓")} ${text}`);
	}

	fail(error: CliError): void {
		if (this.json) {
			this.#writeLine(
				this.#ctx.stderr,
				JSON.stringify(
					{
						error: {
							code: error.code,
							message: error.message,
							exitCode: error.exitCode,
							...(error.status !== undefined ? { status: error.status } : {}),
							...(error.why !== undefined ? { why: error.why } : {}),
							...(error.fix !== undefined ? { fix: error.fix } : {}),
							...(error.details !== undefined
								? { details: error.details }
								: {}),
						},
					},
					null,
					2,
				),
			);
			return;
		}

		const lines = [
			error.code === "cancelled"
				? error.message
				: `${this.style.red("Error:")} ${error.message}`,
		];
		if (error.why) {
			lines.push(this.style.dim(`  ${error.why}`));
		}
		if (error.fix) {
			lines.push(this.style.dim(`  ${error.fix}`));
		}
		this.#writeLine(this.#ctx.stderr, lines.join("\n"));
	}

	#writeLine(target: { write(chunk: string): unknown }, text: string): void {
		target.write(`${text}\n`);
	}
}
