type HistoryItemProps = {
  summary: string;
  link: string;
  timestamp: string;
};

const HistoryItem = ({ item }: { item: HistoryItemProps }) => {
  return (
    <a href={`/${item.link}`}>
      <div
        style={{
          borderRadius: "4px",
          padding: "16px",
          border: "1px solid var(--gray-2)",
          height: "fit-content",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <p
          style={{
            fontSize: "14px",
            fontWeight: "bold",
            margin: 0,
          }}
        >
          {item.summary}
        </p>

        <p
          style={{
            margin: 0,
          }}
        >
          {/* Last message 10 days ago */}
          {item.timestamp}
        </p>
      </div>
    </a>
  );
};

export default HistoryItem;
