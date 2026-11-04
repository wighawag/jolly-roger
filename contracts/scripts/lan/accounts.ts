import {mnemonicToAccount} from 'viem/accounts';

/**
 * The accounts a LAN box can sign for, in order: the first 20 of the test
 * mnemonic, which its genesis funds and its deploy command is given
 * (`--mnemonic-index`). Hardhat's in-process chain uses the same mnemonic, so
 * the deployer (0), the admin (1) and any other named account are among them.
 */
export const MNEMONIC =
	'test test test test test test test test test test test junk';
export const MNEMONIC_ACCOUNTS: readonly string[] = Array.from(
	{length: 20},
	(_, addressIndex) => mnemonicToAccount(MNEMONIC, {addressIndex}).address,
);
