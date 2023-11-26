import {execute} from 'rocketh';
import 'rocketh-deploy-proxy';
import {context} from './_context';

export default execute(
	context,
	async ({deployViaProxy, accounts, artifacts}) => {
		await deployViaProxy(
			'Registry',
			{
				account: accounts.deployer,
				artifact: artifacts.GreetingsRegistry,
				args: [''],
			},
			{
				owner: accounts.deployer,
			},
		);
	},
	{tags: ['Registry', 'Registry_deploy']},
);
