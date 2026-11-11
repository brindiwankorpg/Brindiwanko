/**
 * @file Chat lines: characters drawn as nothing (zero-width spaces, direction overrides, fillers) are
 * removed, as they are refused in names; the joiners that compose emoji are kept.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanChatLine } from '../server/game/social.js';

test('invisible characters are removed from chat lines', () => {
  assert.equal(cleanChatLine('hel​lo'), 'hello', 'zero-width space');
  assert.equal(cleanChatLine('free ‮gold‬ now'), 'free gold now', 'direction override');
  assert.equal(cleanChatLine('ㅤㅤspam⁠'), 'spam', 'Hangul filler and word joiner');
  assert.equal(cleanChatLine('a\u0007b\u0085c'), 'a b c', 'control characters');
  assert.equal(cleanChatLine('​​'), '', 'nothing left: nothing is sent');
});

test('emoji sequences are kept whole', () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const heart = '❤️';
  assert.equal(cleanChatLine(`hi ${family} ${heart}`), `hi ${family} ${heart}`);
});
