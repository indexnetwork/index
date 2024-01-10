import { useEffect } from 'react';
import Button from './ui/Button';
import { IndexStatus } from '@/types';

interface IndexButtonProps {
  onClick?: () => void;
  initializer: () => void;
  status: IndexStatus;
}

const labels: Record<IndexStatus, string> = {
  init: 'Initializing...',
  success: 'Start Your Chat',
  fail: 'Failed to Initialize',
};

const IndexButton: React.FC<IndexButtonProps> = ({ onClick, initializer, status }) => {

  const handleClick = () => {
    if (status === IndexStatus.Success) {
      onClick && onClick();
    }
  }

  useEffect(() => {
    initializer();
  }, []);

  return (
    <Button
      type='primary'
      onClick={handleClick}
      label={labels[status]}
    />
  );
};

export default IndexButton;
