import { type Message } from "ai";

import Button from "components/base/Button";
import { IconCheck, IconCopy, IconEdit } from "components/ai/ui/icons";

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
			{...props}
		>
			<Button onClick={() => console.log(message.id)} theme="clear">
				<IconEdit />
				<span className="sr-only hidden">Edit message</span>
			</Button>
			<Button iconButton theme={"ghost"} onClick={onCopy}>
				{isCopied ? <IconCheck /> : <IconCopy />}
				<span className="sr-only hidden">Copy message</span>
			</Button>
		</div>
	);
}
