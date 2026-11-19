import {createNavigationService} from '../../../../../src/lib/core/navigation';
import {createOverlayRegistry} from '../../../../../src/lib/core/ui/overlay';
import {createConfirmation} from '../../../../../src/lib/core/ui/confirm/confirmation';
import {createFakeBrowser} from '../../navigation/fake-browser';

/**
 * A confirmation store on a real registry, over a fake browser.
 *
 * The confirmation is a prompt overlay, so it cannot be built without one, and
 * a stub registry would be a second implementation of the behaviour under test:
 * the interesting cases here (a navigation settling the promise, the back
 * gesture settling it) are the REGISTRY'S doing, and a fake would have to be
 * taught them to be worth anything.
 *
 * `registerRenderer` is called because the registry warns in DEV about opening
 * an overlay nothing renders, and in a test that warning would be noise about
 * the harness rather than about the code.
 */
export function makeConfirmation() {
	const browser = createFakeBrowser();
	const navigation = createNavigationService();
	const registry = createOverlayRegistry(navigation);
	navigation.attach(browser.driver);

	const confirmation = createConfirmation(registry);
	const stopRendering = confirmation.registerRenderer();

	return {browser, navigation, registry, confirmation, stopRendering};
}
