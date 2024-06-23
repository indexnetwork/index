import {
  createConversation,
  fetchConversation,
  regenerateMessage,
  sendMessage,
  updateMessageThunk,
} from "@/store/api/conversation";
import { createSlice } from "@reduxjs/toolkit";

const handleIncomingMessageAction = (state, action) => {
  const payload = action.payload;
  const { messages } = state.data;

  if (payload.channel === "end") {
    state.isLoading = false;
    return;
  }
  console.log("34", state.data.messages, payload);
  const messageId = payload.data.messageId;
  let streamingMessage = messages.find((msg) => msg.id === messageId);

  if (payload.channel === "update") {
    const newMessage = {
      id: messageId,
      role: payload.data.payload.role,
      content: payload.data.payload.content,
    };
    state.data?.messages.push(newMessage);
    state.isLoading = false;
    return;
  }

  if (!streamingMessage) {
    streamingMessage = {
      id: messageId,
      role: "assistant",
      content: payload.data.chunk,
      name: payload.data.name,
    };
    state.data?.messages.push(streamingMessage);
  } else if (payload.channel === "chunk") {
    streamingMessage.content += payload.data.chunk;
  }
};

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
    handleIncomingMessage: handleIncomingMessageAction,
    addMessage(state, action) {
      console.log("89", action.payload, state.data?.messages);

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
  handleIncomingMessage,
} = conversationSlice.actions;
export const selectConversation = (state: any) => state.conversation;
export default conversationSlice.reducer;
