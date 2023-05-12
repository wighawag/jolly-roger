/**
 * taken from : https://github.com/svelteuidev/svelteui/blob/822fedc4c08c1ba777b4d9a5780a737225601184/packages/svelteui-composables/src/actions/use-click-outside/use-click-outside.ts
 * With the `use-click-outside` action, a callback function will be fired whenever the user clicks outside of the dom node the action is applied to.
 *
 * ```tsx
 * <script>
 *     import { clickoutside } from './click-outside'
 *
 *     let open = true;
 * </script>
 *
 * <div use:clickoutside={{ enabled: open, callback: () => open = false }}>
 *
 *     <Button on:click={() => open = true}>Open Modal</Button>
 *
 *     {#if open}
 *         <div>
 *             This is a modal
 *         </div>
 *     {:else if !open}
 *         <div>
 *             There is no modal
 *         </div>
 *    {/if}
 * </div>
 * ```
 * @param params - Object that contains two properties {enabled: boolean, callback: (any) => unknown}
 * @see https://svelteui.org/actions/use-click-outside
 */

export type Action<T = any> = (
	node: HTMLElement,
	parameters?: T
) => {
	update?: (parameters: T) => any | void;
	destroy?: () => void;
};

export function clickoutside(
	node: HTMLElement,
	params: {enabled: boolean; callback: (node: HTMLElement) => unknown}
): ReturnType<Action> {
	const {enabled: initialEnabled, callback} = params;

	const handleOutsideClick = ({target}: MouseEvent) => {
		if (!node.contains(target as HTMLElement)) {
			callback(node);
		}
	};

	let currentEnabledStatus = initialEnabled;
	function update({enabled}: {enabled: boolean}) {
		if (enabled) {
			currentEnabledStatus = true;
			setTimeout(() => {
				if (currentEnabledStatus) {
					window.addEventListener('click', handleOutsideClick);
				}
			}, 1);
		} else {
			currentEnabledStatus = false;
			window.removeEventListener('click', handleOutsideClick);
		}
	}
	update({enabled: initialEnabled});
	return {
		update,
		destroy() {
			window.removeEventListener('click', handleOutsideClick);
		},
	};
}
