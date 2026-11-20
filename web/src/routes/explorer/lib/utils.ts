import type {Abi, Address, Log, Transaction, TransactionReceipt} from 'viem';
import {decodeEventLog} from 'viem';
import {
	formatGas,
	formatGasPrice,
	formatValue,
	toPlainJson,
	truncateHex,
} from '$lib/core/utils/format';

export {formatGas, formatGasPrice, formatValue};

export interface ContractInfo {
	name: string;
	address: string;
	abi: Abi;
}

export interface DecodedEvent {
	eventName: string;
	signature: string;
	args: Record<string, unknown> | unknown[];
	address: Address;
	blockNumber: bigint;
	txHash: string;
}

/**
 * The contracts to decode with, by name: the shape of jolly-roger's
 * `deployments.get().contracts`, which its callers pass, read at call time
 */
export type DecodingContracts = Record<string, {address: string; abi: unknown}>;

/**
 * Find a contract of `contracts` by address
 */
export function findContractByAddress(
	address: Address,
	contracts: DecodingContracts,
): ContractInfo | null {
	for (const [name, contract] of Object.entries(contracts)) {
		if (contract.address.toLowerCase() === address.toLowerCase()) {
			return {
				name,
				address: contract.address,
				abi: contract.abi as Abi,
			};
		}
	}
	return null;
}

/**
 * Decode a single log using ABI
 */
function decodeLogWithAbi(log: Log, abi: Abi): DecodedEvent | null {
	try {
		// Try to decode the log
		const decoded = decodeEventLog({
			abi,
			data: log.data,
			topics: log.topics as any,
		});

		return {
			eventName: decoded.eventName ?? 'Unknown Event',
			signature: log.topics[0] ?? '0x0',
			// Decoded args can contain bigints, which JSON.stringify throws on;
			// toPlainJson converts them to decimal strings.
			args: toPlainJson(decoded.args ?? {}),
			address: log.address,
			blockNumber: log.blockNumber ?? 0n,
			txHash: log.transactionHash ?? '0x0',
		};
	} catch (e) {
		// Decoding failed, return null
		return null;
	}
}

/**
 * Decode logs with the ABIs of `contracts`
 */
export function decodeLogs(
	logs: Log[],
	contracts: DecodingContracts,
): DecodedEvent[] {
	const decodedEvents: DecodedEvent[] = [];

	for (const log of logs) {
		const contractInfo = findContractByAddress(log.address, contracts);
		if (contractInfo) {
			const decoded = decodeLogWithAbi(log, contractInfo.abi);
			if (decoded) {
				decodedEvents.push(decoded);
			}
		}
	}

	return decodedEvents;
}

/**
 * Format transaction status
 */
export function formatTxStatus(status: 'success' | 'reverted'): string {
	return status === 'success' ? 'Success' : 'Failed';
}

