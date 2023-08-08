import Col from "components/layout/base/Grid/Col";
import React from "react";
import { useChat, type Message } from "ai/react";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { EmptyScreen } from "components/ai/empty-screen";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";
import { toast } from "react-hot-toast";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import AskInput from "components/base/AskInput";
import RadioGroup from "components/base/RadioGroup";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { ButtonScrollToBottom } from "components/ai/button-scroll-to-bottom";
import Container from "components/layout/base/Grid/Container";

export interface ChatProps extends React.ComponentProps<"div"> {
	initialMessages?: Message[]
	id?: string
}
export interface SearchIndexesProps {
	did?: string;
	setInteractionMode(value: string): void;
}

const AskIndexes: React.VFC<SearchIndexesProps> = ({
	setInteractionMode,
	did,
}) => {
	const apiUrl = "http://localhost:8000/index/seref/chat_stream";
	const initialMessages: Message[] = [];
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

	return <>
		<FlexRow>
			<Col xs={12} lg={9} centerBlock>
				<FlexRow>
					<TooltipProvider>
						<Col>
							<Container style={{
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

								<FlexRow>
									<Col centerBlock xs={12} lg={9}>
										<FlexRow className={"mb-5"} justify={"center"} align={"center"}>
											<ChatPanel
												isLoading={isLoading}
												stop={stop}
												reload={reload}
												messages={messages}
											/>
										</FlexRow>
										<FlexRow colGap={2} style={{ background: "white" }}>
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
												  isLoading={isLoading}
												  input={input}
												  setInput={setInput}
												/>
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
							</Container>
						</Col>
						<Col xs={12}>
							<div style={{ paddingBottom: "150px" }}>
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
			</Col>
		</FlexRow>
	</>;
};

export default AskIndexes;
