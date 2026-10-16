import { spawn } from "node:child_process";
import type { Browser } from "@/cli/context";

function launcher(url: string): [string, string[]] {
	if (process.platform === "darwin") {
		return ["open", [url]];
	}
	if (process.platform === "win32") {
		return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	}
	return ["xdg-open", [url]];
}

export const systemBrowser: Browser = {
	open(url) {
		const [command, args] = launcher(url);
		return new Promise((resolve) => {
			try {
				const child = spawn(command, args, {
					stdio: "ignore",
					detached: true,
				});
				child.once("error", () => resolve(false));
				child.once("spawn", () => {
					child.unref();
					resolve(true);
				});
			} catch {
				resolve(false);
			}
		});
	},
};
