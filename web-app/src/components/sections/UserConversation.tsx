import React, { useEffect, useState } from "react";

import AskIndexes from "components/site/indexes/AskIndexes";
import { useRouteParams } from "hooks/useRouteParams";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

export function UserConversationSection() {
  const [chatId, setChatID] = useState<string>(uuidv4());
  const { did } = useRouteParams();

  useEffect(() => {
    const suffix = createHash("sha256").update(did).digest("hex");
    setChatID(`${localStorage.getItem("chatterID")}-${suffix}`);
  }, [did]);

  return <AskIndexes id={chatId} did={did} />;
}