import type { Fixture } from "./types.js";

export const pricingMinimalFixture: Fixture = {
	prompts: ["minimal pricing table", "pricing minimal section"],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "pricing-minimal-1",
					type: "PricingMinimal",
					props: {
						headline: "Pick a release plan",
						description: "Two deterministic plans for local testing.",
						plans: [
							{
								name: "Starter",
								price: "$19",
								ctaLabel: "Choose Starter",
								ctaHref: "https://example.com/starter",
							},
							{
								name: "Team",
								price: "$49",
								ctaLabel: "Choose Team",
								ctaHref: "https://example.com/team",
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
