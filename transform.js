// @ts-check
import fs from 'fs';
import path from 'path';

/**
 * @typedef RemoveAction
 * @type {object}
 * @property {string[]} files - files to remove
 * @property {"remove"} action - remove action
 */

/**
 * @typedef DegitConf
 * @type {RemoveAction[]}
 */

/** @type {DegitConf | undefined} */
let degit;
try {
	degit = JSON.parse(fs.readFileSync('degit.json', 'utf-8'));
} catch {}
// if (degit) {
// 	for (const action of degit) {
// 		if (action.action === 'remove') {
// 			const filesToRemove = action.files;
// 			for (const file of filesToRemove) {
// 				try {
// 					fs.rmSync(file, {recursive: true});
// 				} catch {}
// 			}
// 		}
// 	}
// }

const ignore_folders = [
	'.git',
	'node_modules',
	'contracts/out',
	'contracts/cache',
	'contracts/generated',
	'contracts/lib',
	'web/.svelte-kit',
	'web/build',
	'indexer/dist',
];
/**
 * @param {string} filepath - folder
 * @param {string | undefined} parent - root to get path relative to
 * @param {string[]} results - list of files to start with
 */
function files(filepath, parent = undefined, results = []) {
	if (ignore_folders.indexOf(filepath) >= 0) {
		return [];
	}

	const actual_parent = parent || '.';
	const actual_path = path.join(actual_parent, filepath);

	if (ignore_folders.indexOf(actual_path) >= 0) {
		return [];
	}

	try {
		const stats = fs.statSync(actual_path);
		if (stats.isDirectory()) {
			const list = fs.readdirSync(actual_path);
			for (const file of list) {
				files(file, actual_path, results);
			}
		} else {
			results.push(actual_path);
		}
	} catch (err) {
		console.error({err, filepath, parent, actual_path, actual_parent, results});
		throw err;
	}
	return results;
}

const filesToProcess = files('.');

for (const file of filesToProcess) {
	if (file.endsWith('-degit') || file.indexOf('-degit.') >= 0) {
		const orginal_file = file.replace('-degit', '');
		console.log(`overriding ${orginal_file} with ${file}`);
		// try {
		// 	const stats = fs.statSync(file);
		// 	try {
		// 		fs.rmSync(orginal_file);
		// 	} catch {}
		// 	if (stats.isDirectory()) {
		// 		fs.cpSync(file, orginal_file);
		// 	} else {
		// 		fs.copyFileSync(file, orginal_file);
		// 	}
		// } catch (err) {
		// 	console.error({
		// 		file,
		// 		orginal_file,
		// 	});
		// 	throw err;
		// } finally {
		// 	fs.rmSync(file);
		// }
	}
}
