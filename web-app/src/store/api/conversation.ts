import ApiService from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { DiscoveryType } from "@/types";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchDID } from "./did";
import { fetchIndex } from ".";

import {
  setConversation,
  updateMessageByID,
} from "../slices/conversationSlice";
import { addConversation } from "../slices/didSlice";

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
      dispatch(addConversation(response));
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
    { content, role, conversationId, api, prevID, message }: SendMessagePayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const messageResp = await api.sendMessage(conversationId, {
        content,
        role,
      });
      dispatch(updateMessageByID({ message: messageResp, prevID }));
      return { message: messageResp, prevID };
    } catch (error: any) {
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const regenerateMessage = createAsyncThunk(
  "conversation/regenerateMessage",
  async (
    {
      conversationId,
      message,
      index,
      api,
    }: {
      conversationId: string;
      message: any;
      index: number;
      api: ApiService;
    },
    { getState, rejectWithValue },
  ) => {
    try {
      const { conversation } = getState() as any;
      const { messages } = conversation.data;
      const lastUserMessage = messages.findLast((m: any) => m.role === "user");
      const messageToRegenerate = messages.findLast(
        (m: any) => m.id === message.id,
      );

      if (!lastUserMessage) {
        throw new Error("No user message found");
      }

      let messagesBeforeGenerate: any[] = [];
      if (messageToRegenerate) {
        messagesBeforeGenerate = messages.slice(0, index);
      }

      const messageResp = await api.updateMessage(
        conversationId,
        lastUserMessage.id,
        { role: lastUserMessage.role, content: lastUserMessage.content },
        true,
      );

      return { messagesBeforeGenerate };
    } catch (error: any) {
      return rejectWithValue(error.response.data || error.message);
    }
  },
);

export const fetchConversation = createAsyncThunk(
  "conversation/fetchConversation",
  async (
    { cID, api }: FetchConversationPayload,
    { dispatch, rejectWithValue, getState },
  ) => {
    try {
      const conversation = await api.getConversation(cID);
      const source = conversation.sources[0];
      const state = getState() as any;

      if (source.includes("did:")) {
        dispatch(
          setViewType({
            type: "conversation",
            discoveryType: DiscoveryType.DID,
          }),
        );
        if (!state.did?.data?.id || source !== state.did?.data?.id) {
          await dispatch(fetchDID({ didID: source, api })).unwrap();
        }
      } else {
        // TODO: check if this is index really
        dispatch(
          setViewType({
            type: "conversation",
            discoveryType: DiscoveryType.INDEX,
          }),
        );
        if (!state.index?.data?.id || source !== state.index?.data?.id) {
          await dispatch(fetchIndex({ indexID: source, api })).unwrap();
        }
      }

      return conversation;
    } catch (err: any) {
      console.log("25 fetchConversation error", err);
      return rejectWithValue(err.response.data);
    }
  },
);

export const updateMessageThunk = createAsyncThunk(
  "conversation/updateMessage",
  async (
    { conversationId, messageId, content, api }: UpdateMessagePayload,
    { dispatch, getState, rejectWithValue },
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
