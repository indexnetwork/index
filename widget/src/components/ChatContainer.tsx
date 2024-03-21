import { appConfig } from "@/config";
import ChatHeader from "./ChatHeader";
import AskInput from "./AskInput";
import ChatBody from "./ChatBody";
import PoweredBy from "./ui/PoweredBy";
import ThemedContainer from "./ThemedContainer";

const ChatContainer: React.FC = () => {
  return (
    <ThemedContainer>
      <ChatHeader />
      <ChatBody
        indexIds={[
          "kjzl6kcym7w8yastd4ylcp2tbfxh5ftbasgzlwbsw1i4zbk86l81ebrnumzzkek",
        ]}
        chatID="lol"
      />
      {/* <AskInput /> */}
      <PoweredBy website={appConfig.website} />
    </ThemedContainer>
  );
};

export default ChatContainer;
