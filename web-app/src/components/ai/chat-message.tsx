import { Message } from "ai";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { useApp } from "@/context/AppContext";
import { ChatMessageActions } from "components/ai/chat-message-actions";
import { MemoizedReactMarkdown } from "components/ai/markdown";
import { CodeBlock } from "components/ai/ui/codeblock";
import { IconCheck, IconClose } from "components/ai/ui/icons";
import Avatar from "components/base/Avatar";
import Button from "components/base/Button";
import Input from "components/base/Input";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";

export interface ChatMessageProps {
  message: Message;
  handleEditClick: (message: Message, index: number) => void;
  handleRegenerate: (message: Message, index: number) => void;
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
  handleRegenerate,
  editingMessage,
  setEditInput,
  editInput,
  handleSaveEdit,
  index,
  editingIndex,
}: ChatMessageProps) {
  const { userProfile } = useApp();

  return (
    <FlexRow wrap={false} align={"start"} className="chat-message py-5">
      <Col>
        {message.role === "user" ? (
          <Avatar size={24} user={userProfile} />
        ) : (
          <div>
            <img
              src="/images/chatprofileIndex.svg"
              width={24}
              height={24}
              style={{
                border: "0px solid #E2E8F0",
                borderRadius: "2px",
              }}
              alt="hugging face logo"
            />
          </div>
        )}
      </Col>
      <Col className="idxflex-grow-1 mx-5" style={{ overflow: "auto" }}>
        <div style={{ overflowWrap: "break-word" }}>
          {editingMessage?.id && index === editingIndex ? (
            <Flex
              alignitems="center"
              flexdirection="row"
              style={{
                marginBottom: "14px",
              }}
            >
              <Input
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
              />
            </Flex>
          ) : (
            <MemoizedReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
              components={{
                p({ children }) {
                  return (
                    <p
                      style={{
                        marginTop: 0,
                        fontSize: "1.4rem",
                      }}
                    >
                      {children}
                    </p>
                  );
                },
                code({ inline, className, children, ...props }) {
                  if (children.length) {
                    if (children[0] === "▍") {
                      return (
                        <span className="mt-1 animate-pulse cursor-default">
                          ▍
                        </span>
                      );
                    }

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
      </Col>
      <Col>
        {editingMessage?.id && index === editingIndex ? (
          <Flex>
            <Button iconHover theme="clear" onClick={handleSaveEdit} borderless>
              <IconCheck width={20} height={20} />
            </Button>
            <Button
              iconHover
              theme="clear"
              onClick={() => {
                handleEditClick({} as Message, -1);
              }}
              borderless
            >
              <IconClose width={20} height={20} />
            </Button>
          </Flex>
        ) : (
          <ChatMessageActions
            message={message}
            handleEditClick={handleEditClick}
            index={index}
            editingMessage={editingMessage}
            handleRegenerate={handleRegenerate}
          />
        )}
      </Col>
    </FlexRow>
  );
}
