const fs = require('fs');

// ---------------------------------------------------
// from env file but we wrap in double quote the strings
// ---------------------------------------------------
// const { parse, stringify } = require('envfile')
/** Parse an envfile string. */
function parse(src) {
	const result = {}
	const lines = src.toString().split('\n')
	for (const line of lines) {
		const match = line.match(/^([^=:#]+?)[=:](.*)/)
		if (match) {
			const key = match[1].trim()
			const value = match[2].trim().replace(/['"]+/g, '')
			result[key] = value
		}
	}
	return result
}
/** Turn an object into an envfile string. */
function stringify(obj) {
	let result = ''
	for (const [key, value] of Object.entries(obj)) {
		if (key) {
			const line = `${key}="${String(value)}"`
			result += line + '\n'
		}
	}
	return result
}
// ---------------------------------------------------

const contractInfos = JSON.parse(fs.readFileSync('contracts.json', 'utf-8'));
if (contractInfos.contracts.Time?.address) {
	const parsedDevVars = parse(fs.readFileSync('.env', 'utf-8'));
	parsedDevVars.CONTRACT_TIMESTAMP = contractInfos.contracts.Time.address;
	fs.writeFileSync('.env', stringify(parsedDevVars));
}
