import Col from "components/layout/base/Grid/Col";
import React from "react";
import { useChat, type Message } from "ai/react";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { EmptyScreen } from "components/ai/empty-screen";
import { toast } from "react-hot-toast";
import AskInput from "components/base/AskInput";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { ButtonScrollToBottom } from "components/ai/button-scroll-to-bottom";
import { API_ENDPOINTS } from "utils/constants";
import Flex from "components/layout/base/Grid/Flex";
import { maskDID } from "utils/helper";
import { useIndex } from "hooks/useIndex";
import { useApp } from "hooks/useApp";
import { useAppSelector } from "hooks/store";
import { selectProfile } from "store/slices/profileSlice";
import NoIndexesChat from "components/ai/no-indexes";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";

export interface ChatProps extends React.ComponentProps<"div"> {
  initialMessages?: Message[];
  id?: string;
}
export interface AskIndexesProps {
  id: string;
  did?: string;
  indexes?: string[];
}

const AskIndexes: React.VFC<AskIndexesProps> = ({ id, did, indexes }) => {
  const index = useIndex();
  const { viewedProfile, section, indexes: indexesFromApp } = useApp();
  const profile = useAppSelector(selectProfile);

  const getChatContextMessage = (): string => {
    if (index.index && index.index.title) {
      return index.index.title;
    }
    if (viewedProfile && profile && viewedProfile.id === profile.id) {
      const sections = {
        owner: "indexes owned by you",
        starred: "indexes starred by you",
        all: "all your indexes",
      };
      return sections[section];
    }
    if (viewedProfile && viewedProfile?.id) {
      const sections = {
        owner: "indexes owned by",
        starred: "indexes starred by",
        all: "all indexes of",
      };
      return `${sections[section]} ${
        viewedProfile.name || maskDID(viewedProfile.id)
      }`;
    }
    return `indexes`;
  };

  const apiUrl = `https://index.network/api${API_ENDPOINTS.CHAT_STREAM}`;
  const initialMessages: Message[] = [];
  const {
	 messages, append, reload, stop, isLoading, input, setInput,
	} =
    useChat({
      api: apiUrl,
      initialMessages,
      id,
      body: {
        id,
        did,
        indexes,
      },
      headers: { "Content-Type": "application/json; charset=utf-8" },
      onResponse(response) {
        if (response.status === 401) {
          toast.error(response.statusText);
        }
      },
    });
  return (
    <>
      <Flex
        id={id}
        key={id}
        className={"px-0 px-md-10 pt-8 scrollable-area"}
        flexDirection={"column"}
      >
        <FlexRow wrap={true} align={"start"}>
          {indexesFromApp.all && indexesFromApp.all.totalCount !== 0 ? (
            <Col className="idxflex-grow-1" style={{ width: "100%" }}>
              {messages.length ? (
                <>
                  <ChatList messages={messages} />
                  <ChatScrollAnchor trackVisibility={isLoading} />
                </>
              ) : (
                <Flex>
                  <EmptyScreen
                    contextMessage={getChatContextMessage()}
                    setInput={setInput}
					indexes={indexes}
                  />
                </Flex>
              )}
            </Col>
          ) : (
            <NoIndexesChat />
          )}
        </FlexRow>
      </Flex>
      <Flex
        className={"chat-input idxflex-grow-1 px-md-10"}
        flexDirection={"column"}
      >
        <FlexRow className={"mb-5"} justify={"center"} align={"center"}>
          <ChatPanel
            isLoading={isLoading}
            stop={stop}
            reload={reload}
            messages={messages}
          />
        </FlexRow>
        <FlexRow fullWidth className={"idxflex-grow-1 px-9"} colGap={0}>
          <Col className="idxflex-grow-1 pb-8" style={{ background: "white" }}>
            <AskInput
              contextMessage={getChatContextMessage()}
              onSubmit={async (value) => {
                await append({
                  id,
                  content: value,
                  role: "user",
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
