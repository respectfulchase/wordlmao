(() => {
  // ---------- Word lists ----------
  const WORDLES_URL = "https://raw.githubusercontent.com/stuartpb/wordles/main/wordles.json";
  const NONWORDLES_URL = "https://raw.githubusercontent.com/stuartpb/wordles/main/nonwordles.json";

  const SUPABASE_URL = "https://yakyjrtkrodxvtvrgmzc.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_1y1SLtcnwV5dI4dNt4fqNQ_Wai9VOsk";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const BLOCKLIST = new Set([]);
  const ALLOWLIST = new Set([]);

  const FALLBACK_ANSWERS = [
    "about","above","actor","adopt","after","alert","alive","angle","apple","arena",
    "beach","black","bread","bring","brown","build","chair","clean","clear","clock",
    "dream","drive","earth","eight","enjoy","enter","faith","field","fight","final",
    "fresh","front","grace","great","green","group","heart","honey","house","image",
    "judge","laugh","learn","light","music","north","peace","power","proud","quick",
    "reach","right","royal","scale","scene","share","smart","smile","sound","south",
    "space","stage","store","story","teach","their","think","three","today","touch",
    "truth","union","value","voice","watch","water","where","while","white","world","young"
  ];

  const LISTS_CACHE_KEY = "wordlmao_lists_v1";
  const LEGACY_LISTS_CACHE_KEY = "wordlite_lists_v1";

  function isFive(w) { return /^[a-z]{5}$/.test(w); }

  function filterAnswerCandidates(words) {
    const set = new Set(words);
    const keep = [];
    for (const w of words) {
      if (!isFive(w)) continue;

      if (ALLOWLIST.has(w)) { keep.push(w); continue; }
      if (BLOCKLIST.has(w)) continue;

      if (w.endsWith("s") && !w.endsWith("ss")) {
        const singular = w.slice(0, -1);
        if (set.has(singular)) continue;
      }
      if (w.endsWith("ed")) {
        const base1 = w.slice(0, -2);
        const base2 = w.slice(0, -1);
        if (set.has(base1) || set.has(base2)) continue;
      }
      if (w.endsWith("ing")) {
        const base = w.slice(0, -3);
        if (set.has(base)) continue;
      }

      keep.push(w);
    }
    return keep;
  }

  function normalizeWordLists(payload) {
    if (!payload || typeof payload !== "object") return null;

    const answersRaw = Array.isArray(payload.answers) ? payload.answers : [];
    const guessesRaw = Array.isArray(payload.guessesOnly) ? payload.guessesOnly : [];

    const answers = filterAnswerCandidates(
      answersRaw.map(String).map(w => w.toLowerCase()).filter(isFive)
    );
    if (!answers.length) return null;

    const guessesOnly = guessesRaw.map(String).map(w => w.toLowerCase()).filter(isFive);
    const validBase = Array.isArray(payload.valid) ? payload.valid : [];
    const valid = Array.from(new Set([
      ...answers,
      ...guessesOnly,
      ...validBase.map(String).map(w => w.toLowerCase()).filter(isFive)
    ]));

    return { answers, guessesOnly, valid };
  }

  function readCachedWordLists() {
    const keys = [LISTS_CACHE_KEY, LEGACY_LISTS_CACHE_KEY];
    for (const key of keys) {
      const cached = localStorage.getItem(key);
      if (!cached) continue;
      try {
        const normalized = normalizeWordLists(JSON.parse(cached));
        if (!normalized) continue;
        if (key !== LISTS_CACHE_KEY) {
          localStorage.setItem(LISTS_CACHE_KEY, JSON.stringify(normalized));
          localStorage.removeItem(LEGACY_LISTS_CACHE_KEY);
        }
        return normalized;
      } catch {
        /* ignore malformed cache */
      }
    }
    return null;
  }

  async function loadWordLists() {
    const cached = readCachedWordLists();
    if (cached) return cached;

    try {
      const [answersRaw, guessesRaw] = await Promise.all([
        fetch(WORDLES_URL).then(r => r.json()),
        fetch(NONWORDLES_URL).then(r => r.json())
      ]);

      const result = normalizeWordLists({
        answers: answersRaw,
        guessesOnly: guessesRaw
      });
      if (!result) throw new Error("Invalid fetched word lists");

      localStorage.setItem(LISTS_CACHE_KEY, JSON.stringify(result));
      localStorage.removeItem(LEGACY_LISTS_CACHE_KEY);
      return result;
    } catch {
      const answers = filterAnswerCandidates(FALLBACK_ANSWERS.slice());
      const valid = Array.from(new Set([...answers]));
      return { answers, guessesOnly: [], valid };
    }
  }

  // ---------- Deterministic daily answer ----------
  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seed) {
    const a = arr.slice();
    const rand = mulberry32(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function dayNumberLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();
    const base = Date.UTC(2022, 0, 1);
    const utcMid = Date.UTC(y, m, day);
    return Math.floor((utcMid - base) / 86400000);
  }

  function pickDailyAnswer(answers) {
    if (!Array.isArray(answers) || answers.length === 0) return null;
    const dn = dayNumberLocal();
    const schedule = seededShuffle(answers, 1337);
    return schedule[((dn % schedule.length) + schedule.length) % schedule.length];
  }

  // ---------- DOM ----------
  const boardEl = document.getElementById("board");
  const kbEl = document.getElementById("kb");
  const msgEl = document.getElementById("msg");
  const dateLabelEl = document.getElementById("dateLabel");
  const shareBtn = document.getElementById("shareBtn");
  const modeBtn = document.getElementById("modeBtn");
  const modeIconEl = document.getElementById("modeIcon");
  const titleBtn = document.getElementById("titleBtn");
  const myStatsBtn = document.getElementById("myStatsBtn");

  // ---------- Config ----------
  const ROWS = 6, COLS = 5;
  const INPUT_ROW = 5;

  // Feb 24, 2026 (local) corresponds to dayNumberLocal() = 1515 with base Jan 1, 2022
  const LAUNCH_DAY_NUMBER = 1515;

  function pad3(n) {
    const s = String(Math.max(0, n));
    return s.length >= 3 ? s : s.padStart(3, "0");
  }

  function puzzleNumber() {
    return (dayNumberLocal() - LAUNCH_DAY_NUMBER) + 1;
  }

  function todayLabel() {
    return new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  }

  function dateWithCounterLabel() {
    return `${todayLabel()} • ${pad3(puzzleNumber())}`;
  }

  // ---------- State ----------
  let ANSWER = null;      // uppercase
  let VALID = null;       // Set lowercase
  let gameOver = false;

  let guessCount = 0;     // number of submitted guesses
  let currentCol = 0;
  let hasSubmittedScore = false;
  let myStatsOpen = false;

  // manualSelect true means: user clicked a tile (typing sticks)
  let manualSelect = false;

  let guessedSet = new Set();
  let pinnedCols = Array(COLS).fill(false);

  // Mobile long-press pinning: prevent follow-up click
  let suppressNextClick = false;

  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ""));
  const results = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ""));
  const keyState = new Map(); // letter -> correct/present/absent

  // ---------- Modes ----------
  const MODES = [
    { key: "normal",  icon: "🙂", maxGuesses: 6, hard: false, desc: "NORMAL MODE. TAP 🙂 TO CHANGE." },
    { key: "hard",    icon: "🧠", maxGuesses: 6, hard: true,  desc: "HARD MODE. USE ALL HINTS." },
    { key: "extreme", icon: "💀", maxGuesses: 4, hard: true,  desc: "EXTREME. HARD MODE, 4 GUESSES." },
    { key: "insanity",icon: "☠️", maxGuesses: 3, hard: true,  desc: "INSANITY. 3 GUESSES. WHAT ARE YOU THINKING?" }
  ];
  let modeIndex = 0;

  const MODE_PREF_KEY = "wordlmao_mode_pref_v1";
  const PLAYER_ID_KEY = "wordlmao_player_id";
  const PLAYER_NICKNAME_KEY = "wordlmao_nickname";
  function mode() { return MODES[modeIndex]; }

  async function getOrCreatePlayerId() {
    try {
      const existingPlayerId = localStorage.getItem(PLAYER_ID_KEY);
      if (existingPlayerId) return existingPlayerId;

      let nickname = localStorage.getItem(PLAYER_NICKNAME_KEY);
      if (!nickname) {
        const input = window.prompt("Choose a nickname (for your stats):");
        nickname = (input || "").trim() || "anonymous";
        localStorage.setItem(PLAYER_NICKNAME_KEY, nickname);
      }

      const { data, error } = await supabase
        .from("players")
        .insert({ nickname })
        .select("id")
        .single();

      if (error) {
        console.error("Failed to create player:", error);
        return null;
      }

      const playerId = data?.id;
      if (!playerId) {
        console.error("Failed to create player: missing player id in response.");
        return null;
      }

      localStorage.setItem(PLAYER_ID_KEY, String(playerId));
      return String(playerId);
    } catch (error) {
      console.error("Failed to get or create player:", error);
      return null;
    }
  }

  async function submitScore({ puzzleId, mode, guesses, win }) {
    try {
      const playerId = await getOrCreatePlayerId();
      if (!playerId) return;

      const { error } = await supabase
        .from("scores")
        .insert({
          player_id: playerId,
          puzzle_id: puzzleId,
          mode,
          guesses,
          win
        });

      if (error) {
        console.error("Failed to submit score:", error);
      }
    } catch (error) {
      console.error("Failed to submit score:", error);
    }
  }

  async function fetchMyScores({ limit = 30 } = {}) {
    try {
      const playerId = await getOrCreatePlayerId();
      if (!playerId) return [];

      const { data, error } = await supabase
        .from("scores")
        .select("*")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("Failed to fetch my scores:", error);
        return [];
      }

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Failed to fetch my scores:", error);
      return [];
    }
  }

  function formatScoreDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function scoreGuessValue(row) {
    if (row && Number.isFinite(Number(row.guesses))) return Number(row.guesses);
    return null;
  }

  function formatModeLabel(modeKey) {
    const found = MODES.find((m) => m.key === modeKey);
    if (!found) return "Mode";
    return found.key.charAt(0).toUpperCase() + found.key.slice(1);
  }

  function formatScoreLine(row) {
    const puzzle = Number.isFinite(Number(row?.puzzle_id))
      ? `#${pad3(Number(row.puzzle_id))}`
      : "#---";
    const modeLabel = formatModeLabel(row?.mode);
    const result = row?.win ? "Win" : "Loss";
    const guesses = scoreGuessValue(row);
    const guessPart = row?.win && guesses ? ` in ${guesses}` : "";
    const datePart = formatScoreDate(row?.created_at);
    return `${puzzle} ${modeLabel}: ${result}${guessPart}${datePart ? ` (${datePart})` : ""}`;
  }

  function setMsg(t) {
    myStatsOpen = false;
    msgEl.classList.remove("stats-readout");
    msgEl.textContent = (t || "").toUpperCase();
  }

  function setStatsMsg(lines) {
    myStatsOpen = true;
    msgEl.classList.add("stats-readout");
    msgEl.textContent = lines;
  }

  async function openMyStats() {
    const nickname = localStorage.getItem(PLAYER_NICKNAME_KEY) || "anonymous";
    setStatsMsg(`Nickname: ${nickname}\nLoading...`);

    const scores = await fetchMyScores({ limit: 12 });
    if (!scores.length) {
      setStatsMsg(`Nickname: ${nickname}\nNo results yet.`);
      return;
    }

    const lines = scores.slice(0, 12).map(formatScoreLine);
    setStatsMsg([`Nickname: ${nickname}`, ...lines].join("\n"));
  }

  function closeMyStats() {
    if (!myStatsOpen) return;
    if (!gameHasStarted() && !gameOver) {
      showModeDesc();
      return;
    }
    setMsg("");
  }

  function toggleMyStats() {
    if (myStatsOpen) {
      closeMyStats();
      return;
    }
    void openMyStats();
  }

  function setModeByKey(key) {
    const idx = MODES.findIndex(m => m.key === key);
    modeIndex = idx >= 0 ? idx : 0;
    if (modeIconEl) modeIconEl.textContent = mode().icon;
  }

  function setModeIndex(idx) {
    modeIndex = ((idx % MODES.length) + MODES.length) % MODES.length;
    if (modeIconEl) modeIconEl.textContent = mode().icon;
  }

  function saveModePreference() {
    try { localStorage.setItem(MODE_PREF_KEY, mode().key); } catch { /* ignore */ }
  }

  function loadModePreferenceKey() {
    try { return localStorage.getItem(MODE_PREF_KEY); } catch { return null; }
  }

  // ---------- Helpers ----------

  function tileEl(r, c) {
    return boardEl.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
  }

  function rowIsFull(r) {
    for (let c = 0; c < COLS; c++) if (!grid[r][c]) return false;
    return true;
  }

  function rowWord(r) { return grid[r].join(""); }

  function gameHasStarted() {
    return guessedSet.size > 0 || guessCount > 0 || results.some(r => r.some(Boolean));
  }

  function showModeDesc() {
    setMsg(mode().desc);
  }

  function isPinnedGreensMode() {
    return !!mode().hard;
  }

  function computePinnedGreensFromResults() {
    const locked = Array(COLS).fill(false);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (results[r][c] === "correct") locked[c] = true;
      }
    }
    return locked;
  }

  function computePinnedGreenLetters() {
    const letters = Array(COLS).fill("");
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (results[r][c] === "correct" && grid[r][c]) letters[c] = grid[r][c];
      }
    }
    return letters;
  }

  function applyPinnedGreensToInputRow() {
    if (!isPinnedGreensMode()) return;
    const pinnedLetters = computePinnedGreenLetters();
    for (let c = 0; c < COLS; c++) {
      if (pinnedCols[c]) grid[INPUT_ROW][c] = pinnedLetters[c] || "";
    }
  }

  function nextUnpinnedCol(fromCol) {
    for (let step = 0; step < COLS; step++) {
      const c = (fromCol + step) % COLS;
      if (!pinnedCols[c]) return c;
    }
    return -1;
  }

  // ---------- Board interactions ----------
  function editTile(r, c) {
    if (gameOver) return;
    if (r !== INPUT_ROW) return;

    if (pinnedCols[c]) {
      const first = nextUnpinnedCol(c + 1);
      if (first !== -1) currentCol = first;
      return;
    }

    currentCol = c;
    manualSelect = true;

    render();

    const rowEmpty = grid[INPUT_ROW].every(ch => !ch);
    if (rowEmpty && !gameHasStarted()) showModeDesc();
    else setMsg("");

    saveGameState();
  }

  function togglePinAt(col) {
    if (gameOver) return;
    if (isPinnedGreensMode()) return;
    if (!grid[INPUT_ROW][col]) return; // only if filled

    pinnedCols[col] = !pinnedCols[col];

    if (pinnedCols[col] && currentCol === col) {
      const first = nextUnpinnedCol(0);
      if (first !== -1) currentCol = first;
    }

    manualSelect = true;
    render();
    saveGameState();
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div");
      row.className = "row";
      row.dataset.row = r;

      for (let c = 0; c < COLS; c++) {
        const t = document.createElement("div");
        t.className = "tile";
        t.dataset.row = r;
        t.dataset.col = c;

        t.addEventListener("click", () => {
          if (suppressNextClick) {
            suppressNextClick = false;
            return;
          }
          editTile(r, c);
        });

        // Mobile long-press pinning
        let pressTimer = null;
        let startX = 0;
        let startY = 0;
        let longPressed = false;

        t.addEventListener("touchstart", (e) => {
          if (gameOver) return;
          if (r !== INPUT_ROW) return;
          if (!e.touches || !e.touches[0]) return;

          longPressed = false;
          const t0 = e.touches[0];
          startX = t0.clientX;
          startY = t0.clientY;

          pressTimer = setTimeout(() => {
            togglePinAt(c);
            longPressed = true;
            suppressNextClick = true;
          }, 260);
        }, { passive: true });

        t.addEventListener("touchmove", (e) => {
          if (!pressTimer || !e.touches || !e.touches[0]) return;
          const t0 = e.touches[0];
          const dx = t0.clientX - startX;
          const dy = t0.clientY - startY;
          if (Math.hypot(dx, dy) > 10) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        }, { passive: true });

        t.addEventListener("touchend", (e) => {
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
          if (longPressed) {
            suppressNextClick = true;
            e.preventDefault();
          }
        }, { passive: false });

        t.addEventListener("touchcancel", () => {
          if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
          longPressed = false;
        });

        // Desktop right-click pinning
        t.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (r !== INPUT_ROW) return;
          togglePinAt(c);
        });

        row.appendChild(t);
      }

      boardEl.appendChild(row);
    }
    render();
  }

  function render() {
    const visibleRows = Math.min(guessCount + 1, ROWS);
    const hideAbove = ROWS - visibleRows;

    for (let r = 0; r < ROWS; r++) {
      const rowScored = results[r].some(Boolean);

      for (let c = 0; c < COLS; c++) {
        const t = tileEl(r, c);
        const ch = grid[r][c];

        t.textContent = ch;
        t.classList.toggle("filled", !!ch);
        t.classList.toggle("hidden", r < hideAbove);
        t.classList.toggle("pinned", (r === INPUT_ROW && pinnedCols[c]));

        t.classList.toggle(
          "cursor",
          (!gameOver && r === INPUT_ROW && c === currentCol && !rowScored)
        );

        t.classList.remove("correct", "present", "absent");
        if (results[r][c]) t.classList.add(results[r][c]);
      }
    }
  }

  // ---------- Keyboard ----------
  function buildKeyboard() {
    kbEl.innerHTML = "";

    const enterBar = document.createElement("button");
    enterBar.type = "button";
    enterBar.className = "enterbar";
    enterBar.textContent = "ENTER";
    enterBar.addEventListener("click", () => {
      submitGuess();
      enterBar.blur();
    });
    kbEl.appendChild(enterBar);

    const rows = [
      ["Q","W","E","R","T","Y","U","I","O","P"],
      ["A","S","D","F","G","H","J","K","L"],
      ["CLEAR","Z","X","C","V","B","N","M","⌫"]
    ];

    rows.forEach((letters, idx) => {
      const row = document.createElement("div");
      row.className = "kb-row";
      if (idx === 1) row.style.width = "calc(100% - (var(--key-w) + var(--gap)))";

      for (const label of letters) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "key" + ((label === "CLEAR" || label === "⌫") ? " wide" : "");
        btn.textContent = label;
        btn.dataset.key = label;

        btn.addEventListener("click", () => {
          if (label === "CLEAR") clearRow();
          else if (label === "⌫") backspace();
          else onKey(label);
          btn.blur(); // prevent focus outline on desktop
        });

        row.appendChild(btn);
      }

      kbEl.appendChild(row);
    });

    renderKeyboard();
  }

  function renderKeyboard() {
    const keys = kbEl.querySelectorAll(".key");
    keys.forEach(k => {
      const label = k.dataset.key;
      if (!label || label.length !== 1) return;

      k.classList.remove("k-correct", "k-present", "k-absent", "used");
      const st = keyState.get(label);
      if (st === "correct") k.classList.add("k-correct", "used");
      else if (st === "present") k.classList.add("k-present", "used");
      else if (st === "absent") k.classList.add("k-absent", "used");
    });
  }

  function onKey(label) {
    if (gameOver) return;
    if (/^[A-Z]$/.test(label)) insertLetter(label);
  }

  function insertLetter(letter) {
    if (gameOver) return;

    if (pinnedCols[currentCol]) {
      const c = nextUnpinnedCol(currentCol + 1);
      if (c === -1) {
        setMsg("All tiles are pinned.");
        return;
      }
      currentCol = c;
    }

    grid[INPUT_ROW][currentCol] = letter.toUpperCase();

    if (!manualSelect && currentCol < COLS - 1) {
      let nc = currentCol + 1;
      while (nc < COLS && pinnedCols[nc]) nc++;
      if (nc < COLS) currentCol = nc;
    }

    render();
    setMsg("");
    saveGameState();
  }

  function backspace() {
    if (gameOver) return;

    manualSelect = false;

    if (!pinnedCols[currentCol] && grid[INPUT_ROW][currentCol]) {
      grid[INPUT_ROW][currentCol] = "";
      render();
      saveGameState();
      return;
    }

    let c = currentCol - 1;
    while (c >= 0 && pinnedCols[c]) c--;

    if (c >= 0) {
      currentCol = c;
      if (grid[INPUT_ROW][currentCol]) grid[INPUT_ROW][currentCol] = "";
      render();
      saveGameState();
    }
  }

  function clearRow() {
    if (gameOver) return;

    for (let c = 0; c < COLS; c++) {
      if (pinnedCols[c]) continue;
      grid[INPUT_ROW][c] = "";
    }

    // Clear exits manual mode
    manualSelect = false;

    // Jump cursor to first EMPTY, unpinned tile
    let target = -1;
    for (let c = 0; c < COLS; c++) {
      if (pinnedCols[c]) continue;
      if (!grid[INPUT_ROW][c]) { target = c; break; }
    }
    if (target === -1) {
      const first = nextUnpinnedCol(0);
      target = (first === -1) ? 0 : first;
    }
    currentCol = target;

    render();
    setMsg("");
    saveGameState();
  }

  // ---------- Hard mode constraints ----------
  function buildHardConstraints() {
    const greens = Array(COLS).fill("");
    const minCounts = {};

    for (let r = 0; r < ROWS; r++) {
      if (!results[r].some(Boolean)) continue;

      const rowCounts = {};
      for (let c = 0; c < COLS; c++) {
        const st = results[r][c];
        const ch = (grid[r][c] || "").toUpperCase();
        if (!ch) continue;

        if (st === "correct") {
          greens[c] = ch;
          rowCounts[ch] = (rowCounts[ch] || 0) + 1;
        } else if (st === "present") {
          rowCounts[ch] = (rowCounts[ch] || 0) + 1;
        }
      }

      for (const [ch, ct] of Object.entries(rowCounts)) {
        minCounts[ch] = Math.max(minCounts[ch] || 0, ct);
      }
    }

    return { greens, minCounts };
  }

  function hardModeValidate(guess) {
    const g = guess.toUpperCase();
    const { greens, minCounts } = buildHardConstraints();

    const wrongGreens = [];
    for (let c = 0; c < COLS; c++) {
      if (greens[c] && g[c] !== greens[c]) {
        wrongGreens.push(`${greens[c]} IN ${c + 1}`);
      }
    }
    if (wrongGreens.length) {
      return { ok: false, msg: `HARD MODE: KEEP ${wrongGreens.join(", ")}.` };
    }

    const counts = {};
    for (const ch of g) counts[ch] = (counts[ch] || 0) + 1;

    const missing = [];
    const reqLetters = Object.keys(minCounts).sort();
    for (const ch of reqLetters) {
      const need = minCounts[ch] || 0;
      if (need <= 0) continue;
      if ((counts[ch] || 0) < need) missing.push(ch);
    }

    if (missing.length) {
      return { ok: false, msg: `HARD MODE: INCLUDE ${missing.join(", ")}.` };
    }

    return { ok: true };
  }

  // ---------- Scoring ----------
  function scoreGuess(guess, answer) {
    const g = guess.split("");
    const a = answer.split("");
    const res = Array(COLS).fill("absent");

    const remaining = {};
    for (let i = 0; i < COLS; i++) {
      if (g[i] === a[i]) {
        res[i] = "correct";
      } else {
        remaining[a[i]] = (remaining[a[i]] || 0) + 1;
      }
    }

    for (let i = 0; i < COLS; i++) {
      if (res[i] === "correct") continue;
      const ch = g[i];
      if (remaining[ch] > 0) {
        res[i] = "present";
        remaining[ch]--;
      }
    }

    return res;
  }

  function updateKeyStates(guess, res) {
    const rank = (s) => s === "correct" ? 3 : s === "present" ? 2 : s === "absent" ? 1 : 0;
    for (let i = 0; i < COLS; i++) {
      const ch = guess[i];
      const next = res[i];
      const prev = keyState.get(ch);
      if (!prev || rank(next) > rank(prev)) keyState.set(ch, next);
    }
  }

  // ---------- Row shifting ----------
  function shiftLockedUpOne() {
    for (let r = 0; r <= 3; r++) {
      grid[r] = grid[r + 1].slice();
      results[r] = results[r + 1].slice();
    }

    grid[4] = Array.from({ length: COLS }, () => "");
    results[4] = Array.from({ length: COLS }, () => "");

    results[INPUT_ROW] = Array.from({ length: COLS }, () => "");
  }

  function rebuildKeyStateFromBoard() {
    keyState.clear();
    for (let r = 0; r < ROWS; r++) {
      if (!results[r].some(Boolean)) continue;
      const guess = rowWord(r);
      updateKeyStates(guess, results[r]);
    }
    renderKeyboard();
  }

  // ---------- Share ----------
  function squareFor(cell) {
    if (cell === "correct") return "🟩";
    if (cell === "present") return "🟦";
    if (cell === "absent")  return "⬛️"; // smaller footprint than plain ⬛ on many phones
    return "⬛️";
  }

  function buildShareText() {
    // https://wordlmao.chasedunham.com
    // 🧠 005 3/6
    // ⬛️🟦🟩⬛️⬛️
    const won = results.some(r => r.length && r.every(x => x === "correct"));
    const tries = won ? String(guessCount + 1) : "0";

    const lines = [];
    lines.push("https://wordlmao.chasedunham.com");
    lines.push(`${mode().icon} ${pad3(puzzleNumber())} ${tries}/${mode().maxGuesses}`);

    for (let r = 0; r < ROWS; r++) {
      if (!results[r].some(Boolean)) continue;
      lines.push(results[r].map(squareFor).join(""));
    }

    return lines.join("\n");
  }

  async function shareResults() {
    const text = buildShareText();

    if (navigator.share) {
      try {
        await navigator.share({ title: "WORDLMAO", text });
        return;
      } catch { /* ignore */ }
    }

    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied results to clipboard.");
    } catch {
      setMsg("Could not copy.");
    }
  }

  // ---------- Persistence ----------
  function stateKey(day = dayNumberLocal()) {
    return "wordlmao_state_" + day;
  }

  function legacyStateKey(day = dayNumberLocal()) {
    return "wordlite_state_" + day;
  }

  function migrateLegacyDailyState(day = dayNumberLocal()) {
    try {
      const next = stateKey(day);
      if (localStorage.getItem(next)) return;

      const old = legacyStateKey(day);
      const legacy = localStorage.getItem(old);
      if (!legacy) return;

      localStorage.setItem(next, legacy);
      localStorage.removeItem(old);
    } catch {
      /* ignore */
    }
  }

  function saveGameState() {
    try {
      const obj = {
        v: 1,
        day: dayNumberLocal(),
        answer: ANSWER,
        gameOver,
        modeKey: mode().key,
        guessCount,
        currentCol,
        manualSelect,
        guessed: Array.from(guessedSet),
        pinnedCols,
        grid,
        results,
        keyState: Array.from(keyState.entries()),
        msg: msgEl.textContent || ""
      };
      localStorage.setItem(stateKey(), JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  function loadGameState() {
    try {
      const raw = localStorage.getItem(stateKey());
      if (!raw) return false;

      const obj = JSON.parse(raw);
      if (!obj || obj.day !== dayNumberLocal() || obj.answer !== ANSWER) return false;

      gameOver = !!obj.gameOver;
      setModeByKey(obj.modeKey || "normal");
      guessCount = Number(obj.guessCount || 0);
      currentCol = Number(obj.currentCol || 0);
      manualSelect = !!obj.manualSelect;

      guessedSet = new Set(Array.isArray(obj.guessed) ? obj.guessed : []);
      pinnedCols = Array.isArray(obj.pinnedCols) && obj.pinnedCols.length === COLS
        ? obj.pinnedCols.map(Boolean)
        : Array(COLS).fill(false);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          grid[r][c] = (obj.grid?.[r]?.[c] || "");
          results[r][c] = (obj.results?.[r]?.[c] || "");
        }
      }

      if (isPinnedGreensMode()) {
        pinnedCols = computePinnedGreensFromResults();
        applyPinnedGreensToInputRow();
      }

      keyState.clear();
      for (const [k, v] of (obj.keyState || [])) keyState.set(k, v);

      setMsg(obj.msg || "");
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Share button state ----------
  function updateShareButton() {
    if (!shareBtn) return;
    const disabled = !gameOver;
    shareBtn.classList.toggle("disabled", disabled);
    shareBtn.setAttribute("aria-disabled", String(disabled));
    shareBtn.title = disabled ? "Finish the puzzle to share" : "Share";
  }

  // ---------- Submission ----------
  function submitGuess() {
    if (gameOver) return;

    if (!rowIsFull(INPUT_ROW)) {
      setMsg("Fill all 5 tiles first.");
      return;
    }

    const guess = rowWord(INPUT_ROW);
    const guessLower = guess.toLowerCase();

    if (!VALID || !VALID.has(guessLower)) {
      setMsg("Not in word list.");
      return;
    }

    if (guessedSet.has(guessLower)) {
      setMsg("Hey, you already guessed that.");
      return;
    }

    if (mode().hard && gameHasStarted()) {
      const check = hardModeValidate(guess);
      if (!check.ok) {
        setMsg(check.msg);
        return;
      }
    }

    const res = scoreGuess(guess, ANSWER);
    guessedSet.add(guessLower);

    if (res.every(x => x === "correct")) {
      results[INPUT_ROW] = res.slice();
      updateKeyStates(guess, res);

      manualSelect = false;
      renderKeyboard();
      render();

      setMsg("Nice. You got it.");
      gameOver = true;
      if (!hasSubmittedScore) {
        hasSubmittedScore = true;
        void submitScore({
          puzzleId: puzzleNumber(),
          mode: mode().key,
          guesses: guessCount + 1,
          win: true
        });
      }

      updateShareButton();
      saveGameState();
      return;
    }

    if (guessCount === (mode().maxGuesses - 1)) {
      results[INPUT_ROW] = res.slice();
      updateKeyStates(guess, res);

      manualSelect = false;
      renderKeyboard();
      render();

      setMsg(`Answer: ${ANSWER}`);
      gameOver = true;
      if (!hasSubmittedScore) {
        hasSubmittedScore = true;
        void submitScore({
          puzzleId: puzzleNumber(),
          mode: mode().key,
          guesses: guessCount + 1,
          win: false
        });
      }

      updateShareButton();
      saveGameState();
      return;
    }

    shiftLockedUpOne();

    for (let c = 0; c < COLS; c++) grid[4][c] = grid[INPUT_ROW][c];
    results[4] = res.slice();

    for (let c = 0; c < COLS; c++) grid[INPUT_ROW][c] = "";

    if (isPinnedGreensMode()) {
      pinnedCols = computePinnedGreensFromResults();
      applyPinnedGreensToInputRow();
    }

    const first = nextUnpinnedCol(0);
    currentCol = (first === -1) ? 0 : first;

    manualSelect = false;
    guessCount++;

    rebuildKeyStateFromBoard();
    render();

    setMsg("");

    saveGameState();
  }

  // ---------- Mode change ----------
  function handleModeClick() {
    if (gameOver || gameHasStarted()) {
      setMsg("MODE LOCKED THIS GAME.");
      return;
    }
    setModeIndex(modeIndex + 1);
    if (isPinnedGreensMode()) {
      pinnedCols = computePinnedGreensFromResults();
      applyPinnedGreensToInputRow();
    }
    saveModePreference();
    showModeDesc();
    saveGameState();
    modeBtn.blur();
  }

  // ---------- Dev reset ----------
  function resetTodayForTesting() {
    try { localStorage.removeItem(stateKey()); } catch { /* ignore */ }
    location.reload();
  }

  // ---------- Events ----------
  shareBtn.addEventListener("click", () => {
    if (!gameOver) {
      setMsg("Finish the puzzle to share.");
      return;
    }
    shareResults();
  });

  if (modeBtn) modeBtn.addEventListener("click", handleModeClick);
  if (myStatsBtn) myStatsBtn.addEventListener("click", toggleMyStats);

  // Hidden reset: dblclick title (desktop), triple-tap title (mobile), Shift+R
  let tapCount = 0;
  let tapTimer = null;

  if (titleBtn) {
    titleBtn.addEventListener("dblclick", resetTodayForTesting);

    titleBtn.addEventListener("click", () => {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 450);
      if (tapCount >= 3) resetTodayForTesting();
    });
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key;

    if (e.shiftKey && (k === "R" || k === "r")) {
      resetTodayForTesting();
      return;
    }

    if (gameOver) return;

    // Arrow navigation (input row only)
    if (k === "ArrowLeft") {
      e.preventDefault();
      let c = currentCol - 1;
      while (c >= 0 && pinnedCols[c]) c--;
      if (c >= 0) {
        currentCol = c;
        manualSelect = true;
        render();
        saveGameState();
      }
      return;
    }

    if (k === "ArrowRight") {
      e.preventDefault();
      let c = currentCol + 1;
      while (c < COLS && pinnedCols[c]) c++;
      if (c < COLS) {
        currentCol = c;
        manualSelect = true;
        render();
        saveGameState();
      }
      return;
    }

    if (k === "Enter") submitGuess();
    else if (k === "Backspace") backspace();
    else if (/^[a-zA-Z]$/.test(k)) insertLetter(k.toUpperCase());
  });

  // ---------- Boot ----------
  async function boot() {
    hasSubmittedScore = false;
    dateLabelEl.textContent = dateWithCounterLabel();
    setMsg("Loading...");

    const pref = loadModePreferenceKey();
    setModeByKey(pref || "normal");
    saveModePreference();

    const lists = await loadWordLists();
    await getOrCreatePlayerId();
    VALID = new Set(lists.valid);
    const dailyAnswer = pickDailyAnswer(lists.answers) || pickDailyAnswer(FALLBACK_ANSWERS);
    ANSWER = (dailyAnswer || FALLBACK_ANSWERS[0]).toUpperCase();

    migrateLegacyDailyState();

    loadGameState();
    saveModePreference();

    updateShareButton();

    buildBoard();
    buildKeyboard();
    renderKeyboard();
    render();

    if (!msgEl.textContent || msgEl.textContent === "LOADING...") {
      if (!gameHasStarted() && !gameOver) showModeDesc();
      else setMsg("");
    }

    saveGameState();
  }

  if (typeof globalThis !== "undefined") {
    globalThis.__WORDLMAO_TEST__ = {
      normalizeWordLists,
      scoreGuess,
      hardModeValidate,
      pickDailyAnswer,
      stateKey,
      legacyStateKey,
      migrateLegacyDailyState,
      setHardModeContext: ({ grid: g, results: r }) => {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            grid[row][col] = (g?.[row]?.[col] || "").toUpperCase();
            results[row][col] = (r?.[row]?.[col] || "");
          }
        }
      },
      computePinnedGreensFromResults,
      computePinnedGreenLetters,
      applyPinnedGreensToInputRow,
      getOrCreatePlayerId,
      submitScore,
      fetchMyScores,
      setModeForTest: (key) => {
        setModeByKey(key);
        if (isPinnedGreensMode()) {
          pinnedCols = computePinnedGreensFromResults();
          applyPinnedGreensToInputRow();
        }
      },
      getInputRowForTest: () => grid[INPUT_ROW].slice(),
      getPinnedColsForTest: () => pinnedCols.slice()
    };
  }

  if (!globalThis.__WORDLMAO_DISABLE_BOOT__) {
    boot();
  }
})();
