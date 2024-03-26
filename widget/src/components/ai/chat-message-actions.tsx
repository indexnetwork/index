import { IconCheck, IconCopy, IconEdit } from "@/components/ai/ui/icons";
import Button from "@/components/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Message } from "ai";

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
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
        }}
        className="chat-message-actions"
      >
        {message.role === "user" && !editingMessage?.id && (
          <Button
            hoverableIcon
            className="opacity-50"
            onClick={() => handleEditClick(message, index)}
            borderless
          >
            <IconEdit width={20} height={20} />
            <span className="sr-only hidden">Edit message</span>
          </Button>
        )}
        {!editingMessage?.id && message.role !== "user" && (
          <Button
            className="opacity-50"
            borderless
            hoverableIcon
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
      </div>
    </div>
  );
}
