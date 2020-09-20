/* eslint-disable prefer-const */
import {MessageChanged} from '../generated/{{=_.pascalCase(it.contractName)}}/{{=_.pascalCase(it.contractName)}}Contract';
import {MessageEntry} from '../generated/schema';
// import {log} from '@graphprotocol/graph-ts';

// const zeroAddress = '0x0000000000000000000000000000000000000000';

export function handleMessageChanged(event: MessageChanged): void {
  let id = event.params.user.toHex();
  let entity = MessageEntry.load(id);
  if (!entity) {
    entity = new MessageEntry(id);
  }
  entity.message = event.params.message;
  entity.timestamp = event.block.timestamp;
  entity.save();
}
