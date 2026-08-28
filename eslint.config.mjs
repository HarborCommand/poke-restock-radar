import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false
    }
  },
  {
    ignores: [".next/**", ".next-*/**", "node_modules/**", "prisma/dev.db", "next-env.d.ts"]
  },
  {
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default eslintConfig;
