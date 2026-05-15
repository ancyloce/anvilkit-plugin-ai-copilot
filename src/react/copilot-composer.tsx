"use client";

import { Button, Ripple, Textarea } from "@anvilkit/ui";
import { Button as MotionButton } from "@anvilkit/ui/components/animate-ui/primitives/buttons/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ArrowUp, Plus } from "lucide-react";
import type { KeyboardEvent, ReactElement } from "react";

import {
	type CopilotModel,
	CopilotModelMenu,
} from "./copilot-model-menu.js";

export interface CopilotComposerProps {
	readonly prompt: string;
	readonly onPromptChange: (next: string) => void;
	readonly onSubmit: () => void;
	readonly disabled?: boolean;
	readonly pending?: boolean;
	readonly placeholder?: string;
	/** When omitted the attach button is hidden. */
	readonly onAttach?: () => void;
	readonly models?: readonly CopilotModel[];
	readonly selectedModelId?: string;
	readonly onModelChange?: (id: string) => void;
}

export function CopilotComposer({
	prompt,
	onPromptChange,
	onSubmit,
	disabled = false,
	pending = false,
	placeholder = "Reply...",
	onAttach,
	models,
	selectedModelId,
	onModelChange,
}: CopilotComposerProps): ReactElement {
	const submitDisabled = disabled || pending || prompt.trim().length === 0;

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			if (!submitDisabled) onSubmit();
		}
	}

	return (
		<div
			data-slot="copilot-composer"
			className="border-t border-border bg-transparent px-2 pt-2"
		>
			<Textarea
				id="ai-prompt-panel-input"
				data-testid="ai-prompt-panel-input"
				value={prompt}
				placeholder={placeholder}
				rows={2}
				disabled={disabled || pending}
				onChange={(event) => onPromptChange(event.target.value)}
				onKeyDown={handleKeyDown}
			/>
			<div className="mt-2 flex items-center gap-2">
				{onAttach ? (
					<MotionButton asChild hoverScale={1.05} tapScale={0.92}>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label="Add attachment"
							data-testid="copilot-attach"
							disabled={disabled || pending}
							onClick={onAttach}
							className="rounded-full text-muted-foreground hover:text-foreground"
						>
							<Plus aria-hidden />
						</Button>
					</MotionButton>
				) : null}
				<div className="ml-auto flex items-center gap-1.5">
					{models && models.length > 0 ? (
						<CopilotModelMenu
							models={models}
							selectedModelId={selectedModelId}
							onModelChange={onModelChange}
							disabled={disabled || pending}
						/>
					) : null}
					<MotionButton
						asChild
						hoverScale={submitDisabled ? 1 : 1.05}
						tapScale={submitDisabled ? 1 : 0.92}
					>
						<Button
							type="button"
							size="icon"
							aria-label="Send message"
							data-testid="ai-prompt-panel-submit"
							disabled={submitDisabled}
							onClick={onSubmit}
							className={cn(
								"relative size-9 overflow-hidden rounded-full",
								"bg-primary text-primary-foreground",
							)}
						>
							<ArrowUp aria-hidden className="size-4" />
							{pending ? (
								<Ripple
									mainCircleSize={20}
									mainCircleOpacity={0.22}
									numCircles={3}
									className="opacity-60"
								/>
							) : null}
						</Button>
					</MotionButton>
				</div>
			</div>
		</div>
	);
}
