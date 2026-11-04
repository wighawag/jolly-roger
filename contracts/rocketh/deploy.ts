import {
	type Accounts,
	type Data,
	type Extensions,
	extensions,
} from './config.js';

// ----------------------------------------------------------------------------
// we re-export the artifacts, so they are easily available from the alias
import * as artifacts from '../generated/artifacts/index.js';
export {artifacts};
// ----------------------------------------------------------------------------
// we create the rocketh functions we need by passing the extensions to the
//  setup function
import {setupDeployScripts} from 'rocketh';
// `execute` reports guarded setup calls to the LAN build, and only to it: see
// ./guard-recording.ts.
import {withGuardRecording} from './guard-recording.js';
const {deployScript} = setupDeployScripts<Extensions, Accounts, Data>(
	withGuardRecording(extensions),
);

export {deployScript};
