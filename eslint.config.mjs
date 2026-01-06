import next from "eslint-config-next";

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
  rules: {
    // This rule is overly strict for common patterns like "fetch on mount" and "sync prop to state".
    "react-hooks/set-state-in-effect": "off",
  },
});

export default config;
