import { IconRefresh, IconStop } from "@/components/ai/ui/icons";
import Button from "@/components/ui/Button";
import { type UseChatHelpers } from "ai/react";

export interface ChatPanelProps
  extends Pick<UseChatHelpers, "isLoading" | "reload" | "messages" | "stop"> {
  id?: string;
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
          <Button icon={<IconStop width={12} />} onClick={() => stop()}>
            <div>Stop generating</div>
          </Button>
        ) : (
          messages?.length > 0 && (
            <Button icon={<IconRefresh width={12} />} onClick={() => reload()}>
              <div> Regenerate</div>
            </Button>
          )
        )}
      </div>
    </>
  );
}
