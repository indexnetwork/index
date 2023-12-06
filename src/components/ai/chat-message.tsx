import { Message } from "ai";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeBlock } from "components/ai/ui/codeblock";
import { MemoizedReactMarkdown } from "components/ai/markdown";
import {
  IconCheck,
  IconClose,
} from "components/ai/ui/icons";
import { ChatMessageActions } from "components/ai/chat-message-actions";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Text from "components/base/Text";
import Input from "components/base/Input";
import Button from "components/base/Button";
import Flex from "components/layout/base/Grid/Flex";
import Avatar from "components/base/Avatar";
import { selectProfile } from "store/slices/profileSlice";
import { useAppSelector } from "hooks/store";

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
  const profile = useAppSelector(selectProfile);

  return (
    <FlexRow wrap={false} align={"start"} className="py-5">
      <Col>
        {message.role === "user" ? (
          <Avatar size={24} user={profile} />
        ) : (
          <div style={{
            border: "1px solid #E2E8F0",
            borderRadius: "2px",
            padding: "1px 3px",
          }}>
            <img src="/images/huggingFaceLogo.png" width={16} height={16} alt="hugging face logo"/>
          </div>
        )}
      </Col>
      <Col className="idxflex-grow-1 mx-5" style={{ overflow: "auto" }}>
        <div style={{ overflowWrap: "break-word" }}>
          {editingMessage?.id && index === editingIndex ? (
            <Flex>
              <Input
                autoFocus
                style={{
                  border: "none",
                  outline: "none",
                  fontSize: "1.6rem",
                  marginBottom: "1rem",
                }}
                ghost
                value={editInput}
                onChange={(e) => {
                  setEditInput(e.target.value);
                }}
              />
              <Button
                iconHover
                theme="clear"
                onClick={handleSaveEdit}
                borderless
              >
                <IconCheck width={20} height={20} />
              </Button>
              <Button
                iconHover
                theme="clear"
                onClick={() => {
                  handleEditClick({} as Message, -1);
                }}
                borderless>
                <IconClose width={20} height={20} />
                </Button>
            </Flex>
          ) : (
            <MemoizedReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              components={{
                p({ children }) {
                  return (
                    <Text size="lg" lineHeight={1.6}>
                      {children}
                    </Text>
                  );
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
