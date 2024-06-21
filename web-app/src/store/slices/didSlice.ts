import ApiService from "@/services/api-service-new";
import { DiscoveryType } from "@/types";
import { Indexes } from "@/types/entity";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { setViewType } from "./appViewSlice";

type FetchDIDPayload = {
  didID: string;
  api: ApiService;
};

type FetchDIDIndexesPayload = {
  didID: string;
  api: ApiService;
};

type FetchDIDConversationsPayload = {
  didID: string;
  api: ApiService;
};

export const fetchDID = createAsyncThunk(
  "did/fetchDid",
  async ({ didID, api }: FetchDIDPayload, { dispatch, rejectWithValue }) => {
    try {
      const did = await api.getProfile(didID);
      let discoveryType = "unknown";

      if (did) {
        discoveryType = DiscoveryType.DID;

        await dispatch(fetchDIDIndexes({ didID, api })).unwrap();
        await dispatch(fetchDIDConversations({ didID, api })).unwrap();
      }

      dispatch(
        setViewType({
          type: "default",
          discoveryType,
        }),
      );

      return did;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const fetchDIDIndexes = createAsyncThunk(
  "did/fetchDIDIndexes",
  async ({ didID, api }: FetchDIDIndexesPayload, { rejectWithValue }) => {
    try {
      const indexes = await api.getAllIndexes(didID);
      return indexes;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const fetchDIDConversations = createAsyncThunk(
  "did/fetchDIDConversations",
  async ({ api }: FetchDIDConversationsPayload, { rejectWithValue }) => {
    try {
      const conversations = await api.listConversations();
      console.log("conversations 87", conversations);
      return conversations;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

const didSlice = createSlice({
  name: "did",
  initialState: {
    data: null as any,
    indexes: [] as Indexes[],
    conversations: [] as any,
    loading: false,
    error: null,
  },
  reducers: {
    // add regular reducers here if necessary
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
      });
  },
});

export const selectDID = (state: any) => state.did;
export const selectIndexes = (state: any) => state.did.indexes;
export default didSlice.reducer;
