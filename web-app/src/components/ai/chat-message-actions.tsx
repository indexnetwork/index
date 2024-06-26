import Button from "components/base/Button";
import { IconCheck, IconCopy, IconEdit } from "components/ai/ui/icons";

import { useCopyToClipboard } from "hooks/useCopyToClipboard";
import { Message } from "ai";
import Flex from "components/layout/base/Grid/Flex";
import Image from "next/image";

interface ChatMessageActionsProps extends React.ComponentProps<"div"> {
  message: Message;
  handleEditClick: (message: Message, index: number) => void;
  index: number;
  editingMessage: Message | undefined;
  handleRegenerate: (message: Message, index: number) => void;
}

export function ChatMessageActions({
  message,
  handleEditClick,
  index,
  editingMessage,
  handleRegenerate,
  ...props
}: ChatMessageActionsProps) {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 });

  const onCopy = () => {
    if (isCopied) return;
    copyToClipboard(message.content);
  };
  return (
    <div {...props}>
      <Flex
        className="chat-message-actions"
        alignitems="center"
        flexdirection="row"
      >
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
          <Button iconHover borderless theme="clear" onClick={onCopy}>
            {isCopied ? (
              <IconCheck width={20} height={20} />
            ) : (
              <IconCopy width={20} height={20} />
            )}
            <span className="sr-only hidden">Copy message</span>
          </Button>
        )}

        {message.role === "assistant" && (
          <Button
            iconHover
            borderless
            theme="clear"
            onClick={() => handleRegenerate(message, index)}
          >
            <Image
              color="red"
              src="/images/ic_regenerate.svg"
              alt="regenerate"
              width={18}
              height={18}
            />
          </Button>
        )}
      </Flex>
    </div>
  );
}
