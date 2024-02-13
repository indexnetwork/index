import { useApp } from "@/context/AppContext";
import Flex from "components/layout/base/Grid/Flex";
import Head from "next/head";
import { IndexConversationProvider } from "./IndexConversationContext";
import { IndexConversationHeader } from "./IndexConversationHeader";
import TabContainer from "./TabContainer";

const IndexConversationSection = () => {
  const { viewedIndex } = useApp();

  return (
    <IndexConversationProvider>
      <div
        className={"px-md-10 px-0 pt-6"}
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <IndexConversationHeader />
        <TabContainer />
      </div>
      {viewedIndex && (
        <Head>
          <title>{viewedIndex.title} - Index Network</title>
          <meta name="title" content={`${viewedIndex.title} - Index Network`} />
          <meta
            name="description"
            content="The human bridge between context and content."
          />
        </Head>
      )}
    </IndexConversationProvider>
  );
};

export default IndexConversationSection;
