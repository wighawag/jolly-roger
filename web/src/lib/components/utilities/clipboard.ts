// based on https://github.com/skeletonlabs/skeleton/blob/58d9780dafd4a7ca04b1086a30aac8c0dc3ce416/src/lib/actions/Clipboard/clipboard.ts
// Action: Clipboard

import type {ActionReturn} from 'svelte/action';

type Attributes = {
	newprop?: string;
	'on:copied': (e: CustomEvent<string>) => void;
};

type Parameter = string | {element: string} | {input: string};

export function clipboard(node: HTMLElement, args: Parameter): ActionReturn<Parameter, Attributes> {
	const onClick = () => {
		// Handle `data-clipboard` target based on object key
		if (typeof args === 'object') {
			// Element Inner HTML
			if ('element' in args) {
				const element: HTMLElement | null = document.querySelector(`[data-clipboard="${args.element}"]`);
				if (element?.innerHTML) {
					copyToClipboard(element?.innerHTML);
					node.dispatchEvent(new CustomEvent('copied', {detail: element?.innerHTML}));
				}
				return;
			}
			// Form Input Value
			if ('input' in args) {
				const input: HTMLInputElement | null = document.querySelector(`[data-clipboard="${args.input}"]`);
				if (input?.value) {
					copyToClipboard(input?.value);
					node.dispatchEvent(new CustomEvent('copied', {detail: input?.value}));
				}
				return;
			}
		}
		// Handle everything else.
		copyToClipboard(args);
		node.dispatchEvent(new CustomEvent('copied', {detail: args}));
	};
	// Event Listner
	node.addEventListener('click', onClick);
	// Lifecycle
	return {
		update(newArgs: any) {
			args = newArgs;
		},
		destroy() {
			node.removeEventListener('click', onClick);
		},
	};
}

// Shared copy method
function copyToClipboard(data: any): void {
	navigator.clipboard.writeText(String(data));
}
