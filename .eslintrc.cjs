module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'import', 'security'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:security/recommended-legacy',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'import/order': ['warn', { 'newlines-between': 'never' }],
    'no-console': 'off',
    'security/detect-object-injection': 'off',
    'security/detect-non-literal-fs-filename': 'off',
  },
  overrides: [
    {
      // Test harness runs on plain Node in a CommonJS package, so require() is
      // the only module syntax available to it.
      files: ['tests/**/*.js'],
      parserOptions: { sourceType: 'script' },
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs', '.claude/'],
};
