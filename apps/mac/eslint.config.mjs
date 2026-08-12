import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const macSourceFiles = [
  "apps/mac/api/**/*.mjs",
  "apps/mac/**/*.mjs",
  "apps/mac/src/ui/**/*.jsx",
];

export default [
  eslint.configs.recommended,
  {
    files: macSourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        Bun: "readonly",
      },
    },
  },
  {
    files: ["apps/mac/src/ui/**/*.jsx"],
    languageOptions: {
      globals: {
        React: "readonly",
        ReactDOM: "readonly",
        useContext: "readonly",
        useEffect: "readonly",
        useInterval: "readonly",
        useMemo: "readonly",
        useRef: "readonly",
        useState: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-unused-vars": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
