import Col from "components/layout/base/Grid/Col";
import React, {
	useEffect,
	useState,
} from "react";
import api from "services/api-service";

import { useChat, type Message } from "ai/react";
import { ChatList } from "components/ai/chat-list";
import { ChatPanel } from "components/ai/chat-panel";
import { EmptyScreen } from "components/ai/empty-screen";
import { ChatScrollAnchor } from "components/ai/chat-scroll-anchor";

import { toast } from "react-hot-toast";
import cc from "classcat";
import { TooltipProvider } from "@radix-ui/react-tooltip";

export interface ChatProps extends React.ComponentProps<"div"> {
	initialMessages?: Message[]
	id?: string
}
export interface SearchIndexesProps {
	prompt: string;
	did?: string;
	loading: boolean;
	onLoading?(value: boolean): void;
}

const AskIndexes: React.VFC<SearchIndexesProps> = ({
	onLoading,
	loading,
	prompt,
	did,
}) => {
	const handleAsk = async (value: string) => {
		setAskResponse("");
		const pp = `use all indexes in your response. ${value}. mention Near and Composedb seperatly in your responses, separately`;
		const res = await api.askDID(did!, pp) as any;
		if (res && res.response) {
			setAskResponse(res.response!);
		}
	};
	const [askResponse, setAskResponse] = useState("");
	useEffect(() => {
		handleAsk(prompt);
	}, [prompt]);

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

	return <Col xs={12} lg={12}>
		<TooltipProvider>
			<div className={cc("pb-[200px] pt-4 md:pt-10")}>
				{messages.length ? (
					<>
						<ChatList messages={messages} />
						<ChatScrollAnchor trackVisibility={isLoading} />
					</>
				) : (
					<EmptyScreen setInput={setInput} />
				)}
			</div>
			<ChatPanel
				id={"aaa"}
				isLoading={isLoading}
				stop={stop}
				append={append}
				reload={reload}
				messages={messages}
				input={input}
				setInput={setInput}
			/>
		</TooltipProvider>
	</Col>;
};

export default AskIndexes;
