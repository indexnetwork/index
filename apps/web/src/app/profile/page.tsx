import { useEffect } from "react";
import { Navigate } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";

/**
 * /profile: your own profile. It is the public page everyone else sees at
 * `/:username`, with the owner's extras (agent analytics, share, edit).
 */
export default function MyProfilePage() {
  const { user, isAuthenticated, isLoading, openLoginModal } = useAuthContext();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) openLoginModal(window.location.href);
  }, [isLoading, isAuthenticated, openLoginModal]);

  if (isLoading || !user?.id) return null;
  return <Navigate to={user.username ? `/${user.username}` : `/u/${user.id}`} replace />;
}

export const Component = MyProfilePage;
