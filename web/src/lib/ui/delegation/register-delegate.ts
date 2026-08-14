import type {
	Connection,
	ConnectionStore,
	UnderlyingEthereumProvider,
} from '@etherplay/connect';
import type {Account} from 'viem';
import {isUserRejectionError} from '$lib/core/transaction';
import {
	causeChain,
	revertedErrorNames,
	textOf,
} from '$lib/core/transaction/error-chain';
import {
	txErrorDetails,
	txErrorSummary,
} from '$lib/core/transaction/tx-error-summary';
import {
	credentialState,
	sameAddress,
	signsOnDemand,
	type CredentialState,
	type DelegationCredential,
	type DelegationTarget,
	type RegistrationRequest,
} from './registration';

/**
 * Everything the registration needs to read off a connection snapshot.
 *
 * One reader, so every decision about delegation is made from one description
 * of the situation, scoped to the same (chainId, contract) pair the chain read
 * used. It decides the ROUTE and nothing else: the bytes come from
 * {@link fetchDelegation} at the moment of submission, which is the only place
 * a credential is ever obtained.
 */
export type DelegationAccount = {
	/** The account a greeting should be attributed to. */
	owner: `0x${string}`;
	/** This browser's signer, the address being authorised. */
	delegate: `0x${string}`;
	/**
	 * What the connection holds for this contract, or why it holds nothing.
	 * Its shape IS the capability; see chooseRegistrationRoute.
	 */
	credential: CredentialState;
	/**
	 * Whether the owner can be asked to sign right now.
	 *
	 * TWO SOURCES OF ONE FACT, folded here rather than branched on twice: a
	 * wallet on the connection is the app's own evidence, and a `sign-on-demand`
	 * permission outcome is the host saying the same thing about an owner it
	 * declined to pre-generate for. Both mean "ask now".
	 */
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
 * Read the delegation-relevant parts of a connection, for one contract.
 *
 * Undefined before sign-in, and in a deployment that never signs in: there is
 * no signer to authorise, so there is nothing to register.
 */
export function delegationAccountOf(
	$connection: Connection<UnderlyingEthereumProvider>,
	target: DelegationTarget,
	/** Signatures the contract has already refused; see {@link credentialState}. */
	refused?: ReadonlySet<`0x${string}`>,
): DelegationAccount | undefined {
	if ($connection.step !== 'SignedIn') return undefined;
	const delegate = $connection.account.signer.address;
	return {
		owner: $connection.account.address,
		delegate,
		credential: credentialState({
			savedDelegations: $connection.account.savedDelegations,
			// The ANSWER to every permission the app asked for, which is the only
			// thing that tells "you declined" apart from "nobody asked". An absent
			// credential says neither.
			permissions: $connection.account.permissions,
			target,
			delegate,
			refused,
		}),
		canSignLive:
			!!$connection.wallet ||
			signsOnDemand($connection.account.permissions, target),
	};
}

/**
 * The minimum of a connection this needs: the one call that yields a credential.
 *
 * Derived from the library's own type rather than restated, so a change to the
 * signature is a compile error here instead of a silent divergence.
 */
export type DelegationSource = Pick<
	ConnectionStore<UnderlyingEthereumProvider>,
	'getDelegation'
>;

/**
 * Get the credential authorising this browser at one contract.
 *
 * ONE CALL FOR BOTH KINDS OF OWNER, which is why the app no longer reads
 * `savedDelegations` to submit anything. A hosted account returns what it minted
 * at sign-in, because that is the only moment its key is reachable; a
 * wallet-owned account is asked to sign right now, which is the better moment
 * anyway (consent at the point of use, and nothing minted for a contract the
 * app never touches). The same line of app code covers both, and keeps covering
 * them as live signing widens.
 *
 * NO DEADLINE IS PASSED, deliberately. The deadline is inside the signed bytes,
 * so a stored credential only answers a request naming the same one: asking for
 * zero would reject a hosted record that was minted with a real date, which is
 * exactly what an allowlisted, auto-signed credential carries. Omitting it says
 * "whatever this credential was made with", and for a live signature the
 * library's own default of no expiry applies - the right default for a PROMPTED
 * credential, whose renewal costs a popup in the middle of a game.
 *
 * The user has already been shown what a live signature means (see the consent
 * step in the top-up flow); this is only the request.
 */
export async function fetchDelegation(params: {
	connection: DelegationSource;
	/** The contract the authorisation is good at, and nowhere else. */
	target: DelegationTarget;
	/** This browser's signer, which is who the credential has to be for. */
	delegate: `0x${string}`;
}): Promise<DelegationCredential> {
	const record = await params.connection.getDelegation({
		chainId: params.target.chainId,
		contract: params.target.contract,
	});
	// The record is self-describing, so a mismatch is caught here rather than by
	// spending the user's money on a registration that cannot do what it is for.
	// All three fields are inside the signed bytes: a wrong delegate authorises
	// an address this browser holds no key for, and a wrong pair produces bytes
	// that verify nowhere.
	if (
		!sameAddress(record.delegate, params.delegate) ||
		!sameAddress(record.contract, params.target.contract) ||
		record.chainId !== params.target.chainId
	) {
		throw new Error(
			`the credential authorises ${record.delegate} at ${record.contract} on chain ${record.chainId}, not ${params.delegate} at ${params.target.contract} on chain ${params.target.chainId}`,
		);
	}
	return {signature: record.signature, deadline: record.deadline};
}

/**
 * Reverts that mean THE CREDENTIAL is no good, rather than the call.
 *
 * Every field stored beside a signature is a cache of what is inside it, so a
 * stored copy that disagrees with the signed copy cannot be detected locally:
 * the signature simply recovers a different address. The contract is the only
 * party that finds out, and when it does the answer is not "a contract error"
 * but "throw this credential away and get a fresh one", which is what makes any
 * disagreement self-healing.
 *
 * `SignatureExpired` is in here for the same reason a browser-clock check is
 * not enough on its own: the clock this app reads is not the chain's.
 */
const CREDENTIAL_REJECTIONS = [
	'InvalidSignature',
	'SignatureExpired',
	'MalformedSignature',
	'UnrecoverableSignature',
];

/** Whether a failure says the credential we submitted will never be accepted. */
export function isCredentialRejection(error: unknown): boolean {
	// The contract's own name for what happened, when viem managed to decode the
	// revert against DELEGATION_ABI (which carries the errors for this reason).
	if (
		revertedErrorNames(error).some((name) =>
			CREDENTIAL_REJECTIONS.includes(name),
		)
	) {
		return true;
	}

	// And the prose, for a chain where an intermediate layer flattened the revert
	// into a plain Error. Read across every field viem spreads wording over, not
	// `message` alone: the name routinely arrives on `shortMessage`, and missing
	// it would report a spent credential as a contract error, which is the one
	// outcome this whole path exists to avoid. Matching on prose is safe here in
	// a way it is not for "insufficient funds": these names are ours, and a
	// contract does not revert with somebody else's error by accident.
	return causeChain(error).some((level) => {
		const text = textOf(level);
		return text !== '' && CREDENTIAL_REJECTIONS.some((n) => text.includes(n));
	});
}

export type RegisterResult =
	/** In a block: the signer may now act, and holds whatever was forwarded. */
	| {status: 'registered'}
	/** Rejected in the wallet. An answer, not a fault. */
	| {status: 'cancelled'}
	/**
	 * The contract refused the credential. NOT reported as a contract error: the
	 * remedy is a fresh credential, which for a hosted account means signing in
	 * again. See {@link isCredentialRejection}.
	 */
	| {status: 'stale-credential'}
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
		//
		// Deliberately NOT read as a rejected credential: a receipt carries no
		// reason, so calling it one would be a guess, and the guess sends the user
		// to sign in again for something signing in again may not fix.
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
		if (isCredentialRejection(error)) return {status: 'stale-credential'};
		console.error('Failed to register the signer as a delegate:', error);
		return {
			status: 'error',
			message: txErrorSummary(error),
			details: txErrorDetails(error),
		};
	}
}
