import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node20",
	dts: false,
	clean: true,
	shims: true,
	banner: { js: "#!/usr/bin/env node" },
	esbuildOptions(options) {
		options.alias = { "@": path.join(root, "src") };
	},
});
