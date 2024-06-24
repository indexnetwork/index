import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { CHAT_STARTED, trackEvent } from "@/services/tracker";
import {
  createConversation,
  regenerateMessage,
  sendMessage,
  updateMessageThunk,
} from "@/store/api/conversation";
import { selectView } from "@/store/slices/appViewSlice";
import {
  addMessage,
  deleteMessage,
  selectConversation,
} from "@/store/slices/conversationSlice";
import { selectDID } from "@/store/slices/didSlice";
import { selectIndex } from "@/store/slices/indexSlice";
import { useAppDispatch, useAppSelector } from "@/store/store";
import { API_ENDPOINTS } from "@/utils/constants";
import { type Message } from "@ai-sdk/react";
import { generateId } from "ai";
import { ButtonScrollToBottom } from "components/ai/button-scroll-to-bottom";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";
import { EmptyScreen } from "components/ai/empty-screen";
import AskInput from "components/base/AskInput";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useRouter } from "next/navigation";
import {
  ComponentProps,
  FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { maskDID } from "utils/helper";

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
  const { leftSectionIndexes, leftTabKey, conversations, setConversations } =
    useApp();
  const { isIndex, conversationId, id } = useRouteParams();
  const { ready: apiReady, api } = useApi();
  const router = useRouter();

  const dispatch = useAppDispatch();
  const { data: viewedConversation } = useAppSelector(selectConversation);
  const { data: viewedIndex } = useAppSelector(selectIndex);
  const { data: viewedProfile } = useAppSelector(selectDID);
  const view = useAppSelector(selectView);
  const [streamingMessages, setStreamingMessages] = useState<any>([]);

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

  const handleSendMessage = useCallback(
    async (messageStr: string) => {
      if (!apiReady || !api) return;
      try {
        const newMessage: Message = {
          id: generateId(),
          role: "user",
          content: messageStr,
        };

        let currentConv = viewedConversation;
        if (!currentConv && id) {
          const response = await dispatch(
            createConversation({
              sources: [id],
              summary: messageStr,
              api,
            }),
          ).unwrap();
          currentConv = response;
          setConversations([response, ...conversations]);
        }

        if (!currentConv) {
          throw new Error("No conversation found");
        }

        await dispatch(
          sendMessage({
            prevID: newMessage.id,
            content: messageStr,
            role: "user",
            conversationId: currentConv.id,
            api,
          }),
        ).unwrap();

        router.push(`/conversation/${currentConv.id}`);
      } catch (error) {
        console.error("Error sending message", error);
      }
    },
    [
      api,
      viewedConversation?.id,
      id,
      dispatch,
      router,
      setConversations,
      conversations,
      apiReady,
    ],
  );

  useEffect(() => {
    fetchDefaultQuestions();
  }, [fetchDefaultQuestions]);

  const handleEditClick = (message: Message, indexOfMessage: number) => {
    setEditingMessage(message);
    setEditingIndex(indexOfMessage);
    setEditInput(message.content);
  };

  const handleSaveEdit = useCallback(async () => {
    if (!apiReady || !api || !viewedConversation || !editingMessage) return;
    try {
      await dispatch(
        updateMessageThunk({
          conversationId: viewedConversation.id,
          messageId: editingMessage.id,
          content: editInput,
          api,
        }),
      ).unwrap();
      setEditingMessage(undefined);
      setEditInput("");
    } catch (error: any) {
      console.error("An error occurred:", error.message);
    }
  }, [dispatch, api, apiReady, viewedConversation, editingMessage, editInput]);

  const handleRegenerateMessage = useCallback(async () => {
    if (!apiReady || !api || !viewedConversation) return;

    await dispatch(
      regenerateMessage({
        conversationId: viewedConversation.id,
        api,
      }),
    );
  }, [api, viewedConversation, apiReady, dispatch]);

  const getChatContextMessage = useCallback((): string => {
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
  }, [
    viewedProfile,
    viewedIndex,
    viewedConversation,
    leftTabKey,
    isIndex,
    session,
  ]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bottomRef]);

  useEffect(() => {
    // scrollToBottom();
  }, [viewedConversation, isLoading, scrollToBottom]);

  const stop = () => {
    setIsLoading(false);
    // TODO send stop signal to backend.
    setStoppedMessages(viewedConversation?.messages.map((c) => c.id));
  };

  useEffect(() => {
    const handleIncomingMessage = (p: any) => {
      if (p.channel === "end") {
        setStreamingMessages((prevMessages: any) => {
          const streamingMessage = prevMessages.find(
            (m: any) => m.id === p.data.messageId,
          );
          if (!streamingMessage) return prevMessages;

          dispatch(addMessage(streamingMessage));

          return prevMessages.filter((m: any) => m.id !== p.data.messageId);
        });

        return;
      }

      setStreamingMessages((prevMessages: any) => {
        let streamingMessage = prevMessages.find(
          (m: any) => m.id === p.data.messageId,
        );

        if (!streamingMessage) {
          streamingMessage = viewedConversation.messages.find(
            (m: any) => m.id === p.data.messageId,
          );
          if (streamingMessage) {
            dispatch(deleteMessage(streamingMessage.id));
            return [...prevMessages, streamingMessage];
          }

          const initialAssistantMessage = {
            id: p.data.messageId,
            role: "assistant",
            name: "basic_assistant",
            content: p.data.chunk,
          };
          return [...prevMessages, initialAssistantMessage];
        }

        if (p.channel === "chunk") {
          return prevMessages.map((m: any) =>
            m.id === p.data.messageId
              ? {
                  ...m,
                  content: m.content + p.data.chunk,
                }
              : m,
          );
        }

        return prevMessages;
      });
    };

    if (!viewedConversation) return;
    const eventUrl = `${process.env.NEXT_PUBLIC_API_URL!}${API_ENDPOINTS.CONVERSATION_UPDATES.replace(":conversationId", viewedConversation.id)}?session=${session?.serialize()}`;
    const eventSource = new EventSource(eventUrl);
    eventSource.onmessage = (event) => {
      console.log("324 Received message from server", event.data);
      handleIncomingMessage(JSON.parse(event.data));
    };

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      eventSource.close();
    };
    return () => eventSource.close();
  }, [viewedConversation, session]);

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
            (source: string) => !source.includes("did:"),
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
            {viewedConversation ? (
              <>
                <ChatList
                  messages={[
                    ...(viewedConversation?.messages || []),
                    ...streamingMessages,
                  ]}
                  handleEditClick={handleEditClick}
                  editingMessage={editingMessage}
                  setEditInput={setEditInput}
                  editInput={editInput}
                  handleSaveEdit={handleSaveEdit}
                  editingIndex={editingIndex}
                  regenerate={handleRegenerateMessage}
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
                      (source: string) => !source.includes("did:"),
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
            // reload={regenerateMessage}
            // reload={reload}
            messages={viewedConversation?.messages}
          />
        </FlexRow>
        <FlexRow fullWidth className={"idxflex-grow-1"} colGap={0}>
          <Col className="idxflex-grow-1 pb-8" style={{ background: "white" }}>
            <AskInput
              contextMessage={getChatContextMessage()}
              onSubmit={async (value) => {
                handleSendMessage(value);
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
