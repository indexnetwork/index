import ApiService, { GetItemQueryParams } from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { fetchDID, updateDidIndex } from "@/store/slices/didSlice";
import { DiscoveryType } from "@/types";
import { isStreamID } from "@/utils/helper";
import { createAsyncThunk } from "@reduxjs/toolkit";

type FetchIndexPayload = {
  indexID: string;
  api: ApiService;
};

type FetchIndexItemsPayload = {
  indexID: string;
  api: ApiService;
};

type AddItemPayload = {
  item: string;
  api: ApiService;
  indexID: string;
};

type ToggleUserIndexPayload = {
  indexID: string;
  api: ApiService;
  toggleType: "star" | "own";
  value: boolean;
};

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

export const fetchIndex = createAsyncThunk(
  "index/fetchIndex",
  async (
    { indexID, api }: FetchIndexPayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      dispatch(
        setViewType({
          type: "default",
          discoveryType: DiscoveryType.INDEX,
        }),
      );
      const index = await api.getIndex(indexID, {});
      if (index) {
        await dispatch(
          fetchDID({
            didID: index.controllerDID.id,
            api,
            ignoreDiscoveryType: true,
          }),
        ).unwrap();

        try {
          await dispatch(fetchIndexItems({ indexID: index.id, api })).unwrap();
        } catch (err) {
          console.error("Error fetching index items", err);
        }
      }

      return index;
    } catch (err: any) {
      console.log("err41", err);
      return rejectWithValue(err.response.data);
    }
  },
);

export const fetchIndexItems = createAsyncThunk(
  "index/fetchIndexItems",
  async ({ indexID, api }: FetchIndexItemsPayload, { rejectWithValue }) => {
    try {
      const itemParams: GetItemQueryParams = {};
      const items = await api.getItems(indexID, {
        queryParams: itemParams,
      });

      console.log("items", items);

      return items;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const addItem = createAsyncThunk(
  "index/addItem",
  async ({ item, api, indexID }: AddItemPayload, { rejectWithValue }) => {
    try {
      let itemId = item;
      if (!isStreamID(item)) {
        const createdLink = await api.crawlLink(item);
        itemId = createdLink.id;
      }

      const createdItem = await api.createItem(indexID, itemId);

      return createdItem;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const toggleUserIndex = createAsyncThunk(
  "index/toggleUserIndex",
  async (
    { indexID, api, toggleType, value }: ToggleUserIndexPayload,
    { dispatch, rejectWithValue, getState },
  ) => {
    try {
      if (toggleType === "star") {
        await api.starIndex(indexID, value);
      } else if (toggleType === "own") {
        await api.ownIndex(indexID, value);
      }

      const state: any = getState();
      const currentIndex = state.index.data;
      dispatch(
        updateDidIndex({
          indexID,
          updatedIndex: {
            ...currentIndex,
            did: {
              ...currentIndex.did,
              [toggleType === "star" ? "starred" : "owned"]: value,
            },
          },
        }),
      );
      return { toggleType, [toggleType]: value };
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);
