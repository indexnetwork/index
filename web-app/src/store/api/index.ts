import ApiService, { GetItemQueryParams } from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { addIndex, updateDidIndex } from "@/store/slices/didSlice";
import { DiscoveryType } from "@/types";
import { isStreamID } from "@/utils/helper";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchDID } from "./did";
import { resetConversation } from "../slices/conversationSlice";

type FetchIndexPayload = {
  indexID: string;
  api: ApiService;
};

type CreateIndexPayload = {
  title: string;
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

type UpdateIndexTitlePayload = {
  indexID: string;
  title: string;
  api: ApiService;
};

export const fetchIndex = createAsyncThunk(
  "index/fetchIndex",
  async (
    { indexID, api }: FetchIndexPayload,
    { dispatch, rejectWithValue, getState },
  ) => {
    try {
      dispatch(
        setViewType({
          type: "default",
          discoveryType: DiscoveryType.INDEX,
        }),
      );
      const state: any = getState();
      dispatch(resetConversation());

      if (state.index?.data?.id === indexID) {
        return state.index?.data;
      }

      const index = await api.getIndex(indexID, {});

      if (index) {
        if (!state.did?.data) {
          await dispatch(
            fetchDID({
              didID: index.controllerDID.id,
              api,
              ignoreDiscoveryType: true,
            }),
          ).unwrap();
        }

        try {
          await dispatch(fetchIndexItems({ indexID: index.id, api })).unwrap();
        } catch (err) {
          console.error("Error fetching index items", err);
        }
      }

      return index;
    } catch (err: any) {
      console.log("Error fetching index", err);
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

export const removeItem = createAsyncThunk(
  "index/removeItem",
  async ({ item, api, indexID }: AddItemPayload, { rejectWithValue }) => {
    try {
      if (!isStreamID(item)) {
        throw new Error("Invalid item ID provided.");
      }

      await api.deleteItem(indexID, item);

      return item;
    } catch (err: any) {
      return rejectWithValue(err.response?.data || err.message);
    }
  },
);

export const createIndex = createAsyncThunk(
  "index/createIndex",
  async ({ title, api }: CreateIndexPayload, { dispatch, rejectWithValue }) => {
    try {
      const index = await api!.createIndex(title);
      console.log(`charlie2`);
      dispatch(addIndex(index));
      return index;
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
      let controllerDID;
      if (toggleType === "star") {
        const resp = await api.starIndex(indexID, value);
        controllerDID = resp?.controllerDID?.id;
      } else if (toggleType === "own") {
        const resp = await api.ownIndex(indexID, value);
        controllerDID = resp?.controllerDID?.id;
      }

      const state: any = getState();
      const currentIndex = state.index.data;

      if (controllerDID === currentIndex.controllerDID.id) {
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
      }

      return { toggleType, [toggleType]: value };
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const updateIndexTitle = createAsyncThunk(
  "index/updateIndexTitle",
  async (
    { indexID, title, api }: UpdateIndexTitlePayload,
    { dispatch, getState, rejectWithValue },
  ) => {
    try {
      const result = await api.updateIndex(indexID, { title });
      const state: any = getState();
      const updatedIndexOrig = state.did.indexes.find(
        (i: any) => i.id === indexID,
      );

      if (!updatedIndexOrig) {
        throw new Error("Index to update not found");
      }

      const updatedIndex = {
        ...updatedIndexOrig,
        title: result.title,
        updatedAt: result.updatedAt,
      };

      dispatch(updateDidIndex({ indexID, updatedIndex }));

      return updatedIndex;
    } catch (error: any) {
      return rejectWithValue(error.response?.data || error.message);
    }
  },
);
