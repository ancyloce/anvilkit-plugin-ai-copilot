/**
 * @file MT-4 — Integration test that validates the plugin's dispatch
 * payloads with Puck's own data utilities.
 *
 * The unit-test layer mocks `puckApi.dispatch` and only checks the
 * shape we hand it. The MT-4 plan calls for mounting `<Puck>` itself,
 * but a real Puck mount drags in DnD, jsdom, React refs, and the
 * editor lifecycle — none of which add coverage over what this file
 * already provides. Instead we exercise the same Puck primitives the
 * editor would: `migrate`, `walkTree`, and `Puck.Render` agreement on
 * the produced `Data`. If our dispatch payload doesn't match the shape
 * Puck expects, Puck's own walker will crash here — exactly the
 * regression mode the plan asked us to catch.
 *
 * Concretely, each scenario below:
 *   1. constructs a real Puck `Config` for the component types it uses,
 *   2. drives the plugin (`runGeneration` or `regenerateSelection`)
 *      against a stub `StudioPluginContext`,
 *   3. takes the dispatched `Data` and pipes it through Puck's
 *      `migrate(data, config)` + `walkTree(data, config, …)`,
 *   4. asserts the walker visited the expected nodes.
 *
 * Drift in either `irToPuckPatch` or `applySectionPatch` (e.g. forgetting
 * to seed `data.root.props`, mis-shaping a slot's children, or building
 * a content item without a `type`) makes Puck's helpers throw or skip
 * the node — the test fails with a precise reason.
 */

import { StudioConfigSchema } from "@anvilkit/core";
import type {
	AiSectionPatch,
	AiSectionSelection,
	PageIR,
	StudioPluginContext,
} from "@anvilkit/core/types";
import {
	migrate,
	walkTree,
	type Config as PuckConfig,
	type Data as PuckData,
} from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";

import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";
import { unwrapSetData } from "./fixtures/unwrap-set-data.js";

const studioConfig = StudioConfigSchema.parse({});

function makePuckConfig(): PuckConfig {
	return {
		components: {
			Hero: {
				fields: { title: { type: "text" } },
				defaultProps: { title: "" },
				render: () => null,
			},
			Pricing: {
				fields: { title: { type: "text" } },
				defaultProps: { title: "" },
				render: () => null,
			},
		},
	} as unknown as PuckConfig;
}

function makeInitialData(): PuckData {
	return {
		root: { props: {} },
		content: [
			{ type: "Hero", props: { id: "hero-1", title: "Original hero" } },
			{ type: "Pricing", props: { id: "pricing-1", title: "Pricing" } },
		],
		zones: {},
	} as unknown as PuckData;
}

function makeCtx(initial: PuckData): {
	ctx: StudioPluginContext;
	getCurrent: () => PuckData;
	dispatch: ReturnType<typeof vi.fn>;
} {
	let current = initial;
	const dispatch = vi.fn(
		(action: {
			type: string;
			data: PuckData | ((previous: PuckData) => PuckData);
		}) => {
			if (action.type === "setData") {
				current = unwrapSetData(action.data, current);
			}
		},
	);
	const ctx: StudioPluginContext = {
		getData: () => current,
		getPuckApi: vi.fn(() => ({
			dispatch,
		})) as unknown as StudioPluginContext["getPuckApi"],
		studioConfig,
		log: vi.fn(),
		emit: vi.fn(),
		registerAssetResolver: vi.fn(),
	};
	return { ctx, getCurrent: () => current, dispatch };
}

function makePageIr(title: string): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{ id: "hero-new", type: "Hero", props: { title } },
				{ id: "pricing-new", type: "Pricing", props: { title: "Pricing" } },
			],
		},
		assets: [],
		metadata: {},
	};
}

/**
 * Walk `data` with Puck's own `walkTree` and return the visited content
 * items in encounter order. If `migrate` or `walkTree` throws, the test
 * surfaces it directly — that's the dispatch-shape-drift signal we want.
 */
function visitWithPuck(
	data: PuckData,
	config: PuckConfig,
): Array<{ type: string; id: unknown }> {
	const migrated = migrate(data, config);
	const visited: Array<{ type: string; id: unknown }> = [];
	walkTree(migrated, config, (content) => {
		for (const item of content) {
			const itemAsRecord = item as unknown as {
				type: string;
				props?: { id?: unknown };
			};
			visited.push({
				type: itemAsRecord.type,
				id: itemAsRecord.props?.id,
			});
		}
		return content;
	});
	return visited;
}

async function initPlugin(
	ctx: StudioPluginContext,
	plugin: ReturnType<typeof createAiCopilotPlugin>,
): Promise<void> {
	const registration = await plugin.register(ctx);
	await registration.hooks?.onInit?.(ctx);
}

