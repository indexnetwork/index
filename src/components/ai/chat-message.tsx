// Inspired by Chatbot-UI and modified to fit the needs of this project
// @see https://github.com/mckaywrigley/chatbot-ui/blob/main/components/Chat/ChatMessage.tsx

import { Message } from "ai";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { CodeBlock } from "components/ai/ui/codeblock";
import { MemoizedReactMarkdown } from "components/ai/markdown";
import { IconOpenAI, IconUser } from "components/ai/ui/icons";
import { ChatMessageActions } from "components/ai/chat-message-actions";
import Col from "../layout/base/Grid/Col";
import FlexRow from "../layout/base/Grid/FlexRow";
import Text from "../base/Text";

export interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
	return (
		<FlexRow wrap={false}>
			<Col>
				{message.role === "user" ? <IconUser width={20} /> : <IconOpenAI width={20} />}
			</Col>
			<Col className="idxflex-grow-1 mx-4">
				<MemoizedReactMarkdown
					className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
					remarkPlugins={[remarkGfm, remarkMath]}
					components={{
						p({ children }) {
							return <Text>{children}</Text>;
						},
						code({
							node, inline, className, children, ...props
						}) {
							if (children.length) {
								if (children[0] === "▍") {
									return (
										<span className="mt-1 cursor-default animate-pulse">▍</span>
									);
								}

								children[0] = (children[0] as string).replace("`▍`", "▍");
							}

							const match = /language-(\w+)/.exec(className || "");

							if (inline) {
								return (
									<code className={className} {...props}>
										{children}
									</code>
								);
							}

							return (
								<CodeBlock
									key={Math.random()}
									language={(match && match[1]) || ""}
									value={String(children).replace(/\n$/, "")}
									{...props}
								/>
							);
						},
					}}
				>
					{message.content}
				</MemoizedReactMarkdown>
			</Col>
			<Col>
				<ChatMessageActions message={message} />
			</Col>
		</FlexRow>
	);
}
