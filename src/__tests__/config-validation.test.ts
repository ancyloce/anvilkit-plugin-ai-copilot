/**
 * @file Runtime structural validation of `AiCopilotOptions` (MT-7).
 *
 * `createAiCopilotPlugin` accepts an options bag from the host. Bad
 * inputs that would otherwise surface as confusing first-generation
 * errors (e.g. "generatePage is not a function" 30s into the first
 * prompt) are caught synchronously at construction with a single,
 * tagged `[CONFIG_INVALID]` message so the host integration fails
 * fast and predictably.
 */

import type { Config as PuckConfig } from "@puckeditor/core";
import { describe, expect, it, vi } from "vitest";

import { createAiCopilotPlugin } from "../create-ai-copilot-plugin.js";
import type { AiCopilotOptions } from "../types.js";

function baseOpts(overrides: Partial<AiCopilotOptions> = {}): AiCopilotOptions {
	return {
		generatePage: vi.fn(),
		puckConfig: { components: {} } as unknown as PuckConfig,
		...overrides,
	};
}

describe("createAiCopilotPlugin — CONFIG_INVALID", () => {
	it("throws when generatePage is missing", () => {
		expect(() =>
			createAiCopilotPlugin({
				puckConfig: { components: {} },
			} as unknown as AiCopilotOptions),
		).toThrow(/\[CONFIG_INVALID\].*generatePage/);
	});

	it("throws when generatePage is not a function", () => {
		expect(() =>
			createAiCopilotPlugin({
				generatePage: "not a function",
				puckConfig: { components: {} },
			} as unknown as AiCopilotOptions),
		).toThrow(/\[CONFIG_INVALID\].*generatePage/);
	});

	it("throws when generateSection is provided but not a function", () => {
		expect(() =>
			createAiCopilotPlugin(
				baseOpts({
					generateSection: 42 as unknown as AiCopilotOptions["generateSection"],
				}),
			),
		).toThrow(/\[CONFIG_INVALID\].*generateSection/);
	});

	it("throws when timeoutMs is zero", () => {
		expect(() => createAiCopilotPlugin(baseOpts({ timeoutMs: 0 }))).toThrow(
			/\[CONFIG_INVALID\].*timeoutMs/,
		);
	});

	it("throws when timeoutMs is negative", () => {
		expect(() => createAiCopilotPlugin(baseOpts({ timeoutMs: -1 }))).toThrow(
			/\[CONFIG_INVALID\].*timeoutMs/,
		);
	});

	it("throws when timeoutMs is NaN", () => {
		expect(() => createAiCopilotPlugin(baseOpts({ timeoutMs: NaN }))).toThrow(
			/\[CONFIG_INVALID\].*timeoutMs/,
		);
	});

	it("throws when timeoutMs is Infinity", () => {
		expect(() =>
			createAiCopilotPlugin(baseOpts({ timeoutMs: Infinity })),
		).toThrow(/\[CONFIG_INVALID\].*timeoutMs/);
	});

	it("throws when puckConfig is null", () => {
		expect(() =>
			createAiCopilotPlugin({
				generatePage: vi.fn(),
				puckConfig: null,
			} as unknown as AiCopilotOptions),
		).toThrow(/\[CONFIG_INVALID\].*puckConfig/);
	});

	it("throws when puckConfig is undefined", () => {
		expect(() =>
			createAiCopilotPlugin({
				generatePage: vi.fn(),
			} as unknown as AiCopilotOptions),
		).toThrow(/\[CONFIG_INVALID\].*puckConfig/);
	});

	it("throws when sanitizeCurrentData is provided but not a function", () => {
		expect(() =>
			createAiCopilotPlugin(
				baseOpts({
					sanitizeCurrentData:
						{} as unknown as AiCopilotOptions["sanitizeCurrentData"],
				}),
			),
		).toThrow(/\[CONFIG_INVALID\].*sanitizeCurrentData/);
	});

	it("throws when onTrace is provided but not a function", () => {
		expect(() =>
			createAiCopilotPlugin(
				baseOpts({
					onTrace: "log" as unknown as AiCopilotOptions["onTrace"],
				}),
			),
		).toThrow(/\[CONFIG_INVALID\].*onTrace/);
	});

	it("accepts a fully valid options bag without throwing", () => {
		expect(() =>
			createAiCopilotPlugin(
				baseOpts({
					generateSection: vi.fn(),
					timeoutMs: 1_000,
					forwardCurrentData: true,
					sanitizeCurrentData: (d) => d,
					onTrace: () => undefined,
				}),
			),
		).not.toThrow();
	});

	it("accepts the minimum valid options bag (only generatePage + puckConfig)", () => {
		expect(() => createAiCopilotPlugin(baseOpts())).not.toThrow();
	});
});
