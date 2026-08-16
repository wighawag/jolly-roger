import {
	test as base,
	expect,
	type Locator,
	type Page,
	type BrowserContext,
} from '@playwright/test';
import {parseImpersonateAddresses} from '../../src/lib/dev-accounts';

/**
 * Extended test fixtures for E2E testing with wallet interactions.
 *
 * Each test starts with a clean browser state:
 * 1. playwright.config.ts sets storageState: {cookies: [], origins: []} for initial state
 * 2. This fixture creates a fresh context and clears localStorage on the target origin
 *    before any test code runs, ensuring complete isolation from auto-connect behavior
 */

// The addresses the burner wallet can impersonate, parsed with the SAME
// function the app uses (src/lib/dev-accounts.ts) from the same env var, so the
// tests and the app can never disagree about the list. Empty on a branch that
// signs in, since an impersonated account has no key and cannot sign in.
const IMPERSONATE_ADDRESSES = parseImpersonateAddresses(
	(globalThis as any).process.env.PUBLIC_IMPERSONATE_ADDRESSES,
);

// Hardhat node URL. Use the IPv4 literal: the node binds to 127.0.0.1, and
// Node's fetch can resolve `localhost` to ::1 first, failing intermittently.
// Overridable so a run can avoid a port already in use on the machine; must
// agree with what scripts/run-e2e-tests.sh started the node on.
const RPC_PORT = (globalThis as any).process.env.E2E_RPC_PORT || '8545';
const HARDHAT_RPC_URL =
	(globalThis as any).process.env.E2E_RPC_URL || `http://127.0.0.1:${RPC_PORT}`;

/**
 * How many times one call to the node is worth sending: the original, plus a
 * single repeat for a connection that died in transit. Anything higher stops
 * being a transport allowance and starts being a way not to hear about a node
 * that is genuinely unwell.
 */
const RPC_ATTEMPTS = 2;
/** Long enough for a dropped socket to be replaced, short enough to not be a wait. */
const RPC_RETRY_DELAY_MS = 250;
/** How far a failure message follows `cause` before it stops. Cycles are legal. */
const MAX_CAUSE_DEPTH = 5;
/**
 * How much of the app's connection state a failure message may carry.
 *
 * A provider error can hang an entire request/response off `cause`, and a dump
 * that buries the assertion it was meant to explain has changed which line
 * nobody reads rather than fixing it.
 */
const MAX_DIAGNOSIS_CHARS = 2000;

// The app's base URL comes from playwright.config.ts (`use.baseURL`), so tests
// navigate with relative paths and nothing here needs to duplicate it.

/**
 * Read the addresses the app will actually send from, off its debug context.
 *
 * They cannot be known in advance: the burner generates its accounts, and the
 * signer is derived from a signature at sign-in. Asking the app is the only way
 * to learn them, and it is also the honest question, since these are exactly
 * the accounts it will try to spend from.
 */
async function appSenderAddresses(
	page: Page,
): Promise<{account?: string; signer?: string}> {
	return page.evaluate(() => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		const context = (globalThis as any).context;
		if (!context) return {};
		return {
			account: read(context.accountExecutor)?.address,
			signer: read(context.signerExecutor)?.address,
		};
	});
}

/**
 * Every account the connected wallet holds.
 *
 * Needed by the tests that pay with a DIFFERENT account than the one signed in:
 * the burner generates its accounts per browser context, so their addresses
 * cannot be known in advance, and an unfunded payer cannot pay.
 */
async function walletAccounts(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		const context = (globalThis as any).context;
		if (!context) return [];
		return read(context.connection)?.wallet?.accounts ?? [];
	});
}

/** The delegation flow's own state, which names the route it actually took. */
async function topUpState(page: Page): Promise<{
	phase?: string;
	route?: string;
	registering?: boolean;
	payer?: string;
}> {
	return page.evaluate(() => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		const context = (globalThis as any).context;
		if (!context) return {};
		const state = read(context.topUp) ?? {};
		return {
			phase: state.phase,
			route: state.route,
			registering: state.registering,
			payer: state.payer,
		};
	});
}

/** Whether the chain says this browser's signer may act for the account. */
async function isDelegateRegistered(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		const context = (globalThis as any).context;
		if (!context) return false;
		const delegation = read(context.delegation);
		const signer = read(context.signerExecutor)?.address;
		// The read is scoped to this signer, so `allowed` IS the answer about it.
		// The signer is still required: without one there is nothing authorised and
		// nothing the value could be describing.
		if (!signer || delegation?.step !== 'Loaded') return false;
		return delegation.allowed === true;
	});
}

/**
 * An error and everything it was caused by, one line each.
 *
 * Node's `fetch` throws a bare `TypeError: fetch failed` and puts the reason
 * that actually explains it - ECONNRESET, ECONNREFUSED, a socket timeout - on
 * `cause`. A message that prints only the top-level error therefore names the
 * symptom and hides the diagnosis, which is how a transport blip against the
 * node reads as an inscrutable four-word failure.
 */
