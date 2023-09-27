import { type Message } from "ai";

import { ChatMessage } from "components/ai/chat-message";
import React from "react";

export interface ChatListInterface {
  messages: Message[]
}

export const ChatList = ({ messages }: ChatListInterface) => {
	if (!messages.length) {
		return null;
	}
	return (
		<div>
			{messages.map((message, index) => (
				<div key={index}>
					<ChatMessage message={message} />
					{index < messages.length - 1 && (
						<div className="pl-8">
							<div className={"my-8"}></div>
						</div>
					)}
				</div>
			))}
			<div style={{ width: "100%", height: "15rem" }}></div>
		</div>
	);
};
