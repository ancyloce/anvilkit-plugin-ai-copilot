"use client";

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anvilkit/ui";
import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";

export interface CopilotModel {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
}

export interface CopilotModelMenuProps {
	readonly models: readonly CopilotModel[];
	readonly selectedModelId?: string;
	readonly onModelChange?: (id: string) => void;
	readonly disabled?: boolean;
}

export function CopilotModelMenu({
	models,
	selectedModelId,
	onModelChange,
	disabled,
}: CopilotModelMenuProps): ReactElement | null {
	if (models.length === 0) return null;

	const selected =
		models.find((m) => m.id === selectedModelId) ?? models[0];
	if (!selected) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled}
						data-testid="copilot-model-trigger"
						className="text-muted-foreground hover:text-foreground"
					/>
				}
			>
				<span>{selected.label}</span>
				<ChevronRight aria-hidden className="size-3" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={6}>
				{models.map((model) => (
					<DropdownMenuItem
						key={model.id}
						data-testid={`copilot-model-item-${model.id}`}
						onClick={() => onModelChange?.(model.id)}
						className="flex flex-col items-start gap-0.5"
					>
						<span className="text-sm">{model.label}</span>
						{model.description ? (
							<span className="text-xs text-muted-foreground">
								{model.description}
							</span>
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
