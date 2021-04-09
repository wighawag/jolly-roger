import {hexConcat} from '@ethersproject/bytes';
import {keccak256} from '@ethersproject/solidity';
import {BigNumber} from '@ethersproject/bignumber';

export function combine(address: string, name: string): BigNumber {
  const n = BigNumber.from(
    hexConcat([keccak256(['address', 'string'], [address, name]), keccak256(['string', 'address'], [name, address])])
  );
  return n;
}
