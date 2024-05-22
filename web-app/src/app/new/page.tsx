"use client";

import CreateModal from "@/components/site/modal/CreateModal";
import type { NextPage } from "next";
import "../[id]/app.css";
import { useApp } from "@/context/AppContext";
import ConfirmTransaction from "@/components/site/modal/Common/ConfirmTransaction";

const Home: NextPage = () => {
  const {
    handleCreatePublic,
    transactionApprovalWaiting,
    handleTransactionCancel,
  } = useApp();
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
        onCreate={handleCreatePublic}
      />
    </div>
  );
};

export default Home;
