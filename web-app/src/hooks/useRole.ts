import { useMemo, useContext } from 'react';
import { AuthContext, AuthStatus } from 'components/site/context/AuthContext';
import { useApp } from './useApp';

export enum UserRole {
  VIEWER = "viewer",
  CREATOR = "creator",
  OWNER = "owner",
}

export const useRole = () => {
  const { status } = useContext(AuthContext);
  const { viewedIndex } = useApp();

  const role = useMemo(() => {
    if (status !== AuthStatus.CONNECTED) {
      return UserRole.VIEWER;
    }

    if (!viewedIndex) {
      return UserRole.VIEWER;
    }

    if (viewedIndex.roles?.isOwner) {
      return UserRole.OWNER;
    }

    if (viewedIndex.roles?.isCreator) {
      return UserRole.CREATOR;
    }

    return UserRole.VIEWER;
  }, [viewedIndex, status]);

  return {
    role,
    isOwner: role === UserRole.OWNER,
    isCreator: role === UserRole.OWNER || role === UserRole.CREATOR,
  }
};
