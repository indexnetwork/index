import ApiService, { GetItemQueryParams } from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { fetchDID, updateDidIndex } from "@/store/slices/didSlice";
import { DiscoveryType } from "@/types";
import { isStreamID } from "@/utils/helper";
import { createAsyncThunk } from "@reduxjs/toolkit";

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
