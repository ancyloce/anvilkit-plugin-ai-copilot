"use client";

import { ShimmeringText } from "@anvilkit/ui/components/animate-ui/primitives/texts/shimmering";
import { cn } from "@anvilkit/ui/lib/utils";
import { motion } from "motion/react";
import type { ReactElement } from "react";

export type CopilotMessageRole = "user" | "assistant";

export interface CopilotMessage {
	readonly id: string;
	readonly role: CopilotMessageRole;
	readonly text: string;
	readonly variant?: "default" | "error";
	readonly streaming?: boolean;
}

export interface CopilotMessageBubbleProps {
	readonly message: CopilotMessage;
}

export function CopilotMessageBubble({
	message,
}: CopilotMessageBubbleProps): ReactElement {
	const isUser = message.role === "user";
	const isError = message.variant === "error";

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.22, ease: "easeOut" }}
			data-slot="copilot-message"
			data-role={message.role}
			className={cn(
				"flex w-full",
				isUser ? "justify-end" : "justify-start",
			)}
		>
			<div
				className={cn(
					"max-w-[85%] text-sm leading-relaxed",
					isUser
						? "rounded-3xl bg-muted/70 px-4 py-2.5 text-foreground"
						: "px-1 text-foreground",
					isError && "text-destructive",
				)}
			>
				{message.streaming && !isUser ? (
					<ShimmeringText
						text={message.text}
						duration={1.4}
						color="var(--muted-foreground)"
						shimmeringColor="var(--foreground)"
					/>
				) : (
					message.text
				)}
			</div>
		</motion.div>
	);
}
