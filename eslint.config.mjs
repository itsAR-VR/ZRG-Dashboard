import next from "eslint-config-next";
import reactHooks from "eslint-plugin-react-hooks";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  ...next,
];

config.push({
  plugins: {
    "react-hooks": reactHooks,
  },
  rules: {
    // This rule is overly strict for common patterns like "fetch on mount" and "sync prop to state".
    "react-hooks/set-state-in-effect": "off",
    // This *will* crash production (React error #301) when triggered. Catch it in CI.
    "react-hooks/set-state-in-render": "error",
  },
});

export default config;
