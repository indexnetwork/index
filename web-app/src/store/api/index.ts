import ApiService, { GetItemQueryParams } from "@/services/api-service-new";
import { setViewType } from "@/store/slices/appViewSlice";
import { DiscoveryType } from "@/types";
import { isStreamID } from "@/utils/helper";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { fetchDID } from "./did";

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
  resetCursor?: boolean;
  params?: {
    limit?: number;
    cursor?: string;
    query?: string;
  };
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
          dispatch(fetchIndexItems({ indexID: index.id, api })).unwrap();
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
  async (
    { indexID, api, resetCursor = true, params }: FetchIndexItemsPayload,
    { getState, rejectWithValue },
  ) => {
    try {
      const { index } = getState() as any;
      const itemParams: GetItemQueryParams = {};

      if (!resetCursor && index.items.cursor) {
        itemParams.cursor = index.items.cursor;
      }

      if (params?.query) {
        itemParams.query = params.query;
      }

      const items = await api.getItems(indexID, {
        queryParams: itemParams,
      });

      return {
        items:
          resetCursor || itemParams.query
            ? items.items
            : [...(index.items.data || []), ...items.items],
        cursor: items.endCursor || index.items.cursor,
      };
    } catch (err: any) {
      console.log("33", err);
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
    { rejectWithValue, getState },
  ) => {
    try {
      if (toggleType === "star") {
        api.starIndex(indexID, value);
      } else if (toggleType === "own") {
        api.ownIndex(indexID, value);
      }

      const state: any = getState();
      let updatedIndex = state.index.data;

      updatedIndex = {
        ...updatedIndex,
        did: {
          ...updatedIndex.did,
          [toggleType === "star" ? "starred" : "owned"]: value,
        },
      };
      return updatedIndex;
    } catch (err: any) {
      return rejectWithValue(err.response.data);
    }
  },
);

export const updateIndexTitle = createAsyncThunk(
  "index/updateIndexTitle",
  async (
    { indexID, title, api }: UpdateIndexTitlePayload,
    { getState, rejectWithValue },
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

      return updatedIndex;
    } catch (error: any) {
      return rejectWithValue(error.response?.data || error.message);
    }
  },
);
