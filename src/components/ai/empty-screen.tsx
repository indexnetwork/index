import { UseChatHelpers } from "ai/react";

import Button from "components/base/Button";

import { IconArrowRight } from "components/ai/ui/icons";
import { useSearchParams } from "next/navigation";
import Text from "../base/Text";
import { useIndex } from "../../hooks/useIndex";

const exampleMessages = [
	{
		heading: "What's new today?",
		message: `Summarize today's content.`,
	},
	{
		heading: "Summarize my indexes",
		message: "Summarize all my sources",
	},
	{
		heading: "Draft an email",
		message: `Draft an email to my boss.`,
	},
];

export function EmptyScreen({ setInput }: Pick<UseChatHelpers, "setInput">) {
	const searchParams = useSearchParams();
	const index = useIndex();
	const getChatContextMessage = () => {
		const section = searchParams.get("section");
		if (section) {
			switch (section) {
				case "my_indexes":
					return `Chat with indexes created by you`;
				case "starred":
					return `Chat with indexes starred by you`;
				default:
					return `Chat with all your indexes`;
			}
		} else if (index.index) {
			return `Chat with ${index.index.title}`;
		}
	};
	return (
		<div className="card-item mx-10 idxflex-grow-1">
			<div className="rounded-lg border bg-background p-8">

				<Text fontFamily="freizeit" size={"xl"} fontWeight={700} className={"mb-2"}>
					{getChatContextMessage()}
				</Text>
				<br /><br />
				<Text fontFamily="freizeit" size={"md"} fontWeight={500}>
					Your responses will align with all your indexes.
					<br />
          			You can start a conversation here or try the following examples:
				</Text>
				<div className="mt-4">
					{exampleMessages.map((message, i) => (<div key={i}>
						<Button
							key={i}
							theme={"ghost"}
							addOnBefore={<IconArrowRight width={20} />}
							onClick={() => setInput(message.message)}
						>
							<div className={"ml-2"}>{message.heading}</div>
						</Button>
					</div>))}
				</div>
			</div>
		</div>
	);
}
