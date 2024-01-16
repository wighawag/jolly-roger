import {init} from 'web3-connection';
import {
	contractsInfos,
	defaultRPC,
	initialContractsInfos,
	blockTime,
	localRPC,
	doNotEncryptLocally,
	syncInfo,
} from '$lib/config';
import {JollyRogerAccountData} from '$lib/account/account-data';
import {initTransactionProcessor} from 'ethereum-tx-observer';
import {initViemContracts} from 'web3-connection-viem';
import {logs} from 'named-logs';
import {stringToHex} from 'viem';
import {get} from 'svelte/store';

const logger = logs('jolly-roger');

export const accountData = new JollyRogerAccountData();

// devNetwork is used for different purposes:
//  - allow to detect Metamask cache issue
//  - allow to perform raw call like eth_setNextTimestamp, etc...
// But note that Jolly-Roger is designed to work without external RPC
// All other request will go through the user's wallet provider
// This is of course configurable, see PUBLIC_ETH_NODE_URI and PUBLIC_ETH_NODE_URI_<network name>
const devNetwork =
	typeof window != 'undefined' && localRPC
		? {
				url: localRPC.url,
				chainId: localRPC.chainId,
				checkCacheIssues: true,
		  }
		: undefined;

const stores = init({
	autoConnectUsingPrevious: true,
	options: ['builtin'],
	parameters: {
		blockTime: blockTime || 5,
		finality: 12, // TODO
	},
	defaultRPC,
	networks: initialContractsInfos,
	provider: {
		errorOnTimeDifference: false,
	},
	observers: {
		onTxSent(tx, hash) {
			accountData.onTxSent(tx, hash as `0x${string}`); // TODO web3-connection 0x{string}
		},
	},
	acccountData: {
		async loadWithNetworkConnected(state, setLoadingMessage, waitForStep) {
			const chainId = state.network.chainId;
			const address = state.address;

			let remoteSyncEnabled = false;
			let signature: `0x${string}` | undefined;
			if (syncInfo || !doNotEncryptLocally) {
				const private_signature_storageKey = `__private_signature__${address.toLowerCase()}`;
				try {
					const fromStorage = localStorage.getItem(private_signature_storageKey);
					if (fromStorage && fromStorage.startsWith('0x')) {
						signature = fromStorage as `0x${string}`;
					}
				} catch (err) {}

				if (!signature) {
					async function signMessage() {
						const msg = stringToHex(
							'Welcome to Jolly-Roger, Please sign this message only on trusted frontend. This gives access to your local data that you are supposed to keep secret.',
						);
						const signature = await state.connection.provider
							.request({
								method: 'personal_sign',
								params: [msg, address],
							})
							.catch((e: any) => {
								account.rejectLoadingStep();
							});
						account.acceptLoadingStep(signature);
					}
					// setLoadingMessage('Please Sign The Authentication Message To Go Forward');

					let doNotAskAgainSignature = false;
					if (syncInfo) {
						remoteSyncEnabled = true;
						const remoteSync_storageKey = `__remoteSync_${address.toLowerCase}`;
						try {
							const fromStorage = localStorage.getItem(remoteSync_storageKey);
							if (fromStorage === 'true') {
								remoteSyncEnabled = true;
							} else if (fromStorage === 'false') {
								remoteSyncEnabled = false;
							}
						} catch (err) {}
						console.log({remoteSyncEnabled});
						const {doNotAskAgainSignature: saveSignature, remoteSyncEnabled: remoteSyncEnabledAsked} =
							(await waitForStep('WELCOME', {
								remoteSyncEnabled,
							})) as {
								remoteSyncEnabled: boolean;
								doNotAskAgainSignature: boolean;
							};
						doNotAskAgainSignature = saveSignature;
						remoteSyncEnabled = remoteSyncEnabledAsked;
						try {
							localStorage.setItem(remoteSync_storageKey, remoteSyncEnabled ? 'true' : 'false');
						} catch (err) {}
					} else {
						const {doNotAskAgainSignature: saveSignature} = (await waitForStep('WELCOME')) as {
							doNotAskAgainSignature: boolean;
						};
						doNotAskAgainSignature = saveSignature;
					}

					signMessage();
					signature = (await waitForStep('SIGNING')) as `0x${string}`;
					if (doNotAskAgainSignature) {
						try {
							localStorage.setItem(private_signature_storageKey, signature);
						} catch (err) {}
					}
				}
			}

			await accountData.load(
				{
					address,
					chainId,
					genesisHash: state.network.genesisHash || '',
					localKey: signature ? (signature.slice(0, 66) as `0x${string}`) : undefined,
					doNotEncryptLocally,
				},
				remoteSyncEnabled ? syncInfo : undefined,
			);
		},
		async unload() {
			await accountData.unload();
		},
	},
	devNetwork,
});

export const txObserver = initTransactionProcessor({finality: 12}); // TODO config.finality

// we hook up accountData and txObserver
// they do not need to know about each other
// except that account data follow the same type of "pending tx" as input/output
// but accountData can be strucutred as it wishes otherwise. just need to emit an event for "clear" and "newTx"
// and since accountData implement load and unload and is passed to web3-connection, these load and unload will be called automatically
accountData.on((event) => {
	switch (event.name) {
		case 'clear':
			txObserver.clear();
			break;
		case 'newTx':
			txObserver.add(event.txs);
			break;
	}
});
txObserver.onTx((v) => {
	logger.info(`onTx ${v.hash}`);
	accountData.updateTx(v);
});
stores.connection.onNewBlock(() => {
	logger.info(`onNewBlock`);
	txObserver.process();
});
stores.connection.subscribe(($connection) => {
	if ($connection.provider) {
		txObserver.setProvider($connection.provider);
	}
});

contractsInfos.subscribe((contractsInfos) => {
	stores.connection.updateContractsInfos(contractsInfos);
});

export const {connection, network, account, pendingActions, execution, execute, devProvider} = stores;

export const contracts = initViemContracts(execute);

if (typeof window !== 'undefined') {
	(window as any).execution = execution;
	(window as any).connection = connection;
	(window as any).network = network;
	(window as any).account = account;
	(window as any).pendingActions = pendingActions;

	(window as any).accountData = accountData;
	(window as any).txObserver = txObserver;
	(window as any).get = get;
}
