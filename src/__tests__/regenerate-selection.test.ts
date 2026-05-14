import { StudioConfigSchema } from "@anvilkit/core";
import type {
	AiSectionPatch,
	AiSectionSelection,
	StudioPluginContext,
} from "@anvilkit/core/types";
import type { Config as PuckConfig, Data as PuckData } from "@puckeditor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applySectionPatch } from "../apply-section-patch.js";
import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";

const studioConfig = StudioConfigSchema.parse({});

function makePuckConfig(): PuckConfig {
	return {
		components: {
			Hero: {
				fields: {
					title: { type: "text" },
				},
				defaultProps: { title: "" },
				render: () => null,
			},
			Pricing: {
				fields: {
					title: { type: "text" },
				},
				defaultProps: { title: "" },
				render: () => null,
			},
		},
	} as unknown as PuckConfig;
}

function makeCanvas(): PuckData {
	return {
		root: { props: {} },
		content: [
			{ type: "Hero", props: { id: "hero-1", title: "Old hero" } },
			{ type: "Pricing", props: { id: "pricing-1", title: "Pricing" } },
		],
		zones: {},
	} as unknown as PuckData;
}

function makeCtx(
	canvas: PuckData = makeCanvas(),
	overrides: Partial<StudioPluginContext> = {},
): StudioPluginContext {
	let current = canvas;
	return {
		getData: () => current,
		getPuckApi: vi.fn(() => ({
			dispatch: vi.fn((action: { type: string; data: PuckData }) => {
				if (action.type === "setData") {
					current = action.data;
				}
			}),
		})) as unknown as StudioPluginContext["getPuckApi"],
		studioConfig,
		log: vi.fn(),
		emit: vi.fn(),
		registerAssetResolver: vi.fn(),
		...overrides,
	};
}

async function initPlugin(
	ctx: StudioPluginContext,
	plugin: ReturnType<typeof createAiCopilotPlugin>,
): Promise<void> {
	const registration = await plugin.register(ctx);
	await registration.hooks?.onInit?.(ctx);
}

const heroSelection: AiSectionSelection = {
	zoneId: "root-zone",
	nodeIds: ["hero-1"],
};

