export type Greeting = {account: `0x${string}`; message: string; pending: boolean};
export type RegistryState = {
	greetings: Greeting[];
};
