import { UseChatHelpers } from "ai/react";

import Button from "components/base/Button";

import { IconArrowRight } from "components/ai/ui/icons";
import Text from "../base/Text";

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
	return (
		<div className="card-item mx-auto ">
			<div className="rounded-lg border bg-background p-8">

				<Text fontFamily="freizeit" size={"xl"} fontWeight={700} className={"mb-2"}>
					Chat with your indexes
				</Text>
				<br /><br />
				<Text fontFamily="freizeit" size={"md"} fontWeight={500}>
					Your responses will align with all your indexes.
					<br />
          			You can start a conversation here or try the following examples:
				</Text>
				<div className="mt-4">
					{exampleMessages.map((message, index) => (<div>
						<Button
							key={index}
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
