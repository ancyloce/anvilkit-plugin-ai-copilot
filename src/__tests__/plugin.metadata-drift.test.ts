import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";

/**
 * Metadata drift guard: `META.version` is derived from package.json, so
 * a Changesets bump can never leave the runtime metadata stale.
 */
describe("plugin metadata drift", () => {
	it("meta.version matches package.json version", () => {
		const plugin = createAiCopilotPlugin({
			generatePage: () => Promise.resolve(null as never),
			puckConfig: { components: {} } as never,
		});
		expect(plugin.meta.version).toBe(packageJson.version);
	});
});
