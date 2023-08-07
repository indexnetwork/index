"use client";

import { type Message } from "ai";

import Button from "components/base/Button";
import { IconCheck, IconCopy } from "components/ai/ui/icons";

import cc from "classcat";
import { useCopyToClipboard } from "hooks/useCopyToClipboard";

interface ChatMessageActionsProps extends React.ComponentProps<"div"> {
  message: Message
}

export function ChatMessageActions({
	message,
	className,
	...props
}: ChatMessageActionsProps) {
	const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 });

	const onCopy = () => {
		if (isCopied) return;
		copyToClipboard(message.content);
	};

	return (
		<div
			className={cc(
				"flex items-center justify-end transition-opacity group-hover:opacity-100 md:absolute md:-right-10 md:-top-2 md:opacity-0",
				className,
			)}
			{...props}
		>
			<Button variant="ghost" size="icon" onClick={onCopy}>
				{isCopied ? <IconCheck /> : <IconCopy />}
				<span className="sr-only">Copy message</span>
			</Button>
		</div>
	);
}
