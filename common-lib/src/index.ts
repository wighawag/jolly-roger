import {hexConcat} from '@ethersproject/bytes';
import {keccak256} from '@ethersproject/solidity';
import {BigNumber} from '@ethersproject/bignumber';

export function test(address: string, name: string): BigNumber {
  const n = BigNumber.from(
    hexConcat([
      keccak256(['address', 'string'], [address, name]),
      keccak256(['string', 'address'], [name, address]),
    ])
  );
  return n;
  // return n.div(n);
  // return BigNumber.from(2);
}

// HMR Code Snippet Example
if (import.meta.hot) {
  import.meta.hot.accept(({module}) => {
    // Accept the module, apply it into your application.
    console.log(module);
  });
}
