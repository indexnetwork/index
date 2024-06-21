import ApiService, { GetItemQueryParams } from "@/services/api-service-new";
import { DiscoveryType } from "@/types";
import { filterValidUrls, isStreamID, removeDuplicates } from "@/utils/helper";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { setViewType } from "./appViewSlice";
import { fetchDID, updateDidIndex } from "./didSlice";
import { Indexes } from "@/types/entity";

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

export const fetchIndex = createAsyncThunk(
  "index/fetchIndex",
  async (
    { indexID, api }: FetchIndexPayload,
    { dispatch, rejectWithValue },
  ) => {
    try {
      const index = await api.getIndex(indexID, {});
      let discoveryType = "unknown";

      if (index) {
        discoveryType = DiscoveryType.INDEX;

        await dispatch(
          fetchDID({ didID: index.controllerDID.id, api }),
        ).unwrap();
        await dispatch(fetchIndexItems({ indexID: index.id, api })).unwrap();
      }

      dispatch(
        setViewType({
          type: "default",
          discoveryType,
        }),
      );

      return index;
    } catch (err: any) {
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

const indexSlice = createSlice({
  name: "index",
  initialState: {
    data: null as any,
    loading: false,
    items: {
      data: [] as any,
      cursor: null as any,
      progress: 0,
    },
    error: null,
    addItemLoading: false,
    addItemError: null,
    toggleLoading: false,
    toggleError: null,
  },
  reducers: {
    setAddItemLoading: (state, action) => {
      state.addItemLoading = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchIndex.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchIndex.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchIndex.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(fetchIndexItems.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchIndexItems.fulfilled, (state, action) => {
        state.loading = false;
        state.items.data = action.payload.items;
        state.items.cursor = action.payload.endCursor;
      })
      .addCase(fetchIndexItems.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(addItem.pending, (state) => {
        state.addItemLoading = true;
      })
      .addCase(addItem.fulfilled, (state, action) => {
        state.addItemLoading = false;
        state.items.data.push(action.payload);
      })
      .addCase(addItem.rejected, (state, action) => {
        state.addItemLoading = false;
        state.addItemError = action.payload as any;
      })
      .addCase(toggleUserIndex.pending, (state) => {
        state.toggleLoading = true;
      })
      .addCase(toggleUserIndex.fulfilled, (state, action) => {
        state.toggleLoading = false;
        const updatedIndex = {
          ...state.data,
          ...{
            did: {
              ...state.data.did,
              [action.payload.toggleType === "star" ? "starred" : "owned"]:
                action.payload[action.payload.toggleType],
            },
          },
        };
        state.data = updatedIndex;
      })
      .addCase(toggleUserIndex.rejected, (state, action) => {
        state.toggleLoading = false;
        state.toggleError = action.payload as any;
      });
  },
});

export const selectIndex = (state: any) => state.index;
export const { setAddItemLoading } = indexSlice.actions;
export default indexSlice.reducer;
