'use client';

import Container from "components/layout/base/Grid/Container";
import AppLeft from "components/sections/AppLeft";
import { APIProvider, useApi } from "components/site/context/APIContext";
import { AuthProvider } from "components/site/context/AuthContext";
import { AppContextProvider } from "hooks/useApp";
import PlausibleProvider from "next-plausible";
import { useRouter } from "next/router";
import { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { Provider } from "react-redux";
import { store } from "store";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  return (
    <Provider store={store}>
      {/* <CeramicProvider> */}
      <AuthProvider>
        <APIProvider>
          <PlausibleProvider domain="index.network">
            <AppContextProvider>
              {/* {getLayout(<Component {...pageProps} />)} */}

              {/* {Component.requireAuth ? (
          <AuthGuard>
          </AuthGuard>
        ) : (
          <AuthGuard>
            {getLayout(<Component {...pageProps} />)}
          </AuthGuard>
        )} */}
                {children}

              <Toaster />
            </AppContextProvider>
          </PlausibleProvider>
        </APIProvider>
      </AuthProvider>
      {/* </CeramicProvider> */}
    </Provider>
  )
}