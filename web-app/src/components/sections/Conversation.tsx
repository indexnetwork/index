import AskIndexes from "components/site/indexes/AskIndexes";

export default function ConversationSection() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "start",
          flex: 1,
          overflowY: "auto",
          maxHeight: "calc(100dvh - 12em)",
          height: "100%",
        }}
      >
        <AskIndexes />
      </div>
    </div>
  );
}
