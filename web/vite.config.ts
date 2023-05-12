import {sveltekit} from '@sveltejs/kit/vite';
import {defineConfig} from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	//TEMPLATE_REMOVE
	build: {
		minify: false,
		sourcemap: true, // "inline" doe snot seem to allow step-by-step debugging
	},
	//TEMPLATE_REMOVE
});