function causeChain(error: unknown): string {
	const lines: string[] = [];
	let current: any = error;
	// Bounded: `cause` is a user-supplied field and nothing forbids a cycle.
	while (current && lines.length < MAX_CAUSE_DEPTH) {
		const parts = [
			`${current.name ?? typeof current}: ${current.message ?? String(current)}`,
		];
		for (const key of ['code', 'errno', 'syscall'] as const) {
			if (current[key] !== undefined) parts.push(`${key}=${current[key]}`);
		}
		lines.push(parts.join(' '));
		current = current.cause;
	}
	return lines.join('\n    caused by ');
}

/**
 * The node answered, and the answer was no.
 *
 * ITS OWN CLASS RATHER THAN A FLAG ON THE ERROR, because the alternative is to
 * smuggle the flag through `cause` - and `cause` already means something here:
 * `causeChain` walks it. A `{retryable: false}` sentinel parked there gets
 * walked into and printed as `object: [object Object]`, appending a line of
 * junk to the refusal message, which is the case with the most diagnostic
 * value in the whole function. So the marker goes somewhere the chain cannot
 * see it, and `cause` stays free for a real underlying error.
 */
class NodeRefusedCall extends Error {
	name = 'NodeRefusedCall';
}

/**
 * Fund an address using Hardhat's hardhat_setBalance RPC method.
 * This is useful for tests where we need to ensure the wallet has ETH.
 *
 * ONE RETRY, AND ONLY FOR THE TRANSPORT. Under parallel load several workers
 * fund at once and a connection to the node occasionally dies mid-request,
 * which surfaced as `TypeError: fetch failed` in a test that had already
 * connected its wallet successfully - a socket problem wearing the costume of
 * an app problem. This is not a test retry (those hide signal): it is one call
 * to a node that dropped one connection, and it is safe only because
 * `hardhat_setBalance` sets an ABSOLUTE balance, so sending it twice lands on
 * the same state as sending it once. Do not copy this loop onto anything that
 * accumulates, like a transfer.
 *
 * WHAT COUNTS AS AN ANSWER, and so is never repeated:
 *
 * - a JSON-RPC error in the body: the node considered the call and refused it
 * - any 4xx: the request itself is wrong, and it will be just as wrong twice
 * - a body that is not JSON: something that is not the node replied (a proxy,
 *   or the wrong port), and it will reply the same way again
 *
 * A 5xx is NOT an answer in that sense - the node can be transiently unable to
 * serve while it is being hammered by eight workers - so it is retried along
 * with the transport failures.
 */
export async function fundAddressViaHardhat(
	address: string,
	amountInEth = '100',
): Promise<void> {
	// Convert ETH to wei (hex)
	const weiAmount = BigInt(parseFloat(amountInEth) * 1e18);
	const hexAmount = '0x' + weiAmount.toString(16);

	for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(HARDHAT_RPC_URL, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'hardhat_setBalance',
					params: [address, hexAmount],
					id: 1,
				}),
			});

			if (!response.ok) {
				const description = `hardhat_setBalance returned HTTP ${response.status} ${response.statusText}`;
				if (response.status < 500) throw new NodeRefusedCall(description);
				throw new Error(description);
			}

			// The node answers a rejected call with HTTP 200 and an `error` member,
			// so a body nobody reads is a funding failure nobody notices - until a
			// later assertion fails for want of gas and takes the blame.
			//
			// Read as TEXT first: `response.json()` gives no way to show what it
			// choked on, and swallowing the parse failure would re-open exactly the
			// hole this paragraph exists to close, since an unreadable body would
			// then pass for success.
			const raw = await response.text();
			let body: {error?: {message?: string; code?: number}};
			try {
				body = JSON.parse(raw);
			} catch {
				throw new NodeRefusedCall(
					`hardhat_setBalance got a reply that is not JSON: ${raw.slice(0, 200)}`,
				);
			}
			if (body?.error) {
				throw new NodeRefusedCall(
					`hardhat_setBalance refused for ${address}: ` +
						`${body.error.message ?? 'no message'} (code ${body.error.code ?? 'none'})`,
				);
			}
			return;
		} catch (error) {
			if (error instanceof NodeRefusedCall || attempt === RPC_ATTEMPTS) {
				throw new Error(
					`could not fund ${address} via ${HARDHAT_RPC_URL} ` +
						`(attempt ${attempt} of ${RPC_ATTEMPTS}):\n    ${causeChain(error)}`,
					{cause: error},
				);
			}
			await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_DELAY_MS));
		}
	}
}

/**
 * Give the app's sender accounts a balance, and wait until the app has SEEN it.
 *
 * Waiting matters: `hardhat_setBalance` is instant on the node but the app only
 * learns about it on its next poll, and a test that sends immediately would hit
 * the insufficient-funds modal with a balance that is already stale.
 */