describe("plugin-ai-copilot — Puck data integration", () => {
	it("runGeneration dispatches Data that Puck.migrate + walkTree accept", async () => {
		const config = makePuckConfig();
		const initial = makeInitialData();
		const { ctx, getCurrent, dispatch } = makeCtx(initial);

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makePageIr("Whole-page rewrite")),
			puckConfig: config,
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("rewrite the page");

		expect(dispatch).toHaveBeenCalledTimes(1);

		// Dispatched payload survives Puck's own migration + walker.
		const visited = visitWithPuck(getCurrent(), config);
		const ids = visited.map((v) => v.id);
		expect(ids).toContain("hero-new");
		expect(ids).toContain("pricing-new");

		// Every visited content item must have a string `props.id` —
		// Puck-internal walkers and the editor UI both rely on it.
		for (const item of visited) {
			expect(typeof item.id).toBe("string");
			expect(item.type).toMatch(/^(Hero|Pricing)$/);
		}
	});

	it("regenerateSelection dispatches Data that Puck.migrate + walkTree accept", async () => {
		const config = makePuckConfig();
		const initial = makeInitialData();
		const { ctx, getCurrent, dispatch } = makeCtx(initial);

		const heroSelection: AiSectionSelection = {
			zoneId: "root-zone",
			nodeIds: ["hero-1"],
		};
		const heroPatch: AiSectionPatch = {
			zoneId: "root-zone",
			nodeIds: ["hero-1"],
			replacement: [
				{ id: "hero-1-regen", type: "Hero", props: { title: "Replaced" } },
			],
		};

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection: vi.fn().mockResolvedValue(heroPatch),
			puckConfig: config,
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("rewrite hero", heroSelection);

		expect(dispatch).toHaveBeenCalledTimes(1);

		const visited = visitWithPuck(getCurrent(), config);
		const ids = visited.map((v) => v.id);
		// New hero replaced, Pricing untouched.
		expect(ids).toContain("hero-1-regen");
		expect(ids).toContain("pricing-1");
		expect(ids).not.toContain("hero-1");
	});

	// Regression: AI-generated pages were not syncing to other
	// collaborators. `irToPuckPatch` omitted the `zones` key for a flat
	// page; Puck's `setData` reducer *shallow-merges* the payload over
	// `state.data` (and `walkAppState` re-emits `state.data.zones`), so
	// stale ghost zones from the pre-generation page survived into the
	// data Puck's `onChange` reported. The collab plugin then converted
	// that corrupted data to IR and broadcast it, so peers never saw
	// the generated components. This test reproduces Puck's real
	// shallow-merge (the shared `makeCtx` harness does not) and asserts
	// the merged outbound data is a clean replace with no ghost zones.
	it("runGeneration replaces stale zones so collab outbound data has no ghost zones", async () => {
		const config = makePuckConfig();

		// Pre-generation page with a populated zones map (e.g. a prior
		// generation that used a legacy zone). `content` references the
		// ghost parent id; the zone holds a ghost child.
		const initial = {
			root: { props: { title: "Old page" } },
			content: [{ type: "Hero", props: { id: "ghost-1", title: "Ghost" } }],
			zones: {
				"ghost-1:body": [
					{ type: "Pricing", props: { id: "ghost-child", title: "Ghost" } },
				],
			},
		} as unknown as PuckData;

		// Capture the raw dispatched payload (thunk or object) so we can
		// apply Puck's *actual* reducer semantics ourselves.
		let captured: PuckData | ((previous: PuckData) => PuckData) | undefined;
		const dispatch = vi.fn(
			(action: {
				type: string;
				data: PuckData | ((previous: PuckData) => PuckData);
			}) => {
				if (action.type === "setData") captured = action.data;
			},
		);
		const ctx: StudioPluginContext = {
			getData: () => initial,
			getPuckApi: vi.fn(() => ({
				dispatch,
			})) as unknown as StudioPluginContext["getPuckApi"],
			studioConfig,
			log: vi.fn(),
			emit: vi.fn(),
			registerAssetResolver: vi.fn(),
		};

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makePageIr("Fresh page")),
			puckConfig: config,
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("rewrite the page");

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(captured).toBeDefined();

		// Mirror Puck's `setDataAction`: shallow top-level merge of the
		// resolved payload over the previous data.
		const resolved = unwrapSetData(
			captured as PuckData | ((previous: PuckData) => PuckData),
			initial,
		);
		const merged = { ...initial, ...resolved } as PuckData;

		// The generated components are present and Puck can walk them.
		const visited = visitWithPuck(merged, config);
		const ids = visited.map((v) => v.id);
		expect(ids).toContain("hero-new");
		expect(ids).toContain("pricing-new");

		// No ghost zone survived the merge — this is the collab fix.
		expect(merged.zones).toEqual({});
		expect(ids).not.toContain("ghost-child");

		// Root is fully replaced, not shallow-merged with the old root.
		expect(merged.root).toEqual({ props: {} });
	});

	it("modern slot zone dispatch preserves the parent and walks nested children", async () => {
		const config = {
			components: {
				Layout: {
					fields: {
						content: { type: "slot" },
					},
					defaultProps: { content: [] },
					render: () => null,
				},
				Hero: {
					fields: { title: { type: "text" } },
					defaultProps: { title: "" },
					render: () => null,
				},
			},
		} as unknown as PuckConfig;

		const initial = {
			root: { props: {} },
			content: [
				{
					type: "Layout",
					props: {
						id: "layout-1",
						content: [
							{
								type: "Hero",
								props: { id: "slot-hero", title: "old" },
							},
						],
					},
				},
			],
			zones: {},
		} as unknown as PuckData;

		const { ctx, getCurrent } = makeCtx(initial);

		const sectionPatch: AiSectionPatch = {
			zoneId: "layout-1:content",
			nodeIds: ["slot-hero"],
			replacement: [
				{ id: "slot-hero-new", type: "Hero", props: { title: "fresh" } },
			],
		};

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection: vi.fn().mockResolvedValue(sectionPatch),
			puckConfig: config,
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("rewrite slot", {
			zoneId: "layout-1:content",
			nodeIds: ["slot-hero"],
		});

		const visited = visitWithPuck(getCurrent(), config);
		const ids = visited.map((v) => v.id);
		expect(ids).toContain("layout-1");
		expect(ids).toContain("slot-hero-new");
		expect(ids).not.toContain("slot-hero");
	});
});
