import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { CHAT_STARTED, trackEvent } from "@/services/tracker";

import { type Message } from "@ai-sdk/react";

import { ButtonScrollToBottom } from "components/ai/button-scroll-to-bottom";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";
import { EmptyScreen } from "components/ai/empty-screen";
import AskInput from "components/base/AskInput";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";

// import { nanoid } from "nanoid";

import {
  ComponentProps,
  FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { maskDID } from "utils/helper";
import { generateId } from "ai";
import { useRouter } from "next/navigation";
import { API_ENDPOINTS } from "@/utils/constants";

export interface ChatProps extends ComponentProps<"div"> {
  initialMessages?: Message[];
  id?: string;
}

export interface AskIndexesProps {
  sources?: string[];
}
export interface MessageWithIndex extends Message {
  index?: number;
}

const AskIndexes: FC<AskIndexesProps> = ({ sources }) => {
  const { session } = useAuth();
  const {
    leftSectionIndexes,
    leftTabKey,
    viewedProfile,
    viewedIndex,
    setViewedConversation,
    viewedConversation,
    conversations,
    setConversations,
  } = useApp();
  const { isIndex, conversationId, id } = useRouteParams();
  const { view } = useApp();
  const { ready: apiReady, api } = useApi();

  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [stoppedMessages, setStoppedMessages] = useState<string[]>([]);
  const [deletedMessages, setDeletedMessages] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  const [editingMessage, setEditingMessage] = useState<Message | undefined>();
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [editInput, setEditInput] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [defaultQuestions, setDefaultQuestions] = useState<string[]>([]);

  const bottomRef = useRef<null | HTMLDivElement>(null);

  const fetchDefaultQuestions = useCallback(async (): Promise<void> => {
    if (!apiReady || !isIndex || !id) return;
    try {
      const questions = await api!.getDefaultQuestionsOfIndex([id]);
      setDefaultQuestions(questions);
    } catch (error) {
      console.error("Error fetching default questions", error);
    }
  }, [apiReady, api, id, isIndex]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!apiReady || isLoading) return;
      try {
        const newMessage: Message = {
          id: generateId(),
          role: "user",
          content: message,
        };

        setMessages((prevMessages) => [...prevMessages, newMessage]);
        let currentConv = viewedConversation;
        if (!currentConv) {
          const response = await api!.createConversation({
            sources: [id],
            summary: `New chat`,
          });

          currentConv = response;

          setConversations([response, ...conversations]);
        }
        if (!currentConv) return;
        const messageResp = await api!.sendMessage(currentConv.id, {
          content: message,
          role: "user",
        });
        currentConv.messages = [messageResp];
        setViewedConversation(currentConv);

        router.push(`/conversation/${currentConv.id}`);
      } catch (error) {
        console.error("Error sending message", error);
      }
    },
    [viewedConversation, apiReady, conversations, api, isLoading],
  );

  const updateMessage = useCallback(
    async (messageId: string, message: string) => {
      if (!viewedConversation) return;
      if (!apiReady || isLoading) return;
      try {
        const lastUserMessage = messages.findLast((m) => m.role === "user");
        if (!lastUserMessage) return;

        const newMessage: Message = {
          id: generateId(),
          role: "user",
          content: message,
        };
        setMessages((prevMessages) => {
          return [...prevMessages, newMessage];
        });

        const messageResp = await api!.updateMessage(
          viewedConversation.id,
          lastUserMessage.id,
          {
            content: message,
            role: "user",
          },
          true,
        );
        viewedConversation.messages.push(messageResp);
        setViewedConversation(viewedConversation);
      } catch (e) {
        console.error("Error sending message", e);
      }
    },
    [apiReady, api, id, isIndex, viewedConversation, isLoading],
  );

  useEffect(() => {
    fetchDefaultQuestions();
  }, [fetchDefaultQuestions]);

  useEffect(() => {
    if (viewedConversation && viewedConversation.messages) {
      setMessages(viewedConversation.messages);
    } else {
      setMessages([]);
    }
  }, [conversationId, viewedConversation]);

  useEffect(() => {
    if (view.name === "default") {
      setMessages([]);
    }
  }, [view]);

  const handleEditClick = (message: Message, indexOfMessage: number) => {
    setEditingMessage(message);
    setEditingIndex(indexOfMessage);
    setEditInput(message.content);
  };

  const handleSaveEdit = async () => {
    if (editingMessage) {
      try {
        const messagesBeforeEdit = messages.slice(0, editingIndex);
        const messagesAfterEdit = messages.slice(editingIndex);

        console.log("messagesBeforeEdit", messagesBeforeEdit, messages);
        if (Array.isArray(messagesAfterEdit) && messagesAfterEdit.length > 0) {
          const mIds = messagesAfterEdit.map((m) => m.id);
          setDeletedMessages((prev) => {
            return [...prev, ...mIds];
          });
        }

        const newMessage = {
          ...editingMessage,
          content: editInput,
        };

        setEditingMessage(undefined);
        setEditInput("");
        setIsLoading(false);
        setMessages([...messagesBeforeEdit, newMessage]);
        console.log("messagesBeforeEdit", messagesBeforeEdit, messages);

        await updateMessage(editingMessage.id, editInput); // TODO
      } catch (error: any) {
        console.error("An error occurred:", error.message);
      }
    }
  };

  const regenerateMessage = async () => {
    if (!apiReady || isLoading || !viewedConversation) return;
    try {
      const lastUserMessage = messages.findLast((m) => m.role === "user");
      const lastAssistantMessage = messages.findLast(
        (m) => m.name === "basic_assistant",
      );
      if (!lastUserMessage) return;

      setIsLoading(true);
      // remove messages after the last assistant message
      if (lastAssistantMessage) {
        const messagesBeforeEdit = messages.slice(
          0,
          messages.indexOf(lastAssistantMessage),
        );

        setMessages(messagesBeforeEdit);
      }

      const regeneratedMessage = await api!.updateMessage(
        viewedConversation.id,
        lastUserMessage.id,
        { role: lastUserMessage.role, content: lastUserMessage.content },
        true,
      );

      setIsLoading(false);
    } catch (error) {
      console.error("Error sending message", error);
    }
  };

  const getChatContextMessage = (): string => {
    if (viewedIndex && isIndex) {
      return viewedIndex.title;
    }

    if (session && viewedProfile?.id === session.did.parent) {
      const sections = {
        owned: "indexes owned by you",
        starred: "indexes starred by you",
        all: "all your indexes",
      } as any;
      return sections[leftTabKey];
    }

    if (viewedProfile?.id) {
      const sections = {
        owned: "indexes owned by",
        starred: "indexes starred by",
        all: "all indexes of",
      } as any;

      return `${sections[leftTabKey]} ${viewedProfile.name || maskDID(viewedProfile.id)}`;
    }

    return `indexes`;
  };

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bottomRef]);

  useEffect(() => {
    // scrollToBottom();
  }, [viewedConversation, isLoading, scrollToBottom]);

  const stop = () => {
    setIsLoading(false);
    // TODO send stop signal to backend.
    setStoppedMessages(messages.map((c) => c.id));
  };

  const handleMessage = (data: any) => {
    const payload = JSON.parse(data);
    console.log("Received message from server", payload);

    if (payload.channel === "end") {
      if (viewedConversation && viewedConversation.summary === `New Chat`) {
        api!.getConversationWithSummary(viewedConversation.id).then((c) => {
          setViewedConversation(c);
        });
      }

      setIsLoading(false);
      // scrollToBottom();
      return;
    }

    if (payload.channel === "update") {
      const newMessage: Message = {
        id: payload.data.messageId,
        role: payload.data.payload.role,
        content: payload.data.payload.content,
      };
      setMessages((prevMessages) => {
        return [...prevMessages, newMessage];
      });
      setIsLoading(false);
      // scrollToBottom();
      return;
    }

    if (
      stoppedMessages.includes(payload.data.messageId) ||
      deletedMessages.includes(payload.data.messageId)
    ) {
      return;
    }

    setIsLoading(true);
    setMessages((prevConversation) => {
      let streamingMessage = prevConversation.find(
        (c) => c.id === payload.data.messageId,
      );

      if (!streamingMessage) {
        console.log(`newmessage ${payload.data.messageId}`);
        streamingMessage = {
          id: payload.data.messageId,
          content: payload.data.chunk,
          role: "assistant",
          name: payload.data.name,
        };
        console.log("New message", streamingMessage);
        return [...prevConversation, streamingMessage];
      }

      if (payload.channel === "chunk") {
        return prevConversation.map((message) =>
          message.id === payload.data.messageId
            ? { ...message, content: message.content + payload.data.chunk }
            : message,
        );
      }
      return prevConversation;
    });
    // scrollToBottom();
  };

  useEffect(() => {
    if (!viewedConversation) return;
    const eventUrl = `${process.env.NEXT_PUBLIC_API_URL!}${API_ENDPOINTS.CONVERSATION_UPDATES.replace(":conversationId", viewedConversation.id)}?session=${session?.serialize()}`;
    const eventSource = new EventSource(eventUrl);
    eventSource.onmessage = (event) => {
      console.log("Received message from server", event.data);
      handleMessage(event.data);
    };
    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      eventSource.close();
    };
    return () => {
      eventSource.close();
    };
  }, [stoppedMessages, deletedMessages, viewedConversation, API_ENDPOINTS]);

  if (leftSectionIndexes.length === 0) {
    // return <NoIndexes tabKey={leftTabKey} />;
  }

  return (
    <>
      <Flex
        id={`chatID`}
        key={`chatID`}
        className={
          viewedConversation &&
          viewedConversation.sources &&
          viewedConversation.sources?.filter(
            (source) => !source.includes("did:"),
          ).length > 0
            ? "px-0 pt-7"
            : "px-md-10 px-4 pt-7"
        }
        flexdirection={"column"}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          alignItems: "stretch",
        }}
      >
        <FlexRow wrap={true} align={"start"} style={{ flex: "1 1 auto" }}>
          <Col
            className="idxflex-grow-1"
            style={{
              display: "flex",
              height: "100%",
              justifyContent: "stretch",
              width: "100%",
              flexDirection: "column",
            }}
          >
            {viewedConversation && viewedConversation.messages.length ? (
              <>
                <ChatList
                  messages={messages}
                  handleEditClick={handleEditClick}
                  editingMessage={editingMessage}
                  setEditInput={setEditInput}
                  editInput={editInput}
                  handleSaveEdit={handleSaveEdit}
                  editingIndex={editingIndex}
                  regenerate={regenerateMessage}
                />
                <div ref={bottomRef} />
                <ChatScrollAnchor trackVisibility={isLoading} />
              </>
            ) : (
              <Flex
                className="px-8"
                style={{
                  width: "100%",
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <EmptyScreen
                  contextMessage={getChatContextMessage()}
                  setInput={setInput}
                  indexIds={
                    viewedConversation &&
                    viewedConversation.sources?.filter(
                      (source) => !source.includes("did:"),
                    )
                  }
                  defaultQuestions={defaultQuestions}
                />
              </Flex>
            )}
          </Col>
        </FlexRow>
      </Flex>
      <Flex
        className={"chat-input idxflex-grow-1 px-md-10"}
        flexdirection={"column"}
      >
        <FlexRow className={"mb-5"} justify={"center"} align={"center"}>
          <ChatPanel
            isLoading={isLoading}
            stop={stop}
            reload={regenerateMessage}
            // reload={reload}
            messages={messages}
          />
        </FlexRow>
        <FlexRow fullWidth className={"idxflex-grow-1"} colGap={0}>
          <Col className="idxflex-grow-1 pb-8" style={{ background: "white" }}>
            <AskInput
              contextMessage={getChatContextMessage()}
              onSubmit={async (value) => {
                sendMessage(value);
                trackEvent(CHAT_STARTED, {
                  type: view.discoveryType,
                });
              }}
              isLoading={isLoading}
              input={input}
              setInput={setInput}
            />
          </Col>
        </FlexRow>
      </Flex>
      {false && (
        <div
          style={{
            right: "30px",
            bottom: "70px",
            position: "fixed",
          }}
        >
          <ButtonScrollToBottom />
        </div>
      )}
    </>
  );
};

export default AskIndexes;
