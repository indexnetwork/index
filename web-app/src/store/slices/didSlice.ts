import {
  fetchDID,
  fetchDIDConversations,
  fetchDIDIndexes,
} from "@/store/api/did";
import { updateProfile, uploadAvatar } from "@/store/api/profile";
import { createSlice } from "@reduxjs/toolkit";
import { Indexes, Users } from "@/types/entity";

const indexesOwnerProfileUpdated = (indexes: Indexes[], profile: Users) => {
  return indexes.map((index) => {
    if (index.controllerDID.id === profile.id) {
      return {
        ...index,
        controllerDID: profile,
      };
    }
    return index;
  });
};

const didSlice = createSlice({
  name: "did",
  initialState: {
    data: null as any,
    indexes: [] as Indexes[],
    conversations: [] as any,
    loading: false,
    error: null,
    avatar: null as any,
  },
  reducers: {
    updateDidIndex: (state, action) => {
      const index = state.indexes.find(
        (idx) => idx.id === action.payload.indexID,
      );
      if (index) {
        Object.assign(index, action.payload.updatedIndex);
      }
    },
    setProfile: (state, action) => {
      state.data = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDID.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchDID.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchDID.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(fetchDIDIndexes.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchDIDIndexes.fulfilled, (state, action) => {
        state.loading = false;
        state.indexes = action.payload;
      })
      .addCase(fetchDIDIndexes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(fetchDIDConversations.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchDIDConversations.fulfilled, (state, action) => {
        state.loading = false;
        state.conversations = action.payload;
      })
      .addCase(fetchDIDConversations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(updateProfile.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
        console.log("64", state.indexes, action.payload);
        state.indexes = indexesOwnerProfileUpdated(
          state.indexes,
          action.payload,
        );
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(uploadAvatar.pending, (state) => {
        state.loading = true;
      })
      .addCase(uploadAvatar.fulfilled, (state, action) => {
        state.loading = false;
        console.log("uploadAvatar", action.payload);
        state.avatar = action.payload;
      })
      .addCase(uploadAvatar.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      });
  },
});

export const selectDID = (state: any) => state.did;
export const selectIndexes = (state: any) => state.did.indexes;
export const selectAvatar = (state: any) => state.did.avatar;
export const selectProfileLoading = (state: any) => state.did.loading;

export const { updateDidIndex, setProfile } = didSlice.actions;

export default didSlice.reducer;
