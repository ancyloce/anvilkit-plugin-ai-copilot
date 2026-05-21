import type { PageIR } from "@anvilkit/core/types";

export interface Fixture {
	readonly prompts: readonly string[];
	readonly ir: PageIR;
}
