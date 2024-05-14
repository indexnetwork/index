import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import "react-tabs/style/react-tabs.css";
import "./override.css";

const CodeSnippetJS = () => {
  const codeString = `import IndexClient from "@indexnetwork/sdk";

const wallet = new Wallet(process.env.PRIVATE_KEY);
const indexClient = new IndexClient({
  network: "mainnet",
  wallet,
});

await indexClient.authenticate();

const vectorStore = await indexClient.getVectorStore({
  embeddings: new MistralAIEmbeddings({
    api_key: process.env.MISTRAL_API_KEY,
    model: "mistral-embed",
  }),
});`;
  return (
    <SyntaxHighlighter language="javascript" style={atomOneLight}>
      {codeString}
    </SyntaxHighlighter>
  );
};
const CodeSnippetPython = () => {
  const codeString = `from indexclient.chroma import IndexChroma
from langchain_mistralai import MistralAIEmbeddings

embeddings = MistralAIEmbeddings(model="mistral-embed",
                              api_key='MISTRAL_API_KEY')


vectorstore = IndexChroma(embedding_function=embeddings)`;
  return (
    <SyntaxHighlighter language="python" style={atomOneLight}>
      {codeString}
    </SyntaxHighlighter>
  );
};

const items = [
  {
    key: "1",
    label: "Node.js",
    children: <CodeSnippetJS />,
  },
  {
    key: "2",
    label: "Python",
    children: <CodeSnippetPython />,
  },
];

export const CodeSnippetsWithTabs = () => {
  return (
    <Tabs>
      <TabList>
        <Tab>
          <p>Node.js</p>
        </Tab>
        <Tab>
          <p>Python</p>
        </Tab>
      </TabList>

      <TabPanel>
        <CodeSnippetJS />
      </TabPanel>
      <TabPanel>
        <CodeSnippetPython />
      </TabPanel>
    </Tabs>
  );
};
