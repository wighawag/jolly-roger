/**
 * The deploy run so that every GUARDED `execute` it sends is remembered with
 * its guard, which is how a LAN box can replay a setup call (`setMinter`, a
 * role grant) idempotently: it reads the guard first, and sends the call only
 * when the chain does not already hold its effect.
 *
 * A guard is rocketh's declared read (`execute(contract, {..., guard: {kind:
 * 'call', on, functionName, args, equals}})`, @rocketh/read-execute): a view
 * call, or a storage slot, that says whether the call is still needed. Deploy
 * scripts should guard every setup call anyway, so a redeploy skips what is
 * done; this only listens (rocketh/guard-recording.ts) and changes nothing a
 * script does.
 *
 * WHAT IS RECORDED is the guard as raw bytes a box can evaluate with `cast`:
 * the read's target and calldata (or slot), and what it returns once the call
 * has landed. The box compares against that, and again after sending.
 *
 * An UNGUARDED execute is not recorded, and `replayable.ts` then refuses its
 * transaction: a box replaying it on every boot would repeat it.
 */
import {setupEnvironmentFromFiles} from '@rocketh/node';
import {
	type Accounts,
	type Data,
	type Extensions,
	extensions,
} from '../../rocketh/config.js';
import {
	installGuardRecorder,
	withGuardRecording,
	type Recorded,
} from '../../rocketh/guard-recording.js';

export type {Check, Recorded} from '../../rocketh/guard-recording.js';

/**
 * `loadAndExecuteDeploymentsFromFiles` (rocketh/environment.ts), with the
 * guarded calls of the run, and of anything sent through the environment it
 * returns, written into `recorded`.
 */
export function recordingEnvironment(recorded: Recorded) {
	const {loadAndExecuteDeploymentsFromFiles} = setupEnvironmentFromFiles<
		Extensions,
		Accounts,
		Data
	>(withGuardRecording(extensions));
	return (async (
		...args: Parameters<typeof loadAndExecuteDeploymentsFromFiles>
	) => {
		installGuardRecorder(recorded);
		return loadAndExecuteDeploymentsFromFiles(...args);
	}) as typeof loadAndExecuteDeploymentsFromFiles;
}
