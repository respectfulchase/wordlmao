const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class DummyEl {
  constructor() {
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new DummyEl(); }
  querySelectorAll() { return []; }
  setAttribute() {}
  blur() {}
}

function loadGame() {
  const ids = new Map();
  const local = new Map();
  const scoreInserts = [];
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Promise,
    location: { reload() {} },
    navigator: {},
    fetch: async () => ({ json: async () => [] }),
    localStorage: {
      getItem: (k) => (local.has(k) ? local.get(k) : null),
      setItem: (k, v) => local.set(k, String(v)),
      removeItem: (k) => local.delete(k)
    },
    document: {
      getElementById(id) {
        if (!ids.has(id)) ids.set(id, new DummyEl());
        return ids.get(id);
      },
      createElement() { return new DummyEl(); }
    },
    window: {
      addEventListener() {},
      prompt: () => 'tester',
      supabase: {
        createClient() {
          return {
            from(table) {
              return {
                insert(payload) {
                  if (table === 'players') {
                    return {
                      select() {
                        return {
                          async single() {
                            return { data: { id: 123 }, error: null };
                          }
                        };
                      }
                    };
                  }

                  if (table === 'scores') {
                    scoreInserts.push(payload);
                    return Promise.resolve({ data: null, error: null });
                  }

                  return Promise.resolve({ data: null, error: null });
                }
              };
            }
          };
        }
      }
    },
    globalThis: null,
    __WORDLMAO_DISABLE_BOOT__: true
  };
  ctx.globalThis = ctx;

  const src = fs.readFileSync('game.js', 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { api: ctx.__WORDLMAO_TEST__, storage: local, scoreInserts };
}

const { api, storage, scoreInserts } = loadGame();

// scoreGuess duplicate-letter behavior
assert.deepStrictEqual(
  Array.from(api.scoreGuess('ALLEY', 'APPLE')),
  ['correct', 'present', 'absent', 'present', 'absent']
);

// hard mode keeps known green and requires discovered letters
api.setHardModeContext({
  grid: [
    ['A', 'L', 'L', 'E', 'Y'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
  ],
  results: [
    ['correct', 'present', 'absent', 'present', 'absent'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
  ]
});
assert.strictEqual(api.hardModeValidate('BROAD').ok, false);
assert.strictEqual(api.hardModeValidate('AMPLE').ok, true);

// hard/extreme/insanity pin greens from prior results and prefill input row
api.setHardModeContext({
  grid: [
    ['S', 'P', 'A', 'R', 'E'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
  ],
  results: [
    ['absent', 'absent', 'correct', 'absent', 'absent'],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', ''],
    ['', '', '', '', '']
  ]
});
api.setModeForTest('hard');
const hardPins = Array.from(api.computePinnedGreensFromResults());
assert.deepStrictEqual(hardPins, [false, false, true, false, false]);
assert.deepStrictEqual(Array.from(api.getPinnedColsForTest()), [false, false, true, false, false]);
assert.strictEqual(Array.from(api.getInputRowForTest())[2], 'A');

api.setModeForTest('extreme');
assert.strictEqual(Array.from(api.getInputRowForTest())[2], 'A');

api.setModeForTest('insanity');
assert.strictEqual(Array.from(api.getInputRowForTest())[2], 'A');

api.setModeForTest('normal');
assert.deepStrictEqual(Array.from(api.getPinnedColsForTest()), [false, false, true, false, false]);

// malformed/empty payload handling
assert.strictEqual(api.normalizeWordLists(null), null);
assert.strictEqual(api.normalizeWordLists({ answers: [] }), null);
const normalized = api.normalizeWordLists({ answers: ['apple', 'APPLE', 42], guessesOnly: ['zzzzz'] });
assert.ok(normalized.answers.length > 0);
assert.ok(normalized.valid.includes('zzzzz'));

// daily answer fallback safety
assert.strictEqual(api.pickDailyAnswer([]), null);

// one-time legacy state migration
storage.set(api.legacyStateKey(10), '{"v":1}');
api.migrateLegacyDailyState(10);
assert.strictEqual(storage.get(api.stateKey(10)), '{"v":1}');
assert.strictEqual(storage.has(api.legacyStateKey(10)), false);

(async () => {
  const firstId = await api.getOrCreatePlayerId();
  assert.strictEqual(firstId, '123');
  assert.strictEqual(storage.get('wordlmao_nickname'), 'tester');
  assert.strictEqual(storage.get('wordlmao_player_id'), '123');

  storage.set('wordlmao_player_id', '999');
  const existingId = await api.getOrCreatePlayerId();
  assert.strictEqual(existingId, '999');

  await api.submitScore({ puzzleId: 12, mode: 'hard', guesses: 4, win: false });
  assert.strictEqual(scoreInserts.length, 1);
  assert.strictEqual(scoreInserts[0].player_id, '999');
  assert.strictEqual(scoreInserts[0].puzzle_id, 12);
  assert.strictEqual(scoreInserts[0].mode, 'hard');
  assert.strictEqual(scoreInserts[0].guesses, 4);
  assert.strictEqual(scoreInserts[0].win, false);

  console.log('ok');
})();
