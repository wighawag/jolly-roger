import {getUnnamedAccounts, ethers} from '@nomiclabs/buidler';

const messages = ['Hello', '你好', 'سلام', 'здравствуйте', 'Habari', 'Bonjour', 'नमस्ते'];

function waitFor<T>(p: Promise<{wait: () => Promise<T>}>): Promise<T> {
  return p.then((tx) => tx.wait());
}

async function main() {
  const others = await getUnnamedAccounts();
  for (let i = 0; i < messages.length; i++) {
    const sender = others[i];
    if (sender) {
      const {{=_.camelCase(it.contractName)}}Contract = await ethers.getContract('{{=_.pascalCase(it.contractName)}}', sender);
      await waitFor({{=_.camelCase(it.contractName)}}Contract.setMessage(messages[i]));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
