<script lang="ts">
	import type {ServiceWorkerStore} from '.';
	import * as Alert from '$lib/shadcn/ui/alert/index.js';
	import {Button} from '$lib/shadcn/ui/button/index.js';
	import {cn} from '../utils/tailwind';

	/**
	 * Classes that can be customized on Update Notification components
	 * Use with the `classes` prop to style specific elements
	 */
	interface Classes {
		/** Root container */
		root?: string;
		alert?: string;
	}

	interface Props {
		serviceWorker: ServiceWorkerStore;
		class?: string;
		classes?: Partial<Classes>;
	}

	const {serviceWorker, class: className, classes = {}}: Props = $props();

	function skip() {
		serviceWorker.skip();
	}

	function accept() {
		serviceWorker.skipWaiting();
	}

	const updateAvailable = $derived(
		$serviceWorker &&
			!$serviceWorker.notSupported &&
			!$serviceWorker.registering &&
			$serviceWorker.updateAvailable &&
			$serviceWorker.registration,
	);
</script>

{#if updateAvailable}
	<div
		class={cn(
			'fixed top-0 left-0 z-50 w-full border-b p-2 shadow-sm',
			className,
			classes.root,
		)}
	>
		<Alert.Root
			class={cn(
				'mx-auto flex max-w-2xl flex-col items-start justify-between gap-4 py-3 sm:flex-row sm:items-center sm:py-2',
				classes.alert,
			)}
		>
			<div>
				<Alert.Title>Update Available</Alert.Title>
				<Alert.Description
					>A new version is ready. Update to get it.</Alert.Description
				>
			</div>
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={skip}>Later</Button>
				<Button size="sm" onclick={accept}>Update Now</Button>
			</div>
		</Alert.Root>
	</div>
{/if}
