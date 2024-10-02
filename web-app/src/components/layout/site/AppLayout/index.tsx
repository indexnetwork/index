"use client";

import { APIProvider } from "@/context/APIContext";
import { AppContextProvider } from "@/context/AppContext";
import { AuthProvider } from "@/context/AuthContext";
import PlausibleProvider from "next-plausible";
import { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { Provider } from "react-redux";
import store from "@/store/store";
import { MetaMaskProvider } from "@metamask/sdk-react";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => (
  <Provider store={store}>
    <MetaMaskProvider
      debug={false}
      sdkOptions={{
        dappMetadata: {
          name: "Index Network",
          url: typeof window !== "undefined" ? window.location.href : "https://index.network",
        },
        infuraAPIKey: process.env.INFURA_API_KEY,
      }}
    >

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
    </MetaMaskProvider>
  </Provider>
);
