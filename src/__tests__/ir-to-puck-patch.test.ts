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
			root: {},
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
			root: {},
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
			root: {},
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
			root: {},
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
});
