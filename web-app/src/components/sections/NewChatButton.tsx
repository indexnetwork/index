import Image from "next/image";

type NewChatButtonProps = {
  onClick: () => void;
};

const NewChatButton = ({ onClick }: NewChatButtonProps) => {
  return (
    <div
      style={{
        paddingTop: "16px",
        width: "100%",
        position: "sticky",
        top: 0,
      }}
    >
      <button
        style={{
          backgroundColor: "#F8FAFC",
          padding: "16px",
          border: "none",
          width: "100%",
          display: "flex",
          justifyContent: "start",
          fontSize: "14px",
          fontWeight: 600,
          alignItems: "center",
        }}
        onClick={onClick}
      >
        <span
          style={{
            marginRight: "12px",
          }}
        >
          <Image alt="plus" src="/images/ic_plus.svg" width="24" height="24" />
        </span>
        Start a new chat
      </button>
    </div>
  );
};

export default NewChatButton;
