import { configToAiContext } from "@anvilkit/schema";
import { validateAiOutput } from "@anvilkit/validator";
import { describe, expect, it } from "vitest";

import { demoConfig } from "./fixtures/demo-config.js";
import { allFixtures } from "../mock/index.js";

const ctx = configToAiContext(demoConfig);

describe("mock fixtures contract", () => {
	it("exports nine fixtures and every fixture has at least one prompt", () => {
		expect(allFixtures).toHaveLength(9);
		for (const fixture of allFixtures) {
			expect(fixture.prompts.length).toBeGreaterThan(0);
		}
	});

	it.each(allFixtures)(
		"validates fixture %# against the AI output contract",
		(fixture) => {
			const result = validateAiOutput(fixture.ir, ctx.availableComponents);
			const errorIssues = result.issues.filter(
				(issue) => issue.severity === "error",
			);

			expect(errorIssues).toEqual([]);
			expect(result.valid).toBe(true);
		},
	);
});
