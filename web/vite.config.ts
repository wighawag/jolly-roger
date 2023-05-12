import {sveltekit} from '@sveltejs/kit/vite';
import {defineConfig} from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	//TEMPLATE_REMOVE
	build: {
		minify: false,
		sourcemap: 'inline',
	},
	//TEMPLATE_REMOVE
});
