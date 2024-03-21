import { Message as MessageType } from '@/types';

interface MessageProps {
  message: MessageType;
  avatarSrc: string;
};

const Message: React.FC<MessageProps> = ({ message, avatarSrc }) => {
  return (
    <div aria-label='chat-message' className={`flex items-start gap-3`}>
      <img src={avatarSrc} alt="Avatar" className="w-6 h-6 rounded-sm" />
      <div className="rounded-lg">
        <p dangerouslySetInnerHTML={{ __html: message.content }}
          className='whitespace-break-spaces w-full break-words text-sm font-normal' />
      </div>
    </div>
  );
};

export default Message;
