import { Button } from "@/components/ui/button";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { UserPlus, LogIn, Settings } from "lucide-react";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { User, APIResponse } from '@/lib/types';
import { getAvatarUrl } from '@/lib/file-utils';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';

interface HeaderProps {
  showNavigation?: boolean;
}

export default function Header({ showNavigation = true }: HeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { login, logout, authenticated, ready } = usePrivy();
  const [isAlpha, setIsAlpha] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userLoading, setUserLoading] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const api = useAuthenticatedAPI();
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
  }, [alphaParam]);

  // Memoize user fetch function to prevent recreation on every render
  const fetchUser = useCallback(async () => {
    if (!authenticated || userLoading) return;
    
    setUserLoading(true);
    try {
      const response = await api.get<APIResponse<User>>('/auth/me');
      if (response.user) {
        setUser(response.user);
        
        // Check if user needs onboarding (empty intro)
        if (!response.user.intro || response.user.intro.trim() === '') {
          setIsOnboarding(true);
          setProfileModalOpen(true);
        } else {
          try {
            localStorage.setItem('onboarding_completed', Date.now().toString());
          } catch (error) {
            console.warn('Failed to store onboarding completion:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
    } finally {
      setUserLoading(false);
    }
  }, [authenticated, api, userLoading]);

  // Fetch user data when authenticated and ready
  useEffect(() => {
    if (ready && authenticated && !user && !userLoading) {
      fetchUser();
    }
  }, [ready, authenticated, user, userLoading, fetchUser]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
      href: "/indexes",
      icon: (color: string) => (
        <Image 
          src="/icon-folder.svg" 
          width={48} 
          height={48}
          className="object-contain p-1"
          alt="Indexes icon"
          style={{filter: color === "#f59e0b" ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
        />
      ),
      label: "Indexes"
    },
    {
      href: "/intents",
      icon: (color: string) => (
        <Image 
          src="/icon-intent.svg" 
          width={44} 
          height={44}
          className="object-contain p-1"
          alt="Intents icon"
          style={{filter: color === "#f59e0b" ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
        />
      ),
      label: "Intents"
    },
    {
      href: "/integrate",
      icon: (color: string) => (
        <svg 
          width={44}
          height={44}
          viewBox="0 0 24 24" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="object-contain p-1"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14 2v6h6" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M16 13H8" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M16 17H8" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M10 9H8" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      label: "Integrate"
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
                alt="Index Protocol" 
                width={200} 
                height={48}
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
        <div className="flex items-center">
          <Link href={authenticated ? "/indexes" : "/"}>
            <div className="relative mr-2 cursor-pointer">
              <Image 
                src="/logo-black.svg" 
                alt="Index Protocol" 
                width={200} 
                height={48}
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
                        setProfileModalOpen(true);
                        setDropdownOpen(false);
                      }}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Profile Settings
                    </button>
                    <button
                      className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center transition-colors"
                      onClick={() => {
                        logout();
                        setDropdownOpen(false);
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

          { false && 
          <Link href="/stake" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <svg 
                  width={44}
                  height={44}
                  viewBox="0 0 24 24" 
                  fill="none" 
                  xmlns="http://www.w3.org/2000/svg"
                  className="object-contain p-1"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" stroke={pathname?.startsWith("/stake") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 17l10 5 10-5" stroke={pathname?.startsWith("/stake") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 12l10 5 10-5" stroke={pathname?.startsWith("/stake") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname?.startsWith("/stake") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Brokers
              </span>
            </div>
          </Link>}
        </div>
      </div>
      }

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={profileModalOpen}
        onOpenChange={(open) => {
          setProfileModalOpen(open);
          if (!open && isOnboarding) {
            setIsOnboarding(false);
            // Store onboarding completion in localStorage for other components
            try {
              localStorage.setItem('onboarding_completed', Date.now().toString());
            } catch (error) {
              console.warn('Failed to store onboarding completion:', error);
            }
          }
        }}
        user={user}
        onUserUpdate={setUser}
        isOnboarding={isOnboarding}
      />
    </div>
  );
} 