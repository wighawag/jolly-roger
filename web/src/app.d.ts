// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		/**
		 * Shallow-routing state. `overlayToken` marks a history entry as belonging
		 * to an open view overlay, so the app only ever pops entries it created
		 * (see `$lib/core/navigation`, and ADR-0004 on the `work` branch).
		 */
		interface PageState {
			overlayToken?: string;
		}
		// interface Platform {}
	}
}

export {};
