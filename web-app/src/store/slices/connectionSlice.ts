import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "..";

// Define a type for the slice state
interface ConnectionState {
	metaMaskConnected: boolean;
	connected: boolean;
	originNFTModalVisible: boolean;
	loading: boolean
	did?: string;
}

// Define the initial state using that type
const initialState: ConnectionState = {
	metaMaskConnected: false,
	connected: false,
	originNFTModalVisible: false,
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
		setOriginNFTModalVisible: (state, action: PayloadAction<boolean>) => ({
			...state,
			originNFTModalVisible: action.payload,
		}),
		setMetaMaskConnected: (state, action: PayloadAction<{
			did?: string,
			metaMaskConnected: boolean
		}>) => {
			const { did, metaMaskConnected } = action.payload;

			return {
				...state,
				metaMaskConnected,
				did,
			};
		},
		// setConnected: (state, action: PayloadAction<boolean>) => ({
		// 	...state,
		// 	connected: action.payload,
		// }),

		disconnectApp: () => initialState,
		resetAuth: (state) => ({
			...state,
			metaMaskConnected: false,
			connected: false,
			originNFTModalVisible: false,
			did: undefined,
		}),
	},
});

export const {
	setAuthLoading,
	setOriginNFTModalVisible,
	setMetaMaskConnected,
	// setConnected,
	disconnectApp,
	resetAuth,
} = connectionSlice.actions;

// Other code such as selectors can use the imported `RootState` type
export const selectConnection = (state: RootState) => state.connection;

export default connectionSlice.reducer;
