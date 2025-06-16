import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Copy, Globe, Lock, Trash2, Search, Plus, X, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Input } from "../ui/input";
import { useIndexes } from "@/contexts/APIContext";
import { Index } from "@/lib/types";

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'Editor' | 'Viewer';
  avatar?: string;
}

interface ShareSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
  onIndexUpdate?: (updatedIndex: Index) => void;
}

interface DialogProps {
  className?: string;
  children: React.ReactNode;
  [key: string]: unknown;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogProps) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
    <Dialog.Content
      className={`fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 sm:rounded-lg ${className}`}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
        <span className="sr-only">Close</span>
      </Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogProps) => (
  <div className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`} {...props}>
    {children}
  </div>
);

const DialogTitle = ({ className, children, ...props }: DialogProps) => (
  <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
    {children}
  </Dialog.Title>
);

export default function ShareSettingsModal({ open, onOpenChange, index, onIndexUpdate }: ShareSettingsModalProps) {
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
  const [isUpdatingDiscovery, setIsUpdatingDiscovery] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [members, setMembers] = useState<Member[]>([
    { id: '1', name: 'Alice Smith', email: 'alice@example.com', role: 'Editor' },
    { id: '2', name: 'Bob Johnson', email: 'bob@example.com', role: 'Viewer' },
  ]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const indexesService = useIndexes();

  // Mock suggested users - in real app, this would come from an API
  const suggestedUsers: Member[] = [
    { id: '3', name: 'Charlie Brown', email: 'charlie@example.com', role: 'Viewer' },
    { id: '4', name: 'Diana Prince', email: 'diana@example.com', role: 'Viewer' },
    { id: '5', name: 'Edward Norton', email: 'edward@example.com', role: 'Viewer' },
    { id: '6', name: 'Fiona Green', email: 'fiona@example.com', role: 'Viewer' },
  ];

  // Filter suggestions based on search query and exclude existing members
  const filteredSuggestions = suggestedUsers.filter(user =>
    !members.find(member => member.id === user.id) &&
    (user.name.toLowerCase().includes(memberSearchQuery.toLowerCase()) ||
     user.email.toLowerCase().includes(memberSearchQuery.toLowerCase()))
  );

  // Handle clicking outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleVisibility = async (isPublic: boolean) => {
    try {
      setIsUpdatingVisibility(true);
      await indexesService.updateIndex(index.id, { isPublic });
      // Refetch the complete index data to ensure we have all files
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (error) {
      console.error('Error updating index visibility:', error);
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  const handleToggleDiscovery = async (isDiscoverable: boolean) => {
    try {
      setIsUpdatingDiscovery(true);
      await indexesService.updateIndex(index.id, { isDiscoverable });
      // Refetch the complete index data to ensure we have all files
      const updatedIndex = await indexesService.getIndex(index.id);
      onIndexUpdate?.(updatedIndex);
    } catch (error) {
      console.error('Error updating index discovery settings:', error);
    } finally {
      setIsUpdatingDiscovery(false);
    }
  };

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleAddMember = (user: Member) => {
    setMembers(prev => [...prev, user]);
    setMemberSearchQuery('');
    setShowSuggestions(false);
  };

  const handleRemoveMember = (memberId: string) => {
    setMembers(prev => prev.filter(member => member.id !== memberId));
  };

  const handleMemberRoleChange = (memberId: string, newRole: 'Editor' | 'Viewer') => {
    setMembers(prev => prev.map(member => 
      member.id === memberId ? { ...member, role: newRole } : member
    ));
  };

  const handleSearchInputChange = (value: string) => {
    setMemberSearchQuery(value);
    setShowSuggestions(value.length > 0);
  };

  // Generate a share link when public
  const shareUrl = `http://localhost:3000/share/${index.id}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-black font-mono">
            {index.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-8 mt-6">
          <div>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-md font-medium font-ibm-plex-mono text-black">Discovery</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    {index.isDiscoverable ? (
                      <>
                        <Search className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Allow relevant users to use this index for intent matching
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {isUpdatingDiscovery && (
                  <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                )}
                <button
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    index.isDiscoverable ? 'bg-blue-600' : 'bg-gray-300'
                  } ${isUpdatingDiscovery ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => !isUpdatingDiscovery && handleToggleDiscovery(!index.isDiscoverable)}
                  disabled={isUpdatingDiscovery}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      index.isDiscoverable ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mt-2 mb-2">
                  <h3 className="text-md font-medium font-ibm-plex-mono text-black">Public Link</h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    {index.isPublic ? (
                      <>
                        <Globe className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" />
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  {index.isPublic 
                    ? "Anyone can view this index" 
                    : "Only you and invited members can view"
                  }
                </p>
              </div>
              <div className="flex items-center gap-3 ml-4">
                {isUpdatingVisibility && (
                  <div className="h-4 w-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                )}
                <button
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    index.isPublic ? 'bg-blue-600' : 'bg-gray-300'
                  } ${isUpdatingVisibility ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={() => !isUpdatingVisibility && handleToggleVisibility(!index.isPublic)}
                  disabled={isUpdatingVisibility}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      index.isPublic ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {index.isPublic && (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={shareUrl}
                    className="px-4 py-3"
                    placeholder="Share link will appear here..."
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-4"
                    onClick={() => handleCopyLink(shareUrl)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-3">Members</h3>
            
            {/* Member picker input */}
            <div className="relative mb-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Plus className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Search people by name or email..."
                    value={memberSearchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    onFocus={() => memberSearchQuery && setShowSuggestions(true)}
                    className="pl-10 pr-4 py-3"
                  />
                </div>
              </div>
              
              {/* Suggestions dropdown */}
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                >
                  {filteredSuggestions.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleAddMember(user)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-left"
                    >
                      <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-sm">
                        {user.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                      <Check className="h-4 w-4 text-green-600" />
                    </button>
                  ))}
                </div>
              )}
              
              {/* No results message */}
              {showSuggestions && memberSearchQuery && filteredSuggestions.length === 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4"
                >
                  <p className="text-sm text-gray-500 text-center">No users found matching "{memberSearchQuery}"</p>
                </div>
              )}
            </div>
            
            {/* Members list */}
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-sm">
                      {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div>
                      <p className="text-md text-black font-medium">{member.name}</p>
                      <p className="text-sm text-gray-600">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Role selector */}
                    <select
                      value={member.role}
                      onChange={(e) => handleMemberRoleChange(member.id, e.target.value as 'Editor' | 'Viewer')}
                      className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Viewer">Viewer</option>
                      <option value="Editor">Editor</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleRemoveMember(member.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
} 