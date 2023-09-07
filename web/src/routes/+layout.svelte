<script>
	import '../app.postcss';
	import ThemeChanger from '$lib/components/daisyui/ThemeChanger.svelte';
	import NavTabs from '$lib/components/daisyui/NavTabs.svelte';

	import {name, description, themeColor, canonicalURL, appleStatusBarStyle, ENSName} from 'web-config';
	import NewVersionNotification from '$lib/components/web/NewVersionNotification.svelte';
	import NoInstallPrompt from '$lib/components/web/NoInstallPrompt.svelte';
	import {url} from '$lib/utils/path';
	import Install from '$lib/components/web/Install.svelte';

	const host = canonicalURL.endsWith('/') ? canonicalURL : canonicalURL + '/';
	const previewImage = host + 'preview.png';
</script>

<svelte:head>
	<title>{name}</title>
	<meta name="title" content={name} />
	<meta name="description" content={description} />
	{#if ENSName}<meta name="Dwebsite" content={ENSName} /> {/if}

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

<div class="sticky top-0 z-50 navbar bg-base-100 min-h-0 p-1 border-b-2 border-primary">
	<div class="flex-1">
		<NavTabs
			pages={[
				{pathname: '/', title: 'Home'},
				{pathname: '/demo/', title: 'Demo'},
				{pathname: '/debug/', title: 'Debug'},
				{pathname: '/about/', title: 'About'},
			]}
		/>
	</div>
	<div class="flex-none">
		<ThemeChanger />
	</div>
</div>

<!-- Disable native prompt from browsers -->
<NoInstallPrompt />
<!-- You can also add your own Install Prompt: -->
<!-- <Install src={url('/icon.svg')} alt="Jolly Roger" /> -->

<!-- Here is Notification for new version -->
<NewVersionNotification src={url('/icon.svg')} alt="Jolly Roger" />

<!-- use -my-20 to ensure the navbar is considered when using min-h-screen to offset the footer (when content is too small)-->
<div class="-my-20 flex flex-col min-h-screen justify-between">
	<!--div to revert -my-20-->
	<div class="mt-20">
		<slot />
	</div>

</div>
