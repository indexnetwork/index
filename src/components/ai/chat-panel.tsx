import { type UseChatHelpers } from "ai/react";

import Button from "components/base/Button";
import { IconRefresh, IconStop } from "components/ai/ui/icons";
import IconSearch from "../base/Icon/IconSearch";
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
						addOnBefore={<IconStop width={20} />}
						onClick={() => stop()}
						size="lg"
						theme="clear"
					>
						<div className={"mx-2"}>Stop generating</div>
					</Button>
				) : (
					messages?.length > 0 && (
						<Button
							addOnBefore={<IconRefresh width={20} />}
							onClick={() => reload()}
							size="lg"
							theme="clear"
						>
							<div className={"mx-2"}> Regenerate response</div>
						</Button>
					)
				)}
			</div>
		</>
	);
}
