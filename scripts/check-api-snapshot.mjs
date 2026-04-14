#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const GIT_BIN = process.platform === "win32" ? "git.exe" : "git";

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: PACKAGE_ROOT,
		stdio: "inherit",
	});

	if (result.error) {
		throw result.error;
	}

	return result.status ?? 0;
}

function main() {
	const typedocStatus = run(PNPM_BIN, [
		"exec",
		"typedoc",
		"--json",
		"./api/api-snapshot.json",
		"--entryPoints",
		"./src/index.ts",
		"--tsconfig",
		"./tsconfig.json",
		"--logLevel",
		"Warn",
	]);

	if (typedocStatus !== 0) {
		process.exit(typedocStatus);
	}

	const diffStatus = run(GIT_BIN, [
		"diff",
		"--exit-code",
		"--",
		"api/api-snapshot.json",
	]);

	if (diffStatus === 0) {
		console.log("check-api-snapshot: OK — api/api-snapshot.json is up to date.");
		return;
	}

	if (diffStatus === 1) {
		console.error(
			"check-api-snapshot: FAIL — api/api-snapshot.json changed after regeneration. Commit the updated snapshot.",
		);
		process.exit(1);
	}

	process.exit(diffStatus);
}

try {
	main();
} catch (error) {
	console.error("check-api-snapshot: crashed unexpectedly");
	console.error(error);
	process.exit(2);
}
