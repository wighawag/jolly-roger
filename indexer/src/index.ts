import {MergedAbis, JSProcessor, fromJSProcessor} from 'ethereum-indexer-js-processor';
import contractsInfo from './contracts';

// you declare the types for your in-browswe DB.
export type Data = {
	greetings: {account: `0x${string}`; message: string}[];
};

const TinyRogerIndexerProcessor: JSProcessor<MergedAbis<typeof contractsInfo.contracts>, Data> = {
	// version is automatically populated via version.cjs to let the browser knows to reindex on changes
	version: '__VERSION_HASH__',
	construct(): Data {
		// you return here the starting state, here an empty array for the greetings
		return {greetings: []};
	},
	onMessageChanged(json, event) {
		// we lookup existing message from this user:
		const findIndex = json.greetings.findIndex((v) => v.account === event.args.user);

		// the message is one of the args of the event object (automatically populated and typed! from the abi)
		const message = event.args.message;

		if (findIndex === -1) {
			// if none message exists from that user we push a new entry
			json.greetings.push({
				account: event.args.user,
				message: message,
			});
		} else {
			// else we edit the message
			json.greetings[findIndex].message = message;
		}
	},

	// onTransfer(json, event) {
	// 	json.totalTransfered += event.args.value;
	// },
};

export const createProcessor = fromJSProcessor(() => TinyRogerIndexerProcessor);
