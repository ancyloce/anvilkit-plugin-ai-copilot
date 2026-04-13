import type { GeneratePageFn } from "../types.js";

import { configToAiContext } from "@anvilkit/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoConfig } from "./fixtures/demo-config.js";
import {
	allFixtures,
	createMockGeneratePage,
	matchPromptToFixture,
} from "../mock/index.js";

const generationCtx = configToAiContext(demoConfig);

afterEach(() => {
	vi.useRealTimers();
});

describe("createMockGeneratePage", () => {
	it("matches the GeneratePageFn signature", async () => {
		const generatePage: GeneratePageFn = createMockGeneratePage();
		const result = await generatePage(
			"a hero for a saas landing page",
			generationCtx,
		);

		expect(result).toBeDefined();
	});

	it("returns the fixture IR for a known prompt", async () => {
		const generatePage = createMockGeneratePage();
		const fixture = matchPromptToFixture("a hero for a saas landing page");

		expect(fixture).toBeDefined();
		await expect(
			generatePage("a hero for a saas landing page", generationCtx),
		).resolves.toBe(fixture?.ir);
	});

	it("returns the fallback hero IR for an unknown prompt", async () => {
		const generatePage = createMockGeneratePage();
		const prompt = "xyzzy quux frobnicate";
		const result = await generatePage(prompt, generationCtx);

		expect(result.root.children[0]).toMatchObject({
			id: "hero-fallback",
			type: "Hero",
			props: {
				headline: prompt.slice(0, 80),
			},
		});
	});

	it("returns the same IR reference for repeated prompts", async () => {
		const generatePage = createMockGeneratePage();
		const first = await generatePage(
			"a hero for a saas landing page",
			generationCtx,
		);
		const second = await generatePage(
			"a hero for a saas landing page",
			generationCtx,
		);

		expect(first).toBe(second);
	});

	it("waits for delayMs before resolving", async () => {
		vi.useFakeTimers();

		const generatePage = createMockGeneratePage({ delayMs: 1_000 });
		const expected = allFixtures.find(
			(fixture) => fixture.prompts[0] === "a hero for a saas landing page",
		)?.ir;
		let resolved = false;
		const promise = generatePage(
			"a hero for a saas landing page",
			generationCtx,
		).then((result) => {
			resolved = true;
			return result;
		});

		await vi.advanceTimersByTimeAsync(500);
		expect(resolved).toBe(false);

		await vi.advanceTimersByTimeAsync(600);
		await expect(promise).resolves.toBe(expected);
		expect(resolved).toBe(true);
	});
});
