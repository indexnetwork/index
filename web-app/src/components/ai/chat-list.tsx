import { type Message } from "ai";
import { ChatMessage } from "components/ai/chat-message";
import { useCallback, useEffect, useRef } from "react";

export interface ChatListInterface {
  messages: Message[];
  handleEditClick: (message: Message, index: number) => void;
  handleRegenerate: (message: Message, index: number) => void;
  editingMessage: Message | undefined;
  setEditInput: (input: string) => void;
  editInput: string;
  handleSaveEdit: () => void;
  editingIndex: number | undefined;
}

export const ChatList = ({
  messages,
  handleEditClick,
  handleRegenerate,
  editingMessage,
  setEditInput,
  editInput,
  handleSaveEdit,
  editingIndex,
}: ChatListInterface) => {
  const bottomRef = useRef<null | HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bottomRef]);

  const lastUserResponse = messages.findLast((message: Message) => {
    return message?.name === "basic_assistant";
  });

  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
    }, 150);
  }, [messages, scrollToBottom]);

  return (
    <div>
      {messages.map((message, index) => (
        <div key={index}>
          <ChatMessage
            message={message}
            handleEditClick={handleEditClick}
            handleRegenerate={handleRegenerate}
            editingMessage={editingMessage}
            setEditInput={setEditInput}
            editInput={editInput}
            handleSaveEdit={handleSaveEdit}
            index={index}
            editingIndex={editingIndex}
          />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
