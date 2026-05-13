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

// Matches the demo Hero component's headline maxLength — keeps the
// fallback IR renderable without clipping mid-prompt.
const FALLBACK_HEADLINE_MAX_LENGTH = 80;

// Mirrors `DEFAULT_TIMEOUT_MS` in `create-ai-copilot-plugin.ts`.
// Hardcoded here on purpose: importing from the main plugin would
// invert the `/mock` subpath's dependency direction.
const COPILOT_DEFAULT_TIMEOUT_MS = 30_000;

export interface CreateMockGeneratePageOptions {
	readonly delayMs?: number;
	readonly fixtures?: readonly Fixture[];
}

interface IndexedFixture {
	readonly fixture: Fixture;
	readonly tokens: ReadonlySet<string>;
}

function tokenize(prompt: string): string[] {
	return prompt
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function indexFixtures(
	fixtures: readonly Fixture[],
): readonly IndexedFixture[] {
	return fixtures.map((fixture) => ({
		fixture,
		tokens: new Set(fixture.prompts.flatMap(tokenize)),
	}));
}

function matchFixtureFromIndex(
	prompt: string,
	indexed: readonly IndexedFixture[],
): Fixture | undefined {
	const promptTokens = new Set(tokenize(prompt));
	if (promptTokens.size === 0) {
		return undefined;
	}

	let bestFixture: Fixture | undefined;
	let bestScore = 0;

	for (const { fixture, tokens: fixtureTokens } of indexed) {
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
						headline: prompt.slice(0, FALLBACK_HEADLINE_MAX_LENGTH),
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
	if (delayMs >= COPILOT_DEFAULT_TIMEOUT_MS) {
		console.warn(
			`createMockGeneratePage: delayMs=${delayMs} matches or exceeds the copilot's default timeoutMs (${COPILOT_DEFAULT_TIMEOUT_MS}ms). Generations will time out under the default configuration — set createAiCopilotPlugin({ timeoutMs }) to a larger value.`,
		);
	}

	const fixtures = opts.fixtures ?? allFixtures;
	// Tokenize fixture prompts once at factory init rather than on every
	// call. Keeps `mock-generate-page`'s perf characteristics flat as the
	// demo's fixture set grows.
	const indexedFixtures =
		opts.fixtures !== undefined ? indexFixtures(fixtures) : null;
	const cache = new Map<string, PageIR>();

	return async (prompt, _ctx) => {
		let ir = cache.get(prompt);
		if (!ir) {
			const fixture = indexedFixtures
				? matchFixtureFromIndex(prompt, indexedFixtures)
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
