module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
  ],
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'off', // TypeScript handles this
    'prefer-const': 'error',
    'no-var': 'error',
  },
  env: {
    node: true,
    es2020: true,
    mocha: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'artifacts/',
    'cache/',
    'typechain-types/',
    'coverage/',
  ],
};