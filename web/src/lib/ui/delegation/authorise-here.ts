import {get} from 'svelte/store';
import {isRegistered} from '$lib/onchain/delegation';
import {registrationRequest} from './registration';
import {delegationAccountOf, submitRegistration} from './register-delegate';
import {topUpCeiling} from '$lib/ui/credits/top-up-flow';
import type {Context} from '$lib/context/types';

/**
 * AUTHORISE THE KEY THIS BROWSER ACTS WITH, INSTEAD OF ASKING.
 *
 * THE REST OF THE APP PUTS A DIALOG IN FRONT OF THE SAME TWO CALLS, and it is
 * right to: the top-up flow asks who is paying and what it costs, because the
 * user is about to spend their own money. This is the same step for a caller
 * where that question has exactly one possible answer, and a question with one
 * possible answer is not consent, it is a gate.
 *
 * THE CALLER THAT HAS ONE IS AN OFFLINE WORLD (`$lib/offline`). Its account is
 * a wallet the world generated, on a chain in the tab, holding money the world
 * invented; registering this browser's signer as a delegate of that account,
 * and funding it, has the same wallet as payer and payee. Nobody is being asked
 * anything a dialog could put to them.
 *
 * WHY IT CANNOT HAPPEN IN THE WORLD'S PROVISIONING. The signer is derived in the
 * tab from the wallet SIGNATURE sign-in asks for, which happens after the
 * deploy, after the context, and after provisioning has returned; so this runs
 * once the world has signed in (`$lib/offline-world`'s `connectTheWorld`),
 * which is the first moment there is an address to register.
 *
 * THE SAME TWO FUNCTIONS THE DIALOG WOULD HAVE USED, deliberately.
 * `registrationRequest` decides the entry point and `submitRegistration` sends
 * it and judges the receipt, exactly as the top-up flow does behind "Authorise
 * and carry on". What is skipped is the modal in front of them (choosing a
 * payer, and confirming), and nothing about the contract path changes. That
 * matters for more than tidiness: this is the only place the offline world
 * touches delegation, so a shortcut here would leave the world exercising
 * something the online app does not do.
 *
 * THE DIRECT ROUTE, with no signature, and it falls out rather than being
 * chosen: the account IS the payer here, so sending the transaction is the
 * proof and `registerDelegate` needs nothing signed. `chooseRegistrationRoute`
 * would answer the same (`direct` comes first precisely to collapse this case);
 * it is not consulted only because there is nothing here to choose between.
 *
 * Moved up from template-commit-reveal's `$lib/game/acquire/authorise.ts`,
 * where an offline game's world first needed it, with its game's words made
 * this app's.
 */
export type AuthorisationOutcome =
	/** The chain already said this browser may act. Nothing was sent. */
	| {step: 'AlreadyAuthorised'}
	/** One transaction: the key is registered and holds gas of its own. */
	| {step: 'Authorised'}
	/**
	 * Nothing could be done, with the reason.
	 *
	 * NOT THROWN, because there is a remedy and the user already has it: the
	 * app's own authorisation flow comes back at their first action, which is
	 * what they would have met anyway. A booted world is not worth discarding
	 * over a step that can still be taken by hand.
	 */
	| {step: 'Refused'; reason: string};

/**
 * What this needs of a context, which is five members and no more.
 *
 * Named as a subset rather than taking the whole `Context`, so the dependency
 * is legible and a test can supply five fakes. They are exactly the five the
 * top-up flow uses for this same step.
 */
export type AuthorisationDeps = Pick<
	Context,
	'connection' | 'delegation' | 'accountExecutor' | 'publicClient' | 'credits'
>;

export async function authoriseTheBrowsersKey(
	deps: AuthorisationDeps,
): Promise<AuthorisationOutcome> {
	const {connection, delegation, accountExecutor, publicClient, credits} = deps;

	// The (chain, contract) pair, spelled the way a CREDENTIAL is bound, which is
	// not quite the shape the registry is stored in, and deliberately so: a
	// registry is a contract to write to, a target is what an authorisation is
	// good at. Built from the registry the STATE was read from, so the read, the
	// route and the write cannot disagree.
	const target = {
		chainId: delegation.registry.chainId,
		contract: delegation.registry.address,
	};
	const account = delegationAccountOf(get(connection), target);
	if (!account) {
		// Before sign-in there is no signer, so there is nothing to authorise and
		// nothing this could be about. The world signs in before calling this, so
		// reaching here means that failed, in which case saying so beats sending a
		// transaction naming an address nobody holds.
		return {step: 'Refused', reason: 'nobody is signed in to this world'};
	}

	// ASKED FRESH rather than read off whatever the poll last saw. This runs
	// during a boot, so the first read may not have landed, and `isRegistered`
	// treats an unfinished read as NOT registered: the safe direction for a
	// gate, and the wrong one here, where it would spend a transaction
	// re-registering a key that a restored world authorised on its first boot.
	await delegation.update();
	if (isRegistered(get(delegation))) return {step: 'AlreadyAuthorised'};

	const $executor = get(accountExecutor);
	if ($executor.status !== 'ready') {
		return {
			step: 'Refused',
			reason: `this world's account cannot send (${$executor.status})`,
		};
	}

	const result = await submitRegistration({
		// The contract the delegation state was READ from, rather than a second
		// lookup: a registration is bound to one (chain, contract) pair, and
		// registering anywhere else would leave the app still asking for an
		// authorisation. See onchain/delegation.
		registry: {
			address: delegation.registry.address,
			abi: delegation.registry.abi,
		},
		client: $executor.client,
		publicClient,
		account: $executor.account,
		request: registrationRequest({
			owner: account.owner,
			delegate: account.delegate,
			// WHAT ONE TOP-UP IS WORTH, from the helper the flow prices with rather
			// than a number invented here. The world's account holds play money so
			// nothing binds except the ceiling, and the ceiling is the honest
			// amount: a signer only ever spends gas, and parking more in it is
			// money that cannot easily come back.
			value: topUpCeiling(credits),
			// No credential: the owner is sending, and sending is the proof.
		}),
	});

	if (result.status !== 'registered') {
		return {
			step: 'Refused',
			reason:
				result.status === 'cancelled'
					? 'the wallet refused'
					: result.status === 'stale-credential'
						? 'the contract refused the credential'
						: result.message,
		};
	}

	// The app gates on this read, so refresh it before returning: a gate still
	// looking at a stale "not registered" would put the authorisation back in
	// front of a key that is now authorised.
	await delegation.update();
	return {step: 'Authorised'};
}
