import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signers';
import {ethers} from 'hardhat';
import {Contract} from 'ethers';
import {TypedDataDomain, TypedDataField} from '@ethersproject/abstract-signer';

export async function setupNamedUsers<T extends {[contractName: string]: Contract}>(
  namedAccounts: {[name: string]: string},
  contracts: T
): Promise<{[name: string]: {address: string; signer: SignerWithAddress} & T}> {
  const users: {[name: string]: {address: string; signer: SignerWithAddress} & T} = {};
  for (const entry of Object.entries(namedAccounts)) {
    users[entry[0]] = await setupUser(entry[1], contracts);
  }
  return users;
}

export async function setupUsers<T extends {[contractName: string]: Contract}>(
  addresses: string[],
  contracts: T
): Promise<({address: string; signer: SignerWithAddress} & T)[]> {
  const users: ({address: string; signer: SignerWithAddress} & T)[] = [];
  for (const address of addresses) {
    users.push(await setupUser(address, contracts));
  }
  return users;
}

export async function setupUser<T extends {[contractName: string]: Contract}>(
  address: string,
  contracts: T
): Promise<{address: string; signer: SignerWithAddress} & T> {
  const signer = await ethers.getSigner(address);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = {address, signer};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(signer);
  }
  return user as {address: string; signer: SignerWithAddress} & T;
}

export class EIP712Signer {
  constructor(private domain: TypedDataDomain, private types: Record<string, Array<TypedDataField>>) {}

  sign(
    user: {signer: SignerWithAddress},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: Record<string, any>
  ): Promise<string> {
    return user.signer._signTypedData(this.domain, this.types, value);
  }
}

export class EIP712SignerFactory {
  constructor(private fixedDomain: TypedDataDomain, private types: Record<string, Array<TypedDataField>>) {}

  createSigner(domain: TypedDataDomain): {
    sign: (
      user: {signer: SignerWithAddress},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: Record<string, any>
    ) => Promise<string>;
  } {
    const domainToUse = Object.assign(this.fixedDomain, domain);
    const types = this.types;
    return {
      async sign(
        user: {signer: SignerWithAddress},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value: Record<string, any>
      ): Promise<string> {
        if (domainToUse.chainId === 0) {
          domainToUse.chainId = await user.signer.getChainId();
        }
        return user.signer._signTypedData(domainToUse, types, value);
      },
    };
  }
}

export function waitFor<T>(p: Promise<{wait: () => Promise<T>}>): Promise<T> {
  return p.then((t) => t.wait());
}
