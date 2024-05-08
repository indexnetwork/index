"use client";

import { APIProvider } from "@/context/APIContext";
import { AppContextProvider } from "@/context/AppContext";
import { AuthProvider } from "@/context/AuthContext";
import PlausibleProvider from "next-plausible";
import { ReactNode } from "react";
import { Toaster } from "react-hot-toast";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => (
  <AuthProvider>
    <APIProvider>
      <PlausibleProvider domain="index.network">
        <AppContextProvider>
          {children}
          <Toaster
            toastOptions={{
              className: "",
              duration: 500000,
              style: {
                // border: "1px solid #713200",
                padding: "16px",
                borderRadius: "4px",
                // color: "#713200",
              },
            }}
          />
        </AppContextProvider>
      </PlausibleProvider>
    </APIProvider>
  </AuthProvider>
);
