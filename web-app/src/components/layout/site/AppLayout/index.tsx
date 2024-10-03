"use client";

import { APIProvider } from "@/context/APIContext";
import { AppContextProvider } from "@/context/AppContext";
import { AuthProvider } from "@/context/AuthContext";
import PlausibleProvider from "next-plausible";
import { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { Provider } from "react-redux";
import store from "@/store/store";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => (
  <Provider store={store}>
    <AuthProvider>
      <APIProvider>
        <PlausibleProvider domain="index.network">
          <AppContextProvider>
            {children}
            <Toaster />
          </AppContextProvider>
        </PlausibleProvider>
      </APIProvider>
    </AuthProvider>
  </Provider>
);
