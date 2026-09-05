<script lang="ts">
	import {getAppContext} from '$lib';
	import {onMount} from 'svelte';
	import {slide} from 'svelte/transition';
	import {createTxObserverDebugController} from './tx-observer-debug-controller';

	const context = getAppContext();
	const {txObserverDebug} = context;

	// All data, actions and lifecycle live in the controller (plain stores).
	const controller = createTxObserverDebugController(context);
	const accountOperations = controller.operations;
	const eventLog = controller.eventLog;
	onMount(() => controller.start());

	// UI-only state
	let isMinimized = $state(false);

	function formatTimestamp(ts: number): string {
		return new Date(ts).toLocaleTimeString();
	}

	function formatTimeAgo(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 1000) return 'just now';
		if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		return `${Math.floor(diff / 3600000)}h ago`;
	}

	function getInclusionBadgeColor(inclusion?: string): string {
		switch (inclusion) {
			case 'Included':
				return 'bg-green-500';
			case 'InMemPool':
				return 'bg-yellow-500';
			case 'NotFound':
				return 'bg-red-500';
			case 'Dropped':
				return 'bg-gray-500';
			default:
				return 'bg-blue-500';
		}
	}

	function getStatusBadgeColor(status?: string): string {
		switch (status) {
			case 'Success':
				return 'bg-green-500';
			case 'Failure':
				return 'bg-red-500';
			default:
				return 'bg-gray-500';
		}
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text);
	}
</script>

<div
	class="fixed right-4 bottom-4 z-9999 max-h-[70vh] w-105 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 text-xs text-gray-100 shadow-xl"
	transition:slide
>
	<!-- Header -->
	<div class="flex items-center justify-between bg-gray-800 px-3 py-2">
		<div class="flex items-center gap-2">
			<span class="font-bold text-yellow-400">🔍 TX Debug</span>
			<span
				class="rounded px-1.5 py-0.5 text-[10px] font-bold {$txObserverDebug.isLeader
					? 'bg-green-600 text-white'
					: 'bg-gray-600 text-gray-300'}"
				title={$txObserverDebug.isLeader
					? 'This tab is the leader and processes transactions'
					: 'This tab is a follower (another tab is processing)'}
			>
				{$txObserverDebug.isLeader ? '👑 Leader' : '👤 Follower'} ({$txObserverDebug.processCount})
			</span>
			{#if $txObserverDebug.lastProcessTime}
				<span class="text-[10px] text-gray-400">
					Last: {formatTimeAgo($txObserverDebug.lastProcessTime)}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			<button
				class="rounded px-2 py-1 text-[10px] hover:bg-gray-700"
				title="Sync operations to observer"
				onclick={() => controller.sync()}
			>
				⚡ Sync
			</button>
			<button
				class="rounded px-2 py-1 text-[10px] hover:bg-gray-700"
				title="Trigger observer.process()"
				onclick={() => controller.process()}
			>
				▶️ Process
			</button>
			<button
				class="rounded px-2 py-1 hover:bg-gray-700"
				onclick={() => controller.refresh()}
			>
				🔄
			</button>
			<button
				class="rounded px-2 py-1 hover:bg-gray-700"
				onclick={() => (isMinimized = !isMinimized)}
			>
				{isMinimized ? '▲' : '▼'}
			</button>
		</div>
	</div>

	{#if !isMinimized}
		<div class="max-h-[55vh] overflow-y-auto p-3">
			<!-- Account Operations Section -->
			<div class="mb-3">
				<h3 class="mb-2 font-bold text-blue-400">
					📋 Operations ({Object.keys($accountOperations).length})
				</h3>
				{#if Object.keys($accountOperations).length === 0}
					<p class="text-gray-500 italic">No operations</p>
				{:else}
					<div class="space-y-2">
						{#each Object.entries($accountOperations) as [id, op]}
							{@const operation = op as {
								metadata: {
									functionName?: string;
								};
								state?: {
									inclusion?: string;
									outcome?: string;
									final?: boolean;
								};
								attempts: Array<{
									hash: string;
									nonce: number;
									broadcastTimestampMs: number;
								}>;
							}}
							<div class="rounded border border-gray-700 bg-gray-800 p-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="font-mono text-[10px] text-gray-400">{id}</span>
									<div class="flex gap-1">
										<span
											class="rounded px-1.5 py-0.5 text-[10px] font-bold {getInclusionBadgeColor(
												operation.state?.inclusion,
											)}"
										>
											{operation.state?.inclusion ?? 'No State'}
										</span>
										{#if operation.state?.outcome}
											<span
												class="rounded px-1.5 py-0.5 text-[10px] font-bold {getStatusBadgeColor(
													operation.state?.outcome,
												)}"
											>
												{operation.state?.outcome}
											</span>
										{/if}
										{#if operation.state?.final}
											<span
												class="rounded bg-purple-500 px-1.5 py-0.5 text-[10px] font-bold"
											>
												Final
											</span>
										{/if}
									</div>
								</div>
								<div class="mb-1 text-[10px] text-gray-400">
									{operation.metadata.functionName ?? 'unknown'}
								</div>
								{#each operation.attempts as tx}
									<div class="flex items-center gap-1 text-gray-400">
										<button
											type="button"
											class="font-mono text-[10px] text-blue-400 hover:underline"
											onclick={() => copyToClipboard(tx.hash)}
										>
											{tx.hash.slice(0, 14)}...{tx.hash.slice(-6)}
										</button>
										<button
											type="button"
											class="rounded bg-gray-700 px-1 text-[9px] text-yellow-400 hover:bg-gray-600"
											onclick={() =>
												controller.checkTxStatus(tx.hash as `0x${string}`)}
										>
											🔎
										</button>
										<span class="text-[9px] text-gray-500">
											n:{tx.nonce}
										</span>
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Event Log Section -->
			<div>
				<h3 class="mb-2 font-bold text-orange-400">
					📝 Events ({$eventLog.length})
				</h3>
				{#if $eventLog.length === 0}
					<p class="text-gray-500 italic">No events yet</p>
				{:else}
					<div class="max-h-32 space-y-1 overflow-y-auto">
						{#each $eventLog as event}
							<div class="rounded border border-gray-700 bg-gray-800 p-1.5">
								<div class="flex items-center gap-2">
									<span class="text-[9px] text-gray-500">
										{formatTimestamp(event.timestamp)}
									</span>
									<span class="text-[10px] font-bold text-yellow-400"
										>{event.type}</span
									>
								</div>
								<pre
									class="mt-0.5 overflow-x-auto text-[9px] text-gray-400">{event.data}</pre>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