function validHeroPatch(title = "New hero"): AiSectionPatch {
	return {
		zoneId: "root-zone",
		nodeIds: ["hero-1"],
		replacement: [{ id: "hero-1-regen", type: "Hero", props: { title } }],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("createAiCopilotPlugin — regenerateSelection", () => {
	it("dispatches setData when generateSection returns a valid patch", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const generateSection = vi.fn().mockResolvedValue(validHeroPatch());

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("rewrite the hero", heroSelection);

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "setData" });
		const dispatched = dispatch.mock.calls[0][0].data as PuckData;
		// Hero replaced; Pricing untouched.
		expect(dispatched.content[0]).toMatchObject({
			type: "Hero",
			props: { id: "hero-1-regen", title: "New hero" },
		});
		expect(dispatched.content[1]).toMatchObject({
			type: "Pricing",
			props: { id: "pricing-1", title: "Pricing" },
		});
	});

	it("emits VALIDATION_FAILED when the patch fails validateAiSectionPatch", async () => {
		const ctx = makeCtx();
		const generateSection = vi.fn().mockResolvedValue({
			zoneId: "root-zone",
			nodeIds: ["hero-1"],
			replacement: [{ id: "x", type: "DoesNotExist", props: { title: "Hi" } }],
		});

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("nope", heroSelection);

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({
				code: "VALIDATION_FAILED",
				issues: expect.arrayContaining([
					expect.objectContaining({ severity: "error" }),
				]),
			}),
		);
		// Issues carry the structured `[CODE]` prefix from
		// validateAiSectionPatch so the UI can branch on the section codes.
		const payload = (ctx.emit as ReturnType<typeof vi.fn>).mock.calls.find(
			(c) => c[0] === "ai-copilot:error",
		)?.[1] as { issues?: Array<{ message: string }> };
		expect(payload?.issues?.[0]?.message).toMatch(/\[DISALLOWED_COMPONENT\]/);
	});

	it("emits TIMEOUT when generateSection exceeds timeoutMs", async () => {
		vi.useFakeTimers();
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection: () =>
				new Promise(() => {
					/* hang forever */
				}),
			puckConfig: makePuckConfig(),
			timeoutMs: 5_000,
		});

		await initPlugin(ctx, plugin);
		const promise = plugin.regenerateSelection("slow", heroSelection);
		await vi.advanceTimersByTimeAsync(5_001);
		await promise;

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "TIMEOUT" }),
		);
	});

	it("emits GENERATE_FAILED when generateSection throws", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection: vi.fn().mockRejectedValue(new Error("network down")),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("...", heroSelection);

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({
				code: "GENERATE_FAILED",
				message: "network down",
			}),
		);
	});

	it("emits GENERATE_FAILED when generateSection is not configured", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("...", heroSelection);

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({
				code: "GENERATE_FAILED",
				message: expect.stringContaining("no generateSection callback"),
			}),
		);
	});

	it("emits APPLY_FAILED when nodeIds are not found in the canvas", async () => {
		const ctx = makeCtx();
		const generateSection = vi.fn().mockResolvedValue({
			zoneId: "root-zone",
			nodeIds: ["does-not-exist"],
			replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
		} satisfies AiSectionPatch);

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("...", {
			zoneId: "root-zone",
			nodeIds: ["does-not-exist"],
		});

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "APPLY_FAILED" }),
		);
	});

	it("does not affect the existing runGeneration flow", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const generatePage = vi.fn().mockResolvedValue({
			version: "1",
			root: {
				id: "root",
				type: "__root__",
				props: {},
				children: [
					{ id: "h", type: "Hero", props: { title: "Whole-page rewrite" } },
				],
			},
			assets: [],
			metadata: {},
		});

		const plugin = createAiCopilotPlugin({
			generatePage,
			generateSection: vi.fn().mockResolvedValue(validHeroPatch()),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("rewrite whole page");

		expect(generatePage).toHaveBeenCalledTimes(1);
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "setData" });
	});

	it("forwards selection.allow / disallow into the generated context", async () => {
		const ctx = makeCtx();
		const generateSection = vi.fn().mockResolvedValue(validHeroPatch());

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("rewrite", {
			zoneId: "root-zone",
			nodeIds: ["hero-1"],
			zoneKind: "slot",
			allow: ["Hero"],
		});

		expect(generateSection).toHaveBeenCalledTimes(1);
		const [, sectionCtx] = generateSection.mock.calls[0];
		expect(sectionCtx.zoneKind).toBe("slot");
		expect(
			sectionCtx.availableComponents.map(
				(c: { componentName: string }) => c.componentName,
			),
		).toEqual(["Hero"]);
	});

	it("ignores stale section runs when a newer run is started", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		let resolveFirst!: (p: AiSectionPatch) => void;
		let resolveSecond!: (p: AiSectionPatch) => void;
		const firstPatch = new Promise<AiSectionPatch>((r) => {
			resolveFirst = r;
		});
		const secondPatch = new Promise<AiSectionPatch>((r) => {
			resolveSecond = r;
		});

		const generateSection = vi.fn((prompt: string) =>
			prompt === "first" ? firstPatch : secondPatch,
		);

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		const firstRun = plugin.regenerateSelection("first", heroSelection);
		const secondRun = plugin.regenerateSelection("second", heroSelection);

		resolveSecond(validHeroPatch("Second"));
		await secondRun;
		expect(dispatch).toHaveBeenCalledTimes(1);

		resolveFirst(validHeroPatch("First"));
		await firstRun;
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it("only ever passes (prompt, ctx) to generateSection — no auth leak", async () => {
		const ctx = makeCtx();
		const generateSection = vi.fn().mockResolvedValue(validHeroPatch());

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("hello", heroSelection);

		expect(generateSection).toHaveBeenCalledTimes(1);
		expect(generateSection.mock.calls[0]).toHaveLength(2);
		const [prompt, sectionCtx] = generateSection.mock.calls[0];
		expect(prompt).toBe("hello");
		const serialized = JSON.stringify(sectionCtx);
		expect(serialized).not.toMatch(/api[_-]?key/i);
		expect(serialized).not.toMatch(/authorization/i);
		expect(serialized).not.toMatch(/bearer/i);
	});
});

