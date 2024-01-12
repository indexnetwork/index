import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Users } from "types/entity";
import type { RootState } from "..";

export type ProfileState = Partial<Users> & {
	available: boolean;
};

const initialState: ProfileState = {
	available: false,
};

export const profileSlice = createSlice({
	name: "connection",
	initialState,
	reducers: {
		setProfile(state, action: PayloadAction<ProfileState>) {
			return action.payload;
		},
		resetProfile: () => initialState,
	},
});

export const {
	setProfile,
	resetProfile,
} = profileSlice.actions;

export const selectProfile = (state: RootState) => state.profile;

export default profileSlice.reducer;
