import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "..";

// Define a type for the slice state
interface ConnectionState {
	metaMaskConnected: boolean;
	tokenSigned: boolean;
	ceramicConnected: boolean;
	loading: boolean;
	authToken?: string;
	address?: string;
}

// Define the initial state using that type
const initialState: ConnectionState = {
	metaMaskConnected: false,
	tokenSigned: false,
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
		setAuthenticated: (state, action: PayloadAction<boolean>) => ({
			...state,
			authenticated: action.payload,
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
		setApiTokenSigned: (state, action: PayloadAction<{
			authToken?: string,
			tokenSigned: boolean
		}>) => {
			const { tokenSigned, authToken } = action.payload;
			return {
				...state,
				tokenSigned,
				authToken,
			};
		},
		disconnectApp: () => initialState,
		resetAuth: (state) => ({
			...state,
			metaMaskConnected: false,
			tokenSigned: false,
			ceramicConnected: false,
			authToken: undefined,
			address: undefined,
		}),
	},
});

export const {
	setAuthLoading,
	setMetaMaskConnected,
	setCeramicConnected,
	setApiTokenSigned,
	disconnectApp,
	resetAuth,
} = connectionSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectConnection = (state: RootState) => state.connection;

export default connectionSlice.reducer;
