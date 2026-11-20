import type {PublicClient, Transaction} from 'viem';

/**
 * Transaction summary structure for the transaction list
 */
export interface TransactionSummary {
	hash: string;
	blockNumber: bigint;
	from: string;
	to: string | null;
	value: bigint;
	type: string;
	timestamp: number;
}

/**
 * Block index entry for localStorage optimization
 * Only stores blocks with transactions
 */
export interface BlockIndexEntry {
	blockNumber: number;
	txCount: number;
	timestamp: number;
}

/**
 * Block index summary
 */
export interface BlockIndexSummary {
	blocks: number[];
	totalTxs: number;
	lastUpdated: number;
}

/**
 * LocalStorage key generators for block index
 */
function getLatestScannedBlockKey(chainId: number): string {
	return `explorer:latestScannedBlock:${chainId}`;
}

function getBlockIndexEntryKey(
	chainId: number,
	blockNumber: bigint | number,
): string {
	return `explorer:blockIndex:${chainId}:${Number(blockNumber)}`;
}

function getBlockIndexSummaryKey(chainId: number): string {
	return `explorer:blockIndexSummary:${chainId}`;
}

/**
 * Load the latest scanned block number from localStorage
 */
function loadLatestScannedBlock(chainId: number): number | null {
	if (typeof window === 'undefined') {
		return null;
	}
	try {
		const key = getLatestScannedBlockKey(chainId);
		const data = localStorage.getItem(key);
		if (data) {
			const parsed = JSON.parse(data);
			// Check if the entry is not too old (24 hours)
			const maxAge = 24 * 60 * 60 * 1000;
			if (Date.now() - parsed.timestamp < maxAge) {
				return parsed.blockNumber;
			}
		}
	} catch (e) {
		console.warn('Failed to load latest scanned block from localStorage:', e);
	}
	return null;
}

/**
 * Save the latest scanned block number to localStorage
 */
function saveLatestScannedBlock(chainId: number, blockNumber: bigint): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		const key = getLatestScannedBlockKey(chainId);
		const data = {
			blockNumber: Number(blockNumber),
			timestamp: Date.now(),
		};
		localStorage.setItem(key, JSON.stringify(data));
	} catch (e) {
		console.warn('Failed to save latest scanned block to localStorage:', e);
	}
}

/**
 * Load block index from localStorage
 * Only blocks with transactions are stored
 */
function loadBlockIndex(chainId: number): Map<number, BlockIndexEntry> {
	if (typeof window === 'undefined') {
		return new Map();
	}
	try {
		const summaryKey = getBlockIndexSummaryKey(chainId);
		const summaryData = localStorage.getItem(summaryKey);

		if (!summaryData) {
			return new Map();
		}

		const summary: BlockIndexSummary = JSON.parse(summaryData);
		const index = new Map<number, BlockIndexEntry>();

		// Only load blocks that are not too old (24 hours)
		const maxAge = 24 * 60 * 60 * 1000;
		const now = Date.now();

		for (const blockNumber of summary.blocks) {
			try {
				const entryKey = getBlockIndexEntryKey(chainId, blockNumber);
				const entryData = localStorage.getItem(entryKey);

				if (entryData) {
					const entry: BlockIndexEntry = JSON.parse(entryData);
					if (now - entry.timestamp < maxAge) {
						index.set(blockNumber, entry);
					}
				}
			} catch (e) {
				// Skip invalid entries
			}
		}

		return index;
	} catch (e) {
		console.warn('Failed to load block index from localStorage:', e);
		return new Map();
	}
}

/**
 * Save a block index entry to localStorage
 * Only saves blocks with transactions (txCount > 0)
 */
function saveBlockIndexEntry(chainId: number, entry: BlockIndexEntry): void {
	if (typeof window === 'undefined') {
		return;
	}

	// Only save blocks with transactions
	if (entry.txCount === 0) {
		return;
	}

	try {
		const entryKey = getBlockIndexEntryKey(chainId, entry.blockNumber);
		localStorage.setItem(entryKey, JSON.stringify(entry));
	} catch (e) {
		console.warn('Failed to save block index entry to localStorage:', e);
	}
}

/**
 * Update block index summary
 */
function updateBlockIndexSummary(chainId: number, blocks: number[]): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		const summaryKey = getBlockIndexSummaryKey(chainId);

		// Calculate total txs from stored entries
		let totalTxs = 0;
		const maxAge = 24 * 60 * 60 * 1000;
		const now = Date.now();

		for (const blockNumber of blocks) {
			try {
				const entryKey = getBlockIndexEntryKey(chainId, blockNumber);
				const entryData = localStorage.getItem(entryKey);
				if (entryData) {
					const entry: BlockIndexEntry = JSON.parse(entryData);
					if (now - entry.timestamp < maxAge) {
						totalTxs += entry.txCount;
					}
				}
			} catch (e) {
				// Skip invalid entries
			}
		}

		const summary: BlockIndexSummary = {
			blocks,
			totalTxs,
			lastUpdated: now,
		};

		localStorage.setItem(summaryKey, JSON.stringify(summary));
	} catch (e) {
		console.warn('Failed to update block index summary to localStorage:', e);
	}
}