async function fundAppSenders(page: Page): Promise<void> {
	const {account, signer} = await appSenderAddresses(page);
	for (const address of [account, signer]) {
		if (address) await fundAddressViaHardhat(address, '100');
	}
	if (!signer) return;
	await expect
		.poll(async () => (await appBalances(page)).signer ?? '0', {
			timeout: 30_000,
			message: 'app should observe the funded signer balance',
		})
		.not.toBe('0');
}

/** Balances as the APP currently sees them, as decimal strings. */
async function appBalances(
	page: Page,
): Promise<{account?: string; signer?: string}> {
	return page.evaluate(() => {
		const read = (store: any) => {
			let value: any;
			store.subscribe((v: any) => (value = v))();
			return value;
		};
		const context = (globalThis as any).context;
		if (!context) return {};
		const asString = (b: any) =>
			b?.step === 'Loaded' ? b.value.toString() : undefined;
		return {
			account: asString(read(context.accountBalance)),
			signer: asString(read(context.signerBalance)),
		};
	});
}

export interface WalletOptions {
	/**
	 * Which burner account (index into IMPERSONATE_ADDRESSES) the connect flow
	 * picks in the account-picker dialog.
	 *
	 * All e2e tests share ONE chain and the GreetingsRegistry keeps ONE message
	 * per account, so two test files writing from the same account clobber each
	 * other's message mid-test (files run in parallel workers). Give a file that
	 * writes messages its own account with `test.use({walletAccountIndex: 1})`
	 * so its writes cannot race the demo suite's (which uses the default 0).
	 */
	walletAccountIndex: number;
}

export interface WalletFixtures {
	/**
	 * Page with clean localStorage - starts with no wallet connection state.
	 * This overrides the default page fixture to ensure test isolation.
	 */
	page: Page;

	/**
	 * Page with wallet connected via Dev Mode (burner wallet).
	 * Automatically handles the connection flow.
	 */
	connectedPage: Page;

	/**
	 * Connects the wallet using Dev Mode on the current page.
	 * Can be used when you need more control over when connection happens.
	 */
	connectWallet: (page: Page) => Promise<void>;

	/**
	 * Waits for a transaction to be confirmed.
	 */
	waitForTransaction: (page: Page) => Promise<void>;

	/**
	 * Submit a greeting and wait until it is visible and settled on-chain.
	 * Preferred over open-coding fill/click/waitForTransaction: it fails at the
	 * step that actually broke instead of at a later assertion.
	 */
	submitGreeting: (page: Page, message: string) => Promise<void>;

	/**
	 * Complete the flow that authorises this browser to post in the account's
	 * name (and funds the signer in the same transaction), if the app is asking
	 * for it. Returns whether it was asking.
	 */
	authoriseBrowser: (
		page: Page,
		options?: AuthoriseOptions,
	) => Promise<AuthorisationOutcome>;

	/** The addresses the connected wallet holds, which the burner generates. */
	walletAccounts: (page: Page) => Promise<string[]>;

	/** Fund every account the connected wallet holds, so any of them can pay. */
	fundWalletAccounts: (page: Page) => Promise<void>;

	/** The authorisation flow's own state, including the route it took. */
	topUpState: (page: Page) => Promise<{
		phase?: string;
		route?: string;
		registering?: boolean;
		payer?: string;
	}>;

	/** Whether the chain says this browser's signer may act for the account. */
	isDelegateRegistered: (page: Page) => Promise<boolean>;

	/**
	 * Ensures the test wallet addresses have ETH on the Hardhat node.
	 * Call this before tests that need funded wallets.
	 */
	fundWallets: () => Promise<void>;
}

// The app's authoritative connection signal (see navbar.svelte). Reading the
// navbar balance text instead - as this fixture used to - gives false negatives:
// the balance span renders empty while the balance is still loading, so a
// connected app reads as disconnected.
const WALLET_STATUS = '[data-testid="wallet-status"]';

async function isWalletConnected(page: Page): Promise<boolean> {
	const attr = await page
		.locator(WALLET_STATUS)
		.getAttribute('data-connected')
		.catch(() => null);
	return attr === 'true';
}

/**
 * What the app itself says about the connection, for a failure message.
 *
 * The attribute this fixture waits on cannot tell "still connecting" from
 * "connect threw and gave up": both read `data-connected="false"` for the whole
 * timeout, and the app's own failure modal collapses anything that is not a
 * user rejection into "failed to connect to wallet", keeping the real error on
 * `cause` where nobody looks. So the store is asked directly, and the `cause`
 * is unpacked INSIDE the page: an `Error` crossing `evaluate` serialises to
 * `{}`, which would throw away the one thing worth reading.
 */
