import {hexConcat} from '@ethersproject/bytes';
import {keccak256} from '@ethersproject/solidity';
import {BigNumber} from '@ethersproject/bignumber';

export function test(address: string, name: string): BigNumber {
  return BigNumber.from(
    hexConcat([keccak256(['address', 'string'], [address, name]), keccak256(['string', 'address'], [name, address])])
  );
}
