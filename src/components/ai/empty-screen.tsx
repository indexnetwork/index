import { UseChatHelpers } from "ai/react";

import Button from "components/base/Button";

import { IconArrowRight } from "components/ai/ui/icons";
import { useSearchParams } from "next/navigation";
import { selectProfile } from "store/slices/profileSlice";
import Text from "../base/Text";
import { useIndex } from "../../hooks/useIndex";
import { useApp } from "../../hooks/useApp";
import { maskDID } from "../../utils/helper";
import { useAppSelector } from "../../hooks/store";

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
	const {
		viewedProfile,
		section,
	} = useApp();
	const profile = useAppSelector(selectProfile);

	const getChatContextMessage = () => {
		if (index.index && index.index.title) {
			return `Chat with ${index.index.title}`;
		}
		if (viewedProfile && profile && viewedProfile.id === profile.id) {
			 const sections = {
				 owner: "indexes owned by you",
				 starred: "indexes starred by you",
				 all: "all your indexes",
			 };
			return `Chat with ${sections[section]} `;
		}
		if (viewedProfile && viewedProfile?.id) {
			 const sections = {
				 owner: "indexes owned by",
				 starred: "indexes starred by",
				 all: "all indexes of",
			 };
			return `Chat with ${sections[section]} ${viewedProfile.name || maskDID(viewedProfile.id)}`;
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
