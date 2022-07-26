import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "../";

// Define a type for the slice state
interface UserState {
  address?: string;
	isAuthenticated: boolean;
}

// Define the initial state using that type
const initialState: UserState = {
	isAuthenticated: false,
};

export const userSlice = createSlice({
	name: "counter",
	// `createSlice` will infer the state type from the `initialState` argument
	initialState,
	reducers: {
		test: (state) => {
			state.address += "";
		},
	},
});

export const { test } = userSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectUser = (state: RootState) => state.user;

export default userSlice.reducer;
