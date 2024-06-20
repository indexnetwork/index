"use client";

import ConfirmTransaction from "@/components/site/modal/Common/ConfirmTransaction";
import CreateModal from "@/components/site/modal/CreateModal";
import { useApp } from "@/context/AppContext";
import { ethers } from "ethers";
import type { NextPage } from "next";
import "../[...id]/app.css";
import didService from "@/services/did-service";
import { useApi } from "@/context/APIContext";
import { useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { DIDSession } from "did-session";

const Home: NextPage = () => {
  const {
    transactionApprovalWaiting,
    handleTransactionCancel,
    setIndexes,
    indexes,
  } = useApp();

  const { setSession } = useAuth();

  const { api, ready: apiReady } = useApi();

  const router = useRouter();

  const handleGuest = useCallback(async () => {
    let sessionToken = localStorage.getItem("did");
    let session;
    if (!sessionToken) {
      const wallet = ethers.Wallet.createRandom();
      session = await didService.getNewDIDSessionWithWallet(wallet);
      sessionToken = session.serialize();
      localStorage.setItem("did", sessionToken);
    } else {
      session = await DIDSession.fromSession(sessionToken);
    }

    setSession(session);

    api!.setSessionToken(sessionToken);
    api!.updateProfile({
      name: "You",
      bio: "Adventurer",
    });
  }, [api]);

  useEffect(() => {
    if (apiReady) {
      handleGuest();
    }
  }, [apiReady, handleGuest]);

  const handleCreate = async (title: string) => {
    const doc = await api!.createIndex(title);

    if (!doc) {
      throw new Error("API didn't return a doc");
    }
    setIndexes([...indexes, doc]);
    toast.success("Index created successfully");
    router.push(`/${doc.id}`);
  };

  return (
    <div id="newindex">
      {transactionApprovalWaiting && (
        <ConfirmTransaction
          backdropClose={false}
          handleCancel={handleTransactionCancel}
          visible={transactionApprovalWaiting}
        />
      )}
      <CreateModal
        cancelVisible={false}
        visible={true}
        onCreate={handleCreate}
      />
    </div>
  );
};

export default Home;
