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
  // const isMobile = typeof window !== undefined && window.innerWidth < 768;
  const isMobile = false;
  return (
    <section>
      <div className="flex w-full flex-col min-h-[300px]  items-center gap-24 lg:flex-row justify-between">
        <div className="w-full lg:w-1/2 md:pl-4">
          <p
            className="font-secondary text-md md:text-lg md:pr-12"
            dangerouslySetInnerHTML={{ __html: data.content }}
          />
        </div>
        <div className="w-full lg:w-1/2 mx-8">
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
