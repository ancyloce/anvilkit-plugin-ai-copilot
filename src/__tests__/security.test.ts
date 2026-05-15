/**
 * phase4-014 — hostile input battery for the AI copilot.
 *
 * Threat model: `generatePage()` is a host-owned callback that
 * delivers arbitrary JSON over the wire. The LLM may be prompted to
 * emit malformed IR, oversized payloads, executable-shaped data, or
 * references to components the host never declared. This suite
 * asserts the plugin rejects every such payload without dispatching
 * and surfaces a structured error (per `docs/security/plugin-trust-model.md`
 * §4 "validateAiOutput guarantees").
 *
 * If a test here starts failing, stop. Either the validator or the
 * plugin's error path regressed (fix them) or the trust-model doc
 * needs updating — never weaken the assertion to make the test pass.
 */
import { StudioConfigSchema } from "@anvilkit/core";
import type { PageIR, StudioPluginContext } from "@anvilkit/core/types";
import type { Config as PuckConfig, Data as PuckData } from "@puckeditor/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function initPlugin(
	ctx: StudioPluginContext,
	plugin: ReturnType<typeof createAiCopilotPlugin>,
): Promise<void> {
	const registration = await plugin.register(ctx);
	await registration.hooks?.onInit?.(ctx);
}

/** Assert that no dispatch happened and a structured error was surfaced. */
function expectRejectedWith(
	ctx: StudioPluginContext,
	dispatch: ReturnType<typeof vi.fn>,
	code: "VALIDATION_FAILED" | "TIMEOUT" | "GENERATE_FAILED" | "APPLY_FAILED",
): void {
	expect(dispatch).not.toHaveBeenCalled();
	expect(ctx.emit).toHaveBeenCalledWith(
		"ai-copilot:error",
		expect.objectContaining({ code }),
	);
	expect(ctx.log).toHaveBeenCalledWith(
		"error",
		expect.any(String),
		expect.objectContaining({ code }),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("AI copilot — malformed PageIR rejected at the validator boundary", () => {
	it("rejects non-object response (LLM returns a raw string)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi
				.fn()
				.mockResolvedValue("not a PageIR, just a string" as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects response missing the version field", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				root: { id: "r", type: "__root__", props: {}, children: [] },
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects response with a wrong version", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "2",
				root: { id: "r", type: "__root__", props: {}, children: [] },
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects a response where root.type is not __root__ (phase4-014 F-1 closed)", async () => {
		// F-1 closed: validateAiOutput now enforces
		// root.type === "__root__" exactly.
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: { id: "r", type: "Hero", props: {}, children: [] },
				assets: [],
				metadata: {},
			} as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects a component type the host did not declare", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					props: {},
					children: [{ id: "x", type: "NotADeclaredComponent", props: {} }],
				},
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects non-array children with INVALID_CHILDREN (phase4-014 F-2 closed)", async () => {
		// F-2 closed: validateAiOutput now rejects a non-array
		// `children` before the plugin calls irToPuckPatch. The
		// pipeline surfaces VALIDATION_FAILED instead of throwing
		// `.map is not a function` uncaught.
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					props: {},
					children: "not an array" as unknown as [],
				},
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects a response missing root props before conversion", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					children: [],
				},
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects component nodes missing id or props before conversion", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					props: {},
					children: [{ type: "Hero" }],
				},
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects function props as non-serialisable (phase4-014 F-3 closed)", async () => {
		// F-3 closed: validateAiOutput now rejects any function,
		// symbol, or bigint inside a node's props recursively. This
		// preserves the PageIR JSON-serialisability invariant.
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const evilIr = {
			version: "1" as const,
			root: {
				id: "r",
				type: "__root__" as const,
				props: {},
				children: [
					{
						id: "h",
						type: "Hero",
						props: { title: "ok", onBoot: () => "pwn" },
					},
				],
			},
			assets: [],
			metadata: {},
		};
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(evilIr as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects null response", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(null as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("rejects an array-shaped response (LLM wrapped the doc in a list)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi
				.fn()
				.mockResolvedValue([{ version: "1" }] as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});
});

describe("AI copilot — oversized and pathological payloads", () => {
	it("accepts a large but well-formed IR (1,000 valid nodes) — the validator is not a cost limiter", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const children = Array.from({ length: 1000 }, (_, i) => ({
			id: `h-${i}`,
			type: "Hero",
			props: { title: `Hero ${i}` },
		}));
		const bigIr: PageIR = {
			version: "1",
			root: { id: "r", type: "__root__", props: {}, children },
			assets: [],
			metadata: {},
		};
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(bigIr),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("build big");

		// Intentionally accepted: the validator is a shape gate, not a
		// cost cap. Host rate-limiting / size-capping lives in
		// generatePage() per the trust model §3.
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(ctx.emit).not.toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.anything(),
		);
	});

	it("rejects oversized string props only when they break IR shape (e.g. non-string title)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const bigString = "A".repeat(1_000_000); // 1 MB of A
		const evilIr = {
			version: "1" as const,
			root: {
				id: "r",
				type: "__root__" as const,
				props: {},
				children: [
					{
						id: "h",
						type: "Hero",
						// Object where a string is expected — validator rejects.
						props: { title: { buf: bigString } },
					},
				],
			},
			assets: [],
			metadata: {},
		};
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(evilIr as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("enforces timeoutMs even if generatePage promises to return a valid IR eventually", async () => {
		vi.useFakeTimers();
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: () =>
				new Promise(() => {
					/* never resolves — simulates hanging LLM */
				}),
			puckConfig: makePuckConfig(),
			timeoutMs: 1_000,
		});
		await initPlugin(ctx, plugin);
		const pending = plugin.runGeneration("x");
		await vi.advanceTimersByTimeAsync(1_001);
		await pending;

		expectRejectedWith(ctx, dispatch, "TIMEOUT");
	});
});

