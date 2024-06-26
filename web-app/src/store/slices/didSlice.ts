import {
  fetchDID,
  fetchDIDConversations,
  fetchDIDIndexes,
} from "@/store/api/did";
import { updateProfile, uploadAvatar } from "@/store/api/profile";
import { createSlice } from "@reduxjs/toolkit";
import { Indexes, Users } from "@/types/entity";
import { createIndex, toggleUserIndex } from "@/store/api/index";
import {
  createConversation,
  fetchConversation,
  deleteConversation,
} from "@/store/api/conversation";

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
    setProfile: (state, action) => {
      state.data = action.payload;
    },
    addConversation: (state, action) => {
      state.conversations = state.conversations
        ? [action.payload, ...state.conversations]
        : [action.payload];
    },
    removeConversation: (state, action) => {
      state.conversations = state.conversations
        ? state.conversations.filter((c: any) => c.id !== action.payload)
        : [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(toggleUserIndex.pending, (state) => {
        state.loading = true;
      })
      .addCase(toggleUserIndex.fulfilled, (state, action) => {
        state.loading = false;
        state.indexes = state.indexes.map((idx) =>
          idx.id === action.payload.id ? action.payload : idx,
        );
      })
      .addCase(toggleUserIndex.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
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
      .addCase(createIndex.pending, (state) => {
        state.loading = true;
      })
      .addCase(createIndex.fulfilled, (state, action) => {
        state.loading = false;
        state.indexes = state.indexes
          ? [action.payload, ...state.indexes]
          : [action.payload];
      })
      .addCase(createIndex.rejected, (state, action) => {
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
      .addCase(createConversation.pending, (state) => {
        state.loading = true;
      })
      .addCase(createConversation.fulfilled, (state, action) => {
        state.loading = false;
        state.conversations = state.conversations
          ? [action.payload, ...state.conversations]
          : [action.payload];
      })
      .addCase(createConversation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(fetchConversation.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchConversation.fulfilled, (state, action) => {
        state.loading = false;
        // state.data = action.payload;
      })
      .addCase(fetchConversation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(deleteConversation.pending, (state, action) => {
        state.loading = true;
      })
      .addCase(deleteConversation.fulfilled, (state, action) => {
        state.conversations = state.conversations
          ? state.conversations.filter((c: any) => c.id !== action.payload)
          : [];
        state.loading = false;
      })
      .addCase(deleteConversation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(updateProfile.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
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

export const { setProfile, addConversation, removeConversation } =
  didSlice.actions;

export default didSlice.reducer;
