import { type Message } from "ai";
import { ChatMessage } from "@/components/ai/chat-message";

export interface ChatListInterface {
  messages: Message[];
  handleEditClick: (message: Message, index: number) => void;
  editingMessage: Message | undefined;
  setEditInput: (input: string) => void;
  editInput: string;
  handleSaveEdit: () => void;
  editingIndex: number | undefined;
}

export const ChatList = ({
  messages,
  handleEditClick,
  editingMessage,
  setEditInput,
  editInput,
  handleSaveEdit,
  editingIndex,
}: ChatListInterface) => {
  if (!messages.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {messages.map((message, index) => (
        <div key={index}>
          <ChatMessage
            message={message}
            handleEditClick={handleEditClick}
            editingMessage={editingMessage}
            setEditInput={setEditInput}
            editInput={editInput}
            handleSaveEdit={handleSaveEdit}
            index={index}
            editingIndex={editingIndex}
          />
        </div>
      ))}
    </div>
  );
};
