/**
 * WHERE THIS APP'S FAUCET IS, as the faucet button and the funds remedy read it.
 *
 * A value the app composes from its own configuration and provides at the root
 * as the `faucet` capability (`$lib/core/capabilities`), as it does its block
 * explorer: so nothing in `core/ui/faucet` reads the environment or the
 * deployments, and a copy of this folder runs in an app that configures its
 * faucet another way. jolly-roger composes it in `$lib/index.ts` from
 * `PUBLIC_FAUCET_API` and `PUBLIC_FAUCET_LINK`.
 *
 * Its two members are READ AT EACH CALL, as the block explorer's are, which
 * follows HMR and keeps the composing module's import free of reads (a test
 * that mocks `$env/static/public` without these variables still imports it).
 * A blank value is no value.
 */
export type Faucet = {
	/** The faucet's HTTP API, which claims without a popup. */
	api(): string | undefined;
	/** The faucet's page, opened in a popup when there is no API. */
	link(): string | undefined;
};

function present(value: string | undefined): string | undefined {
	return value && value.trim() ? value : undefined;
}

export function createFaucet(config: {
	api: () => string | undefined;
	link: () => string | undefined;
}): Faucet {
	return {
		api: () => present(config.api()),
		link: () => present(config.link()),
	};
}

/** Whether there is a faucet to offer: a provided one with an API or a link. */
export function faucetConfigured(faucet: Faucet | undefined): boolean {
	return Boolean(faucet && (faucet.api() || faucet.link()));
}
