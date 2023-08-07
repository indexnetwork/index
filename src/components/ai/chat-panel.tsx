import { type UseChatHelpers } from "ai/react";

import Button from "components/base/Button";
import { ButtonScrollToBottom } from "components/ai/button-scroll-to-bottom";
import { IconRefresh, IconStop } from "components/ai/ui/icons";
import FlexRow from "../layout/base/Grid/FlexRow";
import Flex from "../layout/base/Grid/Flex";

export interface ChatPanelProps
  extends Pick<
    UseChatHelpers,
    | "isLoading"
    | "reload"
    | "messages"
    | "stop"
  > {
  id?: string
}

export function ChatPanel({
	isLoading,
	stop,
	reload,
	messages,
}: ChatPanelProps) {
	return (
		<>
			<div className="mx-auto sm:max-w-2xl sm:px-4">
				<Flex alignItems="center" className={"text-center"}>
					{isLoading ? (
						<Button
							onClick={() => stop()}
							size="lg"
							theme="clear"
						>
							<IconStop width={20} className="mr-2" />
              Stop generating
						</Button>
					) : (
						messages?.length > 0 && (
							<Button
								onClick={() => reload()}
								size="lg"
								theme="clear"
							>
								<IconRefresh width={20} className="mr-2" />
                Regenerate response
							</Button>
						)
					)}
				</Flex>
			</div>
		</>
	);
}
