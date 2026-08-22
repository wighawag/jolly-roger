<script lang="ts">
	import {useDocumentLocation} from '$lib/core/capabilities';

	// Where we are and which build this is, from the app root rather than the
	// router: this renders on the SERVER, where the navigation service is inert
	// by design, and metadata that only appears after hydration is metadata no
	// crawler reads. See src/lib/kit/README.md.
	const documentLocation = useDocumentLocation();

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
		/**
		 * Resolves a static asset path (`/pwa/favicon.svg`) for this deployment.
		 *
		 * Passed in because where the app is deployed is the framework's business:
		 * the app supplies `$lib/kit/paths`'s `url`, and the default suits a site
		 * served from the root. NOT the route capability, which also preserves
		 * global query params: right for links, wrong for a favicon.
		 */
		assetUrl?: (path: string) => string;
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
		assetUrl = (path: string) => path,
	}: Props = $props();

	let pageURL = $derived(`${host}${documentLocation.pathname()}`);
	let isHome = $derived(documentLocation.pathname() === '/');
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
		<link rel="icon" href={assetUrl('/pwa/favicon.svg')} type="image/svg+xml" />
	{:else}
		<link
			rel="icon"
			href={assetUrl(`/pwa/favicon.${iconExtension}`)}
			type={`image/${iconExtension}`}
		/>
	{/if}
	<link
		rel="icon"
		href={assetUrl('/pwa/favicon.ico')}
		sizes="any"
	/><!-- 32×32 -->
	<link
		rel="apple-touch-icon"
		href={assetUrl('/pwa/apple-touch-icon.png')}
	/><!-- 180×180 -->
	<link rel="manifest" href={assetUrl('/pwa/manifest.webmanifest')} />

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

	<meta name="version" content={documentLocation.version()} />
</svelte:head>
