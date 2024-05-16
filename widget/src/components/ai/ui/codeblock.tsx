// Inspired by Chatbot-UI and modified to fit the needs of this project
// @see https://github.com/mckaywrigley/chatbot-ui/blob/main/components/Markdown/CodeBlock.tsx

import { FC, memo } from "react";
// @ts-ignore
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
// @ts-ignore
import { coldarkDark } from "react-syntax-highlighter/dist/cjs/styles/prism";

import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { IconCheck, IconCopy, IconDownload } from "@/components/ai/ui/icons";
import Button from "@/components/ui/Button";
import Text from "@/components/ui/Text";
import "./codeblock.css";

interface Props {
  language: string;
  value: string;
}

interface LanguageMap {
  [key: string]: string | undefined;
}

export const programmingLanguages: LanguageMap = {
  javascript: ".js",
  python: ".py",
  java: ".java",
  c: ".c",
  cpp: ".cpp",
  "c++": ".cpp",
  "c#": ".cs",
  ruby: ".rb",
  php: ".php",
  swift: ".swift",
  "objective-c": ".m",
  kotlin: ".kt",
  typescript: ".ts",
  go: ".go",
  perl: ".pl",
  rust: ".rs",
  scala: ".scala",
  haskell: ".hs",
  lua: ".lua",
  shell: ".sh",
  sql: ".sql",
  html: ".html",
  css: ".css",
  // add more file extensions here, make sure the key is same as language prop in CodeBlock.tsx component
};

export const generateRandomString = (length: number, lowercase = false) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXY3456789"; // excluding similar looking characters like Z, 2, I, 1, O, 0
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return lowercase ? result.toLowerCase() : result;
};

const CodeBlock: FC<Props> = memo(({ language, value }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 });

  const downloadAsFile = () => {
    if (typeof window === "undefined") {
      return;
    }
    const fileExtension = programmingLanguages[language] || ".file";
    const suggestedFileName = `file-${generateRandomString(
      3,
      true,
    )}${fileExtension}`;
    const fileName = window.prompt("Enter file name" || "", suggestedFileName);

    if (!fileName) {
      // User pressed cancel on prompt.
      return;
    }

    const blob = new Blob([value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const onCopy = () => {
    if (isCopied) return;
    copyToClipboard(value);
  };

  return (
    <>
      <div
        className="p-4"
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "100%",
          background: "rgb(39, 39, 42)",
          borderRadius: "5px 5px 0px 0px",
        }}
      >
        <div className={"idxflex-grow-1"}>
          <div
            style={{
              display: "flex",
            }}
            className={"mt-3"}
          >
            <Text theme="white" size={"md"}>
              {language}
            </Text>
          </div>
        </div>
        <div>
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
            }}
          >
            <Button onClick={downloadAsFile} className="p-1">
              <IconDownload style={{ opacity: 0.5 }} />
              <span className="sr-only hidden">Download</span>
            </Button>
            <Button onClick={onCopy} className="p-1">
              {!isCopied ? (
                <IconCheck style={{ opacity: 0.5 }} width={20} height={20} />
              ) : (
                <IconCopy style={{ opacity: 0.5 }} width={20} height={20} />
              )}
              <span className="sr-only hidden">Copy code</span>
            </Button>
          </div>
        </div>
      </div>
      <SyntaxHighlighter
        language={language}
        style={coldarkDark}
        PreTag="div"
        showLineNumbers
        customStyle={{
          margin: 0,
          width: "100%",
          padding: "1.5rem 1rem",
          borderRadius: "0px 0px 5px 5px ",
        }}
        codeTagProps={{
          style: {
            fontSize: "0.875rem",
            fontFamily: "var(--font-mono)",
          },
        }}
      >
        {value}
      </SyntaxHighlighter>
    </>
  );
});
CodeBlock.displayName = "CodeBlock";

export { CodeBlock };