/** Is the value a full transaction hash (0x + 64 hex)? */
export function isValidTxHash(value: string): boolean {
	return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

/** Is the value a full address (0x + 40 hex)? */
export function isValidAddress(value: string): boolean {
	return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export type SearchClassification =
	| {kind: 'empty'}
	| {kind: 'tx'; value: string}
	| {kind: 'address'; value: string}
	| {kind: 'invalid'};

/**
 * Classify an explorer search box value into where it should navigate.
 */
export function classifySearchInput(raw: string): SearchClassification {
	const trimmed = raw.trim();
	if (!trimmed) return {kind: 'empty'};
	if (isValidTxHash(trimmed)) return {kind: 'tx', value: trimmed};
	if (isValidAddress(trimmed)) return {kind: 'address', value: trimmed};
	return {kind: 'invalid'};
}

export interface Eip1559FeeInfo {
	isEIP1559: boolean;
	maxPriorityFeePerGas: bigint | null;
	maxFeePerGas: bigint | null;
	effectiveGasPrice: bigint | null;
	/** effectiveGasPrice - maxPriorityFeePerGas, when both are known. */
	baseFeeUsed: bigint | null;
}

/**
 * Derive EIP-1559 fee display info from a transaction and its (optional)
 * receipt. Shared by the transaction list item and the transaction detail view
 * so the fee math lives in one place.
 */
export function getEip1559FeeInfo(
	tx: Transaction,
	receipt: TransactionReceipt | null,
): Eip1559FeeInfo {
	const isEIP1559 = tx.type === 'eip1559';
	const maxPriorityFeePerGas =
		isEIP1559 && 'maxPriorityFeePerGas' in tx
			? (tx.maxPriorityFeePerGas as bigint)
			: null;
	const maxFeePerGas =
		isEIP1559 && 'maxFeePerGas' in tx ? (tx.maxFeePerGas as bigint) : null;
	const effectiveGasPrice = receipt?.effectiveGasPrice ?? null;
	// The actual priority fee paid is min(maxPriorityFeePerGas, maxFeePerGas -
	// baseFee); this is the base fee implied by the effective price.
	const baseFeeUsed =
		effectiveGasPrice !== null && maxPriorityFeePerGas !== null
			? effectiveGasPrice - maxPriorityFeePerGas
			: null;

	return {
		isEIP1559,
		maxPriorityFeePerGas,
		maxFeePerGas,
		effectiveGasPrice,
		baseFeeUsed,
	};
}

/**
 * Check if address is a contract (has code)
 */
export function isContract(code: `0x${string}`): boolean {
	return code !== '0x' && code.length > 2;
}

/**
 * Format bytecode for display
 */
export function formatBytecode(
	code: `0x${string}`,
	maxLength: number = 200,
): string {
	if (code.length <= maxLength) {
		return code;
	}
	return `${code.slice(0, maxLength)}... (${code.length} bytes)`;
}

/**
 * Get all unique addresses from logs
 */
export function getLogAddresses(logs: Log[]): Address[] {
	const addresses = new Set<Address>();
	for (const log of logs) {
		addresses.add(log.address);
	}
	return Array.from(addresses);
}

/**
 * Format transaction type for display
 */
export function formatTransactionType(type: string): string {
	const typeMap: Record<string, string> = {
		'0x0': 'Legacy',
		'0x1': 'EIP-2930',
		'0x2': 'EIP-1559',
	};
	return typeMap[type] || type;
}

/**
 * Truncate transaction hash for display
 */
export function truncateTxHash(hash: string, length: number = 8): string {
	return truncateHex(hash, {start: length, end: 4});
}

/**
 * Get transaction type icon component name
 */
export function getTransactionTypeIcon(type: string): string {
	if (type === '0x2' || type === 'EIP-1559') {
		return 'ZapIcon';
	}
	return 'FileTextIcon';
}

/**
 * Format timestamp to readable date/time (relative)
 */
export function formatTimestamp(timestamp: number): string {
	if (!timestamp) {
		return 'Unknown';
	}

	const date = new Date(timestamp * 1000);
	const now = new Date();
	const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

	// If less than a minute ago
	if (diffInSeconds < 60) {
		return 'Just now';
	}

	// If less than an hour ago
	if (diffInSeconds < 3600) {
		const minutes = Math.floor(diffInSeconds / 60);
		return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
	}

	// If less than a day ago
	if (diffInSeconds < 86400) {
		const hours = Math.floor(diffInSeconds / 3600);
		return `${hours} hour${hours > 1 ? 's' : ''} ago`;
	}

	// If less than a week ago
	if (diffInSeconds < 604800) {
		const days = Math.floor(diffInSeconds / 86400);
		return `${days} day${days > 1 ? 's' : ''} ago`;
	}

	// Otherwise, return the full date
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

/**
 * Format timestamp to precise date and time
 * Returns full date with time in local timezone
 */
export function formatPreciseTimestamp(timestamp: number): string {
	if (!timestamp) {
		return 'Unknown';
	}

	const date = new Date(timestamp * 1000);

	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZoneName: 'short',
	});
}