/**
 * Prune old block index entries (older than maxAge)
 */
function pruneBlockIndex(
	chainId: number,
	maxAge: number = 24 * 60 * 60 * 1000,
): void {
	if (typeof window === 'undefined') {
		return;
	}
	try {
		const summaryKey = getBlockIndexSummaryKey(chainId);
		const summaryData = localStorage.getItem(summaryKey);

		if (!summaryData) {
			return;
		}

		const summary: BlockIndexSummary = JSON.parse(summaryData);
		const now = Date.now();
		const validBlocks: number[] = [];

		for (const blockNumber of summary.blocks) {
			try {
				const entryKey = getBlockIndexEntryKey(chainId, blockNumber);
				const entryData = localStorage.getItem(entryKey);

				if (entryData) {
					const entry: BlockIndexEntry = JSON.parse(entryData);
					if (now - entry.timestamp < maxAge) {
						validBlocks.push(blockNumber);
					} else {
						// Remove old entry
						localStorage.removeItem(entryKey);
					}
				}
			} catch (e) {
				// Skip invalid entries
			}
		}

		// Update summary with valid blocks
		if (validBlocks.length !== summary.blocks.length) {
			updateBlockIndexSummary(chainId, validBlocks);
		}
	} catch (e) {
		console.warn('Failed to prune block index:', e);
	}
}

/**
 * Calculate which blocks to fetch based on stored index
 * Only returns blocks known to have transactions
 */
export function calculateBlocksToFetch(
	index: Map<number, BlockIndexEntry>,
	latestBlock: number,
	targetTxs: number,
): number[] {
	const blocksToFetch: number[] = [];
	let totalTxs = 0;

	// Get sorted block numbers (descending)
	const sortedBlocks = Array.from(index.keys()).sort((a, b) => b - a);

	for (const blockNumber of sortedBlocks) {
		// Only consider blocks up to latest block
		if (blockNumber > latestBlock) {
			continue;
		}

		const entry = index.get(blockNumber);
		if (entry) {
			blocksToFetch.push(blockNumber);
			totalTxs += entry.txCount;

			if (totalTxs >= targetTxs) {
				break;
			}
		}
	}

	return blocksToFetch;
}

/**
 * Convert a block's transactions to TransactionSummary format
 */
export function blockToTransactionSummaries(block: {
	number: bigint;
	timestamp: bigint | number;
	transactions: Transaction[];
}): TransactionSummary[] {
	// Ethereum block timestamps are in seconds (Unix timestamp)
	const blockTimestamp =
		typeof block.timestamp === 'bigint'
			? Number(block.timestamp)
			: block.timestamp;

	return block.transactions.map((tx) => ({
		hash: tx.hash,
		blockNumber: block.number,
		from: tx.from,
		to: tx.to || null,
		value: tx.value,
		type: tx.type.toString(),
		timestamp: blockTimestamp,
	}));
}

/**
 * Scan blocks in parallel batches
 */
export async function scanBlocksInBatches(
	publicClient: PublicClient,
	blockNumbers: bigint[],
	batchSize: number,
): Promise<TransactionSummary[]> {
	const allTransactions: TransactionSummary[] = [];

	// Process blocks in batches
	for (let i = 0; i < blockNumbers.length; i += batchSize) {
		const batch = blockNumbers.slice(i, i + batchSize);

		// Fetch blocks in parallel
		const blockPromises = batch.map((blockNumber) =>
			publicClient.getBlock({
				blockNumber,
				includeTransactions: true,
			}),
		);

		const blocks = await Promise.all(blockPromises);

		// Extract transactions from each block
		for (const block of blocks) {
			const txs = blockToTransactionSummaries(block);
			allTransactions.push(...txs);
		}
	}

	// Sort by block number (newest first)
	allTransactions.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

	return allTransactions;
}

/**
 * Standard mode: Scan blocks without using index
 */
async function scanBlocksStandard(
	publicClient: PublicClient,
	targetCount: number,
	batchSize: number,
	maxBlocksToScan: number,
): Promise<{transactions: TransactionSummary[]; scannedBlocks: bigint[]}> {
	// Get latest block number
	const latestBlock = await publicClient.getBlockNumber();

	// Calculate how many blocks to scan (scan backwards from latest)
	const startBlock =
		latestBlock - BigInt(maxBlocksToScan) < 0n
			? 0n
			: latestBlock - BigInt(maxBlocksToScan);

	// Create array of block numbers to scan (descending order)
	const blockNumbers: bigint[] = [];
	for (let b = latestBlock; b > startBlock; b--) {
		blockNumbers.push(b);
	}

	// Scan blocks in batches
	const transactions = await scanBlocksInBatches(
		publicClient,
		blockNumbers,
		batchSize,
	);

	// Return only targetCount transactions
	return {
		transactions: transactions.slice(0, targetCount),
		scannedBlocks: blockNumbers,
	};
}

