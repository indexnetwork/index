import NoIndexesChat from "@/components/ai/no-indexes";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import { selectView } from "@/store/slices/appViewSlice";
import { useAppSelector } from "@/store/store";
import { selectIndex } from "@/store/slices/indexSlice";
import { selectDID } from "@/store/slices/didSlice";

export default function ChatTabSection() {
  const { items, data: viewedIndex } = useAppSelector(selectIndex);
  const { data: viewedProfile } = useAppSelector(selectDID);
  const view = useAppSelector(selectView);
  // if (indexLoading) {
  //   return (
  //     <div
  //       style={{
  //         height: "80vh",
  //         display: "flex",
  //         flexDirection: "column",
  //         alignItems: "center",
  //         justifyContent: "center",
  //       }}
  //     >
  //       <LoadingSection />
  //     </div>
  //   );
  // }
  //

  if (
    (items.data && items.data.length > 0 && viewedIndex) ||
    view.type === "conversation"
  ) {
    return (
      <div
        style={{
          display: "flex",
          overflowY: "auto",
          justifyContent: "stretch",
          alignItems: "start",
          maxHeight: "calc(-30rem + 100dvh)",
        }}
      >
        <AskIndexes />
      </div>
    );
  }

  return (
    <NoIndexesChat
      isSelfDid={viewedIndex?.controllerDID.id === viewedProfile?.id}
    />
  );
}
