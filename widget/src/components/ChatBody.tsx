// import { useApi } from "@/context/APIContext";
// import { useApp } from "@/context/AppContext";
// import { useAuth } from "@/context/AuthContext";
// import { useRouteParams } from "@/hooks/useRouteParams";
import { useChat, type Message } from "ai/react";
import { ButtonScrollToBottom } from "@/components/ai/button-scroll-to-bottom";
import { ChatList } from "@/components/ai/chat-list";
import { ChatPanel } from "@/components/ai/chat-panel";
import { ChatScrollAnchor } from "@/components/ai/chat-scroll-anchor";
import { EmptyScreen } from "@/components/ai/empty-screen";
import AskInput from "@/components/AskInput";
import {
  ComponentProps,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "react-hot-toast";
import { maskDID } from "@/utils";
import BodyPlaceholder from "./BodyPlaceholder";
import Icon from "@/assets/icon";
import { useTheme } from "@/contexts/ThemeContext";
import { appConfig } from "@/config";
import { useIndexChat } from "@/contexts/ChatContext";
// import NoIndexes from "../NoIndexes";

export interface ChatProps extends ComponentProps<"div"> {
  initialMessages?: Message[];
  id?: string;
}

export interface MessageWithIndex extends Message {
  index?: number;
}

const ChatBody = () => {
  // const { viewedProfile, leftSectionIndexes, leftTabKey } = useApp();

  // const { session } = useAuth();
  // const { viewedIndex } = useApp();
  // const { isIndex, id } = useRouteParams();
  const { defaultQuestions, sources, chatID } = useIndexChat();
  const { darkMode } = useTheme();

  const [editingMessage, setEditingMessage] = useState<Message | undefined>();
  const [editingIndex, setEditingIndex] = useState<number | undefined>();
  const [editInput, setEditInput] = useState<string>("");

  const bottomRef = useRef<null | HTMLDivElement>(null);

  const tipBoxes = useMemo(() => {
    return defaultQuestions.map((q) => ({
      content: q,
    }));
  }, []);

  if (!sources) {
    return <>No sources provided</>;
  }

  // const fetchDefaultQuestions = useCallback(async (): Promise<void> => {
  //   // if (!apiReady || !isIndex) return;
  //   try {
  //     const questions = await api!.getDefaultQuestionsOfIndex(sources);
  //     setDefaultQuestions(questions);
  //   } catch (error) {
  //     console.error("Error fetching default questions", error);
  //   }
  // }, []);

  // useEffect(() => {
  //   fetchDefaultQuestions();
  // }, [fetchDefaultQuestions]);

  const handleEditClick = (message: Message, indexOfMessage: number) => {
    setEditingMessage(message);
    setEditingIndex(indexOfMessage);
    setEditInput(message.content);
  };

  const handleSaveEdit = async () => {
    if (editingMessage) {
      const messagesBeforeEdit = messages.slice(0, editingIndex);

      const newMessage = {
        ...editingMessage,
        content: editInput,
      };

      setMessages(messagesBeforeEdit);
      setEditingMessage(undefined);
      setEditInput("");
      await append({
        id: chatID, // TODO: handle better
        content: newMessage.content,
        role: "user",
      });
    }
  };

  // const tipBoxes = [
  //   {
  //     content:
  //       "What are the best practices for scaling a ComposeDB application?",
  //     icon: <Icon.LightBulb />,
  //   },
  //   {
  //     content: "How can I integrate Ceramic Network with Lit Protocol?",
  //     icon: <Icon.LightBulb />,
  //   },
  // ];

  const apiUrl = `${appConfig.apiUrl}/api/discovery/chat`;
  const initialMessages: Message[] = [];
  let body;
  if (sources[0].includes("did")) {
    body = {
      id: chatID,
      did: sources[0],
    };
  } else {
    body = {
      id: chatID,
      indexIds: sources,
    };
  }
  const {
    messages,
    append,
    reload,
    stop,
    isLoading,
    input,
    setInput,
    setMessages,
  } = useChat({
    api: apiUrl,
    initialMessages,
    id: chatID,
    body,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Authorization: `Bearer ${session?.serialize()}`,
    },
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
  }, [messages, isLoading]);

  // if (messages.length === 0) {
  //   return (
  //     <BodyPlaceholder
  //       tipBoxes={tipBoxes}
  //       darkMode={darkMode}
  //       sendMessage={setInput}
  //     />
  //   );
  // }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
        id={chatID}
        key={chatID}
        // className={indexIds ? "px-0 pt-7" : "px-md-10 px-0 pt-7"}
        className="h-chatBody flex flex-col gap-6 overflow-y-auto"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            flexWrap: "wrap",
            alignSelf: "start",
            flex: "1 1 auto",
          }}
        >
          <div className="">
            {messages.length ? (
              <div className="mt-4">
                <ChatList
                  messages={messages}
                  handleEditClick={handleEditClick}
                  editingMessage={editingMessage}
                  setEditInput={setEditInput}
                  editInput={editInput}
                  handleSaveEdit={handleSaveEdit}
                  editingIndex={editingIndex}
                />
                <div ref={bottomRef} />
                <ChatScrollAnchor trackVisibility={isLoading} />
              </div>
            ) : (
              // <div
              //   style={{
              //     display: "flex",
              //     flexDirection: "column",
              //     height: "100%",
              //     justifyContent: "center",
              //     alignItems: "center",
              //   }}
              //   className="px-8"
              // >
              //   <EmptyScreen
              //     contextMessage={getChatContextMessage()}
              //     setInput={setInput}
              //     indexIds={indexIds}
              //     defaultQuestions={defaultQuestions}
              //   />
              // </div>
              <BodyPlaceholder
                tipBoxes={tipBoxes}
                darkMode={darkMode}
                sendMessage={setInput}
              />
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
        className={"chat-input px-md-10 self-stretch"}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
          }}
        >
          <ChatPanel
            isLoading={isLoading}
            stop={stop}
            reload={reload}
            messages={messages}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            width: "100%",
          }}
          className={""}
        >
          <AskInput
            contextMessage={"indexes"}
            onSubmit={async (value: any) => {
              await append({
                id: chatID,
                content: value,
                role: "user",
              });
            }}
            isLoading={isLoading}
            input={input}
            setInput={setInput}
          />
        </div>
      </div>
      {false && (
        <div
          style={{
            right: "30px",
            bottom: "70px",
            position: "fixed",
          }}
        >
          {/* <ButtonScrollToBottom /> */}
        </div>
      )}
    </>
  );
};

export default ChatBody;
