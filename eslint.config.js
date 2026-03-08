import eslint from "@eslint/js"
import tseslint from "typescript-eslint"
import security from "eslint-plugin-security"
import globals from "globals"

/**
 * ESLint configuration for the debriefer monorepo.
 * Aligned with deadonfilm server config: TypeScript ESLint + security plugin.
 * @type {import('typescript-eslint').Config}
 */
export default tseslint.config(
  // Global ignores
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.js", "!eslint.config.js"],
  },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,

  // All TypeScript files — shared settings
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      // Match deadonfilm: unused vars with underscore ignore
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Stricter than deadonfilm: enforce no-any in production
      "@typescript-eslint/no-explicit-any": "error",
      // Match deadonfilm server: error with warn/error allowed
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Security: disable noisy object-injection rule (same as deadonfilm)
      "security/detect-object-injection": "off",
    },
  },

  // Test files — relaxed rules (same as deadonfilm)
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
    },
  }
)