describe("AI copilot — prompt-injection-shaped responses", () => {
	it("rejects a response that is a JSON-as-string (LLM ignored structured output)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi
				.fn()
				.mockResolvedValue(
					'{"version":"1","root":{"type":"__root__"}}' as unknown as PageIR,
				),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		// A string that parses to the right shape must still be rejected;
		// validateAiOutput does not auto-deserialize.
		expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
	});

	it("accepts hostile string content inside a valid IR (the exporter is the XSS gate)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const evilButValid: PageIR = {
			version: "1",
			root: {
				id: "r",
				type: "__root__",
				props: {},
				children: [
					{
						id: "h",
						type: "Hero",
						props: { title: "<script>alert(1)</script>" },
					},
				],
			},
			assets: [],
			metadata: {},
		};
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue(evilButValid),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		// The plugin accepts — trust model §4: the validator is a shape
		// gate, not an XSS gate. The HTML exporter is the sanitizer,
		// covered by plugin-export-html/__tests__/security.test.ts.
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it("rejects a response whose children array contains a nested setData shape (ignored keys)", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn();
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });

		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					props: {},
					children: [
						{
							id: "h",
							type: "Hero",
							props: { title: "ok" },
							// The LLM tried to smuggle an extra payload.
							// Zod strips unknown keys or rejects — either way
							// the plugin never interprets this as an action.
							__proto__: { polluted: true },
							dispatch: { type: "setData", data: { destroy: true } },
						},
					],
				},
				assets: [],
				metadata: {},
			} as unknown as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		// Either:
		//   - Zod strips unknown keys → dispatch is called once with
		//     { type: "setData" } only. The nested `dispatch` object is
		//     inert because the plugin only ever calls
		//     puckApi.dispatch({ type: "setData", data: irToPuckPatch(ir) }).
		//   - Zod rejects the unknown keys → VALIDATION_FAILED.
		// Both are acceptable; the forbidden outcome is the nested
		// `destroy: true` ending up in a dispatched action.
		if (dispatch.mock.calls.length > 0) {
			const first = dispatch.mock.calls[0][0] as {
				type: string;
				data: PuckData | ((previous: PuckData) => PuckData);
			};
			expect(first.type).toBe("setData");
			// Resolve the functional `setData` payload before
			// stringifying — a thunk would be dropped by JSON.stringify,
			// making the `destroy` check vacuously pass.
			const payload = JSON.stringify(unwrapSetData(first.data, {} as PuckData));
			expect(payload).not.toContain("destroy");
		} else {
			expectRejectedWith(ctx, dispatch, "VALIDATION_FAILED");
		}
	});
});

describe("AI copilot — never dispatches silently", () => {
	it("emits + logs on every failure path (VALIDATION_FAILED)", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({} as PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");
		expect(ctx.emit).toHaveBeenCalledTimes(1);
		expect(ctx.log).toHaveBeenCalledTimes(1);
	});

	it("emits + logs on GENERATE_FAILED", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockRejectedValue(new Error("boom")),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");
		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "GENERATE_FAILED" }),
		);
		expect(ctx.log).toHaveBeenCalledWith(
			"error",
			"boom",
			expect.objectContaining({ code: "GENERATE_FAILED" }),
		);
	});

	it("emits + logs on APPLY_FAILED when Puck dispatch throws", async () => {
		const ctx = makeCtx();
		const dispatch = vi.fn(() => {
			throw new Error("dispatch failed");
		});
		(ctx.getPuckApi as ReturnType<typeof vi.fn>).mockReturnValue({ dispatch });
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockResolvedValue({
				version: "1",
				root: {
					id: "r",
					type: "__root__",
					props: {},
					children: [{ id: "h", type: "Hero", props: { title: "ok" } }],
				},
				assets: [],
				metadata: {},
			} satisfies PageIR),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		expect(ctx.emit).toHaveBeenCalledWith(
			"ai-copilot:error",
			expect.objectContaining({ code: "APPLY_FAILED" }),
		);
		expect(ctx.log).toHaveBeenCalledWith(
			"error",
			"dispatch failed",
			expect.objectContaining({ code: "APPLY_FAILED" }),
		);
	});

	it("does not leak stack traces or secrets via the error message on thrown non-Error", async () => {
		const ctx = makeCtx();
		const plugin = createAiCopilotPlugin({
			generatePage: vi.fn().mockImplementation(async () => {
				// eslint-disable-next-line no-throw-literal
				throw { apiKey: "sk-secret" };
			}),
			puckConfig: makePuckConfig(),
		});
		await initPlugin(ctx, plugin);
		await plugin.runGeneration("x");

		const emitCall = (ctx.emit as ReturnType<typeof vi.fn>).mock.calls[0];
		const payload = JSON.stringify(emitCall);
		// The non-Error throwable is stringified via String(err) →
		// "[object Object]"; it must not spill the secret key.
		expect(payload).not.toContain("sk-secret");
	});
});
