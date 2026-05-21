import { bentoGridFixture } from "./bento-grid.fixture.js";
import { blogListFixture } from "./blog-list.fixture.js";
import { helpsFixture } from "./helps.fixture.js";
import { heroFixture } from "./hero.fixture.js";
import { logoCloudsFixture } from "./logo-clouds.fixture.js";
import { navbarFixture } from "./navbar.fixture.js";
import { pricingMinimalFixture } from "./pricing-minimal.fixture.js";
import { sectionFixture } from "./section.fixture.js";
import { statisticsFixture } from "./statistics.fixture.js";
import type { Fixture } from "./types.js";

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

const fixtureIndex = [
	bentoGridFixture,
	blogListFixture,
	helpsFixture,
	heroFixture,
	logoCloudsFixture,
	navbarFixture,
	pricingMinimalFixture,
	sectionFixture,
	statisticsFixture,
] satisfies readonly Fixture[];

export type { Fixture } from "./types.js";

export const allFixtures = [...fixtureIndex].sort((a, b) =>
	a.prompts[0]!.localeCompare(b.prompts[0]!),
);

function tokenize(prompt: string): string[] {
	return prompt
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

// Token sets are computed once per fixture at module load and cached on
// the closure below. Without this, every `matchPromptToFixture` call
// retokenized every fixture's prompt list — O(F·P) work on the hot path
// of every mock generation. (review L2 / MT-6)
const fixtureTokenIndex: ReadonlyMap<Fixture, ReadonlySet<string>> = new Map(
	allFixtures.map((fixture) => [
		fixture,
		new Set(fixture.prompts.flatMap(tokenize)),
	]),
);

function scorePrompt(
	promptTokens: ReadonlySet<string>,
	fixture: Fixture,
): number {
	if (promptTokens.size === 0) {
		return 0;
	}

	const fixtureTokens = fixtureTokenIndex.get(fixture);
	if (!fixtureTokens) {
		return 0;
	}
	let score = 0;
	for (const token of promptTokens) {
		if (fixtureTokens.has(token)) {
			score += 1;
		}
	}

	return score;
}

export function matchPromptToFixture(prompt: string): Fixture | undefined {
	const promptTokens = new Set(tokenize(prompt));
	if (promptTokens.size === 0) return undefined;

	let bestFixture: Fixture | undefined;
	let bestScore = 0;

	for (const fixture of allFixtures) {
		const score = scorePrompt(promptTokens, fixture);
		if (score > bestScore) {
			bestFixture = fixture;
			bestScore = score;
		}
	}

	return bestScore >= 2 ? bestFixture : undefined;
}
