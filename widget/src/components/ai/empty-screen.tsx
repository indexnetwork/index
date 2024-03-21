import IconLightbulb from "@/components/ui/Icon/IconLightbulb";
import Text from "@/components/ui/Text";

export function EmptyScreen({
  setInput,
  contextMessage,
  indexIds,
  defaultQuestions,
}: {
  setInput: (input: string) => void;
  contextMessage: string;
  indexIds?: string[];
  defaultQuestions?: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
      className="container-empty-screen pt-2"
    >
      <div className="inner-container-empty-screen">
        <img
          src="/images/index-chat-empty-screen.png"
          width={202}
          height={202}
          alt="Illustration of trees"
        />
        <Text fontFamily="freizeit" size="xl" className="text" fontWeight={700}>
          Your responses will align with {contextMessage}
        </Text>
      </div>
      <div className="example-messages-empty-screen">
        {indexIds && indexIds.length > 0
          ? defaultQuestions?.map((message, i) => (
              <ExampleMessageBox
                key={i}
                message={message}
                setInput={setInput}
              />
            ))
          : defaultQuestions?.map((message, i) => (
              <ExampleMessageBox
                key={i}
                message={message}
                setInput={setInput}
              />
            ))}
      </div>
    </div>
  );
}

const ExampleMessageBox = ({
  message,
  setInput,
}: {
  message: string;
  setInput: (input: string) => void;
}) => (
  <button
    onClick={() => setInput(message)}
    className="example-message-box-empty-screen"
  >
    <IconLightbulb className="icon-empty-screen" />
    <Text className="truncate-text" fontWeight={500}>
      {message}
    </Text>
  </button>
);
