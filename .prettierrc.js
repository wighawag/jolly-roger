module.exports = {
  singleQuote: true,
  bracketSpacing: false,
  printWidth: 120,
  overrides: [
    {
      files: '*.sol',
      options: {
        tabWidth: 4,
        singleQuote: false,
        explicitTypes: 'always',
      },
    },
  ],
};
