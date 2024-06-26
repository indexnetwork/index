import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

type HowItWorksContentProps = {
  data: {
    content: string;
    codeBlock: string;
  };
};

const HowItWorksContent = ({ data }: HowItWorksContentProps) => {
  // set isMobile state to true if window width is less than 768px
  const isMobile = window.innerWidth < 768;
  return (
    <section>
      <div className="flex w-full flex-col min-h-[400px] items-center gap-8 md:flex-row justify-between">
        <div className="w-full md:w-1/3 md:px-4">
          <p
            className="font-secondary text-md md:text-lg"
            dangerouslySetInnerHTML={{ __html: data.content }}
          />
        </div>
        <div className="w-full md:w-1/2 mx-8">
          <SyntaxHighlighter
            language="javascript"
            style={atomOneDark}
            customStyle={{
              background: "transparent",
              fontSize: isMobile ? "12px" : "14px",
            }}
          >
            {data.codeBlock}
          </SyntaxHighlighter>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksContent;
