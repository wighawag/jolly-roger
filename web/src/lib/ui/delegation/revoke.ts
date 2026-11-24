import {get} from 'svelte/store';
import {isUserRejectionError} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import {formatAmount, spendableBalance} from '$lib/core/funding/funding-math';
import {REGISTRATION_GAS} from '$lib/ui/credits/top-up-flow';
import type {Context} from '$lib/context/types';
import type {SignerGrant} from './grant';

export type RevokeResult =
	| {
			status: 'revoked';
			/**
			 * Who sent the withdrawal. `signer`: this browser's key resigned and
			 * carried its balance back with it. `account`: the account revoked it,
			 * because the key could not pay for its own transaction.
			 */
			by: 'signer' | 'account';
			/** What came back to the account with it, in wei. Zero after a revoke. */
			returned: bigint;
	  }
	| {status: 'cancelled'}
	/** Neither route can send: the key cannot pay its gas, and the account has no wallet. */
	| {status: 'cannot-send'}
	| {status: 'error'; message: string; details: string};

export type RevokeDeps = Pick<
	Context,
	| 'accountExecutor'
	| 'signerExecutor'
	| 'publicClient'
	| 'delegation'
	| 'connection'
>;

/**
 * How a withdrawal will be sent, worked out before anything is sent, so the
 * caller can say what is about to happen (and ask first, when it should).
 */
export type WithdrawalPlan = {
	owner: `0x${string}`;
	delegate: `0x${string}`;
	/** What the account will hold once the withdrawal has landed. */
	accountAfter: bigint;
	/**
	 * Whether the account will then be unable to authorise this browser again
	 * without being funded first. Authorising a withdrawn key again takes a
	 * transaction FROM THE ACCOUNT (a signature cannot undo a withdrawal), so
	 * this is the one consequence of withdrawing worth stopping to say.
	 */
	lowAfter: boolean;
} & (
	| {
			route: 'resign';
			returned: bigint;
			gas: bigint;
			maxFeePerGas: bigint;
			maxPriorityFeePerGas: bigint;
	  }
	| {route: 'revoke'}
);

export type PlanResult =
	| {status: 'ready'; plan: WithdrawalPlan}
	| Exclude<RevokeResult, {status: 'revoked'}>;

/**
 * Gas headroom on the resignation's estimate, in percent. The call is
 * deterministic, so this only covers the estimate itself being a little low.
 */
const GAS_HEADROOM_PERCENT = 110n;

/**
 * Work out how this browser's authority will be withdrawn.
 *
 * TWO ROUTES, the first preferred:
 *
 * - `resign`: THIS BROWSER'S KEY sends `resignDelegate(owner, owner)` itself,
 *   with its whole balance less the gas. The user is not prompted, the account
 *   needs nothing, and the funds the key held come back in the same
 *   transaction. Before this existed, withdrawing left those funds on a key
 *   that could no longer do anything, and the account (often empty, its funds
 *   having gone to the key) then could not afford to authorise it again.
 * - `revoke`: the ACCOUNT sends `revokeDelegate(signer)`, as before. Only when
 *   the key cannot pay for its own transaction.
 *
 * The fee is fixed HERE for the resignation, because the key signs locally:
 * nothing else picks a fee, so the reserve is exactly gas times the fee, and
 * everything above it goes back to the account.
 */