async function describeConnectionState(page: Page): Promise<string> {
	const state = await page
		.evaluate(() => {
			const read = (store: any) => {
				let value: any;
				store.subscribe((v: any) => (value = v))();
				return value;
			};
			const describe = (value: any, depth = 0): any => {
				if (value === null || typeof value !== 'object' || depth > 3)
					return value;
				const out: any = {};
				if (value instanceof Error) {
					out.name = value.name;
					out.message = value.message;
				}
				for (const key of Object.keys(value))
					out[key] = describe(value[key], depth + 1);
				if ((value as any).cause !== undefined)
					out.cause = describe((value as any).cause, depth + 1);
				return out;
			};
			const context = (globalThis as any).context;
			if (!context) return {noAppContext: true};
			const connection = read(context.connection);
			return {
				step: connection?.step,
				connected: connection?.connected,
				error: connection?.error
					? {
							message: connection.error.message,
							cause: describe(connection.error.cause),
						}
					: undefined,
				// Which modal is on screen, which names the step it is stuck on.
				dialog:
					document
						.querySelector('[role="dialog"]')
						?.textContent?.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 200) ?? null,
			};
		})
		.catch((error) => ({unreadable: causeChain(error)}));

	const text = JSON.stringify(state, null, 2);
	return text.length > MAX_DIAGNOSIS_CHARS
		? `${text.slice(0, MAX_DIAGNOSIS_CHARS)}\n... (truncated, ${
				text.length - MAX_DIAGNOSIS_CHARS
			} more characters)`
		: text;
}

/**
 * Assert the wallet is connected, and say WHY it is not when it is not.
 *
 * A bare attribute timeout here reports that the wait ran out, which is the one
 * thing already obvious from the stack. The app knows more than that - it may
 * be resting on a failure with the wallet's own error attached - so the message
 * carries the connection's state and the `cause` the failure modal hides.
 */
async function expectWalletConnected(page: Page, timeout = 30_000) {
	try {
		await expect(
			page.locator(WALLET_STATUS),
			'wallet should be connected (navbar data-connected)',
		).toHaveAttribute('data-connected', 'true', {timeout});
	} catch (error) {
		// `cause` keeps the original: the text below is a rendering of it, and a
		// rendering is not the thing. Playwright's own `TimeoutError` and its stack
		// are worth having intact for anything that inspects the error rather than
		// reading it.
		throw new Error(
			'wallet should be connected (navbar data-connected)\n' +
				`the app's own connection state was:\n${await describeConnectionState(page)}\n\n` +
				`${causeChain(error)}`,
			{cause: error},
		);
	}
}

/**
 * Click the account at `index` among the ones that can actually SIGN.
 *
 * The burner lists its own generated accounts alongside the impersonated ones
 * from src/lib/dev-accounts. Impersonated addresses have no private key, so
 * they can never sign the sign-in message: picking one leaves the connection
 * stuck at WalletConnected forever, and the only symptom is a fixture timeout
 * a long way from the cause. They are skipped, so `walletAccountIndex` counts
 * real accounts and keeps meaning "give this test file its own account".
 *
 * They may render as a truncated hex address OR as a resolved ENS name
 * (vitalik.eth), depending on whether ENS lookup succeeded, so both are
 * excluded.
 *
 * Uses the DIRECT children of the list: each row nests a "Copy address" button,
 * so a descendant selector would interleave copy buttons into the index space.
 */
async function pickSignableAccount(dialog: Locator, index: number) {
	const rows = dialog.locator('.overflow-y-auto > button');
	const count = await rows.count().catch(() => 0);
	// Empty when impersonation is off, in which case nothing is skipped and this
	// degenerates to picking the Nth row.
	const impersonated = IMPERSONATE_ADDRESSES.map((a) =>
		a.slice(0, 6).toLowerCase(),
	);

	let seen = -1;
	for (let i = 0; i < count; i++) {
		const label = (
			(await rows
				.nth(i)
				.innerText()
				.catch(() => '')) || ''
		).trim();
		const lower = label.toLowerCase();
		if (impersonated.some((prefix) => lower.includes(prefix))) continue;
		if (/\.eth\b/i.test(label)) continue;
		seen++;
		if (seen === index) {
			await rows.nth(i).click();
			return;
		}
	}
	throw new Error(
		`no signable burner account at index ${index} (of ${count} rows); ` +
			'impersonated accounts cannot sign the sign-in message',
	);
}

/**
 * Connect wallet via the burner wallet.
 *
 * The connect flow is a sequence of modals whose order varies with config and
 * auto-connect state (the account picker can appear immediately on page load
 * when a multi-account wallet auto-reconnects, without any connect button):
 *
 * - connect entry: "Dev Mode" (SignedIn + dev) or "Connect <wallet>" button
 * - account picker: "N accounts available, choose one" (multi-account wallet)
 * - sign-in confirm: "Confirm sign in" (SignedIn config)
 *
 * Rather than assuming an order, poll for whichever dialog is currently shown
 * and act on it, until no connect-flow dialog remains (or timeout).
 */
