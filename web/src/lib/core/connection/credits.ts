import type {JSONValue, KnownChainProperties} from '$lib/deployments-store';

/**
 * Credits: the signer's gas balance, denominated in game actions.
 *
 * A signer is a key the app holds so it can send the user's moves without a
 * wallet popup each time, which means it pays gas out of its own balance. That
 * balance is native currency, but showing it as such asks a player to reason
 * about wei and gas prices in order to answer the only question they have: how
 * many more moves can I make. Credits answer it directly - one credit is one
 * action's worth of gas at the worst gas price the chain is expected to charge.
 *
 * The denomination is CONFIGURATION, not measurement: it uses an expected worst
 * gas price rather than the live one on purpose. A number that drifts with the
 * mempool would let a player's credits fall while they sit still, and would
 * make "you have 12 moves left" a promise the app cannot keep. Pricing at the
 * worst expected value makes the count a floor: the player gets at least that
 * many actions, usually more.
 *
 * Both properties have to be set for this to mean anything (see
 * {@link resolveCreditsConfig}), and a chain that sets neither simply shows
 * native currency instead. That is why this is optional rather than defaulted:
 * a wrong credit unit produces a confident, wrong move count, which is worse
 * than an honest balance in ETH.
 */
export type CreditsConfig = {
	/** Wei that one credit is worth. */
	creditUnit: bigint;
	/** How many credits one top-up buys. */
	creditsPerTopUp: number;
};

/** Credits bought by one top-up when the chain does not say otherwise. */
export const DEFAULT_CREDITS_PER_TOP_UP = 100;

/**
 * Chain properties this reads. Declared here rather than in
 * `KnownChainProperties` on purpose: the pair is app-level policy (what an
 * "action" costs in this game), not something every chain carries.
 */
export type CreditsChainProperties = {
	/**
	 * The highest gas price the app expects to pay on this chain, in wei. Chain
	 * specific, and deliberately pessimistic (see above).
	 */
	expectedWorstGasPrice?: JSONValue;
	/**
	 * Gas one credit buys, i.e. the gas a single user action costs. Game
	 * specific: the sum of the worst-case gas of the transactions one move sends.
	 */
	creditsGasMultiplier?: JSONValue;
	/** Credits obtained per top-up. Defaults to {@link DEFAULT_CREDITS_PER_TOP_UP}. */
	creditsPerTopUp?: JSONValue;
};

/**
 * Coerce a chain property to a positive bigint, or undefined.
 *
 * Accepts strings as well as numbers because a wei-scale gas price does not
 * survive JSON as a number (it exceeds Number.MAX_SAFE_INTEGER), so deployments
 * carry it as a decimal string. Anything else, including 0 and negatives, is
 * treated as "not configured": a zero credit unit would divide by zero, and
 * silently substituting a default would invent a move count out of nothing.
 */
function positiveBigInt(value: JSONValue | undefined): bigint | undefined {
	if (typeof value === 'bigint') return value > 0n ? value : undefined;
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value <= 0) return undefined;
		return BigInt(value);
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!/^\d+$/.test(trimmed)) return undefined;
		const parsed = BigInt(trimmed);
		return parsed > 0n ? parsed : undefined;
	}
	return undefined;
}

/**
 * Resolve the credits denomination for a chain, or undefined when the app
 * should keep showing native currency.
 *
 * Both halves are required. Either one alone leaves the credit unit unknown
 * (a gas price without an action size, or an action size without a price), and
 * a half-configured chain is much more likely to be a mistake than a request
 * for some default action cost - so it falls back to the honest thing rather
 * than to a guess.
 */
export function resolveCreditsConfig(
	properties: (Record<string, JSONValue> & KnownChainProperties) | undefined,
): CreditsConfig | undefined {
	const props = (properties ?? {}) as CreditsChainProperties;
	const gasPrice = positiveBigInt(props.expectedWorstGasPrice);
	const gasPerCredit = positiveBigInt(props.creditsGasMultiplier);
	if (gasPrice === undefined || gasPerCredit === undefined) return undefined;

	const configuredTopUp = positiveBigInt(props.creditsPerTopUp);
	return {
		creditUnit: gasPrice * gasPerCredit,
		creditsPerTopUp: configuredTopUp
			? Number(configuredTopUp)
			: DEFAULT_CREDITS_PER_TOP_UP,
	};
}

/**
 * Credits held, to two decimals.
 *
 * Rounded DOWN, always: credits are a claim about what the player can still
 * afford, so 0.999 of a credit must not read as 1. The same reason keeps the
 * division in bigint until after the scaling - going through Number first would
 * round a wei balance to the nearest representable double and could round up.
 */
export function toCredits(balance: bigint, creditUnit: bigint): number {
	if (creditUnit <= 0n) return 0;
	const hundredths = (balance * 100n) / creditUnit;
	return Number(hundredths) / 100;
}

/**
 * Display form of a credit count: trailing zeros dropped, so a whole number of
 * credits reads as "100" rather than "100.00".
 */
export function formatCredits(credits: number): string {
	return String(Math.round(credits * 100) / 100);
}

/** Wei one top-up sends, i.e. what {@link CreditsConfig.creditsPerTopUp} costs. */
export function topUpAmount(config: CreditsConfig): bigint {
	return config.creditUnit * BigInt(config.creditsPerTopUp);
}
