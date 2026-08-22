import {writable, type Readable} from 'svelte/store';
import type {TabMessage, TabLeaderService} from './types';
import {acquireLock, refreshLock, releaseLock} from './storage-lock';
import {randomId} from '$lib/core/utils/web/random-id';
import {
	CHANNEL_NAME,
	HEARTBEAT_INTERVAL,
	LEADER_TIMEOUT,
	ELECTION_DEBOUNCE,
} from './constants';

export function createTabLeaderService(): TabLeaderService {
	// Assigned in start(), not at construction: this service is built as part of
	// the app context, which is also constructed during SSR / prerender, and
	// nothing before start() needs an id. See ADR-0002 (`work` branch).
	let tabId = '';

	let channel: BroadcastChannel | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
	let electionTimer: ReturnType<typeof setTimeout> | undefined;
	let started = false;

	const _isLeader = writable<boolean>(false);
	let $isLeader = false;

	function setLeader(value: boolean) {
		if ($isLeader !== value) {
			$isLeader = value;
			_isLeader.set(value);
		}
	}

	function broadcast(message: TabMessage) {
		channel?.postMessage(message);
	}

	function announceLeadership() {
		broadcast({type: 'LEADER_ANNOUNCE', tabId, timestamp: Date.now()});
	}

	function announceResignation() {
		broadcast({type: 'LEADER_RESIGN', tabId, timestamp: Date.now()});
	}

	function sendHeartbeat() {
		if (!refreshLock(tabId)) {
			// Lost the lock (e.g., another tab took it while we were paused)
			yieldLeadership();
			return;
		}
		broadcast({type: 'LEADER_HEARTBEAT', tabId, timestamp: Date.now()});
	}

	function startHeartbeat() {
		stopHeartbeat();
		heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
	}

	function stopHeartbeat() {
		if (heartbeatTimer !== undefined) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
	}

	function resetTimeout() {
		stopTimeout();
		timeoutTimer = setTimeout(() => {
			// Leader timed out, try to elect ourselves
			startElection();
		}, LEADER_TIMEOUT);
	}

	function stopTimeout() {
		if (timeoutTimer !== undefined) {
			clearTimeout(timeoutTimer);
			timeoutTimer = undefined;
		}
	}

	function stopElectionTimer() {
		if (electionTimer !== undefined) {
			clearTimeout(electionTimer);
			electionTimer = undefined;
		}
	}

	function startElection() {
		stopElectionTimer();
		// Debounce to prevent rapid elections from multiple tabs
		electionTimer = setTimeout(() => {
			if (!started || $isLeader) return;
			claimLeadership();
		}, ELECTION_DEBOUNCE);
	}

	function claimLeadership() {
		const acquired = acquireLock(tabId);
		if (!acquired) {
			// Someone else holds a valid lock, back off
			resetTimeout();
			return;
		}

		setLeader(true);
		stopTimeout();
		stopElectionTimer();
		announceLeadership();
		startHeartbeat();
	}

	function yieldLeadership() {
		const wasLeader = $isLeader;
		setLeader(false);
		releaseLock(tabId);
		stopHeartbeat();
		if (wasLeader) {
			announceResignation();
		}
		resetTimeout();
	}

	function handleMessage(event: MessageEvent<TabMessage>) {
		const message = event.data;
		if (message.tabId === tabId) return;

		switch (message.type) {
			case 'LEADER_ANNOUNCE':
			case 'LEADER_HEARTBEAT':
				if ($isLeader) {
					// Resolve conflict: use tabId for deterministic tiebreak
					// We resolve regardless of message age to avoid leaving both tabs as leaders
					// (Issue: stale messages could leave dual-leader window open)
					if (tabId > message.tabId) {
						// We win, re-announce
						announceLeadership();
					} else {
						// We lose
						yieldLeadership();
					}
				} else {
					// We're a follower, reset our timeout since leader is alive
					stopElectionTimer();
					resetTimeout();
				}
				break;
			case 'LEADER_RESIGN':
				// Leader is gracefully resigning, start election immediately
				// This improves handover from ~5s (timeout) to ~100ms (election debounce)
				if (!$isLeader) {
					startElection();
				}
				break;
		}
	}

	function onBeforeUnload() {
		if ($isLeader) {
			announceResignation();
			releaseLock(tabId);
		}
	}

	function start() {
		if (started) return;
		started = true;
		// randomId(), not crypto.randomUUID(): the latter is secure-context only,
		// so it throws when the dev server is opened over a plain http LAN address
		// (i.e. from a phone on the same network).
		tabId = randomId();

		if (typeof BroadcastChannel === 'undefined') {
			// Fallback: no BroadcastChannel, always be leader
			setLeader(true);
			return;
		}

		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = handleMessage;

		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', onBeforeUnload);
		}

		// Try to acquire lock and become leader
		claimLeadership();
	}

	function stop() {
		if (!started) return;
		started = false;

		stopHeartbeat();
		stopTimeout();
		stopElectionTimer();

		if ($isLeader) {
			announceResignation();
			releaseLock(tabId);
		}
		setLeader(false);

		if (channel) {
			channel.onmessage = null;
			channel.close();
			channel = undefined;
		}

		if (typeof window !== 'undefined') {
			window.removeEventListener('beforeunload', onBeforeUnload);
		}
	}

	return {
		isLeader: {subscribe: _isLeader.subscribe} as Readable<boolean>,
		start,
		stop,
	};
}
