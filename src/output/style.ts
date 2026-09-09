import type { CliContext } from "@/cli/context";

export type Style = {
	bold(text: string): string;
	dim(text: string): string;
	red(text: string): string;
	green(text: string): string;
	yellow(text: string): string;
};

const CSI = `${String.fromCharCode(27)}[`;

const wrap = (open: string, close: string) => (text: string) =>
	`${CSI}${open}m${text}${CSI}${close}m`;

const plain: Style = {
	bold: (text) => text,
	dim: (text) => text,
	red: (text) => text,
	green: (text) => text,
	yellow: (text) => text,
};

const coloured: Style = {
	bold: wrap("1", "22"),
	dim: wrap("2", "22"),
	red: wrap("31", "39"),
	green: wrap("32", "39"),
	yellow: wrap("33", "39"),
};

export function createStyle(ctx: CliContext): Style {
	if (ctx.env.NO_COLOR !== undefined && ctx.env.NO_COLOR !== "") {
		return plain;
	}
	if (ctx.env.TERM === "dumb") {
		return plain;
	}
	return ctx.terminal.stderrIsTty ? coloured : plain;
}