async function connectWalletDevMode(
	page: Page,
	accountIndex = 0,
): Promise<void> {
	const deadline = Date.now() + 45_000;

	while (Date.now() < deadline) {
		const dialog = page.locator('[role="dialog"]');
		const dialogVisible = await dialog
			.first()
			.isVisible({timeout: 1000})
			.catch(() => false);

		if (!dialogVisible) {
			// No dialog on screen means EITHER the connection completed, OR the next
			// modal has simply not opened yet (transitions lag under load).
			//
			// Concluding "done" from the absence of a dialog is what made this suite
			// flaky: the helper returned before the account picker had rendered, the
			// test then clicked send, the picker opened with nobody left to answer
			// it, and so no transaction was ever sent - surfacing much later as a
			// "message never appeared" failure in whichever test drew the short
			// straw. Only stop once the app itself reports a connection.
			if (await isWalletConnected(page)) break;
			await page.waitForTimeout(250);
			continue;
		}

		// The dialog may close between the isVisible check above and this read;
		// without an explicit timeout, textContent would wait forever (Playwright's
		// default action timeout is unlimited) and hang the fixture until the test
		// times out. Bound it and treat a vanished dialog as "loop again".
		const text = await dialog
			.first()
			.textContent({timeout: 2000})
			.catch(() => null);
		if (text === null) continue;

		if (/wallets available, choose one/i.test(text)) {
			// Wallet list (multiple injected wallets, shown inline under wallet-only
			// auth or via the picker): choose the burner wallet.
			await dialog
				.locator('.overflow-y-auto > button', {hasText: 'Burner Wallet'})
				.first()
				.click();
		} else if (/accounts available, choose one/i.test(text)) {
			await pickSignableAccount(dialog, accountIndex);
		} else if (/confirm sign in/i.test(text)) {
			// Under a sign-in target, the confirm dialog may be the COMBINED
			// choose+sign-in modal (multi-account wallet): select the configured
			// account row first, then sign. With no rows (single-account confirm),
			// just sign.
			await pickSignableAccount(dialog, accountIndex);
			await page.getByRole('button', {name: /^sign in$/i}).click();
		} else if (/insufficient funds|funds available/i.test(text)) {
			// Funding is handled by handleInsufficientFundsModal below.
			break;
		} else {
			// Connect entry: dev-mode button (SignedIn + dev) or the wallet connect
			// button (accessible name includes the icon alt text, so match loosely).
			const entry = page
				.getByRole('button', {name: /dev mode/i})
				.or(page.getByRole('button', {name: /connect .*wallet/i}))
				.first();
			const entryVisible = await entry
				.isVisible({timeout: 1000})
				.catch(() => false);
			if (entryVisible) {
				await entry.click();
			} else {
				// Unknown dialog (e.g. a transient step): wait for it to change.
				await page.waitForTimeout(500);
			}
		}
		await page.waitForTimeout(250);
	}

	// Handle Insufficient Funds modal - click "Get ETH" to use the faucet API
	await handleInsufficientFundsModal(page);

	// Fail here, loudly and at the real cause, rather than handing back a page
	// that is not connected and letting a later assertion take the blame.
	await expectWalletConnected(page);
}

/**
 * Handle the Insufficient Funds modal by clicking "Get ETH" and then "Continue Transaction".
 * This modal appears when the wallet is connected but doesn't have enough ETH.
 */
async function handleInsufficientFundsModal(page: Page): Promise<void> {
	const getEthButton = page.getByRole('button', {name: /get eth/i});

	// The modal is genuinely optional, so its ABSENCE is not an error - but once
	// it is on screen the rest of the flow must work. Wrapping the whole sequence
	// in `catch {}` (as this used to) also swallowed a broken funding flow, so a
	// test that never got its ETH failed later somewhere unrelated.
	const appeared = await getEthButton
		.waitFor({state: 'attached', timeout: 5000})
		.then(() => true)
		.catch(() => false);

	if (!appeared) return;

	// Wait for it to be enabled (not loading)
	await expect(getEthButton).toBeEnabled({timeout: 30000});

	// Click "Get ETH" - this will call the faucet API
	await getEthButton.click();

	// Wait for "Continue Transaction" button to appear and be enabled
	const continueButton = page.getByRole('button', {
		name: /continue transaction/i,
	});
	await continueButton.waitFor({state: 'visible', timeout: 30000});
	await expect(continueButton).toBeEnabled({timeout: 10000});

	// Click "Continue Transaction" to proceed with the original transaction
	await continueButton.click();

	// Wait for the modal to close.
	// NOTE: waitForFunction's signature is (fn, arg, options); options must be
	// the THIRD argument or the timeout silently never applies (waits forever).
	await page.waitForFunction(
		() => {
			const modal = document.querySelector('[role="dialog"]');
			return !modal || !modal.textContent?.includes('Funds');
		},
		undefined,
		{timeout: 10000},
	);
}

