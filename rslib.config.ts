import { pluginReact } from "@rsbuild/plugin-react";
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
				"./src/**/*.{ts,tsx}",
				"!./src/**/*.{test,spec}.{ts,tsx}",
				"!./src/**/__tests__/**",
			],
		},
	},
	lib: [
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "esm",
		},
		{
			bundle: false,
			dts: {
				autoExtension: true,
			},
			format: "cjs",
		},
	],
	output: {
		target: "web",
		externals: [
			"@anvilkit/core",
			"@anvilkit/schema",
			"@anvilkit/validator",
			"@anvilkit/utils",
			"@anvilkit/ui",
			"@puckeditor/core",
			"react",
			"react-dom",
			"motion",
			"motion/react",
			"lucide-react",
		],
	},
	plugins: [pluginReact()],
});
