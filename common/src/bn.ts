// TODO share with ethereum-indexer db-utils etc...
export function bnReplacer(k: string, v: any): any {
	if (typeof v === 'bigint') {
		return v.toString() + 'n';
	}
	return v;
}

export function bnReviver(k: string, v: any): any {
	if (
		typeof v === 'string' &&
		(v.startsWith('-') ? !isNaN(parseInt(v.charAt(1))) : !isNaN(parseInt(v.charAt(0)))) &&
		v.charAt(v.length - 1) === 'n'
	) {
		return BigInt(v.slice(0, -1));
	}
	return v;
}
