<script lang="ts">
	import {dev, version} from '$app/environment';
	import {page} from '$app/state';

	import {
		name,
		description,
		themeColor,
		canonicalURL,
		appleStatusBarStyle,
		ENSName,
	} from '../web-config.json';
	import {url} from '$lib/core/utils/web/path';

	const host = canonicalURL.endsWith('/')
		? canonicalURL.slice(0, -1)
		: canonicalURL;
	const previewImage = host + '/preview.png';

	interface Props {
		type?: 'website' | 'article';
		title?: string;
		description?: string;
		image?: string;
		home?: boolean;
	}

	let overrides: Props = $props();

	let isHome = $derived(overrides.home || false);

	let metadata = $derived({
		type: overrides.type || 'website',
		title: overrides.title || name,
		description: overrides.description || description,
		image: overrides.image || previewImage,
		url: `${host}${page.url.pathname}`,
	});
</script>

<svelte:head>
	<title>{metadata.title}</title>
	<meta name="title" content={metadata.title} />
	<meta name="description" content={metadata.description} />
	{#if isHome}
		{#if ENSName}
			<meta name="Dwebsite" content={ENSName} />
		{/if}

		<!-- TODO get url -->
	{/if}

	<meta property="og:type" content={metadata.type} />
	<meta property="og:url" content={metadata.url} />
	<meta property="og:title" content={metadata.title} />
	<meta property="og:description" content={metadata.description} />
	<meta property="og:image" content={metadata.image} />
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:url" content={metadata.url} />
	<meta property="twitter:title" content={metadata.title} />
	<meta property="twitter:description" content={metadata.description} />
	<meta property="twitter:image" content={metadata.image} />

	<!-- minimal -->
	<!-- use SVG, if need PNG, adapt accordingly -->
	<!-- TODO automatise -->
	<link rel="icon" href={url('/pwa/favicon.png')} type="image/png" />
	<link rel="icon" href={url('/pwa/favicon.ico')} sizes="any" /><!-- 32×32 -->
	<link
		rel="apple-touch-icon"
		href={url('/pwa/apple-touch-icon.png')}
	/><!-- 180×180 -->
	<link rel="manifest" href={url('/pwa/manifest.webmanifest')} />

	<!-- extra info -->
	<meta name="theme-color" content={themeColor} />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content={name} />

	<!-- apple -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta
		name="apple-mobile-web-app-status-bar-style"
		content={appleStatusBarStyle}
	/>
	<meta name="apple-mobile-web-app-title" content={name} />

	<meta name="version" content={version} />
</svelte:head>
