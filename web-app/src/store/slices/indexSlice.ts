import {
  addItem,
  fetchIndex,
  fetchIndexItems,
  removeItem,
  toggleUserIndex,
  updateIndexTitle,
} from "@/store/api/index";

import { updateProfile, fetchDID } from "@/store/api/did";
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
    titleLoading: false,
    titleError: null,
  },
  reducers: {
    setAddItemLoading: (state, action) => {
      state.addItemLoading = action.payload;
    },
    resetIndex: (state) => {
      state.data = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchIndex.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchIndex.fulfilled, (state, action) => {
        // state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchIndex.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })
      .addCase(fetchIndexItems.pending, (state) => {
        state.loading = true;
        state.items.data = null;
        state.items.cursor = null;
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

      .addCase(fetchDID.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchDID.fulfilled, (state, action) => {
        state.data = null;
      })
      .addCase(fetchDID.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      })

      .addCase(addItem.pending, (state) => {
        state.addItemLoading = true;
      })
      .addCase(addItem.fulfilled, (state, action) => {
        state.items.data.push(action.payload);
        state.addItemLoading = false;
      })
      .addCase(addItem.rejected, (state, action) => {
        state.addItemLoading = false;
        state.addItemError = action.payload as any;
      })
      .addCase(removeItem.pending, (state) => {
        state.addItemLoading = true;
      })
      .addCase(removeItem.fulfilled, (state, action) => {
        state.addItemLoading = false;
        state.items.data = state.items.data.filter(
          (item: any) => item.node.id !== action.payload,
        );
      })
      .addCase(removeItem.rejected, (state, action) => {
        state.addItemLoading = false;
        state.addItemError = action.payload as any;
      })
      .addCase(toggleUserIndex.pending, (state) => {
        state.toggleLoading = true;
      })
      .addCase(toggleUserIndex.fulfilled, (state, action) => {
        state.toggleLoading = false;
        state.data = action.payload;
      })
      .addCase(toggleUserIndex.rejected, (state, action) => {
        state.toggleLoading = false;
        state.toggleError = action.payload as any;
      })
      .addCase(updateIndexTitle.pending, (state) => {
        state.titleLoading = true;
      })
      .addCase(updateIndexTitle.fulfilled, (state, action) => {
        state.titleLoading = false;
        state.error = null;
        state.data = action.payload;
      })
      .addCase(updateIndexTitle.rejected, (state, action) => {
        state.titleLoading = false;
        state.titleError = action.payload as any;
      })
      .addCase(updateProfile.pending, (state) => {
        state.loading = true;
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.loading = false;
        if (state.data?.controllerDID.id === action.payload.id) {
          state.data.controllerDID = action.payload;
        }
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as any;
      });
  },
});

export const selectIndex = (state: any) => state.index;
export const { setAddItemLoading, resetIndex } = indexSlice.actions;
export default indexSlice.reducer;
