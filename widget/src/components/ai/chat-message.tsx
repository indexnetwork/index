import AssistantAvatar from "@/assets/image/av_system.png";
import { ChatMessageActions } from "@/components/ai/chat-message-actions";
import { MemoizedReactMarkdown } from "@/components/ai/markdown";
import { CodeBlock } from "@/components/ai/ui/codeblock";
import { IconCheck, IconClose } from "@/components/ai/ui/icons";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import { useIndexChat } from "@/contexts/ChatContext";
import { Users } from "@/types/entity";
import { Message } from "ai";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export interface ChatMessageProps {
  message: Message;
  handleEditClick: (message: Message, index: number) => void;
  editingMessage: Message | undefined;
  setEditInput: (input: string) => void;
  editInput: string;
  handleSaveEdit: () => void;
  index: number;
  editingIndex: number | undefined;
}

export function ChatMessage({
  message,
  handleEditClick,
  editingMessage,
  setEditInput,
  editInput,
  handleSaveEdit,
  index,
  editingIndex,
}: ChatMessageProps) {
  const { userProfile } = useIndexChat();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "1rem",
        alignItems: "start",
        flexWrap: "nowrap",
      }}
      // className="chat-message py-5"
    >
      {/* <div> */}
      {message.role === "user" ? (
        <Avatar size={24} user={userProfile as Users} />
      ) : (
        // <div
        //   style={{
        //     border: "1px solid #E2E8F0",
        //     borderRadius: "2px",
        //     padding: "1px 3px",
        //   }}
        // >
        // <div className={`flex items-start gap-3`}>
        <img
          src={AssistantAvatar}
          className="h-6 w-6 rounded-sm"
          alt="hugging face logo"
        />
        // </div>
        // </div>
      )}
      {/* </div> */}
      <div className="" style={{ overflow: "auto" }}>
        <div style={{ overflowWrap: "break-word" }}>
          {editingMessage?.id && index === editingIndex ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              {/* <Input
                autoFocus
                style={{
                  border: "none",
                  outline: "none",
                  fontSize: "1.6rem",
                  marginBottom: "1rem",
                  marginRight: "1rem",
                }}
                ghost
                value={editInput}
                onChange={(e) => {
                  setEditInput(e.target.value);
                }}
              /> */}
              <input
                type="text"
                className="bg-transparent text-sm focus:border-transparent focus:ring-0"
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
              />
            </div>
          ) : (
            <MemoizedReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
              components={{
                p({ children }) {
                  return (
                    <p
                      style={{
                        marginTop: 0,
                        // fontSize: "1.4rem",
                      }}
                      className="w-full whitespace-break-spaces break-words pb-4 text-sm font-normal"
                    >
                      {children}
                    </p>
                  );
                },
                // @ts-ignore
                code({ inline, className, children, ...props }) {
                  // @ts-ignore
                  if (children.length) {
                    // @ts-ignore
                    if (children[0] === "▍") {
                      return (
                        <span className="mt-1 animate-pulse cursor-default">
                          ▍
                        </span>
                      );
                    }
                    // @ts-ignore
                    children[0] = (children[0] as string).replace("`▍`", "▍");
                  }

                  const match = /language-(\w+)/.exec(className || "");

                  if (inline) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }

                  return (
                    <CodeBlock
                      key={Math.random()}
                      language={(match && match[1]) || ""}
                      value={String(children).replace(/\n$/, "")}
                      {...props}
                    />
                  );
                },
              }}
            >
              {message.content}
            </MemoizedReactMarkdown>
          )}
        </div>
      </div>
      <div>
        {editingMessage?.id && index === editingIndex ? (
          <div
            style={{
              display: "flex",
            }}
          >
            <Button onClick={handleSaveEdit} borderless>
              <IconCheck width={20} height={20} />
            </Button>
            <Button
              onClick={() => {
                handleEditClick({} as Message, -1);
              }}
              borderless
            >
              <IconClose width={20} height={20} />
            </Button>
          </div>
        ) : (
          <ChatMessageActions
            message={message}
            handleEditClick={handleEditClick}
            index={index}
            editingMessage={editingMessage}
          />
        )}
      </div>
    </div>
  );
}
