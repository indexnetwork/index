import { ChatProvider } from "./contexts/ChatContext";
import { ThemeProvider, ThemeProps } from "@/contexts/ThemeContext";
import Initializer from "@/components/Initializer";

interface IndexChatProps {
  sources: string[];
  style?: ThemeProps;
}

const IndexChat: React.FC<IndexChatProps> = ({ sources, style }) => {
  return (
    <ThemeProvider style={style}>
      <ChatProvider sources={sources}>
        <Initializer />
      </ChatProvider>
    </ThemeProvider>
  );
};

export default IndexChat;
