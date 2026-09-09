import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "@/cli/context";

export function configDir(env: Env): string {
	if (env.RELOOP_CONFIG_DIR) {
		return env.RELOOP_CONFIG_DIR;
	}
	if (env.XDG_CONFIG_HOME) {
		return join(env.XDG_CONFIG_HOME, "reloop");
	}
	if (process.platform === "win32" && env.APPDATA) {
		return join(env.APPDATA, "reloop");
	}
	return join(homedir(), ".config", "reloop");
}

export function configFilePath(env: Env): string {
	return join(configDir(env), "config.json");
}
