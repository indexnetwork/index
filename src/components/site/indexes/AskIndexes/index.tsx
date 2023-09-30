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

export interface ChatProps extends React.ComponentProps<"div"> {
	initialMessages?: Message[]
	id?: string
}
export interface SearchIndexesProps {
	id: string;
	did?: string;
	indexes?: string[],
}

const AskIndexes: React.VFC<SearchIndexesProps> = ({
	id,
	did,
	indexes,
}) => {
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

	return <>
		<Flex className={"px-0 px-md-10 pt-8 scrollable-area"} flexDirection={"column"}>
			<FlexRow wrap={true} align={"start"} >
				<Col className="idxflex-grow-1" style={{ width: "100%" }}>
					{messages.length ? (
						<>
							<ChatList messages={messages} />
						</>
					) : (
						<Flex style={{ height: "300px", borderRadius: "5px" }}>
							<EmptyScreen setInput={setInput} />
						</Flex>
					)}
				</Col>
			</FlexRow>
		</Flex>
		<Flex className={"chat-input idxflex-grow-1 px-md-10"} flexDirection={"column"} >
			<FlexRow className={"mb-5"} justify={"center"} align={"center"}>
				<ChatPanel
					isLoading={isLoading}
					stop={stop}
					reload={reload}
					messages={messages}
				/>
			</FlexRow>
			<FlexRow fullWidth className={"idxflex-grow-1 px-9"} colGap={0}>
				<Col
					className="idxflex-grow-1 pb-8"
					style={{ background: "white" }}
				>
					<AskInput onSubmit={async (value) => {
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
		{ false && <div style={{
			right: "30px",
			bottom: "70px",
			position: "fixed",
		}}>
			<ButtonScrollToBottom/>
		</div>}
	</>;
};

export default AskIndexes;