const MESSAGE_ROW = '[data-testid="message-row"]';
const MESSAGE_PENDING = '[data-testid="message-pending"]';
// The delegation / top-up flow. Sending a greeting needs this browser's signer
// to be a registered delegate of the account, and the FIRST time it is not, the
// send opens this instead: one transaction authorises the signer and funds it.
const PAYMENT_METHODS = '[data-testid="payment-methods"]';
const CONFIRM_TOP_UP = '[data-testid="confirm-top-up"]';
// The explanation of what is being signed, which rides ON the confirm step: it
// belongs immediately before the wallet opens, and that is where the button is.
const DELEGATION_CONSENT = '[data-testid="delegation-consent"]';
// The yes/no question the app asks before going on. Used here for the one that
// brings an interrupted action back once whatever blocked it is dealt with, so
// the greeting the user typed is the greeting that goes out. Not tied to any
// feature: anything can raise it (see core/ui/confirm).
const CONFIRMATION = '[data-testid="confirmation-confirm"]';
// The app's own count of operations that have not reached a final state. Not
// demo-specific, so a suite for any feature can wait on it.
const PENDING_OPERATIONS = '[data-testid="pending-operations"]';

/**
 * Wait for every in-flight write to settle.
 *
 * The previous implementation polled for `[class*="animate-spin"]` and wrapped
 * BOTH waits in `catch {}`, which made it incapable of failing: it returned
 * after at most ~40s whether or not a transaction had happened, so a write that
 * never left the browser surfaced as an unrelated assertion timeout later on.
 * It also matched the navbar's own loading spinner, so it could settle while a
 * write was still open.
 *
 * `message-pending` is the app's real per-message in-flight flag, and a timeout
 * here now fails the test at the actual cause.
 */
async function waitForTransactionComplete(page: Page): Promise<void> {
	await expect(
		page.locator(PENDING_OPERATIONS),
		'all in-flight operations should have settled',
	).toHaveCount(0, {timeout: 60_000});
}

/**
 * Walk the payment connection's own connect flow.
 *
 * Its own, and NOT `connectWalletDevMode`: that one stops as soon as the APP
 * connection reports connected, which it already is by the time anything is
 * being paid for. This one runs until the flow has a payer and an amount, or
 * until it says nothing can be sent.
 */
export async function connectPaymentWallet(
	page: Page,
	accountIndex = 1,
): Promise<void> {
	const deadline = Date.now() + 45_000;

	while (Date.now() < deadline) {
		// Done: the flow is showing what this payer will send.
		const ready = await page
			.locator(CONFIRM_TOP_UP)
			.isVisible()
			.catch(() => false);
		if (ready) return;

		// The top-up modal is itself a dialog, so every open one is inspected and
		// only the connect-flow steps are acted on.
		const dialogs = page.locator('[role="dialog"]');
		const count = await dialogs.count().catch(() => 0);
		let acted = false;

		for (let i = 0; i < count; i++) {
			const dialog = dialogs.nth(i);
			const text =
				(await dialog.textContent({timeout: 2000}).catch(() => null)) ?? '';

			if (/wallets? available, choose one/i.test(text)) {
				await dialog
					.locator('.overflow-y-auto > button', {hasText: 'Burner Wallet'})
					.first()
					.click();
				acted = true;
				break;
			}

			if (/accounts available, choose one/i.test(text)) {
				await pickSignableAccount(dialog, accountIndex);
				acted = true;
				break;
			}

			const connectEntry = dialog
				.getByRole('button', {name: /connect .*wallet/i})
				.first();
			if (await connectEntry.isVisible().catch(() => false)) {
				await connectEntry.click();
				acted = true;
				break;
			}
		}

		if (!acted) await page.waitForTimeout(250);
	}

	throw new Error('the payment connection never produced a payer');
}

export type AuthoriseOptions = {
	/** Which payment method to take. Defaults to the account itself. */
	via?: 'account' | 'wallet';
	/** Which wallet account pays, for the `wallet` method. */
	accountIndex?: number;
	/**
	 * Whether to accept the offer to carry on with whatever was interrupted.
	 * Defaults to true; a test that wants to inspect that step sets it false.
	 */
	resume?: boolean;
};

export type AuthorisationOutcome = {
	/** Whether the app was asking for the authorisation at all. */
	offered: boolean;
	/** How the authorisation was proven, read before it was submitted. */
	route?: string;
	/** Whether the explanation was shown BEFORE any signature was requested. */
	explained: boolean;
	/** Who paid for it. */
	payer?: string;
	/**
	 * Whether the app offered to carry on with the action that was interrupted,
	 * rather than dropping it and making the user ask again.
	 */
	resumed?: boolean;
};

/**
 * Complete the authorisation flow if the app opened it, and report what it did.
 *
 * The app refuses to send a greeting until this browser's signer is a
 * registered delegate of the account, and answers a send with this flow rather
 * than with a `NotDelegate` revert. So this is the e2e counterpart of that
 * state: it is absent once the account has authorised the browser, and every
 * fresh browser context meets it exactly once.
 *
 * The route is read from the flow BEFORE confirming, because the flow closes on
 * success and a closed flow remembers nothing - which is right for the app and
 * useless for a test that wants to know which of the two paths ran.
 */
