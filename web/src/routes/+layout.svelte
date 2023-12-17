<script>
	import '../app.css';
	import {name, description, themeColor, canonicalURL, appleStatusBarStyle, ENSName} from 'web-config';
	import NewVersionNotification from '$lib/components/web/NewVersionNotification.svelte';
	import NoInstallPrompt from '$lib/components/web/NoInstallPrompt.svelte';
	import {url} from '$lib/utils/path';

	import Install from '$lib/components/web/Install.svelte';
	import Footer from '$lib/components/structure/Footer.svelte';
	import Header from '$lib/components/structure/Header.svelte';

	const host = canonicalURL.endsWith('/') ? canonicalURL : canonicalURL + '/';
	const previewImage = host + 'preview.png';
</script>

<svelte:head>
	<title>{name}</title>
	<meta name="title" content={name} />
	<meta name="description" content={description} />
	{#if ENSName}<meta name="Dwebsite" content={ENSName} />
	{/if}

	<meta property="og:type" content="website" />
	<meta property="og:url" content={host} />
	<meta property="og:title" content={name} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={previewImage} />
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:url" content={host} />
	<meta property="twitter:title" content={name} />
	<meta property="twitter:description" content={description} />
	<meta property="twitter:image" content={previewImage} />

	<!-- minimal -->
	<!-- use SVG, if need PNG, adapt accordingly -->
	<!-- TODO automatise -->
	<link rel="icon" href={url('/pwa/favicon.svg')} type="image/svg+xml" />
	<link rel="icon" href={url('/pwa/favicon.ico')} sizes="any" /><!-- 32×32 -->
	<link rel="apple-touch-icon" href={url('/pwa/apple-touch-icon.png')} /><!-- 180×180 -->
	<link rel="manifest" href={url('/pwa/manifest.webmanifest')} />

	<!-- extra info -->
	<meta name="theme-color" content={themeColor} />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content={name} />

	<!-- apple -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content={appleStatusBarStyle} />
	<meta name="apple-mobile-web-app-title" content={name} />
</svelte:head>

<div class="wrapper">
	<Header />

	<slot />

	<!--TEMPLATE_REMOVE-->
	<!-- <div id="footer"> -->
	<Footer />
	<!-- </div> -->
	<!--TEMPLATE_REMOVE-->
</div>

<!-- Disable native prompt from browsers -->
<NoInstallPrompt />
<!-- You can also add your own Install Prompt: -->
<!-- <Install src={url('/icon.svg')} alt="Jolly Roger" /> -->

<!-- Here is Notification for new version -->
<NewVersionNotification src={url('/icon.svg')} alt="Jolly Roger" />

<style>
	/* We wrap our app in this div */
	/* So we can move the footer to the bottom (see margin-top:auto) */
	/* This use flex flex-direction column to put each element vertically 
		And use min-height to ensure all speace is taken */
	/* This assumes html, body and any other anecsotr of .wrapper have height:100% */
	.wrapper {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}

	/* This goes in <Footer so we marging-top */
	/* Note we put it here rather than in Footer because Footer has no way to know how it will be placed */
	/* Alternatively we could have wrapped Footer in yet another div, see below */
	.wrapper :global(footer) {
		margin-top: auto;
	}
	/* #footer {
		margin-top: auto;
	} */
</style>
