import {RegistryState} from './types';

export class Registry {
	protected state!: RegistryState;
	public initialState: RegistryState;
	protected pending: boolean = false;

	constructor() {
		this.initialState = {greetings: []};
	}

	handle(state: RegistryState, pending: boolean = false) {
		this.pending = pending;
		this.state = state;
	}

	setMessageFor(account: `0x${string}`, message: string, dayTimeInSeconds: number) {
		const findIndex = this.state.greetings.findIndex((v) => v.account === account);
		if (findIndex === -1) {
			try {
				this.state.greetings.push({
					account,
					message,
					pending: this.pending,
				});
			} catch (err) {
				console.error(err);
			}
		} else {
			this.state.greetings[findIndex].message = message;
			this.state.greetings[findIndex].pending = this.pending;
		}
	}
}
