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

	// ------------------------------------------------------------------------------------------------
	// PWA ASSET LINKS MUST BE RECOMPUTED ON NAVIGATION
	// ------------------------------------------------------------------------------------------------
	// `paths.relative` is set (it is what makes a build portable to IPFS, where
	// the site can live under any path), so `url()` returns a path relative to
	// the CURRENT page: `./pwa/x` at the root, `../pwa/x` one level down.
	//
	// Written inline as `href={url('/pwa/x')}` the expression has no reactive
	// dependency, so Svelte treats it as static and never recomputes it. A
	// client-side navigation then leaves the PREVIOUS page's relative path on the
	// element: arriving at a nested route still carrying `./pwa/x` resolves to
	// `<route>/pwa/x`, which 404s. A hard load is always correct, which is what
	// makes this easy to miss.
	//
	// Reading `page.url.pathname` here is the dependency that makes it re-run. It
	// is deliberate, not a redundant read: delete it and the links silently rot
	// again on every nested route.
	let pwa = $derived.by(() => {
		page.url.pathname;
		return {
			faviconSvg: url('/pwa/favicon.svg'),
			faviconExt: url(`/pwa/favicon.${iconExtension}`),
			faviconIco: url('/pwa/favicon.ico'),
			appleTouchIcon: url('/pwa/apple-touch-icon.png'),
			manifest: url('/pwa/manifest.webmanifest'),
		};
	});
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
		<link rel="icon" href={pwa.faviconSvg} type="image/svg+xml" />
	{:else}
		<link rel="icon" href={pwa.faviconExt} type={`image/${iconExtension}`} />
	{/if}
	<link rel="icon" href={pwa.faviconIco} sizes="any" /><!-- 32×32 -->
	<link rel="apple-touch-icon" href={pwa.appleTouchIcon} /><!-- 180×180 -->
	<link rel="manifest" href={pwa.manifest} />

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
