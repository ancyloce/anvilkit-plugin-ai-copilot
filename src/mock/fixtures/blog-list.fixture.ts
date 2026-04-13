import type { Fixture } from "./types.js";

export const blogListFixture: Fixture = {
	prompts: ["blog list of recent posts", "blog list section"],
	ir: {
		version: "1",
		root: {
			id: "root",
			type: "__root__",
			props: {},
			children: [
				{
					id: "blog-list-1",
					type: "BlogList",
					props: {
						posts: [
							{
								title: "Phase 3 fixtures",
								description:
									"Reusable IR examples for exporter tests.",
								href: "https://example.com/blog/phase-3-fixtures",
								imageSrc: "https://example.com/blog-list-post-1.jpg",
								imageAlt:
									"Editor showing a deterministic fixture preview.",
							},
						],
					},
				},
			],
		},
		assets: [
			{
				id: "blog-list-image-1",
				kind: "image",
				url: "https://example.com/blog-list-post-1.jpg",
			},
		],
		metadata: {
			createdAt: "2026-04-13T00:00:00.000Z",
		},
	},
};