export async function planWithdrawal(deps: RevokeDeps): Promise<PlanResult> {
	const {
		accountExecutor,
		signerExecutor,
		publicClient,
		delegation,
		connection,
	} = deps;

	// The signer this browser holds, which is the one the panel just said may act
	// and therefore the one the user is asking to withdraw. Read from the
	// connection rather than passed in, so the address that was READ about and the
	// address written about are the same one.
	const $connection = get(connection);
	if ($connection.step !== 'SignedIn') return {status: 'cancelled'};
	const owner = $connection.account.address;
	const delegate = $connection.account.signer.address;
	if (!owner || !delegate) return {status: 'cancelled'};

	const {registry} = delegation;

	try {
		const [fees, accountBalance] = await Promise.all([
			publicClient.estimateFeesPerGas(),
			publicClient.getBalance({address: owner}),
		]);
		const {maxFeePerGas, maxPriorityFeePerGas} = fees;
		const lowAfterFor = (accountAfter: bigint) =>
			spendableBalance({
				balance: accountAfter,
				maxFeePerGas,
				gas: REGISTRATION_GAS,
			}) === 0n;

		const $signer = get(signerExecutor);
		if ($signer.status === 'ready') {
			const balance = await publicClient.getBalance({address: delegate});
			let estimate: bigint | undefined;
			try {
				// With a value, so the transfer to the payee is in the estimate.
				estimate = await publicClient.estimateContractGas({
					address: registry.address,
					abi: registry.abi,
					functionName: 'resignDelegate',
					args: [owner, owner],
					account: $signer.account,
					value: balance > 0n ? 1n : 0n,
				});
			} catch {
				// An empty key cannot even be estimated for; the account route
				// below is the answer then.
			}
			if (estimate !== undefined) {
				const gas = (estimate * GAS_HEADROOM_PERCENT) / 100n;
				const cost = gas * maxFeePerGas;
				if (balance >= cost) {
					const returned = balance - cost;
					const accountAfter = accountBalance + returned;
					return {
						status: 'ready',
						plan: {
							route: 'resign',
							owner,
							delegate,
							returned,
							gas,
							maxFeePerGas,
							maxPriorityFeePerGas,
							accountAfter,
							lowAfter: lowAfterFor(accountAfter),
						},
					};
				}
			}
		}

		// The key cannot pay its own way: the account withdraws it instead.
		const $account = get(accountExecutor);
		if ($account.status === 'cannot-send') return {status: 'cannot-send'};
		if ($account.status !== 'ready') return {status: 'cancelled'};
		return {
			status: 'ready',
			plan: {
				route: 'revoke',
				owner,
				delegate,
				accountAfter: accountBalance,
				lowAfter: lowAfterFor(accountBalance),
			},
		};
	} catch (error) {
		console.error('Could not prepare the withdrawal:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}

/**
 * Send a planned withdrawal, wait for it, and refresh the delegation read, so
 * the panel says what is true rather than what was true when the button was
 * pressed.
 */
export async function executeWithdrawal(
	deps: RevokeDeps,
	plan: WithdrawalPlan,
): Promise<RevokeResult> {
	const {accountExecutor, signerExecutor, publicClient, delegation} = deps;
	// The contract the delegation state was READ from, rather than a second
	// lookup: withdrawing from anywhere else would leave the panel reporting an
	// authorisation that is still live. See onchain/delegation.
	const {registry} = delegation;

	try {
		let hash: `0x${string}`;
		if (plan.route === 'resign') {
			const $signer = get(signerExecutor);
			if ($signer.status !== 'ready') return {status: 'cancelled'};
			hash = await $signer.client.writeContract({
				address: registry.address,
				abi: registry.abi,
				functionName: 'resignDelegate',
				args: [plan.owner, plan.owner],
				account: $signer.account,
				value: plan.returned,
				gas: plan.gas,
				maxFeePerGas: plan.maxFeePerGas,
				maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
			});
		} else {
			const $account = get(accountExecutor);
			if ($account.status === 'cannot-send') return {status: 'cannot-send'};
			if ($account.status !== 'ready') return {status: 'cancelled'};
			hash = await $account.client.writeContract({
				address: registry.address,
				abi: registry.abi,
				functionName: 'revokeDelegate',
				args: [plan.delegate],
				account: $account.account,
			});
		}

		const receipt = await publicClient.waitForTransactionReceipt({hash});
		await delegation.update();
		if (receipt.status !== 'success') {
			return {
				status: 'error',
				message: 'The withdrawal was not accepted',
				details: `Transaction ${hash} reverted.`,
			};
		}
		return plan.route === 'resign'
			? {status: 'revoked', by: 'signer', returned: plan.returned}
			: {status: 'revoked', by: 'account', returned: 0n};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to withdraw the delegation:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}

/**
 * Withdraw this browser's authority to act for the account.
 *
 * THE REASON THE MECHANISM IS SAFE TO OFFER AT ALL. An authorisation the user
 * cannot withdraw is the failure delegation has to avoid, so it is not left
 * inherited-but-unreachable: it is a row in the account panel.
 *
 * WHICH delegate is named, because an account may have several: this
 * withdraws THIS browser's signer and leaves the user's other browsers alone.
 *
 * Asks first ONLY when the account would be left unable to authorise this
 * browser again (see `WithdrawalPlan.lowAfter`). Everywhere else it just acts.
 */
export async function revokeDelegation(
	deps: RevokeDeps & Partial<Pick<Context, 'confirmation'>>,
	words?: {grant: SignerGrant; symbol: string; decimals: number},
): Promise<RevokeResult> {
	const planned = await planWithdrawal(deps);
	if (planned.status !== 'ready') return planned;
	const {plan} = planned;

	if (plan.lowAfter && deps.confirmation) {
		const carryOn = await deps.confirmation.ask(
			lowBalanceQuestion(plan, words),
		);
		if (!carryOn) return {status: 'cancelled'};
	}

	return executeWithdrawal(deps, plan);
}

/** The question asked before a withdrawal that leaves the account short. */
export function lowBalanceQuestion(
	plan: WithdrawalPlan,
	words?: {grant: SignerGrant; symbol: string; decimals: number},
) {
	const held = words
		? `${formatAmount(plan.accountAfter, words.decimals)} ${words.symbol}`
		: 'too little';
	const what = words ? `${words.grant.action} in your name` : 'act for you';
	return {
		title: "Withdraw this browser's access?",
		explanation:
			`Afterwards your account will hold ${held}. Letting this browser ${what} again ` +
			'takes a transaction from your account, so it will need funds first.',
		confirmLabel: 'Withdraw access',
		cancelLabel: 'Keep access',
		destructive: true,
	};
}

/** What the success toast says, in the app's words. */
export function withdrawnMessage(
	result: Extract<RevokeResult, {status: 'revoked'}>,
	words: {grant: SignerGrant; symbol: string; decimals: number},
): {title: string; description?: string} {
	const title = `This browser can no longer ${words.grant.action} in your name`;
	if (result.returned === 0n) return {title};
	return {
		title,
		description: `${formatAmount(result.returned, words.decimals)} ${words.symbol} went back to your account.`,
	};
}
