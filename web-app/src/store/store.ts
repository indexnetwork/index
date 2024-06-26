import { configureStore } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import appViewReducer from "./slices/appViewSlice";
import conversationReducer from "./slices/conversationSlice";
import didReducer from "./slices/didSlice";
import indexReducer from "./slices/indexSlice";

const store = configureStore({
  reducer: {
    conversation: conversationReducer,
    appView: appViewReducer,
    index: indexReducer,
    did: didReducer,
  },
});

export default store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
