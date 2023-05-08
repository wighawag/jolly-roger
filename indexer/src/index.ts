import {MergedAbis, JSProcessor, fromJSProcessor} from 'ethereum-indexer-js-processor';
import contractsInfo from './contracts';
import {Data} from './types/data';

const TinyRogerIndexerProcessor: JSProcessor<MergedAbis<typeof contractsInfo.contracts>, Data> = {
	version: '__VERSION_HASH__',
	construct(): Data {
		return {greetings: [], totalTransfered: 0n};
	},
	onMessageChanged(json, event) {
		const findIndex = json.greetings.findIndex((v) => v.account === event.args.user);

		if (findIndex === -1) {
			json.greetings.push({account: event.args.user, message: event.args.message});
		} else {
			json.greetings[findIndex].message = event.args.message + ` (${event.args.timestamp})`;
		}
	},

	// onTransfer(json, event) {
	// 	json.totalTransfered += event.args.value;
	// },
};

export const createProcessor = fromJSProcessor(() => TinyRogerIndexerProcessor);
