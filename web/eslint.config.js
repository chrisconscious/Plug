import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Matches tsconfig's relaxed compilerOptions (noImplicitAny: false,
      // strictNullChecks: false, noUnusedLocals/Parameters: false) — this
      // file governs style/correctness lint, not the type-checking rigor
      // that build (`tsc -b`) already enforces separately. Tightening
      // these is a real, separate decision, not something to slip in here.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // Dependency-direction boundary (no monorepo/workspace exists, so
      // nothing else stops a relative import from physically reaching the
      // sibling `api/` folder on disk — this rule makes that failure loud
      // at lint time instead of a confusing runtime/bundle error).
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/api/src/**', '../../api/**', '../../../api/**'],
          message: 'web must never import backend implementation files directly — communicate only over HTTP via src/lib/api.ts.',
        }],
      }],
    },
  },
)
