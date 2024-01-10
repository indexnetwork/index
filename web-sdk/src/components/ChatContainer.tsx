import { appConfig } from '@/config';
import ChatHeader from './ChatHeader';
import AskInput from './AskInput';
import ChatBody from './ChatBody';
import PoweredBy from './ui/PoweredBy';
import ThemedContainer from './ThemedContainer';

const ChatContainer: React.FC = () => {
  return (
    <ThemedContainer>
      <ChatHeader />
      <ChatBody />
      <AskInput />
      <PoweredBy website={appConfig.website} />
    </ThemedContainer>
  )
}

export default ChatContainer;
