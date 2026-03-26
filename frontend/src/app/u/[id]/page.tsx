import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, MessageCircle } from "lucide-react";
import GhostBadge from "@/components/GhostBadge";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useIndexes } from "@/contexts/APIContext";
import UserAvatar from "@/components/UserAvatar";
import { User } from "@/lib/types";
import { Link } from "react-router";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import InviteMessageModal from "@/components/InviteMessageModal";
import NegotiationHistory from "@/components/NegotiationHistory";

export default function UserProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const usersService = useUsers();
  const indexesService = useIndexes();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [sharedNetworks, setSharedNetworks] = useState<Array<{ id: string; title: string; _count: { members: number } }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);

  const isOtherUser = !!user?.id && user.id !== id;

  const handleTriggerNegotiation = useCallback(async () => {
    if (!id || !isOtherUser) return;
    const targetId = id;
    setIsTriggering(true);
    try {
      return await usersService.triggerDiscoveryNegotiation(targetId);
    } catch (err) {
      console.error('Failed to trigger negotiation:', err);
    } finally {
      setIsTriggering(false);
    }
  }, [id, isOtherUser, usersService]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/');
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || authLoading) return;
      try {
        setIsLoading(true);
        setError(null);
        const profile = await usersService.getUserProfile(id);
        setProfileData(profile);

        // Fetch shared networks separately so a failure doesn't break the profile
        if (user?.id && user.id !== id) {
          try {
            const networks = await indexesService.getSharedIndexes(id!);
            setSharedNetworks(networks);
          } catch (err) {
            console.error('Failed to fetch shared networks:', err);
            setSharedNetworks([]);
          }
        } else {
          setSharedNetworks([]);
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        setError('User not found');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id, user?.id, isAuthenticated, authLoading, usersService, indexesService]);

  if (authLoading || isLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  if (error) {
    return (
      <ClientLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-bold text-red-600 mb-2 font-ibm-plex-mono">Error</h2>
          <p className="text-gray-600 mb-4 font-ibm-plex-mono">{error}</p>
          <button onClick={() => navigate(-1)} className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a] font-ibm-plex-mono">
            Go Back
          </button>
        </div>
      </ClientLayout>
    );
  }

  if (!profileData) return null;

  return (
    <>
    {showInviteModal && (
      <InviteMessageModal
        userName={profileData.name}
        message={inviteMessage}
        onMessageChange={setInviteMessage}
        onConfirm={() => {
          setShowInviteModal(false);
          navigate(`/u/${id}/chat`, { state: { prefill: inviteMessage } });
        }}
        onCancel={() => setShowInviteModal(false)}
      />
    )}
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-20">
        <ContentContainer className="space-y-8">

          <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-black transition-colors text-xl">
            ←
          </button>

          {/* Avatar, Name, Location, Socials */}
          <div className="flex items-center gap-4">
            <UserAvatar id={profileData.id} name={profileData.name} avatar={profileData.avatar} size={80} blur={profileData.isGhost} />
            <div className="flex-1">
              <h1 className="font-ibm-plex-mono text-2xl font-bold text-black mb-1 flex items-center gap-2">
                {profileData.name}
                {profileData.isGhost && <GhostBadge />}
              </h1>
              {profileData.location && (
                <p className="text-sm text-gray-500 mb-3">{profileData.location}</p>
              )}
              <div className="flex items-center gap-3">
                {profileData.socials?.x && (
                  <a href={`https://x.com/${profileData.socials.x.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </a>
                )}
                {profileData.socials?.linkedin && (
                  <a href={`https://linkedin.com/in/${profileData.socials.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  </a>
                )}
                {profileData.socials?.github && (
                  <a href={`https://github.com/${profileData.socials.github}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                  </a>
                )}
                {profileData.socials?.websites?.map((website, i) => (
                  <a key={i} href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-black transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </a>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                if (profileData.isGhost) {
                  setInviteMessage(`Hey ${profileData.name}, would love to connect!`);
                  setShowInviteModal(true);
                } else {
                  navigate(`/u/${id}/chat`);
                }
              }}
              className="flex items-center gap-2 bg-[#041729] text-white px-4 py-2 rounded-sm text-sm font-medium hover:bg-[#0a2d4a] transition-colors flex-shrink-0"
            >
              <MessageCircle className="w-4 h-4" />
              Message
            </button>
          </div>

          {/* Intro */}
          {profileData.intro && (
            <div>
              <h3 className="text-base font-bold text-gray-900 mb-3 font-ibm-plex-mono">Intro</h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {profileData.intro}
              </p>
            </div>
          )}

          {/* Shared Networks */}
          {sharedNetworks.length > 0 && (
            <div>
              <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-2">Shared Networks</h3>
              <div className="flex flex-wrap gap-2">
                {sharedNetworks.map((network) => (
                  <Link key={network.id} to={`/index/${network.id}`} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-full text-sm text-gray-700 hover:border-gray-400 transition-colors">
                    {network.title}
                    <span className="text-xs text-gray-400">{network._count.members}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Past Negotiations */}
          {id && (
            <div>
              <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-2">Negotiations</h3>
              <NegotiationHistory
                userId={id}
                onTriggerNegotiation={isOtherUser ? handleTriggerNegotiation : undefined}
                isTriggering={isTriggering}
              />
            </div>
          )}

          {/* You're the connector — only shown when viewing someone else's profile */}
          {false && user?.id !== id && (
            <div>
              <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-0.5">You&apos;re the connector</h3>
              <p className="text-xs text-gray-400 mb-3">Intros you could make with {profileData?.name.split(' ')[0]}</p>
              <div className="space-y-2">
                {[
                  {
                    id: 'match-1',
                    name: 'Riley Park',
                    userId: 'mock-riley',
                    avatar: null,
                    reason: `Both ${profileData?.name.split(' ')[0]} and Riley are deep in agent infrastructure from different angles — they'd have a lot to stress-test together.`,
                  },
                  {
                    id: 'match-2',
                    name: 'Mia Chen',
                    userId: 'mock-mia',
                    avatar: null,
                    reason: `Mia just relocated to the same city and is looking to plug into the local builder scene. ${profileData?.name.split(' ')[0]} would be a perfect first connection.`,
                  },
                ].map((match) => (
                  <div key={match.id} className="bg-[#F8F8F8] rounded-md p-4">
                    {/* Header: A <> B */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <UserAvatar id={profileData?.id ?? ''} name={profileData?.name ?? ''} avatar={profileData?.avatar ?? null} size={24} />
                            <span className="text-sm font-bold text-gray-900">{profileData?.name.split(' ')[0]}</span>
                          </div>
                          <span className="text-gray-400 text-xs">&lt;&gt;</span>
                          <div className="flex items-center gap-1.5">
                            <UserAvatar id={match.userId} name={match.name} avatar={match.avatar} size={24} />
                            <span className="text-sm font-bold text-gray-900">{match.name}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium leading-none hover:bg-[#0a2d4a] transition-colors">
                          Good match
                        </button>
                        <button className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium leading-none hover:bg-gray-200 transition-colors">
                          Pass
                        </button>
                      </div>
                    </div>
                    {/* Reason */}
                    <p className="text-[14px] text-[#3D3D3D] leading-relaxed">{match.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}


          {/* Affiliations */}
          {false && <div>
            <h3 className="text-base font-bold text-gray-900 font-ibm-plex-mono mb-3">Affiliations</h3>
            <div className="space-y-3">
              {[
                { label: 'Backed By', items: ['Frachtis', 'dlab', 'Blueyard', 'Mesh'] },
                { label: 'Worked In', items: ['Index Network', 'Gowit', 'Aposto'] },
                { label: 'Events', items: ['Devconnect Buenos Aires', 'Token2049', 'New York TechWeek'] },
              ].map((group) => (
                <div key={group.label} className="flex items-start gap-3">
                  <p className="text-xs text-gray-400 w-20 flex-shrink-0 pt-0.5">{group.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((item) => (
                      <span key={item} className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded px-2 py-0.5">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>}

        </ContentContainer>
      </div>
    </ClientLayout>
    </>
  );
}

export const Component = UserProfilePage;
