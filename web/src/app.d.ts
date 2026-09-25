// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type {SurfaceChrome} from '$lib/ui/chrome';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		/**
		 * WHAT A PAGE MAY DECLARE ABOUT THE CHROME ABOVE IT, and the only reason
		 * this interface is no longer commented out.
		 *
		 * OPTIONAL, AND ITS ABSENCE IS THE ANSWER FOR ALMOST EVERY PAGE: a surface
		 * that declares nothing gets the app's chrome, which is what it has always
		 * had. A page declares its own only when the app's chrome would be making
		 * false claims about what the player is looking at - a world that owns the
		 * page rather than sitting in it. `$lib/ui/chrome` holds that test, the two
		 * obligations on a declared navbar, and why the declaration belongs to the
		 * route instead of to the layout.
		 *
		 * DECLARED HERE rather than inferred, because the reader is
		 * `routes/+layout.svelte`, which sees `page.data` for whichever page is
		 * showing and cannot be typed from any one route's load.
		 */
		interface PageData {
			surfaceChrome?: SurfaceChrome;
		}
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
