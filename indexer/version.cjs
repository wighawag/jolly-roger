const fs = require('fs');
const crypto = require('crypto');

const args = process.argv.slice(2);
const filepath = args[0];

function transform(filepath, versionHash) {
	try {
		const content = fs.readFileSync(filepath, 'utf-8');
		const hash = versionHash || crypto.createHash('sha256').update(content, 'utf8').digest('hex');
		const newContent = content.replace('__VERSION_HASH__', hash);
		fs.writeFileSync(filepath, newContent);
		return hash;
	} catch (e) {
		console.error(e.message);
	}
}

if (fs.statSync(filepath).isDirectory) {
	const hash = transform(`${filepath}/index.js`);
	transform(`${filepath}/index.cjs`, hash);
	transform(`${filepath}/index.d.ts`, hash);
} else {
	transform(filepath);
}
