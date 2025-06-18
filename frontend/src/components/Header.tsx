import { Button } from "@/components/ui/button";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { UserPlus, LogIn, Settings } from "lucide-react";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { User, APIResponse } from '@/lib/types';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';

export default function Header({ showNavigation = true }: { showNavigation?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { login, logout, authenticated } = usePrivy();
  const [isAlpha, setIsAlpha] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const api = useAuthenticatedAPI();

  useEffect(() => {
    // Check if alpha parameter is in searchParams
    const alphaParam = searchParams.get('alpha');
    if (alphaParam !== null) {
      // Store in localStorage
      localStorage.setItem('alpha', alphaParam);
      setIsAlpha(alphaParam === 'true');
    } else {
      // Get from localStorage
      const storedAlpha = localStorage.getItem('alpha');
      setIsAlpha(storedAlpha === 'true');
    }
  }, [searchParams]);

  // Fetch user data when authenticated
  useEffect(() => {
    if (authenticated && isAlpha) {
      const fetchUser = async () => {
        try {
          const response = await api.get<APIResponse<User>>('/auth/me');
          if (response.user) {
            setUser(response.user);
          }
        } catch (error) {
          console.error('Failed to fetch user:', error);
        }
      };
      fetchUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAlpha]);
  return (
    <div>
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center">
          <Link href={false ? "/indexes" : "/"}>
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
            <div className="flex items-center space-x-3">
              <Button 
                variant="outline" 
                className="flex items-center px-3 py-5"
                onClick={() => setProfileModalOpen(true)}
              >
                <Settings className="h-5 w-5" />
                <span className="hidden sm:inline mx-2">Profile</span>
              </Button>
              <Button 
                variant="outline" 
                className="flex items-center px-3 py-5"
                onClick={logout}
              >
                <LogIn className="h-5 w-5" />
                <span className="hidden sm:inline mx-2">Logout</span>
              </Button>
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
          {/* Indexes Menu Item */}
          <Link href="/indexes" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <Image 
                  src="/icon-folder.svg" 
                  width={48} 
                  height={48}
                  className="object-contain p-1"
                  alt="Indexes icon"
                  style={{filter: pathname?.startsWith("/indexes") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname?.startsWith("/indexes") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Indexes
              </span>
            </div>
          </Link>
          
          {/* Intents Menu Item */}
          <Link href="/intents" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <Image 
                  src="/icon-intent.svg" 
                  width={44} 
                  height={44}
                  className="object-contain p-1"
                  alt="Intents icon"
                  style={{filter: pathname?.startsWith("/intents") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname?.startsWith("/intents")  ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Intents
              </span>
            </div>
          </Link>

          {/* Stake Menu Item */}
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
          </Link>

          {/* Integrate Menu Item */}
          <Link href="/integrate" className="cursor-pointer">
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
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke={pathname?.startsWith("/integrate") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2v6h6" stroke={pathname?.startsWith("/integrate") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 13H8" stroke={pathname?.startsWith("/integrate") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 17H8" stroke={pathname?.startsWith("/integrate") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10 9H8" stroke={pathname?.startsWith("/integrate") ? "#f59e0b" : "#6b7280"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname?.startsWith("/integrate") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Integrate
              </span>
            </div>
          </Link>
        </div>
      </div>
      }

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={profileModalOpen}
        onOpenChange={setProfileModalOpen}
        user={user}
        onUserUpdate={setUser}
      />
    </div>
  );
} 