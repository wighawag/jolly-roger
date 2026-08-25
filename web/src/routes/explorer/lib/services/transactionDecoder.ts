// `toPlainJson`, not `JSON.parse(JSON.stringify(...))`. Viem decodes every
// uint/int as a bigint, and plain stringify THROWS on one - inside the catch
// below, so the failure was silent: any call with a numeric argument simply
// came back undecoded, which looks like an ABI mismatch and is not.
import {toPlainJson} from '$lib/core/utils/format/json';
import type {Abi, Transaction, TransactionReceipt, PublicClient} from 'viem';
import {
	decodeFunctionData,
	decodeErrorResult,
	decodeAbiParameters,
	BaseError,
	ContractFunctionRevertedError,
} from 'viem';
import {deployments} from '$lib/deployments-store';

/**
 * Contract info for decoding
 */
export interface ContractInfo {
	name: string;
	address: string;
	abi: Abi;
}

/**
 * Decoded error data structure
 */
export interface DecodedErrorData {
	errorName: string;
	args?: Record<string, unknown> | unknown[];
	signature?: string;
	rawData?: `0x${string}`;
}

/**
 * Decoded transaction data structure
 */
export interface DecodedTransactionData {
	functionName?: string;
	contractName?: string;
	args?: Record<string, unknown> | unknown[];
	isDecoded: boolean;
	status: 'success' | 'failed' | 'pending';
	error?: string;
	decodedError?: DecodedErrorData;
}

/**
 * Format options for decoded transaction display
 */
export interface FormattedDecodedTransaction {
	methodLabel: string;
	methodDetails?: string;
	statusText: string;
}

/**
 * Find contract in deployments by address
 */
