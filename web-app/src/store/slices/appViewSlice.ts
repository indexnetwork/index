import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  type: "unknown",
  discoveryType: "unknown",
};

const appViewSlice = createSlice({
  name: "appView",
  initialState,
  reducers: {
    setViewType(state, action) {
      state.type = action.payload.type;
      state.discoveryType = action.payload.discoveryType;
    },
  },
});

export const { setViewType } = appViewSlice.actions;
export const selectView = (state: any) => state.appView;

export default appViewSlice.reducer;
