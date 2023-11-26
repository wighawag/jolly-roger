import {MergedAbis, JSProcessor, fromJSProcessor} from 'ethereum-indexer-js-processor';
import contractsInfo from './contracts';
import {Registry, type RegistryState} from 'jolly-roger-common';

// We instantiate the registry (js-version)
// This will take care of keeping track of changes to the state
// The indexer role is thus just to feed the handler on events
// We do it this way so we can reuse the registry in the frontend for other use case
// predicting the outcome of updates for examples
const registry = new Registry();

const JollyRogerIndexerProcessor: JSProcessor<MergedAbis<typeof contractsInfo.contracts>, RegistryState> = {
	// version is automatically populated via version.cjs to let the browser knows to reindex on changes
	// this only work if the content of the generated file is changed, so if it import changed files, this won't be detected
	version: '__VERSION_HASH__',

	construct(): RegistryState {
		return registry.initialState;
	},

	// The Processor can implement any of the event using `on<EventName>(state, event)` method
	onMessageChanged(state, event) {
		// we ensure the registry (js-version) is being given the new state
		// this is important as we are dealing here with pure function and `state` could be a different instance each time
		registry.handle(state);

		// then the registry (js-version) is called to take care of updating the state
		registry.setMessageFor(event.args.user, event.args.message, event.args.dayTimeInSeconds);
	},
};

export const createProcessor = fromJSProcessor(() => JollyRogerIndexerProcessor);

/*
// The alternative to use an handler is to perform all the step right in that indexer file
import {MergedAbis, JSProcessor, fromJSProcessor} from 'ethereum-indexer-js-processor';
import contractsInfo from './contracts';

// you declare the types for your in-browswe DB.
export type Data = {
	greetings: {account: `0x${string}`; message: string}[];
};

const JollyRogerIndexerProcessor: JSProcessor<MergedAbis<typeof contractsInfo.contracts>, Data> = {
	// version is automatically populated via version.cjs to let the browser knows to reindex on changes
	version: '__VERSION_HASH__',
	
	construct(): Data {
		// you return here the starting state, here an empty array for the greetings
		return {greetings: []};
	},

	// The Processor can implement any of the event using `on<EventName>(state, event)` method
	onMessageChanged(state, event) {
		// we lookup existing message from this user:
		const findIndex = state.greetings.findIndex((v) => v.account === event.args.user);

		// the message is one of the args of the event object (automatically populated and typed! from the abi)
		const message = event.args.message;

		if (findIndex === -1) {
			// if none message exists from that user we push a new entry
			state.greetings.push({
				account: event.args.user,
				message: message,
			});
		} else {
			// else we edit the message
			state.greetings[findIndex].message = message;
		}
	},
};

export const createProcessor = fromJSProcessor(() => JollyRogerIndexerProcessor);
*/
