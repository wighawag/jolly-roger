module.exports = {
  singleQuote: true,
  bracketSpacing: false,
  printWidth: 120,
  overrides: [
    {
      files: '*.svelte',
      options: {
        parser: 'svelte', // needed, see https://github.com/sveltejs/prettier-plugin-svelte/issues/155#issuecomment-831166730
      },
    },
  ],
  plugins: [require.resolve('prettier-plugin-svelte')],
};
