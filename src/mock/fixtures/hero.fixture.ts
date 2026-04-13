import type { Fixture } from "./types.js";

export const heroFixture: Fixture = {
	prompts: ["a hero for a saas landing page", "hero block about ai"],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "hero-1",
					type: "Hero",
					props: {
						headline: "Ship updates without friction.",
						description:
							"Deterministic HTML exports for internal release pages.",
						linuxLabel: "Download for Linux",
						linuxHref: "https://example.com/linux",
					},
				},
			],
		},
		assets: [],
		metadata: {
			createdAt: "2026-04-13T00:00:00.000Z",
		},
	},
};
