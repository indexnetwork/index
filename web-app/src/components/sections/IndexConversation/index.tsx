import Head from "next/head";
import { useAppSelector } from "@/store/store";
import { selectIndex } from "@/store/slices/indexSlice";
import { IndexConversationProvider } from "./IndexConversationContext";
import { IndexConversationHeader } from "./IndexConversationHeader";
import TabContainer from "./TabContainer";

const IndexConversationSection = () => {
  const { data: viewedIndex } = useAppSelector(selectIndex);

  return (
    <IndexConversationProvider>
      <div
        className={"px-md-10 px-0 pt-6"}
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "start",
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
