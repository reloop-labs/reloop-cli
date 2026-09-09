const MIN_COLUMN_WIDTH = 6;
const GAP = "  ";

const CONTROL_CHARS = new RegExp(
	`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
	"g",
);

function sanitize(value: string): string {
	return value.replace(CONTROL_CHARS, " ");
}

function truncate(value: string, width: number): string {
	if (value.length <= width) {
		return value;
	}
	if (width <= 1) {
		return value.slice(0, Math.max(0, width));
	}
	return `${value.slice(0, width - 1)}…`;
}

export type TableColumn = {
	header: string;
	values: string[];
};

export function renderTable(
	columns: TableColumn[],
	options: { width?: number; empty?: string } = {},
): string {
	const rowCount = columns[0]?.values.length ?? 0;
	if (columns.length === 0 || rowCount === 0) {
		return options.empty ?? "No results.";
	}

	const cells = columns.map((column) => column.values.map(sanitize));
	const widths = columns.map((column, index) =>
		Math.max(
			column.header.length,
			...(cells[index] ?? []).map((cell) => cell.length),
		),
	);

	if (options.width !== undefined) {
		const total = () =>
			widths.reduce((sum, width) => sum + width, 0) +
			GAP.length * (widths.length - 1);

		while (total() > options.width) {
			let widest = 0;
			for (let index = 1; index < widths.length; index++) {
				if ((widths[index] ?? 0) > (widths[widest] ?? 0)) {
					widest = index;
				}
			}
			if ((widths[widest] ?? 0) <= MIN_COLUMN_WIDTH) {
				break;
			}
			widths[widest] = (widths[widest] ?? 0) - 1;
		}
	}

	const line = (values: string[]): string =>
		values
			.map((value, index) =>
				truncate(value, widths[index] ?? 0).padEnd(widths[index] ?? 0),
			)
			.join(GAP)
			.trimEnd();

	const rows = [line(columns.map((column) => column.header.toUpperCase()))];
	for (let row = 0; row < rowCount; row++) {
		rows.push(line(cells.map((column) => column[row] ?? "")));
	}

	return rows.join("\n");
}
