import React, { ChangeEvent, KeyboardEvent, RefObject, createRef, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import Icon from '@/assets/icon';

const AskInput: React.FC = () => {
  const [inputValue, setInputValue] = useState('');
  const { sendMessage, isLoading } = useChat();
  const inputRef: RefObject<HTMLTextAreaElement> = createRef();

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
    adjustTextareaHeight(event.target);
  };

  const adjustTextareaHeight = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      handleSend();
    }
  };

  const handleSend = () => {
    if (!isLoading && inputValue.trim() !== '') {
      sendMessage(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="self-stretch pt-4">
      <div className='relative flex'>
        <textarea
          rows={1}
          aria-label="ask-input"
          onChange={handleInputChange}
          onKeyDown={handleKeyPress}
          value={inputValue}
          ref={inputRef}
          style={{
            resize: 'none',
            maxHeight: '6rem',
          }}
          className="h-fit text-primary border-default bg-transparent dynamic-placeholder dynamic-input transition-shadow duration-300 ease-in-out
            disabled:bg-grey-200 focus:outline-none text-sm border w-full pl-2.5 pr-10 py-2.5 rounded ring-opacity-50 focus:shadow-md "
          placeholder='Ask to all indexes'
        />
        <button onClick={handleSend} className="absolute top-0 bottom-0 right-3 m-auto">
          <Icon.SendMessage />
        </button>
      </div>
    </div>
  );
}

export default AskInput;
