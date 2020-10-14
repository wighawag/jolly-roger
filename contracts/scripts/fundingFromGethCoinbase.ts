// script used to fund account from a geth coinbase account (geth --dev)
import {ethers} from '@nomiclabs/buidler';
import {BigNumber} from '@ethersproject/bignumber';
import {JsonRpcProvider} from '@ethersproject/providers';

function wait(numSec: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, numSec * 1000);
  });
}

async function main() {
  console.log('funding from coinbase ...');
  let found;
  while (!found) {
    try {
      const chainId = await ethers.provider.send('eth_chainId', []);
      console.log({chainId});
      found = true;
    } catch (e) {} // TODO timeout ?
    if (!found) {
      await wait(1);
    }
  }

  const rawProvider = new JsonRpcProvider('http://localhost:8545');

  const coinbase = await ethers.provider.send('eth_coinbase', []);
  const accounts = await ethers.provider.listAccounts();
  let accountsToFund = accounts;
  if (coinbase === accounts[0]) {
    accountsToFund = accounts.slice(1);
  }

  const coinbaseBalance = await ethers.provider.getBalance(coinbase);
  const nonce = await ethers.provider.getTransactionCount(coinbase);
  const maxAmount = BigNumber.from('10000000000000000000');
  let amount = coinbaseBalance.div(accountsToFund.length);
  if (amount.gt(maxAmount)) {
    amount = maxAmount;
  }

  if (coinbaseBalance.gt(0)) {
    const coinbaseSigner = rawProvider.getSigner(coinbase);
    for (let i = 0; i < accountsToFund.length; i++) {
      const tx = await coinbaseSigner.sendTransaction({
        to: accountsToFund[i],
        value: amount.sub(21000).toHexString(),
        nonce: BigNumber.from(nonce + i).toHexString(),
      });
      console.log(tx.hash);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
