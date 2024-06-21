import { fetchConversation } from "@/store/api";
import { createSlice } from "@reduxjs/toolkit";

const conversationSlice = createSlice({
  name: "conversation",
  initialState: {
    data: null as any,
    loading: false,
    error: null,
  },
  reducers: {
    setConversation: (state, action) => {
      state.data = action.payload;
    },
    resetConversation: (state) => {
      state.data = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchConversation.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchConversation.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchConversation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      });
  },
});

export const { setConversation, resetConversation } = conversationSlice.actions;
export const selectConversation = (state: any) => state.conversation;
export default conversationSlice.reducer;
