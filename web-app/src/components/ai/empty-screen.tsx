import IconLightbulb from "components/base/Icon/IconLightbulb";
import Flex from "components/layout/base/Grid/Flex";
import Text from "../base/Text";

const exampleMessages = [
  {
    message: `Highlight any paradigm shifts in my indexes that might challenge previous knowledge.`,
  },
  {
    message: "Collate any overlaps between X index and practices in Y company.",
  },
  {
    message: `Based on recent developments, predict the next major changes for the discovery ecosystem`,
  },
  {
    message: `List all updates from my discovery network`,
  },
];

export function EmptyScreen({
  setInput,
  contextMessage,
  indexIds,
}: {
  setInput: (input: string) => void;
  contextMessage: string;
  indexIds?: string[];
}) {
  return (
    <Flex
      flexdirection="column"
      alignitems="center"
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
          ? exampleMessages
              .slice(0, 2)
              .map((message, i) => (
                <ExampleMessageBox
                  key={i}
                  message={message.message}
                  setInput={setInput}
                />
              ))
          : exampleMessages.map((message, i) => (
              <ExampleMessageBox
                key={i}
                message={message.message}
                setInput={setInput}
              />
            ))}
      </div>
    </Flex>
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
