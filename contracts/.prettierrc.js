module.exports = {
  singleQuote: true,
  bracketSpacing: false,
  printWidth: 120,
  overrides: [
    {
      files: '*.sol',
      options: {
        parser: 'solidity-parse', // needed, see https://github.com/sveltejs/prettier-plugin-svelte/issues/155#issuecomment-831166730
        printWidth: 120,
        tabWidth: 4,
        singleQuote: false,
        explicitTypes: 'always',
      },
    },
  ],
  plugins: [require.resolve('prettier-plugin-solidity')],
};
