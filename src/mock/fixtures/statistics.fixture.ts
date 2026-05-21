import type { Fixture } from "./types.js";

export const statisticsFixture: Fixture = {
	prompts: ["statistics block", "stats section showing growth"],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "statistics-1",
					type: "Statistics",
					props: {
						title: "Export metrics",
						items: [
							{ value: "31", label: "existing tests" },
							{ value: "9", label: "fixture modules" },
							{ value: "1", label: "alt warning added" },
						],
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
