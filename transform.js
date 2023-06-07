// @ts-check
import path from 'path';
import fs from 'fs';
// import real_fs from 'fs';
// const fs = {
// 	writeFileSync(p, c) {
// 		console.log(`writeFilySync`, p);
// 	},
// 	rmSync(p, options) {
// 		console.log(`rmSync`, p);
// 	},
// 	cpSync(f, t) {
// 		console.log(`cpSync`, f, t);
// 	},
// 	existsSync(p) {
// 		return real_fs.existsSync(p);
// 	},
// 	statSync(p) {
// 		return real_fs.statSync(p);
// 	},
// 	readFileSync(p, options) {
// 		return real_fs.readFileSync(p, 'utf-8');
// 	},
// 	readdirSync(p) {
// 		return real_fs.readdirSync(p);
// 	},
// };

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
	degit = JSON.parse(fs.readFileSync('transform.json', 'utf-8'));
} catch {}
if (degit) {
	for (const action of degit) {
		if (action.action === 'remove') {
			const filesToRemove = action.files;
			for (const file of filesToRemove) {
				try {
					fs.rmSync(file, {recursive: true});
				} catch {}
			}
		}
	}
}

const doubleDashCommentsExtensions = ['.js', '.ts', '.sol'];
const htmlExtensions = ['.svelte', '.html'];
const ignore_folders = [
	'.git',
	'node_modules',
	'contracts/out',
	'contracts/cache',
	'contracts/artifacts',
	'contracts/coverage',
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
			if (actual_parent !== '.') {
				results.push(actual_path);
			}
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
	const basename = path.basename(file);
	if (basename === '.degit') {
		continue;
	}
	// console.log({basename});
	if (basename.startsWith('degit-')) {
		let orginal_file = file.replace('degit-', '');

		let is_directory = false;
		let content;
		try {
			const stats = fs.statSync(file);
			is_directory = stats.isDirectory();
			if (is_directory) {
				console.log({is_directory: file});
				const degit_file = path.join(file, '.degit');
				if (fs.existsSync(degit_file) && fs.statSync(degit_file).isFile()) {
					const relative = fs.readFileSync(degit_file, 'utf-8');
					orginal_file = path.join(file, relative);
					console.log(`.degit`, {orginal_file});
				}
			} else {
				content = fs.readFileSync(file, 'utf-8');
				const lines = content.split('\n');
				const firstLine = lines.shift();
				if (firstLine) {
					if (
						firstLine.startsWith('#degit:') ||
						firstLine.startsWith('//degit:') ||
						firstLine.startsWith('<!--degit:')
					) {
						if (firstLine.startsWith('#degit:')) {
							orginal_file = firstLine.slice(7);
						} else if (firstLine.startsWith('//degit:')) {
							orginal_file = firstLine.slice(8);
						} else if (firstLine.startsWith('<!-- degit:')) {
							const filename = firstLine.slice(11).split(' ').shift();
							if (filename) {
								orginal_file = filename;
							} else {
								throw new Error(`invalid file name in ${file}`);
							}
						}

						content = lines.join('\n');
					}
				}
			}
		} catch (err) {
			console.log({err});
		}

		console.log(`overriding ${orginal_file} with ${file}`);
		try {
			if (is_directory) {
				console.log({is_directory: file});
				const files_in_dir = files(file);
				for (const file_in_dir of files_in_dir) {
					if (path.basename(file_in_dir) === '.degit') {
						continue;
					}
					console.log({file_in_dir});
					const rel = path.relative(file, file_in_dir);
					try {
						fs.cpSync(path.join(file, rel), path.join(orginal_file, rel));
					} catch {}
				}
			} else {
				try {
					fs.rmSync(orginal_file);
				} catch {}
				if (content) {
					fs.writeFileSync(orginal_file, content);
				}
			}
		} catch (err) {
			console.error({
				file,
				orginal_file,
			});
			throw err;
		} finally {
			fs.rmSync(file, {recursive: true});
		}
	}
}

const second_phase_files = files('.');

for (const file of second_phase_files) {
	if (fs.existsSync(file) && fs.statSync(file).isFile()) {
		if (htmlExtensions.indexOf(path.extname(file)) >= 0) {
			const regex = /\s?<!--TEMPLATE_REMOVE-->.*?<!--TEMPLATE_REMOVE-->\n?/gms;
			const content = fs.readFileSync(file, 'utf-8');
			fs.writeFileSync(file, content.replace(regex, ''));
		} else if (doubleDashCommentsExtensions.indexOf(path.extname(file)) >= 0) {
			const regex = /\s?\/\/TEMPLATE_REMOVE.*?\/\/TEMPLATE_REMOVE\n?/gms;
			const content = fs.readFileSync(file, 'utf-8');
			fs.writeFileSync(file, content.replace(regex, ''));
		}
	}
}
