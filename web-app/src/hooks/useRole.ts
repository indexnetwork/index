import { useMemo } from "react";
import { AuthStatus, useAuth } from "@/context/AuthContext";
import { useAppSelector } from "@/store/store";
import { selectIndex } from "@/store/slices/indexSlice";

export enum UserRole {
  VIEWER = "viewer",
  CREATOR = "creator",
  OWNER = "owner",
}

export const useRole = () => {
  const { status } = useAuth();
  const { data: viewedIndex } = useAppSelector(selectIndex);

  const role = useMemo(() => {
    if (status === AuthStatus.IDLE || status === AuthStatus.LOADING) {
      return UserRole.VIEWER;
    }

    if (!viewedIndex) {
      return UserRole.VIEWER;
    }

    if (viewedIndex.roles?.owner) {
      return UserRole.OWNER;
    }

    if (viewedIndex.roles?.creator) {
      return UserRole.CREATOR;
    }

    return UserRole.VIEWER;
  }, [viewedIndex, status]);

  return {
    role,
    isOwner: role === UserRole.OWNER,
    isCreator: role === UserRole.OWNER || role === UserRole.CREATOR,
  };
};