function findContractByAddress(address: `0x${string}`): ContractInfo | null {
	const contracts = deployments.get().contracts;
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
 * Decode transaction function call data using ABI
 */
function decodeFunctionCall(
	tx: Transaction,
	abi: Abi,
): {
	functionName?: string;
	args?: Record<string, unknown> | unknown[];
} | null {
	try {
		// Try to decode the function call
		const decoded = decodeFunctionData({
			abi,
			data: tx.input,
		});

		return {
			functionName: decoded.functionName,
			args: decoded.args ? toPlainJson(decoded.args) : undefined,
		};
	} catch (e) {
		// Decoding failed
		return null;
	}
}

/**
 * Try to decode error data using ABI
 */
function tryDecodeError(
	data: `0x${string}`,
	abi: Abi,
): DecodedErrorData | null {
	try {
		const decoded = decodeErrorResult({
			abi,
			data,
		});
		return {
			errorName: decoded.errorName,
			args: decoded.args ? toPlainJson(decoded.args) : undefined,
			rawData: data,
		};
	} catch {
		return null;
	}
}

/**
 * Parse standard revert reason from error data
 * Standard revert reason starts with 0x08c379a0 (Error(string) selector)
 */
export function parseStandardRevertReason(data: `0x${string}`): string | null {
	// Error(string) selector
	const errorSelector = '0x08c379a0';
	if (!data.startsWith(errorSelector)) {
		return null;
	}

	try {
		// Decode the ABI-encoded string that follows the 4-byte selector. viem
		// honours the ABI offset and decodes UTF-8 correctly (the previous
		// hand-rolled parse assumed offset 0x20 and mangled multi-byte chars).
		const [reason] = decodeAbiParameters(
			[{type: 'string'}],
			`0x${data.slice(10)}`,
		);
		return reason;
	} catch {
		return null;
	}
}

/**
 * Parse Panic(uint256) error code
 * Panic errors start with 0x4e487b71
 */
export function parsePanicError(data: `0x${string}`): DecodedErrorData | null {
	const panicSelector = '0x4e487b71';
	if (!data.startsWith(panicSelector)) {
		return null;
	}

	try {
		const [codeBig] = decodeAbiParameters(
			[{type: 'uint256'}],
			`0x${data.slice(10)}`,
		);
		const code = Number(codeBig);

		const panicMessages: Record<number, string> = {
			0x00: 'Generic compiler panic',
			0x01: 'Assertion failed',
			0x11: 'Arithmetic overflow/underflow',
			0x12: 'Division or modulo by zero',
			0x21: 'Invalid enum value',
			0x22: 'Storage byte array incorrectly encoded',
			0x31: 'pop() on empty array',
			0x32: 'Array index out of bounds',
			0x41: 'Memory allocation overflow',
			0x51: 'Zero-initialized function pointer call',
		};

		return {
			errorName: 'Panic',
			args: {
				code,
				message: panicMessages[code] || `Unknown panic code: ${code}`,
			},
			rawData: data,
		};
	} catch {
		return null;
	}
}

/**
 * Decode error from a failed transaction by replaying it
 */
async function decodeTransactionError(
	tx: Transaction,
	receipt: TransactionReceipt,
	publicClient: PublicClient,
	abi: Abi | null,
): Promise<{error?: string; decodedError?: DecodedErrorData}> {
	try {
		// Try to replay the transaction to get the revert reason
		await publicClient.call({
			account: tx.from,
			to: tx.to ?? undefined,
			data: tx.input,
			value: tx.value,
			gas: tx.gas,
			blockNumber: receipt.blockNumber,
		});

		// If call succeeded, we can't get the error (shouldn't happen for failed tx)
		return {error: 'Transaction failed but could not retrieve error reason'};
	} catch (e) {
		// Extract error data from the exception
		if (e instanceof BaseError) {
			// Check for ContractFunctionRevertedError which has decoded error info
			const revertError = e.walk(
				(err) => err instanceof ContractFunctionRevertedError,
			);
			if (revertError instanceof ContractFunctionRevertedError) {
				const reason = revertError.reason;
				if (reason) {
					return {
						error: reason,
						decodedError: {
							errorName: revertError.data?.errorName || 'Error',
							args: revertError.data?.args
								? toPlainJson(revertError.data.args)
								: undefined,
						},
					};
				}
			}

			// Try to extract raw error data
			const rawError = e.walk(
				(err) =>
					err !== null &&
					typeof err === 'object' &&
					'data' in err &&
					typeof (err as {data: unknown}).data === 'string',
			);
			if (
				rawError &&
				typeof rawError === 'object' &&
				'data' in rawError &&
				typeof (rawError as {data: unknown}).data === 'string'
			) {
				const errorData = rawError.data as `0x${string}`;

				// Try standard revert reason
				const standardReason = parseStandardRevertReason(errorData);
				if (standardReason) {
					return {
						error: standardReason,
						decodedError: {
							errorName: 'Error',
							args: {message: standardReason},
							rawData: errorData,
						},
					};
				}

				// Try panic error
				const panicError = parsePanicError(errorData);
				if (panicError) {
					const panicArgs = panicError.args as {code: number; message: string};
					return {
						error: `Panic: ${panicArgs.message}`,
						decodedError: panicError,
					};
				}

				// Try custom error decoding with ABI
				if (abi) {
					const decoded = tryDecodeError(errorData, abi);
					if (decoded) {
						return {
							error: formatDecodedError(decoded),
							decodedError: decoded,
						};
					}
				}

				// Return raw data if nothing else worked
				return {
					error: `Reverted with data: ${errorData.slice(0, 66)}${errorData.length > 66 ? '...' : ''}`,
					decodedError: {
						errorName: 'Unknown',
						rawData: errorData,
					},
				};
			}

			// Extract message from error
			return {error: e.shortMessage || e.message || 'Transaction reverted'};
		}

		// Generic error
		if (e instanceof Error) {
			return {error: e.message || 'Transaction reverted'};
		}

		return {error: 'Transaction failed with unknown error'};
	}
}

/**
 * Format a decoded error for display
 */
export function formatDecodedError(error: DecodedErrorData): string {
	if (!error.args) {
		return error.errorName;
	}

	if (Array.isArray(error.args)) {
		return `${error.errorName}(${error.args.map(formatArgValue).join(', ')})`;
	}

	const entries = Object.entries(error.args);
	if (entries.length === 0) {
		return error.errorName;
	}

	return `${error.errorName}(${entries.map(([k, v]) => `${k}: ${formatArgValue(v)}`).join(', ')})`;
}

/**
 * Get transaction status from receipt
 */
function getTransactionStatus(
	receipt: TransactionReceipt | null,
): 'success' | 'failed' | 'pending' {
	if (!receipt) {
		return 'pending';
	}
	return receipt.status === 'success' ? 'success' : 'failed';
}

/**
 * Main function to decode a transaction
 * @param tx - The transaction object
 * @param receipt - The transaction receipt (can be null for pending transactions)
 * @param publicClient - The viem public client
 * @returns Decoded transaction data
 */
export async function decodeTransaction(
	tx: Transaction,
	receipt: TransactionReceipt | null,
	publicClient: PublicClient,
): Promise<DecodedTransactionData> {
	const status = getTransactionStatus(receipt);

	// If no recipient, it's a contract creation
	if (!tx.to) {
		const result: DecodedTransactionData = {
			isDecoded: false,
			status,
			functionName: 'Contract Creation',
		};

		// If contract creation failed, try to decode the error
		if (status === 'failed' && receipt) {
			const errorInfo = await decodeTransactionError(
				tx,
				receipt,
				publicClient,
				null,
			);
			result.error = errorInfo.error;
			result.decodedError = errorInfo.decodedError;
		}

		return result;
	}

	// Try to find contract by address
	const contractInfo = findContractByAddress(tx.to);

	// If it's a simple transfer (no function data or no contract found)
	if (!contractInfo || tx.input === '0x' || tx.input === '0x0') {
		const result: DecodedTransactionData = {
			isDecoded: false,
			status,
		};

		// If simple transfer failed, try to decode the error
		if (status === 'failed' && receipt) {
			const errorInfo = await decodeTransactionError(
				tx,
				receipt,
				publicClient,
				null,
			);
			result.error = errorInfo.error;
			result.decodedError = errorInfo.decodedError;
		}

		return result;
	}

	// Try to decode the function call
	const decodedCall = decodeFunctionCall(tx, contractInfo.abi);

	if (decodedCall && decodedCall.functionName) {
		const result: DecodedTransactionData = {
			functionName: decodedCall.functionName,
			contractName: contractInfo.name,
			args: decodedCall.args,
			isDecoded: true,
			status,
		};

		// If transaction failed, try to decode the error
		if (status === 'failed' && receipt) {
			const errorInfo = await decodeTransactionError(
				tx,
				receipt,
				publicClient,
				contractInfo.abi,
			);
			result.error = errorInfo.error;
			result.decodedError = errorInfo.decodedError;
		}

		return result;
	}

	// Contract call but couldn't decode
	const result: DecodedTransactionData = {
		isDecoded: false,
		status,
	};

	// If transaction failed, try to decode the error
	if (status === 'failed' && receipt) {
		const errorInfo = await decodeTransactionError(
			tx,
			receipt,
			publicClient,
			contractInfo.abi,
		);
		result.error = errorInfo.error;
		result.decodedError = errorInfo.decodedError;
	}

	return result;
}

/**
 * Format decoded transaction for display
 * @param data - The decoded transaction data
 * @returns Formatted data for UI display
 */
export function formatDecodedTransaction(
	data: DecodedTransactionData,
): FormattedDecodedTransaction {
	let methodLabel = 'Contract Call';
	let methodDetails: string | undefined;

	if (data.isDecoded && data.functionName) {
		if (data.contractName) {
			methodLabel = `${data.contractName}.${data.functionName}`;
		} else {
			methodLabel = data.functionName;
		}

		if (data.args) {
			methodDetails = formatDecodedArgs(data.args);
		}
	} else if (!data.functionName) {
		methodLabel = 'Transfer';
	} else if (data.functionName === 'Contract Creation') {
		methodLabel = 'Contract Creation';
	}

	return {
		methodLabel,
		methodDetails,
		statusText:
			data.status === 'success'
				? 'Success'
				: data.status === 'failed'
					? 'Failed'
					: 'Pending',
	};
}

/**
 * Format decoded function arguments for display
 * @param args - The decoded arguments
 * @returns Formatted string representation
 */
export function formatDecodedArgs(
	args: Record<string, unknown> | unknown[],
): string {
	if (!args) {
		return '';
	}

	// If array (positional args)
	if (Array.isArray(args)) {
		if (args.length === 0) {
			return '()';
		}
		return `(${args.map((arg) => formatArgValue(arg)).join(', ')})`;
	}

	// If object (named args)
	const entries = Object.entries(args);
	if (entries.length === 0) {
		return '()';
	}

	return `(${entries.map(([key, value]) => `${key}: ${formatArgValue(value)}`).join(', ')})`;
}

/**
 * Format a single argument value for display
 * @param value - The argument value
 * @returns Formatted string representation
 */
export function formatArgValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value === undefined) {
		return 'undefined';
	}
	if (typeof value === 'string') {
		// Check if it's an address
		if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
			return `${value.slice(0, 6)}...${value.slice(-4)}`;
		}
		// Check if it's a hash
		if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
			return `${value.slice(0, 8)}...`;
		}
		// Regular string - truncate if too long
		if (value.length > 50) {
			return `"${value.slice(0, 30)}..."`;
		}
		return `"${value}"`;
	}
	if (typeof value === 'bigint') {
		return `${value.toString()}n`;
	}
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return '[Object]';
		}
	}
	return String(value);
}
