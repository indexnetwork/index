import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "..";

// Define a type for the slice state
interface ConnectionState {
	metaMaskConnected: boolean;
	ceramicConnected: boolean;
	loading: boolean;
	address?: string;
}

// Define the initial state using that type
const initialState: ConnectionState = {
	metaMaskConnected: false,
	ceramicConnected: false,
	loading: true,
};

export const connectionSlice = createSlice({
	name: "connection",
	// `createSlice` will infer the state type from the `initialState` argument
	initialState,
	reducers: {
		setAuthLoading: (state, action: PayloadAction<boolean>) => ({
			...state,
			loading: action.payload,
		}),
		setMetaMaskConnected: (state, action: PayloadAction<{
			address?: string,
			metaMaskConnected: boolean
		}>) => {
			const { address, metaMaskConnected } = action.payload;

			return {
				...state,
				metaMaskConnected,
				address,
			};
		},
		setCeramicConnected: (state, action: PayloadAction<boolean>) => ({
			...state,
			ceramicConnected: action.payload,
		}),

		disconnectApp: () => initialState,
		resetAuth: (state) => ({
			...state,
			metaMaskConnected: false,
			ceramicConnected: false,
			address: undefined,
		}),
	},
});

export const {
	setAuthLoading,
	setMetaMaskConnected,
	setCeramicConnected,
	disconnectApp,
	resetAuth,
} = connectionSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectConnection = (state: RootState) => state.connection;

export default connectionSlice.reducer;
