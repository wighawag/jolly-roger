import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'custom',
			customProviderModule: 'vitest-solidity-coverage',
		},
	},
});
