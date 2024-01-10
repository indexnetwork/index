import { ChatProvider } from './contexts/ChatContext';
import { ThemeProvider, ThemeProps } from '@/contexts/ThemeContext';
import Initializer from '@/components/Initializer';

interface IndexChatProps {
  id: string;
  style?: ThemeProps;
}

const IndexChat: React.FC<IndexChatProps> = ({ id, style }) => {
  return (
    <ThemeProvider style={style}>
      <ChatProvider id={id}>
        <Initializer />
      </ChatProvider>
    </ThemeProvider>
  );
};

export default IndexChat;