async function authoriseBrowser(
	page: Page,
	options: AuthoriseOptions = {},
): Promise<AuthorisationOutcome> {
	// Either the chooser, or - when only one way to pay is available - the step
	// it would have led to. A list of one is not a choice, so the flow skips it.
	const chooser = page.locator(PAYMENT_METHODS);
	const opened = await chooser
		.or(page.locator(CONFIRM_TOP_UP))
		.first()
		.waitFor({state: 'visible', timeout: 15_000})
		.then(() => true)
		.catch(() => false);
	if (!opened) return {offered: false, explained: false};

	const via = options.via ?? 'account';
	if (await chooser.isVisible().catch(() => false)) {
		const method = page.locator(`[data-testid="pay-with-${via}"]`);
		await expect(method, `paying with "${via}" should be on offer`).toBeEnabled(
			{
				timeout: 10_000,
			},
		);
		await method.click();

		if (via === 'wallet') {
			await connectPaymentWallet(page, options.accountIndex ?? 1);
		}
	}

	const confirm = page.locator(CONFIRM_TOP_UP);
	await expect(confirm, 'the flow should offer an amount to send').toBeEnabled({
		timeout: 30_000,
	});

	const before = await topUpState(page);

	// The live-signature route explains what is about to be signed, on this step,
	// so it is read immediately before the button that opens the wallet. The
	// direct route shows a transaction instead, which is its own confirmation,
	// and the pre-signed route has nothing to prompt.
	const explained = await page
		.locator(DELEGATION_CONSENT)
		.isVisible()
		.catch(() => false);

	await confirm.click();

	// The modal closes only once the registration is IN a block: the whole point
	// is that nothing can be sent until it is.
	await expect(
		page.locator(CONFIRM_TOP_UP),
		'the authorisation should complete and close the flow',
	).toHaveCount(0, {timeout: 60_000});

	// Whatever was interrupted is offered back, named. Optional because this
	// helper is also used to authorise a browser with nothing waiting on it.
	const resumed = await page
		.locator(CONFIRMATION)
		.waitFor({state: 'visible', timeout: 10_000})
		.then(() => true)
		.catch(() => false);
	if (resumed && (options.resume ?? true)) {
		await page.locator(CONFIRMATION).click();
	}

	return {
		offered: true,
		route: before.route,
		payer: before.payer,
		explained,
		resumed,
	};
}

/**
 * Submit a greeting and wait until it is on-chain and settled.
 *
 * Tests previously open-coded fill -> click -> waitForTransaction and then
 * asserted the text separately. Each step could silently no-op, so the failure
 * always landed on the final assertion regardless of which step actually broke.
 * Doing it in one place means the error names the step that failed.
 *
 * The first send from a fresh browser does not reach the chain: the signer is
 * not a delegate yet, so the app opens the authorisation flow instead. That is
 * the state the app is designed to have, not an error, so this completes it and
 * sends again rather than failing.
 */
async function submitGreeting(page: Page, message: string): Promise<void> {
	const input = page.getByPlaceholder('Enter your greeting...');
	await expect(input, 'greeting input should be ready').toBeEnabled({
		timeout: 30_000,
	});
	await input.fill(message);

	const sendButton = page.getByRole('button', {name: /send/i});
	await expect(
		sendButton,
		'send should be enabled once input has text',
	).toBeEnabled({timeout: 30_000});
	await sendButton.click();

	// A write can surface a funding prompt before it reaches the chain.
	await handleInsufficientFundsModal(page);

	// A first send from a fresh browser is answered with the authorisation flow
	// instead of reaching the chain. The send is not lost: it waits, and the app
	// offers it back once this browser may act. So there is nothing to re-click.
	const authorised = await authoriseBrowser(page);
	if (authorised.offered) {
		expect(
			authorised.resumed,
			'the interrupted send should be offered back, not dropped',
		).toBe(true);
		await handleInsufficientFundsModal(page);
	}

	// The row appears optimistically with a pending spinner, then settles.
	const row = page.locator(MESSAGE_ROW).filter({hasText: message});
	await expect(
		row,
		`greeting "${message}" should appear in the list`,
	).toBeVisible({timeout: 60_000});
	await expect(
		row.locator(MESSAGE_PENDING),
		`greeting "${message}" should settle on-chain`,
	).toHaveCount(0, {timeout: 60_000});
}