describe("applySectionPatch", () => {
	it("replaces a single root-content node and preserves siblings", () => {
		const data = makeCanvas();
		const next = applySectionPatch(data, validHeroPatch("Replaced"));
		expect(next.content[0]).toMatchObject({
			type: "Hero",
			props: { id: "hero-1-regen", title: "Replaced" },
		});
		expect(next.content[1]).toMatchObject({
			type: "Pricing",
			props: { id: "pricing-1" },
		});
	});

	it("supports multi-node contiguous replacement", () => {
		const data = {
			root: { props: {} },
			content: [
				{ type: "Hero", props: { id: "a", title: "A" } },
				{ type: "Hero", props: { id: "b", title: "B" } },
				{ type: "Pricing", props: { id: "c", title: "C" } },
			],
			zones: {},
		} as unknown as PuckData;

		const next = applySectionPatch(data, {
			zoneId: "root-zone",
			nodeIds: ["a", "b"],
			replacement: [{ id: "merged", type: "Hero", props: { title: "Merged" } }],
		});

		expect(next.content).toHaveLength(2);
		expect(next.content[0]).toMatchObject({
			type: "Hero",
			props: { id: "merged", title: "Merged" },
		});
		expect(next.content[1]).toMatchObject({
			type: "Pricing",
			props: { id: "c" },
		});
	});

	it("throws when nodeIds are not contiguous", () => {
		const data = {
			root: { props: {} },
			content: [
				{ type: "Hero", props: { id: "a" } },
				{ type: "Pricing", props: { id: "b" } },
				{ type: "Hero", props: { id: "c" } },
			],
			zones: {},
		} as unknown as PuckData;

		expect(() =>
			applySectionPatch(data, {
				zoneId: "root-zone",
				nodeIds: ["a", "c"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			}),
		).toThrow(/contiguous/);
	});

	it("rewrites a legacy data.zones entry", () => {
		const data = {
			root: { props: {} },
			content: [{ type: "Hero", props: { id: "parent" } }],
			zones: {
				"parent:children": [
					{ type: "Hero", props: { id: "z1", title: "old" } },
				],
			},
		} as unknown as PuckData;

		const next = applySectionPatch(data, {
			zoneId: "parent:children",
			nodeIds: ["z1"],
			replacement: [{ id: "z1-new", type: "Hero", props: { title: "new" } }],
		});

		const zones = next.zones as Record<
			string,
			Array<{ props: { id: string; title?: string } }>
		>;
		expect(zones["parent:children"][0]).toMatchObject({
			props: { id: "z1-new", title: "new" },
		});
	});

	it("rewrites a modern slot zone living inside a parent's props", () => {
		const data = {
			root: { props: {} },
			content: [
				{
					type: "Layout",
					props: {
						id: "layout-1",
						content: [
							{ type: "Hero", props: { id: "slot-hero", title: "old" } },
						],
					},
				},
			],
			zones: {},
		} as unknown as PuckData;

		const next = applySectionPatch(data, {
			zoneId: "layout-1:content",
			nodeIds: ["slot-hero"],
			replacement: [
				{ id: "slot-hero-new", type: "Hero", props: { title: "new" } },
			],
		});

		const layout = next.content[0] as {
			props: {
				content: Array<{ props: { id: string; title?: string } }>;
			};
		};
		expect(layout.props.content[0]).toMatchObject({
			props: { id: "slot-hero-new", title: "new" },
		});
	});

	it("throws when the zone cannot be located", () => {
		const data = makeCanvas();
		expect(() =>
			applySectionPatch(data, {
				zoneId: "nonexistent:zone",
				nodeIds: ["hero-1"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			}),
		).toThrow(/not found/);
	});

	// --- ST-5 / ST-6 / ST-8 follow-ups ---

	it("rejects malformed zoneId with the structural reason from parseZoneId", () => {
		const data = makeCanvas();
		expect(() =>
			applySectionPatch(data, {
				zoneId: ":children",
				nodeIds: ["hero-1"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			}),
		).toThrow(/empty parentId/);
	});

	it("rejects malformed zoneId 'a::b' with the slotName-contains-colon reason", () => {
		const data = makeCanvas();
		expect(() =>
			applySectionPatch(data, {
				zoneId: "a::b",
				nodeIds: ["hero-1"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			}),
		).toThrow(/slotName contains/);
	});

	it("error message includes a JSON suffix with expected, found, and firstMismatch", () => {
		const data = {
			root: { props: {} },
			content: [
				{ type: "Hero", props: { id: "a" } },
				{ type: "Hero", props: { id: "b" } },
			],
			zones: {},
		} as unknown as PuckData;

		try {
			applySectionPatch(data, {
				zoneId: "root-zone",
				nodeIds: ["does-not-exist"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			});
			throw new Error("expected applySectionPatch to throw");
		} catch (err) {
			const message = (err as Error).message;
			expect(message).toMatch(/not found as a contiguous run/);
			const jsonMatch = message.match(/\{.*\}$/);
			expect(jsonMatch).not.toBeNull();
			const payload = JSON.parse((jsonMatch as RegExpMatchArray)[0]) as {
				expected: string[];
				found: string[];
				firstMismatch: number | null;
			};
			expect(payload.expected).toEqual(["does-not-exist"]);
			expect(payload.found).toEqual(["a", "b"]);
			expect(payload.firstMismatch).toBe(0);
		}
	});

	it("error 'found' surface names wrong-type ids when an item has a non-string id", () => {
		const data = {
			root: { props: {} },
			content: [
				{ type: "Hero", props: { id: 42 } },
				{ type: "Hero", props: { id: "b" } },
			],
			zones: {},
		} as unknown as PuckData;

		try {
			applySectionPatch(data, {
				zoneId: "root-zone",
				nodeIds: ["a"],
				replacement: [{ id: "x", type: "Hero", props: { title: "X" } }],
			});
			throw new Error("expected applySectionPatch to throw");
		} catch (err) {
			const message = (err as Error).message;
			const jsonMatch = message.match(/\{.*\}$/);
			expect(jsonMatch).not.toBeNull();
			const payload = JSON.parse((jsonMatch as RegExpMatchArray)[0]) as {
				found: string[];
			};
			expect(payload.found).toEqual(["<wrong-type:number>", "b"]);
		}
	});
});
