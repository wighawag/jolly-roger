import chai from 'chai';
export {expect, should} from 'chai';
import {viemChaiMatchers} from 'viem-chai-matchers';
import chaiAsPromised from 'chai-as-promised';
chai.use(viemChaiMatchers);
chai.use(chaiAsPromised);
