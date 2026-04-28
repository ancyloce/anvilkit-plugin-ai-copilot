import type {
	AiComponentSchema,
	AiSectionContext,
} from "@anvilkit/core/types";
import { validateAiSectionPatch } from "@anvilkit/validator/section";
import { describe, expect, it } from "vitest";

import { createMockGenerateSection } from "../mock/mock-generate-section.js";
import {
	EXPECTED_PATCHES_BY_NAME,
	GOLDEN_PROMPT,
	GOLDEN_ZONE_ID,
	INPUT_NODES_BY_NAME,
} from "./__snapshots__/section-goldens.snap.js";

const componentNames = Object.keys(INPUT_NODES_BY_NAME);

function buildSchemaFor(componentName: string): AiComponentSchema {
	const node = INPUT_NODES_BY_NAME[componentName]!;
	const fields = Object.entries(node.props).map(([name, value]) => {
		if (typeof value === "string") {
			return { name, type: "text" as const };
		}
		if (typeof value === "number") {
			return { name, type: "number" as const };
		}
		if (typeof value === "boolean") {
			return { name, type: "boolean" as const };
		}
		if (Array.isArray(value)) {
			return { name, type: "array" as const };
		}
		return { name, type: "object" as const };
	});
	return {
		componentName,
		description: `${componentName} schema for golden tests.`,
		fields,
	};
}

function buildContext(componentName: string): AiSectionContext {
	const node = INPUT_NODES_BY_NAME[componentName]!;
	return {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: [node.id],
		availableComponents: componentNames.map(buildSchemaFor),
		allowResize: false,
		currentNodes: [node],
	};
}

describe("regenerateSelection goldens (11 demo components)", () => {
	it("covers every demo component", () => {
		expect(componentNames.sort()).toEqual(
			[
				"BentoGrid",
				"BlogList",
				"Button",
				"Hero",
				"Helps",
				"Input",
				"LogoClouds",
				"Navbar",
				"PricingMinimal",
				"Section",
				"Statistics",
			].sort(),
		);
	});

	it.each(componentNames.map((name) => [name] as const))(
		"%s — mock generator output matches the locked patch",
		async (name) => {
			const ctx = buildContext(name);
			const generate = createMockGenerateSection({ delayMs: 0 });
			const patch = await generate(GOLDEN_PROMPT, ctx);
			expect(patch).toEqual(EXPECTED_PATCHES_BY_NAME[name]);
		},
	);

	it.each(componentNames.map((name) => [name] as const))(
		"%s — locked patch passes validateAiSectionPatch against the same context",
		(name) => {
			const ctx = buildContext(name);
			const result = validateAiSectionPatch(EXPECTED_PATCHES_BY_NAME[name]!, ctx);
			expect(result.valid).toBe(true);
			expect(
				result.issues.filter((issue) => issue.level === "error"),
			).toHaveLength(0);
		},
	);
});
