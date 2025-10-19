import { Button } from "@/components/ui/button";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { UserPlus, LogIn, Settings, Blocks, Library, Plus } from "lucide-react";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { getAvatarUrl } from '@/lib/file-utils';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthContext } from '@/contexts/AuthContext';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';
import LibraryModal from '@/components/modals/LibraryModal';
import CreateIndexModal from '@/components/modals/CreateIndexModal';

interface HeaderProps {
  showNavigation?: boolean;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export default function Header({ showNavigation = true, onToggleSidebar, isSidebarOpen }: HeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login, logout, authenticated, ready } = usePrivy();
  const { user, refetchUser } = useAuthContext();
  const [isAlpha, setIsAlpha] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const indexesService = useIndexes();
  const { addIndex } = useIndexesState();
  const { success, error } = useNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Memoize alpha parameter check to prevent unnecessary re-runs
  const alphaParam = searchParams.get('alpha');
  
  useEffect(() => {
    // Check if alpha parameter is in searchParams
    if (alphaParam !== null) {
      // Store in localStorage
      localStorage.setItem('alpha', alphaParam);
      setIsAlpha(alphaParam === 'true');
    } else {
      // Get from localStorage only once on mount
      const storedAlpha = localStorage.getItem('alpha');
      setIsAlpha(storedAlpha === 'true');
    }
  }, [alphaParam, pathname]);

  // Handle onboarding check when user data is available
  useEffect(() => {
    if (user?.id && authenticated) {
      const onboardingCompleted = localStorage.getItem(`onboarding:${user.id}:isCompleted`);
      if (!onboardingCompleted) {
        router.push('/onboarding');
        return;
      }
    }
  }, [user?.id, authenticated, router]);

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      };
      
      const newIndex = await indexesService.createIndex(createRequest);
      addIndex(newIndex); // Update global state immediately
      setCreateIndexModalOpen(false);
      success('Index created successfully');
    } catch (err) {
      console.error('Error creating index:', err);
      error('Failed to create index');
    }
  }, [indexesService, addIndex, success, error]);


  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [dropdownOpen]);

  // Memoize the navigation logic to avoid recalculating on every render
  const navigationItems = useMemo(() => [
    {
      href: "/inbox",
      icon: (color: string) => (
        <svg 
          width={44}
          height={44}
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="object-contain p-1"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <polyline points="22,6 12,13 2,6" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      label: "Inbox"
    },
    {
      href: "/integrate",
      icon: (color: string) => (
        <Blocks 
          size={48}
          color={color}
          className="object-contain p-1"
        />
      ),
      label: "Build"
    }
  ], []);

  // Show loading state while Privy is initializing
  if (!ready) {
    return (
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center">
          <Link href="/">
            <div className="relative mr-2 cursor-pointer">
              <Image 
                src="/logo-black.svg" 
                alt="Index Network" 
                width={100} 
                height={36}
                className="object-contain"
              />
            </div>
          </Link>
        </div>
        <div className="animate-pulse bg-gray-200 h-10 w-20 rounded"></div>
      </header>
    );
  }

  return (
    <div>
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {/* Mobile-only sidebar toggle */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Toggle sidebar"
              aria-expanded={!!isSidebarOpen}
              aria-controls="app-sidebar"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-sm border border-[#9f9f9f] bg-white text-[#1f1f1f] hover:bg-gray-50 dark:border-[#555] dark:bg-[#1f1f1f] dark:text-gray-100 dark:hover:bg-[#2a2a2a]"
            >
              {/* simple icon without adding deps */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M3 12h12M3 18h18" />
              </svg>
            </button>
          )}
          <Link href={authenticated ? "/inbox" : "/"}>
            <div className="relative mr-2 cursor-pointer">
              <Image 
                src="/logo-black.svg" 
                alt="Index Network" 
                width={100} 
                height={36}
                className="object-contain"
              />
            </div>
          </Link>
        </div>
        {isAlpha ? (
          authenticated ? (
            <div className="relative" ref={dropdownRef}>
              <div 
                className="flex items-center px-4 py-2 border border-[#9f9f9f] border-1 rounded-sm cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <div className="w-8 h-8 rounded-full overflow-hidden mr-3">
                <Image
                      src={getAvatarUrl(user)}
                      alt={user?.name || 'User'}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                </div>
                <span className="text-gray-900 font-medium mr-2">
                  {user?.name || 'User'}
                </span>
                <svg 
                  className={`w-4 h-4 text-gray-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white border rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <button
                      className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center"
                      onClick={() => {
                        setDropdownOpen(false);
                        setProfileModalOpen(true);
                      }}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Profile Settings
                    </button>
                    <button
                      className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center"
                      onClick={() => {
                        setDropdownOpen(false);
                        setLibraryModalOpen(true);
                      }}
                    >
                      <Library className="h-4 w-4 mr-2" />
                      My Library
                    </button>
                    <button
                      className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center"
                      onClick={() => {
                        setDropdownOpen(false);
                        setCreateIndexModalOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Index
                    </button>
                    <button
                      className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center transition-colors"
                      onClick={() => {
                        setDropdownOpen(false);
                        logout();
                      }}
                    >
                      <LogIn className="h-4 w-4 mr-2" />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Button 
              variant="outline" 
              className="flex items-center px-3 py-5"
              onClick={login}
            >
              <LogIn className="h-5 w-5" />
              <span className="hidden sm:inline mx-2">Login</span>
            </Button>
          )
        ) : (
          <Button 
            variant="outline" 
            className="flex items-center px-3 py-5"
            onClick={() => window.open("https://forms.gle/nTNBKYC2gZZMnujh9", "_blank")}
          >
            <UserPlus className="h-5 w-5" />
            <span className="hidden sm:inline mx-2">Join the waitlist</span>
          </Button>
        )}
      </header>

      { showNavigation && 
      <div className="w-full flex justify-center my-6">
        <div className="flex gap-8">
          {navigationItems.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            const color = isActive ? "#f59e0b" : "#6b7280";
            
            return (
              <Link key={item.href} href={item.href} className="cursor-pointer">
                <div className="flex flex-col items-center cursor-pointer">
                  <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                    {item.icon(color)}
                  </div>
                  <span className={`text-sm font-ibm-plex-mono ${isActive ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}

         
        </div>
      </div>
      }

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={profileModalOpen}
        onOpenChange={setProfileModalOpen}
        user={user}
        onUserUpdate={async () => {
          // Refetch user data from AuthContext
          await refetchUser();
        }}
      />

      {/* Library Modal */}
      <LibraryModal
        open={libraryModalOpen}
        onOpenChange={setLibraryModalOpen}
      />

      {/* Create Index Modal */}
      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />
    </div>
  );
} 
