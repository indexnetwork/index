import HistoryItem from "./HistoryItem";

const ConversationHistory = ({ items }: { items: any }) => {
  return (
    <div
      className={"scrollable-area idxflex-grow-1"}
      style={{
        display: "flex",
      }}
    >
      <div
        style={{
          padding: "24px 16px 24px 0px",
          display: "flex",
          gap: "12px",
          flexDirection: "column",
          flexGrow: 1,
        }}
      >
        {items.map((item: any) => {
          return <HistoryItem key={item.id} item={item} />;
        })}
      </div>
    </div>
  );
};

export default ConversationHistory;
