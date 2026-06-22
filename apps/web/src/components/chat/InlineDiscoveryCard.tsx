import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MessageCircle, User } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import InviteMessageModal from '@/components/InviteMessageModal';
import type { DiscoveryOpportunity } from '@/contexts/AIChatContext';

interface InlineDiscoveryCardProps {
  discovery: DiscoveryOpportunity;
}

export default function InlineDiscoveryCard({ discovery }: InlineDiscoveryCardProps) {
  const navigate = useNavigate();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');

  const candidateName = discovery.candidateName || 'this person';

  const handleViewProfile = () => {
    navigate(`/u/${discovery.candidateId}`);
  };

  const handleStartChat = () => {
    setInviteMessage(`Hey ${candidateName}, would love to connect!`);
    setShowInviteModal(true);
  };

  const handleInviteConfirm = () => {
    setShowInviteModal(false);
    navigate(`/u/${discovery.candidateId}/chat`, { state: { prefill: inviteMessage } });
  };

  return (
    <>
    {showInviteModal && (
      <InviteMessageModal
        userName={candidateName}
        message={inviteMessage}
        onMessageChange={setInviteMessage}
        onConfirm={handleInviteConfirm}
        onCancel={() => setShowInviteModal(false)}
      />
    )}
    <div className="bg-white border border-gray-200 rounded-lg p-4 my-2">
      <div className="flex items-start gap-3">
        <button onClick={handleViewProfile} className="flex-shrink-0">
          <UserAvatar
            id={discovery.candidateId}
            name={discovery.candidateName || 'User'}
            avatar={discovery.candidateAvatar || null}
            size={40}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              onClick={handleViewProfile}
              className="font-bold text-sm text-gray-900  hover:text-gray-700 truncate"
            >
              {discovery.candidateName || 'Potential Connection'}
            </button>
            <span className="text-xs text-gray-500  flex-shrink-0">
              {Math.round(discovery.score)}% match
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {discovery.sourceDescription}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleViewProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors "
            >
              <User className="w-3.5 h-3.5" />
              View Profile
            </button>
            <button
              onClick={handleStartChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#041729] hover:bg-[#0a2d4a] rounded transition-colors "
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Start Conversation
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
