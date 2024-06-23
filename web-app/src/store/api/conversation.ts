import ApiService from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { DiscoveryType } from "@/types";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchIndex } from ".";
import { fetchDID } from "./did";
import { addMessage, setConversation } from "../slices/conversationSlice";

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
    { content, role, conversationId, api }: SendMessagePayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const messageResp = await api.sendMessage(conversationId, {
        content,
        role,
      });
      dispatch(addMessage(messageResp));
      return messageResp;
    } catch (error: any) {
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
