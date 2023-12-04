import { Message } from "ai";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeBlock } from "components/ai/ui/codeblock";
import { MemoizedReactMarkdown } from "components/ai/markdown";
import {
  IconCheck,
  IconClose,
  IconOpenAI,
  IconUser,
} from "components/ai/ui/icons";
import { ChatMessageActions } from "components/ai/chat-message-actions";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import Input from "components/base/Input";
import Button from "components/base/Button";
import Flex from "components/layout/base/Grid/Flex";

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
  return (
    <FlexRow wrap={false} align={"start"}>
      <Col>
        {message.role === "user" ? (
          <IconUser width={20} />
        ) : (
          <IconOpenAI width={20} />
        )}
      </Col>
      <Col className="idxflex-grow-1 mx-4" style={{ overflow: "auto" }}>
        <div style={{ overflowWrap: "break-word" }}>
          {editingMessage?.id && index === editingIndex ? (
            <Flex>
              <Input
                autoFocus
                style={{
                  border: "none",
                  outline: "none",
                }}
                ghost
                value={editInput}
                onChange={(e) => {
                  setEditInput(e.target.value);
                }}
              />
              <Button iconButton theme="ghost" onClick={handleSaveEdit}>
                <IconCheck />
              </Button>
              <Button
                iconButton
                theme="ghost"
                onClick={() => {
                  handleEditClick({} as Message, -1);
                }}
              >
                <IconClose color="#1E293B" />
              </Button>
            </Flex>
          ) : (
            <MemoizedReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              components={{
                p({ children }) {
                  return <Text>{children}</Text>;
                },
                code({
					 inline, className, children, ...props
					}) {
                  if (children.length) {
                    if (children[0] === "▍") {
                      return (
                        <span className="mt-1 cursor-default animate-pulse">
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
        <ChatMessageActions
          message={message}
          handleEditClick={handleEditClick}
          index={index}
          editingMessage={editingMessage}
        />
      </Col>
    </FlexRow>
  );
}
