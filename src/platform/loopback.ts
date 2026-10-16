import { createServer } from "node:http";
import type { Loopback } from "@/cli/context";

function page(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; --bg: #fafafa; --fg: #0a0a0a; --muted: #737373; --card: #ffffff; --border: #e5e5e5; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --card: #171717; --border: #262626; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 380px; padding: 32px 28px; background: var(--card); border: 1px solid var(--border); border-radius: 14px; text-align: center; }
h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0; color: var(--muted); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${body}</p>
</main>
</body>
</html>`;
}

const SUCCESS = page(
	"You're signed in to Reloop",
	"You can close this tab and return to your terminal.",
);

const FAILURE = page(
	"Sign-in was not completed",
	"Return to your terminal for details, then run <code>reloop login</code> again.",
);

export const loopbackListener: Loopback = {
	listen(path, timeoutMs) {
		return new Promise((resolve, reject) => {
			let settle: (params: URLSearchParams | undefined) => void = () => {};
			const result = new Promise<URLSearchParams | undefined>((done) => {
				settle = done;
			});
			const timer = setTimeout(() => settle(undefined), timeoutMs);

			const server = createServer((request, response) => {
				const url = new URL(request.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== path) {
					response.writeHead(404).end();
					return;
				}
				const failed =
					url.searchParams.has("error") || !url.searchParams.has("code");
				response.writeHead(failed ? 400 : 200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
					connection: "close",
				});
				response.end(failed ? FAILURE : SUCCESS);
				settle(url.searchParams);
			});

			server.once("error", (cause) => {
				clearTimeout(timer);
				reject(cause);
			});
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				const port =
					address !== null && typeof address === "object" ? address.port : 0;
				resolve({
					redirectUri: `http://127.0.0.1:${port}${path}`,
					result,
					close() {
						clearTimeout(timer);
						settle(undefined);
						server.closeAllConnections();
						server.close();
					},
				});
			});
		});
	},
};
