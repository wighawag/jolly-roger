module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2020, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module', // Allows for the use of imports
  },
  env: {
    commonjs: true,
    browser: true,
    node: true,
    es6: true,
  },
  plugins: ['@typescript-eslint', 'svelte3'],
  extends: ['eslint:recommended', 'prettier'],
  overrides: [
    {
      files: ['**/*.svelte'],
      processor: 'svelte3/svelte3',
    },
    {
      files: ['**/*.ts', '**/*.svelte'],
      parser: '@typescript-eslint/parser',
      extends: [
        'plugin:@typescript-eslint/recommended',
        'prettier/@typescript-eslint',
      ],
    },
  ],
  rules: {
    'no-empty': 'off',
  },
};
