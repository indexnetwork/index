import { type Message } from "ai";

import { ChatMessage } from "components/ai/chat-message";
import React from "react";

export interface ChatList {
  messages: Message[]
}

export function ChatList({ messages }: ChatList) {
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
							<div className={"my-6"} style={{height: "1px", backgroundColor: "var(--gray-2)"}}></div>
						</div>
					)}
				</div>
			))}
		</div>
	);
}
