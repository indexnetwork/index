// import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';

import { IndexChat } from "@indexnetwork/ui";
// import "index-chat/dist/assets/style/fonts.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

// import "./App.css";
import { coldarkDark } from "react-syntax-highlighter/dist/esm/styles/prism";

function App() {
  const customTheme = {
    light: {
      primary: "#111d0d",
      accent: "#A3C586",
      background: "#FBF8EF",
      border: "#B7CBBF",
      pale: "#E3E8E1",
      secondary: "#8D9B88",
    },
    dark: {
      primary: "#eedbd1",
      accent: "#726E6D",
      background: "rgb(28, 28, 28)",
      border: "#3A3633",
      pale: "#272524",
      secondary: "#9E938C",
    },
  };

  const codeString = `import { IndexChat } from '@indexnetwork/ui';\n\n<IndexChat id='your_id'/>`;

  const IndexIcon: React.FC<any> = ({ title, ...props }) => (
    <svg
      width="90"
      height="34"
      viewBox="0 0 45 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.88395 3.6658L6.88395 13.3358L3.68118 13.3358L3.68118 3.6658L6.88395 3.6658L3.7182 0.5L0.5 0.5L0.5 10.1546L6.84539 16.5L10.0636 16.5L10.0636 6.84539L6.88395 3.6658Z"
        fill="#0f172a"
      />
      <path
        d="M16.5708 6.85155L17.7232 6.85155L17.7232 13.3127L16.5708 13.3127L16.5708 6.85155Z"
        fill="#0f172a"
      />
      <path
        d="M19.1365 6.85155L20.4386 6.85155L23.4161 10.9445L23.575 10.9445L23.575 6.85155L24.7367 6.85155L24.7367 13.3127L23.4254 13.3127L20.4571 9.21969L20.2889 9.21969L20.2889 13.3127L19.1365 13.3127L19.1365 6.85155Z"
        fill="#0f172a"
      />
      <path
        d="M31.9846 10.0821C31.9846 11.9272 30.5699 13.3127 28.6877 13.3127L26.1406 13.3127L26.1406 6.85155L28.6877 6.85155C30.5699 6.85155 31.9846 8.23695 31.9846 10.0821ZM30.7951 10.0821C30.7951 9.04228 29.8772 8.26472 28.6507 8.26472L27.2931 8.26472L27.2931 11.8979L28.6507 11.8979C29.8772 11.8979 30.7951 11.1204 30.7951 10.0806L30.7951 10.0821Z"
        fill="#0f172a"
      />
      <path
        d="M37.7994 11.8979L37.7994 13.3127L33.0894 13.3127L33.0894 6.85155L37.7531 6.85155L37.7531 8.26627L34.2418 8.26627L34.2418 9.38014L37.4446 9.38014L37.4446 10.747L34.2418 10.747L34.2418 11.8995L37.801 11.8995L37.7994 11.8979Z"
        fill="#0f172a"
      />
      <path
        d="M42.4168 10.1006L44.5705 13.3127L43.2221 13.3127L41.63 11.0371L41.4047 11.0371L39.8219 13.3127L38.3701 13.3127L40.5701 10.0358L38.4534 6.85155L39.8018 6.85155L41.3569 9.10862L41.5729 9.10862L43.128 6.85155L44.5797 6.85155L42.4168 10.1006Z"
        fill="#0f172a"
      />
    </svg>
  );

  return (
    <div className="App">
      <div
        className="container"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "start",
          alignItems: "center",
          height: "100vh",
          padding: "0 1.5rem",
        }}
      >
        <main
          style={{
            paddingTop: "2rem",
            maxWidth: "28rem",
            width: "100%",
          }}
        >
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "start",
              alignItems: "center",
              paddingBottom: "4rem",
            }}
          >
            <a href="https://index.network">
              <IndexIcon />
            </a>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              paddingBottom: "2rem",
            }}
          >
            <h1
              style={{
                fontSize: "2.1rem",
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Interact with your context!
            </h1>
            <p>
              ⚡️ <a href="https://index.network">Index Network</a> allows you
              to interact with the web in a context-aware way.
            </p>
            <p>
              ⛓️ Provide your index id to the <code>IndexChat</code> component.
              No extra work required.
            </p>
            <div
              style={{
                // backgroundColor: '#0f172a',
                // padding: '1rem',
                // color: '#dfeaf4',
                // borderRadius: '0.5rem',
                maxWidth: "100%",
              }}
            >
              {/* <code className='language-javascript'>
                {`import IndexChat from 'index-chat'

                <IndexChat id='your_id'/>`}
              </code> */}

              <SyntaxHighlighter
                language="tsx"
                style={coldarkDark}
                customStyle={{
                  borderRadius: "0.5rem",
                  // padding: '1rem', // Padding inside the code block
                  fontSize: ".8rem", // Adjust font size as needed
                  // color: '#dfeaf4',
                  // backgroundColor: '#0f172a',
                  // whiteSpace: 'pre-line',
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            </div>
            <p>🎉 Done. Enjoy your chat!</p>

            <div>
              <IndexChat
                id="kjzl6kcym7w8y67xydanh9kdvtjnah7nmfupslu1nioj0b2ca7ry688y6w5ky27"
                style={{
                  darkMode: true,
                  // theme: customTheme,
                }}
              />
            </div>
          </div>
          <div
            style={{
              paddingTop: "2rem",
              fontWeight: 600,
              alignSelf: "flex-end",
              textDecoration: "underline",
              display: "flex",
              gap: "1rem",
              // position: 'absolute',
            }}
          >
            {/* <p>Learn more: </p> */}
            <a href="https://github.com/indexnetwork/index">Github</a>
            <a href="https://www.npmjs.com/package/@indexnetwork/ui">npm</a>
          </div>
        </main>
      </div>
      <style>
        {`
        `}
      </style>
    </div>
  );
}

export default App;
