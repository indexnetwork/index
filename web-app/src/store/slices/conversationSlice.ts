import ApiService from "@/services/api-service-new";
import { DiscoveryType } from "@/types";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { setViewType } from "./appViewSlice";
import { fetchDID } from "./didSlice";
import { fetchIndex } from "./indexSlice";

type FetchConversationPayload = {
  cID: string;
  api: ApiService;
};

export const fetchConversation = createAsyncThunk(
  "conversation/fetchConversation",
  async (
    { cID, api }: FetchConversationPayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const conversation = await api.getConversation(cID);
      const source = conversation.sources[0];
      let discoveryType = "unknown";

      if (source.includes("did:")) {
        discoveryType = DiscoveryType.DID;
        await dispatch(fetchDID({ didID: source, api })).unwrap();
      } else {
        // TODO: check if this is index really
        discoveryType = DiscoveryType.INDEX;
        await dispatch(fetchIndex({ indexID: source, api })).unwrap();
      }

      dispatch(
        setViewType({
          type: "conversation",
          discoveryType,
        }),
      );

      return conversation;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

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

export const { setConversation } = conversationSlice.actions;
export const selectConversation = (state: any) => state.conversation;
export default conversationSlice.reducer;
