import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat ESLint configuration.
 * eslint-config-next v16 ships native flat configs, so no compatibility layer
 * is required.
 */
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".tmp/**",
      ".pgdata-test/**",
      ".pgdata-dev/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      "out/**",
      "build/**",
      "dist/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      // App Router only; there is no `pages` directory.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
