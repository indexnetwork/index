import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { IndexStatus, Message, Participant, ParticipantProfile } from '@/types';
import { ApiService } from '@/services/api-service';
import { appConfig } from '@/config';

export interface ChatContextType {
  messages: Message[];
  status: IndexStatus;
  sendMessage: (content: string) => Promise<void>;
  initializeChat: () => void;
  isLoading: boolean;
  isWalletConnected: boolean;
  setIsWalletConnected: (isWalletConnected: boolean) => void;
  clearMessages: () => void;
  userProfile: ParticipantProfile | undefined,
};

interface ChatProviderProps {
  children: ReactNode;
  id: string;
}

const defaultContext: ChatContextType = {
  messages: [],
  sendMessage: async () => { },
  initializeChat: () => { },
  isLoading: false,
  isWalletConnected: false,
  setIsWalletConnected: () => { },
  status: IndexStatus.Init,
  clearMessages: () => { },
  userProfile: undefined,
};

const ChatContext = createContext<ChatContextType>(defaultContext);

export const useChat = () => useContext(ChatContext);

export const ChatProvider: React.FC<ChatProviderProps> = ({ children, id }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [status, setStatus] = useState<IndexStatus>(IndexStatus.Init);
  const [userProfile, setUserProfile] = useState<ParticipantProfile | undefined>();

  const apiService = new ApiService({ baseUrl: appConfig.apiUrl, id });
  
  const consumeStream = useCallback(async (messages: Message[]) => {
    setIsLoading(true);
    try {
      for await (const chunk of apiService.streamMessages(messages)) {
        setMessages(prevMessages => {
          const lastIndex = prevMessages.length - 1;
          const updatedMessages = [...prevMessages];
          updatedMessages[lastIndex] = {
            ...updatedMessages[lastIndex],
            content: updatedMessages[lastIndex].content + chunk
          };
          return updatedMessages;
        });
      }
    } catch (error) {
      console.error('Error while streaming messages:', error);
    } finally {
      setIsLoading(false);
    }
  }, [apiService]);

  const sendMessage = useCallback(async (userContent: string) => {
    const newMessage: Message = { content: userContent, role: Participant.User };
    const updatedMessages = [...messages, newMessage, { content: '', role: Participant.Assistant }];
    setMessages(updatedMessages);
    consumeStream([...messages, newMessage]);
  }, [messages, consumeStream]);

  const initializeChat = async () => {
    try {
      const indexData = await apiService.fetchIndex();
      setUserProfile({
        id: indexData.id,
        name: indexData.ownerDID.name,
        avatar: `${appConfig.ipfsGateway}/${indexData.ownerDID.avatar}`,
        bio: indexData.ownerDID.bio,
      });
      setStatus(IndexStatus.Success);
    } catch (error) {
      console.error('Error while initializing:', error);
      setStatus(IndexStatus.Fail);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  return (
    <ChatContext.Provider value={{
      status,
      isWalletConnected,
      setIsWalletConnected,
      messages,
      sendMessage,
      initializeChat,
      isLoading,
      clearMessages,
      userProfile,
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export default ChatContext;
