import { defineConfig } from "@rslib/core";

/**
 * Bundleless build for `@anvilkit/plugin-ai-copilot`.
 *
 * Each `.ts` under `src/` becomes an individual ESM + CJS output in
 * `dist/`, mirroring the other Studio plugins. `@anvilkit/core`,
 * `@anvilkit/schema`, `@anvilkit/validator`, `@anvilkit/utils`,
 * `@puckeditor/core`, `react`, and `react-dom` stay external so the
 * plugin ships as a thin headless wrapper around host-supplied AI
 * generation.
 */
export default defineConfig({
	source: {
		entry: {
			index: [
				"./src/**/*.ts",
				"!./src/**/*.{test,spec}.ts",
				"!./src/**/__tests__/**",
			],
		},
	},
	lib: [
		{
			bundle: false,
			dts: true,
			format: "esm",
		},
		{
			bundle: false,
			format: "cjs",
		},
	],
	output: {
		target: "node",
		externals: [
			"@anvilkit/core",
			"@anvilkit/schema",
			"@anvilkit/validator",
			"@anvilkit/utils",
			"@puckeditor/core",
			"react",
			"react-dom",
		],
	},
});
