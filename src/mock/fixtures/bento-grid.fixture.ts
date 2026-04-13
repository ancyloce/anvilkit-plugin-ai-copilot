import type { Fixture } from "./types.js";

export const bentoGridFixture: Fixture = {
	prompts: [
		"bento grid for features",
		"bento grid showing platform features",
	],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "bento-grid-1",
					type: "BentoGrid",
					props: {
						theme: "light",
						platform: "adaptive",
						items: [
							{
								title: "Snapshots",
								description: "Lock output to a stable HTML baseline.",
							},
							{
								title: "Linting",
								description:
									"Keep fixture modules clean and deterministic.",
							},
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
