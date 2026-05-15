import { compilePlugins, StudioConfigSchema } from "@anvilkit/core";
import type { PageIR, StudioPluginContext } from "@anvilkit/core/types";
import * as schema from "@anvilkit/schema";
import type { Config as PuckConfig, Data as PuckData } from "@puckeditor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";
import { unwrapSetData } from "./fixtures/unwrap-set-data.js";

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
		},
	} as unknown as PuckConfig;
}

function makeCtx(
	overrides: Partial<StudioPluginContext> = {},
): StudioPluginContext {
	return {
		getData: () => ({ root: { props: {} }, content: [], zones: {} }),
		getPuckApi: vi.fn(() => ({
			dispatch: vi.fn(),
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

async function initPlugin(
	ctx: StudioPluginContext,
	plugin: ReturnType<typeof createAiCopilotPlugin>,
): Promise<void> {
	const registration = await plugin.register(ctx);
	await registration.hooks?.onInit?.(ctx);
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("createAiCopilotPlugin", () => {
	it("dispatches setData on a valid generatePage response", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr()),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("build me a hero");

		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "setData" });
	});

	it("emits VALIDATION_FAILED when generatePage returns an invalid IR", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "root",
					type: "__root__",
					props: {},
					children: [{ id: "x", type: "NotARealComponent", props: {} }],
				},
				assets: [],
				metadata: {},
			}),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("...");

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "VALIDATION_FAILED" }),
		);
	});

	it("emits TIMEOUT when generatePage exceeds timeoutMs (fake timers)", async () => {
		vi.useFakeTimers();

		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: () =>
				new Promise(() => {
					// Intentionally never resolves; timeout handling is under test.
				}),
			puckConfig: makePuckConfig(),
			timeoutMs: 5_000,
		});

		await initPlugin(ctx, plugin);
		const promise = plugin.runGeneration("...");
		await vi.advanceTimersByTimeAsync(5_001);
		await promise;

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "TIMEOUT" }),
		);
	});

	it("clears the timeout timer when generatePage resolves first", async () => {
		vi.useFakeTimers();

		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr()),
			puckConfig: makePuckConfig(),
			timeoutMs: 5_000,
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("fast");

		expect(vi.getTimerCount()).toBe(0);
	});

	it("emits GENERATE_FAILED when generatePage throws", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockRejectedValue(new Error("network down")),
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("...");

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({
				code: "GENERATE_FAILED",
				message: "network down",
			}),
		);
	});

	it("calls configToAiContext exactly once per plugin instance lifecycle", async () => {
		const ctx = makeCtx();
		const configToAiContextSpy = vi.spyOn(schema, "configToAiContext");
		const generatePage = vi.fn().mockResolvedValue(makeValidIr());
		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("a");
		await plugin.runGeneration("b");
		await plugin.runGeneration("c");

		expect(configToAiContextSpy).toHaveBeenCalledTimes(1);
		expect(generatePage).toHaveBeenCalledTimes(3);
		const firstCtx = generatePage.mock.calls[0][1];
		const secondCtx = generatePage.mock.calls[1][1];
		const thirdCtx = generatePage.mock.calls[2][1];
		expect(firstCtx.availableComponents).toBe(secondCtx.availableComponents);
		expect(firstCtx.availableComponents).toBe(thirdCtx.availableComponents);
	});

	it("ignores stale overlapping generation results", async () => {
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

		second.resolve(makeValidIr("Second"));
		await secondRun;
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(
			unwrapSetData(dispatch.mock.calls[0][0].data, {} as PuckData).content[0]
				.props.title,
		).toBe("Second");

		first.resolve(makeValidIr("First"));
		await firstRun;
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it("only ever passes (prompt, ctx) to generatePage - no credentials leak", async () => {
		const ctx = makeCtx();
		const generatePage = vi.fn().mockResolvedValue(makeValidIr());
		const plugin = createAiCopilotPlugin({
			generatePage,
			puckConfig: makePuckConfig(),
		});

		await initPlugin(ctx, plugin);
		await plugin.runGeneration("hello");

		expect(generatePage).toHaveBeenCalledTimes(1);
		expect(generatePage.mock.calls[0]).toHaveLength(2);
		const [prompt, generationCtx] = generatePage.mock.calls[0];
		expect(prompt).toBe("hello");
		expect(Object.keys(generationCtx).sort()).toEqual(
			["availableComponents"].sort(),
		);
		const serialized = JSON.stringify(generationCtx);
		expect(serialized).not.toMatch(/api[_-]?key/i);
		expect(serialized).not.toMatch(/authorization/i);
		expect(serialized).not.toMatch(/bearer/i);
	});

	it("compiles cleanly through compilePlugins", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(makeValidIr()),
			puckConfig: makePuckConfig(),
		});

		const runtime = await compilePlugins([plugin], ctx);

		expect(runtime.pluginMeta).toHaveLength(1);
		expect(runtime.pluginMeta[0]?.id).toBe("anvilkit-plugin-ai-copilot");
	});
});
