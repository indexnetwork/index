"use client";

import { appConfig } from "@/config";
import { normalizeAccountId } from "@ceramicnetwork/common";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { getAccountId } from "@didtools/pkh-ethereum";
import { getAddress } from "@ethersproject/address";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";
import React, { useCallback, useEffect, useState } from "react";
import { switchTestNetwork } from "utils/helper";

declare global {
  interface Window {
    ethereum: any;
  }
}

export enum AuthStatus {
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  LOADING = "LOADING",
  FAILED = "FAILED",
  IDLE = "IDLE",
}

export interface AuthContextType {
  connect(): Promise<void>;
  disconnect(): void;
  status: AuthStatus;
  setStatus: (status: AuthStatus) => void;
  session?: DIDSession;
  userDID?: string;
  isLoading?: boolean;
}

const defaultAuthContext = {
  connect: async () => {},
  disconnect: () => {},
  status: AuthStatus.IDLE,
  setStatus: (status: AuthStatus) => {},
  session: undefined,
  userDID: undefined,
  isLoading: false,
};

// type SessionResponse = {
//   session: DIDSession,
// };

/* eslint-disable */
export const AuthContext =
  React.createContext<AuthContextType>(defaultAuthContext);

export const AuthProvider = ({ children }: any) => {
  const SESSION_KEY = "did";
  // const {
  //   originNFTModalVisible,
  // } = useAppSelector(selectConnection);
  // const dispatch = useAppDispatch();

  const [session, setSession] = useState<DIDSession | undefined>();
  const [status, setStatus] = useState<AuthStatus>(AuthStatus.IDLE);

  const userDID = session?.did.parent;
  const isLoading = status === AuthStatus.LOADING;

  const handleInitialCheck = useCallback(async () => {
    const res = await checkSession();
    console.log("Check session result", res);
  }, []);

  useEffect(() => {
    // TODO: no force connect
    // authenticate();
    handleInitialCheck();
  }, [handleInitialCheck]);

  // DEBUG
  // useEffect(() => {
  //   if (!session) return;
  //   console.log("Session changed", session);
  // }, [session]);

  const disconnect = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(undefined);
  };

  const checkSession = async (): Promise<boolean> => {
    if (session && !session.isExpired) {
      console.log("Session already exists and is valid");
      return true;
    }

    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (!sessionStr) {
      console.log("No session found in local storage");
      return false;
    }

    const existingSession = await DIDSession.fromSession(sessionStr);
    console.log("Existing session", existingSession);
    setSession(existingSession);
    setStatus(AuthStatus.CONNECTED);
    return !existingSession.isExpired;
  };

  const startSession = useCallback(async (): Promise<void> => {
    const ethProvider = window.ethereum;

    if (ethProvider.chainId !== appConfig.testNetwork.chainId) {
      const switchRes = await switchTestNetwork();
      if (!switchRes) {
        // dispatch(setAuthLoading(false));
        // setStatus(AuthStatus.FAILED);
        throw new Error("Network error.");
      }
    }
    // request ethereum accounts.
    const addresses = await ethProvider.enable({
      method: "eth_requestAccounts",
    });

    const accountId = await getAccountId(ethProvider, addresses[0]);
    const normAccount = normalizeAccountId(accountId);
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    const now = new Date();
    const twentyFiveDaysLater = new Date(
      now.getTime() + 25 * 24 * 60 * 60 * 1000,
    );

    const siweMessage = new SiweMessage({
      domain: window.location.host,
      address: getAddress(normAccount.address),
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: normAccount.chainId.reference,
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: twentyFiveDaysLater.toISOString(),
      resources: ["ceramic://*"],
    });

    siweMessage.signature = await ethProvider.request({
      method: "personal_sign",
      params: [siweMessage.signMessage(), getAddress(accountId.address)],
    });

    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });

    localStorage.setItem(SESSION_KEY, newSession.serialize());
    setSession(newSession);
  }, []);

  const authenticate = useCallback(async () => {
    if (!window.ethereum) {
      console.warn(
        "Skipping wallet connection: No injected Ethereum provider found.",
      );
      return;
    }

    if (status === AuthStatus.CONNECTED || status === AuthStatus.LOADING) {
      console.log("Already connected or connecting...", status);
      return;
    }

    setStatus(AuthStatus.LOADING);
    try {
      const sessionIsValid = await checkSession();

      if (!sessionIsValid) {
        console.log("No valid session found, starting new session...");
        await startSession();
      }

      console.log("Session is valid, connecting...");

      setStatus(AuthStatus.CONNECTED);
    } catch (err) {
      console.error("Error during authentication process:", err);
      setStatus(AuthStatus.FAILED);
    }
  }, [status, checkSession, startSession]);

  return (
    <AuthContext.Provider
      value={{
        connect: authenticate,
        disconnect,
        status,
        setStatus,
        session,
        userDID,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
