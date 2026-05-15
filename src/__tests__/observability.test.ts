/**
 * @file Observability adapter tests for the copilot plugin (MT-1).
 *
 * Exercises the `onTrace` hook end-to-end: emission at every decision
 * point in `runGeneration` / `regenerateSelection`, isolation from
 * generation-pipeline failures (a throwing observer must not break the
 * run), and the contract that `onTrace` payloads carry only structural
 * metadata — never the forwarded Puck data.
 */

import { StudioConfigSchema } from "@anvilkit/core";
import type {
	AiSectionPatch,
	AiSectionSelection,
	PageIR,
	StudioPluginContext,
} from "@anvilkit/core/types";
import type { Config as PuckConfig, Data as PuckData } from "@puckeditor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";
import type { AiCopilotTraceEvent } from "../types.js";
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
		},
	} as unknown as PuckConfig;
}

function makeCanvas(): PuckData {
	return {
		root: { props: {} },
		content: [{ type: "Hero", props: { id: "hero-1", title: "Original" } }],
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
			dispatch: vi.fn(
				(action: {
					type: string;
					data: PuckData | ((previous: PuckData) => PuckData);
				}) => {
					if (action.type === "setData") {
						current = unwrapSetData(action.data, current);
					}
				},
			),
		})) as unknown as StudioPluginContext["getPuckApi"],
		studioConfig,
		log: vi.fn(),
		emit: vi.fn(),
		registerAssetResolver: vi.fn(),
		...overrides,
	};
}

function makeValidIr(title = "Hello"): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [{ id: "hero-1", type: "Hero", props: { title } }],
		},
		assets: [],
		metadata: {},
	};
}

const heroSelection: AiSectionSelection = {
	zoneId: "root-zone",
	nodeIds: ["hero-1"],
};

function validHeroPatch(title = "New"): AiSectionPatch {
	return {
		zoneId: "root-zone",
		nodeIds: ["hero-1"],
		replacement: [{ id: "hero-1-regen", type: "Hero", props: { title } }],
	};
}

async function initPlugin(
	ctx: StudioPluginContext,
	plugin: ReturnType<typeof createAiCopilotPlugin>,
): Promise<{ onDestroy: (() => void) | undefined }> {
	const registration = await plugin.register(ctx);
	await registration.hooks?.onInit?.(ctx);
	return { onDestroy: registration.hooks?.onDestroy };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("createAiCopilotPlugin — onTrace observability", () => {
	it("emits start → validated → dispatched on a happy-path page run", async () => {
		const ctx = makeCtx();
		const events: AiCopilotTraceEvent[] = [];

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr("Hi")),
			puckConfig: makePuckConfig(),
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hello world");

		const types = events.map((e) => e.type);
		expect(types).toEqual([
			"generation-start",
			"generation-validated",
			"generation-dispatched",
		]);
		for (const e of events) {
			expect(e.flow).toBe("page");
			expect(e.generationId).toBe(1);
		}
		const first = events[0] as Extract<
			AiCopilotTraceEvent,
			{ type: "generation-start" }
		>;
		expect(first.promptLength).toBe("hello world".length);
	});

	it("emits generation-failed with VALIDATION_FAILED on bad IR", async () => {
		const ctx = makeCtx();
		const events: AiCopilotTraceEvent[] = [];

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "root",
					type: "__root__",
					props: {},
					children: [{ id: "x", type: "DoesNotExist", props: {} }],
				},
				assets: [],
				metadata: {},
			}),
			puckConfig: makePuckConfig(),
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("bad");

		const failed = events.find((e) => e.type === "generation-failed");
		expect(failed).toMatchObject({
			type: "generation-failed",
			flow: "page",
			code: "VALIDATION_FAILED",
		});
		expect(
			events.find((e) => e.type === "generation-dispatched"),
		).toBeUndefined();
	});

	it("emits generation-failed with TIMEOUT when the host hangs", async () => {
		vi.useFakeTimers();
		const ctx = makeCtx();
		const events: AiCopilotTraceEvent[] = [];

		const plugin = createAiCopilotPlugin({
			generatePage: () =>
				new Promise(() => {
					/* hang */
				}),
			puckConfig: makePuckConfig(),
			timeoutMs: 1_000,
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		const promise = plugin.runGeneration("slow");
		await vi.advanceTimersByTimeAsync(1_001);
		await promise;

		const failed = events.find((e) => e.type === "generation-failed");
		expect(failed).toMatchObject({ code: "TIMEOUT", flow: "page" });
	});

	it("emits generation-stale-drop when an older run resolves after a newer one", async () => {
		const ctx = makeCtx();
		const events: AiCopilotTraceEvent[] = [];

		let resolveFirst!: (ir: PageIR) => void;
		let resolveSecond!: (ir: PageIR) => void;
		const first = new Promise<PageIR>((r) => {
			resolveFirst = r;
		});
		const second = new Promise<PageIR>((r) => {
			resolveSecond = r;
		});

		const generatePage = vi.fn((prompt: string) =>
			prompt === "first" ? first : second,
		);

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		const firstRun = plugin.runGeneration("first");
		const secondRun = plugin.runGeneration("second");

		resolveSecond(makeValidIr("Second"));
		await secondRun;

		resolveFirst(makeValidIr("First"));
		await firstRun;

		const stale = events.find((e) => e.type === "generation-stale-drop");
		expect(stale).toMatchObject({
			type: "generation-stale-drop",
			flow: "page",
			generationId: 1,
		});
	});

	it("section flow emits start → validated → dispatched with flow=section", async () => {
		const ctx = makeCtx();
		const events: AiCopilotTraceEvent[] = [];

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn(),
			generateSection: vi.fn().mockResolvedValue(validHeroPatch()),
			puckConfig: makePuckConfig(),
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		await plugin.regenerateSelection("rewrite", heroSelection);

		const types = events.map((e) => e.type);
		expect(types).toEqual([
			"generation-start",
			"generation-validated",
			"generation-dispatched",
		]);
		for (const e of events) expect(e.flow).toBe("section");
	});

	it("a throwing onTrace handler does not break the generation pipeline", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr("OK")),
			puckConfig: makePuckConfig(),
			onTrace: () => {
				throw new Error("observer crashed");
			},
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hi");

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(ctx.log).toHaveBeenCalledWith(
			"warn",
			expect.stringContaining("onTrace"),
			expect.objectContaining({ event: expect.any(String) }),
		);
	});

	it("onTrace events never include the forwarded Puck data payload", async () => {
		const canvas = makeCanvas();
		const ctx = makeCtx(canvas);
		const events: AiCopilotTraceEvent[] = [];

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr("OK")),
			puckConfig: makePuckConfig(),
			forwardCurrentData: true,
			onTrace: (e) => events.push(e),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hi");

		const serialized = JSON.stringify(events);
		// Original canvas had a hero titled "Original" — make sure that
		// content is NOT visible through the trace stream.
		expect(serialized).not.toContain("Original");
		expect(serialized).not.toContain("hero-1");
	});
});
