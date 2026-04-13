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

function scorePrompt(prompt: string, fixture: Fixture): number {
	const promptTokens = new Set(tokenize(prompt));
	if (promptTokens.size === 0) {
		return 0;
	}

	const fixtureTokens = new Set(fixture.prompts.flatMap(tokenize));
	let score = 0;
	for (const token of promptTokens) {
		if (fixtureTokens.has(token)) {
			score += 1;
		}
	}

	return score;
}

export function matchPromptToFixture(prompt: string): Fixture | undefined {
	let bestFixture: Fixture | undefined;
	let bestScore = 0;

	for (const fixture of allFixtures) {
		const score = scorePrompt(prompt, fixture);
		if (score > bestScore) {
			bestFixture = fixture;
			bestScore = score;
		}
	}

	return bestScore >= 2 ? bestFixture : undefined;
}
