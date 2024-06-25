import ApiService from "@/services/api-service-new";
import { updateIndexControllerDID } from "@/store/slices/indexSlice"; // Ensure correct path
import { Users } from "@/types/entity";
import { createAsyncThunk } from "@reduxjs/toolkit";

type UpdateProfilePayload = {
  profile: Partial<Users>;
  api: ApiService;
  storeProfile?: boolean;
};

type UploadAvatarPayload = {
  file: File;
  api: ApiService;
};

export const updateProfile = createAsyncThunk(
  "profile/updateProfile",
  async (
    { profile, api, storeProfile = true }: UpdateProfilePayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const newProfile = await api.updateProfile(profile);
      dispatch(updateIndexControllerDID(newProfile));
      return { newProfile, storeProfile };
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
