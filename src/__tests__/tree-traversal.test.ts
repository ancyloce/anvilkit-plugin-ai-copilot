/**
 * @file Depth and cycle guards on the recursive Puck-tree walkers in
 * `find-current-nodes.ts` and `apply-section-patch.ts`. Hardens the
 * "AI patches a malformed tree" path against stack overflows (review
 * H2). Without these guards, a Puck state where a slot prop references
 * its parent would loop forever; here we assert a bounded error.
 */

import type { AiSectionPatch } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";
import { describe, expect, it } from "vitest";

import { applySectionPatch } from "../apply-section-patch.js";
import { findCurrentNodes } from "../internal/find-current-nodes.js";

const MAX_TREE_DEPTH = 64;

function nest(depth: number): PuckData {
	// Build a `depth`-level slot chain: layout-N -> layout-(N-1) -> ...
	// All under `props.children`. The deepest item carries `target` id.
	let current: Record<string, unknown> = {
		type: "Hero",
		props: { id: "target", title: "deepest" },
	};
	for (let i = depth; i >= 1; i--) {
		current = {
			type: "Layout",
			props: {
				id: `layout-${i}`,
				children: [current],
			},
		};
	}
	return {
		root: { props: {} },
		content: [current as unknown as PuckData["content"][number]],
		zones: {},
	} as unknown as PuckData;
}

function cyclic(): PuckData {
	// A parent whose `children` slot contains a reference back to itself.
	const parent: Record<string, unknown> = {
		type: "Layout",
		props: { id: "parent" },
	};
	(parent.props as Record<string, unknown>).children = [parent];
	return {
		root: { props: {} },
		content: [parent as unknown as PuckData["content"][number]],
		zones: {},
	} as unknown as PuckData;
}

describe("findCurrentNodes — depth + cycle guards", () => {
	it("returns a result for trees at the depth ceiling", () => {
		const data = nest(MAX_TREE_DEPTH);
		// Walks `MAX_TREE_DEPTH` levels exactly; target lives at depth N.
		const found = findCurrentNodes(data, ["target"]);
		expect(found).toHaveLength(1);
		expect(found[0]?.id).toBe("target");
	});

	it("throws a bounded error past the depth ceiling instead of stack-overflowing", () => {
		const data = nest(MAX_TREE_DEPTH + 5);
		expect(() => findCurrentNodes(data, ["target"])).toThrow(/depth exceeded/i);
	});

	it("does not loop forever when searching past a cyclic slot reference", () => {
		const data = cyclic();
		// Search for an unrelated id so the walker recurses through the
		// cyclic slot. Without the WeakSet visited guard this would loop
		// forever. Bounded completion is the only assertion.
		expect(() => findCurrentNodes(data, ["does-not-exist"])).not.toThrow();
	});

	it("throws a bounded cycle error when converting a self-referencing node", () => {
		const data = cyclic();
		// `parent` matches, then IR conversion recurses into its
		// `children` slot — which is itself. Cycle guard fires.
		expect(() => findCurrentNodes(data, ["parent"])).toThrow(/cycle/i);
	});
});

describe("applySectionPatch — depth + cycle guards", () => {
	const replacementPatch: AiSectionPatch = {
		zoneId: "missing-parent:children",
		nodeIds: ["x"],
		replacement: [{ id: "x-new", type: "Hero", props: { title: "X" } }],
	};

	it("throws a bounded error on excessively deep slot trees", () => {
		const data = nest(MAX_TREE_DEPTH + 5);
		expect(() => applySectionPatch(data, replacementPatch)).toThrow(
			/depth exceeded/i,
		);
	});

	it("does not loop forever on a cyclic slot reference", () => {
		const data = cyclic();
		// Patch targets a slot that doesn't exist in the cyclic tree — the
		// rewriter walks the whole tree looking for `missing-parent`,
		// which is the path that previously stack-overflowed.
		expect(() => applySectionPatch(data, replacementPatch)).toThrow(
			/not found/,
		);
	});
});

describe("applySectionPatch — zoneId format", () => {
	const sampleData = {
		root: { props: {} },
		content: [],
		zones: {},
	} as unknown as PuckData;

	it.each([
		[":children", "empty parent"],
		["hero:", "empty slot"],
		[":", "both empty"],
		["a:b:c", "extra colon"],
		["plain", "no colon"],
	])("rejects malformed zoneId %j (%s)", (zoneId) => {
		const patch: AiSectionPatch = {
			zoneId,
			nodeIds: ["x"],
			replacement: [{ id: "x-new", type: "Hero", props: { title: "X" } }],
		};
		expect(() => applySectionPatch(sampleData, patch)).toThrow();
	});
});
