<script lang="ts">
	import {version} from '$app/environment';
	import {page} from '$app/state';
	import {url} from '$lib/core/utils/web/path';

	interface Props {
		type?: 'website' | 'article';
		title: string;
		name?: string | null;
		description?: string | null;
		image?: string | null;
		host: string;
		ENSName?: string | null;
		themeColor?: string | null;
		appleStatusBarStyle?: string | null;
		iconExtension?: string;
	}

	let {
		type,
		title,
		description,
		image,
		host,
		name,
		ENSName,
		appleStatusBarStyle,
		themeColor,
		iconExtension,
	}: Props = $props();

	let pageURL = $derived(`${host}${page.url.pathname}`);
	let isHome = $derived(page.url.pathname === '/');

</script>

<svelte:head>
	<title>{title}</title>
	<meta name="title" content={title} />
	<meta property="og:title" content={title} />
	<meta property="twitter:title" content={title} />

	<meta property="og:url" content={pageURL} />
	<meta property="twitter:url" content={pageURL} />

	<link rel="canonical" href={pageURL} />

	{#if isHome}
		{#if ENSName}
			<meta name="Dwebsite" content={ENSName} />
		{/if}
	{/if}

	{#if type}
		<meta property="og:type" content={type} />
	{/if}

	{#if description}
		<meta name="description" content={description} />
		<meta property="og:description" content={description} />
		<meta property="twitter:description" content={description} />
	{/if}
	{#if image}
		<meta property="og:image" content={image} />
		<meta property="twitter:image" content={image} />
		<meta property="twitter:card" content="summary_large_image" />
	{/if}

	<!-- minimal -->
	{#if iconExtension === 'svg'}
		<link rel="icon" href={url('/pwa/favicon.svg')} type="image/svg+xml" />
	{:else}
		<link
			rel="icon"
			href={url(`/pwa/favicon.${iconExtension}`)}
			type={`image/${iconExtension}`}
		/>
	{/if}
	<link rel="icon" href={url('/pwa/favicon.ico')} sizes="any" /><!-- 32×32 -->
	<link
		rel="apple-touch-icon"
		href={url('/pwa/apple-touch-icon.png')}
	/><!-- 180×180 -->
	<link rel="manifest" href={url('/pwa/manifest.webmanifest')} />

	<!-- extra info -->
	{#if themeColor}
		<meta name="theme-color" content={themeColor} />
	{/if}
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content={name || title} />

	<!-- apple -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	{#if appleStatusBarStyle}
		<meta
			name="apple-mobile-web-app-status-bar-style"
			content={appleStatusBarStyle}
		/>
	{/if}
	<meta name="apple-mobile-web-app-title" content={name || title} />

	<meta name="version" content={version} />
</svelte:head>
