<script lang="ts">
	import {Button as KitButton} from '$ui/button';
	import type {Snippet} from 'svelte';

	/**
	 * The button `core/` uses.
	 *
	 * A shim over whatever `$ui` resolves to, existing for one reason: it is the
	 * only widely-used thing `core/` takes from the UI kit (ten call sites here
	 * against one each for card, alert, avatar, spinner and popover). Without it,
	 * repainting `core/` means touching ten files; with it, one.
	 *
	 * The prop list is deliberately NARROWER than the kit's. It is the set
	 * `core/` actually uses, which makes it the contract a replacement has to
	 * satisfy: two variants, two sizes, a class and a click. A wrapper that
	 * forwarded everything would be a re-export pretending to be a seam, and
	 * would tell an implementer nothing about what they need to build.
	 *
	 * App code does NOT go through here and should not. An app owns its own look,
	 * so it can use the kit directly; this exists so the INHERITED part does not
	 * have to be edited to be repainted. See ../README.md.
	 */
	interface Props {
		/**
		 * `outline` for a secondary action beside a primary one, `ghost` for one
		 * that should not draw the eye (an icon, a dismiss). Omitted means the
		 * kit's default, which is the primary action.
		 */
		variant?: 'default' | 'outline' | 'ghost';
		/** `icon` for a square control with no label. Omitted means the default. */
		size?: 'default' | 'sm' | 'icon';
		class?: string;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
		/**
		 * Accessibility attributes pass through, and are part of the contract rather
		 * than an escape hatch. A `size="icon"` button has no text, so a replacement
		 * kit that drops these ships an unlabelled control: that is a defect, not a
		 * restyling. Listed explicitly rather than swept up by a rest spread, so the
		 * contract stays readable and a forwarded prop is a decision.
		 */
		'aria-label'?: string;
		'aria-describedby'?: string;
		'aria-expanded'?: boolean;
		'aria-pressed'?: boolean;
	}

	let {
		variant = 'default',
		size = 'default',
		class: className,
		disabled,
		type = 'button',
		onclick,
		children,
		...aria
	}: Props = $props();
</script>

<KitButton
	{variant}
	{size}
	class={className}
	{disabled}
	{type}
	{onclick}
	{...aria}
>
	{@render children?.()}
</KitButton>
