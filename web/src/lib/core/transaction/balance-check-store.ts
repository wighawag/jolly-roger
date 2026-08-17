import {writable, get} from 'svelte/store';
import type {BalanceStore} from '$lib/core/connection/balance';
import type {GasFeeStore, GasPrice} from '$lib/core/connection/gasFee';
import type {
	Abi,
	PublicClient,
	ContractFunctionName,
	ContractFunctionArgs,
	WriteContractParameters,
	SendTransactionParameters,
} from 'viem';
import {InsufficientFundsError} from './InsufficientFundsError';
import type {Chain, Account} from 'viem';

export type BalanceCheckState =
	| {step: 'idle'}
	| {step: 'estimating'}
	| {
			step: 'insufficient';
			balanceStore: BalanceStore;
			/** The account that is short, so the UI can name it and target remedies. */
			sender: `0x${string}` | undefined;
			estimatedCost: bigint;
			onContinue: () => void;
			onDismiss: () => void;
			// Faucet tracking
			faucetClaimedAt?: number;
			preFaucetBalance?: bigint;
			isWaitingForBalanceUpdate: boolean;
	  };

export type GasSpeed = 'slow' | 'average' | 'fast';

export interface EnsureCanAffordOptions {
	gasSpeed?: GasSpeed;
	forceUpdate?: boolean;
	/**
	 * Balance of the account that will actually pay.
	 *
	 * Required, and per call rather than fixed at construction, because there is
	 * no longer one account that sends everything: a transaction from the local
	 * signer must be measured against the signer's gas, one from the user's
	 * account against theirs. Checking a single global balance was the bug this
	 * replaces - it would clear a transaction the sender could not afford, and
	 * pop the insufficient-funds modal about an account that was not paying.
	 */
	balance: BalanceStore;
	/**
	 * Address of that account.
	 *
	 * Carried alongside the balance so the modal can name WHO is short, and
	 * decide which remedies apply. The faucet funds one specific account, so
	 * offering it for a shortfall on a different one is worse than offering
	 * nothing: it appears to work, changes a balance nobody was waiting on, and
	 * the transaction fails anyway.
	 */
	sender: `0x${string}` | undefined;
}

