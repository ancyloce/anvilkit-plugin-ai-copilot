import type { PageIR } from "@anvilkit/core/types";

import type { GeneratePageFn } from "../types.js";
import { allFixtures, matchPromptToFixture } from "./fixtures/index.js";
import type { Fixture } from "./fixtures/index.js";

const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"about",
	"for",
	"in",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
]);

export interface CreateMockGeneratePageOptions {
	readonly delayMs?: number;
	readonly fixtures?: readonly Fixture[];
}

function tokenize(prompt: string): string[] {
	return prompt
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function matchFixtureFromList(
	prompt: string,
	fixtures: readonly Fixture[],
): Fixture | undefined {
	const promptTokens = new Set(tokenize(prompt));
	if (promptTokens.size === 0) {
		return undefined;
	}

	let bestFixture: Fixture | undefined;
	let bestScore = 0;

	for (const fixture of fixtures) {
		const fixtureTokens = new Set(fixture.prompts.flatMap(tokenize));
		let score = 0;
		for (const token of promptTokens) {
			if (fixtureTokens.has(token)) {
				score += 1;
			}
		}

		if (score > bestScore) {
			bestFixture = fixture;
			bestScore = score;
		}
	}

	return bestScore >= 2 ? bestFixture : undefined;
}

function fallbackIr(prompt: string): PageIR {
	return {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "hero-fallback",
					type: "Hero",
					props: {
						headline: prompt.slice(0, 80),
					},
				},
			],
		},
		assets: [],
		metadata: {
			createdAt: "2026-04-13T00:00:00.000Z",
		},
	};
}

export function createMockGeneratePage(
	opts: CreateMockGeneratePageOptions = {},
): GeneratePageFn {
	const delayMs = Math.max(0, opts.delayMs ?? 0);
	const fixtures = opts.fixtures ?? allFixtures;
	const cache = new Map<string, PageIR>();

	return async (prompt, _ctx) => {
		let ir = cache.get(prompt);
		if (!ir) {
			const fixture =
				opts.fixtures !== undefined
					? matchFixtureFromList(prompt, fixtures)
					: matchPromptToFixture(prompt);
			ir = fixture?.ir ?? fallbackIr(prompt);
			cache.set(prompt, ir);
		}

		if (delayMs > 0) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, delayMs);
			});
		}

		return ir;
	};
}
