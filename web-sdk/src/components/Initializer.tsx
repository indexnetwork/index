import { useState } from 'react';
import ChatContainer from "./ChatContainer";
import IndexButton from "./IndexButton";
import Modal from './ui/Modal';
import { useChat } from '@/contexts/ChatContext';

const Initializer: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { initializeChat, status } = useChat();

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  return (
    <>
      <IndexButton
        status={status}
        initializer={initializeChat}
        onClick={handleOpenModal} />
      <Modal isOpen={isModalOpen} onClose={handleCloseModal}>
        <ChatContainer />
      </Modal>
    </>
  );
};

export default Initializer;