/**
 * Optimized mode: Scan blocks using localStorage index
 */
async function scanBlocksWithIndex(
	chainId: number,
	publicClient: PublicClient,
	targetCount: number,
	batchSize: number,
	maxBlocksToScan: number,
): Promise<{transactions: TransactionSummary[]; scannedBlocks: bigint[]}> {
	// Get latest block number
	const latestBlock = await publicClient.getBlockNumber();

	// Load latest scanned block from localStorage
	const latestScannedBlock = loadLatestScannedBlock(chainId);

	// Load block index
	const blockIndex = loadBlockIndex(chainId);

	// Calculate which blocks to fetch based on index
	let blocksToFetch: number[] = [];

	if (latestScannedBlock !== null && blockIndex.size > 0) {
		// We have some index data
		blocksToFetch = calculateBlocksToFetch(
			blockIndex,
			Number(latestBlock),
			targetCount,
		);

		// Check if we need to scan newer blocks
		if (Number(latestBlock) > latestScannedBlock) {
			// Scan new blocks from latestScannedBlock + 1 to latestBlock
			const newBlocks: number[] = [];
			for (let b = Number(latestBlock); b > latestScannedBlock; b--) {
				newBlocks.push(b);
			}
			blocksToFetch = [...newBlocks, ...blocksToFetch];
		}
	} else {
		// No index data, fall back to standard scanning
		const startBlock =
			latestBlock - BigInt(maxBlocksToScan) < 0n
				? 0n
				: latestBlock - BigInt(maxBlocksToScan);

		for (let b = latestBlock; b > startBlock; b--) {
			blocksToFetch.push(Number(b));
		}
	}

	// Fetch blocks in parallel
	const blockNumbers: bigint[] = blocksToFetch.map((b) => BigInt(b));
	const transactions = await scanBlocksInBatches(
		publicClient,
		blockNumbers,
		batchSize,
	);

	// Update index with newly scanned blocks (only blocks with transactions)
	if (typeof window !== 'undefined') {
		const newEntries: BlockIndexEntry[] = [];
		const now = Date.now();

		for (const tx of transactions) {
			const blockNumber = Number(tx.blockNumber);
			// Check if we already have this block
			if (!blockIndex.has(blockNumber)) {
				// Count transactions in this block
				const txsInBlock = transactions.filter(
					(t) => Number(t.blockNumber) === blockNumber,
				);
				newEntries.push({
					blockNumber,
					txCount: txsInBlock.length,
					timestamp: now,
				});
				blockIndex.set(blockNumber, {
					blockNumber,
					txCount: txsInBlock.length,
					timestamp: now,
				});
			}
		}

		// Save new entries
		for (const entry of newEntries) {
			saveBlockIndexEntry(chainId, entry);
		}

		// Update summary
		const allBlocks = Array.from(blockIndex.keys()).sort((a, b) => b - a);
		updateBlockIndexSummary(chainId, allBlocks);

		// Save latest scanned block
		saveLatestScannedBlock(chainId, latestBlock);

		// Prune old entries
		pruneBlockIndex(chainId);
	}

	// Return only targetCount transactions
	return {
		transactions: transactions.slice(0, targetCount),
		scannedBlocks: blockNumbers,
	};
}

/**
 * Main function to scan latest transactions
 * @param publicClient - The viem public client
 * @param targetCount - Number of transactions to retrieve (default: 20)
 * @param batchSize - Number of blocks to fetch in parallel (default: 5)
 * @param maxBlocksToScan - Maximum number of blocks to scan (default: 100)
 * @param useIndex - Whether to use localStorage index optimization (default: false);
 *   the index is kept per chain, the client's (its `chain`, else `getChainId()`)
 * @returns Array of transaction summaries
 */
export async function scanLatestTransactions(
	publicClient: PublicClient,
	targetCount: number = 20,
	batchSize: number = 5,
	maxBlocksToScan: number = 100,
	useIndex: boolean = false,
): Promise<TransactionSummary[]> {
	if (useIndex) {
		// The client's own chain, so the index can never mix two chains' blocks
		// under one key.
		const chainId = publicClient.chain?.id ?? (await publicClient.getChainId());
		const result = await scanBlocksWithIndex(
			chainId,
			publicClient,
			targetCount,
			batchSize,
			maxBlocksToScan,
		);
		return result.transactions;
	} else {
		const result = await scanBlocksStandard(
			publicClient,
			targetCount,
			batchSize,
			maxBlocksToScan,
		);
		return result.transactions;
	}
}
