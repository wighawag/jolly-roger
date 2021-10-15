import {expect} from './chai-setup';
import {combine} from 'jolly-roger-common';
describe('common', function () {
  it('combine works', async function () {
    const result = combine('0x0000000000000000000000000000000000000000', 'hi');
    expect(result).to.equal(
      '4492628129540168759428721593383368739159403405373287666722783850105001415263474261981306693016215908748703081970176721565405344512680605439761237208158496'
    );
  });
});
