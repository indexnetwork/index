import Freizeit from "@/fonts/loader";
import Flex from "components/layout/base/Grid/Flex";
import Image from "next/image";
import Text from "../base/Text";

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
    <Flex
      flexdirection="column"
      alignitems="center"
      className="container-empty-screen pt-2"
    >
      <div className="inner-container-empty-screen">
        <Image
          src="/images/index-chat-empty-screen.png"
          width={202}
          height={202}
          alt="Illustration of trees"
        />
        <Text
          size="xl"
          className={`${Freizeit.className} text`}
          fontWeight={700}
        >
          Your responses will align with {contextMessage}
        </Text>
      </div>
      <div className="example-messages-empty-screen">
        {indexIds &&
          indexIds.length > 0 &&
          defaultQuestions?.map((message, i) => (
            <ExampleMessageBox key={i} message={message} setInput={setInput} />
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
    <Text className="truncate-text" fontWeight={500}>
      {message}
    </Text>
  </button>
);
