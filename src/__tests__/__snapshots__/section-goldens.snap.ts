/**
 * @file Phase 6 / M9 goldens — `regenerateSelection()` happy-path output
 * shape, one entry per demo component (11 total).
 *
 * Each entry is the {@link AiSectionPatch} that
 * `createMockGenerateSection({ delayMs: 0 })` returns when handed an
 * {@link AiSectionContext} whose `currentNodes` is the matching
 * `INPUT_NODES_BY_NAME` entry from
 * `regenerate-selection-goldens.test.ts`. Locking these patches
 * down here means a future change to the mock generator (or the
 * `AiSectionPatch` shape) trips the goldens before it can land.
 */

import type { AiSectionPatch, PageIRNode } from "@anvilkit/core/types";

export const GOLDEN_PROMPT = "rewrite this section" as const;
export const GOLDEN_ZONE_ID = "root-zone" as const;

/**
 * The 11 input nodes — one per demo component. Each carries a
 * representative shape: every component that has a `headline`, `title`,
 * `label`, or `heading` field gets its prompt-overridable key
 * populated; the remaining props mirror real default props so the
 * mock's pass-through behavior is exercised.
 */
export const INPUT_NODES_BY_NAME: Record<string, PageIRNode> = {
	BentoGrid: {
		id: "bento-1",
		type: "BentoGrid",
		props: { headline: "Original BentoGrid headline", theme: "system" },
	},
	BlogList: {
		id: "blog-1",
		type: "BlogList",
		props: { title: "Original blog title", posts: [] },
	},
	Button: {
		id: "button-1",
		type: "Button",
		props: { label: "Click me", href: "https://example.com" },
	},
	Hero: {
		id: "hero-1",
		type: "Hero",
		props: {
			headline: "Original hero headline",
			description: "Existing description preserved.",
		},
	},
	Helps: {
		id: "helps-1",
		type: "Helps",
		props: { headline: "Original Helps headline", items: [] },
	},
	Input: {
		id: "input-1",
		type: "Input",
		props: { label: "Email", placeholder: "you@example.com" },
	},
	LogoClouds: {
		id: "logo-clouds-1",
		type: "LogoClouds",
		props: { heading: "As featured in", logos: [] },
	},
	Navbar: {
		id: "navbar-1",
		type: "Navbar",
		props: { title: "Anvilkit", links: [] },
	},
	PricingMinimal: {
		id: "pricing-1",
		type: "PricingMinimal",
		props: { headline: "Original pricing headline", plans: [] },
	},
	Section: {
		id: "section-1",
		type: "Section",
		props: { headline: "Original section headline", badgeLabel: "BADGE" },
	},
	Statistics: {
		id: "statistics-1",
		type: "Statistics",
		props: { headline: "Original stats headline", stats: [] },
	},
};

/**
 * The expected patches. Order matches `Object.keys(INPUT_NODES_BY_NAME)`
 * so iteration order is deterministic across runs.
 */
export const EXPECTED_PATCHES_BY_NAME: Record<string, AiSectionPatch> = {
	BentoGrid: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["bento-1"],
		replacement: [
			{
				id: "bento-1-regen",
				type: "BentoGrid",
				props: { headline: GOLDEN_PROMPT, theme: "system" },
			},
		],
	},
	BlogList: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["blog-1"],
		replacement: [
			{
				id: "blog-1-regen",
				type: "BlogList",
				props: { title: GOLDEN_PROMPT, posts: [] },
			},
		],
	},
	Button: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["button-1"],
		replacement: [
			{
				id: "button-1-regen",
				type: "Button",
				props: { label: GOLDEN_PROMPT, href: "https://example.com" },
			},
		],
	},
	Hero: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["hero-1"],
		replacement: [
			{
				id: "hero-1-regen",
				type: "Hero",
				props: {
					headline: GOLDEN_PROMPT,
					description: "Existing description preserved.",
				},
			},
		],
	},
	Helps: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["helps-1"],
		replacement: [
			{
				id: "helps-1-regen",
				type: "Helps",
				props: { headline: GOLDEN_PROMPT, items: [] },
			},
		],
	},
	Input: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["input-1"],
		replacement: [
			{
				id: "input-1-regen",
				type: "Input",
				props: { label: GOLDEN_PROMPT, placeholder: "you@example.com" },
			},
		],
	},
	LogoClouds: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["logo-clouds-1"],
		replacement: [
			{
				id: "logo-clouds-1-regen",
				type: "LogoClouds",
				props: { heading: GOLDEN_PROMPT, logos: [] },
			},
		],
	},
	Navbar: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["navbar-1"],
		replacement: [
			{
				id: "navbar-1-regen",
				type: "Navbar",
				props: { title: GOLDEN_PROMPT, links: [] },
			},
		],
	},
	PricingMinimal: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["pricing-1"],
		replacement: [
			{
				id: "pricing-1-regen",
				type: "PricingMinimal",
				props: { headline: GOLDEN_PROMPT, plans: [] },
			},
		],
	},
	Section: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["section-1"],
		replacement: [
			{
				id: "section-1-regen",
				type: "Section",
				props: { headline: GOLDEN_PROMPT, badgeLabel: "BADGE" },
			},
		],
	},
	Statistics: {
		zoneId: GOLDEN_ZONE_ID,
		nodeIds: ["statistics-1"],
		replacement: [
			{
				id: "statistics-1-regen",
				type: "Statistics",
				props: { headline: GOLDEN_PROMPT, stats: [] },
			},
		],
	},
};
