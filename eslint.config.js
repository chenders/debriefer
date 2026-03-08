import eslint from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  // Global ignores
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.js"],
  },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Production TypeScript files
  {
    files: ["packages/*/src/**/*.ts"],
    ignores: ["**/__tests__/**", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "warn",
    },
  },

  // Test files — relaxed rules
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  }
)
