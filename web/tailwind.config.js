/* eslint-disable @typescript-eslint/no-var-requires */
const defaultTheme = require('tailwindcss/defaultTheme');
const tailwindUI = require('@tailwindcss/ui');

module.exports = {
  purge: process.env.NODE_ENV === 'production' && {
    content: ['./src/**/*.svelte', './src/**/*.html', './src/**/*.css', './index.html'],
    options: {
      whitelistPatterns: [/svelte-/],
      defaultExtractor: (content) => {
        const regExp = new RegExp(/[A-Za-z0-9-_:/]+/g);
        const matchedTokens = [];
        let match = regExp.exec(content);
        while (match) {
          if (match[0].startsWith('class:')) {
            matchedTokens.push(match[0].substring(6));
          } else {
            matchedTokens.push(match[0]);
          }
          match = regExp.exec(content);
        }
        return matchedTokens;
      },
    },
  },
  variants: {
    backgroundColor: ['responsive', 'hover', 'focus', 'disabled'],
    // borderWidth: ['responsive', 'disabled'],
    borderColor: ['responsive', 'hover', 'focus', 'disabled'],
    cursor: ['responsive', 'disabled'],
  },
  future: {
    removeDeprecatedGapUtilities: true,
    purgeLayersByDefault: true,
  },
  experimental: 'all',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter var', ...defaultTheme.fontFamily.sans],
      },
      screens: {
        dark: {
          raw: '(prefers-color-scheme: dark)',
        },
        light: {
          raw: '(prefers-color-scheme: light)',
        },
      },
      inset: {
        '-15': '-3.75rem',
        2: '0.5rem',
      },
      zIndex: {
        '-10': '-10',
      },
    },
  },
  plugins: [
    tailwindUI({}),
    function ({addVariant, e}) {
      const variants = [
        {
          name: 'focus-not-active',
          rule: 'focus:not(:active)',
        },
        {
          name: 'not-first',
          css: 'not(:first-child)',
        },
        {
          name: 'not-last',
          css: 'not(:last-child)',
        },
      ];

      variants.forEach((variant) => {
        addVariant(variant.name, ({modifySelectors, separator}) => {
          modifySelectors(({className}) => {
            return `${variant.parent ? `${variant.parent} ` : ''}.${e(`${variant.name}${separator}${className}`)}${
              variant.rule ? `:${variant.rule}` : ''
            }`;
          });
        });
      });
    },
  ],
};
