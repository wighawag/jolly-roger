import {defineConfig} from 'tsup';
// @ts-ignore
import * as fs from 'fs';
// @ts-ignore
import * as crypto from 'crypto';

const outDir = 'dist';
function transform(filepath: string, versionHash?: string): string {
	const content = fs.readFileSync(filepath, 'utf-8');
	const hash = versionHash || crypto.createHash('sha256').update(content, 'utf8').digest('hex');
	const newContent = content.replace('__VERSION_HASH__', hash);
	fs.writeFileSync(filepath, newContent);
	return hash;
}

export default defineConfig({
	outDir,
	async onSuccess() {
		const hash = transform(`${outDir}/index.js`);
		const cjs = `${outDir}/index.cjs`;
		const dts = `${outDir}/index.d.ts`;
		if (fs.existsSync(cjs)) {
			transform(cjs, hash);
		}
		if (fs.existsSync(dts)) {
			transform(dts, hash);
		}
	},
});
