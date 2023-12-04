import Button from "components/base/Button";
import { IconCheck, IconCopy, IconEdit } from "components/ai/ui/icons";

import { useCopyToClipboard } from "hooks/useCopyToClipboard";
import { Message } from "ai";
import Flex from "components/layout/base/Grid/Flex";

interface ChatMessageActionsProps extends React.ComponentProps<"div"> {
  message: Message;
  handleEditClick: (message: Message, index: number) => void;
  index: number;
  editingMessage: Message | undefined;
}

export function ChatMessageActions({
  message,
  handleEditClick,
  index,
  editingMessage,
  className,
  ...props
}: ChatMessageActionsProps) {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 });

  const onCopy = () => {
    if (isCopied) return;
    copyToClipboard(message.content);
  };
  return (
    <div {...props}>
      <Flex>
        {message.role === "user" && !editingMessage?.id && (
          <Button
            iconButton
            onClick={() => handleEditClick(message, index)}
            theme="ghost"
          >
            <IconEdit />
            <span className="sr-only hidden">Edit message</span>
          </Button>
        )}
        {!editingMessage?.id && (
          <Button iconButton theme={"ghost"} onClick={onCopy}>
            {isCopied ? <IconCheck /> : <IconCopy />}
            <span className="sr-only hidden">Copy message</span>
          </Button>
        )}
      </Flex>
    </div>
  );
}
