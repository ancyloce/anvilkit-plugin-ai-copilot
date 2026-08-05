/**
 * @file PLAN-0025 Phase 3.5 (P3.5-02) — Puck-native v2 compliance.
 *
 * The plugin's selection reads and applied edits already run over
 * PuckApi and node props (functional `setData`, pure patches) — this
 * suite locks that compliance and the §5.1 carrier semantics of the
 * apply path against Puck-native v2 documents:
 *
 * 1. source scan: no sidecar / sidecar-editor-command reference
 *    anywhere in `src/` (plan §15 gate 3, per package);
 * 2. `applySectionPatch` on a v2 document preserves UNTOUCHED nodes'
 *    `appearance`/`interactions`/`bindings` byte-identically and keeps
 *    `root.props.designSystem` intact;
 * 3. a replacement node (new id — regeneration always mints one, e.g.
 *    `hero-1-regen`) starts WITHOUT carriers: §5.1 ownership is
 *    by-node, so a new node has no authored state. Whether identity-
 *    preserving regeneration should CARRY the replaced node's styling
 *    is an open product question recorded in the phase report — this
 *    test locks today's semantics so any future change is deliberate.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySectionPatch } from "../patchs/apply-section-patch.js";

const FORBIDDEN = [
	"__anvilkit",
	"readAuthoringState",
	"writeAuthoringState",
	"ANVILKIT_AUTHORING_KEY",
	"EditorCommandPort",
	"applyEditorCommand",
	'"replaceRoot"',
] as const;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "mock") continue;
			files.push(...sourceFiles(path));
			continue;
		}
		if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
	}
	return files;
}

const heroAppearance = {
	version: "1",
	targets: { root: { style: { base: { layout: { display: "flex" } } } } },
};
const pricingAppearance = {
	version: "1",
	targets: { root: { style: { base: { visual: { opacity: 0.9 } } } } },
};

function v2Document() {
	return {
		content: [
			{
				type: "Hero",
				props: {
					id: "hero-1",
					title: "Old hero",
					appearance: heroAppearance,
					interactions: [{ id: "i-1", trigger: "click" }],
				},
			},
			{
				type: "Pricing",
				props: {
					id: "pricing-1",
					title: "Pricing",
					appearance: pricingAppearance,
					bindings: [{ id: "b-1", nodeId: "pricing-1" }],
				},
			},
		],
		root: {
			props: {
				title: "Page",
				designSystem: {
					version: "1",
					breakpoints: [],
					tokens: {},
					tokenModes: { light: { id: "light", name: "Light" } },
					defaultTokenMode: "light",
					styleDefinitions: {},
				},
			},
		},
		zones: {},
	};
}

describe("Puck-native v2 compliance (P3.5-02)", () => {
	it("no source file references the sidecar or sidecar editor commands", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(join(__dirname, ".."))) {
			const source = readFileSync(file, "utf8");
			for (const marker of FORBIDDEN) {
				if (source.includes(marker)) offenders.push(`${file}: ${marker}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("applying a section patch preserves untouched nodes' §5.1 carriers and the designSystem root prop", () => {
		const before = v2Document();
		const next = applySectionPatch(
			before as never,
			{
				zoneId: "root",
				nodeIds: ["hero-1"],
				replacement: [
					{ id: "hero-1-regen", type: "Hero", props: { title: "New hero" } },
				],
			} as never,
		) as unknown as typeof before;

		// The untouched neighbor keeps every carrier byte-identically.
		const pricing = next.content.find((node) => node.props.id === "pricing-1");
		expect(pricing?.props.appearance).toEqual(pricingAppearance);
		expect(pricing?.props.bindings).toEqual([
			{ id: "b-1", nodeId: "pricing-1" },
		]);

		// Document-level v2 state survives the apply untouched.
		expect(
			(next.root.props as { designSystem?: unknown }).designSystem,
		).toEqual(before.root.props.designSystem);

		// Input immutability: the source document was not mutated.
		expect(before.content[0]?.props.appearance).toEqual(heroAppearance);
	});

	it("a replacement node (new id) starts without carriers — locked §5.1 semantics", () => {
		const next = applySectionPatch(
			v2Document() as never,
			{
				zoneId: "root",
				nodeIds: ["hero-1"],
				replacement: [
					{ id: "hero-1-regen", type: "Hero", props: { title: "New hero" } },
				],
			} as never,
		) as unknown as ReturnType<typeof v2Document>;

		const regenerated = next.content.find(
			(node) => node.props.id === "hero-1-regen",
		);
		expect(regenerated).toBeDefined();
		expect(regenerated?.props).not.toHaveProperty("appearance");
		expect(regenerated?.props).not.toHaveProperty("interactions");
	});
});
