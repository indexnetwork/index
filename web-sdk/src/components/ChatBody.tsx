import { useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import Message from './ui/Message';
import BodyPlaceholder from './BodyPlaceholder';
import { Participant } from '@/types';
import AssistantAvatar from '@/assets/image/av_system.png';
import { useTheme } from '@/contexts/ThemeContext';
import Icon from '@/assets/icon';

const ChatBody: React.FC = () => {
  const { messages, userProfile, sendMessage } = useChat();
  const { darkMode } = useTheme();
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  const tipBoxes = [
    {
      content: 'What are the best practices for scaling a ComposeDB application?',
      icon: <Icon.LightBulb />
    },
    {
      content: 'How can I integrate Ceramic Network with Lit Protocol?',
      icon: <Icon.LightBulb />
    },
  ]

  const scrollToBottom = () => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (messages.length === 0) {
    return <BodyPlaceholder
      tipBoxes={tipBoxes}
      darkMode={darkMode}
      sendMessage={sendMessage} />;
  }

  return (
    <div className="h-chatBody overflow-y-auto flex flex-col gap-6 mt-4">
      {messages.map((msg, index) => (
        <Message
          key={index}
          message={msg}
          avatarSrc={msg.role === Participant.User ? userProfile?.avatar : AssistantAvatar}
        />
      ))}
      <div ref={endOfMessagesRef} />
    </div>
  );
}

export default ChatBody;
