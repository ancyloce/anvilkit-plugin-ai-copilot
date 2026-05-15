import type { PageIR } from "@anvilkit/core/types";
import type { Data as PuckData } from "@puckeditor/core";
import { describe, expect, it } from "vitest";

import { irToPuckPatch } from "../ir-to-puck-patch.js";

function page(children: PageIR["root"]["children"]): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children,
		},
		assets: [],
		metadata: {},
	};
}

describe("irToPuckPatch", () => {
	it("rebuilds a component with one named slot field", () => {
		const ir = page([
			{
				id: "layout-1",
				type: "Layout",
				props: { title: "Page" },
				children: [
					{
						id: "text-1",
						type: "Text",
						props: { text: "Hello" },
						slot: "content",
						slotKind: "slot",
					},
				],
			},
		]);

		expect(irToPuckPatch(ir)).toEqual({
			root: { props: {} },
			content: [
				{
					type: "Layout",
					props: {
						id: "layout-1",
						title: "Page",
						content: [
							{
								type: "Text",
								props: { id: "text-1", text: "Hello" },
							},
						],
					},
				},
			],
			zones: {},
		} satisfies PuckData);
	});

	it("rebuilds multiple named slot fields in insertion order", () => {
		const ir = page([
			{
				id: "layout-1",
				type: "Layout",
				props: {},
				children: [
					{
						id: "main-1",
						type: "Text",
						props: { text: "Main" },
						slot: "main",
						slotKind: "slot",
					},
					{
						id: "side-1",
						type: "Text",
						props: { text: "Side" },
						slot: "sidebar",
						slotKind: "slot",
					},
				],
			},
		]);

		expect(irToPuckPatch(ir)).toEqual({
			root: { props: {} },
			content: [
				{
					type: "Layout",
					props: {
						id: "layout-1",
						main: [{ type: "Text", props: { id: "main-1", text: "Main" } }],
						sidebar: [{ type: "Text", props: { id: "side-1", text: "Side" } }],
					},
				},
			],
			zones: {},
		} satisfies PuckData);
	});

	it("rebuilds nested slot fields", () => {
		const ir = page([
			{
				id: "layout-1",
				type: "Layout",
				props: {},
				children: [
					{
						id: "card-1",
						type: "Card",
						props: {},
						slot: "content",
						slotKind: "slot",
						children: [
							{
								id: "text-1",
								type: "Text",
								props: { text: "Nested" },
								slot: "body",
								slotKind: "slot",
							},
						],
					},
				],
			},
		]);

		expect(irToPuckPatch(ir)).toEqual({
			root: { props: {} },
			content: [
				{
					type: "Layout",
					props: {
						id: "layout-1",
						content: [
							{
								type: "Card",
								props: {
									id: "card-1",
									body: [
										{
											type: "Text",
											props: { id: "text-1", text: "Nested" },
										},
									],
								},
							},
						],
					},
				},
			],
			zones: {},
		} satisfies PuckData);
	});

	it("rebuilds legacy zone children", () => {
		const ir = page([
			{
				id: "legacy-1",
				type: "LegacyLayout",
				props: { title: "Legacy" },
				children: [
					{
						id: "text-1",
						type: "Text",
						props: { text: "From zone" },
						slot: "body",
						slotKind: "zone",
					},
				],
			},
		]);

		expect(irToPuckPatch(ir)).toEqual({
			root: { props: {} },
			content: [
				{
					type: "LegacyLayout",
					props: { id: "legacy-1", title: "Legacy" },
				},
			],
			zones: {
				"legacy-1:body": [
					{ type: "Text", props: { id: "text-1", text: "From zone" } },
				],
			},
		} satisfies PuckData);
	});

	// Regression — AI-generated pages failed to sync to collaborators
	// because a flat page omitted the `zones` key and emitted `root: {}`.
	// Puck's `setData` shallow-merges, so the omitted keys let stale
	// ghost zones / a stale root survive into the collab outbound IR.
	// The patch must be a complete, replace-safe snapshot.
	it("always returns an explicit empty zones key for a flat page", () => {
		const ir = page([
			{ id: "hero-1", type: "Hero", props: { headline: "Hi" } },
		]);

		const result = irToPuckPatch(ir);

		expect("zones" in result).toBe(true);
		expect(result.zones).toEqual({});
		expect(result).toEqual({
			root: { props: {} },
			content: [{ type: "Hero", props: { id: "hero-1", headline: "Hi" } }],
			zones: {},
		} satisfies PuckData);
	});

	it("always returns root.props even when the IR root has no props", () => {
		const ir: PageIR = {
			version: "1",
			root: { id: "root", type: "__root__", props: {}, children: [] },
			assets: [],
			metadata: {},
		};

		const result = irToPuckPatch(ir);

		expect(result.root).toEqual({ props: {} });
		expect(result.zones).toEqual({});
	});

	it("preserves root props on the props wrapper", () => {
		const ir: PageIR = {
			version: "1",
			root: {
				id: "root",
				type: "__root__",
				props: { title: "My Page" },
				children: [{ id: "hero-1", type: "Hero", props: {} }],
			},
			assets: [],
			metadata: {},
		};

		const result = irToPuckPatch(ir);

		expect(result.root).toEqual({ props: { title: "My Page" } });
		expect(result.zones).toEqual({});
	});
});
