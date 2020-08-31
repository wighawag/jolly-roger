import {getNamedAccounts, ethers} from '@nomiclabs/buidler';

const names = [
  'Hetrorlig Oakenbrow',
  'Dermerlug Brewcloak',
  'Nalol Blackbraids',
  'Webir Goldenback',
  'Dholdrec Chaosgrip',
  'Siggog Strongjaw',
  'Krostol Snowtank',
  'Rumit Dragonarmour',
  'Nemnad Thunderbrow',
  'Gagham Grimbelly',
];

// TODO move to util
const waitFor = <T>(p: Promise<{wait: () => Promise<T>}>) => p.then((tx) => tx.wait());

async function main() {
  for (let i = 0; i < 4; i++) {
    const {others} = await getNamedAccounts();
    for (let i = 0; i < 4; i++) {
      const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}', others[i]);
      await waitFor({{=_.camelCase(it.contractName)}}Contract.setName(names[i]));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
