import type { Fixture } from "./types.js";

export const logoCloudsFixture: Fixture = {
	prompts: ["logo clouds for trust", "logo clouds of customers"],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "logo-clouds-1",
					type: "LogoClouds",
					props: {
						title: "Used by release teams",
						subtitle:
							"Stable fixture coverage for every supported marketing block.",
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
