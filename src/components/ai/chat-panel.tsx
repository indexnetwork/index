import { type UseChatHelpers } from "ai/react";

import Button from "components/base/Button";
import { IconRefresh, IconStop } from "components/ai/ui/icons";
import React from "react";

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
			<div>
				{isLoading ? (
					<Button
						addOnBefore={<IconStop width={12} />}
						onClick={() => stop()}
						theme="panel"
					>
						<div className={"ml-3 text-md"}>Stop generating</div>
					</Button>
				) : (
					messages?.length > 0 && (
						<Button
							addOnBefore={<IconRefresh width={12} />}
							onClick={() => reload()}
							theme="panel"
						>
							<div className={"ml-3 text-md"}> Regenerate</div>
						</Button>
					)
				)}
			</div>
		</>
	);
}
