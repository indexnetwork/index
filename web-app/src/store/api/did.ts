import ApiService from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { DiscoveryType } from "@/types";
import { Users } from "@/types/entity";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { resetConversation } from "@/store/slices/conversationSlice";
import {
  resetIndex,
  updateIndexControllerDID,
} from "@/store/slices/indexSlice";

type UpdateProfilePayload = {
  profile: Partial<Users>;
  api: ApiService;
};

type UploadAvatarPayload = {
  file: File;
  api: ApiService;
};

type FetchDIDPayload = {
  didID: string;
  api: ApiService;
  ignoreDiscoveryType?: boolean;
};

type FetchDIDIndexesPayload = {
  didID: string;
  api: ApiService;
};

type FetchDIDConversationsPayload = {
  didID: string;
  api: ApiService;
};

export const fetchDID = createAsyncThunk(
  "did/fetchDid",
  async (
    { didID, api, ignoreDiscoveryType }: FetchDIDPayload,
    { dispatch, rejectWithValue, getState },
  ) => {
    try {
      const { did: prevDID } = getState() as any;
      const did: any = await api.getProfile(didID);

      if (did) {
        if (!ignoreDiscoveryType) {
          dispatch(
            setViewType({
              type: "default",
              discoveryType: DiscoveryType.DID,
            }),
          );
        }
        dispatch(resetIndex());
        dispatch(resetConversation());
        if (!prevDID.data || prevDID.data.id !== didID) {
          await dispatch(fetchDIDIndexes({ didID, api })).unwrap();
          try {
            await dispatch(fetchDIDConversations({ didID, api })).unwrap();
          } catch (error: any) {
            // console.error("Error fetching conversations:", error);
          }
        }
      }

      return did;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const fetchDIDIndexes = createAsyncThunk(
  "did/fetchDIDIndexes",
  async ({ didID, api }: FetchDIDIndexesPayload, { rejectWithValue }) => {
    try {
      const indexes = await api.getAllIndexes(didID);
      return indexes;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const fetchDIDConversations = createAsyncThunk(
  "did/fetchDIDConversations",
  async ({ api }: FetchDIDConversationsPayload, { rejectWithValue }) => {
    try {
      const conversations = await api.listConversations();
      return conversations;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const updateProfile = createAsyncThunk(
  "profile/updateProfile",
  async (
    { profile, api }: UpdateProfilePayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const newProfile = await api.updateProfile(profile);
      dispatch(updateIndexControllerDID(newProfile));
      return newProfile;
    } catch (error: any) {
      console.error("Error updating profile:", error);
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const uploadAvatar = createAsyncThunk(
  "profile/uploadAvatar",
  async ({ file, api }: UploadAvatarPayload, { rejectWithValue }) => {
    try {
      const res = await api.uploadAvatar(file);
      return res?.cid;
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      return rejectWithValue(error.response.data || error.message);
    }
  },
);
