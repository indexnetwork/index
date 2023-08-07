import Col from "components/layout/base/Grid/Col";
import React, {
	useEffect,
} from "react";

import { useChat, type Message } from "ai/react";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { EmptyScreen } from "components/ai/empty-screen";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";

import { toast } from "react-hot-toast";
import cc from "classcat";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import AskInput from "../../../base/AskInput";
import RadioGroup from "../../../base/RadioGroup";
import FlexRow from "../../../layout/base/Grid/FlexRow";
import {ButtonScrollToBottom} from "../../../ai/button-scroll-to-bottom";

export interface ChatProps extends React.ComponentProps<"div"> {
	initialMessages?: Message[]
	id?: string
}
export interface SearchIndexesProps {
	did?: string;
	setInteractionMode(value: string): void;
	onLoading?(value: boolean): void;
}

const AskIndexes: React.VFC<SearchIndexesProps> = ({
	onLoading,
	setInteractionMode,
	did,
}) => {
	const apiUrl = "http://localhost:8000/index/seref/chat_stream";
	const initialMessages = [];
	const id = "aaa";
	const {
		messages, append, reload, stop, isLoading, input, setInput,
	} =
	useChat({
		api: apiUrl,
		initialMessages,
		id,
		body: {
			id,
		},
		headers: { "Content-Type": "application/json; charset=utf-8" },
		onResponse(response) {
			if (response.status === 401) {
				toast.error(response.statusText);
			}
		},
	});
	useEffect(() => {
		onLoading && onLoading(isLoading);
	}, [isLoading]);

	return <>
		<FlexRow colSpacing={1}>
		<TooltipProvider>
			<Col>
				<div style={{
					position: "fixed",
					left: 0,
					right: 0,
					bottom: "20px",
					zIndex: 10,
				}}>
					<div style={{
						right: "50px",
						position: "fixed",
					}}>
						<ButtonScrollToBottom/>
					</div>

					<FlexRow colSpacing={4}>
						<Col centerBlock xs={12} lg={6}>
							<FlexRow className={"mb-5"} justify={"center"} align={"center"}>
								<ChatPanel
									isLoading={isLoading}
									stop={stop}
									reload={reload}
									messages={messages}
								/>
							</FlexRow>
							<FlexRow  colSpacing={1} style={{ background: "white" }}>
								<Col
									className="idxflex-grow-1"
								>
									<AskInput onSubmit={async (value) => {
										await append({
											id,
											content: value,
											role: "user",
										});
									}}
											  input={input}
											  setInput={setInput}
											  placeholder={"Ask"} />
								</Col>
								<Col>
									<RadioGroup className={"px-1"} value="ask" onSelectionChange={(value: "search" | "ask") => setInteractionMode(value)}
										items={[
											{
												value: "search",
												title: "Search",
											},
											{
												value: "ask",
												title: "Ask",
											},
										]}
									/>
								</Col>
							</FlexRow>
						</Col>
					</FlexRow>
				</div>
			</Col>
			<Col xs={12} lg={12}>
				<div style={{"padding-bottom": "150px"}}>
					{messages.length ? (
						<>
							<ChatList messages={messages} />
							<ChatScrollAnchor trackVisibility={isLoading} />
						</>
					) : (
						<EmptyScreen setInput={setInput} />
					)}
				</div>
			</Col>
		</TooltipProvider>
		</FlexRow>
	</>;
};

export default AskIndexes;
