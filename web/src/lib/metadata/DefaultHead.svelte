<script lang="ts">
	import {
		name,
		description,
		themeColor,
		canonicalURL,
		appleStatusBarStyle,
		ENSName,
		icon,
		preview,
	} from '../../web-config.json';
	import Head from '$lib/core/metadata/Head.svelte';

	interface Props {
		type?: 'website' | 'article';
		title?: string;
		description?: string;
		image?: string;
	}

	const host = canonicalURL.endsWith('/')
		? canonicalURL.slice(0, -1)
		: canonicalURL;
	// Read from web-config rather than hardcoded, so rebranding stays a
	// single-file job (the same reason `icon` lives there). `preview` is given as
	// a path under static/, which is served from the root.
	const previewImage = host + preview.replace(/^static\//, '/');

	let overrides: Props = $props();

	let metadata = $derived({
		type: overrides.type || 'website',
		title: overrides.title || name,
		description: overrides.description || description,
		image: overrides.image || previewImage,
	});

	let iconExtension = $derived.by(() => {
		const split = icon.split('.');
		return split[split.length - 1];
	});
</script>

<Head
	{host}
	title={metadata.title}
	description={metadata.description}
	{ENSName}
	{appleStatusBarStyle}
	{themeColor}
	image={metadata.image}
	{name}
	type={metadata.type}
	{iconExtension}
></Head>