export function createBalanceCheckStore({
	publicClient,
	gasFee,
}: {
	publicClient: PublicClient;
	gasFee: GasFeeStore;
}) {
	const {subscribe, set, update} = writable<BalanceCheckState>({step: 'idle'});

	let pollingInterval: NodeJS.Timeout | undefined;

	function stopPolling() {
		if (pollingInterval) {
			clearInterval(pollingInterval);
			pollingInterval = undefined;
		}
	}

	function startPolling(balanceStore: BalanceStore, preFaucetBalance: bigint) {
		stopPolling();

		pollingInterval = setInterval(() => {
			const currentBalance = get(balanceStore);
			if (currentBalance.step === 'Loaded') {
				if (currentBalance.value !== preFaucetBalance) {
					stopPolling();
					update((state) => {
						if (state.step === 'insufficient') {
							return {
								...state,
								isWaitingForBalanceUpdate: false,
								preFaucetBalance: undefined,
								faucetClaimedAt: undefined,
							};
						}
						return state;
					});
				}
			}
		}, 1000);

		setTimeout(() => {
			stopPolling();
			update((state) => {
				if (state.step === 'insufficient') {
					return {
						...state,
						isWaitingForBalanceUpdate: false,
						preFaucetBalance: undefined,
						faucetClaimedAt: undefined,
					};
				}
				return state;
			});
		}, 30000);
	}

	const startEstimating = () => set({step: 'estimating'});

	const showInsufficientFunds = (data: {
		balanceStore: BalanceStore;
		sender: `0x${string}` | undefined;
		estimatedCost: bigint;
		onContinue: () => void;
		onDismiss: () => void;
	}) =>
		set({
			step: 'insufficient',
			balanceStore: data.balanceStore,
			sender: data.sender,
			estimatedCost: data.estimatedCost,
			onContinue: data.onContinue,
			onDismiss: data.onDismiss,
			isWaitingForBalanceUpdate: false,
		});

	const close = () => {
		stopPolling();
		set({step: 'idle'});
	};

	/**
	 * Something has been done that should raise the blocked account's balance:
	 * start watching for it to move, and offer to continue once it does.
	 *
	 * Named for the effect rather than for the faucet, because there are now two
	 * remedies that produce it. A faucet claim funds the authenticated account; a
	 * top-up funds the local signer through the payment rail. The modal treats
	 * them identically from here on, and calling this `markFaucetClaimed` from the
	 * top-up path would describe the wrong one of the two.
	 *
	 * A no-op unless a transaction is actually blocked, so callers do not have to
	 * check first.
	 */
	const markFundingRequested = (preFaucetBalance: bigint) => {
		update((state) => {
			if (state.step === 'insufficient') {
				startPolling(state.balanceStore, preFaucetBalance);
				return {
					...state,
					faucetClaimedAt: Date.now(),
					preFaucetBalance,
					isWaitingForBalanceUpdate: true,
				};
			}
			return state;
		});
	};

	// Returns the fee PRICE pair (maxFeePerGas/maxPriorityFeePerGas) for a speed.
	// Distinct from `gasEstimate` below, which is the gas AMOUNT from eth_call.
	//
	// Not-yet-loaded is routine rather than broken, so it is waited on rather than
	// thrown at. The gas poller is gated on being able to read the chain (see
	// `chainFetchGate` in lib/context), so a transaction started from a
	// disconnected page resumes in the same tick the gate opens, with the first
	// fetch still in flight: sending from a cold start would otherwise go through
	// the whole connection flow and then die on "Gas fee not loaded", a race the
	// user can neither see nor retry their way out of. This mirrors what
	// `checkBalanceAndShowModal` already does for the balance.
	async function getGasPrice(speed: GasSpeed): Promise<GasPrice> {
		let gasFeeValue = get(gasFee);
		if (gasFeeValue.step !== 'Loaded') {
			gasFeeValue = await gasFee.update();
		}
		if (gasFeeValue.step !== 'Loaded') {
			// Waiting is not pretending: if the chain still will not price gas, the
			// transaction stops, in words rather than as an internal state name.
			throw new Error(
				'Could not read the current gas price from the chain. Check the connection and try again.',
			);
		}
		return gasFeeValue[speed];
	}

	async function checkBalanceAndShowModal(
		balance: BalanceStore,
		sender: `0x${string}` | undefined,
		estimatedCost: bigint,
	): Promise<void> {
		const balanceValue = get(balance);
		if (balanceValue.step !== 'Loaded') {
			await balance.update();
		}

		const currentBalance = get(balance);
		if (currentBalance.step !== 'Loaded') {
			throw new Error('Could not load balance');
		}

		if (currentBalance.value >= estimatedCost) {
			close();
			return;
		}

		return new Promise((resolve, reject) => {
			showInsufficientFunds({
				balanceStore: balance,
				sender,
				estimatedCost,
				onContinue: () => {
					close();
					resolve();
				},
				onDismiss: () => {
					close();
					const currentBal = get(balance);
					const balValue = currentBal.step === 'Loaded' ? currentBal.value : 0n;
					reject(new InsufficientFundsError(balValue, estimatedCost));
				},
			});
		});
	}

	async function ensureCanAfford<
		const TAbi extends Abi | readonly unknown[],
		TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
		TArgs extends ContractFunctionArgs<
			TAbi,
			'nonpayable' | 'payable',
			TFunctionName
		>,
		TChain extends Chain | undefined,
		TAccount extends Account | undefined,
		TChainOverride extends Chain | undefined = undefined,
	>(
		options: {
			contract: Omit<
				WriteContractParameters<
					TAbi,
					TFunctionName,
					TArgs,
					TChain,
					TAccount,
					TChainOverride
				>,
				'chain'
			> & {chain?: TChainOverride | null};
		},
		config: EnsureCanAffordOptions,
	): Promise<
		Omit<
			WriteContractParameters<
				TAbi,
				TFunctionName,
				TArgs,
				TChain,
				TAccount,
				TChainOverride
			>,
			'chain'
		> & {chain?: TChainOverride | null}
	>;

	async function ensureCanAfford<
		TChain extends Chain | undefined,
		TAccount extends Account | undefined,
		TChainOverride extends Chain | undefined = undefined,
	>(
		options: {
			transaction: Omit<
				SendTransactionParameters<TChain, TAccount, TChainOverride>,
				'chain'
			> & {chain?: TChainOverride | null};
		},
		config: EnsureCanAffordOptions,
	): Promise<
		Omit<
			SendTransactionParameters<TChain, TAccount, TChainOverride>,
			'chain'
		> & {chain?: TChainOverride | null}
	>;

	async function ensureCanAfford(
		options: any,
		config: EnsureCanAffordOptions,
	): Promise<any> {
		const {gasSpeed = 'fast', forceUpdate = false, balance, sender} = config;

		startEstimating();

		try {
			if (forceUpdate) {
				await Promise.all([balance.update(), gasFee.update()]);
			}

			const {maxFeePerGas, maxPriorityFeePerGas} = await getGasPrice(gasSpeed);

			let gasEstimate: bigint;
			let value: bigint = 0n;

			if ('contract' in options) {
				const contract = options.contract;
				gasEstimate = await publicClient.estimateContractGas({
					address: contract.address,
					abi: contract.abi,
					functionName: contract.functionName,
					args: contract.args,
					account: contract.account,
					value: contract.value,
				});
				value = contract.value ?? 0n;
			} else {
				const transaction = options.transaction;
				gasEstimate = await publicClient.estimateGas({
					to: transaction.to,
					data: transaction.data,
					value: transaction.value,
					account: transaction.account,
				});
				value = transaction.value ?? 0n;
			}

			// Worst-case cost uses maxFeePerGas (the ceiling actually charged).
			const gasCost = gasEstimate * maxFeePerGas;
			const estimatedCost = gasCost + value;

			await checkBalanceAndShowModal(balance, sender, estimatedCost);

			// Set BOTH fee fields: on chains (and fresh local nodes) that enforce a
			// minimum priority fee, sending only maxFeePerGas lets the node/viem
			// pick a default maxPriorityFeePerGas that can exceed a low maxFeePerGas
			// ("maxFeePerGas cannot be less than maxPriorityFeePerGas").
			if ('contract' in options) {
				return {
					...options.contract,
					gas: gasEstimate,
					maxFeePerGas,
					maxPriorityFeePerGas,
				};
			} else {
				return {
					...options.transaction,
					gas: gasEstimate,
					maxFeePerGas,
					maxPriorityFeePerGas,
				};
			}
		} catch (error) {
			close();
			throw error;
		}
	}

	return {
		subscribe,
		startEstimating,
		showInsufficientFunds,
		close,
		markFundingRequested,
		ensureCanAfford,
	};
}

export type BalanceCheckStore = ReturnType<typeof createBalanceCheckStore>;
