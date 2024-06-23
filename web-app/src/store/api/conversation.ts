import ApiService from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { DiscoveryType } from "@/types";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchIndex } from ".";
import { fetchDID } from "./did";
import {
  addMessage,
  setConversation,
  setMessageLoading,
  updateMessage,
  updateMessageByID,
} from "../slices/conversationSlice";

type FetchConversationPayload = {
  cID: string;
  api: ApiService;
};

type CreateConversationPayload = {
  sources: string[];
  summary: string;
  api: ApiService;
};

type SendMessagePayload = {
  content: string;
  role: string;
  conversationId: string;
  api: ApiService;
  prevID: string;
};

type UpdateMessagePayload = {
  conversationId: string;
  messageId: string;
  content: string;
  api: ApiService;
};

export const createConversation = createAsyncThunk(
  "conversation/createConversation",
  async (
    { sources, summary, api }: CreateConversationPayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const response = await api.createConversation({ sources, summary });
      console.log("91 setting conversation", response);
      dispatch(setConversation(response));
      return response;
    } catch (error: any) {
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const sendMessage = createAsyncThunk(
  "conversation/sendMessage",
  async (
    { content, role, conversationId, api, prevID }: SendMessagePayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const messageResp = await api.sendMessage(conversationId, {
        content,
        role,
      });

      console.log("111", messageResp);
      dispatch(updateMessageByID({ prevID, message: messageResp }));
      return messageResp;
    } catch (error: any) {
      console.log("115 error", error);
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const regenerateMessage = createAsyncThunk(
  "conversation/regenerateMessage",
  async (
    { conversationId, api }: { conversationId: string; api: ApiService },
    { getState, rejectWithValue },
  ) => {
    try {
      const { conversation } = getState() as any;
      console.log("21 conversationId", conversation, conversationId);
      const { messages } = conversation.data;
      const lastUserMessage = messages.findLast((m: any) => m.role === "user");
      const lastAssistantMessage = messages.findLast(
        (m: any) => m.name === "basic_assistant",
      );

      if (!lastUserMessage) {
        throw new Error("No user message found");
      }

      let messagesBeforeEdit: any[] = [];
      if (lastAssistantMessage) {
        messagesBeforeEdit = messages.slice(
          0,
          messages.indexOf(lastAssistantMessage),
        );
      }

      await api.updateMessage(
        conversationId,
        lastUserMessage.id,
        { role: lastUserMessage.role, content: lastUserMessage.content },
        true,
      );

      return { messagesBeforeEdit };
    } catch (error: any) {
      console.log("44 error", error);
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const fetchConversation = createAsyncThunk(
  "conversation/fetchConversation",
  async (
    { cID, api }: FetchConversationPayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const conversation = await api.getConversation(cID);
      const source = conversation.sources[0];

      if (source.includes("did:")) {
        dispatch(
          setViewType({
            type: "conversation",
            discoveryType: DiscoveryType.DID,
          }),
        );
        await dispatch(
          fetchDID({ didID: source, api, ignoreDiscoveryType: true }),
        ).unwrap();
      } else {
        // TODO: check if this is index really
        dispatch(
          setViewType({
            type: "conversation",
            discoveryType: DiscoveryType.INDEX,
          }),
        );
        await dispatch(fetchIndex({ indexID: source, api })).unwrap();
      }

      return conversation;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const updateMessageThunk = createAsyncThunk(
  "conversation/updateMessage",
  async (
    { conversationId, messageId, content, api }: UpdateMessagePayload,
    { getState, rejectWithValue },
  ) => {
    try {
      const { conversation } = getState() as any;
      const { messages } = conversation.data;
      const editingMessageIndex = messages.findIndex(
        (m: any) => m.id === messageId,
      );

      if (editingMessageIndex !== -1) {
        const messagesBeforeEdit = messages.slice(0, editingMessageIndex);

        const editMessage = await api.updateMessage(
          conversationId,
          messageId,
          { role: "user", content },
          true,
        );

        return { messagesBeforeEdit, editMessage };
      }

      throw new Error("Message not found");
    } catch (error: any) {
      return rejectWithValue(error.response?.data || error.message);
    }
  },
);

export const handleMessageThunk = createAsyncThunk(
  "conversation/handleMessage",
  (data: any, { dispatch, getState }) => {
    const payload = JSON.parse(data);
    console.log("Received message from server", payload);

    // // End of the stream handling
    // if (payload.channel === "end") {
    //   console.log("End of stream");
    //   dispatch(setMessageLoading(false));
    //   return;
    // }

    // // Update handling
    // if (payload.channel === "update") {
    //   const newMessage = {
    //     id: payload.data.messageId,
    //     role: payload.data.payload.role,
    //     content: payload.data.payload.content,
    //   };
    //   dispatch(addMessage(newMessage));
    //   dispatch(setMessageLoading(false));
    //   return;
    // }

    dispatch(setMessageLoading(true));
    const state: any = getState();
    const { conversation } = state;
    const { messages } = conversation.data;

    // Update existing message content if it matches the streaming message
    let streamingMessage = messages.find(
      (c: any) => c.id === payload.data.messageId,
    );
    console.log(
      "11 New message",
      messages,
      payload.data.messageId,
      streamingMessage,
    );

    if (!streamingMessage) {
      console.log("New message", streamingMessage);
      streamingMessage = {
        id: payload.data.messageId,
        content: payload.data.chunk,
        role: "assistant",
        name: payload.data.name,
      };
      dispatch(addMessage(streamingMessage));
    }
    // else if (payload.channel === "chunk") {
    //   console.log(`Chunk message `, payload.data);
    //   streamingMessage = {
    //     ...streamingMessage,
    //     content: streamingMessage.content + payload.data.chunk,
    //   };
    //   dispatch(updateMessage(streamingMessage));
    // }
  },
);