export const test = base.extend<WalletFixtures & WalletOptions>({
	// Option fixture: which burner account the connect flow selects.
	// Override per file/describe with `test.use({walletAccountIndex: 1})`.
	walletAccountIndex: [0, {option: true}],
	/**
	 * Override the default page fixture to ensure each test starts with clean storage.
	 *
	 * This creates a fresh browser context with empty storage state for each test,
	 * then navigates to the app to clear any storage on the correct origin,
	 * ensuring no previous wallet connection state persists between tests.
	 */
	page: async ({browser}, use) => {
		// A brand-new context is already storage-isolated, and the explicit
		// storageState states that: no cookies, no origin storage. So there is
		// nothing to clear before the test runs.
		//
		// This used to prime the context by navigating to the app origin with
		// `waitUntil: 'commit'`, clearing storage, then navigating to about:blank.
		// Committing and immediately navigating away races the in-flight load and
		// intermittently aborted it outright (`net::ERR_ABORTED`), failing tests
		// that had not run a line of their own code yet. The dance bought no
		// isolation the fresh context did not already provide.
		//
		// Note storage must NOT be cleared on every navigation (e.g. via
		// addInitScript): the app persists the wallet connection there, and tests
		// that navigate between pages rely on it surviving.
		const context = await browser.newContext({
			storageState: {cookies: [], origins: []},
		});

		const page = await context.newPage();

		await use(page);
		await context.close();
	},

	/**
	 * Fund wallet addresses via Hardhat RPC before tests.
	 */
	fundWallets: async ({}, use) => {
		const fundAll = async () => {
			for (const address of IMPERSONATE_ADDRESSES) {
				await fundAddressViaHardhat(address, '100');
			}
		};
		await use(fundAll);
	},

	/**
	 * Provides a page that's already connected to a wallet.
	 * Usage:
	 *   test('my test', async ({ connectedPage }) => { ... })
	 */
	connectedPage: async ({page, fundWallets, walletAccountIndex}, use) => {
		// Fund the wallet addresses BEFORE navigating to the page
		// This ensures the wallet has ETH when the app auto-connects
		await fundWallets();

		// Navigate to demo page
		await page.goto('/demo');

		// Wait for app to initialize
		const input = page.getByPlaceholder('Enter your greeting...');
		await expect(input).toBeVisible({timeout: 30000});

		// Ask the app whether it is connected, rather than inferring it from the
		// navbar balance: the balance span is empty while loading and hidden below
		// the `sm` breakpoint, so the old check reported "disconnected" for an
		// already-connected app and re-ran the connect flow on top of it - which
		// re-opened the account picker in the middle of the test.
		if (!(await isWalletConnected(page))) {
			// Connect through the navbar's dedicated Connect affordance.
			//
			// This used to fill the input and `click({force: true})` the Send button.
			// Two problems: `force` skips actionability, so while the app was still
			// initialising and Send was disabled the click was a silent no-op - no
			// dialog opened, the connect flow never started, and the fixture handed
			// back an unconnected page. It also wrote a junk "fixture-connection-test"
			// greeting to the chain on every single test purely as a side effect of
			// connecting, costing a transaction and polluting the message list.
			const connectButton = page
				.getByRole('button', {name: /^connect$/i})
				.first();
			await expect(
				connectButton,
				'navbar Connect should become actionable once the app has initialised',
			).toBeEnabled({timeout: 60_000});
			await connectButton.click();

			// Connect using Dev Mode (handles both connection modal and funding if needed)
			await connectWalletDevMode(page, walletAccountIndex);
		}

		// Never hand a test a page that is not actually connected.
		await expectWalletConnected(page);

		// Fund whatever the app will spend from. This has to happen AFTER
		// connecting: the burner generates its accounts and the signer is derived
		// at sign-in, so neither address exists before this point. The signer
		// especially starts empty by nature - it is a fresh key, not the user's
		// funded wallet - and it is what the demo sends through, so without this
		// every write test would fail for want of gas.
		await fundAppSenders(page);

		// The input must be interactive before the test starts driving it.
		await expect(input).toBeEnabled({timeout: 30_000});

		await use(page);
	},

	/**
	 * Provides a function to connect wallet on demand.
	 */
	connectWallet: async ({fundWallets, walletAccountIndex}, use) => {
		// Ensure any impersonated wallets are funded before connecting
		await fundWallets();
		await use(async (page: Page) => {
			await connectWalletDevMode(page, walletAccountIndex);
			// The accounts the app spends from only exist once connected; see
			// fundAppSenders.
			await fundAppSenders(page);
		});
	},

	/**
	 * Provides a function to wait for transactions.
	 */
	waitForTransaction: async ({}, use) => {
		await use(waitForTransactionComplete);
	},

	/**
	 * Provides the atomic submit-and-settle helper.
	 */
	submitGreeting: async ({}, use) => {
		await use(submitGreeting);
	},

	authoriseBrowser: async ({}, use) => {
		await use(authoriseBrowser);
	},

	walletAccounts: async ({}, use) => {
		await use(walletAccounts);
	},

	/**
	 * Fund every account the wallet holds.
	 *
	 * For the tests that pay with an account OTHER than the one signed in: the
	 * burner generates its accounts per browser context, so which one the payment
	 * picker lands on cannot be known in advance, and an unfunded payer cannot
	 * pay. Funding all of them removes the guess.
	 */
	fundWalletAccounts: async ({}, use) => {
		await use(async (page: Page) => {
			for (const address of await walletAccounts(page)) {
				await fundAddressViaHardhat(address, '100');
			}
		});
	},

	topUpState: async ({}, use) => {
		await use(topUpState);
	},

	isDelegateRegistered: async ({}, use) => {
		await use(isDelegateRegistered);
	},
});

export {expect};

// Re-export describe for convenience
export const describe = test.describe;
