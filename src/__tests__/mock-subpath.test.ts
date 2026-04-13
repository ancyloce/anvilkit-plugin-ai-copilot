import { describe, expect, it } from "vitest";

import * as MockEntry from "@anvilkit/plugin-ai-copilot/mock";

describe("@anvilkit/plugin-ai-copilot/mock", () => {
	it("exposes the mock entrypoint exports", () => {
		expect(MockEntry.createMockGeneratePage).toEqual(expect.any(Function));
		expect(MockEntry.allFixtures).toBeInstanceOf(Array);
		expect(MockEntry.allFixtures).toHaveLength(9);
		expect(MockEntry.matchPromptToFixture).toEqual(expect.any(Function));
	});
});
