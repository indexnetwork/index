import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { CHAT_STARTED, trackEvent } from "@/services/tracker";

import { useChat, type Message } from "@ai-sdk/react";

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
import { toast } from "react-hot-toast";
import { API_ENDPOINTS } from "utils/constants";
import { maskDID } from "utils/helper";
import NoIndexes from "../NoIndexes";

export interface ChatProps extends ComponentProps<"div"> {
  initialMessages?: Message[];
  id?: string;
}

export interface AskIndexesProps {
  chatID: string;
  sources?: string[];
}

export interface MessageWithIndex extends Message {
  index?: number;
}

const AskIndexes: FC<AskIndexesProps> = ({ chatID, sources }) => {
  const { viewedProfile, leftSectionIndexes, leftTabKey } = useApp();

  const { session } = useAuth();
  const { viewedIndex } = useApp();
  const { isIndex, id, discoveryType } = useRouteParams();
  const { ready: apiReady, api } = useApi();

  const [conversation, setConversation] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [editingMessage, setEditingMessage] = useState<Message | undefined>();
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [editInput, setEditInput] = useState<string>("");
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

  useEffect(() => {
    fetchDefaultQuestions();
  }, [fetchDefaultQuestions]);

  const handleEditClick = (message: Message, indexOfMessage: number) => {
    setEditingMessage(message);
    setEditingIndex(indexOfMessage);
    setEditInput(message.content);
  };

  const handleSaveEdit = async () => {
    if (editingMessage) {
      const messagesBeforeEdit = conversation.slice(0, editingIndex);

      const newMessage = {
        ...editingMessage,
        content: editInput,
      };

      //setMessages(messagesBeforeEdit);
      setEditingMessage(undefined);
      setEditInput("");
      await append({
        id: chatID,
        content: newMessage.content,
        role: "user",
      });
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

  const initialMessages: Message[] = [];
  const { append, reload, stop, input, setInput } = useChat({
    initialMessages,
    id: chatID,
    onResponse(response) {
      if (response.status === 401) {
        toast.error(response.statusText);
      }
    },
    onError(error) {
      console.error("Error loading chat messages", error);
      toast.error("Cannot load chat messages");
    },
  });

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bottomRef]);

  useEffect(() => {
    scrollToBottom();
  }, [conversation, isLoading, scrollToBottom]);

  const handleMessage = (event: any) => {
    const payload = JSON.parse(event.data);
    console.log("Received message from server", payload);

    if (payload.channel === "end") {
      console.log("End of stream");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setConversation((prevConversation) => {
      let streamingMessage = prevConversation.find(
        (c) => c.id === payload.data.messageId,
      );

      console.log(
        "Streaming message",
        streamingMessage,
        payload.data.messageId,
      );

      if (!streamingMessage) {
        console.log(`newmessage ${payload.data.messageId}`);
        streamingMessage = {
          id: payload.data.messageId,
          content: payload.data.chunk,
          role: "assistant",
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
  };
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socketUrl = `${process.env.NEXT_PUBLIC_API_URL!.replace(/^https/, "wss")}${API_ENDPOINTS.DISCOVERY_UPDATES.replace(":chatID", chatID)}`;
    wsRef.current = new WebSocket(socketUrl);
    wsRef.current.onmessage = (event) => {
      handleMessage(event);
    };
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [chatID, API_ENDPOINTS]);

  if (leftSectionIndexes.length === 0) {
    return <NoIndexes tabKey={leftTabKey} />;
  }

  return (
    <>
      <Flex
        id={chatID}
        key={chatID}
        className={
          sources &&
          sources?.filter((source) => !source.includes("did:")).length > 0
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
            {conversation.length ? (
              <>
                <ChatList
                  messages={conversation}
                  handleEditClick={handleEditClick}
                  editingMessage={editingMessage}
                  setEditInput={setEditInput}
                  editInput={editInput}
                  handleSaveEdit={handleSaveEdit}
                  editingIndex={editingIndex}
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
                  indexIds={sources?.filter(
                    (source) => !source.includes("did:"),
                  )}
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
            reload={reload}
            messages={conversation}
          />
        </FlexRow>
        <FlexRow fullWidth className={"idxflex-grow-1"} colGap={0}>
          <Col className="idxflex-grow-1 pb-8" style={{ background: "white" }}>
            <AskInput
              contextMessage={getChatContextMessage()}
              onSubmit={async (value) => {
                // TODO Post message here, can be async
                setConversation([
                  ...conversation,
                  {
                    id: chatID,
                    role: "user",
                    content: value,
                  } as Message,
                ]);
                trackEvent(CHAT_STARTED, {
                  type: discoveryType,
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
