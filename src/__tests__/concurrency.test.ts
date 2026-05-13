/**
 * @file Concurrency / cancellation tests for the copilot plugin.
 *
 * Covers the `latestGenerationId` + `cachedStateByPlugin.has(plugin)`
 * closure that drops stale results. The closure is structurally
 * critical (it is the only thing preventing flickering UI state and
 * double-dispatched canvases) and previously rested on review-time
 * inspection alone — see review H4.
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

function makeValidIr(title: string): PageIR {
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

function validHeroPatch(title: string): AiSectionPatch {
	return {
		zoneId: "root-zone",
		nodeIds: ["hero-1"],
		replacement: [{ id: "hero-1-regen", type: "Hero", props: { title } }],
	};
}

const heroSelection: AiSectionSelection = {
	zoneId: "root-zone",
	nodeIds: ["hero-1"],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
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

describe("createAiCopilotPlugin — concurrency", () => {
	it("overlap: only the most recent runGeneration dispatch reaches puckApi", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const first = deferred<PageIR>();
		const second = deferred<PageIR>();
		const generatePage = vi.fn((prompt: string) =>
			prompt === "first" ? first.promise : second.promise,
		);

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		const firstRun = plugin.runGeneration("first");
		const secondRun = plugin.runGeneration("second");

		// Resolve in reverse order: second resolves first.
		second.resolve(makeValidIr("Second"));
		await secondRun;
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe(
			"Second",
		);

		// Now first resolves — but its generationId is stale, so the
		// dispatch must be dropped.
		first.resolve(makeValidIr("First"));
		await firstRun;
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe(
			"Second",
		);
	});

	it("mid-flight destroy: in-flight run does not dispatch or reportError after onDestroy", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const pending = deferred<PageIR>();
		const generatePage = vi.fn(() => pending.promise);

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
		});

		const { onDestroy } = await initPlugin(ctx, plugin);
		const run = plugin.runGeneration("anything");

		// Tear down the plugin before the callback resolves. The
		// `cachedStateByPlugin.has(plugin)` half of `isCurrentGeneration`
		// flips false here.
		onDestroy?.();

		pending.resolve(makeValidIr("After destroy"));
		await run;

		expect(dispatch).not.toHaveBeenCalled();
		expect(ctx.emit).not.toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.anything(),
		);
	});

	it("mid-flight destroy after generatePage throws: no reportError fires", async () => {
		const ctx = makeCtx();
		const pending = deferred<PageIR>();
		const generatePage = vi.fn(() => pending.promise);

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
		});

		const { onDestroy } = await initPlugin(ctx, plugin);
		const run = plugin.runGeneration("anything");

		onDestroy?.();
		pending.reject(new Error("network down"));
		await run;

		// `isCurrentGeneration()` returns false because the plugin was
		// destroyed, so the catch block returns without reporting.
		expect(ctx.emit).not.toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.anything(),
		);
	});

	it("page-section interleave: page-run started first is cancelled by a later section-run", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const pagePending = deferred<PageIR>();
		const generatePage = vi.fn(() => pagePending.promise);
		const generateSection = vi
			.fn()
			.mockResolvedValue(validHeroPatch("Section"));

		const plugin = createAiCopilotPlugin({
			generatePage,
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);

		// Start the page run; it parks on `pagePending`.
		const pageRun = plugin.runGeneration("page prompt");

		// Now interleave a section run. Its `++latestGenerationId` should
		// bump past the page run's id.
		await plugin.regenerateSelection("section prompt", heroSelection);

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe(
			"Section",
		);

		// Resolve the page run — its dispatch must now be dropped because
		// the section run advanced `latestGenerationId`.
		pagePending.resolve(makeValidIr("Page"));
		await pageRun;

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe(
			"Section",
		);
	});

	it("page-section interleave: section-run started first is cancelled by a later page-run", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const sectionPending = deferred<AiSectionPatch>();
		const generateSection = vi.fn(() => sectionPending.promise);
		const generatePage = vi.fn().mockResolvedValue(makeValidIr("Page"));

		const plugin = createAiCopilotPlugin({
			generatePage,
			generateSection,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);

		const sectionRun = plugin.regenerateSelection(
			"section prompt",
			heroSelection,
		);

		await plugin.runGeneration("page prompt");

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe("Page");

		sectionPending.resolve(validHeroPatch("Section"));
		await sectionRun;

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0].data.content[0].props.title).toBe("Page");
	});

	it("sanitizeCurrentData runs on each forwarded snapshot", async () => {
		const canvas = makeCanvas();
		const ctx = makeCtx(canvas);

		const sanitize = vi.fn(
			(d: PuckData) =>
				({
					...d,
					content: [],
				}) as PuckData,
		);

		const generatePage = vi.fn().mockResolvedValue(makeValidIr("OK"));

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
			forwardCurrentData: true,
			sanitizeCurrentData: sanitize,
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hello");

		expect(sanitize).toHaveBeenCalledTimes(1);
		const [, generationCtx] = generatePage.mock.calls[0];
		expect(generationCtx.currentData).toBeDefined();
		expect(generationCtx.currentData.content).toEqual([]);
	});

	it("sanitizeCurrentData is not called when forwardCurrentData is false", async () => {
		const ctx = makeCtx();
		const sanitize = vi.fn((d: PuckData) => d);

		const generatePage = vi.fn().mockResolvedValue(makeValidIr("OK"));

		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
			sanitizeCurrentData: sanitize,
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hello");

		expect(sanitize).not.toHaveBeenCalled();
	});
});
