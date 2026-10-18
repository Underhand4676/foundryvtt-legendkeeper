import test from 'node:test';
import assert from 'node:assert/strict';
import { MACRO_DEFINITIONS } from '../module/scripts/macros.mjs';

test('the setup macro can always reopen configuration after initial pairing', () => {
  const setup = MACRO_DEFINITIONS.find(m => m.id === 'configure');
  assert.equal(setup.name, 'LegendKeeper | Configure');
  assert.match(setup.command, /\.api\?\.configure\(\)/);
  assert.ok(setup.command.includes('foundryvtt-legendkeeper'));
});

test('the separate browser macro is available without exposing credentials', () => {
  const browse = MACRO_DEFINITIONS.find(m => m.id === 'browse');
  assert.equal(browse.name, 'LegendKeeper | Browse');
  assert.match(browse.command, /\.api\?\.open\(\)/);
  for (const macro of MACRO_DEFINITIONS) assert.doesNotMatch(macro.command, /Bearer |lk_|[0-9a-f]{64}/i);
});
