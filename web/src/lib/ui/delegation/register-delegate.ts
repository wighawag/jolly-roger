import type {Connection, UnderlyingEthereumProvider} from '@etherplay/connect';
import type {Account} from 'viem';
import {isUserRejectionError} from '$lib/core/transaction';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import {delegationMessage, type RegistrationRequest} from './registration';

/**
 * Everything the registration needs to read off a connection snapshot.
 *
 * One reader, so the origin used to SIGN and the origin used to SUBMIT can
 * never come from two places. They must be byte-identical or the contract
 * recovers a different address and rejects the signature, and nothing about the
 * failure says which of the two was wrong.
 */
export type DelegationAccount = {
	/** The account a greeting should be attributed to. */
	owner: `0x${string}`;
	/** This browser's signer, the address being authorised. */
	delegate: `0x${string}`;
	/** The scope the signer was derived for. */
	origin: string;
	/**
	 * The owner's signature over the delegation message, when the connection
	 * carries one. Its PRESENCE is the capability; see chooseRegistrationRoute.
	 */
	savedSignature: `0x${string}` | undefined;
	/** Whether the owner's wallet is on hand to sign a message right now. */
	canSignLive: boolean;
};

/**
 * The wallet that signs without ever showing the user anything.
 *
 * The development burner keeps its key in this browser's storage and signs
 * silently, so telling the user "your wallet will ask you to sign" is simply
 * false there: nothing opens, and they sit waiting for a prompt that is not
 * coming. Matched by the name it announces over EIP-6963, which is the only
 * thing that identifies it - there is no capability flag for "prompts", and
 * inventing one for a single dev tool would be worse than naming it.
 */
const SILENT_WALLET_NAME = 'Burner Wallet';

/**
 * Whether the owner's wallet will sign without prompting.
 *
 * Only affects WORDING. Nothing branches on it, so a wallet this fails to
 * recognise merely gets the wording that suits the overwhelming majority.
 */
export function signsWithoutPrompt(
	$connection: Connection<UnderlyingEthereumProvider>,
): boolean {
	// Not every step HAS a mechanism (the idle one does not), and this is asked
	// wherever the flow happens to be, so it is read structurally rather than
	// after narrowing to a step that is irrelevant to the question.
	const mechanism = ($connection as {mechanism?: {name?: string}}).mechanism;
	return mechanism?.name === SILENT_WALLET_NAME;
}

/**
 * Read the delegation-relevant parts of a connection.
 *
 * Undefined before sign-in, and in a deployment that never signs in: there is
 * no signer to authorise, so there is nothing to register.
 */
export function delegationAccountOf(
	$connection: Connection<UnderlyingEthereumProvider>,
): DelegationAccount | undefined {
	if ($connection.step !== 'SignedIn') return undefined;
	return {
		owner: $connection.account.address,
		delegate: $connection.account.signer.address,
		origin: $connection.account.signer.origin,
		savedSignature: $connection.account.savedDelegationSignature,
		canSignLive: !!$connection.wallet,
	};
}

/**
 * Ask the owner's wallet to sign the delegation message.
 *
 * Goes through the wallet on the CONNECTION, which is the owner's, rather than
 * through any client the app happens to hold: the point of this signature is
 * that the owner produced it.
 *
 * The user has already been shown what this means (see the consent step in the
 * top-up flow); this is only the request.
 */
export async function signDelegation(params: {
	$connection: Connection<UnderlyingEthereumProvider>;
	account: DelegationAccount;
}): Promise<`0x${string}`> {
	const {$connection, account} = params;
	if (!$connection.wallet) {
		throw new Error('This account has no wallet, so it cannot sign a message');
	}
	return $connection.wallet.provider.signMessage(
		delegationMessage(account.origin, account.delegate),
		account.owner,
	);
}

export type RegisterResult =
	/** In a block: the signer may now act, and holds whatever was forwarded. */
	| {status: 'registered'}
	/** Rejected in the wallet. An answer, not a fault. */
	| {status: 'cancelled'}
	| {status: 'error'; message: string; details: string};

/**
 * The minimum of a wallet client this needs; both rails satisfy it.
 *
 * Structural rather than viem's own generic signature, because the entry point
 * and its arguments are decided at RUNTIME (see registrationRequest) and viem's
 * inference is built for a call site that names one function literally. The
 * caller casts its client to this once, which keeps the cast at the one place
 * the mismatch actually is instead of on every argument.
 */
type Writer = {
	writeContract: (args: {
		address: `0x${string}`;
		abi: readonly unknown[];
		functionName: string;
		args: readonly unknown[];
		value: bigint;
		account: Account | `0x${string}`;
	}) => Promise<`0x${string}`>;
};

/** The minimum of a public client this needs. */
type Waiter = {
	waitForTransactionReceipt: (args: {
		hash: `0x${string}`;
	}) => Promise<{status?: string | number}>;
};

/**
 * Send the registration and wait for it to land.
 *
 * WAITS, rather than returning on broadcast, because the whole reason the user
 * is here is that they cannot act until this is on chain. Returning early would
 * hand them back a Send button that still refuses, with nothing on screen
 * explaining why.
 *
 * Outcomes are normalised the way `setGreeting` and `getCredits` already do, so
 * the flow renders a result instead of interpreting an RPC error.
 */
export type RegistrationWriter = Writer;

export async function submitRegistration(params: {
	registry: {address: `0x${string}`; abi: readonly unknown[]};
	client: Writer;
	publicClient: Waiter;
	/** What to pass as `account`: a local account, or an address for a wallet. */
	account: Account | `0x${string}`;
	request: RegistrationRequest;
}): Promise<RegisterResult> {
	const {registry, client, publicClient, account, request} = params;

	try {
		const hash = await client.writeContract({
			address: registry.address,
			abi: registry.abi,
			functionName: request.functionName,
			args: request.args,
			value: request.value,
			account,
		});

		const receipt = await publicClient.waitForTransactionReceipt({hash});
		// A reverted registration is a failure with a receipt, so it never throws.
		// Left unreported it would close the modal on a registration that did not
		// happen, and the next Send would fail for a reason the user was just told
		// had been dealt with.
		if (receipt.status === 'reverted' || receipt.status === 0) {
			return {
				status: 'error',
				message: 'The registration transaction was rejected by the contract.',
				details: `transaction ${hash} reverted`,
			};
		}
		return {status: 'registered'};
	} catch (error) {
		if (isUserRejectionError(error)) return {status: 'cancelled'};
		console.error('Failed to register the signer as a delegate:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
