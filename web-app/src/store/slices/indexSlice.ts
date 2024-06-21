import {
  addItem,
  fetchIndex,
  fetchIndexItems,
  toggleUserIndex,
} from "@/store/api";

import { createSlice } from "@reduxjs/toolkit";

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
