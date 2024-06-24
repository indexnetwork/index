import {
  createConversation,
  fetchConversation,
  regenerateMessage,
  sendMessage,
  updateMessageThunk,
} from "@/store/api/conversation";
import { createSlice } from "@reduxjs/toolkit";

const conversationSlice = createSlice({
  name: "conversation",
  initialState: {
    data: null as any,
    loading: false,
    error: null as any,
    regenerationLoading: false,
    messageLoading: false,
  },
  reducers: {
    setConversation(state, action) {
      state.data = action.payload;
    },
    resetConversation(state) {
      state.data = null;
    },
    setMessages(state, action) {
      state.data.messages = action.payload;
    },
    setMessageLoading: (state, action) => {
      state.messageLoading = action.payload;
    },
    addMessage(state, action) {
      if (state.data?.messages) {
        state.data.messages.push(action.payload);
      } else {
        state.data = {
          ...state.data,
          messages: [action.payload],
        };
      }
    },
    updateMessage(state, action) {
      const index = state.data.messages.findIndex(
        (msg: any) => msg.id === action.payload.id,
      );
      if (index !== -1) {
        console.log("101", state.data.messages[index], action.payload);
        state.data.messages[index] = action.payload;
      }
    },
    updateMessageByID(state, action) {
      if (!state.data?.messages) return;

      const index = state.data.messages.findIndex(
        (msg: any) => msg.id === action.payload.prevID,
      );
      if (index !== -1) {
        state.data.messages[index] = action.payload.message;
      }
    },
    deleteMessage(state, action) {
      state.data.messages = state.data.messages.filter(
        (msg: any) => msg.id !== action.payload,
      );
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
      })
      .addCase(regenerateMessage.pending, (state) => {
        state.regenerationLoading = true;
      })
      .addCase(regenerateMessage.fulfilled, (state, action) => {
        state.regenerationLoading = false;
        if (action.payload.messagesBeforeEdit) {
          state.data.messages = action.payload.messagesBeforeEdit;
        }
      })
      .addCase(regenerateMessage.rejected, (state, action) => {
        state.regenerationLoading = false;
        state.error = action.payload;
      })
      .addCase(createConversation.pending, (state) => {
        state.loading = true;
      })
      .addCase(createConversation.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(createConversation.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(sendMessage.pending, (state) => {
        state.loading = true;
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        state.loading = false;
        if (state.data.messages) {
          state.data.messages.push(action.payload);
        }
      })
      .addCase(sendMessage.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(updateMessageThunk.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateMessageThunk.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload.messagesBeforeEdit) {
          state.data.messages = action.payload.messagesBeforeEdit;
        }
        if (action.payload.editMessage) {
          state.data.messages.push(action.payload.editMessage);
        }
      })
      .addCase(updateMessageThunk.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  },
});

export const {
  setConversation,
  resetConversation,
  setMessages,
  addMessage,
  deleteMessage,
  updateMessage,
  setMessageLoading,
  updateMessageByID,
} = conversationSlice.actions;
export const selectConversation = (state: any) => state.conversation;
export default conversationSlice.reducer;
