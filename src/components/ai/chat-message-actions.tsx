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
            iconHover
            theme="clear"
            onClick={() => handleEditClick(message, index)}
            borderless
          >
            <IconEdit width={20} height={20} />
            <span className="sr-only hidden">Edit message</span>
          </Button>
        )}
        {!editingMessage?.id && message.role !== "user" && (
          <Button
            iconHover
            borderless
            theme="clear"
            onClick={onCopy}
          >
            {isCopied ? (
              <IconCheck width={20} height={20} />
            ) : (
              <IconCopy width={20} height={20} />
            )}
            <span className="sr-only hidden">Copy message</span>
          </Button>
        )}
      </Flex>
    </div>
  );
}
