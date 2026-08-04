"use strict";

// Drop avatar images that 404 instead of showing a broken-image icon. This was
// an inline onerror handler; Content-Security-Policy forbids those, and losing
// inline script is the whole point of the policy.
document.addEventListener("error", (e) => {
  const t = e.target;
  if (t && t.tagName === "IMG" && t.hasAttribute("data-avatar")) t.remove();
}, true);

/* ---------- constants ---------- */

// Roster: 14 picks per manager in the initial draft, any order, within
// position quotas. Redraft phases (2+) use the admin-chosen quota stored
// on the league row; kept players fill slots inside that quota.
const PHASE1_QUOTA    = { GK: 2, DEF: 4, MID: 4, FWD: 3, TEAM: 1 };
const PHASE1_STARTERS = { GK: 1, DEF: 3, MID: 3, FWD: 2 };   // rest are subs
const GROUPS = ["GK", "DEF", "MID", "FWD", "TEAM"];
const SLOT_POS = { GK:"GK", DEF:"DEF", MID:"MID", FWD:"FWD", TEAM:"TEAM",
                   SUB_GK:"GK", SUB_DEF:"DEF", SUB_MID:"MID", SUB_FWD:"FWD" };
const SLOT_RANK = { GK:0, DEF:1, MID:2, FWD:3, TEAM:4,
                    SUB_GK:5, SUB_DEF:6, SUB_MID:7, SUB_FWD:8 };

// Mirrors SCORING in daily_pull.py — keep the two in sync.
const SCORING = {
  goal:        { GK: 8, DEF: 6, MID: 5, FWD: 4 },
  assist:      3,
  clean_sheet: { GK: 6, DEF: 4, MID: 1, FWD: 0 },
  yellow_card: -1,
  red_card:    -3,
  save_per_2:  1,
  // defensive actions = tackles + blocks + interceptions; GK excluded
  // (they have the saves rule). +1 per 2 = 0.5/action, kept integer.
  def_action_per_2: 1,
  motm:        3,
  penalty_saved:  5,
  penalty_missed: -2,
};

// TEAM pick stage bonuses, awarded once per stage reached (cumulative).
const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "final", "winner"];
const STAGE_BONUS = { r32: 5, r16: 10, qf: 15, sf: 20, final: 25, winner: 15 };

// Final phase: squads dissolve and each surviving manager predicts the
// champion — paid out when the admin sets a team's stage to "winner".
const FINAL_PICK_BONUS = 5;

/* ---------- per-league draft config (Workstream B) ----------
   A league may override the hardcoded WC-2026 defaults above via a
   `leagues.config` jsonb. Accessors deep-merge the league's config OVER the
   defaults, so a null/partial config behaves EXACTLY like today (the live
   league has no config → identical scoring). Merged results are memoized on
   the config object's identity because calcPlayerPoints is called per-row. */
const cfgOf = () => S.league?.config || {};
const _UNSET = Symbol("unset");   // sentinel so the first memo build always runs
let _stageBonusCache = null, _stageBonusFor = _UNSET;
function stageBonuses() {
  const c = cfgOf().stageBonus;
  if (_stageBonusFor !== c) { _stageBonusFor = c; _stageBonusCache = { ...STAGE_BONUS, ...(c || {}) }; }
  return _stageBonusCache;
}
const stageOrder     = () => cfgOf().stageOrder || STAGE_ORDER;
const finalPickBonus = () => cfgOf().finalPickBonus ?? FINAL_PICK_BONUS;
const phaseOneQuota  = () => ({ ...PHASE1_QUOTA, ...(cfgOf().quota || {}) });
const phaseOneStarters = () => ({ ...PHASE1_STARTERS, ...(cfgOf().starters || {}) });

// The full effective config, defaults filled in — for pre-filling the "design
// your draft" editors and comparing against defaults. `rules` is the scoring
// rules array (custom or DEFAULT_RULES), deep-cloned so editors can mutate it.
function effectiveConfig(cfg) {
  cfg = cfg || {};
  const rules = Array.isArray(cfg.scoring) && cfg.scoring.length ? cfg.scoring : DEFAULT_RULES;
  return {
    rules: JSON.parse(JSON.stringify(rules)),
    stageBonus: { ...STAGE_BONUS, ...(cfg.stageBonus || {}) },
    finalPickBonus: cfg.finalPickBonus ?? FINAL_PICK_BONUS,
    quota: { ...PHASE1_QUOTA, ...(cfg.quota || {}) },
    starters: { ...PHASE1_STARTERS, ...(cfg.starters || {}) },
    formationMode: cfg.formationMode || "fixed",
    formation: { ...DEFAULT_FORMATION, ...(cfg.formation || {}) },
    squadSize: cfg.squadSize ?? 15,
    h2hEnabled: cfg.h2hEnabled === true,
    h2h: { ...H2H_DEFAULTS, ...(cfg.h2h || {}) },
    faDeferToClose: cfg.fa_defer_to_close === true,
    maxFaPerWindow: cfg.max_fa_per_window ?? null,
    maxSubs: cfg.maxSubs ?? null,
    captain: cfg.captain === true,
    autoWindows: cfg.autoWindows === true,
    windows: cfg.windows || null,
    draftOrder: cfg.draftOrder === "manual" ? "manual" : "random",
  };
}
// Captain/vice: the captain's round points are doubled; if the captain didn't
// play at all that round, the vice-captain's are doubled instead.
const captainEnabled = () => cfgOf().captain === true;
// Automatic trade/lineup windows: when on, trade + lineup locks are derived
// from the competition fixture calendar instead of a manual admin toggle.
const autoWindowsEnabled = () => cfgOf().autoWindows === true;
// Cached window state (recomputed at most once a minute, or when S.fixtures
// changes identity) — fixtureWindows is called from many render sites.
let _awKey = null, _awVal = null;
function autoWindowState() {
  const now = Date.now(), bucket = Math.floor(now / 60000), fx = S.fixtures || null;
  if (_awVal && _awKey && _awKey.fx === fx && _awKey.b === bucket) return _awVal;
  _awKey = { fx, b: bucket };
  _awVal = fixtureWindows(fx || [], now, cfgOf().windows || {});
  return _awVal;
}
// Whether roster trades/swaps are currently allowed. In auto-window mode the
// answer comes from the fixture calendar; otherwise it's the manual toggle.
// (Legacy leagues have autoWindows off, so behaviour is unchanged.)
function tradingOpen() {
  return autoWindowsEnabled() ? autoWindowState().tradeOpen : !!S.league?.trading_open;
}
// Whether lineup (starter/bench) edits are currently allowed. Under auto
// windows this locks 1h before the upcoming matchweek's first fixture, which
// is a DIFFERENT moment from the trade window closing.
/* Manual mode keeps the two locks separate. Closing trading is a deadline for
   deals; locking line-ups is a deadline for team selection, and they are not
   the same moment — you often want deals shut days early but selection open
   until kick-off. Leagues created before this column follow trading_open, so
   nothing changes for them until an admin touches the new toggle. */
function lineupOpen() {
  if (autoWindowsEnabled()) return autoWindowState().lineupOpen;
  const sep = S.league?.lineups_open;
  return sep == null ? !!S.league?.trading_open : !!sep;
}
// Human-readable "when do lineups lock / when does trading reopen" strings for
// auto-window mode. mwNo() pulls the matchweek number out of the round label.
/* The matchweek number out of an API round label. The digits must follow the
   dash separator ("Regular Season - 21", "Group Stage - 1"): a bare trailing
   number is NOT a week -- "Round of 16" is a knockout tie, and stamping it as
   matchweek 16 would scatter cup scoring. Caught by test before shipping. */
const mwNo = (round) => { const m = String(round || "").match(/-\s*(\d+)\s*$/); return m ? m[1] : null; };
const fmtWhen = (ms) => ms == null ? "" : new Date(ms).toLocaleString([], {
  weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
function lineupLockMessage() {
  const w = autoWindowState();
  if (!w.upcoming) return "No upcoming fixtures scheduled.";
  const n = mwNo(w.upcoming.round);
  return `Lineups lock ${fmtWhen(w.lineupLockAt)}${n ? ` — 1h before Matchweek ${n}` : ""}.`;
}
function tradeWindowMessage() {
  const w = autoWindowState();
  if (w.tradeOpen) return `Trade window open until ${fmtWhen(w.tradeWindow.closeAt)}.`;
  // Closed: find the next window that will open (next consecutive gap start).
  const now = Date.now(), H = 3600e3;
  const openAfter = (cfgOf().windows?.tradeOpenAfterH ?? 1) * H;
  const weeks = w.weeks || [];
  for (let i = 0; i + 1 < weeks.length; i++) {
    const openAt = weeks[i].last + openAfter;
    if (openAt > now) return `Trade window opens ${fmtWhen(openAt)}.`;
  }
  return "Trade window is closed.";
}

/* ---------- state & tiny helpers ---------- */

const S = {
  sb: null, players: [], teams: [],
  league: null, managers: [], picks: [], stats: [], stages: [], trades: [],
  snapshots: [],
  channel: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// Built-in Supabase project, so managers don't enter the URL + anon key on
// every device. The anon key is public by design — Row-Level Security protects
// the data, not the key's secrecy. A per-browser config (entered on the config
// screen via "Reconfigure") overrides these, e.g. to point at another project.
const BUILTIN_SUPABASE_URL  = "https://gpdyemrgulhdnsmmadgs.supabase.co";
const BUILTIN_SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwZHllbXJndWxoZG5zbW1hZGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTExNDksImV4cCI6MjA5NjY2NzE0OX0.Iih401Skuw6SpC8U-URv7KPvOJ7M71uce3SI_OS8QTs";

// The Supabase connection lives in the CODE (BUILTIN_*), never the browser, and
// the code wins. Every *.github.io Pages site shares one origin, so localStorage
// is shared across all of them — a stale or foreign "wcf_config" left by another
// Pages app must not be able to point this app at the wrong project. The saved
// config is only a fallback for a hypothetical build with no baked-in creds.
const getConfig  = () => (BUILTIN_SUPABASE_URL && BUILTIN_SUPABASE_ANON
  ? { url: BUILTIN_SUPABASE_URL, key: BUILTIN_SUPABASE_ANON }
  : JSON.parse(localStorage.getItem("wcf_config") || "null"));
const setConfig  = (c) => localStorage.setItem("wcf_config", JSON.stringify(c));
const getSession = () => JSON.parse(localStorage.getItem("wcf_session") || "null");
const setSession = (s) => s ? localStorage.setItem("wcf_session", JSON.stringify(s))
                            : localStorage.removeItem("wcf_session");

/* ---------- accounts (Supabase Auth, email + password) ----------
   Phase 1: identity + ownership at the app level. Signing in links your
   account (auth uid) to the managers you join and the leagues you create, so
   the app recognises you across devices and gates admin to the creator. The
   database RLS is still open, so this is UX-level, not tamper-proof — the
   owner_id/user_id columns are exactly what a future RLS lockdown keys on. */
const authUser = () => S.authUser || null;
const authUid = () => S.authUser?.id || null;
async function refreshAuthUser() {
  try { const { data } = await S.sb.auth.getSession(); S.authUser = data.session?.user || null; }
  catch { S.authUser = null; }
  return S.authUser;
}

/* ---------- product owner (test-run mode) ----------
   Accounts allowed to run a simulated season. This hides the controls; it does
   NOT enforce anything, because the anon key can still be driven directly until
   RLS lands. What actually protects real data is simLeague() below: fake results
   are only ever written to a league explicitly flagged as a sandbox, and such a
   league keeps its stats in its own match_stats rows rather than the shared
   competition_stats every other league reads. */
const APP_OWNER_EMAILS = ["koen.johan.c@gmail.com"];
const isAppOwner = () => {
  const e = String(S.authUser?.email || "").trim().toLowerCase();
  return !!e && APP_OWNER_EMAILS.includes(e);
};
// A sandbox league: real squads and real matchweek logic, invented results.
const simLeague = () => !!S.league?.sim;
/* Where this league's stats live. A sandbox league on a real competition must
   NOT read or write competition_stats — those rows are shared by every league
   on that competition, so fake results there would corrupt live leagues. */
const statsScope = () => {
  const ck = competitionKey();
  return ck && !simLeague()
    ? { table: "competition_stats", column: "competition_key", value: ck }
    : { table: "match_stats", column: "league_id", value: S.league?.id || getSession()?.leagueId };
};

/* ---------- manager identity ----------
   A league should look like a league, not a list of names. Every manager gets a
   stable accent colour derived from their id, so identity works immediately
   with no setup and no migration; picking a crest or colour just overrides it. */
const MGR_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500",
                    "#a855f7", "#e5646a", "#14b8a6", "#f472b6"];
/* The twelve that fit on one row of the picker, and the rest behind "More".
   Two dozen more without making the first choice a scrolling chore. */
const CRESTS = ["⚽", "🦁", "🐉", "🦅", "🐺", "🦈", "🐍", "🐻", "🔥", "⚡", "👑", "🌋"];
const CRESTS_MORE = [
  "🐅", "🐆", "🦊", "🦌", "🐗", "🦏", "🦣", "🐘", "🦧", "🦬", "🐴", "🦄",
  "🦉", "🦇", "🐙", "🦑", "🦂", "🕷", "🐝", "🦋", "🌪", "☄️", "💎", "🎯",
  "🚀", "🛡", "⚔️", "🏹", "🎸", "🍀", "🌊", "❄️", "🌟", "💀", "🤖", "👽",
];

function managerColor(m) {
  if (m?.color) return m.color;
  const id = String(m?.id ?? "");
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MGR_COLORS[h % MGR_COLORS.length];
}
const managerCrest = (m) => m?.crest || "";
// What to draw inside a manager's chip: their crest, else their initial. An
// empty box looks like a bug; an initial looks deliberate.
const managerMark = (m) => managerCrest(m) || (m?.name || "?").trim().charAt(0).toUpperCase();

// A manager's name with their crest and accent, for lists and tables.
function managerTag(m, opts = {}) {
  const c = managerColor(m), crest = managerCrest(m);
  return `<span class="inline-flex items-center gap-1.5 min-w-0">
    <span class="shrink-0 inline-flex items-center justify-center rounded-md ${opts.size || "w-6 h-6"} text-[13px]"
          style="background:${c}22;border:1px solid ${c}88">${crest || managerMark(m)}</span>
    <span class="truncate">${esc(m?.name ?? "?")}</span></span>`;
}

function myManager() {
  // Prefer the account link: a signed-in user's manager follows them across
  // devices. Fall back to the per-device session (legacy / not signed in).
  const uid = authUid();
  if (uid) { const mine = S.managers.find((m) => m.user_id === uid); if (mine) return mine; }
  const s = getSession();
  const bySession = S.managers.find((m) => m.id === s?.managerId) || null;
  /* A stale device session must never make you someone else. If you're signed
     in and that manager belongs to a different account, it isn't yours —
     regardless of what this device remembers. (Client-side courtesy only:
     rls.sql is what actually enforces it. See its header.) */
  if (uid && bySession?.user_id && bySession.user_id !== uid) return null;
  return bySession;
}
function isAdmin() {
  /* An OWNED league is admin-by-account only. The token must not also work,
     because finding a league by invite code has to be possible before you are
     a member -- so leagues.admin_token is readable by any signed-in user. If a
     matching token still conferred admin, anyone could read another league's
     token and take it over. Every league the app creates now has an owner, so
     the token path survives only for pre-account leagues that never had one. */
  if (!S.league) return false;
  const uid = authUid();
  if (S.league.owner_id) return !!uid && S.league.owner_id === uid;
  const s = getSession();
  return !!(s?.adminToken && s.adminToken === S.league.admin_token);
}

let _shownView = null;
function showView(name) {
  // Belt and braces: a view change can never leave the page scroll-locked by
  // an abandoned drag, whatever route the code took to get here.
  document.documentElement.classList.remove("drag-lock");
  document.querySelectorAll("[data-view]").forEach(
    (el) => el.classList.toggle("hidden", el.dataset.view !== name));
  // The header "Exit league" button only makes sense once you're in a league.
  const exit = $("hdr-exit");
  if (exit) exit.classList.toggle("hidden",
    !["board", "lobby", "draft", "admin"].includes(name));
  const nav = $("bottom-nav");
  if (nav) nav.classList.toggle("hidden", name !== "board" || preDraftBrowsing());
  const gear = $("hdr-admin");
  if (gear) gear.classList.toggle("hidden",
    !(isAdmin() && ["board", "lobby", "draft"].includes(name)));
  // Only jump to top when the view actually changes — a re-render of the
  // same view (e.g. the refetch after starring a player) must preserve
  // the current scroll position.
  if (name !== _shownView) { window.scrollTo(0, 0); _shownView = name; }
}

function genInviteCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)),
    (b) => chars[b % chars.length]).join("");
}

// Display-only columns added by later schema.sql migrations. A write that
// includes one of these must not fail just because the migration hasn't
// been applied yet — drop it and retry. Mirrors the self-heal in
// daily_pull.py's upsert. (Scoring/trade mechanics never read these.)
const STRIPPABLE_COLUMNS = new Set([
  "home_score", "away_score", "minutes", "raw",
  "offered_player_name", "requested_player_name",
  "offered_player_id", "requested_player_id", "planner",
  "owner_id", "user_id", "is_bot", "crest", "color", "bench_order", "lineups_open", "sim",
  "window_key", "round",
  "fa_processed_until",
  "team",
  // round_key is read by scoring, not display-only -- but a snapshot without it
  // falls back to the timestamp path, i.e. exactly the pre-1.5 behaviour, so
  // dropping it degrades correctly rather than wrongly.
  "round_key", "fixture_id",
]);

// Insert/upsert that tolerates an unapplied additive migration. Throws on
// any other error. `opts.upsert` + `opts.onConflict` select the mode.
async function resilientWrite(table, rows, opts = {}) {
  let payload = rows;
  for (let i = 0; i <= STRIPPABLE_COLUMNS.size; i++) {
    const q = S.sb.from(table);
    const { error } = opts.upsert
      ? await q.upsert(payload, { onConflict: opts.onConflict })
      : await q.insert(payload);
    if (!error) return;
    const col = error.code === "PGRST204"
      && (/Could not find the '(\w+)' column/.exec(error.message || "") || [])[1];
    if (col && STRIPPABLE_COLUMNS.has(col)) {
      payload = payload.map((r) => { const c = { ...r }; delete c[col]; return c; });
      continue;
    }
    throw new Error(error.message);
  }
  throw new Error(`${table} write failed after dropping optional columns`);
}

/* ---------- data loading & realtime ---------- */

/* ---------- API-Football competitions (Workstream B, part 3) ----------
   A league can be tied to an API-Football competition instead of the static
   WC-2026 players.json. The pool (squads + fixtures) and raw stats are pulled
   ONCE and stored per-competition (keyed by "<apiLeagueId>-<season>"), so every
   league on the same competition shares them — no duplicated API calls. */
const COMPETITIONS = [
  { name: "FIFA World Cup",        apiLeagueId: 1,   kind: "cup" },
  { name: "UEFA Champions League", apiLeagueId: 2,   kind: "cup" },
  { name: "UEFA Europa League",    apiLeagueId: 3,   kind: "cup" },
  { name: "UEFA Euro",             apiLeagueId: 4,   kind: "cup" },
  { name: "UEFA Nations League",   apiLeagueId: 5,   kind: "cup" },
  { name: "Copa América",          apiLeagueId: 9,   kind: "cup" },
  { name: "Premier League",        apiLeagueId: 39,  kind: "league" },
  { name: "La Liga",               apiLeagueId: 140, kind: "league" },
  { name: "Serie A",               apiLeagueId: 135, kind: "league" },
  { name: "Bundesliga",            apiLeagueId: 78,  kind: "league" },
  { name: "Ligue 1",               apiLeagueId: 61,  kind: "league" },
];
/* Which seasons you may start a league on.

   A domestic season's API key is its START year: 2026 means 2026/27, which
   runs August 2026 → May 2027. So the season you can draft for is the one that
   has not finished — from June onwards that is this calendar year, before June
   it is last year (you are mid-season). Offering 2025 in July 2026 would let
   someone build a league on a competition that is already over.

   Tournaments are keyed by their own year and are scheduled well ahead, so
   they offer this year and next. Pure, so the boundary cases are pinned. */
// getUTCMonth() is 0-indexed, so 5 is June — the month after a domestic
// season ends and the key ticks over to the one about to begin.
const SEASON_ROLLOVER_MONTH = 5;

function currentSeasonFor(kind, nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  if (kind === "cup") return y;
  return d.getUTCMonth() >= SEASON_ROLLOVER_MONTH ? y : y - 1;
}

function seasonOptions(kind, nowMs) {
  const cur = currentSeasonFor(kind, nowMs);
  return kind === "cup" ? [cur, cur + 1] : [cur];
}

// "2026/27" for a domestic season, "2026" for a tournament.
const seasonLabel = (kind, y) =>
  kind === "cup" ? String(y) : `${y}/${String((y + 1) % 100).padStart(2, "0")}`;

// The season whose results a new league's scoring is validated against: the
// one before it, because its own has not been played yet.
const backtestSeason = (season) => season - 1;

// The league's competition (null → legacy static players.json / fixtures.json).
const leagueCompetition = () => S.league?.competition || null;
// Competition data (pool + stats) is SHARED across every league on the same
// competition, keyed by "<apiLeagueId>-<season>". null → legacy WC league.
const compKeyOf = (c) => c ? `${c.apiLeagueId}-${c.season}` : null;
const competitionKey = () => compKeyOf(leagueCompetition());

// --- pure API transforms (unit-tested) ---
const API_POS = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Attacker: "FWD" };
const apiPosToSlot = (pos) => API_POS[pos] || "MID";
const teamCodeFrom = (name, code) =>
  code || String(name || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TBD";

// One API squad player → the app's player record. player_id = "api_<id>" so
// stats match exactly by id later (no name/shirt guessing).
function parseSquadPlayer(ap, teamName, teamCode, teamLogo) {
  return {
    player_id: "api_" + ap.id, api_id: ap.id,
    name: ap.name, position: apiPosToSlot(ap.position),
    team: teamName, team_code: teamCode,
    number: ap.number ?? null, photo: ap.photo || null,
    // The team's API id, so club crests resolve without a separate lookup
    // table (stored per player because the pool's `teams` is just names).
    team_logo: teamLogo ?? null,
  };
}
// One API fixture → the app's fixture record (same shape as fixtures.json).
function parseApiFixture(f) {
  return {
    // The match's real identity, kept rather than reconstructed later from
    // "Home vs Away (date)" (ROUNDS_DESIGN.md Phase 3).
    fixture_id: f.fixture?.id ?? null,
    home: f.teams.home.name, away: f.teams.away.name,
    kickoff_utc: f.fixture.date, date: String(f.fixture.date || "").slice(0, 10),
    status: f.fixture.status?.short || "NS",
    round: f.league?.round || null,
    home_score: f.goals?.home ?? null, away_score: f.goals?.away ?? null,
  };
}

// Fetch a competition's whole pool: teams → each team's squad (thin wrapper
// around the pure transforms above; onProgress(done, total, team) for the UI).
async function fetchCompetitionPool(key, apiLeagueId, season, onProgress) {
  const teams = await apiFootball(key, "teams", { league: apiLeagueId, season });
  if (!teams.length) throw new Error("No teams found — check the competition and season.");
  const byId = {};   // dedup players who appear in two squads
  const names = [];
  let done = 0;
  for (const t of teams) {
    const teamName = t.team.name, code = teamCodeFrom(teamName, t.team.code);
    names.push(teamName);
    onProgress && onProgress(++done, teams.length, teamName);
    const squads = await apiFootball(key, "players/squads", { team: t.team.id });
    for (const ap of (squads[0]?.players || [])) {
      const p = parseSquadPlayer(ap, teamName, code, t.team.id);
      if (!byId[p.player_id]) byId[p.player_id] = p;
    }
  }
  return { players: Object.values(byId), teams: [...new Set(names)].sort() };
}
async function fetchCompetitionFixtures(key, apiLeagueId, season) {
  return (await apiFootball(key, "fixtures", { league: apiLeagueId, season })).map(parseApiFixture);
}

/* The competition's rounds in the order the competition itself runs them
   (ROUNDS_DESIGN.md Phase 2.5). The API returns them ordered -- ["Group Stage
   - 1", ..., "Round of 16", "Quarter-finals", "Final"] -- which is the one
   round fact we were still inferring from data that moves: matchweeksOf()
   sorts rounds by earliest kickoff, so moving a knockout tie ahead of a group
   game reorders the season. Endpoint returns bare strings, not objects. */
async function fetchCompetitionRounds(key, apiLeagueId, season) {
  try {
    const r = await apiFootball(key, "fixtures/rounds", { league: apiLeagueId, season });
    return (r || []).map(String).filter(Boolean);
  } catch { return []; }          // optional: order falls back to kickoff sort
}

// The league's competition key, resolving it from the DB when S.league isn't
// populated yet (loadPlayers runs before refetchAll sets S.league).
async function resolveCompetitionKey() {
  let comp = leagueCompetition();
  if (!comp) {
    const id = S.league?.id || getSession()?.leagueId;
    if (!id || !S.sb) return null;
    try {
      const { data } = await S.sb.from("leagues").select("competition").eq("id", id).maybeSingle();
      comp = data?.competition || null;
    } catch { return null; }
  }
  return compKeyOf(comp);
}

// The SHARED competition pool (one row in competition_pools), fetched once per
// session. undefined = not yet checked; null = none (legacy static-file league).
async function loadCompetitionPool() {
  if (S._compPool !== undefined) return S._compPool;
  const key = await resolveCompetitionKey();
  if (!key || !S.sb) return (S._compPool = null);
  try {
    const { data } = await S.sb.from("competition_pools").select("*").eq("competition_key", key).maybeSingle();
    return (S._compPool = data || null);
  } catch { return (S._compPool = null); }
}

async function loadPlayers() {
  if (S.players.length) return;
  const pool = await loadCompetitionPool();
  // The competition's own round order, when the pool has been pulled since
  // Phase 2.5. Empty = fall back to ordering rounds by kickoff, as before.
  S.roundOrder = pool?.round_order || [];
  if (pool?.players?.length) {
    S.players = pool.players;                       // API competition pool
  } else {
    try {
      const resp = await fetch("players.json");     // legacy static WC pool
      S.players = await resp.json();
    } catch (e) {
      toast("Could not load players.json — serve this file over HTTP (e.g. GitHub Pages or `python -m http.server`).");
      throw e;
    }
  }
  S.teams = [...new Set(S.players.map((p) => p.team))].sort();
  S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
}

/* Reload everything.

   `initial` separates the first load from a background refresh, because they
   need opposite failure behaviour. A background refresh that fails must leave
   the working UI alone and say so quietly; the FIRST load failing used to
   toast and return, which left every view hidden — a bare header, forever,
   and the same again after a reload. That is the blank screen. Now it throws
   so the caller can show something a person can act on. */
async function refetchAll({ initial = false } = {}) {
  const id = getSession()?.leagueId;
  if (!id) return false;
  const bail = (msg) => {
    if (initial) throw new Error(msg);
    markConnection(false, msg);
    return false;
  };
  // The league row first, so we know its competition before choosing the stats
  // source (competition-shared vs legacy per-league).
  const l = await S.sb.from("leagues").select("*").eq("id", id).maybeSingle();
  if (l.error) return bail(l.error.message);
  if (!l.data) { toast("League not found."); setSession(null); showView("home"); return false; }
  /* A draft only ever moves forward. A read issued before our advance landed
     reports the PREVIOUS pick, and applying it rewinds the room: whose turn it
     is goes backwards and pick_started_at reverts to a deadline that has
     already expired, so the clock reads 0:00 and auto-pick fires a second time
     within seconds. Hold our position unless the compare-and-swap told us we
     genuinely lost the race. */
  const prevLeague = S.league;
  if (prevLeague && prevLeague.id === l.data.id
      && keepLocalPick(prevLeague.current_pick, l.data.current_pick, forcePickResync)) {
    l.data.current_pick = prevLeague.current_pick;
    l.data.pick_started_at = prevLeague.pick_started_at;
  }
  forcePickResync = false;
  S.league = l.data;
  const compKey = competitionKey();
  // Stats outgrow Supabase's 1000-row request cap, so page through them.
  // Competition leagues read the SHARED competition_stats (one pull serves every
  // league on that competition); legacy WC leagues read their own match_stats.
  const fetchAllStats = async () => {
    const PAGE = 1000;
    let from = 0, all = [];
    for (;;) {
      const sc = statsScope();
      const q = S.sb.from(sc.table).select("*").eq(sc.column, sc.value);
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) return { data: all, error };
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    return { data: all, error: null };
  };
  const [m, p, st, tg, tr, sn, tx, msg, fac] = await Promise.all([
    S.sb.from("managers").select("*").eq("league_id", id).order("created_at"),
    S.sb.from("picks").select("*").eq("league_id", id).order("pick_number"),
    fetchAllStats(),
    S.sb.from("team_stages").select("*").eq("league_id", id),
    S.sb.from("trades").select("*, trade_items(*)").eq("league_id", id)
      .order("created_at", { ascending: false }),
    S.sb.from("lineup_snapshots").select("*").eq("league_id", id)
      .order("effective_from"),
    S.sb.from("transactions").select("*").eq("league_id", id)
      .order("created_at", { ascending: false }),
    S.sb.from("messages").select("*").eq("league_id", id)
      .order("created_at"),
    S.sb.from("fa_claims").select("*").eq("league_id", id).order("rank"),
  ]);
  const err = m.error || p.error || st.error || tg.error || tr.error;
  if (err) return bail(err.message);
  S.managers = m.data;
  applyLocalOverrides();   // a read that started before our last write is stale
  S.picks = mergeOptimisticPicks(p.data, S.picks, Date.now());
  S.stats = st.data;
  S.stages = tg.data;
  S.trades = tr.data;
  S.snapshots = sn.data || [];
  // transactions is an optional, additive table; if the migration hasn't been
  // run yet, degrade to an empty log rather than failing the whole load.
  S.transactions = tx && !tx.error ? (tx.data || []) : [];
  // messages likewise degrade to no chat if the migration hasn't been run.
  S.messages = msg && !msg.error ? (msg.data || []) : [];
  // fa_claims likewise optional (waiver mode); empty if not migrated.
  S.faClaims = fac && !fac.error ? (fac.data || []) : [];
  /* Settlement records (Phase 1). Missing table = unmigrated database: keep an
     empty list and the settlement hook falls back to the legacy path. */
  try {
    const rd = await S.sb.from("rounds").select("*").eq("league_id", id);
    S.rounds = rd.error ? [] : (rd.data || []);
  } catch { S.rounds = []; }
  ptsCache = null;
  markConnection(true);
  route();
  // Fresh claims + fixtures + league row: the one moment we can judge whether
  // an auto-window league owes its managers a waiver run.
  backfillSnapshotRounds().catch(() => {});
  maybeAdvanceRounds().catch(() => {});
  return true;
}

/* Say whether the app is talking to the server. Going quiet is the failure
   mode people describe as "it stopped working", so it gets a visible state:
   the header dot turns amber and pulses, and a stale connection retries on its
   own with a backoff rather than waiting for the user to guess. */
let _connRetry = 0, _connTimer = null;
function markConnection(ok, msg) {
  const dot = $("conn-dot");
  if (ok) {
    _connRetry = 0;
    clearTimeout(_connTimer); _connTimer = null;
    if (dot) { dot.className = "w-2 h-2 rounded-full bg-wcgreen"; dot.title = "connected"; }
    return;
  }
  if (dot) {
    dot.className = "w-2 h-2 rounded-full bg-amber-400 stale";
    dot.title = "Reconnecting… " + (msg || "");
  }
  if (_connRetry === 0) toast("Connection lost — retrying…");
  // 1s, 2s, 4s, 8s, capped at 15s. Cheap, and it recovers without a reload.
  const wait = Math.min(15000, 1000 * 2 ** _connRetry++);
  clearTimeout(_connTimer);
  _connTimer = setTimeout(() => { refetchAll().catch(() => {}); }, wait);
}

/* Reload from the server, unless we're mid-conversation with it.

   Every write echoes back as a realtime event, which used to schedule a full
   reload of the league — so a burst of reorders produced a burst of reloads,
   each of them reading a row we were in the middle of replacing. Holding the
   refetch until our own writes have landed removes both the wasted round trips
   and the window the stale-read bounce lived in. */
/* Whose pick pointer to believe when a read disagrees with what we hold.
   The draft only ever moves forward, so a read reporting an EARLIER pick was
   issued before our advance landed and is stale by definition — applying it
   rewinds the room onto an already-expired clock. The exception is `forced`:
   a compare-and-swap that matched nothing means another client got there
   first, and then the server is right and we are not. */
const keepLocalPick = (mine, theirs, forced) =>
  !forced && (mine || 0) > (theirs || 0);

/* Merge a fresh read of the picks with the ones we've written but not yet read
   back. Same stale-read problem, on the list everyone is watching: a read
   issued before our insert committed comes back without it, and replacing the
   list wholesale makes the pick vanish from Recent picks and the player pop
   back into every queue — then reappear a moment later when the next read
   catches up. That is the frantic jumping.

   Only rows this client added optimistically are ever preserved, and only
   until the server returns them, so a genuine deletion (a redraft, a manager
   removed) is never resurrected. The age cap stops a failed insert leaving a
   ghost in the list. */
const PICK_GHOST_MAX_MS = 20000;
const pickKey = (pk) => `${pk.pick_number}:${pk.player_id}`;

function mergeOptimisticPicks(fresh, local, nowMs) {
  const pending = (local || []).filter((pk) => String(pk.id).startsWith("local-"));
  if (!pending.length) return fresh;
  const have = new Set(fresh.map(pickKey));
  const keep = pending.filter((pk) =>
    !have.has(pickKey(pk)) && nowMs - (pk._at || 0) <= PICK_GHOST_MAX_MS);
  if (!keep.length) return fresh;
  return [...fresh, ...keep].sort((a, b) => a.pick_number - b.pick_number);
}

// Set when that CAS tells us we lost, so the next read may move us backwards.
let forcePickResync = false;
let refetchTimer, _refetchWanted = false;
const scheduleRefetch = () => {
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => {
    if (_pendingWrites.size) { _refetchWanted = true; return; }
    refetchAll().catch(() => {});
  }, 250);
};

function subscribeRealtime() {
  const id = getSession()?.leagueId;
  if (!id || S.channel) return;
  // Competition leagues watch the SHARED competition_stats (any admin's pull
  // reaches every league on the competition); legacy WC leagues watch their own.
  const sc = statsScope();
  const statsSub = { table: sc.table, filter: `${sc.column}=eq.${sc.value}` };
  S.channel = S.sb.channel("league-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "leagues",     filter: "id=eq." + id },        scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "managers",    filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "picks",       filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", ...statsSub }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "team_stages", filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "trades",      filter: "league_id=eq." + id }, scheduleRefetch)
    // trade_items has no league_id to filter on; unfiltered is fine at this scale.
    .on("postgres_changes", { event: "*", schema: "public", table: "trade_items" }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "lineup_snapshots", filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages",     filter: "league_id=eq." + id }, scheduleRefetch)
    .on("postgres_changes", { event: "*", schema: "public", table: "fa_claims",     filter: "league_id=eq." + id }, scheduleRefetch)
    .subscribe((status) => {
      $("conn-dot").className = "w-2 h-2 rounded-full " +
        (status === "SUBSCRIBED" ? "bg-wcgreen" : "bg-amber-400");
    });
}

function leaveLeague() {
  if (S.channel) { S.sb.removeChannel(S.channel); S.channel = null; }
  setSession(null);
  S.league = null; S.managers = []; S.picks = []; S.stats = [];
  localOverrides.clear();   // pending edits belong to the league we just left
  // Pool is per-competition now — clear it so the next league loads its own.
  S.players = []; S.teams = []; S.playerById = {}; S.fixtures = null; S._compPool = undefined;
  S.messages = []; S.chatThread = "league"; S._chatSeenLoaded = false;
  $("hdr-league").textContent = "";
  renderHome();
  showView("home");
}

/* ---------- routing ---------- */

const leaguePhase = () => S.league?.phase || 1;
const activeManagers = () => S.managers.filter((m) => !m.eliminated);

// Quotas for the current phase. Phase 1 is fixed; redrafts use the
// admin-chosen quota on the league row. TEAM picks carry through every
// phase and are never redrafted, so their quota is 0 after phase 1.
// Flex FORMATION draft: the per-position quota is the formation minimum and the
// rest of the squad is fluid (draft any mix), so it reuses the flex-slot model.
const flexFormationMins = () => {
  const f = formationBounds();
  return { GK: f.GK[0], DEF: f.DEF[0], MID: f.MID[0], FWD: f.FWD[0], TEAM: phaseOneQuota().TEAM || 0 };
};
const posQuota = () => {
  if (isFlexFormation()) return flexFormationMins();
  return leaguePhase() === 1 ? phaseOneQuota() : { TEAM: 0, ...(S.league.phase_quota || {}) };
};
const starterQuota = () => {
  if (isFlexFormation()) { const f = formationBounds(); return { GK: f.GK[0], DEF: f.DEF[0], MID: f.MID[0], FWD: f.FWD[0] }; }
  return leaguePhase() === 1 ? phaseOneStarters()
    : (S.league.phase_starters || S.league.phase_quota || PHASE1_STARTERS);
};

// Fluid ("flex") squad slots for a redraft: extra places that can go to ANY
// outfield position (DEF/MID/FWD, never GK). The per-position quota is then a
// MINIMUM; flex fills the rest. 0 in phase 1 / when unset = the old fixed model.
const OUTFIELD = ["DEF", "MID", "FWD"];
const leagueFlex = () => {
  if (isFlexFormation()) {   // squad beyond the formation minimums is fluid
    const q = flexFormationMins();
    return Math.max(0, (cfgOf().squadSize ?? 15) - (q.GK + q.DEF + q.MID + q.FWD));
  }
  return leaguePhase() === 1 ? 0 : (S.league.phase_flex || 0);
};
// Flex-formation lineup slots (starting XI beyond the minimums are fluid).
const lineupFlex = () => isFlexFormation()
  ? Math.max(0, formationBounds().starters - (starterQuota().GK + starterQuota().DEF + starterQuota().MID + starterQuota().FWD))
  : leagueFlex();
const posCounts = (picks) => {
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const pk of picks) if (c[pk.position] != null) c[pk.position]++;
  return c;
};
const notSub = (pk) => pk.slot ? !String(pk.slot).startsWith("SUB_") : !pk.is_sub;
// Slots left for `group` under minimums + a shared outfield flex pool. GK is
// capped at its minimum; each outfield may take up to its minimum plus flex,
// but never so many that another position's minimum can't be met.
/* How many more of `group` will still fit.

   gkFixed says whether keepers are capped at the minimum. TRUE for a starting
   XI -- a flex formation fields exactly the keepers it says. FALSE for a SQUAD,
   because you need a backup: the formation minimum governs how many can START,
   not how many you may own, and capping the squad at it meant a flex league let
   you draft exactly one keeper and no cover.

   Either way the OTHER positions' minimums stay reserved, so filling up on
   keepers can never leave you unable to field a legal XI. */
function flexLeft(counts, group, mins, flex, gkFixed = true) {
  if (group === "GK" && gkFixed) return Math.max(0, (mins.GK || 0) - (counts.GK || 0));
  const size = (mins.GK || 0) + (mins.DEF || 0) + (mins.MID || 0) + (mins.FWD || 0) + (flex || 0);
  const cur = (counts.GK || 0) + (counts.DEF || 0) + (counts.MID || 0) + (counts.FWD || 0);
  let reserved = 0;
  for (const p of ["GK", ...OUTFIELD])
    if (p !== group) reserved += Math.max(0, (mins[p] || 0) - (counts[p] || 0));
  return Math.max(0, size - cur - reserved);
}
// A squad/lineup is complete when every slot is filled, the GK count is exact,
// and each outfield minimum is met (the flex sits on top, in any outfield).
function flexComplete(counts, mins, flex) {
  const size = (mins.GK || 0) + (mins.DEF || 0) + (mins.MID || 0) + (mins.FWD || 0) + (flex || 0);
  const cur = (counts.GK || 0) + (counts.DEF || 0) + (counts.MID || 0) + (counts.FWD || 0);
  return cur === size && (counts.GK || 0) === (mins.GK || 0)
    && OUTFIELD.every((p) => (counts[p] || 0) >= (mins[p] || 0));
}
const picksPerManager = () =>
  GROUPS.reduce((s, g) => s + (posQuota()[g] || 0), 0) + leagueFlex();
const totalPicks = () => draftSequence().length;

function route() {
  // A refetch landing mid-drag would replace the row under the user's finger.
  // Hold the repaint until they let go rather than pulling the rug.
  if (!afterDrag(route)) return;
  if (!S.league) { showView("home"); return; }
  $("hdr-league").textContent = S.league.name;
  // Keep the admin on their screen across realtime refreshes.
  const cur = document.querySelector("[data-view]:not(.hidden)")?.dataset.view;
  if (cur === "admin") { renderAdmin(); return; }
  if (!S.league.current_pick) {
    // Pre-draft: managers can browse the pool & shortlist from the board.
    if (S._browsing && myManager()) { renderBoard(); showView("board"); }
    else { renderLobby(); showView("lobby"); }
  } else if (S.league.current_pick <= totalPicks()) {
    renderDraft();
    showView("draft");
  } else {
    renderBoard();
    showView("board");
  }
}

// fixtures.json is optional (generated by build_fixtures.py).
// API-Football names some countries differently from the FIFA squad lists
// players.json uses; normalize to FIFA names so every team finds its
// fixtures. Same map lives in daily_pull.py for match labels — keep in sync.
const TEAM_NAME_FIX = {
  "Bosnia & Herzegovina": "Bosnia And Herzegovina",
  "Cape Verde Islands": "Cabo Verde",
  "Czech Republic": "Czechia",
  "Iran": "IR Iran",
  "Ivory Coast": "Côte D'Ivoire",
  "South Korea": "Korea Republic",
};
async function loadFixtures() {
  if (S.fixtures) return;
  const pool = await loadCompetitionPool();
  if (pool?.players?.length) {
    // API competition: stored fixtures already use the same API team names as
    // the pool, so no FIFA-name normalization is needed (or wanted).
    S.fixtures = pool.fixtures || [];
    return;
  }
  try {
    // no-store: fixtures.json is rebuilt daily (and scores change during games).
    // GitHub Pages caches static files ~10 min, so without this a stale copy
    // can hide new knockout fixtures / results (e.g. an empty bracket).
    const resp = await fetch("fixtures.json", { cache: "no-store" });
    S.fixtures = resp.ok ? await resp.json() : [];
  } catch { S.fixtures = []; }
  for (const f of S.fixtures) {
    f.home = TEAM_NAME_FIX[f.home] || f.home;
    f.away = TEAM_NAME_FIX[f.away] || f.away;
  }
}

function nextFixtureFor(team) {
  const cutoff = Date.now() - 3 * 3600 * 1000; // keep in-progress games visible
  return (S.fixtures || []).find((f) =>
    (f.home === team || f.away === team)
    && !["FT", "AET", "PEN"].includes(f.status)
    && Date.parse(f.kickoff_utc) > cutoff) || null;
}

function fixtureText(team) {
  if (!S.fixtures || !S.fixtures.length) return "";
  const f = nextFixtureFor(team);
  if (!f) return "";   // nothing scheduled: say nothing rather than repeat it
  const opp = f.home === team ? f.away : f.home;
  const d = new Date(f.kickoff_utc);
  // "Sat 17:55" for anything this week, "31 Jul" beyond it. The old
  // "Jul 31, 05:55 PM" was long enough that it truncated on every row.
  const soon = d - Date.now() < 6 * 864e5;
  const when = soon
    ? d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${f.home === team ? "vs" : "@"} ${opp} · ${when}`;
}

// Inline next fixture with the opponent crest: "🇧🇷 vs Brazil · Sun 22 Jun
// 19:00". Returns "" when no upcoming fixture is known. Caller supplies the
// flex container.
function fixtureCrestHtml(team, size = "w-4 h-4") {
  const f = nextFixtureFor(team);
  if (!f) return "";
  const opp = f.home === team ? f.away : f.home;
  const when = new Date(f.kickoff_utc).toLocaleString([],
    { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${avatarHtml("team:" + opp, opp, size)}<span class="truncate">${
    f.home === team ? "vs" : "@"} ${esc(opp)} · ${esc(when)}</span>`;
}

// Compact "next: <opponent crest>" for tight rows (the squad planner). The
// crest carries the full "vs Opp · date" as a hover tooltip. "" when unknown.
function upNextHtml(team, size = "w-4 h-4") {
  const f = nextFixtureFor(team);
  if (!f) return "";
  const opp = f.home === team ? f.away : f.home;
  const when = new Date(f.kickoff_utc).toLocaleString([],
    { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `<span class="inline-flex items-center gap-1 shrink-0" title="${
    f.home === team ? "vs" : "@"} ${esc(opp)} · ${esc(when)}">next:${avatarHtml("team:" + opp, opp, size)}</span>`;
}

// photos.json (faces/crests) and injuries.json (availability hints) are
// optional, like fixtures.json — the app degrades gracefully without them.
async function loadExtras() {
  const get = async (file, fallback) => {
    try { const r = await fetch(file, { cache: "no-store" }); return r.ok ? await r.json() : fallback; }
    catch { return fallback; }
  };
  if (S.photos === undefined) S.photos = await get("photos.json", null);
  if (S.injuryByPid === undefined) {
    const list = await get("injuries.json", []);
    // Expire by how fresh the feed is (`as_of` = the day it was built), since
    // the API's fixture_date is often stale. The feed rebuilds daily, so this
    // stays current; if it stops, badges fade after a few days. Older files
    // without `as_of` fall back to fixture_date.
    const cutoff = new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10);
    S.injuryByPid = {};
    for (const r of list || []) {
      if ((r.as_of || r.fixture_date || "") >= cutoff) S.injuryByPid[r.player_id] = r;
    }
  }
}

async function enterLeague() {
  await Promise.all([loadPlayers(), loadFixtures(), loadExtras()]);
  await refetchAll({ initial: true });
  subscribeRealtime();
}

/* The first load, with something on screen for every outcome. It used to be a
   bare `await enterLeague()` whose failure path showed nothing at all. */
async function enterLeagueWithFeedback() {
  showView("loading");
  const msg = $("loading-msg");
  if (msg) msg.textContent = "Loading your league…";
  try {
    await enterLeague();
  } catch (e) {
    const box = $("error-msg");
    if (box) box.textContent = String(e?.message || e || "Unknown error");
    showView("error");
  }
}

/* ---------- create / join / lobby ---------- */

// Populate the create-league form: competition options, the collapsible
// scoring/squad editor (WC defaults), and the show/hide + reset wiring.
// The create-form's team-bonus toggle (default on = a WC-style team pick).
S._createTeamOn = true;

// Flex-formation fields: total squad + starters + per-position [min,max] bounds.
function flexFieldsHtml(eff) {
  const f = eff.formation;
  const boundRow = (p) => `<div class="grid grid-cols-[3.5rem_1fr_1fr] gap-1.5 items-end">
    <span class="text-xs text-slate-400 pb-1.5">${p}</span>
    ${cfgNum(`formation.${p}.0`, "min", f[p][0], false)}
    ${cfgNum(`formation.${p}.1`, "max", f[p][1], false)}</div>`;
  return `
    <p class="text-xs text-slate-400">Each manager drafts any mix of players (as long as they can field a valid
      XI) and picks their own formation within these bounds each round. The bench can be any positions — but an
      all-forward bench can't cover a defender, so a manager trades sub flexibility for extra attackers.</p>
    <div class="grid grid-cols-2 gap-2">
      ${cfgNum("squadSize", "Squad size", eff.squadSize, false)}
      ${cfgNum("formation.starters", "Starting XI", f.starters, false)}
    </div>
    <div class="text-xs text-slate-400 font-medium">Formation bounds — min–max per position</div>
    ${["GK", "DEF", "MID", "FWD"].map(boundRow).join("")}`;
}

function paintSquad() {
  const eff = effectiveConfig({});
  const flex = S._createFlex;
  const btn = (mode, label) => `<button type="button" data-sqmode="${mode}" class="flex-1 rounded-lg py-1.5 text-xs font-semibold border ${
    (mode === "flex") === flex ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400"}">${label}</button>`;
  $("create-squad").innerHTML =
    `<div class="flex gap-2 mb-1">${btn("fixed", "Fixed formation")}${btn("flex", "Flex formation")}</div>`
    + (flex ? flexFieldsHtml(eff) : squadFieldsHtml(eff, false));
  $("create-squad").querySelectorAll("[data-sqmode]").forEach((b) => b.onclick = () => {
    S._createFlex = b.dataset.sqmode === "flex"; paintSquad(); updateCreateSummaries();
  });
  $("create-squad").oninput = updateCreateSummaries;
}

function paintCreateFields() {
  const eff = effectiveConfig({});
  S._createRules = eff.rules;
  S._createFlex = false;
  paintSquad();
  renderRulesEditor($("create-scoring"), S._createRules, { onChange: () => { updateCreateSummaries(); renderCreateBalance(); } });
  $("create-team-bonuses").innerHTML = stageBonusFieldsHtml(eff, false);
  $("create-team-fields").oninput = updateCreateSummaries;
  renderCreateBalance();
}

function syncCreateTeam() {
  for (const b of document.querySelectorAll("[data-teamtoggle]")) {
    const on = (b.dataset.teamtoggle === "on") === S._createTeamOn;
    b.className = "flex-1 rounded-lg py-2 text-sm font-semibold border " +
      (on ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  }
  $("create-team-fields").classList.toggle("hidden", !S._createTeamOn);
  updateCreateSummaries();
}

// Live one-line summaries in each collapsed section header.
function updateCreateSummaries() {
  const val = (k, d) => {
    const el = document.querySelector(`#create-squad [data-cfg="${k}"], #create-scoring [data-cfg="${k}"], #create-team-fields [data-cfg="${k}"]`);
    const n = el ? Number(el.value) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  const eff = effectiveConfig({});
  const q = ["GK", "DEF", "MID", "FWD"].reduce((s, p) => s + val(`quota.${p}`, eff.quota[p]), 0);
  const st = ["GK", "DEF", "MID", "FWD"].reduce((s, p) => s + val(`starters.${p}`, eff.starters[p]), 0);
  if ($("create-squad-summary")) $("create-squad-summary").textContent = S._createFlex
    ? `flex · ${val("formation.starters", eff.formation.starters)}-a-side`
    : `${q} squad · ${st} starters`;
  const scoringCustom = JSON.stringify(S._createRules) !== JSON.stringify(DEFAULT_RULES);
  if ($("create-scoring-summary")) $("create-scoring-summary").textContent =
    scoringCustom ? `${(S._createRules || []).length} custom rules` : "World Cup default";
  if ($("create-team-summary")) $("create-team-summary").textContent = S._createTeamOn
    ? `on · ${val("quota.TEAM", 1)} pick` : "off";
  if ($("create-order-summary")) $("create-order-summary").textContent =
    (S._createOrder === "manual") ? "set by admin" : "random";
  if ($("create-format-summary")) $("create-format-summary").textContent =
    `${S._createH2H ? "H2H" : "points"} · ${S._createWaiver ? "waiver" : "instant"}${S._createCaptain ? " · ©" : ""}${S._createAutoWin ? " · auto-windows" : ""}`;
}

// Highlight the active Format & Trades toggles + show/hide H2H params.
function syncCreateFormat() {
  for (const b of document.querySelectorAll("[data-fmt]"))
    b.className = "flex-1 rounded-lg py-2 text-xs font-semibold border " +
      ((b.dataset.fmt === "h2h") === S._createH2H ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  for (const b of document.querySelectorAll("[data-trade]"))
    b.className = "flex-1 rounded-lg py-2 text-xs font-semibold border " +
      ((b.dataset.trade === "waiver") === S._createWaiver ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  for (const b of document.querySelectorAll("[data-cap]"))
    b.className = "flex-1 rounded-lg py-2 text-xs font-semibold border " +
      ((b.dataset.cap === "on") === S._createCaptain ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  for (const b of document.querySelectorAll("[data-win]"))
    b.className = "flex-1 rounded-lg py-2 text-xs font-semibold border " +
      ((b.dataset.win === "auto") === S._createAutoWin ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  for (const b of document.querySelectorAll("[data-dorder]"))
    b.className = "flex-1 rounded-lg py-2 text-xs font-semibold border " +
      (b.dataset.dorder === (S._createOrder || "random") ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  if ($("create-order-note")) $("create-order-note").textContent = (S._createOrder === "manual")
    ? "You'll arrange the managers in the lobby before starting the draft."
    : "Positions are drawn when you start the draft — nobody knows the order in advance.";
  $("create-h2h-fields").classList.toggle("hidden", !S._createH2H);
  $("create-auto-fields").classList.toggle("hidden", !S._createAutoWin);
  if (S._createH2H) updateH2HFeedback();
  updateCreateSummaries();
}

// Friendly, colour-coded verdict on how an N-manager / R-round H2H schedule
// shakes out — feeds the live feedback box under the H2H options.
function h2hPlanMessage(p) {
  const s = (x) => x === 1 ? "" : "s";
  const rival = (min, max) => min === max ? `${min}×` : `${max}× or ${min}×`;
  if (p.balanced)
    return `<span class="text-emerald-400 font-semibold">✓ Perfectly balanced.</span> `
      + `${p.rounds} rounds = ${p.fullCycles} full round-robin cycle${s(p.fullCycles)}. `
      + `Everyone plays each rival ${p.playsMin}×`
      + (p.even ? "" : ` and sits out ${p.byesMin} bye weekend${s(p.byesMin)}`) + `.`;
  if (p.rumble)
    return `<span class="text-emerald-400 font-semibold">✓ Balanced with rumbles.</span> `
      + `${p.fullCycles} full cycle${s(p.fullCycles)} then ${p.rumbleRounds} rumble round${s(p.rumbleRounds)} `
      + `(everyone vs everyone). Head-to-head stays even: each rival met ${p.playsMin}×`
      + (p.even ? "" : ` with ${p.byesMin} bye${s(p.byesMin)} each`) + `.`;
  let msg = `<span class="text-amber-400 font-semibold">⚠ Slightly uneven.</span> `
    + `${p.fullCycles} full cycle${s(p.fullCycles)} + ${p.leftover} leftover round${s(p.leftover)}: `
    + `some pairs meet ${rival(p.playsMin, p.playsMax)}`;
  if (p.managersWithExtraBye > 0)
    msg += `, and ${p.managersWithExtraBye} manager${s(p.managersWithExtraBye)} get an extra bye weekend`;
  msg += `. `;
  const fixes = [];
  if (p.nearestDown >= 1) fixes.push(`${p.nearestDown}`);
  fixes.push(`${p.nearestUp}`);
  msg += `<span class="text-slate-400">Use ${fixes.join(" or ")} rounds for a clean split, `
    + `or tick “rumbles” to fold the leftover into all-play-all rounds.</span>`;
  return msg;
}

// Parse the placement-points input ("3, 2, 1" → [3,2,1]); defaults to 3-2-1.
function rumblePointsFromInput() {
  const raw = $("create-rumble-points")?.value || "";
  const arr = raw.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
  return arr.length ? arr : [3, 2, 1];
}

function updateH2HFeedback() {
  const box = $("create-h2h-feedback");
  if (!box) return;
  const n = Number($("create-num")?.value) || 0;
  const rounds = Number($("create-h2h-rounds")?.value) || 0;
  const rumble = $("create-h2h-rumble")?.checked === true;
  // Show + paint the rumble-scoring sub-panel.
  $("create-rumble-opts").classList.toggle("hidden", !rumble);
  const placement = S._createRumbleScoring === "placement";
  for (const b of document.querySelectorAll("[data-rumsc]"))
    b.className = "flex-1 rounded-lg py-1.5 text-xs font-semibold border " +
      ((b.dataset.rumsc === "placement") === placement ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  $("create-rumble-points-wrap").classList.toggle("hidden", !placement);
  if (n < 2) { box.innerHTML = '<span class="text-slate-400">Add at least 2 managers to check the schedule.</span>'; return; }
  if (rounds < 1) { box.innerHTML = '<span class="text-slate-400">Enter how many rounds you expect to play for a fairness check.</span>'; return; }
  const plan = h2hSchedulePlan(n, rounds, { rumble });
  let html = h2hPlanMessage(plan);
  if (rumble && plan.rumble)
    html += placement
      ? `<div class="text-slate-400 mt-1">Rumble scoring: top ${rumblePointsFromInput().length} by round score earn ${rumblePointsFromInput().join(", ")} (ties split).</div>`
      : `<div class="text-slate-400 mt-1">Rumble scoring: full head-to-head against every rival that round.</div>`;
  box.innerHTML = html;
}

// Load the selected competition's prior stats + player positions (once, cached)
// so the create-form balance check can score them under the candidate rules.
async function loadScoringPreviewData() {
  const box = $("create-balance"), sel = $("create-comp");
  if (!box || !sel) return;
  const isApi = sel.value && sel.value !== "wc";
  $("create-pull-wrap")?.classList.toggle("hidden", !isApi);   // pull button only for API comps
  if (!isApi) { S._previewData = null; return renderCreateBalance(); }
  const season = Number($("create-comp-season")?.value);
  if (!season) {
    S._previewData = null;
    updateCreatePullStatus();
    box.innerHTML = '<span class="text-xs text-slate-400">Enter a season above to validate against its prior data.</span>';
    return;
  }
  const key = `${sel.value}-${season}`;
  if (S._previewData?.key === key) { updateCreatePullStatus(); return renderCreateBalance(); }
  box.innerHTML = '<span class="text-xs text-slate-400">Loading prior data…</span>';

  const fetchSeason = async (s) => {
    const k = `${sel.value}-${s}`;
    const pool = await S.sb.from("competition_pools").select("players").eq("competition_key", k).maybeSingle();
    const posOf = {}, meta = {};
    for (const pl of (pool.data?.players || [])) { posOf[pl.player_id] = pl.position; meta[pl.player_id] = { name: pl.name, team: pl.team }; }
    const rows = [];
    for (let from = 0; ;) {
      const { data, error } = await S.sb.from("competition_stats").select("*")
        .eq("competition_key", k).order("id").range(from, from + 999);
      if (error) break;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    return { season: s, rows, posOf, meta };
  };

  try {
    /* A league for a season that hasn't kicked off has no results of its own to
       validate against — which is the normal case when you're setting one up.
       Fall back to the season before it: that is what "is my scoring balanced"
       actually means here. */
    let d = await fetchSeason(season);
    let usedFallback = false;
    if (!d.rows.length) {
      const prior = await fetchSeason(backtestSeason(season));
      if (prior.rows.length) { d = prior; usedFallback = true; }
    }
    S._previewData = { key, ...d, usedFallback };
  } catch { S._previewData = { key, season, rows: [], posOf: {}, meta: {}, usedFallback: false }; }
  updateCreatePullStatus();
  renderCreateBalance();
}

// Tell the user what's already in the shared store for the selected competition
// (so it's clear a re-pull isn't needed), and label the button accordingly.
function updateCreatePullStatus() {
  const d = S._previewData, status = $("create-pull-status"), btn = $("create-pull-history");
  if (!status || !btn) return;
  const kind = createCompKind();
  const want = createPreviewSeason();          // the season the check needs
  const players = Object.keys(d?.posOf || {}).length;
  const matches = new Set((d?.rows || []).map((r) => r.match_label)).size;
  if (players || matches) {
    status.innerHTML = `<span class="text-emerald-400">✓ Loaded ${esc(seasonLabel(kind, d.season))}:</span> ${players} players · ${matches} match${matches === 1 ? "" : "es"} (shared). Re-pull only adds new matches.`;
    btn.textContent = `⟳ Pull any new / missing ${seasonLabel(kind, want)} matches`;
  } else {
    status.textContent = `No ${seasonLabel(kind, want)} results stored yet — pull them to check the balance.`;
    btn.textContent = `⬇ Pull ${seasonLabel(kind, want)} players + results`;
  }
}

// Which competition kind the create form is on ("league" | "cup").
function createCompKind() {
  const v = $("create-comp")?.value;
  if (!v || v === "wc") return "cup";
  return COMPETITIONS.find((c) => String(c.apiLeagueId) === String(v))?.kind || "league";
}

/* The season the balance check should read: the one you're creating for if it
   already has results, otherwise the one before it. */
function createPreviewSeason() {
  const season = Number($("create-comp-season")?.value) || 0;
  const d = S._previewData;
  if (d?.rows?.length) return d.season;
  return backtestSeason(season);
}
function renderCreateBalance() {
  const d = S._previewData, box = $("create-balance");
  renderScoringBalance(box, d?.rows || null, d?.posOf || {}, S._createRules, d?.meta || {});
  // Never leave which season produced the verdict to inference.
  if (box && d?.rows?.length) {
    const kind = createCompKind();
    const chosen = Number($("create-comp-season")?.value) || 0;
    box.insertAdjacentHTML("afterbegin",
      `<p class="text-xs text-slate-400 mb-1.5">Checked against <b class="text-slate-200">${esc(seasonLabel(kind, d.season))}</b>${
        d.usedFallback ? ` — ${esc(seasonLabel(kind, chosen))} hasn't been played yet, so last season's results stand in.` : "."}</p>`);
  }
}

// On-demand: pull a competition's players + full-season history straight into
// the shared competition_pools / competition_stats, so the balance check works
// before any scheduled pull is set up. Best-effort per match (a failed fixture
// is logged and skipped, not fatal). log(text) streams progress.
async function pullCompetitionHistory(apiLeagueId, season, apiKey, key, log) {
  // 1. Players + positions. Reuse an already-loaded squad (saves ~20 API calls);
  //    only pull squads when the shared pool is empty. Fixtures always refresh.
  const existing = await S.sb.from("competition_pools").select("players").eq("competition_key", key).maybeSingle();
  let players = existing.data?.players || [];
  // Re-pull squads if the stored pool predates crest ids, so club badges fill in.
  if (players.length && players.some((p) => p.team_logo)) {
    log(`Reusing ${players.length} already-loaded players…`);
  } else {
    log("Pulling squads (players + positions)…");
    const built = await fetchCompetitionPool(apiKey, apiLeagueId, season,
      (d, t, tm) => log(`Squads ${d}/${t} — ${tm}…`));
    if (!built.players.length) throw new Error("No players returned — check the season for this competition.");
    players = built.players;
  }
  const fixtures = await fetchCompetitionFixtures(apiKey, apiLeagueId, season);
  const up = await S.sb.from("competition_pools").upsert(
    { competition_key: key, players, fixtures, updated_at: new Date().toISOString() },
    { onConflict: "competition_key" });
  if (up.error) throw new Error(up.error.message);
  // 2. Which matches are already stored? Skip them so a re-run only tops up the
  //    matches played since — the app tracks what it has, no full re-pull.
  const have = new Set();
  for (let from = 0; ;) {
    const { data, error } = await S.sb.from("competition_stats").select("match_label")
      .eq("competition_key", key).range(from, from + 999);
    if (error) break;
    for (const r of data || []) have.add(r.match_label);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const done = ["FT", "AET", "PEN"];
  const raw = await apiFootball(apiKey, "fixtures", { league: apiLeagueId, season });
  const completed = raw.filter((f) => done.includes(f.fixture.status?.short));
  const labelOf = (f) => `${f.teams.home.name} vs ${f.teams.away.name} (${f.fixture.date.slice(0, 10)})`;
  const todo = completed.filter((f) => !have.has(labelOf(f)));   // only the missing matches
  const already = completed.length - todo.length;
  if (!todo.length) {
    log(`✅ Up to date — all ${completed.length} completed match(es) already loaded (${players.length} players).`);
    return;
  }
  const keyField = { competition_key: key };
  const onConflict = "competition_key,player_id,match_label";
  const pidOf = (team, num, name, apiId) => "api_" + apiId;   // API pool → api_ ids
  let total = 0, fails = 0, i = 0;
  for (const f of todo) {
    i++;
    log(`Pulling new match ${i}/${todo.length}${already ? ` (${already} already loaded)` : ""}…`);
    try {
      const teamBlocks = await apiFootball(apiKey, "fixtures/players", { fixture: f.fixture.id });
      const { rows } = buildFixtureStatRows(f, teamBlocks, keyField, (n) => n, pidOf);
      if (rows.length) await resilientWrite("competition_stats", rows, { upsert: true, onConflict });
      total += rows.length;
    } catch { fails++; }
  }
  log(`✅ Done — ${players.length} players; ${todo.length} new match(es) added, ${already} already had data`
    + (fails ? `, ${fails} failed.` : "."));
}

async function pullCreateHistory() {
  const sel = $("create-comp");
  const apiLeagueId = sel?.value, season = Number($("create-comp-season")?.value);
  const apiKey = ($("create-api-key")?.value.trim()) || localStorage.getItem("wcf_apikey") || "";
  const log = (t) => { if ($("create-pull-log")) $("create-pull-log").textContent = t; };
  if (!apiLeagueId || apiLeagueId === "wc") return toast("Pick an API competition first.");
  if (!season) return toast("Pick a season first.");
  localStorage.setItem("wcf_apikey", apiKey);
  const btn = $("create-pull-history");
  btn.disabled = true;
  try {
    /* Pull the season the balance check needs, which for a league that hasn't
       kicked off is the PREVIOUS one. Pulling the upcoming season would fetch
       a fixture list with no results in it and leave the check as empty as it
       started — which is exactly what made this button look broken. */
    const want = createPreviewSeason();
    const key = `${apiLeagueId}-${want}`;
    await pullCompetitionHistory(Number(apiLeagueId), want, apiKey, key, log);
    S._previewData = null;               // invalidate cache and reload the panel
    await loadScoringPreviewData();
  } catch (e) {
    log("Pull failed: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- create-league presets ----------
   Creating a league can touch a dozen systems — formations, a per-stat scoring
   editor, team bonuses, H2H, waivers, captaincy, sub caps, automatic windows.
   All of it is worth having and none of it should be asked before someone's
   first game, so a preset produces a working league in one tap and everything
   else lives one link away. */
const CREATE_PRESETS = {
  classic: {
    blurb: "Snake draft, points tally, instant free agents. The straightforward one — good for a first league.",
    apply: () => { S._createH2H = false; S._createWaiver = false; S._createCaptain = false; S._createAutoWin = false; },
  },
  h2h: {
    blurb: "You play a different manager each round. Captain scores double, free agents go by waiver order, and the trade and lineup windows follow the real fixture calendar.",
    apply: () => { S._createH2H = true; S._createWaiver = true; S._createCaptain = true; S._createAutoWin = true; },
  },
  custom: {
    blurb: "Every setting, including the scoring editor — design your own points system and check it's balanced across positions against real past seasons.",
    // No team bonus by default: it is a knockout-tournament layer (a national
    // side banking points as it advances) and means nothing in a league season,
    // which is what most people building their own will be drafting.
    apply: () => { S._createTeamOn = false; },
  },
};

function applyCreatePreset(key) {
  S._createPreset = key;
  paintCreateFields();                 // back to defaults before layering the preset on
  S._createTeamOn = true; S._createH2H = false; S._createWaiver = false;
  S._createCaptain = false; S._createAutoWin = false; S._createRumbleScoring = "pairwise";
  (CREATE_PRESETS[key] || CREATE_PRESETS.classic).apply();
  S._createAdvanced = key === "custom";
  syncCreatePreset();
  syncCreateTeam();
  syncCreateFormat();
}

function syncCreatePreset() {
  for (const b of document.querySelectorAll("[data-preset]"))
    b.className = "rounded-lg py-2 text-xs font-semibold border " +
      (b.dataset.preset === S._createPreset
        ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400");
  const blurb = $("create-preset-blurb");
  if (blurb) blurb.textContent = (CREATE_PRESETS[S._createPreset] || CREATE_PRESETS.classic).blurb;
  const adv = $("create-advanced");
  if (adv) adv.classList.toggle("hidden", !S._createAdvanced);
  const link = $("create-customise");
  if (link) {
    link.textContent = S._createAdvanced ? "Hide settings ▴" : "Customise settings ▾";
    link.classList.toggle("hidden", S._createPreset === "custom");
  }
}

function renderCreateForm() {
  const sel = $("create-comp");
  if (sel.options.length <= 1)
    sel.innerHTML = `<option value="wc">World Cup 2026 (built-in squads)</option>`
      + COMPETITIONS.filter((c) => c.apiLeagueId !== 1)
          .map((c) => `<option value="${c.apiLeagueId}">${esc(c.name)}</option>`).join("");
  const syncApi = () => {
    $("create-comp-api").classList.toggle("hidden", sel.value === "wc");
    // Repopulate the season list: which seasons are open depends on whether
    // the competition is a domestic season or a tournament.
    const kind = createCompKind();
    const opts = seasonOptions(kind, Date.now());
    const seasonSel = $("create-comp-season");
    const keep = seasonSel.value;
    seasonSel.innerHTML = opts.map((y) =>
      `<option value="${y}">${esc(seasonLabel(kind, y))}</option>`).join("");
    if (opts.map(String).includes(keep)) seasonSel.value = keep;
    S._previewData = null;
    loadScoringPreviewData();
  };
  sel.onchange = syncApi;
  $("create-comp-season").addEventListener("change", () => {
    S._previewData = null; loadScoringPreviewData();
  });
  $("create-pull-history").onclick = pullCreateHistory;
  syncApi();
  S._createTeamOn = true; S._createH2H = false; S._createWaiver = false; S._createCaptain = false; S._createAutoWin = false;
  S._createOrder = S._createOrder || "random";
  /* Checkboxes and text inputs keep their own state across re-renders, unlike
     the S._create* flags reset above. A rumble ticked while exploring one
     preset therefore survived into whatever league was finally created --
     silently, since nothing else on the form mentions it again. */
  if ($("create-h2h-rumble")) $("create-h2h-rumble").checked = false;
  if ($("create-h2h-rounds")) $("create-h2h-rounds").value = "";
  if ($("create-rumble-points")) $("create-rumble-points").value = "";
  S._createRumbleScoring = "pairwise";
  S._createRumbleScoring = "pairwise";
  S._createPreset = S._createPreset || "classic";
  S._createAdvanced = S._createPreset === "custom";
  paintCreateFields();
  for (const b of document.querySelectorAll("[data-teamtoggle]"))
    b.onclick = () => { S._createTeamOn = b.dataset.teamtoggle === "on"; syncCreateTeam(); };
  for (const b of document.querySelectorAll("[data-fmt]"))
    b.onclick = () => { S._createH2H = b.dataset.fmt === "h2h"; syncCreateFormat(); };
  for (const b of document.querySelectorAll("[data-dorder]"))
    b.onclick = () => { S._createOrder = b.dataset.dorder; syncCreateFormat(); };
  for (const b of document.querySelectorAll("[data-trade]"))
    b.onclick = () => { S._createWaiver = b.dataset.trade === "waiver"; syncCreateFormat(); };
  for (const b of document.querySelectorAll("[data-cap]"))
    b.onclick = () => { S._createCaptain = b.dataset.cap === "on"; syncCreateFormat(); };
  for (const b of document.querySelectorAll("[data-win]"))
    b.onclick = () => { S._createAutoWin = b.dataset.win === "auto"; syncCreateFormat(); };
  for (const b of document.querySelectorAll("[data-preset]"))
    b.onclick = () => applyCreatePreset(b.dataset.preset);
  $("create-customise").onclick = () => { S._createAdvanced = !S._createAdvanced; syncCreatePreset(); };
  // Live H2H schedule fairness feedback as the manager count / rounds change.
  $("create-num").addEventListener("input", () => { if (S._createH2H) updateH2HFeedback(); });
  $("create-h2h-rounds").addEventListener("input", updateH2HFeedback);
  $("create-h2h-rumble").addEventListener("change", updateH2HFeedback);
  $("create-rumble-points").addEventListener("input", updateH2HFeedback);
  for (const b of document.querySelectorAll("[data-rumsc]"))
    b.onclick = () => { S._createRumbleScoring = b.dataset.rumsc; updateH2HFeedback(); };
  syncCreatePreset();
  syncCreateTeam();
  syncCreateFormat();
  $("create-reset").onclick = () => {
    S._createTeamOn = true; S._createH2H = false; S._createWaiver = false; S._createCaptain = false; S._createAutoWin = false;
    S._createRumbleScoring = "pairwise";
    applyCreatePreset("classic");
  };
  $("create-go").disabled = false;
  $("create-result").classList.add("hidden");
  $("create-comp-log").textContent = "";
}

// Pull (or reuse) a competition's shared pool during league creation.
async function ensureCompetitionPool(competition, apiKey, log) {
  const compKey = `${competition.apiLeagueId}-${competition.season}`;
  const existing = await S.sb.from("competition_pools").select("competition_key")
    .eq("competition_key", compKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) { log(`Reusing shared ${competition.name} pool.`); return; }
  if (!apiKey) throw new Error(`${competition.name} isn't loaded yet — enter an API-Football key.`);
  log("Fetching teams & squads…");
  const built = await fetchCompetitionPool(apiKey, competition.apiLeagueId, competition.season,
    (d, t, tm) => log(`Loading squads ${d}/${t} — ${tm}`));
  if (!built.players.length) throw new Error("No players returned — check the season.");
  log(`${built.players.length} players. Fetching fixtures…`);
  const fixtures = await fetchCompetitionFixtures(apiKey, competition.apiLeagueId, competition.season);
  const up = await S.sb.from("competition_pools").upsert(
    { competition_key: compKey, players: built.players, fixtures, updated_at: new Date().toISOString() });
  if (up.error) throw new Error(up.error.message);
  localStorage.setItem("wcf_apikey", apiKey);
}

// Read the whole create form's config (squad + scoring + team sections), apply
// the team-bonus toggle, and return null if it's all WC defaults.
function readCreateConfig() {
  const cfg = readConfigFromFields(document.querySelector('[data-view="create"]'));
  if (JSON.stringify(S._createRules) !== JSON.stringify(DEFAULT_RULES)) cfg.scoring = S._createRules;
  if (S._createFlex) {                     // flexible formations
    const g = (k) => Number(document.querySelector(`#create-squad [data-cfg="${k}"]`)?.value);
    cfg.formationMode = "flex";
    cfg.formation = {
      GK: [g("formation.GK.0"), g("formation.GK.1")],
      DEF: [g("formation.DEF.0"), g("formation.DEF.1")],
      MID: [g("formation.MID.0"), g("formation.MID.1")],
      FWD: [g("formation.FWD.0"), g("formation.FWD.1")],
      starters: g("formation.starters"),
    };
    cfg.squadSize = g("squadSize");
  }
  if (!S._createTeamOn) {                 // no team pick → drop TEAM and its bonuses
    cfg.quota = { ...(cfg.quota || {}), TEAM: 0 };
    delete cfg.stageBonus;
    delete cfg.finalPickBonus;
  }
  if (S._createOrder === "manual") cfg.draftOrder = "manual";   // admin sets it in the lobby
  if (S._createH2H) {                       // head-to-head standings format
    const g = (k) => Number(document.querySelector(`[data-view="create"] [data-cfg="${k}"]`)?.value);
    cfg.h2hEnabled = true;
    cfg.h2h = { win: g("h2h.win"), draw: g("h2h.draw"), loss: g("h2h.loss"),
      score_bonus: g("h2h.score_bonus"), losing_margin: g("h2h.losing_margin") };
    const rnds = $("create-h2h-rounds")?.value;
    if (rnds != null && rnds !== "") cfg.h2h.rounds = Number(rnds);   // planned rounds → schedule
    if ($("create-h2h-rumble")?.checked) {                            // rumble the leftover rounds
      cfg.h2h.rumble = true;
      cfg.h2h.rumble_scoring = S._createRumbleScoring || "pairwise";
      if (S._createRumbleScoring === "placement") cfg.h2h.rumble_points = rumblePointsFromInput();
    }
  }
  if (S._createWaiver) cfg.fa_defer_to_close = true;   // waiver-order trades
  const faCap = document.querySelector('[data-view="create"] [data-cfg="max_fa_per_window"]')?.value;
  if (faCap != null && faCap !== "") cfg.max_fa_per_window = Number(faCap);  // per-window FA cap (both modes)
  if (S._createCaptain) cfg.captain = true;            // captain + vice-captain
  const ms = document.querySelector('[data-view="create"] [data-cfg="maxSubs"]')?.value;
  if (ms != null && ms !== "") cfg.maxSubs = Number(ms);   // cap on subs per round
  if (S._createAutoWin) {                              // automatic fixture-driven windows
    cfg.autoWindows = true;
    const g = (k) => document.querySelector(`[data-view="create"] [data-cfg="${k}"]`)?.value;
    const w = {}, put = (k, key) => { const v = g(key); if (v != null && v !== "") w[k] = Number(v); };
    put("tradeOpenAfterH", "windows.tradeOpenAfterH");
    put("tradeCloseBeforeH", "windows.tradeCloseBeforeH");
    put("lineupLockBeforeH", "windows.lineupLockBeforeH");
    if (Object.keys(w).length) cfg.windows = w;
  }
  return JSON.stringify(effectiveConfig(cfg)) === JSON.stringify(effectiveConfig({})) ? null : cfg;
}

/* Every row these paths create is owned by an auth identity, and the RLS
   policies key off it. Without an account there is no uid, so the write would
   be refused by the database with a message nobody could act on -- better to
   say so up front. */
function requireAccount(what) {
  if (authUid()) return true;
  toast(`Create an account or sign in first — ${what} is tied to your account.`);
  showView("home");
  const el = $("account-email");
  if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
  return false;
}

async function createLeague() {
  if (!requireAccount("a league")) return;
  const name = $("create-name").value.trim();
  const num = parseInt($("create-num").value, 10);
  const dur = parseInt($("create-dur").value, 10);
  if (!name) return toast("Give the league a name.");
  if (!(num >= 2 && num <= 15)) return toast("Managers must be 2–15.");
  if (!(dur >= 0 && dur <= 600)) return toast("Pick duration must be 0–600s (0 = no limit).");

  // Competition (World Cup built-in, or an API-Football competition).
  const compVal = $("create-comp").value;
  let competition = null;
  if (compVal !== "wc") {
    const season = parseInt($("create-comp-season").value, 10);
    if (!season) return toast("Enter the season for the competition.");
    const c = COMPETITIONS.find((x) => x.apiLeagueId === +compVal);
    competition = { name: c?.name || ("League " + compVal), apiLeagueId: +compVal, season };
  }
  const config = readCreateConfig();   // null = pure WC defaults

  const log = (t) => { $("create-comp-log").textContent = t; };
  const btn = $("create-go");
  btn.disabled = true;
  try {
    // Load the competition pool BEFORE creating the league, so a key/season
    // mistake fails fast without leaving an empty, misconfigured league.
    if (competition) await ensureCompetitionPool(competition, $("create-api-key").value.trim(), log);

    const row = {
      name, num_managers: num, pick_duration_seconds: dur,
      invite_code: genInviteCode(), admin_token: crypto.randomUUID(), current_pick: 0,
    };
    if (config) row.config = config;
    if (competition) row.competition = competition;
    row.owner_id = authUid();   // creator's account → admin, and the RLS owner
    const { data, error } = await insertLeagueRow(row);
    if (error) throw new Error(error.message);

    setSession({ leagueId: data.id, adminToken: data.admin_token, managerId: null });
    $("create-code").textContent = data.invite_code;
    $("create-admin").textContent = data.admin_token;
    $("create-result").classList.remove("hidden");
    log(competition ? `✅ ${competition.name} ${competition.season} ready.` : "");
  } catch (e) {
    toast("Create failed: " + e.message);
    btn.disabled = false;
  }
}

// Insert a league, dropping the config/competition columns and retrying if the
// database hasn't had schema.sql applied yet (so a basic league still creates).
async function insertLeagueRow(row) {
  let payload = { ...row };
  for (;;) {
    const res = await S.sb.from("leagues").insert(payload).select().single();
    const col = res.error && /Could not find the '(config|competition|owner_id)' column/.exec(res.error.message)?.[1];
    if (!col) return res;
    if (col === "config" || col === "competition")
      toast("Custom settings need schema.sql — created a standard league instead.");
    delete payload[col];   // drop the missing optional column and retry
  }
}
// Insert a manager, tolerating an unapplied user_id migration (drops it + retries).
async function insertManagerRow(row) {
  let payload = { ...row };
  for (;;) {
    const res = await S.sb.from("managers").insert(payload).select().single();
    if (!(res.error && /Could not find the 'user_id' column/.test(res.error.message || ""))) return res;
    delete payload.user_id;
  }
}

async function findLeague() {
  const code = $("join-code").value.trim().toUpperCase();
  if (code.length < 4) return toast("Enter the invite code.");
  const { data, error } = await S.sb.from("leagues")
    .select("*").eq("invite_code", code).maybeSingle();
  if (error) return toast(error.message);
  if (!data) return toast("No league with that code.");
  S.joinTarget = data;
  const { data: mgrs } = await S.sb.from("managers")
    .select("*").eq("league_id", data.id).order("created_at");
  S.joinManagers = mgrs || [];
  $("join-league-name").textContent = data.name;
  $("join-league-meta").textContent =
    `${S.joinManagers.length}/${data.num_managers} managers · ${data.pick_duration_seconds}s per pick` +
    (data.current_pick ? " · draft already started" : "");
  const full = S.joinManagers.length >= data.num_managers;
  $("join-new-wrap").classList.toggle("hidden", full || data.current_pick > 0);
  const list = $("join-reclaim-list");
  list.innerHTML = "";
  const uid = authUid();
  for (const m of S.joinManagers) {
    // Claimable if nobody owns it yet, or it is already yours. A manager linked
    // to another account is shown as taken rather than offered.
    const taken = !!m.user_id && m.user_id !== uid;
    const b = document.createElement("button");
    b.className = "w-full text-left rounded-lg bg-slate-900 border px-3 py-2 "
      + (taken ? "border-slate-800 text-slate-500 cursor-not-allowed"
               : "border-slate-700 hover:border-wcgold");
    b.innerHTML = `<span>${esc(m.name)}</span>` + (taken
      ? '<span class="float-right text-xs">🔒 linked to an account</span>'
      : (m.user_id ? '<span class="float-right text-xs text-wcgold">yours</span>' : ""));
    b.disabled = taken;
    if (!taken) b.onclick = () => claimManager(m);
    list.appendChild(b);
  }
  $("join-reclaim-wrap").classList.toggle("hidden", !S.joinManagers.length);
  $("join-found").classList.remove("hidden");
}

function joinSessionBase() {
  const tok = $("join-admin-token").value.trim();
  return {
    leagueId: S.joinTarget.id,
    adminToken: tok && tok === S.joinTarget.admin_token ? tok : (getSession()?.leagueId === S.joinTarget.id ? getSession()?.adminToken : null),
  };
}

async function joinLeague() {
  if (!requireAccount("your manager")) return;
  const name = $("join-name").value.trim();
  if (!name) return toast("Enter your manager name.");
  if (S.joinManagers.some((m) => m.name.toLowerCase() === name.toLowerCase()))
    return toast("That name is taken — pick another or reclaim it below.");
  if (S.joinManagers.length >= S.joinTarget.num_managers) return toast("League is full.");
  // Always set: RLS only lets you insert a manager that belongs to you.
  const row = { league_id: S.joinTarget.id, name, join_token: crypto.randomUUID(),
                user_id: authUid() };
  const { data, error } = await insertManagerRow(row);
  if (error) return toast("Join failed: " + error.message);
  setSession({ ...joinSessionBase(), managerId: data.id });
  await enterLeague();
}

// Trust-based reclaim (friend group, open RLS): pick your name to continue
// on a new device. If you're signed in and the name isn't linked yet, claim it
// to your account so it follows you from now on.
async function claimManager(m) {
  const uid = authUid();
  if (m.user_id && uid && m.user_id !== uid)
    return toast("That manager belongs to another account.");
  if (uid && !m.user_id)
    // Claim it on first use so it follows this account from now on. The
    // .is("user_id", null) makes it a race-safe compare-and-set: whoever gets
    // there first owns it, rather than the last write winning.
    await S.sb.from("managers").update({ user_id: uid })
      .eq("id", m.id).is("user_id", null).then(() => {}, () => {});
  setSession({ ...joinSessionBase(), managerId: m.id });
  await enterLeague();
}

function renderLobby() {
  const L = S.league;
  $("lobby-name").textContent = L.name;
  $("lobby-code").textContent = L.invite_code;
  $("lobby-settings").textContent =
    `${L.num_managers} managers · ${L.pick_duration_seconds}s per pick · ${picksPerManager()} rounds`;
  $("lobby-count").textContent = `${S.managers.length}/${L.num_managers}`;
  const me = myManager();
  const admin = isAdmin();
  $("lobby-managers").innerHTML = S.managers.map((m) =>
    `<li class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
      <span class="shrink-0 inline-flex items-center justify-center rounded-md w-6 h-6 text-[13px]"
            style="background:${managerColor(m)}22;border:1px solid ${managerColor(m)}88">${managerMark(m)}</span>
      <span class="flex-1 min-w-0 truncate">${esc(m.name)}${
        m.id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""}${
        m.is_bot ? ' <span class="text-slate-400 text-xs">🤖 bot</span>' : ""}</span>` +
    (m.id === me?.id
      ? '<button data-editcrest="1" class="tap shrink-0 text-xs text-wcgold underline">edit crest</button>' : "") +
    (admin && m.id !== me?.id
      ? `<button data-kick="${esc(m.id)}" title="kick" class="tap shrink-0 text-slate-400 hover:text-wcred">✕</button>` : "") +
    "</li>").join("") || '<li class="text-slate-400">Nobody yet — share the code above.</li>';
  if (admin) $("lobby-managers").querySelectorAll("[data-kick]").forEach((b) =>
    b.onclick = () => kickManager(b.dataset.kick));
  $("lobby-managers").querySelectorAll("[data-editcrest]").forEach((b) =>
    b.onclick = openCrestPicker);
  $("lobby-admin").classList.toggle("hidden", !admin);
  $("lobby-wait").classList.toggle("hidden", admin);
  if (admin && document.activeElement !== $("lobby-num-input"))
    $("lobby-num-input").value = L.num_managers;
  const ready = S.managers.length === L.num_managers;
  $("lobby-start").disabled = !ready;
  $("lobby-start").textContent = ready
    ? "Start draft" : `Start draft (waiting for ${L.num_managers - S.managers.length} more)`;
  $("lobby-join").classList.toggle("hidden",
    !!me || S.managers.length >= L.num_managers);
  $("lobby-browse").classList.toggle("hidden", !me);
  $("lobby-browse").onclick = () => { S._browsing = true; renderBoard(); showView("board"); };
  renderLobbyOrder();
  $("lobby-rules").innerHTML = lobbyRulesHtml();
}

async function joinFromLobby() {
  if (!requireAccount("your manager")) return;
  const name = $("lobby-join-name").value.trim();
  if (!name) return toast("Enter a name.");
  if (S.managers.some((m) => m.name.toLowerCase() === name.toLowerCase()))
    return toast("That name is taken.");
  const row = { league_id: S.league.id, name, join_token: crypto.randomUUID(),
                user_id: authUid() };
  const { data, error } = await insertManagerRow(row);
  if (error) return toast(error.message);
  setSession({ ...getSession(), managerId: data.id });
  scheduleRefetch();
}

// Fill the remaining lobby slots with bots so a draft can go ahead (or be
// rehearsed) without waiting for every human to arrive.
async function addBots(n) {
  const need = n ?? Math.max(0, (S.league.num_managers || 0) - S.managers.length);
  if (need <= 0) return toast("The lobby is already full.");
  const taken = new Set(S.managers.map((m) => m.name.toLowerCase()));
  const rows = [];
  for (const name of BOT_NAMES) {
    if (rows.length >= need) break;
    if (taken.has(name.toLowerCase())) continue;
    rows.push({ league_id: S.league.id, name, is_bot: true, join_token: crypto.randomUUID() });
  }
  const { error } = await S.sb.from("managers").insert(rows);
  if (error) return toast(/is_bot/.test(error.message)
    ? "Bots need a schema update — run schema.sql." : error.message);
  toast(`Added ${rows.length} bot${rows.length === 1 ? "" : "s"}.`);
  scheduleRefetch();
}

// One tap from the home screen: a throwaway league against bots, so you can
// rehearse a draft (and your shortlist) before the real one.
async function startPracticeDraft(bots) {
  if (!requireAccount("a practice league")) return;
  const row = {
    name: "Practice draft", num_managers: bots + 1, pick_duration_seconds: 30,
    invite_code: genInviteCode(), admin_token: crypto.randomUUID(), current_pick: 0,
  };
  row.owner_id = authUid();
  const { data: league, error } = await insertLeagueRow(row);
  if (error) throw new Error(error.message);
  setSession({ leagueId: league.id, adminToken: league.admin_token, managerId: null });
  S.league = league;
  const meRow = { league_id: league.id, name: "You", join_token: crypto.randomUUID(),
                  user_id: authUid() };
  const { data: me, error: me2 } = await insertManagerRow(meRow);
  if (me2) throw new Error(me2.message);
  setSession({ ...getSession(), managerId: me.id });
  S.managers = [me];
  await addBots(bots);
  await enterLeague();
}

// Admin removes a manager from the lobby (before the draft starts).
async function kickManager(id) {
  if (!isAdmin() || S.league.current_pick) return;
  const m = S.managers.find((x) => x.id === id);
  if (!m || !confirm(`Kick ${m.name} from the lobby?`)) return;
  await S.sb.from("picks").delete().eq("league_id", S.league.id).eq("manager_id", id);
  const { error } = await S.sb.from("managers").delete().eq("id", id);
  if (error) return toast(error.message);
  toast(`${m.name} removed.`);
  scheduleRefetch();
}

/* How pick order is decided: shuffled when the draft starts, or arranged by the
   admin in the lobby beforehand. Snake either way — this only sets round one. */
const draftOrderMode = () => cfgOf().draftOrder === "manual" ? "manual" : "random";

const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Persist an explicit order. Positions are 1-based and contiguous, which is
// what draftSequence() assumes.
async function setDraftOrder(ids) {
  const res = await Promise.all(ids.map((id, i) =>
    S.sb.from("managers").update({ draft_position: i + 1 }).eq("id", id)));
  const bad = res.find((r) => r.error);
  if (bad) toast(bad.error.message);
}

/* The lobby's order editor — the same affordances as the draft queue, because
   it is the same job: hold a row to drag it anywhere, or nudge it one place.
   Managers with no position yet fall in behind those that have one, so the list
   is stable before anyone has touched it. */
function lobbyOrderManagers() {
  return [...S.managers].sort((a, b) =>
    (a.draft_position ?? 99) - (b.draft_position ?? 99)
    || String(a.name).localeCompare(String(b.name)));
}

function renderLobbyOrder() {
  const box = $("lobby-order");
  if (!box) return;
  const manual = draftOrderMode() === "manual";
  const admin = isAdmin();
  box.classList.toggle("hidden", !manual || !admin);
  const note = $("lobby-order-note");
  if (note) note.textContent = manual
    ? (admin ? "" : "The admin is setting the draft order.")
    : "Draft order is drawn at random when the draft starts. Snake order.";
  if (!manual || !admin) return;
  if (!afterDrag(renderLobbyOrder)) return;

  const list = lobbyOrderManagers();
  const me = myManager();
  $("lobby-order-list").innerHTML = list.map((m, n) => `
    <li data-dorow="${esc(m.id)}" class="flex items-center gap-1.5 py-1 rounded">
      <span class="w-4 shrink-0 text-xs text-slate-400 font-mono">${n + 1}</span>
      <span class="shrink-0 inline-flex items-center justify-center rounded-md w-6 h-6 text-[13px]"
            style="background:${managerColor(m)}22;border:1px solid ${managerColor(m)}88">${managerMark(m)}</span>
      <span class="min-w-0 flex-1 truncate text-sm">${esc(m.name)}${
        m.id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""}${
        m.is_bot ? ' <span class="text-slate-400 text-xs">🤖</span>' : ""}</span>
      ${n === 0 ? '<span class="shrink-0 text-[10px] uppercase tracking-wide text-wcgold">1st pick</span>' : ""}
      ${list.length > 1 ? `<span class="nudge-col shrink-0 leading-none">
        <button data-doup="${esc(m.id)}" class="nudge text-slate-400 ${n === 0 ? "opacity-30" : ""}" ${n === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
        <button data-dodn="${esc(m.id)}" class="nudge text-slate-400 ${n === list.length - 1 ? "opacity-30" : ""}" ${n === list.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
      </span>` : ""}
    </li>`).join("")
    || '<li class="text-xs text-slate-400 py-1">Nobody has joined yet.</li>';

  // Write the order the admin can SEE, so a slow round-trip can't reorder the
  // list under their finger (the same reason the draft queue works this way).
  const commit = (ids) => {
    ids.forEach((id, i) => {
      const m = S.managers.find((x) => x.id === id);
      if (m) m.draft_position = i + 1;
    });
    setDraftOrder(ids);
  };
  const slide = (id, dir) => {
    const ids = lobbyOrderManagers().map((m) => m.id);
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    commit(ids);
    animateReorder("lobby-order-list", "data-dorow", renderLobbyOrder, id);
  };
  $("lobby-order-list").querySelectorAll("[data-doup]").forEach((b) =>
    b.onclick = () => slide(b.dataset.doup, -1));
  $("lobby-order-list").querySelectorAll("[data-dodn]").forEach((b) =>
    b.onclick = () => slide(b.dataset.dodn, 1));
  makeReorderable($("lobby-order-list"), "data-dorow", (order) => {
    commit(order);
    renderLobbyOrder();
  });
}

async function startDraft() {
  if (!isAdmin()) return;
  if (S.managers.length !== S.league.num_managers) return;
  // Manual: keep the order the admin arranged (anyone still unplaced falls in
  // behind, so a late joiner can never silently take pick one).
  const order = draftOrderMode() === "manual"
    ? lobbyOrderManagers() : shuffled(S.managers);
  await Promise.all(order.map((m, i) =>
    S.sb.from("managers").update({ draft_position: i + 1 }).eq("id", m.id)));
  const { error } = await S.sb.from("leagues")
    .update({ current_pick: 1, pick_started_at: new Date().toISOString() })
    .eq("id", S.league.id).eq("current_pick", 0);
  if (error) return toast(error.message);
  await refetchAll();
}

/* ---------- draft ---------- */

S.poolFilter = "ALL";
S.poolSearch = "";
S.poolSort = "";            // draft pool: sort by a stat ("" = default order)
S.bannerDayOffset = 0;      // matchday banner: 0 = default day, -1 = prev, etc.
S.poolShortlistOnly = false;
let autoPickedFor = 0;
// How long past the deadline an unlanded auto-pick waits before being retried.
const AUTOPICK_RETRY_S = 10;

/* Has an auto-pick been claimed for the pick we're still sitting on, long
   enough past the deadline that it plainly never landed? The guard is set
   before the write, so without this a pick that fails silently freezes the
   room at 0:00 for good. */
const autoPickStale = (guardedPick, currentPick, remainS, retryS = AUTOPICK_RETRY_S) =>
  !!guardedPick && guardedPick === currentPick && remainS <= -retryS;

function draftOrderManagers() {
  return activeManagers().sort(
    (a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99));
}

// Snake order decides whose turn it is; the manager drafts any position
// they like, within the phase's position quota.
//
// Kept players fill squad slots, so keeper-holders need fewer draft
// picks. Each keeper costs that manager's earliest round: keep 2 and you
// join the snake from round 3. With no keepers (phase 1) this is a plain
// snake. Kept counts are fixed when the redraft starts, so the sequence
// is deterministic for the whole draft.
const keptCount = (mgrId) =>
  managerPicks(mgrId).filter((pk) => pk.kept).length;

function draftSequence() {
  const order = draftOrderManagers();
  const rounds = picksPerManager();
  const seq = [];
  for (let r = 1; r <= rounds; r++) {
    const row = r % 2 === 1 ? order : [...order].reverse();
    for (const m of row) if (keptCount(m.id) < r) seq.push({ round: r, manager: m });
  }
  return seq;
}

function pickInfo(p) {
  const seq = draftSequence();
  return seq[Math.min(p, seq.length) - 1];
}

// Every unpicked player, whatever their position (TEAM picks excluded -- they
// are a different kind of thing and are never swapped this way).
function availableForAnyGroup() {
  const picked = pickedIdSet();
  return S.players.filter((pl) => pl.position !== "TEAM" && !picked.has(pl.player_id));
}

function availableForGroup(group) {
  const picked = pickedIdSet();
  if (group === "TEAM") {
    return S.teams.filter((t) => !picked.has("team:" + t))
      .map((t) => ({ player_id: "team:" + t, name: t, position: "TEAM", team: t }));
  }
  return S.players.filter((pl) => pl.position === group && !picked.has(pl.player_id));
}

// All players in a group (picked or not) for the draft pool display — picked
// players stay visible with an owner badge rather than vanishing. Knocked-out
// teams drop out entirely: their players aren't draftable, so they'd only be
// dead weight in the list (redrafts especially).
function poolEntries(group) {
  if (group === "TEAM")
    return S.teams.filter((t) => !isEliminated(t))
      .map((t) => ({ player_id: "team:" + t, name: t, position: "TEAM", team: t }));
  return S.players.filter((pl) => pl.position === group && !isEliminated(pl.team));
}

const managerPicks = (mgrId) => S.picks.filter((pk) => pk.manager_id === mgrId);

/* ---------- shortlist (per-manager, synced; only ever shown to its owner) ---------- */

const preDraftBrowsing = () => !S.league?.current_pick && !!S._browsing;
const myShortlist = () => myManager()?.shortlist || [];
const isShortlisted = (pid) => myShortlist().includes(pid);

// Persist a new shortlist (optimistic, reverts on failure). Shared by the star
// toggle and the Clean/Clear buttons. Returns true on success.
/* Your shortlist is private to you: nobody else's screen depends on it, so
   there is nothing to refetch and nothing to wait for. Apply it locally and let
   the write happen in the background — this used to block on a round trip and
   then reload all nine tables, which is why reordering felt broken. */
/* Fields this device has changed but not yet seen confirmed by the server.

   Every write echoes back as a realtime event, which triggers a refetch. Tap
   ▲ twice quickly and the refetch for the FIRST write lands after the second
   one has already been applied locally — so the row visibly snaps back to the
   old order before jumping forward again. That is the "glitch": not lag, a
   stale read overwriting a newer local truth. Re-applying these after every
   refetch makes the local value win until the server has caught up. */
const localOverrides = new Map();          // "table:id:field" -> value

/* Should our local value still shadow the server's?

   The old rule was "for two seconds after the write is acknowledged", which is
   a guess about network timing, and on a phone it is the wrong guess. A read
   issued before our write is processed by Postgres before our write, so it
   carries the OLD value however long the response then takes to arrive — and
   if it arrives after the two seconds are up, the row visibly drops back.

   The rule is now self-verifying: keep ours until the server hands us back
   what we wrote. No timing assumption at all. The age ceiling is only there so
   a write that can never be confirmed can't shadow the server forever. */
const OVERRIDE_MAX_MS = 30000;

function overrideStillWins(serverValue, rec, pending, nowMs, maxMs = OVERRIDE_MAX_MS) {
  if (!rec) return false;
  const same = JSON.stringify(serverValue ?? null) === JSON.stringify(rec.value ?? null);
  if (same) return false;              // the server has caught up; we're done
  if (pending) return true;            // our write hasn't landed yet
  return nowMs - rec.at <= maxMs;      // give up eventually rather than wedge
}

// Which local collection a table's overrides apply to.
const OVERRIDE_TABLES = { managers: () => S.managers, picks: () => S.picks,
  fa_claims: () => S.faClaims };

function applyLocalOverrides() {
  const now = Date.now();
  for (const [key, rec] of [...localOverrides]) {
    const [table, id, field] = key.split(":");
    const rows = OVERRIDE_TABLES[table]?.();
    if (!rows) continue;
    const row = rows.find((x) => x.id === id);
    if (!row) continue;                 // deleted, or not read back yet
    if (overrideStillWins(row[field], rec, _pendingWrites.has(key), now)) row[field] = rec.value;
    else localOverrides.delete(key);
  }
}

const _writeTimers = new Map();
const _pendingWrites = new Set();     // keys with a write queued or in flight

// A write has finished (or failed). If nothing else is outstanding, run the
// refetch we held back while it was.
function writeSettled(key) {
  if (_writeTimers.has(key)) return;  // a newer write for the same field is queued
  _pendingWrites.delete(key);
  if (!_pendingWrites.size && _refetchWanted) { _refetchWanted = false; scheduleRefetch(); }
}

/* Coalesce a burst of edits to one column into a single write, and hold the
   local value as authoritative until the server hands it back to us.

   Every optimistic write in the app should go through here. Writing directly
   and then refetching is the pattern that produced the shortlist bounce, the
   rewinding draft and the vanishing pick: the read can predate the write, and
   whatever it carries lands on top of a value the user has already seen. */
function queueFieldWrite(table, id, field, value, onError) {
  const key = `${table}:${id}:${field}`;
  localOverrides.set(key, { value, at: Date.now() });
  _pendingWrites.add(key);
  clearTimeout(_writeTimers.get(key));
  _writeTimers.set(key, setTimeout(() => {
    _writeTimers.delete(key);
    const rec = localOverrides.get(key);
    if (!rec) { writeSettled(key); return; }
    S.sb.from(table).update({ [field]: rec.value }).eq("id", id).then(({ error }) => {
      if (error) { localOverrides.delete(key); writeSettled(key); onError?.(error); return; }
      writeSettled(key);
    }, () => { localOverrides.delete(key); writeSettled(key); });
  }, 250));
}

const queueManagerWrite = (id, field, value, onError) =>
  queueFieldWrite("managers", id, field, value, onError);

function setShortlist(next) {
  const me = myManager();
  if (!me) { toast("Join as a manager to shortlist players."); return false; }
  me.shortlist = next;
  queueManagerWrite(me.id, "shortlist", next, (error) => {
    renderPredraftShortlist();
    if (S.league?.current_pick) renderDraftQueue(myManager(), false);
    toast(/shortlist/.test(error.message)
      ? "Shortlist needs a schema update — run schema.sql." : error.message);
    scheduleRefetch();                       // fall back to server truth
  });
  return true;
}

// Move a shortlisted player up or down the queue. Auto-pick takes the top
// available entry, so this is the control that decides what you get.
function moveShortlist(pid, dir) {
  const cur = myShortlist().slice();
  const i = cur.indexOf(pid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return;
  [cur[i], cur[j]] = [cur[j], cur[i]];
  setShortlist(cur);
}

function toggleShortlist(pid) {
  const cur = myShortlist();
  const next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
  return setShortlist(next);
}

/* How far into the draft a shortlist of `count` names actually covers you.
   "One name per round" is far too shallow: by your last pick most of your
   board is gone, taken by everyone else. The draft snakes, so the number of
   players off the board before your r-th pick alternates with the direction
   of travel rather than being a flat multiple of the league size.

   Returns the last round your board still reaches (0 = it doesn't even cover
   your first pick), the depth needed to reach the final round, and how many
   more names would buy you one more round. Pure, so the arithmetic that
   drives the progress meter is pinned by tests rather than eyeballed. */
function shortlistCoverage(count, managers, rounds, draftPos) {
  const N = Math.max(1, managers | 0), R = Math.max(1, rounds | 0);
  const d = Math.min(N, Math.max(1, draftPos | 0 || 1));
  // Odd rounds run 1→N, even rounds run N→1; subtract one for your own pick.
  const takenBefore = (r) => (r - 1) * N + (r % 2 === 1 ? d : N - d + 1) - 1;
  let through = 0;
  for (let r = 1; r <= R; r++) {
    if (count <= takenBefore(r)) break;
    through = r;
  }
  return {
    through,
    target: takenBefore(R) + 1,
    nextAt: through >= R ? null : takenBefore(through + 1) + 1,
    needForNext: through >= R ? 0 : Math.max(0, takenBefore(through + 1) + 1 - count),
  };
}

/* Apply a reordering of a VISIBLE subset back onto the full list.

   The draft queue shows only the shortlisted players who are still available
   and still fit a slot, so dragging the third visible row to the top must not
   disturb the hidden entries around it. The slots the visible items occupied
   stay exactly where they are; only which item sits in each slot changes. */
function applyVisibleOrder(full, visibleNew) {
  const wanted = new Set(visibleNew);
  const slots = [];
  full.forEach((id, i) => { if (wanted.has(id)) slots.push(i); });
  const out = full.slice();
  slots.forEach((slot, k) => { if (k < visibleNew.length) out[slot] = visibleNew[k]; });
  return out;
}

// Says what the coverage number means in the language of the draft.
function coverageHint(cov, rounds) {
  if (cov.through >= rounds) return `covers all ${rounds} picks ⭐`;
  if (cov.through === 0) return "not deep enough for pick 1";
  const covered = cov.through === 1 ? "pick 1" : `picks 1–${cov.through}`;
  return `covers ${covered} of ${rounds} · +${cov.needForNext} for pick ${cov.through + 1}`;
}

// The shortlist with knocked-out players removed (keeps alive + unknown ids).
const shortlistCleaned = (ids) =>
  ids.filter((pid) => { const p = S.playerById[pid]; return !p || !isEliminated(p.team); });

// "Clean" — drop players whose team is out; "Clear" — empty the whole list.
async function cleanShortlist() {
  const cur = myShortlist();
  const next = shortlistCleaned(cur);
  const removed = cur.length - next.length;
  if (!removed) return toast("No knocked-out players on your shortlist.");
  if (await setShortlist(next))
    toast(`Removed ${removed} knocked-out player${removed === 1 ? "" : "s"} from your shortlist.`);
}

function clearShortlist() {
  if (!myShortlist().length) return toast("Your shortlist is already empty.");
  if (confirm("Clear your entire shortlist?")) setShortlist([]);
}

// ☆/★ toggle for a player. Caller wires [data-star] via wireStars().
function starHtml(pid) {
  const on = isShortlisted(pid);
  return `<button data-star="${esc(pid)}" title="${on ? "Remove from shortlist" : "Shortlist"}"
    class="shrink-0 px-1 text-base leading-none ${
      on ? "text-wcgold" : "text-slate-500 hover:text-slate-300"}">${on ? "★" : "☆"}</button>`;
}

// Repaint whichever shortlist views are on screen. Cheap, and it means a star
// shows up in the queue the moment you tap it rather than at the next refetch.
function refreshShortlistViews() {
  const me = myManager();
  if (!me) return;
  if (!afterDrag(refreshShortlistViews)) return;
  if ($("draft-queue") && !$("draft-queue").classList.contains("hidden")) {
    const info = S.league?.current_pick ? pickInfo(S.league.current_pick) : null;
    renderDraftQueue(me, !!info && info.manager?.id === me.id);
  }
  if ($("predraft-shortlist") && !$("predraft-shortlist").classList.contains("hidden"))
    renderPredraftShortlist();
}

/* Star toggling repaints only the button and its own row. Re-rendering the
   whole list on every tap was half of the lurch; the other half is that the
   shortlist panel ABOVE the list gains or loses a row at the same moment, so
   everything below it slides under your thumb. Measuring the tapped row before
   and after and scrolling by the difference pins it in place.

   Delegated from the container, so replacing a button's markup can't unwire
   it. `rerender` is for callers whose panel shows more than the star itself. */
function wireStars(el, rerender) {
  el.onclick = (ev) => {
    const b = ev.target?.closest?.("[data-star]");
    if (!b || !el.contains(b)) return;
    ev.stopPropagation();
    const pid = b.dataset.star;
    const row = b.closest("li") || b.parentElement;
    const before = row ? row.getBoundingClientRect().top : null;
    if (!toggleShortlist(pid)) return;
    if (rerender) rerender();
    else {
      b.outerHTML = starHtml(pid);
      row?.classList.toggle("bg-wcgold/5", isShortlisted(pid));
    }
    refreshShortlistViews();
    if (before != null && row?.isConnected) {
      const after = row.getBoundingClientRect().top;
      if (Math.abs(after - before) > 0.5) window.scrollBy(0, after - before);
    }
  };
}

/* ---------- squad planner (per-manager, synced; only shown to its owner) ---------- */

const myPlanner = () => {
  const p = myManager()?.planner;
  return p && Array.isArray(p.moves) ? p : { moves: [] };
};
const plannerMoves = () => myPlanner().moves;
const moveFor = (outPickId) => plannerMoves().find((m) => m.out === outPickId) || null;

// Best (lowest) rank a player sits at across the viewing manager's planner
// moves: 1 = a first choice, 2+ = a backup. null if not planned anywhere.
function plannerChoiceRank(pid) {
  let best = null;
  for (const m of plannerMoves()) {
    const i = (m.choices || []).indexOf(pid);
    if (i >= 0 && (best === null || i + 1 < best)) best = i + 1;
  }
  return best;
}

// Acquirability of a planned choice for the viewing manager.
function choiceStatus(pid) {
  const me = myManager();
  const p = S.playerById[pid];
  if (p && isEliminated(p.team)) return { kind: "ko" };
  const pick = S.picks.find((pk) => pk.player_id === pid);
  if (!pick) return { kind: "fa" };
  if (pick.manager_id === me?.id) return { kind: "yours" };
  return { kind: "owned", pick, manager: S.managers.find((m) => m.id === pick.manager_id) };
}

async function setPlanner(moves) {
  const me = myManager();
  if (!me) return toast("Join as a manager to use the planner.");
  const next = { moves };
  me.planner = next;                               // optimistic
  queueManagerWrite(me.id, "planner", next, (error) => {
    toast(/planner/.test(error.message)
      ? "Planner needs a schema update — run schema.sql." : error.message);
    scheduleRefetch();                             // fall back to server truth
  });
}

const plannerSetMove = (outPickId, choices) => setPlanner(
  [...plannerMoves().filter((m) => m.out !== outPickId),
   ...(choices && choices.length ? [{ out: outPickId, choices }] : [])]);
function plannerAddChoice(outPickId, pid) {
  const m = moveFor(outPickId);
  const choices = m ? [...m.choices] : [];
  if (!choices.includes(pid)) choices.push(pid);
  return plannerSetMove(outPickId, choices);
}
function plannerRemoveChoice(outPickId, pid) {
  const m = moveFor(outPickId);
  return m ? plannerSetMove(outPickId, m.choices.filter((c) => c !== pid)) : Promise.resolve();
}
function plannerMoveChoice(outPickId, pid, dir) {
  const m = moveFor(outPickId);
  const i = m ? m.choices.indexOf(pid) : -1;
  const j = i + dir;
  if (i < 0 || j < 0 || j >= m.choices.length) return Promise.resolve();
  const choices = [...m.choices];
  [choices[j], choices[i]] = [choices[i], choices[j]];
  return plannerSetMove(outPickId, choices);
}
const plannerPromoteChoice = (outPickId, pid) => plannerMoveChoice(outPickId, pid, -1);

// Reorder a plan's choices to an arbitrary sequence (hold-to-drag).
const plannerSetChoiceOrder = (outPickId, order) => plannerSetMove(outPickId, order);
const plannerRemoveMove = (outPickId) =>
  setPlanner(plannerMoves().filter((m) => m.out !== outPickId));

// "1st choice" / "backup" badge for the redraft pool (viewing manager).
function plannerBadge(pid) {
  const rank = plannerChoiceRank(pid);
  if (!rank) return "";
  return rank === 1
    ? '<span class="rounded bg-wcgold/20 px-1 py-0.5 text-xs text-wcgold">1st choice</span>'
    : '<span class="rounded bg-slate-700 px-1 py-0.5 text-xs text-slate-300">backup</span>';
}

// Kept players (redraft keepers) fill quota slots like any other pick.
// Flex-aware: the per-position quota is a minimum and the flex pool is shared
// across the outfield (see flexLeft). TEAM is a plain fixed count.
function quotaLeft(mgrPicks, group) {
  if (group === "TEAM")
    return (posQuota().TEAM || 0) - mgrPicks.filter((pk) => pk.position === "TEAM").length;
  /* Two different "flex" models, and only one of them is wrong about keepers.
     REDRAFT flex (phase_flex) grants extra fluid slots that are outfield-only
     by design, and its GK quota is whatever the admin set -- leave it alone.
     FLEX FORMATION derives the quota from the FORMATION minimums, which
     describe the starting XI, so capping the squad there meant a league could
     draft exactly one keeper and no cover. Only that case unfixes GK. */
  return flexLeft(posCounts(mgrPicks), group, posQuota(), leagueFlex(),
                  !isFlexFormation());
}

// First picks in a group fill the starter spots (minimums + flex), the rest
// start as subs; the lineup picker can rearrange later.
function slotForNewPick(mgrPicks, group) {
  if (group === "TEAM") return "TEAM";
  const starters = posCounts(mgrPicks.filter(notSub));
  // Flex formation: a new pick starts only if the starting XI can still hold
  // this position without breaking its max (the manager re-picks the XI later).
  if (isFlexFormation()) {
    const f = formationBounds();
    return (starters[group] || 0) < f[group][1]
      && flexLeft(starters, group, starterQuota(), lineupFlex()) > 0 ? group : "SUB_" + group;
  }
  return flexLeft(starters, group, starterQuota(), leagueFlex()) > 0 ? group : "SUB_" + group;
}

/* A drafted squad on the pitch, with an empty shirt for every slot still to
   fill. A list tells you what you have; the gaps tell you what you need, which
   is the only question anyone asks mid-draft. Pure so the counting is testable.
   Returns { byPos, counts, mins, flexLeft, complete }. */
function squadShape(mgrPicks) {
  const counts = posCounts(mgrPicks);
  const mins = posQuota();
  const groups = ["GK", "DEF", "MID", "FWD"];
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const pk of mgrPicks) if (byPos[pk.position]) byPos[pk.position].push(pk);
  let flexLeft = groups.reduce((a, g) => a + (mins[g] || 0), 0) + leagueFlex()
    - groups.reduce((a, g) => a + (counts[g] || 0), 0);
  const need = {};
  for (const g of groups) {
    need[g] = Math.max(0, (mins[g] || 0) - (counts[g] || 0));
    flexLeft -= need[g];
  }
  return { byPos, counts, mins, need, flexLeft: Math.max(0, flexLeft),
    complete: !groups.some((g) => need[g] > 0) && flexLeft <= 0 };
}

function squadPitchHtml(mgrPicks, opts = {}) {
  const s = squadShape(mgrPicks);
  const pitch = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const g of ["GK", "DEF", "MID", "FWD"]) {
    for (const pk of s.byPos[g]) pitch[g].push({
      id: pk.player_id, player_id: pk.player_id, name: pk.player_name,
      team: pk.team, opp: oppShort(pk.team),
    });
    // One dashed shirt per slot you are still obliged to fill.
    for (let i = 0; i < s.need[g]; i++) pitch[g].push({ ghost: true, name: g, id: `${g}-${i}` });
  }
  const chip = (g) => `<span class="rounded px-1.5 py-0.5 text-xs font-semibold pos-${g} ${
    s.need[g] ? "" : "opacity-45"}">${g} ${s.counts[g] || 0}<span class="opacity-70">/${s.mins[g] || 0}</span></span>`;
  return `
    <div class="flex items-center gap-1 flex-wrap mb-1.5">
      ${["GK", "DEF", "MID", "FWD"].map(chip).join("")}
      ${s.flexLeft > 0 ? `<span class="rounded px-1.5 py-0.5 text-xs font-semibold bg-slate-700 text-slate-200">+${s.flexLeft} flex</span>` : ""}
      <span class="ml-auto text-xs ${s.complete ? "text-live" : "text-slate-400"}">${
        s.complete ? "squad complete ✓" : "dashed shirts = still to fill"}</span>
    </div>
    ${pitchHtml(pitch, { crests: true, ...opts })}`;
}

function needsSummary(mgrPicks) {
  const counts = posCounts(mgrPicks);
  const mins = posQuota(), flex = leagueFlex();
  const parts = [];
  const teamLeft = quotaLeft(mgrPicks, "TEAM");
  if (teamLeft > 0) parts.push(`${teamLeft} TEAM`);
  let slots = (mins.GK || 0) + (mins.DEF || 0) + (mins.MID || 0) + (mins.FWD || 0) + flex
    - (counts.GK + counts.DEF + counts.MID + counts.FWD);
  for (const g of ["GK", "DEF", "MID", "FWD"]) {
    const need = Math.max(0, (mins[g] || 0) - (counts[g] || 0));
    if (need > 0) { parts.push(`${need} ${g}`); slots -= need; }
  }
  if (slots > 0) parts.push(`${slots} flex (DEF/MID/FWD)`);
  return parts.length ? "Still needs: " + parts.join(" · ") : "Roster complete";
}

async function makePick(entry, info) {
  const p = S.league.current_pick;
  /* Every early return here abandons a pick that something is waiting on. The
     auto-pick guard is set before the call, so leaving it set means the clock
     sits at 0:00 and nothing ever tries again — release it on the way out. */
  const giveUp = (msg) => { autoPickedFor = 0; if (msg) toast(msg); };
  if (info.pickNumber && info.pickNumber !== p) return giveUp();
  const mgrPicks = managerPicks(info.manager.id);
  if (quotaLeft(mgrPicks, entry.position) <= 0)
    return giveUp(`${info.manager.name} already has the maximum ${entry.position}s.`);
  const slot = slotForNewPick(mgrPicks, entry.position);
  const row = {
    league_id: S.league.id, manager_id: info.manager.id,
    player_id: entry.player_id, player_name: entry.name,
    position: entry.position, team: entry.team,
    // Phase offset keeps redraft pick numbers clear of earlier phases'
    // (kept rows retain theirs and there's a unique index on the pair).
    pick_number: (leaguePhase() - 1) * 1000 + p,
    is_sub: slot.startsWith("SUB_"), slot,
  };
  /* Hold refetches until this pick has landed. Reading the picks table while
     our own insert is still in flight can only return the list without it. */
  const wkey = `picks:${row.pick_number}`;
  _pendingWrites.add(wkey);
  const writeDone = () => writeSettled(wkey);

  const { error } = await S.sb.from("picks").insert(row);
  if (error) {
    // 23505 = someone else's pick landed first; just resync.
    giveUp(error.code === "23505" ? "" : error.message);
    forcePickResync = true;         // their pick number is the real one now
    writeDone();
    scheduleRefetch();
    return;
  }
  const finished = p + 1 > totalPicks();
  const startedAt = new Date().toISOString();

  // The pick is safely in the database, so show it now. Waiting for the league
  // update and the refetch as well meant three round trips before the room
  // moved, which is what made every pick feel sluggish. The refetch below
  // still reconciles, so a lost race corrects itself within a moment.
  S.picks = [...S.picks, { ...row, id: `local-${row.pick_number}`, _at: Date.now() }];
  S.league.current_pick = p + 1;
  S.league.pick_started_at = startedAt;
  if (!finished && !document.querySelector('[data-view="draft"]')?.classList.contains("hidden"))
    renderDraft();

  // Compare-and-swap: only advance the room if it is still on pick `p`.
  const advance = S.sb.from("leagues")
    .update({ current_pick: p + 1, pick_started_at: startedAt })
    .eq("id", S.league.id).eq("current_pick", p)
    .select("current_pick");

  /* The result of that CAS used to be thrown away. If it matched no rows we
     had already lost the race, yet the client went on believing it had moved
     the room — and then held that belief against every refetch. Knowing we
     lost is the only way to hand the position back. */
  const settleAdvance = ({ data, error } = {}) => {
    if (error) return;                       // network: the refetch reconciles
    if (data && data.length) return;         // we did advance the room
    forcePickResync = true;
    scheduleRefetch();
  };

  if (finished) {
    settleAdvance(await advance);
    writeDone();
    // Draft just finished: this client writes the baseline lineup lock.
    await refetchAll();
    await snapshotRosters();
  } else {
    advance.then((r) => { settleAdvance(r); writeDone(); }, writeDone);
  }
  scheduleRefetch();
}

// Resolve a stored player_id (or "team:<Name>") to a draftable entry.
function entryForId(pid) {
  if (String(pid).startsWith("team:")) {
    const t = pid.slice(5);
    return { player_id: pid, name: t, position: "TEAM", team: t };
  }
  const p = S.playerById[pid];
  return p ? { player_id: p.player_id, name: p.name,
               position: p.position, team: p.team } : null;
}

// Auto-pick candidates for a manager who ran out of time: their still-valid
// shortlisted players first, then the whole available pool. "Valid" = fills an
// open quota slot, not already taken, and the team isn't knocked out.
function autoPickCandidates(manager) {
  const mgrPicks = managerPicks(manager.id);
  const openGroups = new Set(GROUPS.filter((g) => quotaLeft(mgrPicks, g) > 0));
  const picked = pickedIdSet();
  const eligible = (e) => !!e && openGroups.has(e.position)
    && !picked.has(e.player_id) && !isEliminated(e.team);
  const shortlist = (manager.shortlist || []).map(entryForId).filter(eligible);
  const pool = [...openGroups].flatMap((g) => availableForGroup(g)).filter(eligible);
  return { shortlist, pool };
}

/* What auto-pick will actually take if the clock runs out. A shortlist is a
   queue, so it resolves in the order you set — that's what the app has always
   promised managers, and what makes showing them the answer possible. Only the
   no-shortlist fallback is random, because there's no stated preference to
   honour. Returns { entry, fromShortlist } or null when nothing fits. */
function autoPickPreview(manager, precomputed) {
  const { shortlist, pool } = precomputed || autoPickCandidates(manager);
  if (shortlist.length) return { entry: shortlist[0], fromShortlist: true };
  if (pool.length) return { entry: pool[Math.floor(Math.random() * pool.length)], fromShortlist: false };
  return null;
}

// Picks until this manager is on the clock; 0 = right now, null = no more turns.
function picksUntilTurn(mgrId) {
  const cur = S.league?.current_pick || 0, total = totalPicks();
  for (let p = cur; p <= total; p++) if (pickInfo(p).manager?.id === mgrId) return p - cur;
  return null;
}

/* ---------- bot managers (practice drafts) ----------
   Automated opponents so a league can rehearse a full draft — and test their
   shortlists — before the real one. Bots never sign in: whichever human client
   is in the room makes their pick. That write is guarded on current_pick, so
   two clients racing is harmless (the loser's update simply matches no row). */
const BOT_NAMES = ["Ada", "Bruno", "Cleo", "Dax", "Ines", "Jonas", "Kira",
  "Milo", "Nadia", "Otto", "Pia", "Rafa", "Suri", "Tomas"];

// Prefer the best available scorer; with no stats yet (pre-season) fall back to
// the pool with some spread, so bots don't all draft the same player.
function botChoice(manager) {
  const { shortlist, pool } = autoPickCandidates(manager);
  const cands = pool.length ? pool : shortlist;
  if (!cands.length) return null;
  const scored = cands.map((e) => ({ e, v: playerPoints(e.player_id, e.position) || 0 }));
  if (scored.some((x) => x.v > 0)) {
    scored.sort((a, b) => b.v - a.v);
    return scored[Math.floor(Math.random() * Math.min(5, scored.length))].e;   // top-5 jitter
  }
  /* No stats to rank by (the usual case in a fresh draft). Pick a POSITION
     first, then a player in it.

     Taking the first 12 of the flat list looked random and was not: the pool is
     built group by group, so those 12 were all the same position. Bots drafted
     nothing but defenders and could never field a legal XI. Groups still needing
     players are weighted by how many they need, so a squad fills out sensibly
     rather than uniformly. */
  const byGroup = {};
  for (const e of cands) (byGroup[e.position] ||= []).push(e);
  const groups = Object.keys(byGroup);
  if (!groups.length) return null;
  const need = (g) => Math.max(1, quotaLeft(managerPicks(manager.id), g));
  let roll = Math.random() * groups.reduce((a, g) => a + need(g), 0);
  let group = groups[groups.length - 1];
  for (const g of groups) { roll -= need(g); if (roll <= 0) { group = g; break; } }
  const list = byGroup[group];
  return list[Math.floor(Math.random() * list.length)];
}

// A short, varied "thinking" pause so a bot draft feels like a draft rather
// than a list appearing. Derived from the pick number so every client agrees.
const botThinkMs = (pickNo) => 4200 + (pickNo * 37) % 1600;   // ~4.2–5.8s

let botPickedFor = 0;
async function botPick(info) {
  let entry = botChoice(info.manager);
  if (!entry) {
    // Rather than stall the room, take any free player so the draft moves on.
    const picked = new Set(S.picks.map((pk) => pk.player_id));
    entry = S.players.find((pl) => !picked.has(pl.player_id) && !isEliminated(pl.team));
    if (!entry) { toast("No players left to draft."); return; }
  }
  await makePick(entry, info);
}

async function autoPick(info) {
  const choice = autoPickPreview(info.manager);
  if (!choice) { toast("No available players fit the open quota."); return; }
  toast(`Time's up — auto-picked ${choice.entry.name}${
    choice.fromShortlist ? " (top of shortlist)" : ""} for ${info.manager.name}.`);
  await makePick(choice.entry, info);
}

// Runs every 500ms. The on-the-clock manager's client auto-picks at 0;
// the admin's client is a fallback 4s later in case that phone is gone.
function tickTimer() {
  const L = S.league;
  const clock = $("draft-clock");
  if (!L || !L.current_pick || L.current_pick > totalPicks()) { clock.textContent = "--"; return; }
  if (!L.pick_duration_seconds && !pickInfo(L.current_pick).manager?.is_bot) {
    clock.textContent = "∞";   // 0 = no time limit (never auto-picks)
    const m0 = $("draft-mini-clock"); if (m0) m0.textContent = "∞";
    clock.classList.remove("text-red-400"); clock.classList.add("text-wcgold");
    return;
  }
  // A bot on the clock picks after a brief think, regardless of the clock —
  // waiting out a 60s timer for every bot would make practice drafts unusable.
  const onClock = pickInfo(L.current_pick);
  if (onClock.manager?.is_bot) {
    clock.textContent = "…";
    const waited = Date.now() - Date.parse(L.pick_started_at);
    // The guard stops two clients racing, but it was also a deadlock: it's set
    // before the write, so a write that doesn't land (a lost race, a bot with
    // nothing eligible) left the draft stuck on that pick forever. Give up on
    // the guard after a grace period so the pick is retried.
    if (botPickedFor === L.current_pick && waited > botThinkMs(L.current_pick) + 12000)
      botPickedFor = 0;
    if (botPickedFor !== L.current_pick && waited > botThinkMs(L.current_pick)) {
      botPickedFor = L.current_pick;
      botPick(onClock).catch(() => { botPickedFor = 0; });
    }
    return;
  }
  const deadline = Date.parse(L.pick_started_at) + L.pick_duration_seconds * 1000;
  const remain = Math.ceil((deadline - Date.now()) / 1000);
  const shown = Math.max(0, remain);
  const face = Math.floor(shown / 60) + ":" + String(shown % 60).padStart(2, "0");
  clock.textContent = face;
  const mini = $("draft-mini-clock");
  if (mini) {
    mini.textContent = face;
    mini.classList.toggle("text-red-400", remain <= 10);
    mini.classList.toggle("text-wcgold", remain > 10);
  }
  clock.classList.toggle("text-red-400", remain <= 10);
  clock.classList.toggle("text-wcgold", remain > 10);
  /* The same watchdog the bot path has, and for the same reason: the guard is
     set BEFORE the write, so an auto-pick that doesn't land — a lost race, a
     stale pick number, a quota that filled underneath it — left the room
     frozen on an expired clock with nothing to retry it. This is the state
     that reads as "the draft got stuck". */
  if (autoPickStale(autoPickedFor, L.current_pick, remain)) autoPickedFor = 0;
  if (remain > 0 || autoPickedFor === L.current_pick) return;
  const info = pickInfo(L.current_pick);
  const mine = info.manager.id === myManager()?.id;
  if (mine || (isAdmin() && remain <= -4)) {
    autoPickedFor = L.current_pick;
    autoPick(info).catch((e) => { autoPickedFor = 0; toast(e.message); });
  }
}

let _poolSig = null;
function renderPool(force) {
  // Cheap signature of everything the pool's contents depend on.
  const sig = [S.picks.length, S.league.current_pick, S.poolFilter, S.poolSearch,
    S.poolSort, !!S.poolShortlistOnly, !!S.poolPlannerOnly,
    document.getElementById("pool-team")?.value || "",
    myShortlist().join(",")].join("|");
  if (!force && sig === _poolSig) return;
  _poolSig = sig;
  const info = pickInfo(S.league.current_pick);
  const me = myManager();
  const myTurn = !!me && info.manager.id === me.id;
  const onClockPicks = managerPicks(info.manager.id);

  const groups = GROUPS.filter((g) => posQuota()[g] > 0);
  const chips = ["ALL", ...groups];
  $("pool-chips").innerHTML = chips.map((c) =>
    `<button data-chip="${c}" class="shrink-0 rounded-full px-3 py-1 border ${
      S.poolFilter === c ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400"
    }">${c}${c !== "ALL" && myTurn ? ` ${quotaLeft(onClockPicks, c)}` : ""}</button>`).join("")
    + `<button data-slfilter class="shrink-0 rounded-full px-3 py-1 border ${
      S.poolShortlistOnly ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 text-slate-400"
    }">★ Queue${myShortlist().length ? ` ${myShortlist().length}` : ""}</button>`
    + `<button data-plfilter class="shrink-0 rounded-full px-3 py-1 border ${
      S.poolPlannerOnly ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400"
    }">🗺 Plan</button>`;
  $("pool-chips").querySelectorAll("[data-chip]").forEach((b) =>
    b.onclick = () => { S.poolFilter = b.dataset.chip; renderPool(true); });
  $("pool-chips").querySelector("[data-slfilter]").onclick = () => {
    S.poolShortlistOnly = !S.poolShortlistOnly; renderPool(true);
  };
  $("pool-chips").querySelector("[data-plfilter]").onclick = () => {
    S.poolPlannerOnly = !S.poolPlannerOnly; renderPool(true);
  };

  // Team dropdown, rebuilt each render (preserving the selection) so knocked-out
  // countries drop out of the list as the tournament narrows — their players
  // aren't draftable anyway.
  const teamSel = $("pool-team");
  const curTeam = teamSel.value;
  const teamOpts = S.teams.filter((t) => !isEliminated(t));
  teamSel.innerHTML = '<option value="">All teams</option>' + teamOpts.map((t) =>
    `<option ${t === curTeam ? "selected" : ""}>${esc(t)}</option>`).join("");

  // Sort-by-stat dropdown (same options as the Stats tab). Static, so build once.
  // The admin can switch it off (leagues.draft_stat_sort) for a blind draft.
  const sortOn = S.league.draft_stat_sort !== false;
  if (!sortOn) S.poolSort = "";
  $("pool-sort").classList.toggle("hidden", !sortOn);
  if (!$("pool-sort").options.length) {
    $("pool-sort").innerHTML = '<option value="">Sort: default</option>' +
      STAT_SORTS.map(([k, lbl]) => `<option value="${k}">Sort: ${lbl}</option>`).join("");
  }
  $("pool-sort").value = S.poolSort;

  // Owner name per picked player, so taken players show who grabbed them.
  const mgrName = Object.fromEntries(S.managers.map((m) => [m.id, m.name]));
  const ownerName = {};
  for (const pk of S.picks) ownerName[pk.player_id] = mgrName[pk.manager_id];

  let entries = S.poolFilter === "ALL"
    ? groups.flatMap((g) => poolEntries(g))
    : poolEntries(S.poolFilter);
  const teamF = $("pool-team").value;
  if (teamF) entries = entries.filter((e) => e.team === teamF);
  const q = S.poolSearch.trim().toLowerCase();
  if (q) entries = entries.filter((e) =>
    e.name.toLowerCase().includes(q) || e.team.toLowerCase().includes(q));
  if (S.poolShortlistOnly) entries = entries.filter((e) => isShortlisted(e.player_id));
  if (S.poolPlannerOnly) entries = entries.filter((e) => plannerChoiceRank(e.player_id));
  if (S.poolSort) {
    const valOf = (e) => S.poolSort === "points"
      ? entryPoints(e.player_id, e.position, e.team)     // TEAM = stage bonus
      : playerStatTotal(e.player_id, S.poolSort);
    entries = entries.slice().sort((a, b) =>
      valOf(b) - valOf(a) || a.name.localeCompare(b.name));
  }
  const shown = entries.slice(0, 80);

  $("pool-list").innerHTML = shown.map((e) => {
    const owner = ownerName[e.player_id];
    const ko = isEliminated(e.team);
    const canPick = myTurn && !owner && !ko && quotaLeft(onClockPicks, e.position) > 0;
    const tappable = !String(e.player_id).startsWith("team:");  // TEAM has no detail card
    const inner = `
      ${avatarHtml(e.player_id, e.team)}
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1 min-w-0">
          <span class="truncate font-medium">${esc(e.name)}</span>
          <span class="shrink-0 flex items-center gap-1">${availBadges(e.player_id)}${plannerBadge(e.player_id)}${
            owner ? ownerChipHtml(e.player_id) : ""}</span>
        </div>
        <!-- The club stays even when you've filtered to one. Dropping it made
             the row unable to identify its own player, and when no fixture was
             known the line collapsed to a blank. -->
        <div class="truncate text-xs text-slate-400">${teamFixLine(e.team)}</div>
      </div>`;
    return `<li class="flex items-center py-2 gap-1.5 ${owner || ko ? "opacity-60" : ""}">
      ${starHtml(e.player_id)}
      ${tappable
        ? `<button data-pooldetail="${esc(e.player_id)}" class="flex-1 min-w-0 flex items-center gap-1.5 text-left">${inner}</button>`
        : `<div class="flex-1 min-w-0 flex items-center gap-1.5">${inner}</div>`}
      <div class="flex items-center gap-1.5 shrink-0">
        ${(() => { const v = entryPoints(e.player_id, e.position, e.team);
                   return v ? `<span class="text-xs font-mono text-slate-400">${v}</span>` : ""; })()}
        <span class="pos-${e.position} rounded px-1.5 py-0.5 text-xs font-semibold">${e.position}</span>
        ${canPick ? `<button data-pick="${esc(e.player_id)}" class="pick-btn bg-wcred hover:bg-wcred-hov rounded-lg px-2.5 text-xs font-bold">Pick</button>` : ""}
      </div>
    </li>`;
  }).join("") || `<li class="py-4 text-sm text-slate-400">${
    S.poolShortlistOnly ? "No shortlisted players match — star players to add them."
    : S.poolPlannerOnly ? "No squad-planner players match — add some in Trades → Squad planner."
    : "No players match."}</li>`;
  if (entries.length > shown.length) {
    $("pool-list").insertAdjacentHTML("beforeend",
      `<li class="py-2 text-xs text-slate-400">${entries.length - shown.length} more — search or filter to narrow.</li>`);
  }
  $("pool-list").querySelectorAll(".pick-btn").forEach((btn) => btn.onclick = () => {
    const entry = entries.find((e) => e.player_id === btn.dataset.pick);
    if (!entry) return;
    const slot = slotForNewPick(onClockPicks, entry.position);
    if (confirm(`Pick ${entry.name} (${entry.position}, ${entry.team})? They'll slot in as ${slot}.`))
      makePick(entry, { ...info, pickNumber: S.league.current_pick }).catch((er) => toast(er.message));
  });
  $("pool-list").querySelectorAll("[data-pooldetail]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.pooldetail));
  wireStars($("pool-list"), renderPool);
}

const _rosterSig = {};
function renderRosters(containerId, force) {
  const sig = [S.picks.length, S.league?.current_pick, tradingOpen(),
    S.managers.length, S.picks.map((p) => p.is_sub ? 1 : 0).join("")].join("|");
  if (!force && _rosterSig[containerId] === sig) return;
  _rosterSig[containerId] = sig;
  const open = new Set([...document.querySelectorAll(`#${containerId} details[open]`)]
    .map((d) => d.dataset.mgr));
  const me = myManager();
  // Free-agent swaps: only on your own roster, post-draft, window open.
  const canSwap = containerId === "board-rosters" && tradingOpen();
  // Show starters first (GK→DEF→MID→FWD→TEAM), then subs.
  const byMgr = {};
  for (const pk of S.picks) (byMgr[pk.manager_id] ||= []).push(pk);
  for (const k in byMgr) byMgr[k].sort((a, b) =>
    (SLOT_RANK[a.slot] ?? 9) - (SLOT_RANK[b.slot] ?? 9) || a.pick_number - b.pick_number);
  $(containerId).innerHTML = draftOrderManagers().map((m) => `
    <details data-mgr="${m.id}" class="rounded-xl border border-slate-700 bg-slate-900"
             ${open.has(m.id) || (!open.size && m.id === me?.id) ? "open" : ""}>
      <summary class="px-4 py-3 font-semibold cursor-pointer select-none flex items-center gap-2">
        <span class="shrink-0 inline-flex items-center justify-center rounded-md w-6 h-6 text-[13px]"
              style="background:${managerColor(m)}22;border:1px solid ${managerColor(m)}88">${managerMark(m)}</span>
        <span>${esc(m.name)}${
        m.id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""
      }${m.draft_position ? ` <span class="text-xs text-slate-400">· draft pos ${m.draft_position}</span>` : ""}</span></summary>
      ${containerId === "board-rosters" && m.id === me?.id
        ? `<div class="px-4 pb-2 flex gap-2">
             <button id="lineup-open" class="flex-1 bg-slate-800 border border-wcgold/60 text-wcgold rounded-lg py-2 text-sm font-semibold">Pick my team (starters &amp; subs)</button>
             <button data-editcrest="1" class="shrink-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm" title="Edit your crest and colour">🎨</button>
           </div>`
        : ""}
      ${containerId === "draft-rosters" ? `<div class="px-4 pb-2">
        ${squadPitchHtml((byMgr[m.id] || []).filter((pk) => pk.slot !== "TEAM"))}
      </div>` : ""}
      <div class="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
        ${(() => {
          const list = byMgr[m.id] || [];
          if (!list.length) return '<div class="text-slate-400 text-xs sm:col-span-2">No picks yet — the board is wide open.</div>';
          let seenSub = false;
          return list.map((pk) => {
            // One "Substitutes" divider beats repeating SUB_ on every row —
            // on a phone that prefix was eating the player's name.
            let head = "";
            if (pk.is_sub && !seenSub) {
              seenSub = true;
              head = '<div class="eyebrow pt-1.5 sm:col-span-2">Substitutes</div>';
            }
            const swap = canSwap && m.id === me?.id && pk.slot !== "TEAM"
              ? `<button data-swap="${pk.id}" class="tap shrink-0 text-xs underline text-wcgold">swap</button>` : "";
            return head + `<div class="rounded-lg bg-slate-800/60 px-2 py-1.5 flex items-center gap-2 row-hover${
              pk.is_sub ? " opacity-80" : ""}">
              <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold pos-${pk.position}">${pk.position}</span>
              ${avatarHtml(pk.player_id, pk.team, "w-6 h-6")}
              <span class="min-w-0 flex-1 leading-tight">
                <span class="block truncate">${esc(pk.player_name)} ${availBadges(pk.player_id)}</span>
                <span class="block truncate text-xs text-slate-400">${esc(pk.team || "")}</span>
              </span>
              <span class="shrink-0 font-mono text-slate-300">${entryPoints(pk.player_id, pk.position, pk.team)}p</span>${swap}
            </div>`;
          }).join("");
        })()}
      </div>
    </details>`).join("");
  $(containerId).querySelectorAll("[data-swap]").forEach((b) => b.onclick = () =>
    openSwap(S.picks.find((pk) => pk.id === b.dataset.swap)));
  const lineupBtn = $(containerId).querySelector("#lineup-open");
  if (lineupBtn) lineupBtn.onclick = openLineup;
  $(containerId).querySelectorAll("[data-editcrest]").forEach((b) => b.onclick = openCrestPicker);
}

/* Your shortlist, pinned inside the draft room. Managers fear the clock most
   when they can't see what happens if it expires — so lead with exactly that,
   then show the queue behind it with anything already taken struck through. */
/* A pick landing should be felt, not sat through: a small card fades in under
   the header for ~1.5s and never takes a click. Driven from renderDraft, which
   already re-runs on every realtime update. */
let _lastPickSeen = null, _pickJustLanded = false;
function flashPick(pk) {
  document.querySelector(".pick-flash")?.remove();
  const m = S.managers.find((x) => x.id === pk.manager_id);
  const el = document.createElement("div");
  el.className = "pick-flash rounded-xl border border-wcgold/70 bg-slate-900/95 backdrop-blur "
    + "px-3 py-2 shadow-xl flex items-center gap-2 max-w-[92vw]";
  el.innerHTML = `${avatarHtml(pk.player_id, pk.team, "w-9 h-9")}
    <div class="min-w-0">
      <div class="eyebrow">${m?.id === myManager()?.id ? "You picked" : esc(m?.name ?? "?") + " picked"}</div>
      <div class="font-bold truncate">${esc(pk.player_name)}</div>
    </div>
    <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold pos-${pk.position}">${pk.position}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// Announce only genuinely new picks — not the backlog on first render, and not
// your own pick (you just made it, you know).
function announceNewPicks() {
  _pickJustLanded = false;
  const last = S.picks.reduce((a, b) => (a && a.pick_number > b.pick_number ? a : b), null);
  /* An empty board still seeds the marker. Returning without seeding it left
     the marker null until the first pick LANDED, and the backlog guard below
     then read that pick as the backlog and swallowed it — so the one pick that
     never announced was the draft's opening one, which is exactly the moment
     someone is watching for it. */
  if (!last) { if (_lastPickSeen === null) _lastPickSeen = 0; return; }
  if (_lastPickSeen === null) { _lastPickSeen = last.pick_number; return; }
  if (last.pick_number <= _lastPickSeen) return;
  _lastPickSeen = last.pick_number;
  _pickJustLanded = true;
  flashPick(last);
}

/* The shortlist, shown while you build it. Same priority rules as the in-draft
   queue — auto-pick takes the top available name — so it's ordered and
   reorderable here too. */
function renderPredraftShortlist() {
  const box = $("predraft-shortlist");
  const me = myManager();
  if (!box || !me) return;
  // Never rebuild these rows while one of them is in the air.
  if (!afterDrag(renderPredraftShortlist)) return;
  const ids = me.shortlist || [];
  const rows = ids.map((pid, i) => {
    const e = entryForId(pid);
    if (!e) return "";
    return `<li data-slrow="${esc(pid)}" class="flex items-center gap-1.5 py-1.5 rounded">
      <span class="w-5 shrink-0 text-xs font-mono ${
        i === 0 ? "text-wcgold font-bold" : "text-slate-400"}">${i + 1}</span>
      ${avatarHtml(pid, e.team, "w-7 h-7")}
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm">${esc(e.name)}</span>
        <span class="block truncate text-xs text-slate-400">${esc(e.team || "")}</span>
      </span>
      <span class="shrink-0 text-xs pos-${e.position} rounded px-1.5 py-0.5">${e.position}</span>
      ${ids.length > 1 ? `<span class="nudge-col shrink-0 leading-none">
        <button data-slup="${esc(pid)}" class="nudge text-slate-400 ${i === 0 ? "opacity-30" : ""}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
        <button data-sldn="${esc(pid)}" class="nudge text-slate-400 ${i === ids.length - 1 ? "opacity-30" : ""}" ${i === ids.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
      </span>` : ""}
      <button data-slrm="${esc(pid)}" class="tap shrink-0 text-slate-400 hover:text-wcred" aria-label="Remove">✕</button>
    </li>`;
  }).join("");
  // What the board actually covers, by position. A shortlist of eleven
  // strikers is a bad board and the count alone never tells you that.
  const tally = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const pid of ids) {
    const e = entryForId(pid);
    if (e && tally[e.position] != null) tally[e.position]++;
  }
  const quota = posQuota();
  const pips = GROUPS.slice(0, 4).map((g) => {
    const short = (quota[g] || 0) > 0 && tally[g] < quota[g];
    return `<span class="rounded px-1.5 py-0.5 text-xs font-semibold pos-${g} ${
      short ? "opacity-50" : ""}" title="${tally[g]} starred${
      quota[g] ? ` · you need ${quota[g]}` : ""}">${g} ${tally[g]}</span>`;
  }).join("");

  box.innerHTML = `<div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold">★ Your shortlist</span>
      <span class="text-xs text-slate-400">${ids.length} player${ids.length === 1 ? "" : "s"}</span>
    </div>
    ${ids.length ? `<div class="flex items-center gap-1 flex-wrap">${pips}</div>` : ""}
    ${rows ? `<ul class="divide-y divide-slate-800">${rows}</ul>
      <p class="text-xs text-slate-400 pt-1">#1 is who auto-pick takes if your clock runs out.${
        ids.length > 1 ? " Hold a row to drag it anywhere in the list." : ""}</p>`
           : '<p class="text-xs text-slate-400">Nothing yet — tap the ☆ beside a player below.</p>'}`;
  // Keep the banner's coverage meter honest without re-rendering the board.
  const per = picksPerManager();
  const cov = shortlistCoverage(ids.length, S.managers.length, per, me.draft_position);
  const haveEl = $("predraft-have"), barEl = $("predraft-bar"), hintEl = $("predraft-hint");
  if (haveEl) haveEl.textContent = `${ids.length} starred`;
  if (hintEl) hintEl.textContent = coverageHint(cov, per);
  if (barEl) {
    barEl.style.width = Math.round((cov.through / Math.max(1, per)) * 100) + "%";
    barEl.className = "block h-full rounded-full " + (cov.through >= per ? "bg-live" : "bg-wcgold");
  }

  const slide = (pid, dir) => {
    moveShortlist(pid, dir);
    animateReorder("predraft-shortlist", "data-slrow", renderPredraftShortlist, pid);
  };
  box.querySelectorAll("[data-slup]").forEach((b) => b.onclick = () => slide(b.dataset.slup, -1));
  box.querySelectorAll("[data-sldn]").forEach((b) => b.onclick = () => slide(b.dataset.sldn, 1));
  makeReorderable(box, "data-slrow", (order, moved) => {
    setShortlist(applyVisibleOrder(myShortlist(), order));
    animateReorder("predraft-shortlist", "data-slrow", renderPredraftShortlist, moved);
  });
  box.querySelectorAll("[data-slrm]").forEach((b) =>
    b.onclick = () => { toggleShortlist(b.dataset.slrm); renderPredraftShortlist(); });
}

/* What the queue should show, as data. Pure so the rules can be tested:
   - a shortlisted player still available and eligible → show, in priority order
   - taken since your last pick → show once, greyed, so you notice they went
   - taken before that → drop; you have already seen it
   - no longer fits your open slots → hide, but say how many
     shortlist   : ordered player ids
     takenBy     : { playerId: { pick_number, manager_id } }
     myLastPickNo: your most recent pick number (0 if none yet)
     eligibleIds : Set of ids that still fit an open position          */
function queuePlan(shortlist, takenBy, myLastPickNo, eligibleIds) {
  const rows = [];
  let hiddenNoFit = 0;
  (shortlist || []).forEach((pid, idx) => {
    const pk = takenBy[pid];
    if (pk) {
      if ((pk.pick_number || 0) > (myLastPickNo || 0))
        rows.push({ pid, idx, gone: true, byManagerId: pk.manager_id });
      return;
    }
    if (!eligibleIds.has(pid)) { hiddenNoFit++; return; }
    rows.push({ pid, idx, gone: false });
  });
  return { rows, hiddenNoFit, available: rows.filter((r) => !r.gone).length };
}

/* Press and hold a row to pick it up, then drag it as far as you like.

   The ▲▼ buttons are fine for a nudge and miserable for moving a name from
   14th to 2nd, which is exactly the move you want most often. They stay — they
   are the keyboard-and-screen-reader path, and the precise one — but a hold
   now lifts the row out of the list and the rest of it reflows live around it.

   Holding still is the signal. A press that moves before the timer fires is a
   scroll, so it cancels; once the row IS lifted the page is frozen, because a
   drag and a scroll are the same finger travelling the same direction and the
   browser will happily do both at once otherwise.

     box     : the container element (persists across its own re-renders)
     rowAttr : attribute marking a draggable row, e.g. "data-slrow"
     commit  : (newVisibleIds, movedId) => void — persist and re-render      */
const HOLD_MS = 320, SLOP_PX = 8;

/* True while a row is lifted anywhere in the app.

   This is load-bearing, not bookkeeping. A re-render that replaces the row
   under your finger detaches it, so its pointerup never reaches the listener,
   so the drag never ends and the page stays scroll-locked — which is what a
   frozen app looks like from the outside. Renders are deferred while it's set
   (see route), and a release anywhere on the window ends the drag regardless
   of what happened to the row. */
let _dragging = false;
let _endDrag = null;          // set by whichever list currently owns the drag
const dragActive = () => _dragging;

// Last-resort releases: letting go anywhere, leaving the tab, or simply
// holding for longer than any real gesture all end the drag. A frozen page is
// so much worse than a dropped reorder that this is worth being blunt about.
const DRAG_MAX_MS = 12000;
let _dragWatchdog = null;
function armDragWatchdog() {
  clearTimeout(_dragWatchdog);
  _dragWatchdog = setTimeout(() => {
    if (!_dragging) return;
    _endDrag?.();
    // If whichever list owned it is gone, unfreeze the page by hand.
    _dragging = false; _endDrag = null;
    document.documentElement?.classList.remove("drag-lock");
    document.querySelectorAll?.(".drag-active").forEach?.(
      (el) => el.classList.remove("drag-active"));
    flushDeferredRender();
  }, DRAG_MAX_MS);
}

if (typeof window !== "undefined" && window.addEventListener) {
  const bail = () => _endDrag?.();
  window.addEventListener("pointerup", bail, true);
  window.addEventListener("pointercancel", bail, true);
  window.addEventListener("blur", bail);
  document.addEventListener?.("visibilitychange", () => {
    if (document.hidden) bail();
  });
}

/* Renders that arrive mid-interaction are held until it ends.

   A drag is the obvious case. The subtler one is a reorder: it writes, the
   write echoes back over realtime, and the refetch repaints the whole page —
   which lands, reliably, about half a second later, i.e. right in the middle
   of the FLIP animation or the next tap of a burst. A page-wide repaint
   rebuilds the rows with no transform, so the row being animated teleports to
   its final position. That is the jump you feel on successive moves.

   So an interaction window covers the beat after each reorder too. Returns
   true if the caller may proceed now, false if it has been deferred — the
   guard reads `if (!afterDrag(thisFn)) return;`. It must NOT invoke `fn` on
   the idle path: callers pass themselves, and doing so recurses. */
const INTERACT_MS = 700;
let _deferredRender = null, _interactUntil = 0, _flushTimer = null;

const interacting = () => Date.now() < _interactUntil;

// Called by every reorder: hold page-wide repaints for a beat afterwards.
function markInteracting(ms = INTERACT_MS) {
  _interactUntil = Date.now() + ms;
  scheduleDeferredFlush();
}

function scheduleDeferredFlush() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    if (_dragging) return;              // finish() will flush when it ends
    flushDeferredRender();
  }, Math.max(0, _interactUntil - Date.now()) + 60);
}

/* True only while a reorder is repainting its own list. That repaint IS the
   gesture's response — deferring it made a nudge take the best part of a
   second: the row flashed at once (the flash works on the old DOM) and then sat
   still until the window closed. The window exists to hold back page-wide
   refetch repaints, not this one. */
let _reorderRepaint = false;

function afterDrag(fn) {
  if (_reorderRepaint) return true;
  if (!_dragging && !interacting()) return true;
  _deferredRender = fn;
  if (!_dragging) scheduleDeferredFlush();
  return false;
}
function flushDeferredRender() {
  const fn = _deferredRender;
  _deferredRender = null;
  if (fn) fn();
}

function makeReorderable(box, rowAttr, commit) {
  if (!box || box._reorderAttr === rowAttr) return;   // already wired
  box._reorderAttr = rowAttr;

  let timer = null, drag = null, startY = 0, pressed = null, pid = null;

  const rowsOf = () => [...box.querySelectorAll(`[${rowAttr}]`)];
  const cancelPress = () => { clearTimeout(timer); timer = null; pressed = null; };

  const lift = () => {
    const rows = rowsOf();
    const i0 = rows.indexOf(pressed);
    if (i0 < 0 || rows.length < 2) return cancelPress();
    const rects = rows.map((el) => el.getBoundingClientRect());
    // The distance a row travels when one row leaves its slot: measured from
    // the neighbours rather than assumed, since these lists have different gaps.
    const slot = i0 + 1 < rects.length ? rects[i0 + 1].top - rects[i0].top
               : rects[i0].top - rects[i0 - 1].top;
    drag = { rows, rects, i0, slot, ins: i0,
      ids: rows.map((el) => el.getAttribute(rowAttr)) };
    box.classList.add("drag-active");
    pressed.classList.add("drag-lift");
    rows.forEach((el, i) => { if (i !== i0) el.classList.add("drag-shift"); });
    navigator.vibrate?.(12);
    document.documentElement.classList.add("drag-lock");
    _dragging = true;
    _endDrag = finish;
    armDragWatchdog();
  };

  const onMove = (ev) => {
    const y = ev.clientY ?? ev.touches?.[0]?.clientY ?? 0;
    if (!drag) {
      if (timer && Math.abs(y - startY) > SLOP_PX) cancelPress();   // a scroll
      return;
    }
    ev.preventDefault?.();
    const dy = y - startY;
    const { rows, rects, i0, slot } = drag;
    pressed.style.transform = `translateY(${dy}px) scale(1.03)`;
    const centre = rects[i0].top + rects[i0].height / 2 + dy;
    // Where the held row would land: the first remaining row whose (post-gap)
    // midpoint sits below the held row's centre.
    let ins = rows.length - 1;
    let seen = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === i0) continue;
      const mid = rects[i].top + rects[i].height / 2 - (i > i0 ? slot : 0);
      if (centre < mid) { ins = seen; break; }
      seen++;
      ins = seen;
    }
    drag.ins = ins;
    seen = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === i0) continue;
      const shift = seen < ins && i > i0 ? -slot : seen >= ins && i < i0 ? slot : 0;
      rows[i].style.transform = shift ? `translateY(${shift}px)` : "";
      seen++;
    }
  };

  const finish = () => {
    clearTimeout(timer); timer = null;
    document.documentElement.classList.remove("drag-lock");
    if (!drag) { pressed = null; return; }
    const { rows, ids, i0, ins } = drag;
    const moved = ids[i0];
    const rest = ids.filter((_, i) => i !== i0);
    rest.splice(ins, 0, moved);
    box.classList.remove("drag-active");
    rows.forEach((el) => {
      el.classList.remove("drag-lift", "drag-shift");
      el.style.transform = "";
    });
    drag = null; pressed = null;
    _dragging = false; _endDrag = null;
    clearTimeout(_dragWatchdog);
    const changed = rest.some((id, i) => id !== ids[i]);
    if (changed) commit(rest, moved);
    // Anything that wanted to repaint while the row was in the air happens now.
    flushDeferredRender();
  };

  box.addEventListener("pointerdown", (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    // Buttons inside a row keep their own behaviour — a hold on ▲ is still ▲.
    if (ev.target?.closest?.("button, a, input, select")) return;
    const row = ev.target?.closest?.(`[${rowAttr}]`);
    if (!row || !box.contains(row)) return;
    pressed = row; startY = ev.clientY; pid = ev.pointerId;
    clearTimeout(timer);
    timer = setTimeout(lift, HOLD_MS);
  });
  box.addEventListener("pointermove", onMove);
  // Non-passive: while a row is lifted this is what stops the page scrolling
  // out from under it on touch.
  box.addEventListener("touchmove", (ev) => { if (drag) ev.preventDefault(); },
    { passive: false });
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);
  box.addEventListener("lostpointercapture", finish);
}

/* Reorder a list and animate it. The rows are rebuilt by `rerender`, so their
   old positions are captured first and handed to flipRows, which puts each one
   back where it was and lets the compositor close the gap. Without this a
   reorder is a jump-cut, and a fast double-tap reads as a glitch rather than
   two moves. */
function animateReorder(boxId, rowAttr, rerender, movedId) {
  markInteracting();          // keep a refetch from repainting over the glide
  const box = document.getElementById(boxId);
  if (!box) { rerender(); markQueueMoved(movedId); return; }
  const was = new Map();
  box.querySelectorAll(`[${rowAttr}]`).forEach((r) =>
    was.set(r.getAttribute(rowAttr), r.getBoundingClientRect().top));
  _reorderRepaint = true;
  try { rerender(); } finally { _reorderRepaint = false; }
  const after = document.getElementById(boxId);
  if (after) flipRows(after, was, rowAttr);
  markQueueMoved(movedId);
}

// After a reorder the list is rebuilt, so flag the row that moved — otherwise
// the change is something you have to infer by re-reading the order.
/* Every reorderable list in the app, so a new one can't quietly miss the cue.
   The waiver queue and the planner were doing exactly that: they moved, but
   nothing flashed, because this only knew about the other three. */
const ROW_ATTRS = ["data-qrow", "data-slrow", "data-brow", "data-clrow", "data-plrow"];

function markQueueMoved(pid) {
  let row = null;
  for (const a of ROW_ATTRS) {
    row = document.querySelector(`[${a}="${CSS.escape(pid)}"]`);
    if (row) break;
  }
  if (!row) return;
  // Colour only: the rows are already being slid into place by flipRows, and a
  // keyframe animation outranks the inline transform FLIP relies on.
  row.classList.remove("row-flash");
  void row.offsetWidth;
  row.classList.add("row-flash");
}

function renderDraftQueue(me, myTurn) {
  const box = $("draft-queue");
  if (!box) return;
  if (!afterDrag(() => renderDraftQueue(me, myTurn))) return;
  if (!me || me.eliminated) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");

  const ids = me.shortlist || [];
  const takenBy = {};
  for (const pk of S.picks) takenBy[pk.player_id] = pk;
  // Anything taken since your last pick is news; anything taken before it you
  // have already seen, so it drops off rather than growing the list forever.
  const myLast = S.picks.filter((pk) => pk.manager_id === me.id)
    .reduce((a, pk) => Math.max(a, pk.pick_number || 0), 0);
  const cands = autoPickCandidates(me);
  const eligibleIds = new Set(cands.shortlist.map((e) => e.player_id));

  const { rows, hiddenNoFit } = queuePlan(ids, takenBy, myLast, eligibleIds);

  const choice = autoPickPreview(me, cands);
  // Say WHY auto-pick would go off-list: "empty" was wrong and confusing when
  // the list was full of players who no longer fit the open slots.
  let why = "";
  if (choice && !choice.fromShortlist)
    why = ids.length === 0
      ? " — a random eligible player, because your shortlist is empty."
      : hiddenNoFit
        ? ` — a random eligible player: none of your ${ids.length} shortlisted players fit the positions you still need.`
        : " — a random eligible player, because everyone on your shortlist is already taken.";
  const head = choice
    ? `<div class="text-xs ${myTurn ? "text-warn" : "text-slate-400"}">
         ${myTurn ? "⏱ If the clock runs out" : "If your clock runs out"} you'll get
         <b class="text-slate-100">${esc(choice.entry.name)}</b>${why}</div>`
    : `<div class="text-xs text-slate-400">No available player fits your open slots.</div>`;

  const movable = rows.filter((r) => !r.gone).length;
  const list = rows.slice(0, 10).map((r, n) => {
    const e = entryForId(r.pid);
    if (!e) return "";
    if (r.gone) return `<li class="flex items-center gap-2 py-1 opacity-45">
        ${avatarHtml(r.pid, e.team, "w-6 h-6")}
        <span class="min-w-0 flex-1 truncate text-sm line-through">${esc(e.name)}</span>
        <span class="shrink-0 text-xs text-slate-400">${esc(S.managers.find((m) => m.id === r.byManagerId)?.name ?? "taken")}</span>
      </li>`;
    const first = n === rows.findIndex((x) => !x.gone);
    const last  = n === rows.map((x) => !x.gone).lastIndexOf(true);
    return `<li data-qrow="${esc(r.pid)}" class="flex items-center gap-1.5 py-1 rounded">
      <span class="w-4 shrink-0 text-xs text-slate-400 font-mono">${n + 1}</span>
      ${avatarHtml(r.pid, e.team, "w-6 h-6")}
      <span class="min-w-0 flex-1 truncate text-sm">${esc(e.name)}</span>
      <span class="shrink-0 text-xs pos-${e.position} rounded px-1.5 py-0.5">${e.position}</span>
      ${myTurn ? `<button data-qpick="${esc(r.pid)}" class="shrink-0 bg-wcred hover:bg-wcred-hov rounded-lg px-2.5 text-xs font-bold">Pick</button>` : ""}
      ${movable > 1 ? `<span class="nudge-col shrink-0 leading-none">
        <button data-qup="${esc(r.pid)}" class="nudge text-slate-400 ${first ? "opacity-30" : ""}" ${first ? "disabled" : ""} aria-label="Move up">▲</button>
        <button data-qdn="${esc(r.pid)}" class="nudge text-slate-400 ${last ? "opacity-30" : ""}" ${last ? "disabled" : ""} aria-label="Move down">▼</button>
      </span>` : ""}
    </li>`;
  }).join("");

  const collapsed = localStorage.getItem("wcf_queue_collapsed") === "1";
  box.innerHTML = `<button id="queue-toggle" class="w-full flex items-center justify-between gap-2 text-left">
      <span class="text-sm font-semibold">★ Your queue</span>
      <span class="text-xs text-slate-400">${ids.length ? `${movable} available` : "empty"} ${collapsed ? "▾" : "▴"}</span>
    </button>
    ${collapsed ? "" : head}
    ${collapsed ? "" : (list ? `<ul class="divide-y divide-slate-800">${list}</ul>`
           : `<p class="text-xs text-slate-400">${ids.length
                ? "None of your shortlisted players fit the positions you still need."
                : "Star players on the Players tab to build a queue — auto-pick takes the top one available."}</p>`)}
    ${!collapsed && hiddenNoFit ? `<p class="text-xs text-slate-400">${hiddenNoFit} shortlisted ${
        hiddenNoFit === 1 ? "player doesn't" : "players don't"} fit your remaining slots.</p>` : ""}
    ${!collapsed && movable > 1 ? '<p class="text-xs text-slate-400 pt-0.5">Hold a row to drag it anywhere in the queue.</p>' : ""}`;

  const tog = box.querySelector("#queue-toggle");
  if (tog) tog.onclick = () => {
    localStorage.setItem("wcf_queue_collapsed", collapsed ? "0" : "1");
    renderDraftQueue(me, myTurn);
  };

  box.querySelectorAll("[data-qpick]").forEach((b) => b.onclick = () => {
    const entry = entryForId(b.dataset.qpick);
    if (!entry) return;
    const info = pickInfo(S.league.current_pick);
    const slot = slotForNewPick(managerPicks(info.manager.id), entry.position);
    if (confirm(`Pick ${entry.name} (${entry.position}, ${entry.team})? They'll slot in as ${slot}.`))
      makePick(entry, { ...info, pickNumber: S.league.current_pick })
        .catch((er) => toast(er.message));
  });
  const redraw = () => renderDraftQueue(myManager(), myTurn);
  const slide = (pid, dir) => {
    moveShortlist(pid, dir);
    animateReorder("draft-queue", "data-qrow", redraw, pid);
  };
  box.querySelectorAll("[data-qup]").forEach((b) => b.onclick = () => slide(b.dataset.qup, -1));
  box.querySelectorAll("[data-qdn]").forEach((b) => b.onclick = () => slide(b.dataset.qdn, 1));
  makeReorderable(box, "data-qrow", (order, moved) => {
    setShortlist(applyVisibleOrder(myShortlist(), order));
    animateReorder("draft-queue", "data-qrow", redraw, moved);
  });
}

/* The clock and whose turn it is must never be off screen. `position: sticky`
   kept slipping behind the app header on real devices, so this is an explicit
   compact bar: it appears the moment the full draft panel scrolls out of view
   and mirrors the same two facts. */
function syncDraftMini() {
  const bar = $("draft-mini"), head = $("draft-head");
  if (!bar || !head) return;
  const hdr = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
  const gone = head.getBoundingClientRect().bottom < hdr + 4;
  const onDraft = !document.querySelector('[data-view="draft"]')?.classList.contains("hidden");
  bar.classList.toggle("hidden", !(onDraft && gone));
}

function renderDraft() {
  if (!S.players.length) return;
  const L = S.league;
  const info = pickInfo(L.current_pick);
  const me = myManager();
  const myTurn = !!me && info.manager.id === me.id;

  $("draft-progress").textContent =
    `Pick ${L.current_pick} of ${totalPicks()} · Round ${info.round} of ${picksPerManager()}` +
    (leaguePhase() > 1 ? ` · Redraft (phase ${leaguePhase()})` : "");
  const away = me && !me.eliminated ? picksUntilTurn(me.id) : null;
  $("draft-onclock").textContent = myTurn ? "You're on the clock!"
    : `${info.manager.name} is on the clock`
      + (me?.eliminated ? " · 👀 you're spectating" : "");
  // Your turn should be unmissable; otherwise show how long you've got.
  const head = $("draft-head");
  if (head) head.className = "rounded-xl border p-4 " + (myTurn
    ? "border-wcgold bg-wcred/20 ring-2 ring-wcgold/40" : "border-slate-700 bg-slate-900");
  $("draft-onclock").className = "text-lg font-bold truncate " + (myTurn ? "text-wcgold" : "");
  const miniWho = $("draft-mini-who");
  if (miniWho) miniWho.textContent = myTurn ? "⏱ YOUR PICK — you're on the clock"
    : `${info.manager.name} is picking${away != null && away > 0 ? ` · you're ${away} away` : ""}`;
  $("draft-mini")?.classList.toggle("mini-yours", myTurn);
  const upnext = $("draft-upnext");
  if (upnext) {
    const show = !myTurn && away != null && away > 0;
    upnext.classList.toggle("hidden", !show);
    if (show) upnext.textContent = away === 1 ? "You're next" : `${away} picks until your turn`;
  }
  $("draft-slotline").textContent = needsSummary(managerPicks(info.manager.id));
  $("draft-order").innerHTML = draftOrderManagers().map((m) =>
    `<span class="rounded-full px-2.5 py-1 whitespace-nowrap border ${
      m.id === info.manager.id ? "border-wcgold text-wcgold bg-wcred/15"
                               : "border-slate-700 text-slate-400"
    }">${esc(m.name)}</span>`).join("");

  const banner = $("draft-mybanner");
  banner.classList.toggle("hidden", !myTurn);
  if (myTurn) {
    if (isFlexFormation()) {
      const f = formationBounds();
      banner.innerHTML = `Your pick — draft any mix<br><span class="text-xs font-normal text-slate-300">`
        + `Squad of ${cfgOf().squadSize ?? 15}. You must end with at least ${f.DEF[0]} DEF, ${f.MID[0]} MID, `
        + `${f.FWD[0]} FWD and a GK; the rest is your call. Each round you'll pick a formation within `
        + `DEF ${f.DEF[0]}–${f.DEF[1]}, MID ${f.MID[0]}–${f.MID[1]}, FWD ${f.FWD[0]}–${f.FWD[1]} (${f.starters}-a-side).</span>`;
    } else banner.textContent = "Your pick — any position you still need";
  }
  renderDraftQueue(me, myTurn);

  renderPool();          // memoised: rebuilds only when the pool's inputs change

  announceNewPicks();
  $("draft-recent").innerHTML = [...S.picks].slice(-5).reverse().map((pk, i) => {
    const m = S.managers.find((x) => x.id === pk.manager_id);
    // Only the newest row animates, and only when a pick actually landed —
    // it used to flash on every re-render, including a queue reorder.
    return `<li class="flex items-center gap-2 rounded px-1 py-1 ${
        i === 0 && _pickJustLanded ? "just-landed" : ""}">
      <span class="w-8 shrink-0 text-xs font-mono text-slate-400">#${pk.pick_number % 1000}</span>
      ${avatarHtml(pk.player_id, pk.team, "w-6 h-6")}
      <span class="min-w-0 flex-1 leading-tight">
        <span class="block truncate">${esc(pk.player_name)}</span>
        <span class="block truncate text-xs text-slate-400">${esc(pk.team || "")}</span>
      </span>
      <span class="shrink-0 text-xs pos-${pk.position} rounded px-1.5 py-0.5">${pk.position}</span>
      <span class="shrink-0 inline-flex items-center justify-center rounded w-[18px] h-[18px] text-xs font-bold leading-none"
            style="background:${managerColor(m)}33;border:1px solid ${managerColor(m)}99"
            title="${esc(m?.name ?? "?")}">${managerMark(m)}</span>
    </li>`;
  }).join("") || '<li class="text-slate-400">No picks yet — the board is wide open.</li>';

  // Collapsible search: the toggle persists, so it stays shut between renders.
  const poolShut = localStorage.getItem("wcf_pool_collapsed") === "1";
  $("pool-body").classList.toggle("hidden", poolShut);
  $("pool-toggle-hint").textContent = poolShut ? "show ▾" : "hide ▴";
  $("pool-toggle").onclick = () => {
    localStorage.setItem("wcf_pool_collapsed", poolShut ? "0" : "1");
    renderDraft();
  };

  renderRosters("draft-rosters");   // memoised; its signature includes the picks
  $("draft-force").classList.toggle("hidden", !isAdmin() || myTurn);
  $("draft-timerctl").classList.toggle("hidden", !isAdmin());
  if (isAdmin() && document.activeElement !== $("draft-timer-input"))
    $("draft-timer-input").value = S.league.pick_duration_seconds ?? 60;
}

/* ---------- scoring & leaderboard ---------- */

// Mirrors calculate_points() in daily_pull.py. clean_sheet as stored
// already encodes the ">=60 min and conceded 0" rule.
/* ---------- scoring rules engine (Workstream B) ----------
   Scoring is a list of rules, each: { stat, label, perPosition, points, mode,
   per?, gte? }. `points` is a number (position-independent) or {GK,DEF,MID,FWD}.
   mode "each" = points × count · "per" = points × floor(count/per) · "threshold"
   = points if count ≥ gte. A league stores its rules in config.scoring (array);
   with none it uses DEFAULT_RULES, which exactly replicate the WC-2026 scoring. */

// Stats a rule can score, grouped for the builder dropdown. The first block is
// always captured; the rest come from the raw API stats (competition pulls).
const STAT_CATALOG = [
  { key: "goals.total", label: "Goal" },
  { key: "goals.assists", label: "Assist" },
  { key: "clean_sheet", label: "Clean sheet (≥60 min)" },
  { key: "cards.yellow", label: "Yellow card" },
  { key: "cards.red", label: "Red card" },
  { key: "goals.saves", label: "Save (GK)" },
  { key: "defensive_actions", label: "Defensive action (tackle/block/int)" },
  { key: "motm", label: "Top-rated player" },
  { key: "penalty.saved", label: "Penalty saved" },
  { key: "penalty.missed", label: "Penalty missed" },
  { key: "passes.total", label: "Pass" },
  { key: "passes.key", label: "Key pass" },
  { key: "passes.accuracy", label: "Pass accuracy %" },
  { key: "shots.total", label: "Shot" },
  { key: "shots.on", label: "Shot on target" },
  { key: "dribbles.success", label: "Successful dribble" },
  { key: "duels.won", label: "Duel won" },
  { key: "fouls.drawn", label: "Foul drawn" },
  { key: "fouls.committed", label: "Foul committed" },
  { key: "goals.conceded", label: "Goal conceded" },
  { key: "offsides", label: "Offside" },
  { key: "rating", label: "Match rating" },
  { key: "minutes", label: "Minute played" },
];
const STAT_LABEL = Object.fromEntries(STAT_CATALOG.map((s) => [s.key, s.label]));

const DEFAULT_RULES = [
  { stat: "goals.total", mode: "each", perPosition: true, points: { GK: 8, DEF: 6, MID: 5, FWD: 4 } },
  { stat: "goals.assists", mode: "each", perPosition: false, points: 3 },
  { stat: "clean_sheet", mode: "each", perPosition: true, points: { GK: 6, DEF: 4, MID: 1, FWD: 0 } },
  { stat: "cards.yellow", mode: "each", perPosition: false, points: -1 },
  { stat: "cards.red", mode: "each", perPosition: false, points: -3 },
  { stat: "goals.saves", mode: "per", per: 2, perPosition: true, points: { GK: 1, DEF: 0, MID: 0, FWD: 0 } },
  { stat: "defensive_actions", mode: "per", per: 2, perPosition: true, points: { GK: 0, DEF: 1, MID: 1, FWD: 1 } },
  { stat: "motm", mode: "each", perPosition: false, points: 3 },
  { stat: "penalty.saved", mode: "each", perPosition: false, points: 5 },
  { stat: "penalty.missed", mode: "each", perPosition: false, points: -2 },
];

const scoringRules = () => {
  const c = cfgOf().scoring;
  return Array.isArray(c) && c.length ? c : DEFAULT_RULES;
};

/* ---------- flexible formations (Workstream B) ----------
   Fixed mode: starters per position are exact (starterQuota). Flex mode: the
   manager picks any per-position split within these [min,max] bounds that sums
   to `starters`, and the auto-sub engine promotes bench players (in listed
   order) to cover no-shows only where the resulting formation stays valid. */
const DEFAULT_FORMATION = { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3], starters: 11 };
const isFlexFormation = () => cfgOf().formationMode === "flex";
const formationBounds = () => ({ ...DEFAULT_FORMATION, ...(cfgOf().formation || {}) });

/* Choose a legal starting XI from a squad, changing as little as possible.

   A waiver resolves while nobody is watching, and it can leave an XI that no
   longer adds up -- a keeper claimed into an outfielder's place, or a position
   left short. The manager then plays the week with an illegal side through no
   act of their own. So the close repairs it rather than reporting it.

   Order of business: keep whoever is already starting (they are the manager's
   stated preference), meet every minimum, then fill the remaining places. Bench
   order is respected throughout, so the player a manager put first among the
   substitutes is the first one promoted.

   Pure: takes the squad and the bounds, returns the set of pick ids that should
   start. Returns null when the squad simply cannot field a legal XI, so the
   caller can leave it alone rather than write something half-repaired. */
function repairStarters(picks, mins, maxs, total) {
  const squad = (picks || []).filter((pk) => pk.position !== "TEAM" && pk.slot !== "TEAM");
  if (squad.length < total) return null;
  const GROUPS4 = ["GK", "DEF", "MID", "FWD"];
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  // Current starters first, then the bench in its own order.
  squad.forEach((pk, i) => { if (byPos[pk.position]) byPos[pk.position].push({ pk, i }); });
  for (const g of GROUPS4)
    byPos[g].sort((a, b) => (a.pk.is_sub ? 1 : 0) - (b.pk.is_sub ? 1 : 0) || a.i - b.i);

  const chosen = new Set(), count = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const take = (g, x) => { chosen.add(x.pk.id); count[g]++; };

  // 1 · every minimum, or there is no legal side to build.
  for (const g of GROUPS4) {
    const want = mins[g] || 0;
    for (const x of byPos[g]) { if (count[g] >= want) break; take(g, x); }
    if (count[g] < want) return null;            // squad cannot cover this position
  }
  // 2 · fill the rest, respecting each position's ceiling. Starters before
  //     substitutes again, so the fewest people are moved.
  const rest = GROUPS4.flatMap((g) => byPos[g].filter((x) => !chosen.has(x.pk.id)).map((x) => ({ g, ...x })))
    .sort((a, b) => (a.pk.is_sub ? 1 : 0) - (b.pk.is_sub ? 1 : 0) || a.i - b.i);
  for (const x of rest) {
    if (chosen.size >= total) break;
    if (count[x.g] >= (maxs[x.g] ?? Infinity)) continue;
    take(x.g, x);
  }
  return chosen.size === total ? chosen : null;
}

// The mins/maxs/total a legal XI must satisfy in this league's mode.
function lineupShape() {
  if (isFlexFormation()) {
    const b = formationBounds();
    return { mins: { GK: b.GK[0], DEF: b.DEF[0], MID: b.MID[0], FWD: b.FWD[0] },
             maxs: { GK: b.GK[1], DEF: b.DEF[1], MID: b.MID[1], FWD: b.FWD[1] },
             total: b.starters };
  }
  const q = starterQuota(), fx = lineupFlex();
  const total = (q.GK || 0) + (q.DEF || 0) + (q.MID || 0) + (q.FWD || 0) + fx;
  // Fixed mode: the quota IS the shape; flex places may go to any outfielder.
  return { mins: q, maxs: { GK: q.GK || 0, DEF: (q.DEF || 0) + fx,
                            MID: (q.MID || 0) + fx, FWD: (q.FWD || 0) + fx }, total };
}

// Is a per-position starter count { GK,DEF,MID,FWD } a legal formation?
function formationValid(counts, bounds) {
  const b = bounds || formationBounds();
  let total = 0;
  for (const p of ["GK", "DEF", "MID", "FWD"]) {
    const n = counts[p] || 0, [lo, hi] = b[p] || [0, Infinity];
    if (n < lo || n > hi) return false;
    total += n;
  }
  return total === b.starters;
}

// Flexible auto-subs: given a round's starters and bench (bench in listed
// priority order) and the set of player_ids who played, return the set that
// COUNTS this round. Bench players are promoted in order to fill no-show slots,
// but only into a subset that keeps the formation valid (every position within
// [min,max]); GK is only ever covered by a bench GK. If a no-show can't be
// validly covered its slot stays empty (scores 0). Pure + unit-tested.
function flexCounting(starters, bench, playedIds, bounds, totalStarters, maxSubs) {
  const b = bounds || formationBounds();
  const total = totalStarters || b.starters;
  const subCap = (maxSubs == null) ? Infinity : maxSubs;   // max bench promotions
  const played = playedIds instanceof Set ? playedIds : new Set(playedIds);
  const counting = new Set();
  // GK slot — GK only covers GK (and it counts toward the sub cap).
  let gkSubbed = 0;
  const gk = starters.find((s) => s.position === "GK");
  if (gk && played.has(gk.player_id)) counting.add(gk.player_id);
  else if (gk && subCap > 0) {
    const bgk = bench.find((x) => x.position === "GK" && played.has(x.player_id));
    if (bgk) { counting.add(bgk.player_id); gkSubbed = 1; }
  }
  // Outfield — played starters always count.
  const base = { DEF: 0, MID: 0, FWD: 0 };
  for (const s of starters)
    if (s.position !== "GK" && played.has(s.player_id)) { counting.add(s.player_id); base[s.position]++; }
  const cand = bench.filter((x) => x.position !== "GK" && played.has(x.player_id));
  const gkSlots = (b.GK && b.GK[1] > 0) ? 1 : 0;
  const maxAdd = Math.min((total - gkSlots) - (base.DEF + base.MID + base.FWD),   // empty outfield slots
    subCap - gkSubbed);                                                            // …within the sub cap
  if (maxAdd > 0 && cand.length) {
    // Pick the bench subset that maximizes coverage while keeping the formation
    // valid, tie-broken toward earlier bench order (cand ≤ ~8, so enumerate).
    let best = { ids: [], cov: -1, order: Infinity };
    for (let mask = 0; mask < (1 << cand.length); mask++) {
      const c = { ...base }; let size = 0, order = 0, over = false;
      for (let i = 0; i < cand.length; i++) if (mask & (1 << i)) {
        const p = cand[i].position; c[p]++; size++; order += i;
        if (c[p] > (b[p]?.[1] ?? Infinity)) over = true;
      }
      if (over || size > maxAdd) continue;
      const valid = ["DEF", "MID", "FWD"].every((p) =>
        (c[p] || 0) >= (b[p]?.[0] ?? 0) && (c[p] || 0) <= (b[p]?.[1] ?? Infinity));
      if (!valid) continue;
      if (size > best.cov || (size === best.cov && order < best.order)) {
        const ids = [];
        for (let i = 0; i < cand.length; i++) if (mask & (1 << i)) ids.push(cand[i].player_id);
        best = { ids, cov: size, order };
      }
    }
    for (const id of best.ids) counting.add(id);
  }
  return counting;
}

// Flex counting player_ids for round `rnd` from a roster (starter/bench entries),
// resolving each player's round-r match via teamMatches + an appeared(pid,label)
// predicate. Shared by the leaderboard and the lineup-history views.
function flexRoundCounting(roster, rnd, labelFor, appeared) {
  const st = roster.filter((e) => !e.is_sub && e.position !== "TEAM");
  const bn = roster.filter((e) => e.is_sub && e.position !== "TEAM");
  const played = new Set();
  for (const e of [...st, ...bn]) {
    const lbl = labelFor(e, rnd);
    if (lbl && appeared(e.player_id, lbl)) played.add(e.player_id);
  }
  const b = formationBounds();
  return flexCounting(st, bn, played, b, b.starters, maxSubsPerRound());
}

// Max bench players that may be promoted per round. Default = the whole bench
// (no cap); the admin can set a lower config.maxSubs.
function maxSubsPerRound() {
  if (cfgOf().maxSubs != null) return cfgOf().maxSubs;
  if (isFlexFormation()) return Math.max(0, (cfgOf().squadSize ?? 15) - formationBounds().starters);
  const q = posQuota(), s = starterQuota();
  return Math.max(0, ["GK", "DEF", "MID", "FWD"].reduce((a, p) => a + ((q[p] || 0) - (s[p] || 0)), 0));
}
const maxSubsCapped = () => cfgOf().maxSubs != null;

// Fixed-formation subs that activate this round, respecting the cap: bench
// players (in roster order) cover a same-position no-show starter until the cap
// (or the no-shows) run out. Only used when a cap is configured.
function fixedRoundSubs(roster, rnd, labelFor, appeared, cap, missed) {
  const starters = roster.filter((e) => !e.is_sub && e.position !== "TEAM");
  const noShow = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const st of starters) {
    // missed() also covers a blank gameweek, where there is no label at all.
    if (missed ? missed(st, rnd)
               : (() => { const l = labelFor(st, rnd); return l && !appeared(st.player_id, l); })())
      noShow[st.position]++;
  }
  const activated = new Set();
  let count = 0;
  for (const sub of roster.filter((e) => e.is_sub && e.position !== "TEAM")) {
    if (count >= cap) break;
    const lbl = labelFor(sub, rnd);
    if (lbl && appeared(sub.player_id, lbl) && noShow[sub.position] > 0) {
      activated.add(sub.player_id); noShow[sub.position]--; count++;
    }
  }
  return activated;
}

/* ---------- head-to-head log + bonus points (mechanics-notes spec) ----------
   Optional league format: instead of everyone tallying points, managers play a
   round-robin schedule and earn log points (win/draw/loss) + rugby-style bonuses
   from their per-round fantasy totals. All values are league-configurable. */
const H2H_DEFAULTS = { win: 3, draw: 1, loss: 0, score_bonus: 60, losing_margin: 5,
  rounds: null, rumble: false, rumble_scoring: "pairwise", rumble_points: null };
const h2hConfig = () => ({ ...H2H_DEFAULTS, ...(cfgOf().h2h || {}) });
const h2hEnabled = () => cfgOf().h2hEnabled === true;

// Round-robin schedule (circle method). Returns rounds of [home, away] pairs;
// away === null is a bye. Odd counts get a null placeholder that becomes byes.
function roundRobin(ids) {
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);
  const n = arr.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a === null || b === null) pairs.push([a === null ? b : a, null]);
      else pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());   // rotate, keeping the first fixed
  }
  return rounds;
}

// Fairness analysis of an N-manager, R-round head-to-head season. One full
// round-robin cycle is L rounds: N-1 when N is even (no byes), N when odd (each
// round one manager sits out, so over the cycle everyone byes exactly once).
// When R is a whole number of cycles the schedule is perfectly balanced. Any
// leftover rounds make some pairs meet once more than others, and for odd N give
// some managers an extra bye. If `rumble` is set, those leftover rounds are
// played all-play-all instead (everyone scores against the field), which keeps
// the head-to-head portion exactly balanced. Pure — drives the creation-time
// feedback and the live schedule. Returns { valid:false } for N<2 or R<1.
function h2hSchedulePlan(n, rounds, opts) {
  n = Math.floor(n) || 0; rounds = Math.floor(rounds) || 0;
  if (n < 2 || rounds < 1) return { valid: false, n, rounds };
  const rumbleOn = !!(opts && opts.rumble);
  const even = n % 2 === 0;
  const cycle = even ? n - 1 : n;
  const fullCycles = Math.floor(rounds / cycle);
  const leftover = rounds % cycle;
  const rumble = rumbleOn && leftover > 0;
  const extra = rumble ? 0 : (leftover > 0 ? 1 : 0);   // +1 games/byes for some
  const playsMin = fullCycles;
  const playsMax = fullCycles + extra;
  const byesMin = even ? 0 : fullCycles;
  const byesMax = even ? 0 : fullCycles + extra;
  const balanced = extra === 0;
  return {
    valid: true, n, rounds, even, cycle, fullCycles, leftover,
    rumble, rumbleRounds: rumble ? leftover : 0,
    // Round index (1-based) at/after which rounds are played as rumbles.
    rumbleFrom: rumble ? fullCycles * cycle + 1 : Infinity,
    playsMin, playsMax, byesMin, byesMax, balanced,
    // Each leftover round sits a distinct manager (odd N) → that many extra byes.
    managersWithExtraBye: (!even && !rumble) ? leftover : 0,
    nearestDown: fullCycles * cycle,               // 0 if fewer than one cycle
    nearestUp: (fullCycles + 1) * cycle,
  };
}

// One matchup's log points + bonuses for both managers, from their round scores.
// Attacking bonus (+1) if own score ≥ score_bonus (either result); losing bonus
// (+1) if you lose by ≤ losing_margin. Independent of win/draw/loss points.
function h2hResult(a, b, cfg) {
  cfg = cfg || h2hConfig();
  let ptsA, ptsB;
  if (a > b) { ptsA = cfg.win; ptsB = cfg.loss; }
  else if (b > a) { ptsB = cfg.win; ptsA = cfg.loss; }
  else { ptsA = ptsB = cfg.draw; }
  let bonusA = 0, bonusB = 0;
  if (a >= cfg.score_bonus) bonusA++;
  if (b >= cfg.score_bonus) bonusB++;
  if (a < b && (b - a) <= cfg.losing_margin) bonusA++;
  if (b < a && (a - b) <= cfg.losing_margin) bonusB++;
  return { ptsA, ptsB, bonusA, bonusB };
}

// Placement points for one rumble round: rank the managers by their round
// score (highest first) and hand out points[0], points[1], … to 1st, 2nd, …
// Managers tied on score split the points for the places they jointly occupy,
// so the total handed out is fixed regardless of ties. `scoresThisRound` is a
// { managerId: score } map (only managers who actually scored). Returns
// { managerId: points }. Pure.
function rumblePlacement(scoresThisRound, points) {
  points = points || [];
  const ranked = Object.entries(scoresThisRound)
    .filter(([, s]) => s !== undefined && s !== null)
    .sort((a, b) => b[1] - a[1]);
  const out = {};
  for (let i = 0; i < ranked.length;) {
    let j = i;
    while (j + 1 < ranked.length && ranked[j + 1][1] === ranked[i][1]) j++;   // tie group [i..j]
    let sum = 0;
    for (let k = i; k <= j; k++) sum += (points[k] || 0);
    const share = sum / (j - i + 1);
    for (let k = i; k <= j; k++) out[ranked[k][0]] = share;
    i = j + 1;
  }
  return out;
}

// The H2H log: per-manager { P,W,D,L,PF,PA,bonus,logPts,byes,rumblePts } + sorted
// order. A fixture counts only once BOTH managers have a score for that round; a
// bye (one side null) scores nothing but is tallied once the manager has a score.
// `placement` (optional) = { rounds:[…], points:[…] } scores those rounds by
// rank instead of pairwise fixtures — the placement-mode rumble rounds.
function h2hTable(mgrIds, scoresByMgr, fixtures, cfg, placement) {
  cfg = cfg || h2hConfig();
  const rows = {};
  for (const id of mgrIds) rows[id] = { id, P: 0, W: 0, D: 0, L: 0, PF: 0, PA: 0, bonus: 0, logPts: 0, byes: 0, rumblePts: 0 };
  const scoreOf = (m, round) => scoresByMgr[m]?.[round - 1];
  for (const f of fixtures) {
    const home = f.home_manager_id, away = f.away_manager_id;
    if (away == null || home == null) {                 // bye
      const m = home ?? away;
      if (m != null && rows[m] && scoreOf(m, f.round) !== undefined) rows[m].byes++;
      continue;
    }
    if (!rows[home] || !rows[away]) continue;
    const sa = scoreOf(home, f.round), sb = scoreOf(away, f.round);
    if (sa === undefined || sb === undefined) continue;  // round incomplete for the pair
    const r = h2hResult(sa, sb, cfg);
    rows[home].P++; rows[away].P++;
    rows[home].PF += sa; rows[home].PA += sb;
    rows[away].PF += sb; rows[away].PA += sa;
    if (sa > sb) { rows[home].W++; rows[away].L++; }
    else if (sb > sa) { rows[away].W++; rows[home].L++; }
    else { rows[home].D++; rows[away].D++; }
    rows[home].bonus += r.bonusA; rows[away].bonus += r.bonusB;
    rows[home].logPts += r.ptsA + r.bonusA;
    rows[away].logPts += r.ptsB + r.bonusB;
  }
  // Placement-scored rumble rounds: rank-based points, no pairwise fixtures.
  for (const round of (placement?.rounds || [])) {
    const scoresThisRound = {};
    for (const id of mgrIds) { const s = scoreOf(id, round); if (s !== undefined) scoresThisRound[id] = s; }
    const award = rumblePlacement(scoresThisRound, placement.points);
    for (const id in award) {
      rows[id].P++;
      rows[id].PF += scoresThisRound[id];
      rows[id].logPts += award[id];
      rows[id].rumblePts += award[id];
    }
  }
  // Head-to-head tiebreak: net score across the rounds a tied pair actually met.
  const met = (x, y) => {
    let d = 0;
    for (const f of fixtures) {
      if (f.away_manager_id == null) continue;
      const pair = [f.home_manager_id, f.away_manager_id];
      if (!pair.includes(x) || !pair.includes(y)) continue;
      const sx = scoreOf(x, f.round), sy = scoreOf(y, f.round);
      if (sx !== undefined && sy !== undefined) d += sx - sy;
    }
    return d;
  };
  const order = mgrIds.slice().sort((x, y) => {
    if (rows[x].logPts !== rows[y].logPts) return rows[y].logPts - rows[x].logPts;
    const h = met(x, y);
    if (h !== 0) return -h;
    return rows[y].PF - rows[x].PF;
  });
  return { rows, order };
}

/* ---------- waiver-order free-agent claims (mechanics-notes §1) ----------
   Resolve queued free-agent claims at window close in waiver priority. Pure:
   given claims (each manager's ordered preference list), the waiver order, the
   currently-rostered players, a per-manager cap, and each pick's held player,
   returns { awards, failed, order }. See the spec for the exact rules.
   tradeLimit caps how many claims each manager can win in this window
   (null/undefined = no cap). */
function resolveFaClaims(claims, waiverOrder, taken, tradeLimit, pickHolds) {
  const order = { ...waiverOrder };
  let maxOrder = Math.max(-1, ...Object.values(order).filter((v) => v != null));
  const rostered = new Set(taken);
  const holds = { ...pickHolds };
  const limit = tradeLimit == null ? Infinity : tradeLimit;
  const awards = [], failed = [];
  const byMgr = {};
  for (const c of claims) (byMgr[c.manager_id] ||= []).push(c);
  for (const m in byMgr) byMgr[m].sort((a, b) =>
    (a.rank - b.rank) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const wanters = {};
  for (const c of claims) (wanters[c.in_player_id] ||= new Set()).add(c.manager_id);
  const contested = (pid) => (wanters[pid]?.size || 0) > 1;
  const ptr = {}, count = {}, done = {};
  for (const m in byMgr) { ptr[m] = 0; count[m] = 0; done[m] = false; }
  const prio = (m) => order[m] == null ? Infinity : order[m];
  const active = () => Object.keys(byMgr).filter((m) => !done[m]);
  const capOut = (m) => {
    done[m] = true;
    for (let i = ptr[m]; i < byMgr[m].length; i++) {
      wanters[byMgr[m][i].in_player_id]?.delete(m);   // ignored → no longer contests
      failed.push(byMgr[m][i].id);
    }
    ptr[m] = byMgr[m].length;
  };
  let act;
  while ((act = active()).length) {
    const m = act.sort((x, y) => prio(x) - prio(y) || String(x).localeCompare(String(y)))[0];
    if (count[m] >= limit) { capOut(m); continue; }
    let executed = null;
    while (ptr[m] < byMgr[m].length) {
      const c = byMgr[m][ptr[m]++];
      const feasible = holds[c.pick_id] === c.out_player_id && !rostered.has(c.in_player_id);
      if (!feasible) { failed.push(c.id); continue; }   // fallback → next preference
      rostered.delete(c.out_player_id); rostered.add(c.in_player_id);
      holds[c.pick_id] = c.in_player_id;
      count[m]++; awards.push(c); executed = c;
      break;
    }
    if (!executed) { done[m] = true; continue; }
    if (contested(executed.in_player_id)) { maxOrder++; order[m] = maxOrder; }  // yield
    if (count[m] >= limit) capOut(m);
  }
  const seen = new Set([...awards.map((c) => c.id), ...failed]);
  for (const c of claims) if (!seen.has(c.id)) failed.push(c.id);
  return { awards, failed, order };
}

// Automatic trade/lineup windows driven by the competition fixture list
// (Premier-League focus: fixtures are grouped into matchweeks by their `round`
// string, e.g. "Regular Season - 12"). Pure so it's unit-testable.
//
//   fixtures : [{ round, kickoff_utc }]  (extra fields ignored; ms or ISO ok)
//   nowMs    : current time in epoch ms
//   opts     : { tradeOpenAfterH=1, tradeCloseBeforeH=24, lineupLockBeforeH=1 }
//
// Rules (from the spec):
//   • The trade window between two consecutive matchweeks A→B opens
//     tradeOpenAfterH hours after A's LAST fixture and closes
//     tradeCloseBeforeH hours before B's FIRST fixture.
//   • The lineup for the upcoming matchweek locks lineupLockBeforeH hours
//     before that matchweek's FIRST fixture.
// A team playing twice in one matchweek is handled naturally: first/last
// kickoff are the min/max across all of that week's fixtures.
function matchweeksOf(fixtures) {
  const H = 3600e3;
  const by = {};
  for (const f of fixtures || []) {
    const r = f.round;
    const t = f.kickoff_utc == null ? null
      : (typeof f.kickoff_utc === "number" ? f.kickoff_utc : Date.parse(f.kickoff_utc));
    if (r == null || t == null || isNaN(t)) continue;
    (by[r] ||= []).push(t);
  }
  /* Ordered by the competition's OWN round order when we have it, and only
     by earliest kickoff when we do not (ROUNDS_DESIGN.md Phase 2.5). Sorting
     by kickoff means a rescheduled tie can reorder the season -- and since the
     trade window between two rounds is arithmetic on "consecutive" ones, a
     flipped pair silently moves a deadline. A round the recorded order does not
     mention sorts after the ones it does, by kickoff, so a hand-added fixture
     in the test bench still lands somewhere sensible. */
  const order = S.roundOrder || [];
  const rank = (r) => { const i = order.indexOf(r); return i === -1 ? Infinity : i; };
  return Object.keys(by).map((r) => ({
    round: r, first: Math.min(...by[r]), last: Math.max(...by[r]),
  })).sort((a, b) => (rank(a.round) - rank(b.round)) || (a.first - b.first));
}
function fixtureWindows(fixtures, nowMs, opts) {
  const H = 3600e3, o = opts || {};
  const openAfter = (o.tradeOpenAfterH ?? 1) * H;
  const closeBefore = (o.tradeCloseBeforeH ?? 24) * H;
  const lockBefore = (o.lineupLockBeforeH ?? 1) * H;
  const weeks = matchweeksOf(fixtures);
  // Trade window: does `now` fall inside any consecutive-matchweek gap?
  let tradeOpen = false, tradeWindow = null;
  for (let i = 0; i + 1 < weeks.length; i++) {
    const openAt = weeks[i].last + openAfter;
    const closeAt = weeks[i + 1].first - closeBefore;
    if (nowMs >= openAt && nowMs < closeAt) {
      tradeOpen = true;
      tradeWindow = { from: weeks[i].round, to: weeks[i + 1].round, openAt, closeAt };
      break;
    }
  }
  // Upcoming matchweek = earliest whose first fixture hasn't kicked off yet.
  const upcoming = weeks.find((w) => w.first > nowMs) || null;
  const lineupLockAt = upcoming ? upcoming.first - lockBefore : null;
  const lineupOpen = lineupLockAt != null && nowMs < lineupLockAt;
  return { tradeOpen, tradeWindow, lineupOpen, lineupLockAt, upcoming, weeks };
}

/* The most recently CLOSED trade window — the one whose queued claims are now
   due. fixtureWindows() only ever reports the window currently OPEN, so once it
   shuts there is nothing left describing it, which is why waiver claims in an
   auto-window league were never resolved at all: the only thing that resolved
   them was the manual open/close toggle, and that returns early in auto mode.

   Same arithmetic as fixtureWindows so the two can't drift. A window whose
   close would land at or before its open is degenerate (the matchweeks are too
   close together for the configured hours) and is not a window at all. */
function closedTradeWindows(fixtures, nowMs, opts) {
  const H = 3600e3, o = opts || {};
  const openAfter = (o.tradeOpenAfterH ?? 1) * H;
  const closeBefore = (o.tradeCloseBeforeH ?? 24) * H;
  const weeks = matchweeksOf(fixtures);
  const out = [];
  for (let i = 0; i + 1 < weeks.length; i++) {
    const openAt = weeks[i].last + openAfter;
    const closeAt = weeks[i + 1].first - closeBefore;
    if (closeAt > openAt && closeAt <= nowMs)
      out.push({ from: weeks[i].round, to: weeks[i + 1].round, openAt, closeAt });
  }
  return out;
}

// The newest of them — what every display path wants, and what settlement used
// to believe was the only one that existed.
function lastClosedTradeWindow(fixtures, nowMs, opts) {
  const all = closedTradeWindows(fixtures, nowMs, opts);
  return all.length ? all[all.length - 1] : null;
}

// Are this window's claims still owed a resolution? processedUntil is the close
// time of the last window already dealt with (epoch ms, or null for none).
const waiverDue = (win, processedUntil) =>
  !!win && (processedUntil == null || win.closeAt > processedUntil);

/* The lineup lock that a change made at `nowMs` should take effect at — i.e.
   the next one still in the future. Null when the season has no fixture left.

   This is the pivot the whole design turns on. The app used to try to
   PHOTOGRAPH each manager's XI at the moment of the lock, which needs something
   punctual to be awake at that second; late meant wrong. Instead a change is
   written immediately and STAMPED with the lock it applies to. rosterAtFor()
   already ignores a snapshot until its effective_from has passed, so the XI
   starts applying by arithmetic rather than because anything fired. */
function nextLockMs(fixtures, nowMs, opts) {
  const o = opts || {};
  const lockBefore = (o.lineupLockBeforeH ?? 1) * 3600e3;
  for (const w of matchweeksOf(fixtures)) {
    const lockAt = w.first - lockBefore;
    if (lockAt > nowMs) return lockAt;
  }
  return null;
}

/* The round a lock taken at `atMs` is locking FOR (ROUNDS_DESIGN.md Phase 1.5).

   A lock always precedes the games it freezes, so the round being locked is the
   next matchweek still to kick off. `>=` rather than `>` so a zero-hour lock
   (lockAt === first kickoff) names its own round rather than the one after.
   Falls back to the last matchweek when the season has no fixture left, and to
   null when there are no fixtures at all — an unstamped snapshot is valid and
   simply uses the timestamp path.

   This is the whole point of the phase: the writer knows the round, so it
   writes it. restampPlan() has to GUESS it back later by matching timestamps to
   the nearest lock, which is wrong the moment a fixture moves. */
function roundKeyLockedAt(fixtures, atMs) {
  const weeks = matchweeksOf(fixtures);
  for (const w of weeks) if (w.first >= atMs) return w.round;
  return weeks.length ? weeks[weeks.length - 1].round : null;
}

/* The lock that FOLLOWS a trade window closing — when that window's waiver
   awards should start counting. Trading shuts further out than line-ups do
   (24h vs 1h by default), so this is always after the close.

   Stamping the awards here is what makes a late resolution still correct: run
   on time it is a future stamp, run after the games it is a past one, and
   either way the matchweek scores with the squad the manager should have had. */
function lockAfterWindow(fixtures, closeAtMs, opts) {
  const o = opts || {};
  const lockBefore = (o.lineupLockBeforeH ?? 1) * 3600e3;
  for (const w of matchweeksOf(fixtures)) {
    const lockAt = w.first - lockBefore;
    if (lockAt >= closeAtMs) return lockAt;
  }
  return null;
}

/* restampPlan() lived here. It recovered which round a snapshot was for by
   matching its timestamp to the nearest future lock (Math.abs and all) and
   re-pointed it whenever fixtures moved — the re-derivation this document was
   written about, running on every refresh. Snapshots carry their round now, so
   there is nothing left to re-point. Its replacement is
   backfillSnapshotRounds(). */

/* ---------- the matchday card: "what do I do right now?" ----------
   The app knows the shape of a fantasy week — results land, the trade window
   opens, lineups lock, games kick off — but until now it never said so. This
   is the pure core behind the card at the top of Home: given the window state,
   the clock and whatever the manager hasn't set yet, it picks the stage of the
   week, the next deadline, and the single action worth offering.

   o = { started, live, tradeOpen, lineupOpen, autoWindows,
         lineupLockAt, kickoffAt, tradeOpensAt, tradeClosesAt,
         matchweek, todo: [string] }                          (times = epoch ms) */
const MD_STAGES = ["results", "transfers", "lineup", "locked", "live"];
const MD_STAGE_LABEL = { results: "Results", transfers: "Transfers",
  lineup: "Lineup", locked: "Locked", live: "Live" };

function matchdayPlan(o) {
  o = o || {};
  const todo = o.todo || [];
  if (!o.started) {
    return { stage: "preseason", title: "Season hasn't started", matchweek: null,
      deadlineAt: null, deadlineLabel: null, cta: null, todo: [] };
  }
  let stage;
  if (o.live) stage = "live";
  else if (o.lineupOpen) stage = o.tradeOpen ? "transfers" : "lineup";
  else if (o.tradeOpen) stage = "transfers";
  else if (o.tradeOpensAt != null && o.tradeOpensAt > o.nowMs) stage = "results";
  else stage = "locked";

  let deadlineAt = null, deadlineLabel = null, title = "", cta = null;
  if (stage === "results") {
    title = "Round complete"; deadlineAt = o.tradeOpensAt;
    deadlineLabel = "Trade window opens"; cta = { label: "See round recap", act: "recap" };
  } else if (stage === "transfers") {
    title = "Trade window open"; deadlineAt = o.tradeClosesAt;
    deadlineLabel = "Trade window closes";
    // If the lineup still needs attention, that outranks browsing free agents.
    cta = todo.length ? { label: "Set your lineup", act: "lineup" }
                      : { label: "Make transfers", act: "trades" };
  } else if (stage === "lineup") {
    title = "Last chance to set your team"; deadlineAt = o.lineupLockAt;
    deadlineLabel = "Lineup locks"; cta = { label: "Set your lineup", act: "lineup" };
  } else if (stage === "locked") {
    title = "Lineups locked"; deadlineAt = o.kickoffAt;
    deadlineLabel = "First kick-off"; cta = { label: "View your XI", act: "lineup" };
  } else {
    title = "Games in progress"; cta = { label: "Watch live", act: "live" };
  }
  return { stage, title, matchweek: o.matchweek ?? null, deadlineAt, deadlineLabel, cta, todo };
}

/* Digest one completed round for one manager — the "round recap" moment.
   Everything here already existed, scattered across four tabs; the point is to
   compose it into the thing people actually care about (and screenshot).
     round       = { n, items: [{ entry, pts }], subtotal }
     leagueRound = { managerId: subtotal }  — everyone's score that round
     h2h         = { oppName, mine, theirs } | null                     Pure. */
function roundRecap(round, leagueRound, h2h) {
  if (!round) return null;
  const scored = (round.items || []).filter((it) => it.pts != null);
  const starters = scored.filter((it) => !it.entry.is_sub);
  const bench = scored.filter((it) => it.entry.is_sub);
  const ranked = starters.slice().sort((a, b) => (b.pts || 0) - (a.pts || 0));
  const all = Object.values(leagueRound || {});
  const score = round.subtotal || 0;
  return {
    n: round.n,
    score,
    rank: all.filter((v) => v > score).length + 1,
    of: all.length,
    avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
    best: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    benchPts: bench.reduce((s, it) => s + (it.pts || 0), 0),
    result: h2h ? (h2h.mine > h2h.theirs ? "W" : h2h.mine < h2h.theirs ? "L" : "D") : null,
    h2h: h2h || null,
  };
}

/* ---------- form, awards and the transfer roundup (pure) ----------
   These give a league things to talk about. All three take plain data so they
   can be reasoned about and tested without a database. */

// A manager's run of form from their round scores, plus where they sit against
// the league each round. `rank` is 1-based; ties share the better rank.
//   rounds      = [subtotal, …] for this manager, oldest first
//   ranksByRound= [rank, …] aligned to `rounds` (optional)
function managerStreaks(rounds, ranksByRound) {
  rounds = rounds || [];
  let best = 0, run = 0, bestWin = 0, winRun = 0;
  for (let i = 0; i < rounds.length; i++) {
    // A "win" is topping the round; without ranks, beating your own average.
    const avg = rounds.reduce((a, b) => a + b, 0) / (rounds.length || 1);
    const won = ranksByRound ? ranksByRound[i] === 1 : rounds[i] > avg;
    winRun = won ? winRun + 1 : 0;
    bestWin = Math.max(bestWin, winRun);
    const up = i > 0 && rounds[i] >= rounds[i - 1];
    run = up ? run + 1 : 0;
    best = Math.max(best, run);
  }
  // Form is only worth flagging when it's unusual. Being "below your own
  // average" happens about half the time, so an earlier version marked most of
  // the league cold every week, which told nobody anything. Require a real
  // sample and a clear margin over the manager's own baseline.
  const mean = rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : 0;
  const last3 = rounds.slice(-3);
  const recent = last3.length === 3 ? last3.reduce((a, b) => a + b, 0) / 3 : null;
  const enough = rounds.length >= 5 && mean > 0;
  return {
    played: rounds.length,
    mean,
    bestRound: rounds.length ? Math.max(...rounds) : 0,
    worstRound: rounds.length ? Math.min(...rounds) : 0,
    currentWinStreak: winRun, longestWinStreak: bestWin, longestRisingRun: best,
    hot: !!(enough && recent !== null && recent >= mean * 1.3),
    cold: !!(enough && recent !== null && recent <= mean * 0.7),
  };
}

// End-of-season superlatives, from each manager's rounds and bench history.
//   entries = [{ id, name, rounds:[n], benchPts:[n], best:{name,pts} }]
function seasonAwards(entries) {
  entries = (entries || []).filter((e) => (e.rounds || []).length);
  if (!entries.length) return [];
  const out = [];
  const pick = (label, note, fn, cmp) => {
    let win = null, val = null;
    for (const e of entries) {
      const v = fn(e);
      if (v == null) continue;
      if (val == null || cmp(v, val)) { val = v; win = e; }
    }
    if (win) out.push({ label, note, manager: win.name, value: val });
  };
  const gt = (a, b) => a > b, lt = (a, b) => a < b;
  pick("Best single round", "highest score in one round",
    (e) => Math.max(...e.rounds), gt);
  pick("Most consistent", "smallest gap between best and worst round",
    (e) => e.rounds.length > 1 ? Math.max(...e.rounds) - Math.min(...e.rounds) : null, lt);
  pick("Unluckiest bench", "most points left unused on the bench",
    (e) => (e.benchPts || []).reduce((a, b) => a + b, 0), gt);
  pick("Slowest start", "lowest opening round",
    (e) => e.rounds[0], lt);
  pick("Strongest finish", "highest final round",
    (e) => e.rounds[e.rounds.length - 1], gt);
  return out;
}

/* The biggest moves once a trade window closes. Manager-to-manager trades are
   ranked above free-agent pickups at equal weight, because a trade needed two
   people to agree and is the more interesting story.
     moves = [{ kind:"trade"|"swap"|"waiver", manager, with?, inName, outName,
                inPts, outPts }]
   Weight is the points that actually changed hands; a trade counts both sides. */
function transferRoundup(moves, limit) {
  const scored = (moves || []).map((m) => {
    const isTrade = m.kind === "trade";
    const swing = isTrade ? (m.inPts || 0) + (m.outPts || 0)
                          : Math.max(m.inPts || 0, m.outPts || 0);
    return { ...m, isTrade, swing, weight: swing * (isTrade ? 1.5 : 1) };
  }).filter((m) => m.swing > 0);
  scored.sort((a, b) => b.weight - a.weight
    || (b.isTrade ? 1 : 0) - (a.isTrade ? 1 : 0)
    || String(a.inName || "").localeCompare(String(b.inName || "")));
  return scored.slice(0, limit || 5);
}

// "2d 04h 11m" · "3h 12m 40s" · "4m 09s" — the countdown on the card.
function fmtCountdown(ms) {
  if (ms == null || !isFinite(ms)) return "";
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400),
        h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p2(h)}h ${p2(m)}m`;
  if (h > 0) return `${h}h ${p2(m)}m ${p2(ss)}s`;
  return `${m}m ${p2(ss)}s`;
}

// Per-manager round subtotals (the H2H fixture scores), from the lineup history.
function h2hRoundScores() {
  const scores = {};
  for (const m of S.managers) scores[m.id] = managerHistory(m.id).rounds.map((r) => r.subtotal);
  return scores;
}

// A deterministic round-robin schedule (sorted ids for stability), the base
// cycle repeated across `maxRound` rounds.
// Build the H2H fixtures up to maxRound. Rounds at/after opts.rumbleFrom are
// played all-play-all (a "rumble": every pair meets that round), keeping the
// head-to-head log balanced when the season doesn't divide into whole cycles.
function h2hFixturesFor(mgrIds, maxRound, opts) {
  if (mgrIds.length < 2) return [];
  const ids = mgrIds.slice().sort();
  const base = roundRobin(ids);
  const rumbleFrom = (opts && opts.rumbleFrom) || Infinity;
  const placementFrom = (opts && opts.placementFrom) || Infinity;   // scored by rank, no fixtures
  const fixtures = [];
  for (let r = 1; r <= maxRound; r++) {
    if (r >= placementFrom) continue;
    if (r >= rumbleFrom) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          fixtures.push({ round: r, home_manager_id: ids[i], away_manager_id: ids[j], rumble: true });
    } else {
      for (const [home, away] of base[(r - 1) % base.length])
        fixtures.push({ round: r, home_manager_id: home, away_manager_id: away });
    }
  }
  return fixtures;
}

// The current H2H log for all managers (the standings when H2H is enabled).
function h2hStandings() {
  const ids = S.managers.map((m) => m.id);
  const scores = h2hRoundScores();
  const maxRound = Math.max(0, ...Object.values(scores).map((a) => a.length));
  const cfg = h2hConfig();
  /* Rumbles fill the LEFTOVER rounds at the end of a season, so they need to
     know how long the season is. Falling back to "rounds played so far" made
     that number 1 in round one -- less than a full round-robin cycle, so every
     round counted as leftover and the whole league became a rumble from the
     first week: no wins, no losses, and a log that never moved.

     Without an explicit round count there is no such thing as a leftover
     round, so the schedule is simply a rolling round-robin. */
  const plan = (cfg.rumble && cfg.rounds > 0)
    ? h2hSchedulePlan(ids.length, cfg.rounds, { rumble: true }) : null;
  let fixOpts = {}, placement = null;
  if (plan && plan.valid && plan.rumble) {
    if (cfg.rumble_scoring === "placement") {
      const rounds = [];                                    // the rumble rounds seen so far
      for (let r = plan.rumbleFrom; r <= maxRound; r++) rounds.push(r);
      /* An empty points list awards nobody anything, which reads as a league
         where nothing counts. Fall back to the 3-2-1 the create form offers. */
      const pts = (cfg.rumble_points || []).length ? cfg.rumble_points : [3, 2, 1];
      placement = { rounds, points: pts };
      fixOpts = { placementFrom: plan.rumbleFrom };         // no pairwise fixtures for them
    } else {
      fixOpts = { rumbleFrom: plan.rumbleFrom };            // all-play-all pairwise
    }
  }
  return h2hTable(ids, scores, h2hFixturesFor(ids, maxRound, fixOpts), cfg, placement);
}

// A stat row → a flat { "goals.total": n, ... } map. New rows carry the full API
// stat set in `raw`; legacy rows are reconstructed from the derived columns, so
// DEFAULT_RULES score them exactly as the old hardcoded formula did.
function rawStatsOf(r) {
  const base = {
    "goals.total": r.goals || 0, "goals.assists": r.assists || 0,
    "goals.saves": r.saves || 0, "clean_sheet": r.clean_sheet ? 1 : 0,
    "cards.yellow": r.yellow_cards || 0, "cards.red": r.red_cards || 0,
    "motm": r.motm ? 1 : 0, "penalty.saved": r.penalty_saved || 0,
    "penalty.missed": r.penalty_missed || 0,
    "defensive_actions": r.defensive_actions || 0, "minutes": r.minutes || 0,
  };
  return r.raw ? { ...base, ...r.raw } : base;
}

// Points a single rule awards a player at position `pos` for one match.
function evalRule(rule, raw, pos) {
  if (rule.minMinutes && (raw.minutes || 0) < rule.minMinutes) return 0;  // minutes gate
  const pts = rule.perPosition ? (rule.points?.[pos] ?? 0) : (rule.points ?? 0);
  const v = raw[rule.stat] || 0;
  if (rule.mode === "per") return rule.per ? Math.floor(v / rule.per) * pts : 0;
  if (rule.mode === "threshold") return v >= (rule.gte ?? Infinity) ? pts : 0;
  return v * pts;   // "each"
}

// One match row's points at position `pos` under an explicit rules array.
function rowPointsWith(r, pos, rules) {
  if (!r.appeared) return 0;
  const raw = rawStatsOf(r);
  let p = 0;
  for (const rule of rules) p += evalRule(rule, raw, pos);
  return p;
}
function calcPlayerPoints(r, pos) { return rowPointsWith(r, pos, scoringRules()); }

// Mean + population standard deviation of a list of numbers.
function statSummary(vals) {
  const n = vals.length;
  if (!n) return { n: 0, mean: 0, sd: 0 };
  let sum = 0; for (const v of vals) sum += v;
  const mean = sum / n;
  let sq = 0; for (const v of vals) sq += (v - mean) * (v - mean);
  return { n, mean, sd: Math.sqrt(sq / n) };
}

// Validate a candidate scoring system against prior stat rows: total each
// player's points under `rules`, keep those with ≥ minGames appearances, and
// summarise the points distribution per position (to check the system doesn't
// systematically favour one position). Returns per-position {n,mean,sd}, the
// ranked players, and the spread of position means. Pure.
//   statRows : [{ player_id, appeared, …raw }]   posOf : { player_id: "DEF" }
function scoringBalance(statRows, posOf, rules, minGames) {
  minGames = minGames || 5;
  const agg = {};
  for (const r of statRows || []) {
    if (!r.appeared) continue;
    const pid = r.player_id, pos = posOf[pid];
    if (!pos) continue;
    const e = agg[pid] || (agg[pid] = { pid, pos, games: 0, points: 0 });
    e.games++;
    e.points += rowPointsWith(r, pos, rules);
  }
  const players = Object.values(agg).filter((e) => e.games >= minGames);
  const perPos = {};
  for (const p of ["GK", "DEF", "MID", "FWD"])
    perPos[p] = statSummary(players.filter((x) => x.pos === p).map((x) => x.points));
  const means = ["GK", "DEF", "MID", "FWD"].map((p) => perPos[p]).filter((s) => s.n).map((s) => s.mean);
  const spread = means.length ? Math.max(...means) - Math.min(...means) : 0;
  const overall = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  return {
    perPos, spread, overall,
    relSpread: overall ? spread / overall : 0,        // spread as a fraction of the average
    top: players.slice().sort((a, b) => b.points - a.points),
    count: players.length, minGames,
  };
}

// Bin players' season totals into a shared histogram, split by position — the
// data behind the ridgeline overlay. `players` = [{ pos, points }]. Bins span
// the global min→max so every position is drawn on the SAME x-scale (that shared
// axis is what makes the positional bias comparable). Pure.
function pointsHistogram(players, nbins) {
  nbins = nbins || 14;
  const pts = players.map((p) => p.points);
  const series = {};
  for (const pos of ["GK", "DEF", "MID", "FWD"]) series[pos] = new Array(nbins).fill(0);
  if (!pts.length) return { nbins, min: 0, max: 0, binW: 0, series };
  let min = Math.min(...pts), max = Math.max(...pts);
  if (max === min) max += 1;
  const binW = (max - min) / nbins;
  for (const p of players) {
    if (!series[p.pos]) continue;
    let b = Math.floor((p.points - min) / binW);
    if (b < 0) b = 0; else if (b >= nbins) b = nbins - 1;
    series[p.pos][b]++;
  }
  return { nbins, min, max, binW, series };
}

// Cumulative stage bonus: every stage reached up to and including the
// current one pays out once (group = 0; a champion totals 90 by default).
function calcTeamPoints(stage) {
  const order = stageOrder(), bonus = stageBonuses();
  const idx = order.indexOf(stage);
  let pts = 0;
  for (let i = 1; i <= idx; i++) pts += bonus[order[i]] || 0;
  return pts;
}

// Raw tournament-to-date points for one player (every appearance counts;
// the leaderboard's sub-activation rules are separate).
let ptsCache = null;
function playerPoints(playerId, position) {
  if (!ptsCache) {
    ptsCache = {};
    for (const r of S.stats) (ptsCache[r.player_id] ||= []).push(r);
  }
  return (ptsCache[playerId] || []).reduce((s, r) => s + calcPlayerPoints(r, position), 0);
}

const stageOf = (team) => S.stages.find((s) => s.team === team)?.stage || "group";
const isEliminated = (team) => !!S.stages.find((s) => s.team === team)?.eliminated;

// A manager's live TEAM-pick bonus (kept even after they're cut, so their
// national team keeps earning stage points). The kept TEAM pick + this value
// are what make a cut manager's total tick up as their country advances.
function managerTeamBonus(mgrId) {
  const tp = managerPicks(mgrId).find((pk) => pk.slot === "TEAM");
  return tp ? { pick: tp, pts: calcTeamPoints(stageOf(tp.team)) } : null;
}

// Points badge for any pool entry or pick: TEAM entries show stage bonuses.
function entryPoints(playerId, position, team) {
  return position === "TEAM" ? calcTeamPoints(stageOf(team)) : playerPoints(playerId, position);
}

const labelDate = (l) => (String(l || "").match(/\((\d{4}-\d{2}-\d{2})\)/) || [])[1] || null;
const labelTeams = (l) => {
  const m = String(l || "").match(/^(.+) vs (.+) \(/);
  return m ? [m[1], m[2]] : [];
};

// Sub activation: a sub's k-th match (round) counts only if a same-position
// starter's team also played its k-th match but the starter didn't feature in
// it. Comparing by round (each team's 1st/2nd/3rd… game), not calendar day,
// lets a sub cover a no-show starter even when they play on different dates.
/* ---------- shared lineup-history helpers (scoring + player detail) ---------- */

// Kickoff epoch-ms for a match label, from fixtures.json, else end of day
// (which reproduces the older per-date behaviour). No cache: fixtures are
// static in the app but mutated between cases in the test harness.
function matchTimeFor(label) {
  for (const f of S.fixtures || []) {
    const d = String(f.kickoff_utc || "").slice(0, 10);
    if (d && `${f.home} vs ${f.away} (${d})` === label) return Date.parse(f.kickoff_utc);
  }
  return Date.parse(labelDate(label) + "T23:59:59Z");
}

// Lineup snapshots grouped per manager, each list oldest-first.
function snapshotsByManager() {
  const by = {};
  for (const s of S.snapshots || []) (by[s.manager_id] ||= []).push(s);
  for (const k in by) by[k].sort((a, b) =>
    String(a.effective_from).localeCompare(String(b.effective_from)));
  return by;
}

// The roster a manager had locked in for a match at epoch-ms t on date d:
// latest lock at/before kickoff, with draft-night grace (a same-day lock
// counts when none predates kickoff), falling back to the baseline
// snapshot then current picks. This is the exact rule the leaderboard
// scores by, shared so the player detail can show per-match lineup status.
function rosterAtFor(mgrId, t, d, snaps, roundKey) {
  snaps = snaps || snapshotsByManager()[mgrId] || [];
  /* A snapshot that says which round it was FOR answers outright. No timestamp
     arithmetic, so no reschedule can move which round it applies to.

     Picked by when it was WRITTEN, not by effective_from. Those agreed while
     restampSnapshots() kept every stamp pointing at the current lock; without
     it, a lock that moves EARLIER leaves two rows for the round and the stale
     one sorts first — so ordering by effective_from would hand back the
     line-up the manager replaced. The last one saved is the one they meant. */
  if (roundKey) {
    let best = null, bestAt = -Infinity;
    for (const sn of snaps) {
      if (sn.round_key !== roundKey) continue;
      const at = Date.parse(sn.created_at || sn.effective_from || 0) || 0;
      if (at >= bestAt) { bestAt = at; best = sn; }
    }
    if (best) return best.roster;
  }
  let chosen = null;
  for (const s of snaps) {
    if (Date.parse(s.effective_from) <= t) chosen = s; else break;
  }
  if (!chosen) {
    for (const s of snaps) {
      if (String(s.effective_from).slice(0, 10) <= d) chosen = s; else break;
    }
  }
  /* Last resort: the match predates every snapshot, so the earliest one is the
     closest record of what they had. A FUTURE-dated snapshot is not a record
     though -- it is a line-up for a round still to come -- so it is never used
     here, or a past match would score against an XI that was never in force. */
  if (!chosen && snaps.length && Date.parse(snaps[0].effective_from) <= Date.now())
    chosen = snaps[0];
  return chosen ? chosen.roster : managerPicks(mgrId);
}

// "starter" / "sub" / "team" for a roster entry, or null.
function slotLabel(entry) {
  if (!entry) return null;
  if (entry.position === "TEAM" || entry.slot === "TEAM") return "team";
  return entry.is_sub ? "sub" : "starter";
}

// The player's roster entry in one manager's locked lineup for a match.
function entryForManagerAt(mgrId, pid, label) {
  return rosterAtFor(mgrId, matchTimeFor(label), labelDate(label), null,
    roundKeyOfLabel(label)).find((e) => e.player_id === pid) || null;
}

// Which manager (if any) had the player in their locked roster for a match,
// and their entry. Picks are unique per league, so at most one matches.
function ownerEntryAt(pid, label) {
  const t = matchTimeFor(label), d = labelDate(label), key = roundKeyOfLabel(label);
  const byMgr = snapshotsByManager();
  for (const m of S.managers) {
    const e = rosterAtFor(m.id, t, d, byMgr[m.id] || [], key).find((x) => x.player_id === pid);
    if (e) return { manager: m, entry: e };
  }
  return null;
}

// All match labels a team has played that we have stats for, newest first.
function teamMatchLabels(team) {
  const labels = new Set();
  for (const r of S.stats || [])
    if (labelTeams(r.match_label).includes(team)) labels.add(r.match_label);
  return [...labels].sort((a, b) =>
    String(labelDate(b)).localeCompare(String(labelDate(a))));
}

// Stats grouped by player, plus which teams played each date — both derived
// purely from S.stats and shared by computeScores/managerHistory/
// computeYetToPlay. Memoized on the S.stats array identity, which is
// replaced wholesale on every refetch, so one render pass builds it once.
let _statsDerived = null, _statsDerivedFor = null;
function statsDerived() {
  if (_statsDerivedFor === S.stats) return _statsDerived;
  const byPlayer = {}, playedByDate = {}, teamLabels = {}, recRound = {};
  for (const r of S.stats || []) {
    (byPlayer[r.player_id] ||= []).push(r);
    // The round RECORDED on the row when it was written (Phase 0 of
    // ROUNDS_DESIGN.md). Authoritative wherever present: it says what week the
    // match belonged to at the time, which no later reschedule can change.
    const rr = Number(r.round);
    if (rr >= 1 && !recRound[r.match_label]) recRound[r.match_label] = rr;
    const d = labelDate(r.match_label);
    if (d) for (const t of labelTeams(r.match_label)) {
      (playedByDate[d] ||= new Set()).add(t);
      (teamLabels[t] ||= new Set()).add(r.match_label);
    }
  }
  // Each team's matches in date order -> the "round" index (its 1st, 2nd, …
  // game). Sub activation aligns a sub's k-th game with the starter's k-th
  // game, so a sub covers a no-show starter in the same round of fixtures even
  // when the two play on different calendar days.
  const teamMatches = {};
  for (const t in teamLabels) {
    teamMatches[t] = [...teamLabels[t]].sort((a, b) =>
      String(labelDate(a)).localeCompare(String(labelDate(b))));
  }
  _statsDerivedFor = S.stats;
  _statsDerived = { byPlayer, playedByDate, teamMatches, recRound };
  return _statsDerived;
}

const FINAL_STATUS = ["FT", "AET", "PEN"];

/* The competition's OWN matchweek numbers, taken from the fixture list.

   Counting a club's fixtures only works if every club plays exactly once per
   round. Domestic leagues break that constantly: a postponed game leaves a club
   with a blank week, a rearranged midweek game gives another club a double. The
   two clubs' fixture counts then drift apart, so "round 3" means a different
   week for each of them — which silently misaligns bench cover, round buckets
   and head-to-head results. API-Football already tells us the real matchweek
   ("Regular Season - 21"), and we already store it on every fixture.

   Cups keep the count-based fallback: their round labels ("Round of 16") are
   names, not week numbers, and in a group stage everyone does play once. */
let _roundIdx = null, _roundIdxFor = null;
function roundIndex() {
  if (_roundIdxFor === S.fixtures) return _roundIdx;
  const byLabel = {}, byTeamRound = {}, finished = {}, keyByLabel = {};
  for (const f of S.fixtures || []) {
    const n = Number(mwNo(f.round));
    const d = String(f.kickoff_utc || "").slice(0, 10) || f.date;
    if (!d) continue;
    const label = `${f.home} vs ${f.away} (${d})`;
    /* The round's own label, verbatim and for EVERY competition — the Phase 1.5
       round key. Built before the numbering check below deliberately: byLabel
       and friends stay numbers-only because the blank/double-week logic they
       feed is meaningless without a matchweek number, but the KEY has to exist
       for cups too or knockout rounds stay unrecordable. */
    if (f.round != null && f.round !== "") keyByLabel[label] = String(f.round);
    if (!n) continue;
    byLabel[label] = n;
    const done = FINAL_STATUS.includes(f.status);
    for (const t of [f.home, f.away]) {
      ((byTeamRound[t] ||= {})[n] ||= []).push(label);
      if (!done) (finished[t] ||= {})[n] = false;
      else if ((finished[t] ||= {})[n] !== false) finished[t][n] = true;
    }
  }
  _roundIdxFor = S.fixtures;
  return (_roundIdx = { byLabel, byTeamRound, finished, keyByLabel });
}

// The round key of the match behind a label, for looking up the snapshot that
// was stamped for that round. Null for a match with no fixture row (legacy
// stats, hand-entered rows) — those keep the timestamp path.
const roundKeyOfLabel = (label) => roundIndex().keyByLabel[label] || null;

/* Has this round's settlement actually run? (ROUNDS_DESIGN.md Phase 2.)

   The recorded answer, not a guess from the clock: a round is settled when a
   `rounds` row says so. Anything else -- no row, a claim still in flight, a
   league that has never run the migration -- is LIVE, which is the safe
   direction: live points are recomputed every render, so treating a settled
   round as live costs a little work and changes no number, while the reverse
   would freeze a round that is still moving.

   Matched on the key, falling back to the number for rows written before
   Phase 1.5 gave rounds a key. */
function isRoundSettled(roundKey, roundNo) {
  return (S.rounds || []).some((r) => r.status === "settled"
    && ((r.round_key != null && roundKey != null && r.round_key === roundKey)
        || (r.round_key == null && roundNo != null && r.round_no === roundNo)));
}

/* Round resolution, shared by computeScores and managerHistory (they score the
   same way and must agree — there is a test tying their totals together).

   Two things this has to survive. A mid-season TRANSFER: rewriting a pick's
   team moves the player to a club whose fixture list never contained their
   earlier matches, so lookups fall back to the player's own stat rows. And
   BLANK/DOUBLE gameweeks: see roundIndex() above. */
const _recRoundMemo = new WeakMap();
function roundResolvers(statsByPlayer, teamMatches) {
  const ri = roundIndex();
  // Matchweek numbering only where it is meaningful and actually present.
  const useMW = !isCupCompetition() && Object.keys(ri.byLabel).length > 0;
  const roundOf = (team, label) => (teamMatches[team] || []).indexOf(label);
  const appearedIn = (pid, label) =>
    (statsByPlayer[pid] || []).some((r) => r.appeared && r.match_label === label);
  /* The round RECORDED on the rows themselves, stamped by whichever puller
     wrote them (ROUNDS_DESIGN.md, Phase 0). Built from statsByPlayer rather
     than read from statsDerived() so this stays a pure function of its inputs;
     memoized because statsDerived's output is identity-stable per S.stats. */
  let rec = _recRoundMemo.get(statsByPlayer);
  if (!rec) {
    rec = { no: {}, key: {} };
    for (const pid in statsByPlayer)
      for (const r of statsByPlayer[pid]) {
        const rr = Number(r.round);
        if (rr >= 1 && !rec.no[r.match_label]) rec.no[r.match_label] = rr;
        // The round KEY recorded on the row. Present for every competition,
        // where `round` above is null for the whole knockout stage.
        if (r.round_key && !rec.key[r.match_label]) rec.key[r.match_label] = String(r.round_key);
      }
    _recRoundMemo.set(statsByPlayer, rec);
  }
  const recRound = rec.no;
  /* Which round a match belongs to, as a KEY, preferring what the writer
     recorded on the row over anything derived from today's fixture list. This
     is what lets settled scoring be a pure read: the row says which round it
     was, so no reschedule can move it and no fixture list is needed. */
  const roundKeyOf = (label) => rec.key[label] || roundIndex().keyByLabel[label] || null;
  /* Preference order, everywhere a round is resolved:
       1. recorded on the row  — what the week WAS when the match was played;
                                 no later reschedule or transfer can move it
       2. the fixture list     — for matches with no stats yet (league mode)
       3. counting club games  — cups and legacy data
     The fallbacks are load-bearing for old rows and the World Cup pool; they
     are scheduled for review in Phase 2, not deletion here. */
  const roundByLabel = (label) =>
    recRound[label]
    || (useMW && ri.byLabel[label])
    || roundOf(labelTeams(label)[0], label) + 1;
  const playerRoundLabel = (pid, rnd) => {
    for (const r of (statsByPlayer[pid] || []))
      if (r.appeared && roundByLabel(r.match_label) === rnd) return r.match_label;
    return null;
  };
  /* Which club a player was at in a given round, read off the club stamped on
     their stat rows (match_stats.team). A pick only carries the club the player
     is at NOW, so after a transfer it cannot describe their earlier rounds.
     Reading it from the rows also covers a round the player MISSED: their rows
     either side of the gap place them, which appearance-inference alone cannot
     do. Falls back to the pick's club when the column is absent (unapplied
     migration, or rows pulled before it existed). */
  const _clubs = new Map();
  const clubHistory = (pid) => {
    let h = _clubs.get(pid);
    if (h) return h;
    h = [];
    for (const r of (statsByPlayer[pid] || []))
      if (r.team) h.push([roundByLabel(r.match_label), r.team]);
    h.sort((a, b) => a[0] - b[0]);
    _clubs.set(pid, h);
    return h;
  };
  const clubAtRound = (pid, rnd) => {
    const h = clubHistory(pid);
    if (!h.length) return null;
    let team = h[0][1];                       // before the first row: earliest known
    for (const [r, t] of h) { if (r > rnd) break; team = t; }
    return team;
  };
  const clubOf = (entry, rnd) => clubAtRound(entry.player_id, rnd) || entry.team;
  // A club's fixtures in a given matchweek: none = a genuine blank week.
  const clubLabels = (team, rnd) => (useMW && ri.byTeamRound[team]?.[rnd]) || [];
  // The match this pick played in round `rnd`. null means "no match", which for
  // a blank gameweek is the truth and is what lets the bench come on.
  const labelForRound = (entry, rnd) => {
    if (useMW) {
      const labels = clubLabels(clubOf(entry, rnd), rnd);
      const own = labels.find((l) => appearedIn(entry.player_id, l));
      // A transferred player's earlier match sits under their old club.
      return own || playerRoundLabel(entry.player_id, rnd) || labels[0] || null;
    }
    const lbl = (teamMatches[entry.team] || [])[rnd - 1];
    if (lbl && appearedIn(entry.player_id, lbl)) return lbl;
    return playerRoundLabel(entry.player_id, rnd) || lbl || null;
  };
  /* Did this starter fail to turn out in round `rnd`, so the bench should cover?
     True for a blank gameweek (no fixture at all) as well as a plain no-show.
     A fixture that simply has not kicked off yet is NOT a no-show — otherwise a
     sub would activate mid-week and then flip back once the game lands. */
  const missedRound = (entry, rnd) => {
    if (useMW) {
      if (playerRoundLabel(entry.player_id, rnd)) return false;
      const club = clubOf(entry, rnd);
      const labels = clubLabels(club, rnd);
      if (!labels.length) return true;                       // blank gameweek
      if (labels.some((l) => appearedIn(entry.player_id, l))) return false;
      return ri.finished[club]?.[rnd] === true;               // played, absent
    }
    const lbl = labelForRound(entry, rnd);
    return !!lbl && !appearedIn(entry.player_id, lbl);
  };
  // The 1-based round a pick's match belongs to, falling back to the label's
  // own round when the pick has since moved club.
  const entryRound = (entry, label) => {
    if (recRound[label]) return recRound[label];   // recorded wins in any mode
    if (useMW) return roundByLabel(label);
    const r = roundOf(entry.team, label);
    return r >= 0 ? r + 1 : roundByLabel(label);
  };
  return { roundOf, appearedIn, roundByLabel, labelForRound, missedRound, entryRound,
           roundKeyOf };
}

function computeScores() {
  const { byPlayer: statsByPlayer, teamMatches } = statsDerived();
  // A starter's k-th match (same round as the sub's match), and whether the
  // starter actually featured in it.
  const { roundOf, appearedIn, roundByLabel, labelForRound, missedRound, entryRound,
          roundKeyOf } = roundResolvers(statsByPlayer, teamMatches);

  // Each match is scored against the roster locked before its kickoff.
  // Kickoff times come from fixtures.json; for matches we can't find
  // there, end-of-day is assumed, which reproduces the older per-date
  // behavior. This is what keeps a same-day trade honest: a player
  // traded in between a morning and an evening game only earns their
  // new manager points for the evening one.
  const kickoffs = {};
  for (const f of S.fixtures || []) {
    const d = String(f.kickoff_utc || "").slice(0, 10);
    if (d) kickoffs[`${f.home} vs ${f.away} (${d})`] = Date.parse(f.kickoff_utc);
  }
  const matchTime = (label) =>
    kickoffs[label] ?? Date.parse(labelDate(label) + "T23:59:59Z");

  const statLabels = [...new Set(S.stats.map((r) => r.match_label))]
    .filter((l) => labelDate(l))
    .sort((a, b) => String(labelDate(a)).localeCompare(String(labelDate(b))));

  // Snapshots per manager, oldest first; rosterAtFor(t) is the lineup that
  // was locked in at or before epoch-ms t (see the shared helper above).
  const snapsByMgr = snapshotsByManager();

  return S.managers.map((m) => {
    // Removed managers: player points frozen at removal, but their kept TEAM
    // pick keeps scoring live as the country advances.
    if (m.eliminated) {
      const tb = managerTeamBonus(m.id);
      const items = tb ? [{ pick: tb.pick, pts: tb.pts, note: stageOf(tb.pick.team) }] : [];
      // A removed manager's player points are frozen by definition — that is
      // settled in the plainest sense. Their TEAM pick is still live.
      return { manager: m, total: (m.frozen_points || 0) + (tb ? tb.pts : 0),
               teamPts: (tb ? tb.pts : 0), items, eliminated: true,
               settledTotal: (m.frozen_points || 0), liveTotal: 0 };
    }
    let total = 0;
    const earnedByPlayer = {};
    const roundPts = {};   // labelRound -> player-match points that round
    // Flex mode resolves each round's counting players through the auto-sub
    // engine (bench promoted in order, formation kept valid), cached per round.
    const flex = isFlexFormation();
    const flexCache = {};
    const flexCountForRound = (rnd, roster) => flexCache[rnd] ||
      (flexCache[rnd] = flexRoundCounting(roster, rnd, labelForRound, appearedIn));
    const fixedCap = !flex && maxSubsCapped();   // fixed mode with a sub cap set
    const fixedCache = {};
    const fixedSubsForRound = (rnd, roster) => fixedCache[rnd] ||
      (fixedCache[rnd] = fixedRoundSubs(roster, rnd, labelForRound, appearedIn, maxSubsPerRound(), missedRound));
    const captain = captainEnabled();
    const capByRnd = {}, viceByRnd = {}, playedByRnd = {}, ptsByRnd = {};
    const rndKey = {};                 // round number -> its recorded round key
    for (const label of statLabels) {
      const d = labelDate(label);
      const rnd = roundByLabel(label);   // 1-based round (real matchweek)
      const rKey = roundKeyOf(label);   // recorded on the row first, fixtures second
      if (rnd >= 1 && rndKey[rnd] === undefined) rndKey[rnd] = rKey;
      const roster = rosterAtFor(m.id, matchTime(label), d, snapsByMgr[m.id] || [], rKey);
      const starters = roster.filter((e) => !e.is_sub && e.position !== "TEAM");
      if (captain) {   // snapshot-locked captain, else the manager's current pick
        capByRnd[rnd] = roster.find((e) => e.is_captain)?.player_id ?? m.captain_id ?? capByRnd[rnd];
        viceByRnd[rnd] = roster.find((e) => e.is_vice)?.player_id ?? m.vice_id ?? viceByRnd[rnd];
      }
      for (const entry of roster) {
        if (entry.position === "TEAM") continue;
        const rows = (statsByPlayer[entry.player_id] || [])
          .filter((r) => r.match_label === label);
        if (!rows.length) continue;
        const scored = rows.reduce((s2, r) => s2 + calcPlayerPoints(r, entry.position), 0);
        let pts = 0;
        if (flex) {
          // Counts if the auto-sub engine keeps this player in for their round.
          if (flexCountForRound(entryRound(entry, label), roster).has(entry.player_id))
            pts = scored;
        } else if (!entry.is_sub) {
          pts = scored;
        } else if (fixedCap) {
          // Fixed mode with a sub cap: capped same-position cover, round-level.
          if (fixedSubsForRound(entryRound(entry, label), roster).has(entry.player_id))
            pts = scored;
        } else {
          // Fixed mode: a sub scores its round-k match only if a same-position
          // starter's team also played round-k but the starter didn't feature.
          const r = entryRound(entry, label);
          const mates = starters.filter((st) => st.position === entry.position);
          const activated = r >= 1 && mates.some((st) => {
            return missedRound(st, r);
          });
          if (activated) pts = scored;
        }
        earnedByPlayer[entry.player_id] = (earnedByPlayer[entry.player_id] || 0) + pts;
        if (rnd >= 1) roundPts[rnd] = (roundPts[rnd] || 0) + pts;
        if (captain) {
          if (rows.some((r) => r.appeared)) (playedByRnd[rnd] ||= new Set()).add(entry.player_id);
          (ptsByRnd[rnd] ||= {})[entry.player_id] = (ptsByRnd[rnd][entry.player_id] || 0) + pts;
        }
        total += pts;
      }
    }
    // Captain (or vice, if the captain didn't play) doubles their round points.
    if (captain) for (const rnd of Object.keys(ptsByRnd)) {
      const cap = capByRnd[rnd], vice = viceByRnd[rnd];
      const eff = (cap && playedByRnd[rnd]?.has(cap)) ? cap : vice;
      const bonus = eff ? (ptsByRnd[rnd][eff] || 0) : 0;
      if (!bonus) continue;
      total += bonus;
      roundPts[rnd] = (roundPts[rnd] || 0) + bonus;
      earnedByPlayer[eff] = (earnedByPlayer[eff] || 0) + bonus;
    }

    /* Phase 2: the same points, split by whether their round's settlement has
       been RECORDED. Nothing here changes a total -- settled + live is the
       whole player score by construction, which is the property the tests pin.
       What it buys is a boundary: everything in `settled` is finished, and a
       later step can read it straight from the recorded rounds instead of
       recomputing it from stats and snapshots on every render.

       Points from a label with no resolvable round (rnd < 1: legacy rows, a
       hand-entered match with no fixture) stay live -- they are never inside a
       settled round, so they are never frozen. TEAM points below are live for
       a real reason rather than a technical one: a country's stage bonus keeps
       moving as the tournament advances, long after any matchweek is done. */
    const playerTotal = total;
    let settledTotal = 0;
    for (const rnd of Object.keys(roundPts))
      if (isRoundSettled(rndKey[rnd], Number(rnd))) settledTotal += roundPts[rnd];
    const liveTotal = playerTotal - settledTotal;

    const mPicks = managerPicks(m.id).sort((a, b) =>
      (SLOT_RANK[a.slot] ?? 9) - (SLOT_RANK[b.slot] ?? 9) || a.pick_number - b.pick_number);
    const items = mPicks.map((pk) => {
      if (pk.slot === "TEAM") {
        const stage = stageOf(pk.team);
        const pts = calcTeamPoints(stage);
        total += pts;
        return { pick: pk, pts, note: stage };
      }
      const pts = earnedByPlayer[pk.player_id] || 0;
      delete earnedByPlayer[pk.player_id];
      return { pick: pk, pts, note: pk.is_sub ? "sub" : "" };
    });
    // Points earned by players since traded away or swapped out stay banked.
    const formerPts = Object.values(earnedByPlayer).reduce((a, b) => a + b, 0);
    if (formerPts) items.push({
      pick: { slot: "—", player_name: "Former players (traded out)",
              player_id: "__former__", position: "", team: "" },
      pts: formerPts, note: "",
    });
    // Final phase: champion prediction pays out once the winner is set.
    if (m.final_pick) {
      const champion = S.stages.find((s) => s.stage === "winner")?.team;
      const pts = champion === m.final_pick ? finalPickBonus() : 0;
      total += pts;
      items.push({
        pick: { slot: "WIN", player_name: `Champion pick: ${m.final_pick}`,
                player_id: "__final__", position: "", team: m.final_pick },
        pts, note: champion ? (pts ? "correct" : champion + " won") : "pending",
      });
    }
    // National-team stage bonuses + champion-pick payout, so the table can show
    // a "player points only" view (total − teamPts).
    const teamPts = items.filter((it) => it.pick.slot === "TEAM" || it.pick.slot === "WIN")
      .reduce((s, it) => s + it.pts, 0);
    return { manager: m, total, items, roundPts, teamPts, settledTotal, liveTotal };
  });
}

// "15 Jun" / "15–18 Jun" / "28 Jun – 2 Jul" from sorted YYYY-MM-DD dates.
function fmtDateRange(dates) {
  if (!dates.length) return "";
  const D = (d) => new Date(d + "T12:00:00Z");
  const fmt = (d) => D(d).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", timeZone: "UTC" });
  const a = dates[0], b = dates[dates.length - 1];
  if (a === b) return fmt(a);
  return D(a).getUTCMonth() === D(b).getUTCMonth()
    ? D(a).getUTCDate() + "–" + fmt(b) : fmt(a) + " – " + fmt(b);
}

// Points decomposition for the history pager. Shares the exact snapshot
// selection + sub-activation rules as computeScores, so the current-view
// total ties out to the leaderboard. Returns the current view (current
// players' credited-for-you points + itemised former players + TEAM/champion
// bonuses) and one "Round N" breakdown per non-empty lock period.
function managerHistory(mgrId) {
  const mgr = S.managers.find((m) => m.id === mgrId);
  const elimAt = mgr?.eliminated_at ? Date.parse(mgr.eliminated_at) : null;

  const { byPlayer: statsByPlayer, teamMatches } = statsDerived();
  const { roundOf, appearedIn, roundByLabel, labelForRound, missedRound, entryRound } =
    roundResolvers(statsByPlayer, teamMatches);
  const statLabels = [...new Set(S.stats.map((r) => r.match_label))].filter((l) => labelDate(l));

  const snaps = snapshotsByManager()[mgrId] || [];
  const snapIndexAt = (t, d) => {
    let idx = -1;
    for (let i = 0; i < snaps.length; i++) {
      if (Date.parse(snaps[i].effective_from) <= t) idx = i; else break;
    }
    if (idx === -1) for (let i = 0; i < snaps.length; i++) {
      if (String(snaps[i].effective_from).slice(0, 10) <= d) idx = i; else break;
    }
    // Same rule as rosterAtFor: a snapshot still in the future is a plan, not a
    // record, so it is never used to describe an earlier round.
    if (idx === -1 && snaps.length && Date.parse(snaps[0].effective_from) <= Date.now())
      idx = 0;
    return idx;
  };
  const flex = isFlexFormation();
  const matchPoints = (roster, label) => {
    const starters = roster.filter((e) => !e.is_sub && e.position !== "TEAM");
    const out = {};
    for (const entry of roster) {
      if (entry.position === "TEAM") continue;
      const rows = (statsByPlayer[entry.player_id] || []).filter((r) => r.match_label === label);
      if (!rows.length) continue;
      const scored = rows.reduce((s2, r) => s2 + calcPlayerPoints(r, entry.position), 0);
      let pts = 0;
      if (flex) {
        if (flexRoundCounting(roster, entryRound(entry, label), labelForRound, appearedIn)
            .has(entry.player_id)) pts = scored;
      } else if (!entry.is_sub) {
        pts = scored;
      } else if (maxSubsCapped()) {
        if (fixedRoundSubs(roster, entryRound(entry, label), labelForRound, appearedIn, maxSubsPerRound(), missedRound)
            .has(entry.player_id)) pts = scored;
      } else {
        const r = entryRound(entry, label);
        const mates = starters.filter((st) => st.position === entry.position);
        if (r >= 1 && mates.some((st) => {
          return missedRound(st, r);
        }))
          pts = scored;
      }
      out[entry.player_id] = (out[entry.player_id] || 0) + pts;
    }
    return out;
  };

  /* History is grouped by MATCHWEEK, not by snapshot.

     It used to be one entry per snapshot, which worked only because a snapshot
     was written for everyone at every lineup lock. Line-ups are now stamped
     when they CHANGE, so a manager who set their XI once had a single snapshot
     -- and therefore a single round in the pager, however many weeks had been
     played. Rounds are a property of the competition, not of how often someone
     edited their team. */
  const earnedByPlayer = {};
  const periodPts = {}, periodDates = {}, periodRoster = {};
  for (const label of statLabels) {
    const t = matchTimeFor(label), d = labelDate(label);
    if (elimAt && t > elimAt) continue;        // stop crediting after elimination
    const idx = snapIndexAt(t, d);
    const roster = idx >= 0 ? snaps[idx].roster : managerPicks(mgrId);
    const rnd = roundByLabel(label);
    /* The LAST roster used in the round: a trade mid-week means more than one
       was in force, and the one you finished with is the one to show.

       A round is recorded here because the LEAGUE played it, not because this
       manager's players featured in it. periodDates used to be filled inside
       the scoring loop below, so a manager whose whole squad had a blank week
       got no round entry at all — no pager, no zero-point round, just "season
       to date" while everyone else advanced. Same shape as the history-pager
       bug in ROUNDS_DESIGN.md: the set of rounds was re-derived from one
       manager's scoring activity instead of from what the league played. */
    if (rnd >= 1) {
      periodRoster[rnd] = roster;
      (periodDates[rnd] ||= new Set()).add(d);
    }
    const mp = matchPoints(roster, label);
    for (const pid in mp) {
      earnedByPlayer[pid] = (earnedByPlayer[pid] || 0) + mp[pid];
      if (rnd >= 1)
        (periodPts[rnd] ||= {})[pid] = ((periodPts[rnd] || {})[pid] || 0) + mp[pid];
    }
  }

  // Current view: live roster (credited-for-you) + TEAM/champion + former.
  const picks = managerPicks(mgrId);
  const pickIds = new Set(picks.map((pk) => pk.player_id));
  // Current round = the furthest round anyone has stats for (each team's Nth
  // match). Its per-player points and appearances feed the home round toggle
  // and the "played this round" highlight; credited to the live roster.
  const roundOfLabel = (l) => roundByLabel(l);
  const curRound = statLabels.reduce((m, l) => Math.max(m, roundOfLabel(l)), 0);
  const curRoundLabels = statLabels.filter((l) => roundOfLabel(l) === curRound);
  const roundByPlayer = {};
  const playedRoundSet = new Set();
  for (const label of curRoundLabels) {
    const mp = matchPoints(picks, label);
    for (const pid in mp) roundByPlayer[pid] = (roundByPlayer[pid] || 0) + mp[pid];
    for (const pk of picks) if (appearedIn(pk.player_id, label)) playedRoundSet.add(pk.player_id);
  }
  // "played in this snapshot" = has stats since the most recent lineup lock.
  const snapshotStart = snaps.length ? Date.parse(snaps[snaps.length - 1].effective_from) : 0;
  const nowMs = Date.now();
  const items = picks.map((pk) => ({
    entry: pk,
    pts: pk.slot === "TEAM" ? calcTeamPoints(stageOf(pk.team)) : (earnedByPlayer[pk.player_id] || 0),
    roundPts: pk.slot === "TEAM" ? null : (roundByPlayer[pk.player_id] || 0),
    playedRound: pk.position !== "TEAM" && playedRoundSet.has(pk.player_id),
    played: snaps.length > 0 && pk.position !== "TEAM"
      && (statsByPlayer[pk.player_id] || []).some(r => {
        const t = matchTimeFor(r.match_label);
        return t >= snapshotStart && t <= nowMs;
      }),
  }));
  let finalBonus = 0;
  if (mgr?.final_pick) {
    const champion = S.stages.find((s) => s.stage === "winner")?.team;
    finalBonus = champion === mgr.final_pick ? finalPickBonus() : 0;
    items.push({ entry: { player_id: "__final__", player_name: `Champion: ${mgr.final_pick}`,
      position: "", team: mgr.final_pick, slot: "WIN" }, pts: finalBonus, special: true });
  }
  const former = Object.keys(earnedByPlayer)
    .filter((pid) => !pickIds.has(pid))
    .map((pid) => {
      const p = S.playerById[pid] || { player_id: pid, name: pid, position: "", team: "" };
      return { entry: { player_id: pid, player_name: p.name, position: p.position,
        team: p.team, slot: "—", is_sub: false }, pts: earnedByPlayer[pid],
        roundPts: roundByPlayer[pid] || 0 };
    })
    .filter((f) => f.pts).sort((a, b) => b.pts - a.pts);
  const computedTotal = items.reduce((s, i) => s + i.pts, 0)
    + former.reduce((s, f) => s + f.pts, 0);

  // One entry per matchweek that has results, oldest first, showing the squad
  // that was in force for it.
  const rounds = Object.keys(periodDates).map(Number).sort((a, b) => a - b)
    .map((rnd) => {
      const pts = periodPts[rnd] || {};
      const shown = periodRoster[rnd] || [];
      const have = new Set(shown.map((e) => e.player_id));
      const roundItems = shown.map((e) => ({
        entry: e, pts: e.position === "TEAM" ? null : (pts[e.player_id] || 0),
      }));
      /* Anyone who scored this round but is not in the roster we are showing --
         traded away mid-week, or replaced at a waiver close. Without them the
         round's subtotal would silently disagree with the points actually
         banked, which is the sort of gap nobody can explain later. */
      for (const pid of Object.keys(pts)) {
        if (have.has(pid) || !pts[pid]) continue;
        const pl = S.playerById[pid] || { name: pid, position: "", team: "" };
        roundItems.push({ entry: { player_id: pid, player_name: pl.name,
          position: pl.position, team: pl.team, slot: "—", is_sub: false }, pts: pts[pid] });
      }
      return { n: rnd, dates: [...periodDates[rnd]].sort(), items: roundItems,
        subtotal: roundItems.reduce((s, it) => s + (it.pts || 0), 0) };
    });

  return {
    eliminated: !!mgr?.eliminated,
    total: mgr?.eliminated
      ? (mgr.frozen_points || 0) + (managerTeamBonus(mgrId)?.pts || 0)
      : computedTotal,
    curRound,
    current: { items, former }, rounds,
  };
}

// Shared rules content: scoring per position + stage bonuses + sub rule.
// Built live from the league's scoring config (or the defaults) so it can't drift.
// Human-readable value for one scoring rule (per-position or flat, + formula).
function ruleValueText(rule) {
  const pts = rule.perPosition
    ? GROUPS.slice(0, 4).map((g) => `${g} ${rule.points?.[g] ?? 0}`).join(" / ")
    : `${rule.points ?? 0}`;
  const mins = rule.minMinutes ? ` (≥${rule.minMinutes}′)` : "";
  if (rule.mode === "per") return `${pts} per ${rule.per}${mins}`;
  if (rule.mode === "threshold") return `${pts} if ≥ ${rule.gte}${mins}`;
  return `${pts}${mins}`;
}

// The rules footer under the board, generated from THIS league's config so the
// app can never describe scoring it isn't actually using. (It used to be static
// World Cup text, which was simply wrong for any custom league.)
function boardRulesNote() {
  const bits = [];
  const cap = maxSubsPerRound();
  if (cap > 0) bits.push(isFlexFormation()
    ? `Bench players come up to cover no-shows as long as the resulting formation stays legal (up to ${cap} per round).`
    : `A sub scores only in a round where a starter in their position didn't feature${
        maxSubsCapped() ? ` (up to ${cap} per round)` : ""}.`);
  if (captainEnabled())
    bits.push("Your captain scores double each round — or the vice-captain if the captain doesn't play at all.");
  if ((posQuota().TEAM || 0) > 0) {
    const stages = stageOrder().slice(1).map((s) => `${s.toUpperCase()} +${stageBonuses()[s]}`).join(", ");
    bits.push(`TEAM picks earn cumulative stage bonuses (${stages}) and carry through redrafts; in the final phase, surviving managers call the champion for +${finalPickBonus()}.`);
  }
  if (h2hEnabled()) bits.push("Standings are a head-to-head log — you play one rival each round.");
  if (faDeferToClose()) bits.push("Free-agent claims queue and resolve at window close, in waiver order.");
  return bits.join(" ");
}

function scoringHtml() {
  const rows = scoringRules().map((r) => [STAT_LABEL[r.stat] || r.stat, ruleValueText(r)])
    .concat([["Champion pick (final phase only)", `+${finalPickBonus()}`]]);
  const stages = stageOrder().slice(1).map((s) =>
    `${s.toUpperCase()} +${stageBonuses()[s]}`).join(" · ");
  return `<div class="space-y-2 text-sm text-slate-300">
    <table class="w-full text-xs">
      <tbody>${rows.map(([k, v]) => `<tr class="border-b border-slate-800">
        <td class="py-1.5 text-slate-400">${k}</td>
        <td class="py-1.5 text-right font-mono">${v}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="text-xs"><b>National TEAM pick:</b> cumulative bonus per stage reached —
      ${stages} (a champion banks ${calcTeamPoints("winner")} in total).</p>
    <p class="text-xs"><b>Subs:</b> a sub only scores in a round where a starter in their position
      played that round but didn't feature (so the sub covers a no-show starter, even if they
      play on different days). Players who don't appear score 0.</p>
    <p class="text-xs"><b>Top-rated player:</b> awarded automatically to the
      single highest-rated player in each match (by API-Football's match rating, and only if it's
      ≥ 7.5). It's a data-driven "best performer" bonus — a close proxy for, but not always the
      same as, the official Player of the Match award.</p>
    <p class="text-xs"><b>Redrafts:</b> as the tournament field narrows the admin runs redrafts
      with smaller squads — managers may keep up to an admin-set number of players (keepers fill
      squad slots and each costs your earliest draft round), TEAM picks always carry, the rest
      go back in the pool, and the order is reverse standings (last place picks first). Earlier
      points stay banked. For the final there are no squads: surviving managers just call the
      champion for +${finalPickBonus()}.</p>
  </div>`;
}

/* Scoring as a per-position matrix. What a striker earns for a goal versus
   what a keeper earns for one is the single most useful thing to know while
   building a board, and the flat "GK 10 / DEF 6 / MID 5 / FWD 4" string in the
   rules list buried it inside a sentence. */
function scoringByPositionHtml() {
  const pos = GROUPS.slice(0, 4);
  const rules = scoringRules();
  const cell = (r, g) => {
    const v = r.perPosition ? (r.points?.[g] ?? 0) : (r.points ?? 0);
    return `<td class="py-1.5 text-center font-mono ${
      v > 0 ? "text-wcgold" : v < 0 ? "text-red-400" : "text-slate-600"}">${v > 0 ? "+" : ""}${v}</td>`;
  };
  const qual = (r) => {
    const bits = [];
    if (r.mode === "per" && r.per > 1) bits.push(`per ${r.per}`);
    if (r.mode === "threshold") bits.push(`if ≥${r.gte}`);
    if (r.minMinutes) bits.push(`≥${r.minMinutes}′`);
    return bits.length ? ` <span class="text-slate-500">${bits.join(" · ")}</span>` : "";
  };
  return `<table class="w-full text-xs">
    <thead><tr class="text-slate-400">
      <th class="text-left font-normal pb-1">Scores for</th>
      ${pos.map((g) => `<th class="pb-1"><span class="pos-${g} rounded px-1.5 py-0.5">${g}</span></th>`).join("")}
    </tr></thead>
    <tbody>${rules.map((r) => `<tr class="border-t border-slate-800">
      <td class="py-1.5 pr-2 text-slate-300">${STAT_LABEL[r.stat] || r.stat}${qual(r)}</td>
      ${pos.map((g) => cell(r, g)).join("")}
    </tr>`).join("")}</tbody>
  </table>`;
}

/* The full rule book, reachable while you're building a shortlist — you can't
   rank players sensibly without knowing what they're ranked on. */
function openScoringSheet() {
  const body = $("recap-body");
  if (!body) return;
  body.innerHTML = `
    <div class="text-center">
      <div class="eyebrow">Know what you're drafting for</div>
      <div class="text-lg font-bold mt-0.5">How points are scored</div>
    </div>
    <div class="rounded-xl border border-slate-700 bg-slate-900/60 p-3 overflow-x-auto">
      ${scoringByPositionHtml()}
    </div>
    <details class="rounded-xl border border-slate-700 bg-slate-900/60">
      <summary class="px-3 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400">Squad, subs and the draft itself</summary>
      <div class="px-3 pb-3 space-y-2 text-xs text-slate-300">${draftRulesHtml()}</div>
    </details>
    <details class="rounded-xl border border-slate-700 bg-slate-900/60">
      <summary class="px-3 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400">Bonuses and the small print</summary>
      <div class="px-3 pb-3">${scoringHtml()}</div>
    </details>`;
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
}

/* The rules as a handful of one-idea cards rather than six paragraphs.
   Everyone who joins a league reads this once, on a phone, and a wall of prose
   is read by nobody — so each rule gets an icon, a three-word headline and a
   single sentence, and can be skimmed in any order. */
function draftFactCards() {
  const q = posQuota(), sq = starterQuota();
  const flex = isFlexFormation();
  const fb = flex ? formationBounds() : null;
  const secs = S.league?.pick_duration_seconds;
  const cards = [];

  /* Say how the order was decided, and — once it exists — who actually picks
     first, because "snake" alone never answered the question people ask. */
  const manualOrder = draftOrderMode() === "manual";
  const placed = draftOrderManagers().filter((m) => m.draft_position);
  const started = (S.league?.current_pick || 0) > 0;
  const orderLine = placed.length >= 2
    ? ` ${started ? "Order" : "As it stands"}: ${placed.slice(0, 3).map((m) => m.name).join(" → ")}${placed.length > 3 ? " → …" : ""}.`
    : manualOrder
      ? " The admin arranges the order in the lobby before the draft starts."
      : " Positions are drawn at random when the draft starts.";
  cards.push(["🐍", manualOrder ? "Snake order · set by the admin" : "Snake order · drawn at random",
    `${picksPerManager()} rounds, and the order reverses every round — last pick in round one picks first in round two.${orderLine}`]);

  cards.push(["👕", "Your squad", flex
    ? `Draft any mix you like up to ${cfgOf().squadSize ?? 15} players, as long as you can field a legal XI.`
    : `Pick any position on your turn within your quota: ${
        GROUPS.filter((g) => q[g] > 0).map((g) => `${q[g]} ${g}`).join(", ")}.`]);

  cards.push(["⏱", secs ? `${secs} seconds a pick` : "No pick clock", secs
    ? "Run out and auto-pick takes the top name still available on your shortlist — which is why the order of it matters."
    : "Picks wait for you; there's no clock."]);

  const starterLine = ["GK", "DEF", "MID", "FWD"]
    .filter((g) => sq[g] > 0).map((g) => `${sq[g]} ${g}`).join(", ");
  cards.push(["⚡", "Starting XI", (flex
    ? `Each round you pick a formation within DEF ${fb.DEF[0]}–${fb.DEF[1]}, MID ${fb.MID[0]}–${fb.MID[1]}, FWD ${fb.FWD[0]}–${fb.FWD[1]} (${fb.starters}-a-side).`
    : `Name your starters (${starterLine}) before each round — everyone else is a sub.`)
    + (captainEnabled() ? " Your captain scores double, with a vice-captain who takes over if they don't play." : "")
    + (maxSubsCapped() ? ` At most ${maxSubsPerRound()} sub${maxSubsPerRound() === 1 ? "" : "s"} can come on in a round.` : "")]);

  cards.push(["🔁", "Transfer windows", autoWindowsEnabled()
    ? `Automatic: trading opens ${cfgOf().windows?.tradeOpenAfterH ?? 1}h after a matchweek ends and closes ${cfgOf().windows?.tradeCloseBeforeH ?? 24}h before the next; line-ups lock ${cfgOf().windows?.lineupLockBeforeH ?? 1}h before the first kick-off.`
    : "The admin opens and closes trading between rounds. Each matchday scores against whatever line-up was locked at the time."]);

  const faCap = maxFaPerWindow() != null
    ? ` Up to ${maxFaPerWindow()} per manager per window.` : "";
  cards.push(["🎯", "Free agents", (faDeferToClose()
    ? "Claims queue up and resolve when the window closes, in waiver order — last place gets first refusal."
    : "Swaps apply immediately: first come, first served.") + faCap]);

  if (h2hEnabled()) {
    const c = h2hConfig();
    cards.push(["🏆", "Head to head", `You play one rival each round. Win ${c.win}, draw ${c.draw}, loss ${c.loss}, plus a bonus for a big score or a narrow defeat.${
      c.rumble ? " Leftover rounds are rumbles against the whole league." : ""}`]);
  } else {
    cards.push(["🏆", "Points tally", "Every point you score counts towards the table — no fixtures, just the running total."]);
  }
  return cards;
}

function draftRulesHtml() {
  return `<div class="space-y-1.5">${draftFactCards().map(([icon, title, body]) =>
    `<div class="flex gap-2.5 rounded-lg bg-slate-800/50 px-3 py-2">
      <span class="shrink-0 text-base leading-none mt-0.5">${icon}</span>
      <span class="min-w-0">
        <span class="block text-xs font-semibold text-slate-200">${title}</span>
        <span class="block text-xs text-slate-400 leading-snug">${body}</span>
      </span>
    </div>`).join("")}</div>`;
}

/* The lobby version: the numbers you want at a glance, then the rules, then
   scoring as the per-position matrix — the same table the scouting room uses,
   because "what does a goal cost a keeper" is the question in both places. */
function lobbyRulesHtml() {
  const sq = starterQuota();
  const starters = isFlexFormation()
    ? formationBounds().starters
    : ["GK", "DEF", "MID", "FWD"].reduce((a, g) => a + (sq[g] || 0), 0) + lineupFlex();
  const secs = S.league?.pick_duration_seconds;
  // Rounds and squad size are the same number here (one pick a round), so the
  // fourth slot goes to the league size instead of saying it twice.
  const tiles = [
    [picksPerManager(), "squad"],
    [starters, "starters"],
    [S.managers.length || "—", "managers"],
    [secs ? secs + "s" : "∞", "a pick"],
  ];
  return `
    <div class="grid grid-cols-4 gap-1.5 text-center mb-3">
      ${tiles.map(([v, k]) => `<div class="rounded-lg bg-slate-800/70 py-2">
        <div class="text-lg font-bold scoreboard leading-none">${v}</div>
        <div class="eyebrow">${k}</div></div>`).join("")}
    </div>
    ${draftRulesHtml()}
    <div class="mt-3">
      <div class="eyebrow mb-1.5">Points by position</div>
      <div class="rounded-lg bg-slate-800/50 p-2.5 overflow-x-auto">${scoringByPositionHtml()}</div>
    </div>
    <details class="mt-2 rounded-lg bg-slate-800/50">
      <summary class="px-3 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400">Bonuses and the small print</summary>
      <div class="px-3 pb-3">${scoringHtml()}</div>
    </details>`;
}

// Keeper-window and final-phase prompts shown at the top of the Home tab.
function phaseCardsHtml(me) {
  if (me.eliminated) {
    const tb = managerTeamBonus(me.id);
    const elimTotal = (me.frozen_points || 0) + (tb ? tb.pts : 0);
    return `<div class="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
      You're out of the redrafts — player points frozen${
        tb ? `, but your TEAM pick (${esc(tb.pick.team)}) keeps scoring as they advance` : ""}.
      Total on the table: <b class="text-slate-200">${elimTotal} pts</b>.</div>`;
  }
  let html = "";
  if (S.league.keeper_window) {
    const maxK = S.league.keeper_max ?? 1;
    const caps = S.league.keeper_caps || null;
    const sel = new Set(me.keeper_pick_ids || []);
    const mine = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM");
    const capLine = caps ? " Position caps: " + ["GK", "DEF", "MID", "FWD"]
      .filter((g) => caps[g] !== undefined).map((g) => `${caps[g]} ${g}`).join(" · ") + "." : "";
    html += `<div class="rounded-xl border border-wcgold bg-wcred/10 p-4 space-y-2">
      <div class="font-semibold text-sm">Redraft coming up — keep up to ${maxK} player${maxK === 1 ? "" : "s"}
        <span class="float-right text-xs text-wcgold">${sel.size}/${maxK} kept</span></div>
      ${maxK === 0
        ? '<p class="text-xs text-slate-400">No keepers this redraft — everyone goes back into the pool (your TEAM pick carries automatically).</p>'
        : `<p class="text-xs text-slate-400">Keepers fill slots in the next squad's position limits,
          and each keeper costs your earliest draft round. Everyone unkept goes back into the
          pool (your TEAM pick carries automatically). Change your mind anytime until the
          redraft starts.${capLine}</p>
      <div class="grid grid-cols-2 gap-1.5 text-sm">
        ${mine.map((pk) => `<button data-keep="${pk.id}" class="rounded-lg px-2 py-1.5 text-left border ${
          sel.has(pk.id) ? "border-wcgold bg-wcred/20" : "border-slate-700 bg-slate-800/60"
        }">
          <span class="block truncate">${sel.has(pk.id) ? "⭐ " : ""}${esc(pk.player_name)}</span>
          <span class="block truncate text-xs text-slate-400">${pk.position} · ${esc(pk.team)} · ${playerPoints(pk.player_id, pk.position)}p</span>
        </button>`).join("")}
      </div>`}
    </div>`;
  }
  if (S.league.final_phase) {
    const champion = S.stages.find((s) => s.stage === "winner")?.team;
    const finalists = S.stages
      .filter((s) => ["final", "winner"].includes(s.stage)).map((s) => s.team);
    html += `<div class="rounded-xl border border-wcgold bg-wcred/10 p-4 space-y-2">
      <div class="font-semibold text-sm">The final — call the champion (+${finalPickBonus()})</div>
      ${champion
        ? `<p class="text-sm">${esc(champion)} won it. ${
            me.final_pick === champion ? `You called it — +${finalPickBonus()}!`
            : me.final_pick ? `You picked ${esc(me.final_pick)}.` : "You didn't pick."}</p>`
        : finalists.length
          ? `<div class="flex gap-2">${finalists.map((t) =>
              `<button data-final="${esc(t)}" class="flex-1 rounded-lg py-2 font-semibold border ${
                me.final_pick === t ? "border-wcgold bg-wcred/20 text-wcgold"
                                    : "border-slate-700 bg-slate-800/60"
              }">${me.final_pick === t ? "⭐ " : ""}${esc(t)}</button>`).join("")}</div>`
          : '<p class="text-xs text-slate-400">Waiting for the admin to mark the two finalists (Team stages → final).</p>'}
    </div>`;
  }
  return html;
}

// Toggle a keeper selection, enforcing the admin's max and optional
// per-position caps. The squad quota itself is validated again when the
// admin starts the redraft (it may not be entered yet while picking).
async function toggleKeeper(pickId) {
  const me = myManager();
  if (!S.league.keeper_window) return toast("Keeper picks are closed.");
  const cur = (me.keeper_pick_ids || []).filter((id) => pickById(id));
  const next = cur.filter((id) => id !== pickId);
  if (next.length === cur.length) {           // not selected yet -> add
    const pk = pickById(pickId);
    if (!pk) return;
    const maxK = S.league.keeper_max ?? 1;
    if (cur.length >= maxK)
      return toast(`You can keep at most ${maxK} player${maxK === 1 ? "" : "s"} — unselect one first.`);
    const caps = S.league.keeper_caps || null;
    const cap = caps?.[pk.position];
    if (cap !== undefined) {
      const have = cur.filter((id) => pickById(id)?.position === pk.position).length;
      if (have >= cap)
        return toast(`At most ${cap} ${pk.position} keeper${cap === 1 ? "" : "s"} this redraft.`);
    }
    next.push(pickId);
  }
  me.keeper_pick_ids = next;                       // optimistic
  queueManagerWrite(me.id, "keeper_pick_ids", next, (error) => {
    toast(error.message); scheduleRefetch();
  });
  toast(next.length === cur.length + 1
    ? "Keeper added: " + (pickById(pickId)?.player_name || "")
    : "Keeper removed: " + (pickById(pickId)?.player_name || ""));
  renderBoard();
}

async function setFinalPick(team) {
  const me = myManager();
  if (S.stages.some((s) => s.stage === "winner"))
    return toast("The winner is already decided.");
  me.final_pick = team;                            // optimistic
  queueManagerWrite(me.id, "final_pick", team, (error) => {
    toast(error.message); scheduleRefetch();
  });
  toast("Champion pick saved: " + team);
  renderBoard();
}

// One roster row in a history view. Tappable (data-hp) unless it's a
// TEAM/champion bonus line. `former` marks a banked traded-out player.
// it.played (set by managerHistory for current items) drives yellow highlight.
function lineupRowHtml(it, mgrId, former, opts = {}) {
  const { roundMode = false, curView = false, hideSub = false } = opts;
  const e = it.entry;
  const bonus = e.slot === "TEAM" || e.slot === "WIN";
  const tap = !bonus;
  const shownPts = roundMode ? it.roundPts : it.pts;
  const ptsStr = shownPts == null ? "—" : `${shownPts}p`;
  // Name goes gold only once the player has actually featured in the current
  // round (their team's latest match), not merely since the last lineup lock.
  const played = !former && !!it.playedRound;
  const inDream = curView && !former && !bonus && currentRoundDreamIds().has(e.player_id);
  const dreamBadge = inDream ? ` <span class="rounded bg-amber-400/20 text-amber-300 px-1 py-0.5 text-xs font-semibold align-middle" title="In this round's Dream XI">★ XI</span>` : "";
  const fxt = tap && !former ? fixtureText(e.team) : "";
  return `<div class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2 py-2${
      tap ? " cursor-pointer hover:bg-slate-800" : ""}"${
      tap ? ` data-hp="${esc(e.player_id)}"` : ""}>
    ${avatarHtml(e.player_id, e.team)}
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm ${played ? "text-wcgold" : ""}">${esc(e.player_name)}${dreamBadge} ${tap ? availBadges(e.player_id) : ""}</span>
      <span class="flex items-center gap-1 text-xs text-slate-400">
        ${former ? '<span class="shrink-0 text-amber-400/70">former</span>'
                 : e.is_sub && !hideSub ? '<span class="shrink-0 eyebrow">sub</span>' : ""}${
          e.kept ? '<span class="shrink-0" title="keeper">⭐</span>' : ""}
        <span class="truncate">${esc(e.team)}${fxt ? ` · ${esc(fxt)}` : ""}</span></span>
    </span>
    ${bonus ? "" : `<span class="pos-${e.position} rounded px-1.5 py-0.5 text-xs font-semibold shrink-0">${e.position}</span>`}
    <span class="shrink-0 w-10 text-right text-xs font-mono ${
      played || shownPts > 0 ? "text-wcgold" : "text-slate-400"}">${ptsStr}</span>
    ${tap ? '<span class="shrink-0 text-slate-500 text-xs">›</span>' : ""}
  </div>`;
}

/* A squad the way it actually lines up: the XI on a pitch, the bench beneath
   it in sub-priority order, and the full numeric list folded away underneath.
   The list is still the only place where every badge and points column fits,
   so it is kept — it just isn't the first thing you meet any more. */
function squadBoardHtml(items, mgrId, opts = {}) {
  const { roundMode = false, curView = false, order = [] } = opts;
  const mgr = S.managers.find((m) => m.id === mgrId);
  const isPlayer = (it) => it.entry.position && it.entry.position !== "TEAM"
    && it.entry.slot !== "WIN" && it.entry.slot !== "—";
  const play = items.filter(isPlayer);
  const bonus = items.filter((it) => !isPlayer(it));
  const ptsOf = (it) => (roundMode ? it.roundPts : it.pts);
  const anyPts = play.some((it) => (ptsOf(it) || 0) > 0);

  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const it of play) {
    const e = it.entry;
    if (e.is_sub || !byPos[e.position]) continue;
    byPos[e.position].push({
      id: e.player_id, player_id: e.player_id, name: e.player_name, team: e.team,
      opp: oppShort(e.team),
      note: anyPts ? (ptsOf(it) || 0) : undefined,
      badge: !captainEnabled() ? "" : mgr?.captain_id === e.player_id ? "C"
           : mgr?.vice_id === e.player_id ? "V" : "",
    });
  }
  // Locked rounds are snapshotted in sub order already; the live view sorts by
  // the manager's saved bench_order so the pitch and the picker agree.
  const rank = new Map(order.map((id, i) => [id, i]));
  const subs = play.filter((it) => it.entry.is_sub);
  if (order.length) subs.sort((a, b) =>
    (rank.has(a.entry.id) ? rank.get(a.entry.id) : 1e6)
    - (rank.has(b.entry.id) ? rank.get(b.entry.id) : 1e6));

  const rowOpts = { roundMode, curView };
  return `
    ${pitchHtml(byPos, { tapAttr: "data-hp", crests: true })}
    ${subs.length ? `<div class="mt-2">
      <div class="flex items-baseline justify-between gap-2 mb-1">
        <span class="eyebrow">Bench · ${subs.length}</span>
        <span class="text-[11px] text-slate-400">in the order they come on</span>
      </div>
      ${dugoutHtml(subs.map((it) => ({
        player_id: it.entry.player_id, name: it.entry.player_name,
        team: it.entry.team, position: it.entry.position,
        note: anyPts ? (ptsOf(it) || 0) : undefined,
      })), { tapAttr: "data-hp" })}
    </div>` : ""}
    ${bonus.length ? `<div class="mt-2 space-y-1">${bonus.map((it) =>
      lineupRowHtml(it, mgrId, false, rowOpts)).join("")}</div>` : ""}
    <details class="mt-2">
      <summary class="cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400 py-1">
        All ${play.length} players &amp; points</summary>
      <div class="space-y-1 pt-1">${[...play].sort((a, b) =>
        (SLOT_RANK[a.entry.slot] ?? 9) - (SLOT_RANK[b.entry.slot] ?? 9))
        .map((it) => lineupRowHtml(it, mgrId, false, rowOpts)).join("")}</div>
    </details>`;
}

// The current-or-past lineup card for a manager, paged by S.histIdxByMgr
// (0 = current live roster, 1 = most recent locked round, …).
function historyViewHtml(mgrId) {
  const h = managerHistory(mgrId);
  const views = 1 + h.rounds.length;
  let idx = Math.min(S.histIdxByMgr[mgrId] || 0, views - 1);
  S.histIdxByMgr[mgrId] = idx;
  const onCurrent = idx === 0;
  const round = onCurrent ? null : h.rounds[h.rounds.length - idx];

  // Current-lineup view can toggle between cumulative and this-round points.
  const roundMode = onCurrent && !h.eliminated && S.homeScoreMode === "round";
  const hasRound = onCurrent && !h.eliminated && (h.curRound || 0) >= 1;

  let body;
  if (onCurrent && h.eliminated) {
    const teamItem = h.current.items.find((it) => it.entry.slot === "TEAM");
    body = `<p class="text-sm text-slate-400 px-1 py-2">Out of the redrafts — player points frozen${
        teamItem ? ", but your TEAM pick keeps scoring as they advance" : ""}.
      Total <b class="text-slate-200">${h.total} pts</b>.</p>`
      + (teamItem ? lineupRowHtml(teamItem, mgrId, false, { curView: false }) : "");
  } else if (onCurrent) {
    const rowOpts = { roundMode, curView: true };
    const mgr = S.managers.find((m) => m.id === mgrId);
    body = (h.current.items.length
        ? squadBoardHtml(h.current.items, mgrId,
            { ...rowOpts, order: (mgrId === myManager()?.id && S.benchDraft) || mgr?.bench_order || [] })
        : '<p class="text-sm text-slate-400 py-2">No players.</p>')
      + (h.current.former.length ? `
        <details class="mt-2" data-former="${mgrId}" ${S.formerOpen[mgrId] ? "open" : ""}>
          <summary class="cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400 py-1">
            Former players (traded out) · ${h.current.former.length} — banked, tap for games</summary>
          <div class="space-y-1 pt-1">${h.current.former.map((it) =>
            lineupRowHtml(it, mgrId, true, rowOpts)).join("")}</div>
        </details>` : "");
  } else {
    body = squadBoardHtml(round.items, mgrId, {});
  }

  const roundSubtotal = h.eliminated ? 0
    : h.current.items.reduce((s, it) => s + (it.roundPts || 0), 0)
      + h.current.former.reduce((s, it) => s + (it.roundPts || 0), 0);
  const label = onCurrent ? "Current lineup" : `Round ${round.n}`;
  // A two-line caption wrapped between the pager arrows and squeezed the title
  // it was explaining. The pitch below already says "tap a player".
  const sub = onCurrent
    ? (h.eliminated ? "" : roundMode ? `round ${h.curRound}` : "season to date")
    : fmtDateRange(round.dates);
  const subtotal = onCurrent ? (roundMode ? roundSubtotal : h.total) : round.subtotal;
  const olderOff = idx >= views - 1, newerOff = idx <= 0;
  const toggle = hasRound ? `<div class="flex gap-1 rounded-lg bg-slate-800 p-0.5 text-xs">
      <button data-scoremode="total" class="flex-1 rounded-md py-1 font-semibold ${
        !roundMode ? "bg-slate-700 text-wcgold" : "text-slate-400"}">Total</button>
      <button data-scoremode="round" class="flex-1 rounded-md py-1 font-semibold ${
        roundMode ? "bg-slate-700 text-wcgold" : "text-slate-400"}">This round</button>
    </div>` : "";
  return `<div class="space-y-2">
    <div class="flex items-center gap-1">
      <button data-hist="older" ${olderOff ? "disabled" : ""} class="px-2 py-1 rounded text-lg ${
        olderOff ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}">‹</button>
      <div class="flex-1 text-center min-w-0">
        <div class="text-sm font-semibold truncate">${label}</div>
        <div class="text-xs text-slate-400">${sub}</div>
      </div>
      <button data-hist="newer" ${newerOff ? "disabled" : ""} class="px-2 py-1 rounded text-lg ${
        newerOff ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}">›</button>
      <span class="shrink-0 w-12 text-right font-bold text-wcgold">${subtotal}</span>
    </div>
    ${onCurrent ? "" : '<button data-hist="current" class="w-full text-xs text-slate-400 underline pb-1">↩ back to current lineup</button>'}
    ${toggle}
    <div class="space-y-1">${body}</div>
  </div>`;
}

// Render a manager's history pager into element `elId` and wire its
// controls. elId is tab-specific (Home vs Table) so the same manager can
// appear in both without colliding ids; pager position is shared via
// S.histIdxByMgr keyed on the manager.
function renderHistInto(elId, mgrId, perspectiveLabel) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = historyViewHtml(mgrId);
  el.querySelectorAll("[data-hist]").forEach((b) => b.onclick = () => {
    const cur = S.histIdxByMgr[mgrId] || 0;
    S.histIdxByMgr[mgrId] = b.dataset.hist === "current" ? 0
      : b.dataset.hist === "older" ? cur + 1 : Math.max(0, cur - 1);
    renderHistInto(elId, mgrId, perspectiveLabel);
  });
  el.querySelectorAll("[data-scoremode]").forEach((b) => b.onclick = () => {
    S.homeScoreMode = b.dataset.scoremode;
    renderHistInto(elId, mgrId, perspectiveLabel);
  });
  const former = el.querySelector("[data-former]");
  if (former) former.ontoggle = () => { S.formerOpen[former.dataset.former] = former.open; };
  el.querySelectorAll("[data-hp]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.hp, mgrId, perspectiveLabel));
}

// A short form flag on the table — leagues talk about runs, so name them.
function formBadge(mgrId) {
  let rounds = (managerHistory(mgrId).rounds || []).map((r) => r.subtotal);
  // A round still being played scores near zero until the games finish, which
  // dragged everyone's recent average down and flagged most of the league as
  // cold every matchday. Form is about completed rounds only.
  const ytp = computeYetToPlay()[mgrId];
  if (ytp?.hasSnapshot && ytp.yet > 0) rounds = rounds.slice(0, -1);
  const st = managerStreaks(rounds);
  if (st.longestWinStreak >= 3 && st.currentWinStreak >= 3)
    return `<span class="shrink-0 rounded bg-orange-500/20 text-orange-300 px-1 py-0.5 font-bold" title="${st.currentWinStreak} straight rounds above the league average">🔥 ${st.currentWinStreak}</span>`;
  if (st.hot) return '<span class="shrink-0 rounded bg-orange-500/15 text-orange-300 px-1 py-0.5 font-bold" title="Last three rounds well above their season average">🔥 hot</span>';
  if (st.cold) return '<span class="shrink-0 rounded bg-sky-500/15 text-sky-300 px-1 py-0.5 font-bold" title="Last three rounds well below their season average">🧊 cold</span>';
  return "";
}

// When a manager's total changes between renders, bump the number so a live
// matchday reads as something happening rather than a static list.
let _lastTotals = null;
function bumpChangedTotals(scores, playerView) {
  const now = {};
  for (const s of scores) now[s.manager.id] = playerView ? s.total - (s.teamPts || 0) : s.total;
  const prev = _lastTotals;
  _lastTotals = now;
  if (!prev) return;
  setTimeout(() => {
    for (const id in now) {
      if (prev[id] === undefined || prev[id] === now[id]) continue;
      const el = document.querySelector(`[data-total="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.classList.remove("bumped");
      void el.offsetWidth;          // restart the animation
      el.classList.add("bumped");
    }
  }, 0);
}

/* ---------- matchday card (app side) ---------- */
const LIVE_STATUS = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT"];

// What this manager still hasn't set for the upcoming round.
function lineupTodo(me) {
  const todo = [];
  if (!me || me.eliminated) return todo;
  const mine = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM");
  if (!mine.length) return todo;
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const pk of mine) if (!pk.is_sub) counts[pk.position] = (counts[pk.position] || 0) + 1;
  if (!lineupValid(counts)) todo.push("Your starting XI isn't valid yet");
  if (captainEnabled() && !me.captain_id) todo.push("Captain not set");
  return todo;
}

// Gather the live window/clock state and hand it to the pure planner.
function matchdayNow() {
  const me = myManager();
  const auto = autoWindowsEnabled();
  const w = auto ? autoWindowState() : null;
  const live = (S.fixtures || []).some((f) => LIVE_STATUS.includes(f.status));
  // In auto mode the next window open is the start of the gap after this round.
  let tradeOpensAt = null;
  if (auto && !w.tradeOpen) {
    const H = 3600e3, after = (cfgOf().windows?.tradeOpenAfterH ?? 1) * H, now = Date.now();
    for (const wk of (w.weeks || [])) { const t = wk.last + after; if (t > now) { tradeOpensAt = t; break; } }
  }
  return matchdayPlan({
    nowMs: Date.now(),
    started: !!S.league?.current_pick,
    live,
    tradeOpen: tradingOpen(),
    lineupOpen: lineupOpen(),
    autoWindows: auto,
    lineupLockAt: w?.lineupLockAt ?? null,
    kickoffAt: w?.upcoming?.first ?? null,
    tradeOpensAt,
    tradeClosesAt: w?.tradeWindow?.closeAt ?? null,
    matchweek: w?.upcoming ? mwNo(w.upcoming.round) : null,
    todo: lineupTodo(me),
  });
}

// The card itself: stage strip, countdown, what's unset, one primary action.
/* Head-to-head: who you're playing, how it's going, and both line-ups.
   Previously the only sign of an opponent was a score bar that appeared once
   points existed — so before a round started you couldn't see who you'd drawn. */

// Your opponent in a given round; null for a bye or a non-H2H league.
function h2hOpponentFor(me, roundNo) {
  if (!h2hEnabled() || !me) return null;
  const ids = S.managers.map((m) => m.id);
  const cfg = h2hConfig();
  const plan = cfg.rumble ? h2hSchedulePlan(ids.length, cfg.rounds || roundNo, { rumble: true }) : null;
  const opts = plan && plan.valid && plan.rumble && cfg.rumble_scoring !== "placement"
    ? { rumbleFrom: plan.rumbleFrom } : {};
  const fx = h2hFixturesFor(ids, roundNo, opts).filter((f) => f.round === roundNo);
  const mine = fx.find((f) => f.home_manager_id === me.id || f.away_manager_id === me.id);
  if (!mine || !mine.away_manager_id || !mine.home_manager_id) return null;
  const oppId = mine.home_manager_id === me.id ? mine.away_manager_id : mine.home_manager_id;
  return S.managers.find((m) => m.id === oppId) || null;
}

// The round the fixture card should be about: the one in progress, else the
// first one, so a fixture is visible before any points exist.
function h2hCurrentRound() {
  const scores = h2hRoundScores();
  return Math.max(1, ...Object.values(scores).map((a) => a.length));
}

function h2hFixtureCardHtml(me) {
  if (!h2hEnabled() || !me) return "";
  const rnd = h2hCurrentRound();
  const opp = h2hOpponentFor(me, rnd);
  if (!opp) return h2hEnabled()
    ? `<div class="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400">
         Round ${rnd} · you have a bye this round.</div>` : "";
  const scores = h2hRoundScores();
  const a = scores[me.id]?.[rnd - 1], b = scores[opp.id]?.[rnd - 1];
  const live = a != null && b != null;
  const total = Math.max(1, (a || 0) + (b || 0));
  const lead = !live ? "text-slate-200" : a > b ? "text-live" : a < b ? "text-danger" : "text-slate-200";
  return `<button id="h2h-fixture" class="w-full text-left rounded-xl border border-slate-700 bg-slate-900 p-3 hover:border-slate-500">
    <div class="flex items-center justify-between gap-2">
      <span class="eyebrow">Round ${rnd} · head to head</span>
      <span class="text-xs text-wcgold">View line-ups →</span>
    </div>
    <div class="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
      <span class="min-w-0 overflow-hidden">${managerTag(me)}</span>
      <span class="font-bold scoreboard ${lead}">${live ? `${a} – ${b}` : "vs"}</span>
      <span class="min-w-0 overflow-hidden flex justify-end">${managerTag(opp)}</span>
    </div>
    ${live ? `<div class="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden flex">
      <span style="width:${(a / total) * 100}%;background:${managerColor(me)}"></span>
      <span style="width:${(b / total) * 100}%;background:${managerColor(opp)}"></span>
    </div>` : ""}
  </button>`;
}

function openH2HPreview() {
  const me = myManager();
  if (!me) return;
  const rnd = h2hCurrentRound();
  const opp = h2hOpponentFor(me, rnd);
  if (opp) openH2HFixture(rnd, me.id, opp.id);
}

/* Both line-ups on one pitch, facing, with each player's points once the round
   has been played. `botId` is the side drawn at your end — your own team when
   you're in the fixture, the home manager otherwise. */
function openH2HFixture(rnd, botId, topId) {
  const me = S.managers.find((m) => m.id === botId);
  const opp = S.managers.find((m) => m.id === topId);
  const body = $("recap-body");
  if (!me || !opp || !body) return;

  // Prefer the locked round's roster (with points); fall back to the live XI.
  const sideFor = (m) => {
    const round = (managerHistory(m.id).rounds || []).find((r) => r.n === rnd);
    const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
    const bench = [];
    let total = 0;
    const add = (e, pts) => {
      const chip = { id: e.player_id, player_id: e.player_id, name: e.player_name,
        team: e.team, opp: oppShort(e.team), note: pts };
      if (e.is_sub) bench.push({ ...chip, position: e.position, pts });
      else if (byPos[e.position]) byPos[e.position].push(chip);
    };
    if (round) {
      for (const it of round.items) {
        const e = it.entry;
        if (e.position === "TEAM") continue;
        add(e, it.pts ?? 0);
        if (!e.is_sub) total += it.pts || 0;
      }
    } else {
      // Live view: the bench is in the manager's own sub-priority order.
      for (const pk of orderedRoster(m)) {
        if (pk.slot === "TEAM") continue;
        add(pk, undefined);
      }
    }
    return { byPos, bench, total, played: !!round };
  };
  const mine = sideFor(me), theirs = sideFor(opp);
  const lead = !mine.played ? "text-slate-200"
    : mine.total > theirs.total ? "text-live"
    : mine.total < theirs.total ? "text-danger" : "text-slate-200";

  // Whose half is whose has to be readable at a glance, so each side gets a
  // name bar hard against its own end of the pitch.
  const bar = (m, s) => `<div class="flex items-center justify-between gap-2 px-0.5">
      <span class="min-w-0 text-sm truncate">${managerTag(m)}</span>
      ${s.played ? `<span class="shrink-0 font-bold text-wcgold scoreboard">${s.total}</span>` : ""}
    </div>`;
  const benchList = (m, s) => `<div class="min-w-0">
      <div class="eyebrow mb-1 truncate">${esc(m.name)}</div>
      ${s.bench.length ? dugoutHtml(s.bench, { tapAttr: "data-vsp" })
        : '<p class="text-xs text-slate-400">No bench.</p>'}
    </div>`;

  body.innerHTML = `
    <div class="text-center">
      <div class="eyebrow">Round ${rnd}</div>
      ${mine.played
        ? `<div class="text-3xl font-bold scoreboard mt-0.5 ${lead}">${mine.total} – ${theirs.total}</div>`
        : '<div class="text-xs text-slate-400 mt-0.5">Not played yet</div>'}
    </div>
    <div class="space-y-1">
      ${bar(opp, theirs)}
      ${pitchFacingHtml(theirs.byPos, mine.byPos, { small: true, tapAttr: "data-vsp", crests: true,
        topColor: managerColor(opp), botColor: managerColor(me) })}
      ${bar(me, mine)}
    </div>
    <details class="rounded-xl border border-slate-700 bg-slate-900/60">
      <summary class="px-3 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400">Benches</summary>
      <div class="space-y-2 px-3 pb-3">${benchList(opp, theirs)}${benchList(me, mine)}</div>
    </details>
    <p class="text-xs text-slate-400 text-center">${mine.played
      ? "Points shown are this round only."
      : "Line-ups lock when the window closes — these can still change."}</p>`;
  body.querySelectorAll("[data-vsp]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.vsp));
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
}

function matchdayCardHtml(me) {
  const p = matchdayNow();
  if (p.stage === "preseason" || me?.eliminated) return "";
  // Five spelled-out stage names wrapped onto two lines and drowned the thing
  // they were labelling. The current stage is named; the rest are a progress
  // track, which is all they were ever telling you.
  const here = MD_STAGES.indexOf(p.stage);
  const strip = `<span class="eyebrow text-wcgold">${MD_STAGE_LABEL[p.stage]}</span>
    <span class="flex items-center gap-1 shrink-0" aria-hidden="true">${MD_STAGES.map((s, i) =>
      `<span class="rounded-full h-1.5 ${i === here ? "w-4 bg-wcgold"
        : i < here ? "w-1.5 bg-slate-500" : "w-1.5 bg-slate-700"}"></span>`).join("")}</span>`;
  const clock = p.deadlineAt != null
    ? `<div class="mt-1">
         <div class="text-xs text-slate-400">${esc(p.deadlineLabel)}</div>
         <div id="md-countdown" data-at="${p.deadlineAt}"
              class="text-2xl font-bold text-wcgold scoreboard${
                p.deadlineAt - Date.now() < 3600e3 ? " urgent" : ""}">${fmtCountdown(p.deadlineAt - Date.now())}</div>
         <div class="text-xs text-slate-400">${esc(fmtWhen(p.deadlineAt))}</div>
       </div>` : "";
  const todo = p.todo.length
    ? `<div class="mt-2 space-y-0.5">${p.todo.map((t) =>
        `<div class="text-[12px] text-amber-300">⚠ ${esc(t)}</div>`).join("")}</div>` : "";
  const cta = p.cta
    ? `<button id="md-cta" data-act="${p.cta.act}" class="mt-3 w-full bg-wcred hover:bg-wcred-hov rounded-lg py-2.5 text-sm font-semibold">${esc(p.cta.label)}</button>`
    : "";
  return `<div class="rounded-xl border border-wcgold/60 bg-wcred/10 p-4">
    <div class="flex items-center justify-between gap-2">${strip}</div>
    <div class="mt-2 flex items-baseline justify-between gap-2">
      <div class="font-semibold">${esc(p.title)}</div>
      ${p.matchweek ? `<div class="text-xs text-slate-400 shrink-0">Matchweek ${esc(p.matchweek)}</div>` : ""}
    </div>
    ${clock}${todo}${cta}
  </div>`;
}

// Which action the matchday card is already offering, so the rest of the tab
// doesn't repeat it. Two buttons for one job read as two different jobs.
function matchdayCtaAct() {
  const p = matchdayNow();
  return (p.stage === "preseason" ? null : p.cta?.act) || null;
}

/* Pick your crest and accent. Editable at any time — before the draft, mid
   season, whenever — and the sheet stays open so you can set both without
   reopening it. Changes apply immediately and persist in the background; if
   the write fails the value is rolled back rather than silently lost. */
function renderCrestPicker() {
  const me = myManager(), body = $("recap-body");
  if (!me || !body) return;
  body.innerHTML = `
    <div class="text-center">
      <div class="eyebrow">Your identity</div>
      <div class="mt-2 inline-flex items-center gap-2">
        <span class="inline-flex items-center justify-center rounded-lg w-11 h-11 text-2xl"
              style="background:${managerColor(me)}22;border:1px solid ${managerColor(me)}88">${managerCrest(me) || "&nbsp;"}</span>
        <span class="text-xl font-bold">${esc(me.name)}</span>
      </div>
    </div>
    <div>
      <div class="eyebrow mb-1.5">Crest</div>
      <div class="grid grid-cols-6 gap-1.5">
        ${(S._crestsMore || CRESTS_MORE.includes(me.crest)
            ? [...CRESTS, ...CRESTS_MORE] : CRESTS).map((c) =>
          `<button data-crest="${c}" class="rounded-lg border py-2 text-lg ${
          me.crest === c ? "border-wcgold bg-wcgold/10" : "border-slate-700 bg-slate-800"}">${c}</button>`).join("")}
        ${S._crestsMore || CRESTS_MORE.includes(me.crest) ? "" :
          '<button id="crest-more" class="col-span-6 rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs text-slate-300">More crests ▾</button>'}
        <button data-crest="" class="col-span-6 rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs text-slate-400">No crest</button>
      </div>
    </div>
    <div>
      <div class="eyebrow mb-1.5">Colour</div>
      <div class="grid grid-cols-8 gap-1.5">
        ${MGR_COLORS.map((c) => `<button data-color="${c}" class="rounded-lg h-9 border-2 ${
          managerColor(me) === c ? "border-white" : "border-transparent"}" style="background:${c}"></button>`).join("")}
      </div>
      <button data-color="" class="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-xs text-slate-400">Use my default colour</button>
    </div>
    <p id="crest-note" class="text-xs text-slate-400 text-center min-h-[1em]"></p>`;

  const apply = (patch) => {
    Object.assign(me, patch);            // optimistic: the sheet repaints at once
    renderCrestPicker();
    renderBoard();
    for (const [field, value] of Object.entries(patch))
      queueManagerWrite(me.id, field, value, (error) => {
        const note = document.getElementById("crest-note");
        if (note) note.textContent = /crest|color|column|schema cache/.test(error.message)
          ? "Crests need a schema update — run schema.sql." : error.message;
        scheduleRefetch();               // the refetch puts the server's value back
      });
  };
  const more = document.getElementById("crest-more");
  if (more) more.onclick = () => { S._crestsMore = true; renderCrestPicker(); };
  body.querySelectorAll("[data-crest]").forEach((b) =>
    b.onclick = () => apply({ crest: b.dataset.crest || null }));
  body.querySelectorAll("[data-color]").forEach((b) =>
    b.onclick = () => apply({ color: b.dataset.color || null }));
}

function openCrestPicker() {
  if (!myManager()) return;
  renderCrestPicker();
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
}

/* ---------- squad reveal ----------
   The draft used to just stop and drop everyone on the leaderboard. This is the
   closing moment: your finished squad, how it's balanced, and a handoff into
   the season. Shown once per league. */
function openReveal() {
  const me = myManager(), body = $("reveal-body");
  if (!me || !body) return;
  const mine = managerPicks(me.id);
  const byPos = { GK: [], DEF: [], MID: [], FWD: [], TEAM: [] };
  for (const pk of mine) (byPos[pk.position] || byPos.TEAM).push(pk);
  const counts = ["DEF", "MID", "FWD"].map((g) => `${byPos[g].length}`).join("-");
  const group = (g) => byPos[g].length ? `<div>
      <div class="text-xs text-slate-400 mb-1">${g}</div>
      <div class="space-y-1">${byPos[g].map((pk) => `<div class="flex items-center gap-2">
        ${avatarHtml(pk.player_id, pk.team, "w-6 h-6")}
        <span class="min-w-0 flex-1 truncate text-sm">${esc(pk.player_name)}</span>
        <span class="shrink-0 text-xs text-slate-400">${esc(pk.team || "")}</span>
      </div>`).join("")}</div></div>` : "";
  body.innerHTML = `
    <div class="text-center">
      <div class="text-xs text-slate-400">Draft complete</div>
      <div class="text-2xl font-bold">${esc(me.name)}</div>
      <div class="text-xs text-slate-400">${mine.length} players · ${counts} outfield shape</div>
    </div>
    <div class="space-y-2.5">${["GK", "DEF", "MID", "FWD", "TEAM"].map(group).join("")}</div>
    <p class="text-xs text-slate-400 text-center">Set your starting XI before the first deadline — the matchday card on your team page counts it down.</p>`;
  $("reveal-sheet").classList.remove("hidden");
  if (S.league?.id) localStorage.setItem("wcf_reveal_" + S.league.id, "1");
}
const closeReveal = () => $("reveal-sheet")?.classList.add("hidden");

function maybeSquadReveal() {
  if (!S.league?.id || !myManager() || S._revealChecked) return;
  if (localStorage.getItem("wcf_reveal_" + S.league.id)) return;
  if (!managerPicks(myManager().id).length) return;
  /* Latch only once there was actually something to reveal. It used to latch
     on the way in, which was harmless until the board started rendering
     BEFORE the draft for the scouting room: that first render burned the
     one-shot while the squad was still empty, so the reveal never came. */
  S._revealChecked = true;
  openReveal();
}

/* ---------- transfer roundup ----------
   When a window closes, who actually moved the needle. Built from the
   transactions log plus accepted trades; ranked by transferRoundup(), which
   favours manager-to-manager deals. */
function collectMoves(sinceMs) {
  const nameOf = (id) => S.managers.find((m) => m.id === id)?.name || "?";
  const pts = (pid, pos, team) => { try { return playerPoints(pid, pos) || 0; } catch { return 0; } };
  const posOf = (pid) => S.playerById[pid]?.position || "MID";
  const moves = [];
  for (const t of S.transactions || []) {
    if (sinceMs && Date.parse(t.created_at || 0) < sinceMs) continue;
    moves.push({ kind: t.kind, manager: nameOf(t.manager_id),
      inName: t.in_player_name, outName: t.out_player_name,
      inPts: pts(t.in_player_id, posOf(t.in_player_id)),
      outPts: pts(t.out_player_id, posOf(t.out_player_id)) });
  }
  for (const t of S.trades || []) {
    if (t.status !== "accepted") continue;
    if (sinceMs && Date.parse(t.created_at || 0) < sinceMs) continue;
    for (const it of (t.trade_items || [])) {
      const inId = it.requested_player_id, outId = it.offered_player_id;
      moves.push({ kind: "trade", manager: nameOf(t.from_manager_id), with: nameOf(t.target_manager_id),
        inName: it.requested_player_name, outName: it.offered_player_name,
        inPts: pts(inId, posOf(inId)), outPts: pts(outId, posOf(outId)) });
    }
  }
  return moves;
}

function openRoundup() {
  const body = $("recap-body");
  if (!body) return;
  const top = transferRoundup(collectMoves(), 6);
  body.innerHTML = `
    <div class="text-center"><div class="eyebrow">Window closed</div>
      <div class="text-xl font-bold mt-1">Transfer roundup</div>
      <div class="text-xs text-slate-400">The moves that shifted the most points</div></div>
    ${top.length ? `<ol class="space-y-1.5">${top.map((m, i) => `
      <li class="rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-2">
        <div class="flex items-center gap-2">
          <span class="text-slate-400 font-mono text-xs w-4">${i + 1}</span>
          <span class="rounded px-1.5 py-0.5 text-xs font-bold ${m.isTrade
            ? "bg-wcgold/20 text-wcgold" : "bg-slate-700 text-slate-300"}">${m.isTrade ? "TRADE" : "FREE AGENT"}</span>
          <span class="ml-auto font-mono text-sm text-wcgold">${Math.round(m.swing)}p</span>
        </div>
        <div class="mt-1 text-sm"><b>${esc(m.manager)}</b>${m.with ? ` ↔ <b>${esc(m.with)}</b>` : ""}</div>
        <div class="text-xs text-slate-400 truncate">
          <span class="text-live">in</span> ${esc(m.inName || "?")} · <span class="text-danger">out</span> ${esc(m.outName || "?")}</div>
      </li>`).join("")}</ol>`
      : '<p class="text-sm text-slate-400 text-center py-3">Nobody moved. A quiet window.</p>'}`;
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
  if (S.league?.id) localStorage.setItem("wcf_roundup_" + S.league.id, String(windowStamp()));
}

// A stable id for the current trade window, so a roundup shows once per window.
function windowStamp() {
  const w = autoWindowsEnabled() ? autoWindowState() : null;
  return w?.tradeWindow?.closeAt ?? (S.league?.trading_open ? 0 : 1);
}
function maybeRoundup() {
  if (!S.league?.id || !myManager() || S._roundupChecked) return;
  if (tradingOpen()) return;                       // only once the window has shut
  if (!$("reveal-sheet")?.classList.contains("hidden")) return;
  if (!$("recap-sheet")?.classList.contains("hidden")) return;
  S._roundupChecked = true;
  const seen = localStorage.getItem("wcf_roundup_" + S.league.id);
  if (seen === String(windowStamp())) return;
  if (!collectMoves().length) { localStorage.setItem("wcf_roundup_" + S.league.id, String(windowStamp())); return; }
  openRoundup();
}

/* ---------- season awards ---------- */
function openAwards() {
  const body = $("recap-body");
  if (!body) return;
  const entries = S.managers.filter((m) => !m.eliminated).map((m) => {
    const h = managerHistory(m.id);
    const rounds = (h.rounds || []).map((r) => r.subtotal);
    const benchPts = (h.rounds || []).map((r) =>
      (r.items || []).filter((it) => it.entry.is_sub && it.pts != null)
        .reduce((a, it) => a + (it.pts || 0), 0));
    return { id: m.id, name: m.name, rounds, benchPts };
  });
  const awards = seasonAwards(entries);
  body.innerHTML = `
    <div class="text-center"><div class="eyebrow">Season</div>
      <div class="text-xl font-bold mt-1">🏆 Awards</div></div>
    ${awards.length ? `<div class="space-y-1.5">${awards.map((a) => `
      <div class="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-semibold text-sm">${esc(a.label)}</span>
          <span class="font-mono text-wcgold">${Math.round(a.value)}</span>
        </div>
        <div class="text-xs text-slate-400">${esc(a.manager)} · ${esc(a.note)}</div>
      </div>`).join("")}</div>`
      : '<p class="text-sm text-slate-400 text-center py-3">Not enough rounds played yet.</p>'}`;
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
}

/* ---------- round recap (app side) ---------- */

// The most recent completed round for a manager, digested.
function myRecap() {
  const me = myManager();
  if (!me) return null;
  const hist = managerHistory(me.id);
  const round = (hist.rounds || [])[hist.rounds.length - 1];
  if (!round) return null;
  // Everyone's subtotal for the same round number.
  const leagueRound = {};
  for (const m of S.managers) {
    const r = (managerHistory(m.id).rounds || []).find((x) => x.n === round.n);
    if (r) leagueRound[m.id] = r.subtotal;
  }
  // Your head-to-head opponent that round, when the league is an H2H log.
  let h2h = null;
  if (h2hEnabled()) {
    const ids = S.managers.map((m) => m.id);
    const fx = h2hFixturesFor(ids, round.n).filter((f) => f.round === round.n);
    const mine = fx.find((f) => f.home_manager_id === me.id || f.away_manager_id === me.id);
    const oppId = mine && (mine.home_manager_id === me.id ? mine.away_manager_id : mine.home_manager_id);
    if (oppId && leagueRound[oppId] != null) h2h = {
      oppName: S.managers.find((m) => m.id === oppId)?.name || "?",
      mine: leagueRound[me.id] ?? 0, theirs: leagueRound[oppId],
    };
  }
  return roundRecap(round, leagueRound, h2h);
}

// A number that represents an outcome lands better if you watch it arrive.
// Used for the round recap, which is the moment the whole week builds to.
function countUp(el, to, ms = 900) {
  if (!el) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));   // ease-out
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function openRecap() {
  const r = myRecap();
  const body = $("recap-body");
  if (!body) return;
  if (!r) { body.innerHTML = '<p class="text-sm text-slate-400">No completed rounds yet.</p>'; }
  else {
    const one = (label, val, sub) => `<div class="rounded-lg border border-slate-700 bg-slate-800/40 px-2 py-2 text-center">
      <div class="text-xs text-slate-400">${label}</div>
      <div class="text-lg font-bold text-slate-100">${val}</div>
      ${sub ? `<div class="text-xs text-slate-400">${sub}</div>` : ""}</div>`;
    const pick = (it, label) => it ? `<div class="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2 py-1.5">
      ${avatarHtml(it.entry.player_id, it.entry.team, "w-7 h-7")}
      <div class="min-w-0 flex-1">
        <div class="text-xs text-slate-400">${label}</div>
        <div class="text-sm truncate">${esc(it.entry.player_name)}</div>
      </div>
      <div class="font-mono font-bold ${(it.pts || 0) >= 0 ? "text-wcgold" : "text-red-400"}">${it.pts ?? 0}</div>
    </div>` : "";
    const res = r.result
      ? `<div class="rounded-xl border ${r.result === "W" ? "border-emerald-500/60 bg-emerald-500/10"
          : r.result === "L" ? "border-red-500/50 bg-red-500/10" : "border-slate-600 bg-slate-800/40"} p-3 text-center">
          <div class="text-xs text-slate-400">vs ${esc(r.h2h.oppName)}</div>
          <div class="text-2xl font-bold">${r.result === "W" ? "Win" : r.result === "L" ? "Loss" : "Draw"}
            <span class="font-mono text-slate-300">${r.h2h.mine}–${r.h2h.theirs}</span></div>
        </div>` : "";
    body.innerHTML = `
      <div class="text-center">
        <div class="text-xs text-slate-400">Round ${r.n} complete</div>
        <div id="recap-score" class="text-4xl font-bold text-wcgold scoreboard">0</div>
        <div class="text-xs text-slate-400">points</div>
      </div>
      ${res}
      <div class="grid grid-cols-3 gap-2">
        ${one("Rank", `${r.rank}<span class="text-xs text-slate-400">/${r.of}</span>`, "this round")}
        ${one("League avg", Math.round(r.avg), r.score >= r.avg ? "you beat it" : "below")}
        ${one("On the bench", r.benchPts, "points left")}
      </div>
      <div class="space-y-1.5">${pick(r.best, "Best pick")}${pick(r.worst, "Quietest starter")}</div>
      <button id="recap-share" class="w-full rounded-lg border border-wcgold/60 text-wcgold py-2 text-sm font-semibold">📤 Share this round</button>`;
    setTimeout(() => {
      const sb = document.getElementById("recap-share");
      if (sb) sb.onclick = () => shareRecap().catch((e) => toast(e.message));
    }, 0);
  }
  $("recap-sheet").classList.remove("hidden");
  lockScroll(true);
  if (r) countUp(document.getElementById("recap-score"), r.score);
  // Only ever auto-show a given round once.
  const r2 = r || myRecap();
  if (r2 && S.league?.id) localStorage.setItem("wcf_recap_" + S.league.id, String(r2.n));
}
const closeRecap = () => { $("recap-sheet")?.classList.add("hidden"); lockScroll(false); };

/* Draw the recap to a canvas and share it. Rendering by hand (rather than
   screenshotting the DOM) keeps it dependency-free — no third-party library,
   which also keeps the CSP intact. */
async function shareRecap() {
  const r = myRecap();
  if (!r) return;
  const W = 1080, Hh = 1080, c = document.createElement("canvas");
  c.width = W; c.height = Hh;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, Hh);
  g.addColorStop(0, "#12203a"); g.addColorStop(1, "#070B24");
  x.fillStyle = g; x.fillRect(0, 0, W, Hh);
  x.strokeStyle = "#FFC72C55"; x.lineWidth = 6; x.strokeRect(28, 28, W - 56, Hh - 56);
  const centre = (t, y, font, fill) => {
    x.font = font; x.fillStyle = fill; x.textAlign = "center"; x.fillText(t, W / 2, y);
  };
  centre((S.league?.name || "League").toUpperCase(), 150, "600 34px system-ui, sans-serif", "#94a3b8");
  centre(`ROUND ${r.n}`, 215, "700 40px system-ui, sans-serif", "#FFC72C");
  centre(String(r.score), 470, "800 220px system-ui, sans-serif", "#FFC72C");
  centre("POINTS", 530, "600 34px system-ui, sans-serif", "#94a3b8");
  if (r.h2h) {
    const res = r.result === "W" ? "WIN" : r.result === "L" ? "LOSS" : "DRAW";
    centre(`${res}  ${r.h2h.mine}–${r.h2h.theirs}  vs ${r.h2h.oppName}`, 630,
      "700 44px system-ui, sans-serif",
      r.result === "W" ? "#4FB286" : r.result === "L" ? "#E5646A" : "#cbd5e1");
  }
  centre(`Rank ${r.rank} of ${r.of} this round · league average ${Math.round(r.avg)}`,
    720, "500 32px system-ui, sans-serif", "#cbd5e1");
  if (r.best) centre(`Best pick: ${r.best.entry.player_name} (${r.best.pts})`,
    790, "600 34px system-ui, sans-serif", "#e2e8f0");
  centre(`${r.benchPts} points left on the bench`, 850, "500 30px system-ui, sans-serif", "#94a3b8");
  centre("DraftBaron", Hh - 70, "700 30px system-ui, sans-serif", "#FFC72C");

  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  if (!blob) return toast("Could not build the image.");
  const file = new File([blob], `round-${r.n}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Round ${r.n}` }); return; } catch { /* cancelled */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  URL.revokeObjectURL(a.href);
  toast("Recap image saved.");
}

// Auto-open the recap the first time a manager sees a newly completed round —
// this is the moment the whole week builds to, so it shouldn't need hunting for.
function maybeAutoRecap() {
  if (!S.league?.id || !myManager() || S._recapChecked) return;
  // The squad reveal owns the screen on draft day; don't stack a second sheet
  // on top of it — the recap will offer itself on the next render instead.
  if (!$("reveal-sheet")?.classList.contains("hidden")) return;
  const r = myRecap();
  if (!r) return;
  if (Number(localStorage.getItem("wcf_recap_" + S.league.id) || 0) >= r.n) return;
  S._recapChecked = true;      // latch only when it could actually open
  openRecap();
}

// Tick just the countdown text — a full re-render every second would fight
// with anything the user is typing or scrolling.
/* Should a deadline crossing trigger a refetch? Only the first time for a
   given deadline. This is a one-line rule with an outsized failure mode: when
   it was simply `left <= 0`, a passed deadline fired a full reload and
   re-render every second for as long as the app stayed open. Pure, so the rule
   is pinned by a test rather than by reading it carefully. */
const deadlineCrossed = (at, nowMs, lastFiredAt) =>
  at != null && nowMs >= at && lastFiredAt !== at;

let _deadlinePassed = null;
function tickMatchday() {
  const el = document.getElementById("md-countdown");
  if (!el) return;
  const at = Number(el.dataset.at);
  if (!at) return;
  const left = at - Date.now();
  el.textContent = fmtCountdown(left);
  el.classList.toggle("urgent", left > 0 && left < 3600e3);
  // Refetch ONCE as the deadline passes. This used to fire on every tick while
  // the deadline was in the past, i.e. a full reload and re-render every second
  // for as long as the app was open — which crawled, and fought the draft.
  if (deadlineCrossed(at, Date.now(), _deadlinePassed)) {
    _deadlinePassed = at;
    scheduleRefetch();
  }
}

function renderHomeTab() {
  const me = myManager();
  const box = $("board-home");
  if (!me) {
    box.innerHTML = '<p class="text-sm text-slate-400 py-4">Join as a manager to see your team here.</p>';
    return;
  }
  const scores = computeScores().sort((a, b) => b.total - a.total);
  const rank = scores.findIndex((s) => s.manager.id === me.id) + 1;
  const myScore = scores[rank - 1];
  /* Order of the tab, top to bottom: who you are, what you owe the game right
     now, who you're playing, then your actual team. Identity leads because it
     is the one thing that is always true; the deadline card is second because
     it is the only part that is ever urgent. The old order buried the crest
     below two calls to action and repeated the lineup button twice. */
  const lineupCtaShown = matchdayCtaAct() === "lineup";
  const squadHtml = `
    ${me.eliminated || lineupCtaShown ? "" : `<button id="home-lineup" class="w-full bg-slate-800 border ${lineupOpen() ? "border-wcgold/60 text-wcgold" : "border-slate-700 text-slate-400"} rounded-xl py-2.5 text-sm font-semibold">${
      lineupOpen() ? "Pick my team for the next games"
                   : (autoWindowsEnabled() ? "🔒 " + lineupLockMessage()
                                           : "🔒 Lineup locked — opens with the trading window")}</button>`}
    <div id="hist-home-${me.id}" class="rounded-xl border border-slate-700 bg-slate-900 p-3"></div>`;
  box.innerHTML = `
    <div class="rounded-xl border bg-slate-900 p-3 flex items-center gap-3"
         style="border-color:${managerColor(me)}55">
      <button id="home-crest" class="relative shrink-0" title="Edit your crest and colour">
        <span class="inline-flex items-center justify-center rounded-xl w-12 h-12 text-2xl"
              style="background:${managerColor(me)}26;border:1px solid ${managerColor(me)}99">${managerMark(me)}</span>
        <span class="absolute -bottom-1 -right-1 rounded-full bg-slate-800 border border-slate-600 text-[10px] w-4 h-4 inline-flex items-center justify-center leading-none">✎</span>
      </button>
      <div class="min-w-0 flex-1">
        <div class="text-lg font-bold truncate leading-tight">${esc(me.name)}</div>
        <div class="text-xs text-slate-400 flex items-center gap-1.5">#${rank} of ${scores.length} ${formBadge(me.id)}</div>
      </div>
      <div class="text-right shrink-0">
        <div class="text-2xl font-bold text-wcgold scoreboard leading-none">${myScore?.total ?? 0}</div>
        <div class="eyebrow">points</div>
      </div>
    </div>
    ${matchdayCardHtml(me)}
    ${h2hFixtureCardHtml(me)}
    ${phaseCardsHtml(me)}
    ${squadHtml}
    <details class="rounded-xl border border-slate-700 bg-slate-900">
      <summary class="px-4 py-3 font-semibold cursor-pointer select-none text-sm">How this league works</summary>
      <!-- The same content the lobby shows: tiles, rule cards, and scoring as a
           per-position matrix. This card had drifted to the old flat table. -->
      <div class="px-4 pb-4">${lobbyRulesHtml()}</div>
    </details>`;
  box.querySelectorAll("[data-keep]").forEach((b) => b.onclick = () =>
    toggleKeeper(b.dataset.keep).catch((e) => toast(e.message)));
  box.querySelectorAll("[data-final]").forEach((b) => b.onclick = () =>
    setFinalPick(b.dataset.final).catch((e) => toast(e.message)));
  renderHistInto("hist-home-" + me.id, me.id);   // "your lineup" perspective
  const lb = box.querySelector("#home-lineup");
  if (lb) lb.onclick = openLineup;
  const h2hBtn = box.querySelector("#h2h-fixture");
  if (h2hBtn) h2hBtn.onclick = openH2HPreview;
  const crestBtn = box.querySelector("#home-crest");
  if (crestBtn) crestBtn.onclick = openCrestPicker;
  const cta = box.querySelector("#md-cta");
  if (cta) cta.onclick = () => {
    const act = cta.dataset.act;
    if (act === "lineup") openLineup();
    else if (act === "trades") setBoardTab("trades");
    else if (act === "recap") openRecap();
    else if (act === "live") setBoardTab("lb");
  };
}

/* ---------- matchday banner ---------- */

const SA_TZ = "Africa/Johannesburg";
const saDay  = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SA_TZ });
const saTime = (iso) => new Date(iso).toLocaleTimeString("en-GB",
  { hour: "2-digit", minute: "2-digit", timeZone: SA_TZ });
// US Eastern (EDT/EST) drives the "which day's games" selection so that late
// US evening games (e.g. 21:00 ET = 03:00 SA next day) appear in the same
// banner card as the earlier games of that US tournament day.
const ET_TZ = "America/New_York";
const etDay  = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ET_TZ });

// Score from the official API result stored on each stat row (handles own
// goals correctly). Falls back to summing player goals for legacy rows
// written before home_score/away_score were added.
function matchScore(label) {
  const row = S.stats.find((r) => r.match_label === label
    && r.home_score != null && r.away_score != null);
  if (row) return [row.home_score, row.away_score];
  const [home, away] = labelTeams(label);
  let h = 0, a = 0;
  for (const r of S.stats) {
    if (r.match_label !== label) continue;
    const t = S.playerById?.[r.player_id]?.team;
    if (t === home) h += r.goals || 0;
    else if (t === away) a += r.goals || 0;
  }
  return [h, a];
}

// Current match minute for a live game: the largest `minutes` among its stat
// rows (a player on since kickoff reads the elapsed minute). Comes from the
// last live_pull, so it's ~5-min granular. null when not yet available.
function liveMinute(label) {
  let m = 0;
  for (const r of S.stats)
    if (r.match_label === label && r.minutes) m = Math.max(m, r.minutes);
  return m || null;
}

function topScorers(label, n) {
  return S.stats.filter((r) => r.match_label === label)
    .map((r) => {
      const p = S.playerById?.[r.player_id];
      return p ? { p, r, pts: calcPlayerPoints(r, p.position) } : null;
    })
    .filter(Boolean)
    .sort((x, y) => y.pts - x.pts)
    .slice(0, n);
}

/* ---------- knockout bracket ---------- */

// Classify a fixture's API round label into a knockout stage key (or null for
// group stage / unknown). Tolerant of wording variants across the feed.
function koRoundOf(roundStr) {
  const s = String(roundStr || "").toLowerCase();
  if (s.includes("round of 32")) return "R32";
  if (s.includes("round of 16")) return "R16";
  if (s.includes("quarter")) return "QF";
  if (s.includes("semi")) return "SF";
  if (s.includes("3rd") || s.includes("third")) return "3rd";
  if (s.includes("final")) return "F";     // after the 3rd-place check above
  return null;
}

// The label a fixture would have in match_stats ("Home vs Away (date)").
const fixtureLabel = (f) => `${f.home} vs ${f.away} (${f.date})`;

// Score for a fixture: live/pulled result from match_stats if we have it,
// otherwise the score stored on the fixture itself (daily feed). null = unplayed.
function fixtureScore(f) {
  const label = fixtureLabel(f);
  if (S.stats.some((r) => r.match_label === label)) return matchScore(label);
  if (f.home_score != null && f.away_score != null) return [f.home_score, f.away_score];
  return null;
}

// Build the knockout bracket from fixtures that carry a knockout round label.
// Winner = higher score, or (for a draw settled on penalties, or before the
// score syncs) whichever side advanced to a deeper round. Rounds are ordered
// into a real tree: starting from the latest round, each match's two feeders
// (the earlier-round ties whose winners it contains) are placed adjacently so
// the columns line up and connect. Returns rounds + the third-place match.
function knockoutBracket() {
  const ORD = { R32: 0, R16: 1, QF: 2, SF: 3, F: 4 };
  const LABELS = { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals",
    SF: "Semi-finals", F: "Final" };
  const items = (S.fixtures || [])
    .map((f) => ({ f, r: koRoundOf(f.round) })).filter((x) => x.r);
  const isTBC = (t) => !t || t === "TBC";
  const deepest = {};
  for (const { f, r } of items) {
    if (r === "3rd") continue;
    for (const t of [f.home, f.away])
      if (!isTBC(t)) deepest[t] = Math.max(deepest[t] ?? -1, ORD[r]);
  }
  const mk = (f, r) => {
    const label = fixtureLabel(f);
    const score = fixtureScore(f);
    // Finished / live mirror the Home banner: FT/AET/PEN or kicked off >2.5h ago
    // counts as done, so a completed game never shows as LIVE (its stat rows
    // still carry minutes). Live = kicked off and not yet done.
    const koMs = Date.parse(f.kickoff_utc);
    const finished = ["FT", "AET", "PEN"].includes(f.status) || koMs < Date.now() - 2.5 * 3600e3;
    const live = !finished && koMs < Date.now();
    let winner = null;
    if (score && score[0] !== score[1]) winner = score[0] > score[1] ? f.home : f.away;
    else if (r !== "3rd") {
      const o = ORD[r], dh = deepest[f.home] ?? -1, da = deepest[f.away] ?? -1;
      if (dh > o && da <= o) winner = f.home;
      else if (da > o && dh <= o) winner = f.away;
    }
    return { home: f.home, away: f.away, score, winner, label,
             kickoff: f.kickoff_utc, live, feeders: [] };
  };
  const byRound = {};
  for (const { f, r } of items) (byRound[r] ||= []).push(mk(f, r));
  // API-Football often doesn't publish the semi/final/third-place fixtures
  // until late, but the tree shape is fixed. Synthesize the missing later
  // rounds as TBC placeholders (no date) so the whole bracket shows; a real
  // fixture takes over automatically once the feed carries it.
  const KEYS = ["R32", "R16", "QF", "SF", "F"];
  const synth = () => ({ home: "TBC", away: "TBC", score: null, winner: null,
    label: "", kickoff: "", live: false, feeders: [] });
  const deepestPresent = KEYS.filter((k) => byRound[k]).pop();
  if (deepestPresent) {
    let di = KEYS.indexOf(deepestPresent), count = byRound[deepestPresent].length;
    while (di < KEYS.length - 1 && count > 1) {
      di++;
      if (!byRound[KEYS[di]]) byRound[KEYS[di]] = Array.from({ length: Math.ceil(count / 2) }, synth);
      count = byRound[KEYS[di]].length;
    }
    if (byRound.SF && !byRound["3rd"]) byRound["3rd"] = [synth()];
  }
  const order = KEYS.filter((k) => byRound[k]);
  const rounds = order.map((k) => ({ key: k, label: LABELS[k], matches: byRound[k].slice() }));

  // Order the tree around the deepest round that still has real (non-TBC)
  // teams. Earlier rounds are threaded back to it by team continuity (each
  // tie's two feeders sit before its slot). Later, still-unconfirmed rounds
  // (semis / final) are extended forward by position — each match fed by the
  // adjacent pair of the previous round — so the tree links correctly and the
  // TBC slots fill in as results come through.
  const byKick = (a, b) => String(a.kickoff).localeCompare(String(b.kickoff));
  const confirmed = (m) => !isTBC(m.home) && !isTBC(m.away);
  if (rounds.length) {
    let anchor = -1;
    for (let i = 0; i < rounds.length; i++)
      if (rounds[i].matches.some(confirmed)) anchor = i;
    if (anchor < 0) anchor = 0;
    rounds[anchor].matches.sort(byKick);
    // Backward: order by team continuity into the anchor.
    for (let ri = anchor - 1; ri >= 0; ri--) {
      const cur = rounds[ri].matches, next = rounds[ri + 1].matches;
      const used = new Set(), ordered = [];
      for (const nm of next) {
        const fds = cur.filter((cm) => !used.has(cm) && cm.winner
          && (cm.winner === nm.home || cm.winner === nm.away));
        fds.sort((x, y) => (x.winner === nm.home ? 0 : 1) - (y.winner === nm.home ? 0 : 1));
        for (const cm of fds) { used.add(cm); ordered.push(cm); }
        nm.feeders = fds;
      }
      for (const cm of cur.slice().sort(byKick)) if (!used.has(cm)) ordered.push(cm);
      rounds[ri].matches = ordered;
    }
    // Forward: extend into later rounds by position (pairs feed the next slot).
    for (let ri = anchor + 1; ri < rounds.length; ri++) {
      const prev = rounds[ri - 1].matches;
      const cur = rounds[ri].matches.slice().sort(byKick);
      cur.forEach((m, i) => { m.feeders = [prev[2 * i], prev[2 * i + 1]].filter(Boolean); });
      rounds[ri].matches = cur;
    }
  }
  return { rounds, third: byRound["3rd"] ? byRound["3rd"][0] : null };
}

function bracketMatchHtml(m) {
  const decided = !!m.winner && !m.live;   // don't crown a live leader mid-game
  const teamRow = (team, sc, isWinner) => {
    const tbc = !team || team === "TBC";
    return `<div class="flex items-center gap-1.5 ${decided && !isWinner ? "opacity-45" : ""}">
      ${tbc ? '<span class="w-4 h-4 rounded-full bg-slate-800 shrink-0"></span>'
            : avatarHtml("team:" + team, team, "w-4 h-4")}
      <span class="truncate text-xs flex-1 ${
        isWinner ? "font-bold text-wcgold" : tbc ? "text-slate-400 italic" : ""}">${
        tbc ? "TBC" : esc(team)}</span>
      <span class="text-xs font-mono ${isWinner ? "text-wcgold" : "text-slate-400"}">${sc}</span>
    </div>`;
  };
  const sc = m.score;
  const hs = sc ? sc[0] : "", as = sc ? sc[1] : "";
  const foot = m.live ? '<span class="text-xs text-red-400 font-semibold">● LIVE</span>'
    : sc ? "" : `<span class="text-xs text-slate-400">${fmtKickoff(m.kickoff)}</span>`;
  return `<div class="rounded-lg border ${m.live ? "border-red-500/50" : "border-slate-700"} bg-slate-900 px-2 py-1.5 space-y-1 w-36">
    ${teamRow(m.home, hs, decided && m.winner === m.home)}
    ${teamRow(m.away, as, decided && m.winner === m.away)}
    ${foot ? `<div class="text-center">${foot}</div>` : ""}
  </div>`;
}

// Short kickoff label for an unplayed bracket match (e.g. "Jul 5, 21:00").
function fmtKickoff(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", "
    + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderBracket() {
  const { rounds, third } = knockoutBracket();
  const box = $("board-bracket");
  if (!rounds.length) {
    box.innerHTML = `<div class="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center text-sm text-slate-400">
      The knockout bracket appears here once knockout fixtures are confirmed (Round of 32 onward).
      Group-stage results show on the Home banner.</div>`;
    return;
  }
  const col = (rd, isLast) => {
    let body;
    if (isLast) {
      body = rd.matches.map((m) => `<div class="kb-card">${bracketMatchHtml(m)}</div>`).join("");
    } else {
      const pairs = [];
      for (let i = 0; i < rd.matches.length; i += 2) pairs.push(rd.matches.slice(i, i + 2));
      body = pairs.map((p) => `<div class="kb-pair">${
        p.map((m) => `<div class="kb-card">${bracketMatchHtml(m)}</div>`).join("")}</div>`).join("");
    }
    return `<div class="kb-col${isLast ? " kb-last" : ""}">
      <div class="text-xs uppercase tracking-wide text-slate-400 font-semibold text-center mb-1 px-1">${rd.label}</div>
      <div class="kb-round">${body}</div></div>`;
  };
  box.innerHTML = `
    <p class="text-xs text-slate-400">Winners flow left → right; the lines join the two ties that feed each
      next-round match. Scores update live during games and after the daily fixtures sync. Scroll sideways.</p>
    <div class="overflow-x-auto pb-2"><div class="kb">${
      rounds.map((rd, i) => col(rd, i === rounds.length - 1)).join("")}</div></div>
    ${third ? `<div class="rounded-xl border border-slate-800 bg-slate-900/50 p-2 mt-1">
      <div class="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">Third place</div>
      ${bracketMatchHtml(third)}
    </div>` : ""}`;
}

// Today's (or the next matchday's) fixtures with SA kickoff times, plus an
// auto-scrolling ticker of games still to play: each manager's involved
// players (team crests instead of country names keep it short). Finished
// games show their score on the fixture row, tappable for a panel under
// the rows with the top point-scorers and ownership.
// fixtures.json statuses go stale between rebuilds, so "finished" also
// falls back to "kicked off more than ~2.5h ago". The rendered HTML is
// cached so realtime refreshes don't restart the ticker animation; the
// detail panel lives in its own div so opening it doesn't either.
let bannerCache = null;
function renderBanner() {
  const box = $("board-banner");
  if (!box) return;
  const fx = S.fixtures || [];
  const over = (f) => ["FT", "AET", "PEN"].includes(f.status)
    || Date.parse(f.kickoff_utc) < Date.now() - 2.5 * 3600e3;
  const todayET = etDay(new Date().toISOString());
  if (!fx.length) {
    if (bannerCache !== "") { bannerCache = ""; box.innerHTML = ""; }
    return;
  }
  // Every matchday in order; default to the earliest upcoming/live day (else the
  // most recent past day). S.bannerDayOffset steps to neighbouring days — ‹ to
  // see the previous day's results and top scorers, › back toward today.
  const allDays = [...new Set(fx.map((f) => etDay(f.kickoff_utc)))].sort();
  let defIdx = allDays.findIndex((d) => d >= todayET
    && fx.some((f) => etDay(f.kickoff_utc) === d && !over(f)));
  if (defIdx < 0) defIdx = allDays.length - 1;
  const idx = Math.min(allDays.length - 1, Math.max(0, defIdx + (S.bannerDayOffset || 0)));
  S.bannerDayOffset = idx - defIdx;                    // normalise (stay in range)
  const day = allDays[idx];
  const games = fx.filter((f) => etDay(f.kickoff_utc) === day)
    .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));
  const label = day === todayET ? "Today"
    : day === etDay(new Date(Date.now() + 86400e3).toISOString()) ? "Tomorrow"
    : day === etDay(new Date(Date.now() - 86400e3).toISOString()) ? "Yesterday"
    : new Date(day).toLocaleDateString("en-GB",
        { weekday: "short", day: "numeric", month: "short" });
  const atStart = idx <= 0, atEnd = idx >= allDays.length - 1;
  const fxLabel = (f) =>
    `${f.home} vs ${f.away} (${String(f.kickoff_utc).slice(0, 10)})`;
  const hasStats = (l) => S.stats.some((r) => r.match_label === l);

  const rows = games.map((f) => {
    const isOver = over(f);
    const isLive = !isOver && Date.parse(f.kickoff_utc) < Date.now();
    const l = fxLabel(f);
    // Show the score for live games too (from the latest live_pull), not just
    // finished ones — so a live match reads "63'  Home 1–0 Away".
    const score = (isOver || isLive) && hasStats(l) ? matchScore(l) : null;
    // Live match minute (from the last pull); shown in place of the kickoff
    // time, falling back to "LIVE" until the first pull lands.
    const liveMin = isLive ? liveMinute(l) : null;
    return `<div class="flex items-center gap-1.5 text-sm ${score ? "cursor-pointer" : ""}"
      ${score ? `data-ftgame="${esc(l)}" role="button"` : ""}>
      <span class="font-mono text-xs w-11 shrink-0 ${
        isLive ? "text-red-400 font-bold" : isOver ? "text-slate-500" : "text-wcgold"
      }">${isLive ? (liveMin ? liveMin + "'" : "LIVE") : isOver ? "FT" : saTime(f.kickoff_utc)}</span>
      ${avatarHtml("team:" + f.home, f.home, "w-4 h-4")}
      <span class="truncate ${isOver ? "text-slate-400" : ""}">${esc(f.home)}${
        score ? ` <b class="text-slate-300">${score[0]} – ${score[1]}</b> ` : " – "}${esc(f.away)}</span>
      ${avatarHtml("team:" + f.away, f.away, "w-4 h-4")}
      ${score ? '<span class="ml-auto text-slate-500 shrink-0">›</span>' : ""}
    </div>`;
  }).join("");

  // Ticker entries: games still to play only — crests + whose players
  // feature. Finished games stay out of the ticker; their score and top
  // scorers live in the tap-to-expand panel on the FT fixture rows.
  const crests = (f) => `${avatarHtml("team:" + f.home, f.home, "w-4 h-4")}<span
    class="px-0.5 text-slate-500">–</span>${avatarHtml("team:" + f.away, f.away, "w-4 h-4")}`;
  const items = games.map((f) => {
    if (over(f)) return "";
    const byMgr = {};
    for (const pk of S.picks) {
      if (pk.position === "TEAM" || (pk.team !== f.home && pk.team !== f.away)) continue;
      const m = S.managers.find((x) => x.id === pk.manager_id);
      if (m) (byMgr[m.name] ||= []).push(pk.player_name);
    }
    const mgrs = Object.entries(byMgr)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([n, ps]) => `<span class="text-wcgold">${esc(n)}</span> ${ps.map(esc).join(", ")}`)
      .join(" &middot; ");
    return mgrs ? `<span class="inline-flex items-center gap-1">${crests(f)}&nbsp;${mgrs}</span>` : "";
  }).filter(Boolean);
  const half = `<span class="pr-12 inline-flex items-center">${
    items.join('<span class="text-slate-500 px-3">✦</span>')}</span>`;
  const ticker = items.length ? `<div class="ticker-wrap border-t border-slate-800 pt-1.5">
      <div class="ticker text-xs text-slate-400">${half}${half}</div>
    </div>` : "";

  const html = `<div class="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-1.5">
    <div class="flex items-center gap-1">
      <button data-bannernav="-1" ${atStart ? "disabled" : ""} class="px-1.5 rounded text-sm ${
        atStart ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}" title="Previous day">‹</button>
      <div class="flex-1 text-center text-xs uppercase tracking-wide text-slate-400">${label} · SA time</div>
      <button data-bannernav="1" ${atEnd ? "disabled" : ""} class="px-1.5 rounded text-sm ${
        atEnd ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}" title="Next day">›</button>
    </div>
    ${rows}<div id="banner-detail"></div>${ticker}
    ${S.bannerDayOffset ? '<button data-bannerback class="w-full text-xs text-slate-400 underline pt-0.5">↩ back to today</button>' : ""}
  </div>`;
  if (html !== bannerCache) {
    bannerCache = html;
    box.innerHTML = html;
    const t = box.querySelector(".ticker");
    if (t) requestAnimationFrame(() => {     // ~42px/s, never under 14s
      t.style.setProperty("--ticker-dur",
        Math.max(14, Math.round(t.scrollWidth / 2 / 42)) + "s");
    });
    box.querySelectorAll("[data-ftgame]").forEach((el) => el.onclick = () => {
      S.bannerGame = S.bannerGame === el.dataset.ftgame ? null : el.dataset.ftgame;
      renderBannerDetail();
    });
    box.querySelectorAll("[data-bannernav]").forEach((el) => el.onclick = () => {
      S.bannerDayOffset = (S.bannerDayOffset || 0) + Number(el.dataset.bannernav);
      S.bannerGame = null;                    // close any open detail on day change
      renderBanner();
    });
    const back = box.querySelector("[data-bannerback]");
    if (back) back.onclick = () => { S.bannerDayOffset = 0; S.bannerGame = null; renderBanner(); };
  }
  renderBannerDetail();
}

// Expanded FT-game panel: score header + top scorers with ownership.
// Rendered into its own div so toggling never restarts the ticker.
function renderBannerDetail() {
  const d = $("banner-detail");
  if (!d) return;
  const l = S.bannerGame;
  if (!l || !S.stats.some((r) => r.match_label === l)) { d.innerHTML = ""; return; }
  const [home, away] = labelTeams(l);
  const [hs, as] = matchScore(l);
  d.innerHTML = `<div class="rounded-lg bg-slate-800/60 p-2.5 space-y-1 mt-0.5">
    <div class="flex items-center gap-1.5 text-sm font-semibold">
      ${avatarHtml("team:" + home, home, "w-5 h-5")}
      <span class="truncate">${esc(home)} <span class="text-wcgold">${hs} – ${as}</span> ${esc(away)}</span>
      ${avatarHtml("team:" + away, away, "w-5 h-5")}
      <button id="banner-close" class="ml-auto text-slate-400 px-1">✕</button>
    </div>
    ${topScorers(l, 6).map(({ p, r, pts }) => {
      const o = ownerOf(p.player_id);
      return `<div class="flex items-center gap-1.5 text-xs">
        ${avatarHtml(p.player_id, p.team, "w-5 h-5")}
        <span class="truncate">${esc(p.name)}</span>
        ${o ? ownerChipHtml(p.player_id)
            : '<span class="shrink-0 text-xs text-slate-400">free</span>'}
        <span class="ml-auto text-slate-400 shrink-0">${statBits(r) || "0"}</span>
        <span class="font-mono w-7 text-right shrink-0 ${
          pts > 0 ? "text-wcgold" : "text-slate-400"}">${pts}</span>
      </div>`;
    }).join("")}
  </div>`;
  d.querySelector("#banner-close").onclick = () => {
    S.bannerGame = null;
    renderBannerDetail();
  };
}

/* ---------- navigation: four destinations, not eight ----------
   The panes are unchanged; they're grouped so the phone shows one bottom bar
   instead of three rows of buttons, and a section only shows a secondary
   switcher when it actually has more than one view. */
const NAV_LABEL = { lb: "Table", fixtures: "Fixtures", rosters: "Squads", bracket: "Bracket",
  trades: "Trades", chat: "Chat", home: "Team", stats: "Players", test: "Test bench" };

// A knockout bracket is meaningless for a 38-round league season. Legacy
// leagues (no competition) are World Cup ones, so they keep it.
function isCupCompetition() {
  const c = leagueCompetition();
  if (!c) return true;
  const meta = COMPETITIONS.find((x) => x.apiLeagueId === c.apiLeagueId);
  return !meta || meta.kind === "cup";
}
function navGroups() {
  return {
    team: ["home"],
    league: [
      "lb",
      ...(h2hEnabled() ? ["fixtures"] : []),
      "rosters",
      ...(isCupCompetition() ? ["bracket"] : []),
    ],
    players: ["stats"],
    activity: ["trades", "chat"],
    /* The test bench is a nav destination like any other, but only for a
       product-owner account. Everything it can actually DO is still gated on
       the league being a sandbox -- see simSafe() -- so this only decides
       whether the tab is offered, never whether a write is allowed. */
    ...(isAppOwner() ? { test: ["test"] } : {}),
  };
}
const groupOfTab = (tab) => {
  const g = navGroups();
  return Object.keys(g).find((k) => g[k].includes(tab)) || "team";
};

// Draw the bottom bar's active state and the section's secondary switcher.
function renderBoardNav(tab) {
  const groups = navGroups(), active = groupOfTab(tab);
  document.querySelectorAll(".nav-btn").forEach((b) => {
    const on = b.dataset.nav === active;
    b.classList.toggle("text-wcgold", on);
    b.classList.toggle("text-slate-400", !on);
  });
  const strip = $("board-subtabs");
  if (!strip) return;
  const panes = groups[active] || [];
  strip.classList.toggle("hidden", panes.length < 2);
  strip.classList.toggle("flex", panes.length >= 2);
  if (panes.length < 2) { strip.innerHTML = ""; return; }
  strip.innerHTML = panes.map((p) =>
    `<button id="tab-${p}" data-tab="${p}" class="board-tab flex-1 rounded-md py-1.5 font-semibold ${
      p === tab ? "bg-slate-700 text-wcgold" : "text-slate-400"}">${NAV_LABEL[p]}</button>`).join("");
  strip.querySelectorAll("[data-tab]").forEach((b) =>
    b.onclick = () => { setBoardTab(b.dataset.tab); renderBoard(); });
}

// A dot on Activity when something is waiting, since Trades and Chat are no
// longer top-level buttons that can carry their own badge.
function updateNavDot() {
  const dot = $("nav-dot");
  if (!dot) return;
  const me = myManager();
  const pending = me ? S.trades.filter((t) =>
    t.target_manager_id === me.id && t.status === "proposed").length : 0;
  const unread = me ? totalUnread(me.id) : 0;
  dot.classList.toggle("hidden", !(pending + unread));
}

function setBoardTab(tab) {
  // Fixtures only exists in a head-to-head league, and Bracket only in a cup.
  // Landing on a pane the league no longer has would show an empty screen.
  if (!Object.values(navGroups()).some((g) => g.includes(tab))) tab = "home";
  S.boardTab = tab;
  (S._navLast ||= {})[groupOfTab(tab)] = tab;
  $("board-home").classList.toggle("hidden", tab !== "home");
  $("board-lb").classList.toggle("hidden", tab !== "lb");
  $("board-fixtures").classList.toggle("hidden", tab !== "fixtures");
  $("board-bracket").classList.toggle("hidden", tab !== "bracket");
  $("board-stats").classList.toggle("hidden", tab !== "stats");
  $("board-rosters").classList.toggle("hidden", tab !== "rosters");
  $("board-trades").classList.toggle("hidden", tab !== "trades");
  $("board-chat").classList.toggle("hidden", tab !== "chat");
  $("board-test")?.classList.toggle("hidden", tab !== "test");
  renderBoardNav(tab);
  updateNavDot();
  updateTradeBadge();
  if (tab === "chat" && myManager()) markThreadSeen(S.chatThread, myManager().id);
  updateChatBadge();
}

// Count badge on the Trades tab for pending incoming requests, so a manager
// with a proposal waiting sees it from any tab. (setBoardTab only rewrites the
// button class, not its children, so the badge survives tab switches; we
// remove+re-add it here to keep the count current.)
function updateTradeBadge() {
  const btn = $("tab-trades");
  if (!btn) return;
  btn.querySelector("#trade-badge")?.remove();
  const me = myManager();
  const n = me ? S.trades.filter((t) =>
    t.target_manager_id === me.id && t.status === "proposed").length : 0;
  if (!n) return;
  const b = document.createElement("span");
  b.id = "trade-badge";
  b.className = "ml-1 inline-flex items-center justify-center rounded-full "
    + "bg-wcgold text-slate-900 text-xs font-bold w-4 h-4 align-middle";
  b.textContent = String(n);
  btn.appendChild(b);
}

/* ---------- in-app chat: league group room + 1:1 direct messages ---------- */

const mgrNameById = () => Object.fromEntries(S.managers.map((m) => [m.id, m.name]));

// Threads: the league room is always first; the DM threads follow, most
// recently active first (a fresh message jumps that chat to the front).
function chatThreads() {
  const me = myManager();
  const lastAt = (tid) => {
    const msgs = messagesForThread(tid, me?.id);
    return msgs.length ? String(msgs[msgs.length - 1].created_at) : "";
  };
  const dms = S.managers.filter((m) => m.id !== me?.id)
    .map((m) => ({ id: m.id, name: m.name, lastAt: lastAt(m.id) }));
  dms.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name));
  return [{ id: "league", name: "League chat" }, ...dms];
}

// Messages in a thread, oldest first. "league" = group (no recipient); a
// manager id = the 1:1 thread between me and them (either direction).
function messagesForThread(threadId, meId) {
  return (S.messages || []).filter((msg) => {
    if (threadId === "league") return !msg.recipient_id;
    if (!msg.recipient_id) return false;
    return (msg.sender_id === meId && msg.recipient_id === threadId)
        || (msg.sender_id === threadId && msg.recipient_id === meId);
  }).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

// Unread = messages in a thread newer than the last time I viewed it, not mine.
const chatSeenKey = () => "wcf_chatseen_" + (getSession()?.leagueId || "");
function loadChatSeen() {
  try { S.chatSeen = JSON.parse(localStorage.getItem(chatSeenKey()) || "{}"); }
  catch { S.chatSeen = {}; }
}
function markThreadSeen(threadId, meId) {
  const msgs = messagesForThread(threadId, meId);
  S.chatSeen[threadId] = msgs.length ? msgs[msgs.length - 1].created_at
    : (S.chatSeen[threadId] || new Date().toISOString());
  try { localStorage.setItem(chatSeenKey(), JSON.stringify(S.chatSeen)); } catch {}
}
function threadUnread(threadId, meId) {
  const seen = S.chatSeen?.[threadId] || "";
  return messagesForThread(threadId, meId).filter((m) =>
    String(m.created_at) > String(seen) && m.sender_id !== meId).length;
}
const totalUnread = (meId) =>
  chatThreads().reduce((n, t) => n + threadUnread(t.id, meId), 0);

function updateChatBadge() {
  const btn = $("tab-chat");
  if (!btn) return;
  btn.querySelector("#chat-badge")?.remove();
  const me = myManager();
  const n = me ? totalUnread(me.id) : 0;
  if (!n) return;
  const b = document.createElement("span");
  b.id = "chat-badge";
  b.className = "ml-1 inline-flex items-center justify-center rounded-full "
    + "bg-wcgold text-slate-900 text-xs font-bold w-4 h-4 align-middle";
  b.textContent = n > 9 ? "9+" : String(n);
  btn.appendChild(b);
}

async function sendChat(body) {
  const me = myManager();
  if (!me) return toast("Join as a manager to chat.");
  body = (body || "").trim();
  if (!body) return;
  const recipient = S.chatThread === "league" ? null : S.chatThread;
  const { error } = await S.sb.from("messages").insert({
    league_id: S.league.id, sender_id: me.id, recipient_id: recipient,
    body: body.slice(0, 1000),
  });
  if (error) return toast(/messages|relation|schema cache/.test(error.message)
    ? "Chat needs a schema update — run schema.sql." : error.message);
  S._chatForceScroll = true;   // jump to my new message when it lands
}

function fmtChatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? t
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + t;
}

function renderChat() {
  if (!S._chatSeenLoaded) { loadChatSeen(); S._chatSeenLoaded = true; }
  const me = myManager();
  if (!me) {
    $("chat-threads").innerHTML = "";
    $("chat-msgs").innerHTML = '<p class="text-sm text-slate-400">Join as a manager to chat.</p>';
    $("chat-note").textContent = "";
    return;
  }
  // Selected DM partner removed? fall back to the league room.
  if (S.chatThread !== "league" && !S.managers.some((m) => m.id === S.chatThread))
    S.chatThread = "league";

  $("chat-threads").innerHTML = chatThreads().map((t) => {
    const on = S.chatThread === t.id;
    const unread = threadUnread(t.id, me.id);
    // Unread threads get a red dot + a highlighted (gold) chip so they stand
    // out even when not selected; the count badge shows how many.
    const cls = on ? "border-wcgold text-wcgold bg-wcred/10"
      : unread ? "border-wcgold/70 text-slate-100" : "border-slate-700 text-slate-400";
    // A direct thread is a person, so it wears their crest and colour rather
    // than a generic envelope — the same mark they have everywhere else.
    const dm = t.id !== "league" && S.managers.find((m) => m.id === t.id);
    const face = dm
      ? `<span class="shrink-0 inline-flex items-center justify-center rounded-md w-5 h-5 text-[11px]"
             style="background:${managerColor(dm)}26;border:1px solid ${managerColor(dm)}99">${managerMark(dm)}</span>`
      : '<span class="shrink-0 text-[13px] leading-none">🏟</span>';
    return `<button data-chatthread="${esc(t.id)}" class="shrink-0 inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 border ${cls}">${
      unread ? '<span class="text-red-400">●</span>' : ""}${face}<span>${esc(t.name)}</span>${
      unread ? `<span class="inline-flex items-center justify-center rounded-full bg-wcgold text-slate-900 text-xs font-bold w-4 h-4">${
        unread > 9 ? "9+" : unread}</span>` : ""}</button>`;
  }).join("");
  $("chat-threads").querySelectorAll("[data-chatthread]").forEach((b) => b.onclick = () => {
    S.chatThread = b.dataset.chatthread; S._chatForceScroll = true;
    markThreadSeen(S.chatThread, me.id); renderChat(); updateChatBadge();
  });

  const nameBy = mgrNameById();
  const msgs = messagesForThread(S.chatThread, me.id);
  const box = $("chat-msgs");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  /* Bubbles carry the sender's face and colour, and a run of messages from
     the same person collapses into one block — a league room is a conversation
     between people you can see, not a log of "Name:" prefixes. */
  box.innerHTML = msgs.map((m, i) => {
    const mine = m.sender_id === me.id;
    const sender = S.managers.find((x) => x.id === m.sender_id);
    const prev = msgs[i - 1];
    const grouped = prev && prev.sender_id === m.sender_id
      && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000;
    const col = managerColor(sender);
    const reactions = Object.entries(m.reactions || {}).filter(([, ids]) => ids && ids.length);
    const pills = reactions.map(([e, ids]) => {
      const reacted = ids.includes(me.id);
      return `<button data-react="${m.id}|${e}" class="rounded-full px-1.5 py-0.5 text-xs border ${
        reacted ? "border-wcgold bg-wcgold/10 text-wcgold" : "border-slate-700 bg-slate-800 text-slate-300"}">${e} ${ids.length}</button>`;
    }).join("");
    const picking = S.reactPickerFor === m.id;
    const tail = picking
      ? REACT_EMOJIS.map((e) => `<button data-reactpick="${m.id}|${e}" class="text-base leading-none px-0.5">${e}</button>`).join("")
      : `<button data-reactadd="${m.id}" title="React" class="rounded-full px-1.5 py-0.5 text-xs border border-slate-700 bg-slate-800/50 text-slate-400">＋</button>`;
    const face = mine ? "" : `<span class="shrink-0 w-7">${grouped ? "" :
      `<span class="inline-flex items-center justify-center rounded-lg w-7 h-7 text-sm"
             style="background:${col}26;border:1px solid ${col}99">${managerMark(sender)}</span>`}</span>`;
    return `<div class="flex items-start gap-1.5 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-2"}">
      ${face}
      <div class="min-w-0 max-w-[78%] flex flex-col ${mine ? "items-end" : "items-start"}">
        ${!mine && !grouped ? `<span class="text-xs font-semibold mb-0.5" style="color:${col}">${esc(sender?.name || "unknown")}</span>` : ""}
        <div class="rounded-2xl px-3 py-1.5 ${mine
          ? "bg-wcred text-white rounded-br-sm"
          : "bg-slate-800 text-slate-100 rounded-bl-sm"}"${
          mine ? "" : ` style="border-left:2px solid ${col}"`}>
          <div class="text-sm whitespace-pre-wrap break-words">${esc(m.body)}</div>
          <div class="text-[10px] opacity-60 text-right mt-0.5">${fmtChatTime(m.created_at)}</div>
        </div>
        <div class="flex items-center gap-1 mt-0.5 flex-wrap ${mine ? "justify-end" : ""}">${pills}${tail}</div>
      </div>
    </div>`;
  }).join("") || `<div class="h-full flex flex-col items-center justify-center text-center gap-2 py-8">
      <span class="text-3xl">${S.chatThread === "league" ? "🏟" : "👋"}</span>
      <p class="text-sm text-slate-300">${S.chatThread === "league"
        ? "Nobody's said anything yet." : "No messages yet."}</p>
      <p class="text-xs text-slate-500">${S.chatThread === "league"
        ? "Start the trash talk — the league can all see this room."
        : "Open a negotiation, or just wind them up."}</p>
    </div>`;
  box.querySelectorAll("[data-react]").forEach((b) => b.onclick = () => {
    const i = b.dataset.react.indexOf("|");
    toggleReaction(b.dataset.react.slice(0, i), b.dataset.react.slice(i + 1));
  });
  box.querySelectorAll("[data-reactpick]").forEach((b) => b.onclick = () => {
    const i = b.dataset.reactpick.indexOf("|");
    toggleReaction(b.dataset.reactpick.slice(0, i), b.dataset.reactpick.slice(i + 1));
  });
  box.querySelectorAll("[data-reactadd]").forEach((b) => b.onclick = () => {
    S.reactPickerFor = S.reactPickerFor === b.dataset.reactadd ? null : b.dataset.reactadd;
    renderChat();
  });
  if (atBottom || S._chatForceScroll) { box.scrollTop = box.scrollHeight; S._chatForceScroll = false; }

  $("chat-note").textContent = S.chatThread === "league"
    ? "Everyone in the league can see this room."
    : "🔓 Direct message — private in the app, but not encrypted in the database.";

  $("chat-form").onsubmit = (e) => {
    e.preventDefault();
    const input = $("chat-input");
    const v = input.value; input.value = "";
    sendChat(v).catch((err) => toast(err.message));
  };

  // Actively viewing a thread clears its unread.
  if (S.boardTab === "chat") { markThreadSeen(S.chatThread, me.id); updateChatBadge(); }
}

// How many of each manager's current starters have already played a match
// within their current snapshot window (i.e. since their last lineup lock).
// Only computed when there is at least one snapshot; returns hasSnapshot flag
// so the caller can suppress the counter before any lock has been taken.
function computeYetToPlay() {
  const statsByPlayer = statsDerived().byPlayer;
  const now = Date.now();
  const snapsByMgr = snapshotsByManager();
  const result = {};
  for (const m of S.managers) {
    /* Only snapshots already IN FORCE describe the window we are counting in.
       The newest row is now typically a line-up stamped for the lock ahead of
       us, and starting the count there would put every match in the future --
       so nothing would ever read as played. */
    const snaps = (snapsByMgr[m.id] || []).filter((sn) => Date.parse(sn.effective_from) <= now);
    const hasSnapshot = snaps.length > 0;
    const snapshotStart = hasSnapshot ? Date.parse(snaps[snaps.length - 1].effective_from) : 0;
    const starters = managerPicks(m.id).filter(pk => !pk.is_sub && pk.position !== "TEAM");
    const played = !hasSnapshot ? 0 : starters.filter(pk =>
      (statsByPlayer[pk.player_id] || []).some(r => {
        const t = matchTimeFor(r.match_label);
        return t >= snapshotStart && t <= now;
      })
    ).length;
    result[m.id] = { played, total: starters.length, yet: starters.length - played, hasSnapshot };
  }
  return result;
}

// Standings movement: ▲ up / ▼ down / – level, by rank change over the last round.
function movementIcon(delta) {
  if (delta > 0) return `<span class="text-emerald-400" title="up ${delta} since last round">▲</span>`;
  if (delta < 0) return `<span class="text-red-400" title="down ${-delta} since last round">▼</span>`;
  return `<span class="text-slate-400" title="no change since last round">–</span>`;
}

// Round-over-round movement for the standings. The current round is the
// furthest anyone has stats for; each manager's rank now vs. their rank before
// that round's points gives the arrow. Ranks use "1 + #strictly ahead" so
// equal totals share a rank and don't fake movement. Movement is only
// meaningful once a 2nd round exists (before that, everyone starts level).
function standingsMovement(scores) {
  const roundNums = scores.flatMap((s) => Object.keys(s.roundPts || {}).map(Number));
  const maxRound = roundNums.length ? Math.max(...roundNums) : 0;
  const roundPtsOf = (s) => (s.roundPts || {})[maxRound] || 0;
  const rankBy = (val) => Object.fromEntries(scores.map((s) =>
    [s.manager.id, 1 + scores.filter((o) => val(o) > val(s)).length]));
  const curRank = rankBy((s) => s.total);
  const prevRank = rankBy((s) => s.total - roundPtsOf(s));
  const byId = Object.fromEntries(scores.map((s) => [s.manager.id, {
    delta: prevRank[s.manager.id] - curRank[s.manager.id],
    roundPts: roundPtsOf(s),
  }]));
  return { maxRound, showMovement: maxRound >= 2, byId };
}

// Cumulative points-by-round per manager, for the season progression chart.
// Uses the same per-round player scoring as the movement arrows. Active
// managers only (eliminated have no round history). r=0 seeds each line at 0.
function seasonSeries(scores) {
  const maxR = scores.reduce((m, s) =>
    Math.max(m, ...Object.keys(s.roundPts || {}).map(Number)), 0);
  const series = scores.filter((s) => s.roundPts).map((s) => {
    let cum = 0;
    const pts = [0];
    for (let r = 1; r <= maxR; r++) { cum += (s.roundPts[r] || 0); pts.push(cum); }
    return { id: s.manager.id, name: s.manager.name, pts, total: cum };
  });
  return { maxR, series };
}

// Round-by-round head-to-head from A's perspective: rounds A out-scored B (w),
// lost (l), or tied (t). null if either manager has no round history.
function headToHead(scores, aId, bId) {
  const a = scores.find((s) => s.manager.id === aId);
  const b = scores.find((s) => s.manager.id === bId);
  if (!a?.roundPts || !b?.roundPts) return null;
  const maxR = Math.max(0, ...[...Object.keys(a.roundPts), ...Object.keys(b.roundPts)].map(Number));
  let w = 0, l = 0, t = 0;
  for (let r = 1; r <= maxR; r++) {
    const ap = a.roundPts[r] || 0, bp = b.roundPts[r] || 0;
    if (ap > bp) w++; else if (ap < bp) l++; else t++;
  }
  return { w, l, t };
}

// Manager id(s) with the most points in the current round (must be > 0), for
// the table's "round MVP" badge. Ties share it; empty before any round scores.
function roundMVPs(scores) {
  const mv = standingsMovement(scores);
  if (mv.maxRound < 1) return new Set();
  let best = 0;
  const winners = new Set();
  for (const s of scores) {
    if (s.eliminated) continue;
    const rp = mv.byId[s.manager.id].roundPts;
    if (rp > best) { best = rp; winners.clear(); winners.add(s.manager.id); }
    else if (rp === best && rp > 0) winners.add(s.manager.id);
  }
  return best > 0 ? winners : new Set();
}

// Season progression: a multi-line chart of cumulative points by round. All
// managers are faint context lines; YOU are gold and, when a compare manager
// is picked, they're sky — the two emphasized, everyone else dimmed, with a
// round-by-round head-to-head under it. Colours pass CVD + contrast; the two
// bright lines carry direct end-labels so identity is never colour-alone.
function seasonChartHtml(scores, meId) {
  const { maxR, series } = seasonSeries(scores);
  if (maxR < 2 || series.length < 2)
    return `<div class="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 text-center">
      The season chart appears once a couple of rounds have been scored.</div>`;
  const cmp = S.chartCompare && series.some((s) => s.id === S.chartCompare) ? S.chartCompare : null;
  const meS = series.find((s) => s.id === meId) || null;
  const cmpS = cmp ? series.find((s) => s.id === cmp) : null;
  const maxY = Math.max(1, ...series.map((s) => s.pts[maxR])) * 1.08;
  const W = 640, H = 240, L = 34, Rp = 62, T = 14, Bt = 24;
  const pw = W - L - Rp, ph = H - T - Bt;
  const X = (r) => (L + (maxR ? r / maxR * pw : 0)).toFixed(1);
  const Y = (v) => (T + (1 - v / maxY) * ph).toFixed(1);
  let svg = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = maxY * f, yy = Y(v);
    return `<line x1="${L}" y1="${yy}" x2="${L + pw}" y2="${yy}" stroke="#1e293b" stroke-width="1"/>`
      + `<text x="${L - 4}" y="${(+yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#64748b">${Math.round(v)}</text>`;
  }).join("");
  const step = maxR > 8 ? 2 : 1;
  for (let r = step; r <= maxR; r += step)
    svg += `<text x="${X(r)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#64748b">${r}</text>`;
  const poly = (s, stroke, w, op) =>
    `<polyline fill="none" stroke="${stroke}" stroke-width="${w}" opacity="${op}" stroke-linejoin="round"
       stroke-linecap="round" points="${s.pts.map((v, r) => `${X(r)},${Y(v)}`).join(" ")}"/>`;
  const hasEmph = !!(meS || cmpS);
  const dimOp = !hasEmph ? 0.5 : (cmp ? 0.12 : 0.32);
  for (const s of series) if (s.id !== meId && s.id !== cmp) svg += poly(s, "#64748b", 1.2, dimOp);
  const emph = (s, color) => poly(s, color, 2.6, 1)
    + s.pts.map((v, r) => `<circle cx="${X(r)}" cy="${Y(v)}" r="2.6" fill="${color}"><title>${
        esc(s.name)} · after round ${r}: ${v} pts</title></circle>`).join("")
    + `<text x="${(+X(maxR) + 4).toFixed(1)}" y="${(+Y(s.pts[maxR]) + 3).toFixed(1)}" font-size="10" fill="${
        color}" font-weight="700">${esc(s.name.slice(0, 9))}</text>`;
  if (cmpS) svg += emph(cmpS, "#38bdf8");
  if (meS) svg += emph(meS, "#eab308");

  const others = series.filter((s) => s.id !== meId);
  const selector = `<select id="chart-compare" class="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-xs max-w-[45%]">
    <option value="">Compare to…</option>
    ${others.map((s) => `<option value="${esc(s.id)}" ${cmp === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
  </select>`;
  let h2h = "";
  if (cmpS && meS) {
    const hh = headToHead(scores, meId, cmp);
    if (hh) {
      const lead = hh.w > hh.l ? '<span class="text-wcgold">You lead ' + hh.w + "–" + hh.l + "</span>"
        : hh.w < hh.l ? `<span class="text-sky-400">${esc(cmpS.name)} leads ${hh.l}–${hh.w}</span>`
        : `<span class="text-slate-300">Dead even ${hh.w}–${hh.l}</span>`;
      h2h = `<div class="rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
        <span class="font-semibold text-slate-200">H2H vs ${esc(cmpS.name)}:</span> ${lead}${
          hh.t ? ` <span class="text-slate-400">· ${hh.t} tie${hh.t === 1 ? "" : "s"}</span>` : ""}
        <span class="block text-xs text-slate-400 mt-0.5">Rounds each of you out-scored the other.</span>
      </div>`;
    }
  }
  return `<div class="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold">Season progression <span class="text-xs text-slate-400 font-normal">· points by round</span></span>
      ${selector}
    </div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="height:auto" preserveAspectRatio="xMidYMid meet">${svg}</svg>
    ${h2h}
    ${cmp ? "" : `<p class="text-xs text-slate-400">${meS ? "Your line is gold." : ""} Pick a manager above to highlight your two lines and see the head-to-head.</p>`}
  </div>`;
}

/* ---------- head-to-head fixtures tab ---------- */

// How many rounds the season is planned for — the configured length when the
// admin set one, otherwise however far the results have got.
const h2hTotalRounds = () =>
  Math.max(1, Number(h2hConfig().rounds) || h2hCurrentRound());

// The pairings for one round, plus whether that round is scored by placement
// (a rumble with no pairwise fixtures at all).
function h2hRoundFixtures(rnd) {
  const ids = S.managers.map((m) => m.id);
  const cfg = h2hConfig();
  const plan = cfg.rumble
    ? h2hSchedulePlan(ids.length, h2hTotalRounds(), { rumble: true }) : null;
  const rumbling = plan && plan.valid && plan.rumble && rnd >= plan.rumbleFrom;
  if (rumbling && cfg.rumble_scoring === "placement")
    return { placement: true, rumble: true, fixtures: [] };
  const opts = rumbling ? { rumbleFrom: plan.rumbleFrom } : {};
  return { placement: false, rumble: !!rumbling,
    fixtures: h2hFixturesFor(ids, rnd, opts).filter((f) => f.round === rnd) };
}

/* Who plays whom, round by round. The Table says where everyone stands; this
   says what is about to happen, which is the thing you check in for. Past
   rounds carry their scores, future rounds carry the pairing, and either way
   the row opens the two line-ups. */
function renderFixturesTab() {
  const box = $("board-fixtures");
  if (!box) return;
  if (!h2hEnabled()) { box.innerHTML = ""; return; }
  const me = myManager();
  const total = h2hTotalRounds();
  const played = h2hCurrentRound();
  const rnd = Math.min(total, Math.max(1, S.fixRound || played));
  S.fixRound = rnd;
  const scores = h2hRoundScores();
  const done = (id) => scores[id]?.[rnd - 1];
  const { fixtures, placement, rumble } = h2hRoundFixtures(rnd);
  const nameOf = (id) => S.managers.find((m) => m.id === id);

  const row = (f) => {
    const a = nameOf(f.home_manager_id), b = nameOf(f.away_manager_id);
    if (!a) return "";
    if (!b) return `<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 flex items-center gap-2">
      ${managerTag(a)}<span class="ml-auto text-xs text-slate-400">bye this round</span></div>`;
    const sa = done(a.id), sb = done(b.id);
    const live = sa != null && sb != null;
    const mine = me && (a.id === me.id || b.id === me.id);
    const win = (x, y) => live && x > y ? "text-live font-bold" : live && x < y ? "text-slate-400" : "text-slate-200";
    return `<button data-fix="${esc(a.id)}|${esc(b.id)}" class="w-full text-left rounded-xl border px-3 py-2.5 ${
      mine ? "border-wcgold/50 bg-wcgold/5" : "border-slate-700 bg-slate-900"}">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span class="min-w-0 overflow-hidden ${win(sa, sb)}">${managerTag(a)}</span>
        <span class="scoreboard font-bold text-sm ${live ? "text-wcgold" : "text-slate-500"}">${
          live ? `${sa} – ${sb}` : "vs"}</span>
        <span class="min-w-0 overflow-hidden flex justify-end ${win(sb, sa)}">${managerTag(b)}</span>
      </div>
      ${live ? `<div class="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden flex">
        <span style="width:${(sa / Math.max(1, sa + sb)) * 100}%;background:${managerColor(a)}"></span>
        <span style="width:${(sb / Math.max(1, sa + sb)) * 100}%;background:${managerColor(b)}"></span>
      </div>` : ""}
      <div class="mt-1 text-[11px] ${mine ? "text-wcgold" : "text-slate-400"}">${
        live ? "View line-ups & points →" : "View line-ups →"}</div>
    </button>`;
  };

  const state = rnd < played ? "final" : rnd === played ? "in progress" : "upcoming";
  box.innerHTML = `
    <div class="flex items-center gap-1">
      <button data-fixnav="-1" ${rnd <= 1 ? "disabled" : ""} class="px-2 py-1 rounded text-lg ${
        rnd <= 1 ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}">‹</button>
      <div class="flex-1 text-center min-w-0">
        <div class="text-sm font-semibold">Round ${rnd}${rumble ? " ⚔️" : ""}</div>
        <div class="text-xs text-slate-400">${state} · round ${rnd} of ${total}</div>
      </div>
      <button data-fixnav="1" ${rnd >= total ? "disabled" : ""} class="px-2 py-1 rounded text-lg ${
        rnd >= total ? "text-slate-700" : "text-wcgold hover:bg-slate-800"}">›</button>
    </div>
    ${placement
      ? `<p class="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">⚔️ Rumble round — everyone is scored against the whole league by placement, so there are no pairings.</p>`
      : (fixtures.map(row).join("")
        || '<p class="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">No fixtures for this round.</p>')}
    ${rumble && !placement ? '<p class="text-xs text-slate-400 text-center">⚔️ Rumble round — everyone plays everyone.</p>' : ""}`;

  box.querySelectorAll("[data-fixnav]").forEach((b) => b.onclick = () => {
    S.fixRound = rnd + Number(b.dataset.fixnav);
    renderFixturesTab();
  });
  box.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => {
    const [aId, bId] = b.dataset.fix.split("|");
    // Draw whichever side is yours at your end of the pitch.
    const bot = me && bId === me.id ? bId : aId;
    openH2HFixture(rnd, bot, bot === aId ? bId : aId);
  });
}

// The head-to-head log table (shown in the Table tab when H2H is enabled).
/* A manager's last five head-to-head results, newest last — the one column
   that makes a league table feel like something is happening rather than a
   list of totals. */
function h2hFormOf(mgrId, maxRound) {
  const scores = h2hRoundScores();
  const out = [];
  for (let r = 1; r <= maxRound; r++) {
    const { fixtures } = h2hRoundFixtures(r);
    const f = fixtures.find((x) =>
      x.home_manager_id === mgrId || x.away_manager_id === mgrId);
    if (!f || !f.home_manager_id || !f.away_manager_id) continue;
    const other = f.home_manager_id === mgrId ? f.away_manager_id : f.home_manager_id;
    const a = scores[mgrId]?.[r - 1], b = scores[other]?.[r - 1];
    if (a == null || b == null) continue;
    out.push(a > b ? "W" : a < b ? "L" : "D");
  }
  return out.slice(-5);
}

const FORM_STYLE = { W: "bg-emerald-500/25 text-emerald-300 border-emerald-500/40",
  D: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  L: "bg-red-500/20 text-red-300 border-red-500/40" };

function h2hStandingsHtml(me) {
  const { rows, order } = h2hStandings();
  const cfg = h2hConfig();
  const played = h2hCurrentRound();
  const mgrOf = (id) => S.managers.find((m) => m.id === id);
  const anyPlayed = order.some((id) => rows[id].P > 0);

  const body = order.map((id, i) => {
    const r = rows[id], m = mgrOf(id);
    const form = anyPlayed ? h2hFormOf(id, played) : [];
    return `<details data-mgr="${esc(id)}" class="rounded-xl border ${
      id === me?.id ? "border-wcgold/40 bg-wcgold/5" : "border-slate-700 bg-slate-900"}">
      <summary class="px-3 py-2.5 cursor-pointer select-none flex items-center gap-2">
        <span class="w-5 shrink-0 text-slate-400 font-mono text-sm">${i + 1}</span>
        <span class="shrink-0 inline-flex items-center justify-center rounded-md w-8 h-8 text-[15px]"
              style="background:${managerColor(m)}22;border:1px solid ${managerColor(m)}88">${managerMark(m)}</span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold truncate text-sm">${esc(m?.name || "?")}${
            id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""}</span>
          <span class="flex items-center gap-1 mt-0.5">
            ${form.length
              ? form.map((x) => `<span class="inline-flex items-center justify-center w-4 h-4 rounded border text-[9px] font-bold ${FORM_STYLE[x]}">${x}</span>`).join("")
              : '<span class="text-xs text-slate-400">no results yet</span>'}
            ${r.bonus ? `<span class="text-[11px] text-emerald-400 ml-1">+${r.bonus} bonus</span>` : ""}
          </span>
        </span>
        <!-- Points for and against belong on the row: they are the tiebreak
             and the story of a season, not a detail to expand for. -->
        <span class="shrink-0 text-right leading-tight">
          <span class="block font-bold text-wcgold scoreboard leading-none">${r.logPts}</span>
          <span class="block text-[10px] text-slate-400 mt-0.5">${r.W}-${r.D}-${r.L}</span>
          <span class="block text-[10px] text-slate-500 font-mono">${r.PF}<span class="text-slate-600">:</span>${r.PA}</span>
        </span>
      </summary>
      <div class="px-3 pb-3 space-y-2">
        <div class="grid grid-cols-4 gap-1 text-center">
          ${[["Played", r.P], ["For", r.PF], ["Against", r.PA], ["Diff", (r.PF - r.PA > 0 ? "+" : "") + (r.PF - r.PA)]]
            .map(([k, v]) => `<div class="rounded-lg bg-slate-800/60 py-1.5">
              <div class="text-sm font-bold scoreboard">${v}</div>
              <div class="eyebrow">${k}</div></div>`).join("")}
        </div>
        <div id="hist-lb-${esc(id)}"></div>
      </div>
    </details>`;
  }).join("");

  return `<div class="space-y-2">
    <div class="flex items-baseline justify-between gap-2 px-1">
      <span class="text-sm font-semibold">Head-to-head log</span>
      <span class="eyebrow">pts · W-D-L · for:against</span>
    </div>
    <div class="text-[11px] text-slate-500 px-1 -mt-1">${played} round${played === 1 ? "" : "s"} played</div>
    ${body || '<p class="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">No completed rounds yet.</p>'}
    <details class="rounded-xl border border-slate-800 bg-slate-900/40">
      <summary class="px-3 py-2 cursor-pointer select-none text-xs uppercase tracking-wide text-slate-400">How the log is scored</summary>
      <p class="px-3 pb-3 text-xs text-slate-400">Win ${cfg.win} · draw ${cfg.draw} · loss ${cfg.loss} · +1 attacking (round ≥ ${cfg.score_bonus}) · +1 losing (by ≤ ${cfg.losing_margin}). For/Against are fantasy points scored and conceded.${
        cfg.rumble ? (cfg.rumble_scoring === "placement"
          ? ` ⚔️ Rumble rounds score by placement (${(cfg.rumble_points || [3, 2, 1]).join("-")}).`
          : " ⚔️ Rumble rounds pit everyone against everyone.") : ""}</p>
    </details>
  </div>`;
}

function renderBoard() {
  // Pre-draft browsing: default to Stats (the shortlistable player list).
  const preDraft = !S.league?.current_pick && S._browsing;
  if (preDraft && S.boardTab !== "stats") S.boardTab = "stats";
  setBoardTab(S.boardTab || "home");
  renderBanner();
  // The fixture ticker costs ~200px at the top of the screen. It's context for
  // your team and the table; on Players/Activity it just pushes the real
  // content below the fold, so show it only where it earns its place.
  // Decide per SECTION, not per pane — inside League the ticker was appearing
  // on Table and Bracket but vanishing on Squads, which just reads as a bug.
  const bannerGroups = ["team", "league"];
  // Pre-draft the banner carries the "← Lobby" button, so it must stay visible
  // even on Players, where the fixture ticker would otherwise be hidden.
  $("board-banner").classList.toggle("hidden",
    !preDraft && !bannerGroups.includes(groupOfTab(S.boardTab)));
  const note = $("board-rules-note");
  if (note) {
    note.textContent = boardRulesNote();
    /* Retired everywhere. Every section that needs the rules now has a proper
       card — Team's "How points are scored", League's "How the log is scored",
       the scouting room's button — and an unboxed paragraph of scoring rules
       under the chat window or the player list was never relevant to either. */
    note.classList.add("hidden");
  }
  maybeSquadReveal();
  maybeAutoRecap();
  maybeRoundup();
  // Pre-draft shortlisting is its own job, not a tab of the live app: there is
  // no team, table or activity yet, and dropping someone into the full board
  // just to star players is disorienting. Strip it back to a titled page with
  // one way out, and put the shortlist itself on screen.
  if (preDraft) $("board-subtabs")?.classList.add("hidden");
  const slPanel = $("predraft-shortlist");
  if (slPanel) slPanel.classList.toggle("hidden", !preDraft);
  if (preDraft) {
    // The last screen before the draft should feel like the moment before
    // kick-off, not a filter panel: your pick number, the size of the squad
    // you're about to build, and how far along your board is.
    const meP = myManager();
    const seats = S.managers.length;
    const per = picksPerManager();
    const have = (meP?.shortlist || []).length;
    const slot = meP?.draft_position;
    const cov = shortlistCoverage(have, seats, per, slot);
    $("board-banner").innerHTML = `<div class="rounded-xl border border-wcgold/50 bg-gradient-to-br from-wcred/25 via-slate-900 to-slate-900 p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="eyebrow text-wcgold">Scouting room</div>
          <div class="text-xl font-bold leading-tight">Build your board</div>
        </div>
        <button id="board-tolobby" class="shrink-0 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold">← Lobby</button>
      </div>
      <div class="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <div class="rounded-lg bg-slate-800/70 py-1.5">
          <div class="text-lg font-bold scoreboard leading-none">${slot ? "#" + slot : "—"}</div>
          <div class="eyebrow">your pick</div></div>
        <div class="rounded-lg bg-slate-800/70 py-1.5">
          <div class="text-lg font-bold scoreboard leading-none">${seats}</div>
          <div class="eyebrow">managers</div></div>
        <div class="rounded-lg bg-slate-800/70 py-1.5">
          <div class="text-lg font-bold scoreboard leading-none">${per}</div>
          <div class="eyebrow">rounds</div></div>
      </div>
      <div class="mt-2">
        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span id="predraft-have" class="text-slate-300">${have} starred</span>
          <span id="predraft-hint" class="text-slate-400">${coverageHint(cov, per)}</span>
        </div>
        <div class="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <span id="predraft-bar" class="block h-full rounded-full ${
            cov.through >= per ? "bg-live" : "bg-wcgold"}" style="width:${
            Math.round((cov.through / Math.max(1, per)) * 100)}%"></span>
        </div>
      </div>
      <button id="board-scoring" class="mt-2 w-full rounded-lg bg-slate-800/80 border border-slate-700 py-2 text-xs font-semibold text-left px-3">
        📋 How points are scored <span class="font-normal text-slate-400">· by position</span></button>
      <p class="text-xs text-slate-400 mt-2">Star players below. If your pick clock runs out, auto-pick takes the top name still available — so the order matters.</p></div>`;
    const btl = $("board-tolobby");
    if (btl) btl.onclick = () => { S._browsing = false; route(); };
    const bsc = $("board-scoring");
    if (bsc) bsc.onclick = openScoringSheet;
    renderPredraftShortlist();
  }
  renderHomeTab();
  const open = new Set([...document.querySelectorAll("#board-lb details[open]")]
    .map((d) => d.dataset.mgr));
  const me = myManager();
  // The official table is Total (player points + national-team stage bonuses).
  // "Player points only" (total − teamPts) is a secondary, just-for-fun view.
  const playerView = S.tableView === "player";
  const valueOf = (s) => playerView ? s.total - (s.teamPts || 0) : s.total;
  const scores = computeScores().sort((a, b) => valueOf(b) - valueOf(a));
  const yetByMgr = computeYetToPlay();
  const mv = standingsMovement(scores);
  const showMove = mv.showMovement && !playerView;   // arrows rank by Total
  const mvps = roundMVPs(scores);
  bumpChangedTotals(scores, playerView);
  const chartHtml = seasonChartHtml(scores, me?.id);
  const toggleHtml = `
    <div class="flex gap-1 rounded-lg bg-slate-900 border border-slate-700 p-1 text-sm">
      <button data-tableview="total" class="flex-1 rounded-md py-1.5 font-semibold ${
        !playerView ? "bg-wcred text-white" : "text-slate-400"}">🏆 Total <span class="text-xs font-normal opacity-80">official</span></button>
      <button data-tableview="player" class="flex-1 rounded-md py-1.5 font-semibold ${
        playerView ? "bg-wcred text-white" : "text-slate-400"}">⚽ Player pts <span class="text-xs font-normal opacity-80">for fun</span></button>
    </div>
    ${playerView ? `<p class="text-xs text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-1.5">⚽ Player-points-only — just for fun. The official standings are 🏆 <b>Total</b> (national-team stage bonuses included).</p>` : ""}`;
  if (h2hEnabled()) {
    // The season chart only exists once two rounds have been scored; before
    // that its placeholder was the largest thing on the tab, saying nothing.
    const { maxR } = seasonSeries(scores);
    $("board-lb").innerHTML = (maxR >= 2 ? chartHtml : "") + h2hStandingsHtml(me)
      + '<button id="lb-awards" class="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-sm font-semibold text-slate-300">🏆 Season awards</button>';
    const cc0 = document.getElementById("chart-compare");
    if (cc0) cc0.onchange = () => { S.chartCompare = cc0.value || null; renderBoard(); };
    const aw0 = document.getElementById("lb-awards");
    if (aw0) aw0.onclick = openAwards;
    for (const m of S.managers)
      renderHistInto("hist-lb-" + m.id, m.id, `${m.name}'s lineup`);
    renderFixturesTab();
    renderRosters("board-rosters"); renderStatsTab(); renderTrades(); renderChat(); renderBracket();
    renderTestBench();
    return;
  }
  $("board-lb").innerHTML = chartHtml + toggleHtml + scores.map((s, i) => {
    const ytp = yetByMgr[s.manager.id];
    const ytpLine = ytp?.hasSnapshot && ytp.total > 0
      ? `<span class="shrink-0">${ytp.yet}/${ytp.total} yet to play</span>`
      : "";
    const mvi = mv.byId[s.manager.id];
    const icon = (showMove && !s.eliminated) ? movementIcon(mvi.delta) : "";
    const rp = mvi.roundPts;
    const tallyLine = (mv.maxRound >= 1 && !s.eliminated)
      ? `<span class="block text-xs font-normal ${
          rp > 0 ? "text-emerald-400" : rp < 0 ? "text-red-400" : "text-slate-400"
        }">${rp >= 0 ? "+" : "−"}${Math.abs(rp)} this round</span>`
      : "";
    return `
    <details data-mgr="${s.manager.id}" class="rounded-xl border border-slate-700 ${
      s.eliminated ? "bg-slate-900/50 opacity-60" : "bg-slate-900"}"
             ${open.has(s.manager.id) ? "open" : ""}>
      <summary class="px-4 py-3 cursor-pointer select-none flex items-center gap-3">
        <span class="text-slate-400 font-mono w-6">${i + 1}.</span>
        ${showMove ? `<span class="w-3 text-center text-xs shrink-0">${icon}</span>` : ""}
        <span class="shrink-0 inline-flex items-center justify-center rounded-md w-7 h-7 text-[14px]"
              style="background:${managerColor(s.manager)}22;border:1px solid ${managerColor(s.manager)}88">${managerMark(s.manager)}</span>
        <span class="flex-1 min-w-0">
          <span class="block font-semibold truncate">${esc(s.manager.name)}${
            s.manager.id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""}</span>
          <span class="flex items-center gap-1 flex-wrap text-xs text-slate-400">
            ${mvps.has(s.manager.id) ? `<span class="shrink-0 rounded bg-wcgold/20 text-wcgold px-1 py-0.5 font-bold" title="Top scorer of round ${mv.maxRound}">🏅 MVP</span>` : ""}${
            formBadge(s.manager.id)}${
            s.eliminated ? '<span class="shrink-0 text-red-400">eliminated</span>' : ""}
            ${ytpLine}</span>
        </span>
        <span class="shrink-0 text-right">
          <span class="block font-bold text-wcgold scoreboard" data-total="${s.manager.id}">${valueOf(s)} pts</span>
          ${tallyLine}
        </span>
      </summary>
      <div id="hist-lb-${s.manager.id}" class="px-4 pb-3"></div>
    </details>`;
  }).join("") + `<button id="lb-awards" class="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-sm font-semibold text-slate-300">🏆 Season awards</button>`;
  const awb = document.getElementById("lb-awards");
  if (awb) awb.onclick = openAwards;
  const cc = document.getElementById("chart-compare");
  if (cc) cc.onchange = () => { S.chartCompare = cc.value || null; renderBoard(); };
  $("board-lb").querySelectorAll("[data-tableview]").forEach((b) => b.onclick = () => {
    S.tableView = b.dataset.tableview; renderBoard();
  });
  // Fill each manager's history pager (current lineup + past rounds).
  for (const s of scores)
    renderHistInto("hist-lb-" + s.manager.id, s.manager.id, `${s.manager.name}'s lineup`);
  renderFixturesTab();
  renderRosters("board-rosters");
  renderStatsTab();
  renderTrades();
  renderChat();
  renderBracket();
  renderTestBench();
}

/* The test bench lives in sim.js. app.js must not depend on it existing, so
   this is the only seam between them: if the file is absent, or the account is
   not a product owner, nothing happens and no tab was offered in the first
   place. */
function renderTestBench() {
  if (typeof renderTestTab === "function" && isAppOwner()) {
    try { renderTestTab(); } catch (e) { console.error("test bench:", e); }
  }
}

/* ---------- player stats tab ---------- */

S.statsPos = "ALL";
S.statsSearch = "";
S.statsSort = "points";
S.statsPer90 = false;   // Stats tab: show per-90 rates instead of totals
S.statsRound = 0;       // Stats tab: scope to a round (0 = whole tournament)
S.statsView = "list";   // Stats tab: "list" leaderboard or "dream" best XI
S.statsTeam = "";       // Stats tab: club filter ("" = all clubs)
S.histIdxByMgr = {};   // manager id -> history pager index (0 = current)
S.chartCompare = null; // Table season chart: manager id to compare against (H2H)
S.tableView = "total"; // Table: "total" (official, incl. teams) or "player" (for fun)
S.fixRound = null;     // Fixtures tab: round being viewed (null = the live one)
S.homeScoreMode = "total"; // current-lineup view: "total" or "round" points
S.formerOpen = {};     // manager id -> former-players section expanded?
S.messages = [];       // chat messages (group + DMs) for this league
S.chatThread = "league"; // active chat thread: "league" or a manager id (DM)
S.chatSeen = {};       // thread id -> last-seen message timestamp (unread calc)
S.reactPickerFor = null; // chat: message id whose emoji picker is open
const REACT_EMOJIS = ["👍", "❤️", "😂", "🔥", "😮", "😢"];

// Toggle my emoji reaction on a chat message (read-modify-write the jsonb;
// optimistic, realtime syncs the rest). At friend-group scale the rare
// simultaneous-write race is acceptable.
async function toggleReaction(msgId, emoji) {
  const me = myManager();
  if (!me) return;
  const msg = (S.messages || []).find((m) => m.id === msgId);
  if (!msg) return;
  const reactions = { ...(msg.reactions || {}) };
  const set = new Set(reactions[emoji] || []);
  set.has(me.id) ? set.delete(me.id) : set.add(me.id);
  if (set.size) reactions[emoji] = [...set]; else delete reactions[emoji];
  msg.reactions = reactions;                 // optimistic
  S.reactPickerFor = null;
  renderChat();
  const { error } = await S.sb.from("messages").update({ reactions }).eq("id", msgId);
  if (error) toast(/reaction|column|schema cache/.test(error.message)
    ? "Reactions need a schema update — run schema.sql." : error.message);
}
S.admOpenLabels = null; // admin stats history: which match groups are expanded
S.tradeTab = "deals";      // Trades tab: deals | planner | watch | history
S.wlPos = "ALL"; S.wlTeam = ""; S.wlSort = "points"; S.wlPer90 = false; S.wlFree = false;
S.faTarget = null;         // free agent you are chasing, carried across the flow

S.poolPlannerOnly = false; // draft pool: filter to planner choices
S.plannerPickFor = null;   // out pick id the choice picker is adding to
S.plannerSearch = "";      // choice picker search
S.plannerSort = "points";  // choice picker stat sort/leaderboard
S.plannerShortlistOnly = false; // choice picker: show only shortlisted
S.plannerUnpicked = false; // choice picker: show only unpicked (free agents)
S.plannerHideKO = false;   // choice picker: hide knocked-out players
S.statsUnpicked = false;   // Stats tab: show only unpicked (free agents)
S.statsHideKO = false;     // Stats tab: hide knocked-out players

// Set of every player_id currently on a roster (owned). Rebuilt per call;
// cheap at this scale. Used by the "unpicked only" filters.
// Rebuilt only when the picks array changes: the draft path asks for this many
// times per render, and it was allocating a fresh Set over every pick each time.
let _pickedSet = null, _pickedFor = null;
const pickedIdSet = () => {
  if (_pickedFor !== S.picks) {
    _pickedFor = S.picks;
    _pickedSet = new Set(S.picks.map((pk) => pk.player_id));
  }
  return _pickedSet;
};

// Stats-tab ranking options: label + the match_stats key to total. "points"
// uses the full fantasy total; the rest are raw counts from existing
// columns (no schema change — works on the running league immediately).
const STAT_SORTS = [
  ["points", "Points"], ["goals", "Goals"], ["assists", "Assists"],
  ["defensive_actions", "Def. actions"], ["clean_sheet", "Clean sheets"],
  ["saves", "Saves"], ["motm", "MOTM"], ["yellow_cards", "Yellow cards"],
  ["red_cards", "Red cards"], ["penalty_saved", "Pens saved"],
  ["penalty_missed", "Pens missed"],
];

const statRowsFor = (pid) =>
  (S.stats || []).filter((r) => r.player_id === pid);

// Per-rule breakdown for one player; the pts sum equals playerPoints()
// (each rule evaluated per match, so 'per N' floors match-by-match).
function playerBreakdown(pid, pos) {
  const acc = scoringRules().map((rule) => ({ rule, count: 0, pts: 0 }));
  for (const r of statRowsFor(pid)) {
    if (!r.appeared) continue;
    const raw = rawStatsOf(r);
    for (const a of acc) {
      a.count += raw[a.rule.stat] || 0;
      a.pts += evalRule(a.rule, raw, pos);
    }
  }
  return acc.filter((a) => a.count || a.pts).map((a) => ({
    label: STAT_LABEL[a.rule.stat] || a.rule.stat, count: a.count, pts: a.pts,
  }));
}

function statBits(r) {
  const bits = [];
  if (!r.appeared) bits.push("DNP");
  if (r.goals) bits.push(r.goals + "g");
  if (r.assists) bits.push(r.assists + "a");
  if (r.clean_sheet) bits.push("CS");
  if (r.saves) bits.push(r.saves + "sv");
  if (r.defensive_actions) bits.push(r.defensive_actions + "da");
  if (r.yellow_cards) bits.push(r.yellow_cards + "Y");
  if (r.red_cards) bits.push("R");
  if (r.motm) bits.push("MOTM");
  if (r.penalty_saved) bits.push(r.penalty_saved + "PS");
  if (r.penalty_missed) bits.push(r.penalty_missed + "PM");
  return bits.join(" ");
}

const ownerOf = (pid) => {
  const pk = S.picks.find((x) => x.player_id === pid);
  return pk ? S.managers.find((m) => m.id === pk.manager_id)?.name : null;
};
const ownerManager = (pid) => {
  const pk = S.picks.find((x) => x.player_id === pid);
  return pk ? S.managers.find((m) => m.id === pk.manager_id) || null : null;
};

/* Who owns this player, as a single ~18px mark: their crest, or their initial
   on their accent colour. A name here either truncated to "👤 …" or, once it
   stopped shrinking, pushed the position chip off the row — and on a phone the
   team name is worth more than spelling the owner out. The full name is in the
   tooltip and on the player sheet. */
function ownerChipHtml(pid) {
  const m = ownerManager(pid);
  if (!m) return "";
  const c = managerColor(m);
  const mark = managerCrest(m) || (m.name || "?").trim().charAt(0).toUpperCase();
  return `<span class="shrink-0 inline-flex items-center justify-center rounded w-[18px] h-[18px] text-xs font-bold leading-none"
    style="background:${c}33;border:1px solid ${c}99;color:#e2e8f0"
    title="Owned by ${esc(m.name)}">${mark}</span>`;
}

/* ---------- availability (suspensions & injuries) and avatars ---------- */

// FIFA wipes accumulated single yellows at two stage boundaries so an early
// booking never carries too far: after the GROUP STAGE (a group yellow doesn't
// follow you into the knockouts) and after the QUARTER-FINALS (nothing carries
// to the semis — so a 2nd yellow *in the QF* still bans you for the semi, but a
// lone yellow in the semi does not). The boundary dates are derived from the
// fixture schedule so they stay correct: the first Round-of-32 date, and the
// first semi-final date — or, until the semis are published, the day after the
// last quarter-final (so every QF sits in the same accumulation window).
let _yrd = null, _yrdFor = null;
function yellowResetDates() {
  if (_yrdFor === S.fixtures && _yrd) return _yrd;
  const fx = S.fixtures || [];
  const firstDate = (key) => fx.filter((f) => koRoundOf(f.round) === key)
    .map((f) => f.date).filter(Boolean).sort()[0] || null;
  const r32 = firstDate("R32");
  let postQF = firstDate("SF");
  if (!postQF) {
    const qf = fx.filter((f) => koRoundOf(f.round) === "QF")
      .map((f) => f.date).filter(Boolean).sort();
    if (qf.length) {
      const d = new Date(qf[qf.length - 1] + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);           // day after the last QF
      postQF = d.toISOString().slice(0, 10);
    }
  }
  _yrd = [r32 || "2026-06-28", postQF || "2026-07-14"];
  _yrdFor = S.fixtures;
  return _yrd;
}

// Which accumulation window a match date falls in (0 = group, 1 = R32..QF,
// 2 = semis onward). Yellows only combine within the same window.
const yellowWindow = (d) => yellowResetDates().filter((r) => String(d) >= r).length;

// Best-effort "suspended for their next match" from our own card data:
// a red in their latest appearance, or an even count of single-yellow
// matches *in the current window* with the latest appearance booked (2nd/4th
// yellow triggers a one-match ban; playing again clears the flag, i.e. ban
// served). Two yellows in one match arrive as a red and don't count toward
// accumulation.
function suspendedNext(pid) {
  const rows = statRowsFor(pid).filter((r) => r.appeared)
    .sort((a, b) => String(labelDate(a.match_label))
      .localeCompare(String(labelDate(b.match_label))));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  if ((last.red_cards || 0) > 0) return "red card";
  const lastWin = yellowWindow(labelDate(last.match_label));
  const yellows = rows.filter((r) =>
    yellowWindow(labelDate(r.match_label)) === lastWin
    && (r.yellow_cards || 0) > 0 && !(r.red_cards || 0)).length;
  if ((last.yellow_cards || 0) > 0 && !(last.red_cards || 0) && yellows % 2 === 0)
    return "2 yellows";
  return null;
}

const injuryOf = (pid) => (S.injuryByPid || {})[pid] || null;

// Is this team in a match that's kicked off and not yet finished? (Same live
// window as the Home banner: started, not FT/AET/PEN, within ~2.5h.)
function teamPlayingNow(team) {
  const now = Date.now();
  return (S.fixtures || []).some((f) => (f.home === team || f.away === team)
    && !["FT", "AET", "PEN"].includes(f.status)
    && Date.parse(f.kickoff_utc) <= now && Date.parse(f.kickoff_utc) > now - 2.5 * 3600e3);
}

// ⚡ playing now · 🚫 team knocked out · 🟥 suspended next · 🤕 out · ⚠️ doubtful
function availBadges(pid) {
  let out = "";
  const team = S.playerById?.[pid]?.team;
  if (team && teamPlayingNow(team)) out += `<span title="playing now" class="text-emerald-400">⚡</span>`;
  if (team && isEliminated(team)) out += `<span title="team knocked out">🚫</span>`;
  const susp = suspendedNext(pid);
  if (susp) out += `<span title="suspended next match (${susp})" class="rounded bg-red-500/25 text-red-300 px-1 text-xs font-bold align-middle">SUSP</span>`;
  const inj = injuryOf(pid);
  if (inj) out += `<span title="${esc(inj.reason || "injury")}">${
    inj.status === "out" ? "🤕" : "⚠️"}</span>`;
  return out;
}

// Plain-text variant for <option> labels in the trade builder.
function availText(pid) {
  const bits = [];
  const team = S.playerById?.[pid]?.team;
  if (team && isEliminated(team)) bits.push("🚫 KO");
  if (suspendedNext(pid)) bits.push("🟥 susp");
  const inj = injuryOf(pid);
  if (inj) bits.push(inj.status === "out" ? "🤕 out" : "⚠ doubtful");
  return bits.length ? " · " + bits.join(" ") : "";
}

// Team name → API team id, from the pool's players (memoized on S.players
// identity). Lets club crests resolve for API competitions, where photos.json
// has no entries. null for the legacy WC pool (no team_logo on those players).
let _logoMap = null, _logoMapFor = null;
function teamLogoId(team) {
  if (_logoMapFor !== S.players) {
    _logoMapFor = S.players;
    _logoMap = {};
    for (const p of S.players || []) if (p.team_logo && !_logoMap[p.team]) _logoMap[p.team] = p.team_logo;
  }
  return _logoMap[team] ?? null;
}

// Player faces / team crests. API-Football competitions carry each player's
// photo URL (and an api_<id> id) in the shared pool, so use that directly;
// legacy WC-2026 players resolve via the optional static photos.json
// { players: { "arg_10": <api id> }, teams: { "Argentina": <api id> } }.
function avatarHtml(playerId, team, size = "w-7 h-7") {
  const isTeam = String(playerId).startsWith("team:");
  let url = null;
  if (isTeam) {
    const id = S.photos?.teams?.[team] ?? teamLogoId(team);
    if (id) url = `https://media.api-sports.io/football/teams/${id}.png`;
  } else if (String(playerId).startsWith("api_")) {
    // API competition player: stored photo URL, else derived from the api id.
    url = S.playerById?.[playerId]?.photo
      || `https://media.api-sports.io/football/players/${String(playerId).slice(4)}.png`;
  } else {
    const id = S.photos?.players?.[playerId];
    if (id) url = `https://media.api-sports.io/football/players/${id}.png`;
  }
  if (!url) return `<span class="${size} rounded-full bg-slate-800 shrink-0"></span>`;
  return `<span class="${size} rounded-full bg-slate-800 overflow-hidden shrink-0 inline-flex items-center justify-center">
    <img src="${esc(url)}" loading="lazy" data-avatar
         class="w-full h-full ${isTeam ? "object-contain p-0.5" : "object-cover"}" alt=""></span>`;
}

// Per-category season total for a player, for ranking on the Stats tab.
function playerStatTotal(pid, key) {
  let n = 0;
  for (const r of statRowsFor(pid)) {
    if (!r.appeared) continue;
    if (key === "clean_sheet" || key === "motm") n += r[key] ? 1 : 0;
    else n += r[key] || 0;
  }
  return n;
}

/* ---------- Stats-tab depth: round scoping, per-90 rates, recent form ---------- */

// A player's appearance rows, optionally scoped to their team's Nth match
// (round 1..N); round 0/undefined = the whole tournament.
function statsScopedRows(pid, team, round) {
  const rows = statRowsFor(pid).filter((r) => r.appeared);
  if (!round) return rows;
  // Via labelForRound, so a player who changed club mid-season still shows the
  // match they actually played that round, not their new club's fixture.
  const { byPlayer, teamMatches } = statsDerived();
  const label = roundResolvers(byPlayer, teamMatches)
    .labelForRound({ player_id: pid, team }, round);
  return label ? rows.filter((r) => r.match_label === label) : [];
}

// Sum one stat key over rows (clean_sheet/motm count as per-match booleans).
function sumStatKey(rows, key) {
  let n = 0;
  for (const r of rows)
    n += (key === "clean_sheet" || key === "motm") ? (r[key] ? 1 : 0) : (r[key] || 0);
  return n;
}

// Minutes over rows; a played row with unknown minutes counts as a full 90.
const sumMinutes = (rows) =>
  rows.reduce((m, r) => m + (r.minutes != null ? r.minutes : 90), 0);

// Recent form: the player's last n appearances (oldest→newest) with points.
function formLog(pid, pos, n = 5) {
  return statRowsFor(pid).filter((r) => r.appeared)
    .sort((a, b) => String(labelDate(a.match_label))
      .localeCompare(String(labelDate(b.match_label))))
    .slice(-n)
    .map((r) => ({ pts: calcPlayerPoints(r, pos), label: r.match_label }));
}
// Form metric: average fantasy points over the last n appearances (0 if the
// player has none), rounded to one decimal.
function formAvg(pid, pos, n = 5) {
  const log = formLog(pid, pos, n);
  if (!log.length) return 0;
  const sum = log.reduce((s, f) => s + f.pts, 0);
  return Math.round((sum / log.length) * 10) / 10;
}

// Form-dot color by a match's fantasy points: red (negative), grey (blank),
// then a green ramp that BRIGHTENS with the haul (brighter = better game),
// topping out purple for a standout. Thresholds: >2, >5, >10.
function formDotColor(pts) {
  if (pts < 0) return "bg-red-500";
  if (pts === 0) return "bg-slate-600";
  if (pts > 10) return "bg-purple-500";
  if (pts > 5) return "bg-emerald-400";   // brightest green = best
  if (pts > 2) return "bg-emerald-600";
  return "bg-emerald-800";                // 1–2 pts: dim green
}

// Compact form sparkline over the team's last 5 matches (oldest→newest). Each
// dot is colored by the player's points that game; matches they didn't feature
// in show as a black "did not play" dot.
function formDots(pid, pos) {
  const p = S.playerById?.[pid];
  if (!p) return "";
  const labels = teamMatchLabels(p.team);   // newest first
  if (!labels.length) return "";
  const rowByLabel = {};
  for (const r of statRowsFor(pid)) rowByLabel[r.match_label] = r;
  const recent = labels.slice(0, 5).reverse();
  return `<span class="inline-flex items-center gap-0.5 align-middle">${
    recent.map((label) => {
      const r = rowByLabel[label];
      const played = !!(r && r.appeared);
      const pts = played ? calcPlayerPoints(r, pos) : 0;
      const cls = played ? formDotColor(pts) : "bg-black ring-1 ring-slate-500";
      const title = played ? `${esc(label)}: ${pts >= 0 ? "+" : ""}${pts}`
        : `${esc(label)}: did not play`;
      return `<span class="w-1.5 h-1.5 rounded-full ${cls}" title="${title}"></span>`;
    }).join("")}</span>`;
}

// Match-by-match log: every game the player's team has played that we have
// data for — minutes/DNP, stat line, points, and lineup status. With
// managerId the status is relative to that manager (Starter/Sub/not in
// team); without it (global Stats view) it shows who fielded them and how.
function matchLogHtml(pid, position, team, managerId) {
  const rowByLabel = {};
  for (const r of statRowsFor(pid)) rowByLabel[r.match_label] = r;
  /* The player's OWN games, plus their current club's -- not the club's alone.
     Listing only the current club meant a transferred player lost their whole
     history the moment they moved: their old games vanished and the new club's
     earlier fixtures appeared against their name marked "did not play". */
  const labels = [...new Set([...Object.keys(rowByLabel), ...teamMatchLabels(team)])]
    .sort((a, b) => String(labelDate(b)).localeCompare(String(labelDate(a))));
  if (!labels.length)
    return '<p class="text-xs text-slate-400">No matches played yet — this fills in as games are pulled.</p>';
  return `<div class="space-y-1">${labels.map((label) => {
    const r = rowByLabel[label];
    const [home, away] = labelTeams(label);
    // Which club they turned out for THAT day: the stat row knows (match_stats
    // carries it), and only falls back to the current club when it does not.
    const mine = (r && r.team) || team;
    const opp = home === mine ? away : home;
    const homeAt = home === mine;
    const [hs, as] = matchScore(label);
    const played = !!(r && r.appeared);
    const mins = played ? (r.minutes != null ? `${r.minutes}'` : "played") : "did not play";
    const pts = r ? calcPlayerPoints(r, position) : 0;
    let status;
    if (managerId) {
      const s = slotLabel(entryForManagerAt(managerId, pid, label));
      status = s === "starter" ? '<span class="text-wcgold">Starter</span>'
        : s === "sub" ? '<span class="text-sky-300">Sub</span>'
        : '<span class="text-slate-500">not in team</span>';
    } else {
      const os = ownerEntryAt(pid, label);
      status = os
        ? `<span class="text-wcgold">${esc(os.manager.name)}</span><span class="text-slate-400"> ${
            slotLabel(os.entry) === "sub" ? "(sub)" : "(start)"}</span>`
        : '<span class="text-slate-500">free agent</span>';
    }
    return `<div class="rounded-lg bg-slate-800/60 px-2 py-1.5">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-slate-400 shrink-0">${homeAt ? "vs" : "@"}</span>
        ${avatarHtml("team:" + opp, opp, "w-4 h-4")}
        <span class="truncate text-slate-300">${esc(opp)}
          <span class="text-slate-400">${hs}–${as}</span></span>
        <span class="ml-auto shrink-0 font-mono ${
          pts > 0 ? "text-wcgold" : pts < 0 ? "text-red-400" : "text-slate-400"}">${pts}p</span>
      </div>
      <div class="flex items-center gap-2 text-xs mt-0.5">
        <span class="shrink-0">${status}</span>
        <span class="text-slate-400 shrink-0">${mins}</span>
        <span class="ml-auto truncate text-slate-400">${played ? (statBits(r) || "no stats") : ""}</span>
      </div>
    </div>`;
  }).join("")}</div>`;
}

// Shared player-detail card body: header, points breakdown, and match log.
// Used by the Stats tab (global) and the Home roster sheet (opts.managerId
// = you, so the log shows your starter/sub/not-in-team status per game).
function playerDetailHtml(p, opts = {}) {
  const total = playerPoints(p.player_id, p.position);
  const breakdown = playerBreakdown(p.player_id, p.position);
  const owner = ownerOf(p.player_id);
  // Next fixture: opponent crest + date/time.
  const fx = fixtureCrestHtml(p.team);
  const fxLine = fx ? `<div class="flex items-center gap-1.5 text-xs text-slate-400">
      <span class="text-slate-400">Next:</span> ${fx}</div>` : "";
  // Depth line: appearances, minutes, points-per-90 and a recent-form sparkline.
  const appRows = statRowsFor(p.player_id).filter((r) => r.appeared);
  const mins = sumMinutes(appRows);
  const per90pts = mins > 0 ? Math.round((total / mins) * 90 * 10) / 10 : 0;
  const dots = formDots(p.player_id, p.position);
  const statLine = appRows.length ? `<div class="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
      <span>${appRows.length} app${appRows.length === 1 ? "" : "s"}</span>
      <span class="text-slate-500">·</span><span>${mins}′</span>
      <span class="text-slate-500">·</span><span>${per90pts} pts/90</span>${
        dots ? `<span class="text-slate-500">·</span><span class="flex items-center gap-1">Form ${dots}</span>` : ""}
    </div>` : "";
  /* The card is three bands, in order of what you came here for: who this is,
     what they've scored, and the detail. Previously the close button, the score
     and the shortlist star were stacked in one right-hand column, which read as
     three unrelated controls with the number floating between them. The close
     button now sits out of the flow entirely, the score owns the right of the
     identity band, and the shortlist becomes a labelled action beside the
     season line rather than a lone glyph. */
  const shortlisted = isShortlisted(p.player_id);
  return `
    <div class="relative">
      ${opts.closeId ? `<button id="${opts.closeId}" aria-label="Close"
        class="absolute -top-1 -right-1 tap text-slate-400 hover:text-slate-200">✕</button>` : ""}
      <div class="flex items-center gap-3 pr-8">
        ${avatarHtml(p.player_id, p.team, "w-14 h-14")}
        <div class="min-w-0 flex-1">
          <div class="font-bold text-lg leading-tight break-words">${esc(p.name)}</div>
          <div class="flex items-center gap-1.5 flex-wrap mt-1 text-xs text-slate-400">
            <span class="pos-${p.position} rounded px-1.5 py-0.5 font-semibold">${p.position}</span>
            ${availBadges(p.player_id)}
            <span class="inline-flex items-center gap-1">${teamCrestHtml(p.team, "w-4 h-4")}${esc(p.team)}</span>
          </div>
          <div class="text-xs text-slate-400 mt-0.5">${
            owner ? `👤 ${esc(owner)}` : "free agent"}</div>
        </div>
        <div class="shrink-0 text-right">
          <div class="text-3xl font-bold text-wcgold scoreboard leading-none">${total}</div>
          <div class="eyebrow mt-1">pts</div>
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
      <div class="min-w-0 text-xs text-slate-400">${
        appRows.length ? `${appRows.length} app${appRows.length === 1 ? "" : "s"} · ${mins}′ · ${per90pts} pts/90${
          dots ? "" : ""}` : "No appearances yet"}</div>
      <button data-star="${esc(p.player_id)}" class="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        shortlisted ? "border-wcgold/60 text-wcgold" : "border-slate-700 text-slate-400"}">${
        shortlisted ? "★ Shortlisted" : "☆ Shortlist"}</button>
    </div>
    ${dots ? `<div class="flex items-center gap-1.5 text-xs text-slate-400"><span class="eyebrow">Form</span>${dots}</div>` : ""}
    ${fxLine}
    ${breakdown.length ? `<table class="w-full text-xs"><tbody>
      ${breakdown.map((r) => `<tr class="border-b border-slate-800">
        <td class="py-1 text-slate-400">${r.label}</td>
        <td class="py-1 text-right font-mono">×${r.count}</td>
        <td class="py-1 text-right font-mono w-12 ${
          r.pts > 0 ? "text-wcgold" : r.pts < 0 ? "text-red-400" : "text-slate-400"
        }">${r.pts > 0 ? "+" : ""}${r.pts}</td>
      </tr>`).join("")}
    </tbody></table>` : ""}
    <div class="text-xs uppercase tracking-wide text-slate-400 pt-1">Match by match${
      opts.managerId ? " · " + (opts.perspectiveLabel || "your lineup") : ""}</div>
    ${matchLogHtml(p.player_id, p.position, p.team, opts.managerId)}`;
}

// Player detail in a bottom sheet (Home, Stats, shortlist, draft pool).
function openPlayerDetail(pid, managerId, perspectiveLabel) {
  const p = S.playerById[pid];
  if (!p) return;
  $("player-sheet-body").innerHTML =
    `<div class="space-y-3">${playerDetailHtml(p,
      { managerId, perspectiveLabel, closeId: "player-sheet-close" })}</div>`;
  $("player-sheet").classList.remove("hidden");
  $("player-sheet-close").onclick = () => $("player-sheet").classList.add("hidden");
  wireStars($("player-sheet-body"), () => openPlayerDetail(pid, managerId, perspectiveLabel));
}

// Best starting XI by scoped points (per-90 optional), grouped by position.
// round 0 = cumulative; round k = each team's k-th match. Only players who
// appeared in scope are eligible. When the league's redraft grants a flex slot
// (leagueFlex() > 0), FLEX holds the best remaining outfielder(s) — any of
// DEF/MID/FWD not already in the XI. Returns { GK,DEF,MID,FWD, FLEX, total }.
/* The best XI by the current scoring — or, with `worst`, the Nightmare XI.
   A bad score only means something over a real shift, so the nightmare side
   requires a full 90 minutes: otherwise it is just a list of substitutes who
   came on for five minutes and touched the ball twice. */
function dreamTeam(round, per90, worst) {
  const quota = starterQuota();
  /* lineupFlex, not leagueFlex. leagueFlex is everything in a SQUAD beyond the
     formation minimums -- in a flex league that is squadSize minus the mins,
     so the "best XI" came out as a full 15-man roster. The XI's fluid places
     are what belong here. */
  const flex = lineupFlex();
  const bySort = worst
    ? (a, b) => a.val - b.val || a.pts - b.pts || a.p.name.localeCompare(b.p.name)
    : (a, b) => b.val - a.val || b.pts - a.pts || a.p.name.localeCompare(b.p.name);
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const id of new Set((S.stats || []).map((r) => r.player_id))) {
    const p = S.playerById[id];
    if (!p || !byPos[p.position]) continue;
    const rows = statsScopedRows(id, p.team, round);
    if (!rows.length) continue;                         // didn't play in scope
    const pts = rows.reduce((s, r) => s + calcPlayerPoints(r, p.position), 0);
    const mins = sumMinutes(rows);
    if ((per90 || worst) && mins < 90) continue;        // too little to rate
    const val = per90 ? Math.round((pts / mins) * 90 * 10) / 10 : pts;
    byPos[p.position].push({ p, pts, mins, val });
  }
  const out = { total: 0, FLEX: [] };
  const used = new Set();
  for (const pos of ["GK", "DEF", "MID", "FWD"]) {
    out[pos] = byPos[pos].sort(bySort).slice(0, quota[pos] || 0);
    for (const x of out[pos]) used.add(x.p.player_id);
    out.total += out[pos].reduce((s, x) => s + x.pts, 0);
  }
  /* The fluid places used to go to the best outfielders full stop, ignoring
     each position's ceiling -- so a strong week for defenders produced a
     "best XI" of seven of them, eleven players in a shape no manager could
     ever field. The ceilings are the same ones a real line-up must satisfy. */
  if (flex > 0) {
    const { maxs } = lineupShape();
    const room = { DEF: 0, MID: 0, FWD: 0 };
    for (const pos of OUTFIELD) room[pos] = Math.max(0, (maxs[pos] ?? Infinity) - out[pos].length);
    for (const x of OUTFIELD.flatMap((pos) => byPos[pos])
      .filter((x) => !used.has(x.p.player_id)).sort(bySort)) {
      if (out.FLEX.length >= flex) break;
      const pos = x.p.position;
      if (!room[pos]) continue;                       // that position is already full
      room[pos]--; out.FLEX.push(x); used.add(x.p.player_id);
    }
    out.total += out.FLEX.reduce((s, x) => s + x.pts, 0);
  }
  return out;
}

// The furthest round anyone has stats for (each team's Nth match). Shared by
// the home round-toggle highlight and the Dream XI lineup badge.
function currentRoundNo() {
  const { teamMatches } = statsDerived();
  let mx = 0;
  for (const label of new Set((S.stats || []).map((r) => r.match_label))) {
    if (!labelDate(label)) continue;
    const idx = (teamMatches[labelTeams(label)[0]] || []).indexOf(label);
    if (idx + 1 > mx) mx = idx + 1;
  }
  return mx;
}

// Player ids in the current round's Dream XI (memoized on the stats array).
let _dreamIds = null, _dreamIdsFor = null, _dreamIdsRound = null;
function currentRoundDreamIds() {
  const round = currentRoundNo();
  if (_dreamIdsFor === S.stats && _dreamIdsRound === round && _dreamIds) return _dreamIds;
  const dt = dreamTeam(round, false);
  const ids = new Set();
  for (const pos of ["GK", "DEF", "MID", "FWD"]) for (const x of dt[pos]) ids.add(x.p.player_id);
  for (const x of dt.FLEX) ids.add(x.p.player_id);
  _dreamIdsFor = S.stats; _dreamIdsRound = round; _dreamIds = ids;
  return ids;
}

/* The XI on a pitch, like every other squad in the app. It used to be three
   rows of cards, which said "table of players" rather than "team". */
function renderDreamTeam(round, per90, worst) {
  const dt = dreamTeam(round, per90, worst);
  const quota = starterQuota();
  const mgrByPid = {};
  for (const pk of S.picks) {
    const m = S.managers.find((x) => x.id === pk.manager_id);
    if (m) mgrByPid[pk.player_id] = m;
  }
  const { byPlayer: _byPlayer, teamMatches } = statsDerived();
  const _labelForRound = roundResolvers(_byPlayer, teamMatches).labelForRound;
  // Owner shown per scope: cumulative = who holds them now; a specific round =
  // who had them in their locked roster for that round's match (history).
  const ownerOfP = (p) => {
    if (!round) return mgrByPid[p.player_id] || null;
    const label = _labelForRound({ player_id: p.player_id, team: p.team }, round);
    const e = label ? ownerEntryAt(p.player_id, label) : null;
    return e ? S.managers.find((m) => m.id === e.manager.id) || e.manager : null;
  };

  const flexN = leagueFlex();
  const flexIds = new Set(dt.FLEX.map((x) => x.p.player_id));
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  const entry = (x) => {
    const own = ownerOfP(x.p);
    return { id: x.p.player_id, player_id: x.p.player_id, name: x.p.name, team: x.p.team,
      note: x.val, opp: own ? shortName(own.name) : "free",
      badge: flexIds.has(x.p.player_id) ? "F" : "" };
  };
  for (const pos of ["GK", "DEF", "MID", "FWD"]) {
    for (const x of dt[pos]) byPos[pos].push(entry(x));
    for (let i = dt[pos].length; i < (quota[pos] || 0); i++)
      byPos[pos].push({ ghost: true, name: pos, id: `${pos}-${i}` });
  }
  for (const x of dt.FLEX) byPos[x.p.position]?.push(entry(x));

  const picked = ["GK", "DEF", "MID", "FWD"].reduce((a, g) => a + dt[g].length, 0) + dt.FLEX.length;
  const scope = round ? `Round ${round}` : "Season";
  const title = worst ? "Nightmare XI" : "Dream XI";
  const blurb = worst
    ? `The lowest ${per90 ? "points per 90" : "points"} of anyone who played a full 90 in scope — the XI you would not have wanted.`
    : `The best ${per90 ? "points per 90" : "points"} in each position under this league's scoring.`;
  $("stats-dream").innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="text-sm font-semibold">${title} · ${scope}${per90 ? " · per 90" : ""}</div>
      <div class="text-sm font-mono ${worst ? "text-danger" : "text-wcgold"}">${dt.total}p</div>
    </div>
    <p class="text-xs text-slate-400">${blurb} The name under each shirt is who owns them${
      flexN ? "; Ⓕ marks a flex slot" : ""}.</p>
    ${picked
      ? pitchHtml(byPos, { tapAttr: "data-sp", crests: true })
      : '<p class="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">Not enough minutes logged yet — this fills in once matches are played.</p>'}`;
  $("stats-dream").querySelectorAll("[data-sp]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.sp));
}

/* The pre-draft player list: no ranking, no points column, just the pool laid
   out so you can walk it and star people. Rows are grouped by club when sorted
   that way, because "who's left at Arsenal" is the question you actually ask
   while building a shortlist. */
const SCOUT_CAP = 120;

function renderScoutList(pool, sortKey) {
  const posRank = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const byName = (a, b) => a.name.localeCompare(b.name);
  pool.sort(
    sortKey === "pos" ? ((a, b) => (posRank[a.position] ?? 9) - (posRank[b.position] ?? 9) || byName(a, b))
    : sortKey === "name" ? byName
    : ((a, b) => (a.team || "").localeCompare(b.team || "")
        || (posRank[a.position] ?? 9) - (posRank[b.position] ?? 9) || byName(a, b)));

  const shown = pool.slice(0, SCOUT_CAP);
  const starred = new Set(myManager()?.shortlist || []);
  let lastTeam = null;
  $("stats-list").innerHTML = shown.map((p) => {
    // A club divider whenever the club changes, so the list reads as squads.
    const hdr = sortKey === "team" && p.team !== lastTeam
      ? `<li class="flex items-center gap-2 pt-3 pb-1 sticky top-0 bg-slate-900 z-10">
           ${teamCrestHtml(p.team, "w-5 h-5")}
           <span class="eyebrow">${esc(p.team || "")}</span></li>` : "";
    lastTeam = p.team;
    return hdr + `<li class="flex items-center gap-1 ${starred.has(p.player_id) ? "bg-wcgold/5" : ""}">
      ${starHtml(p.player_id)}
      <button data-sp="${esc(p.player_id)}" class="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
        ${avatarHtml(p.player_id, p.team)}
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1 text-sm min-w-0">
            <span class="truncate">${esc(p.name)}</span>
            <span class="shrink-0 flex items-center gap-1">${availBadges(p.player_id)}</span>
          </span>
          <!-- The club stays on every row. Suppressing it under a club divider
               looked tidy until you filtered to one club and scrolled: the
               header goes off screen and the rows no longer say who they play
               for. A row has to identify a player on its own. -->
          <span class="flex items-center gap-1.5 text-xs text-slate-400">
            ${teamCrestHtml(p.team, "w-3.5 h-3.5")}<span class="truncate">${esc(p.team || "")}</span>
            ${p.number ? `<span class="shrink-0 font-mono">#${esc(p.number)}</span>` : ""}
          </span>
        </span>
        <span class="pos-${p.position} rounded px-1.5 py-0.5 text-xs font-semibold shrink-0">${p.position}</span>
      </button></li>`;
  }).join("") || `<li class="py-4 text-sm text-slate-400">No players match.</li>`;

  const note = $("stats-count");
  note.classList.remove("hidden");
  note.textContent = pool.length > SCOUT_CAP
    ? `Showing ${SCOUT_CAP} of ${pool.length} — pick a club or search to see the rest.`
    : `${pool.length} player${pool.length === 1 ? "" : "s"}`;

  $("stats-list").querySelectorAll("[data-sp]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.sp));
  wireStars($("stats-list"));   // in-place: see wireStars
}

function renderStatsTab() {
  /* Before a ball is kicked this tab is a scouting sheet, not a leaderboard.
     Everything here that is derived from match data — the Dream XI, the round
     picker, per-90 rates, "hide knocked-out", and the ranking itself — has
     nothing to rank yet, and a screen of dead controls above an empty list is
     a bad first impression of the app. In that mode the page becomes: search,
     position, club, and every player in the competition. */
  const scouting = preDraftBrowsing();
  const worst = S.statsView === "nightmare";
  const dream = (S.statsView === "dream" || worst) && !scouting;
  if (scouting) S.statsView = "list";
  $("stats-view").classList.toggle("hidden", scouting);
  /* The Dream/Nightmare XI is per-round and per-90 like everything else --
     dreamTeam() has always taken both -- but the row carrying those controls
     was hidden for it, so there was no way to look at any round but "all". The
     team/sort/search row below stays hidden: ordering a best XI by club is
     meaningless. */
  $("stats-scope").classList.toggle("hidden", scouting);
  $("stats-filters").classList.toggle("hidden", scouting || dream);
  // Nobody is knocked out of a league season, so the filter is noise there.
  $("stats-hideko").classList.toggle("hidden", !isCupCompetition());
  // View toggle (Leaderboard / Dream XI): active-state visuals + wiring.
  $("stats-view").querySelectorAll("[data-statsview]").forEach((b) => {
    const on = b.dataset.statsview === S.statsView;
    b.className = "flex-1 rounded-md py-1.5 font-semibold " +
      (on ? "bg-wcred text-white" : "text-slate-400");
    b.onclick = () => { S.statsView = b.dataset.statsview; renderStatsTab(); };
  });
  // Leaderboard-only controls are hidden in Dream XI mode (round/per-90 shared).
  $("stats-search").classList.toggle("hidden", dream);
  $("stats-listctl").classList.toggle("hidden", dream);
  $("stats-list").classList.toggle("hidden", dream);
  $("stats-dream").classList.toggle("hidden", !dream);
  $("stats-search").placeholder = scouting
    ? "Search any player or club…" : "Search any player or team…";

  // Club filter. Useful all season, essential when scouting — it is the only
  // way to walk a 20-club, 600-player pool squad by squad.
  const teams = [...new Set(S.players.map((p) => p.team).filter(Boolean))].sort();
  $("stats-team").innerHTML = '<option value="">All clubs</option>' + teams.map((t) =>
    `<option value="${esc(t)}" ${S.statsTeam === t ? "selected" : ""}>${esc(t)}</option>`).join("");
  $("stats-team").onchange = () => { S.statsTeam = $("stats-team").value || ""; renderStatsTab(); };
  // A narrowed list that looks like the whole list is how you end up believing
  // a player isn't there. Every active filter says so, and can be cleared.
  const active = [];
  if (S.statsTeam) active.push(["team", S.statsTeam]);
  if (S.statsPos !== "ALL") active.push(["pos", S.statsPos]);
  if (S.statsSearch.trim()) active.push(["search", `“${S.statsSearch.trim()}”`]);
  if (!scouting && S.statsRound) active.push(["round", "Round " + S.statsRound]);
  if (!scouting && S.statsPer90) active.push(["per90", "per 90"]);
  if (!scouting && S.statsUnpicked) active.push(["unpicked", "unpicked only"]);
  if (!scouting && S.statsHideKO) active.push(["hideko", "hiding knocked-out"]);
  const fbar = $("stats-active");
  fbar.classList.toggle("hidden", !active.length);
  fbar.innerHTML = active.length ? `
    <span class="eyebrow text-wcgold shrink-0">Filtered</span>
    ${active.map(([k, label]) => `<button data-clearf="${k}" class="shrink-0 inline-flex items-center gap-1 rounded-full border border-wcgold/50 bg-wcgold/10 text-wcgold px-2 py-0.5 text-xs">
      ${esc(label)}<span class="opacity-70">✕</span></button>`).join("")}
    <button data-clearf="all" class="shrink-0 text-xs text-slate-400 underline ml-auto">clear all</button>` : "";
  fbar.querySelectorAll("[data-clearf]").forEach((b) => b.onclick = () => {
    const k = b.dataset.clearf;
    if (k === "team" || k === "all") S.statsTeam = "";
    if (k === "pos" || k === "all") S.statsPos = "ALL";
    if (k === "search" || k === "all") { S.statsSearch = ""; $("stats-search").value = ""; }
    if (k === "round" || k === "all") S.statsRound = 0;
    if (k === "per90" || k === "all") S.statsPer90 = false;
    if (k === "unpicked" || k === "all") S.statsUnpicked = false;
    if (k === "hideko" || k === "all") S.statsHideKO = false;
    renderStatsTab();
  });

  const chips = ["ALL", ...GROUPS.slice(0, 4)];
  $("stats-chips").innerHTML = chips.map((c) =>
    `<button data-chip="${c}" class="rounded-full px-3 py-1 border ${
      S.statsPos === c ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400"
    }">${c}</button>`).join("");
  $("stats-chips").querySelectorAll("[data-chip]").forEach((b) =>
    b.onclick = () => { S.statsPos = b.dataset.chip; renderStatsTab(); });
  // Sort dropdown = the shared stat options plus a Stats-tab-only "Form".
  // Scouting has no stats to sort by, so it offers the orderings that exist
  // before kickoff: by club, by position, by name.
  const sortOpts = scouting
    ? [["team", "By club"], ["pos", "By position"], ["name", "A–Z"]]
    : [...STAT_SORTS, ["form", "Form · avg last 5"]];
  if (scouting && !sortOpts.some(([k]) => k === S.statsSort)) S.statsSort = "team";
  if (!scouting && sortOpts.every(([k]) => k !== S.statsSort)) S.statsSort = "points";
  $("stats-sort").innerHTML = sortOpts.map(([k, lbl]) =>
    `<option value="${k}" ${S.statsSort === k ? "selected" : ""}>${lbl}</option>`).join("");

  const sortKey = S.statsSort || "points";
  const isForm = !dream && sortKey === "form";  // form is inherently recent
  const per90 = S.statsPer90 && !isForm;
  const round = isForm ? 0 : (S.statsRound || 0);

  // Round selector: each team's k-th match = "round k" (group MD1-3, then the
  // knockouts). Rebuilt each render as more rounds are played.
  const teamMatches = statsDerived().teamMatches;
  const maxRounds = Object.values(teamMatches).reduce((m, a) => Math.max(m, a.length), 0);
  $("stats-round").innerHTML = '<option value="0">All rounds</option>' +
    Array.from({ length: maxRounds }, (_, i) =>
      `<option value="${i + 1}" ${(S.statsRound || 0) === i + 1 ? "selected" : ""}>Round ${i + 1}</option>`).join("");
  $("stats-round").disabled = isForm;
  $("stats-round").classList.toggle("opacity-40", isForm);
  $("stats-per90").className = "rounded-full px-3 py-1 border " +
    (per90 ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400") +
    (isForm ? " opacity-40 pointer-events-none" : "");
  $("stats-unpicked").className = "rounded-full px-3 py-1 border " +
    (S.statsUnpicked ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400");
  $("stats-hideko").className = "rounded-full px-3 py-1 border " +
    (S.statsHideKO ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400");

  $("stats-count").classList.add("hidden");
  if (dream) { renderDreamTeam(round, per90, worst); return; }

  const q = S.statsSearch.trim().toLowerCase();
  let pool;
  if (q) {
    pool = S.players.filter((p) =>
      p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
  } else if (scouting) {
    pool = S.players.slice();          // everyone: nobody has a stats row yet
  } else {
    // default view: everyone who has a stats row, ranked
    const ids = new Set((S.stats || []).map((r) => r.player_id));
    pool = [...ids].map((id) => S.playerById[id]).filter(Boolean);
  }
  if (S.statsPos !== "ALL") pool = pool.filter((p) => p.position === S.statsPos);
  if (S.statsTeam) pool = pool.filter((p) => p.team === S.statsTeam);
  if (!scouting && S.statsHideKO) pool = pool.filter((p) => !isEliminated(p.team));
  if (!scouting && S.statsUnpicked) {
    const owned = pickedIdSet();
    pool = pool.filter((p) => !owned.has(p.player_id));
  }

  if (scouting) { renderScoutList(pool, sortKey); return; }

  const rawVal = (p, rows) => sortKey === "points"
    ? rows.reduce((s, r) => s + calcPlayerPoints(r, p.position), 0)
    : sumStatKey(rows, sortKey);
  let ranked = pool.map((p) => {
    const rows = statsScopedRows(p.player_id, p.team, round);
    const mins = sumMinutes(rows);
    const raw = isForm ? formAvg(p.player_id, p.position) : rawVal(p, rows);
    const val = isForm ? raw
      : per90 ? (mins > 0 ? Math.round((raw / mins) * 90 * 10) / 10 : 0)
      : raw;
    return { p, pts: rows.reduce((s, r) => s + calcPlayerPoints(r, p.position), 0), mins, val };
  });
  // Leaderboards (not free-text search) hide players with nothing to show.
  // The default all-tournament points board keeps everyone (incl. 0/negatives).
  const defaultBoard = sortKey === "points" && !per90 && !isForm && !round;
  if (!q) {
    if (per90) ranked = ranked.filter((x) => x.mins >= 90 && x.val > 0);
    else if (!defaultBoard) ranked = ranked.filter((x) => x.val > 0);
  }
  ranked = ranked
    .sort((a, b) => b.val - a.val || b.pts - a.pts || a.p.name.localeCompare(b.p.name))
    .slice(0, 30);

  $("stats-list").innerHTML = ranked.map(({ p, pts, mins, val }, i) => {
    const owner = ownerOf(p.player_id);
    const dots = formDots(p.player_id, p.position);
    const sub = isForm ? "avg/gm" : per90 ? "/90" : `${pts}p`;
    const showSub = !(sortKey === "points" && !per90);
    return `<li class="flex items-center gap-1">
      ${starHtml(p.player_id)}
      <button data-sp="${esc(p.player_id)}" class="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
        <span class="text-slate-400 font-mono w-6 shrink-0">${q ? "" : i + 1 + "."}</span>
        ${avatarHtml(p.player_id, p.team)}
        <span class="min-w-0 flex-1">
          <!-- The name yields, the status badge doesn't: a half-rendered "S…"
               tells you nothing, whereas a shortened name still identifies. -->
          <span class="flex items-center gap-1 text-sm min-w-0">
            <span class="truncate">${esc(p.name)}</span>
            <span class="shrink-0 flex items-center gap-1">${availBadges(p.player_id)}</span>
          </span>
          <span class="flex items-center gap-1.5 text-xs text-slate-400">
            ${ownerChipHtml(p.player_id)}
            <!-- The three-letter code, not the country name: with an owner mark,
                 form dots and (in per-90) minutes on the same line, the full
                 name was collapsing to "En…" / "Fr…", which says nothing. -->
            <span class="shrink-0 font-mono" title="${esc(p.team)}">${esc(p.team_code || p.team)}</span>${
              per90 ? `<span class="shrink-0">${mins}′</span>` : ""}
            <span class="min-w-0 truncate">${dots}</span></span>
        </span>
        <span class="pos-${p.position} rounded px-1.5 py-0.5 text-xs font-semibold shrink-0">${p.position}</span>
        <span class="shrink-0 w-10 text-right">
          <span class="block font-mono font-bold ${val > 0 ? "text-wcgold" : val < 0 ? "text-red-400" : "text-slate-400"}">${val}</span>
          ${showSub ? `<span class="block text-xs text-slate-400">${sub}</span>` : ""}
        </span>
      </button></li>`;
  }).join("") || `<li class="py-4 text-sm text-slate-400">${
    q ? "No players match."
      : per90 ? "No one has ≥90′ logged yet for a per-90 rate."
      : round ? "No stats for that round yet."
      : "No stats yet — the list fills up once matches are pulled. Search to look anyone up."}</li>`;
  // Open the detail in the bottom sheet (a fixed overlay) so the page
  // doesn't jump — same as tapping a player on the Home tab.
  $("stats-list").querySelectorAll("[data-sp]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.sp));
  wireStars($("stats-list"));   // in-place: see wireStars
}

/* ---------- roster snapshots (lineup locks) ---------- */

// Record every manager's current 14 picks. Scoring replays history against
// these, so changes after a lock never rewrite already-played rounds.
// Starters first, then the bench in the manager's chosen sub priority. The
// sub engine promotes the first eligible bench player it finds, so this order
// is the setting — not just a display preference.
function orderedRoster(m) {
  const picks = managerPicks(m.id);
  const order = m.bench_order || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  const key = (pk) => pk.is_sub
    ? 1e6 + (rank.has(pk.id) ? rank.get(pk.id) : 5e5)
    : 0;
  return picks.slice().sort((a, b) => key(a) - key(b));
}

/* Write one manager's squad, stamped with the lock it takes effect at. Upserted
   on (league, manager, effective_from), so editing five times before the lock
   leaves one row — the last edit wins — instead of five. */
async function snapshotAt(mgrId, atMs, roundKey) {
  if (!S.sb || !S.league?.id || atMs == null) return false;
  const m = S.managers.find((x) => x.id === mgrId);
  if (!m) return false;
  const row = {
    league_id: S.league.id, manager_id: mgrId,
    effective_from: new Date(atMs).toISOString(),
    ...(roundKey ? { round_key: roundKey } : {}),
    roster: orderedRoster(m).map((pk) => ({
      player_id: pk.player_id, player_name: pk.player_name,
      position: pk.position, team: pk.team, is_sub: pk.is_sub, slot: pk.slot,
      ...(m.captain_id === pk.player_id ? { is_captain: true } : {}),
      ...(m.vice_id === pk.player_id ? { is_vice: true } : {}),
    })),
  };
  const put = () => S.sb.from("lineup_snapshots")
    .upsert(row, { onConflict: "league_id,manager_id,effective_from" });
  let { error } = await put();
  /* Unapplied Phase 1.5 migration: drop the stamp and keep the snapshot. The
     read side treats an unstamped snapshot as "use the timestamp path", so this
     degrades to exactly the pre-1.5 behaviour rather than to an error. */
  if (error && /round_key/.test(error.message || "")) {
    delete row.round_key;
    ({ error } = await put());
  }
  // Without the unique index the upsert has nothing to conflict on; fall back
  // to a plain insert so an unapplied migration degrades to the old behaviour
  // (duplicate rows) rather than losing the snapshot entirely.
  if (error) await S.sb.from("lineup_snapshots").insert(row).then(() => {}, () => {});
  return true;
}

/* Freeze what has already been played, before a change can rewrite it.

   rosterAtFor() falls back to the LIVE roster when no snapshot is in force.
   That is the only sane answer for a league where nothing has been played yet
   -- but once a round HAS been played it means any edit retroactively rewrites
   that round's score, and the head-to-head log with it. A manager who moved a
   substitute would watch last week's result change under them.

   Must be called BEFORE the change is applied, or it pins the new state and
   protects nothing. */
async function pinHistory(mgrId) {
  if (!S.sb || !S.league?.id) return false;
  if (!(S.stats || []).length) return false;          // nothing played to protect
  const now = Date.now();
  const snaps = snapshotsByManager()[mgrId] || [];
  if (snaps.some((sn) => Date.parse(sn.effective_from) <= now)) return false;   // covered
  /* NOT on the deletion list after all, and the reason is worth keeping.

     Phase 2 listed this beside restampSnapshots as compensating machinery to
     remove once rounds were recorded. It is not the same kind of thing.
     restamping RE-DERIVED a fact that was already knowable; this WRITES a fact
     nobody else writes. snapshotForNextLock only fires when a manager changes
     something, so a manager who drafts and never touches their line-up has no
     snapshot for the round they just played — and scoring falls through to
     their live picks, which the edit they are about to make would rewrite.
     That is bug row 4 of ROUNDS_DESIGN.md, and this is what stops it.

     Nor can the settlement ritual replace it: that usually runs LATE, so it
     would record the squad they have now rather than the one that played. The
     only moment the live roster is still provably the round's roster is the
     instant before the change — which is exactly when this runs.

     Deliberately not round-stamped, either. Taken mid-round at `now`, it is a
     safety net rather than a record of a round's line-up; keying it to the
     round in progress would hand matches played EARLIER that round the
     post-pin squad. It belongs on the timestamp path. */
  return snapshotAt(mgrId, now);
}

// Stamp a manager's squad for the NEXT lock. Called from every path that
// changes a roster or an XI while that lock is still ahead.
async function snapshotForNextLock(mgrId) {
  if (!autoWindowsEnabled()) return false;
  const at = nextLockMs(S.fixtures || [], Date.now(), cfgOf().windows || {});
  if (at == null) return false;
  return snapshotAt(mgrId, at, roundKeyLockedAt(S.fixtures || [], at));
}

/* Give every snapshot the round it was FOR (ROUNDS_DESIGN.md Phase 2c).

   This replaces restampSnapshots(), which kept re-pointing future stamps at
   whatever the current lock happened to be — a compensating mechanism that
   existed only because the round was never recorded. Runs on every refresh,
   the same as its predecessor, so it needs no schedule; a snapshot written by
   an older client is stamped the next time anyone opens the league.

   What it stamps is exactly what the timestamp path resolves TODAY. That makes
   the backfill behaviour-preserving at the moment it runs, and it is the honest
   claim to make: the round is not being recovered from first principles, it is
   being frozen before the fixture list can move again. A snapshot the calendar
   cannot place (no fixtures at all) keeps a null key and the timestamp path,
   which is what restampPlan did with it too — nothing. */
async function backfillSnapshotRounds() {
  if (!S.sb || !(S.fixtures || []).length) return 0;
  let done = 0;
  for (const sn of S.snapshots || []) {
    if (sn.round_key) continue;
    const at = Date.parse(sn.effective_from);
    if (isNaN(at)) continue;
    const key = roundKeyLockedAt(S.fixtures, at);
    if (!key) continue;
    const { error } = await S.sb.from("lineup_snapshots")
      .update({ round_key: key }).eq("id", sn.id);
    // Column missing = migration not applied; stop rather than retry per row.
    if (error) return done;
    sn.round_key = key;
    done++;
  }
  return done;
}

/* Put one manager's XI back inside the rules, writing only what moved. Returns
   the number of picks changed (0 when it was already legal, or when the squad
   cannot field a legal side at all -- there is nothing useful to write then). */
async function repairLineupFor(mgrId) {
  const picks = managerPicks(mgrId).filter((pk) => pk.slot !== "TEAM");
  if (!picks.length) return 0;
  const counts = posCounts(picks.filter((pk) => !pk.is_sub));
  if (lineupValid(counts)) return 0;                       // already legal
  const { mins, maxs, total } = lineupShape();
  const want = repairStarters(picks, mins, maxs, total);
  if (!want) return 0;                                     // cannot be made legal
  let moved = 0;
  for (const pk of picks) {
    const shouldStart = want.has(pk.id);
    if (pk.is_sub !== !shouldStart) continue;              // already on the right side
    pk.is_sub = !shouldStart;
    pk.slot = shouldStart ? pk.position : "SUB_" + pk.position;
    await S.sb.from("picks").update({ is_sub: pk.is_sub, slot: pk.slot }).eq("id", pk.id);
    moved++;
  }
  return moved;
}

async function snapshotRosters() {
  // A manual lock is still a lock, so it names the round it is locking for.
  // Null in a league with no fixtures at all, which keeps the timestamp path.
  const roundKey = roundKeyLockedAt(S.fixtures || [], Date.now());
  const rows = activeManagers().map((m) => ({
    league_id: S.league.id,
    manager_id: m.id,
    ...(roundKey ? { round_key: roundKey } : {}),
    roster: orderedRoster(m).map((pk) => ({
      player_id: pk.player_id, player_name: pk.player_name,
      position: pk.position, team: pk.team, is_sub: pk.is_sub, slot: pk.slot,
      // Lock the captain/vice into the round so past rounds keep their choice.
      ...(m.captain_id === pk.player_id ? { is_captain: true } : {}),
      ...(m.vice_id === pk.player_id ? { is_vice: true } : {}),
    })),
  }));
  if (!rows.length) return;
  let { error } = await S.sb.from("lineup_snapshots").insert(rows);
  // Unapplied Phase 1.5 migration: keep the lock, drop the stamp (see snapshotAt).
  if (error && /round_key/.test(error.message || ""))
    ({ error } = await S.sb.from("lineup_snapshots")
      .insert(rows.map(({ round_key, ...r }) => r)));
  if (error) toast("Lineup lock failed: " + error.message);
}

/* ---------- lineup picker ---------- */

function enterLineupEdit() {
  const me = myManager();
  S._lineupSaved = {
    draft: new Set(S.lineupDraft),
    captain: S.captainDraft, vice: S.viceDraft,
    bench: (S.benchDraft || me?.bench_order || []).slice(),
  };
  S.lineupEdit = true;
  renderLineup();
}

// Put everything back the way it was saved, and return to the view.
function discardLineupEdit() {
  const snap = S._lineupSaved;
  if (snap) {
    S.lineupDraft = new Set(snap.draft);
    S.captainDraft = snap.captain;
    S.viceDraft = snap.vice;
    S.benchDraft = snap.bench.slice();
  }
  S.lineupEdit = false;
  renderLineup();
}

function openLineup() {
  S.lineupEdit = false;           // opens read-only; Edit lineup turns it on
  S.benchDraft = null;            // fall back to the saved order
  lockScroll(true);
  const me = myManager();
  if (!me) return;
  if (!lineupOpen())
    return toast(autoWindowsEnabled() ? lineupLockMessage()
      : "Lineups are locked — the admin opens the window between rounds.");
  // Draft of the new lineup: set of pick ids that will be starters.
  S.lineupDraft = new Set(managerPicks(me.id)
    .filter((pk) => !pk.is_sub && pk.slot !== "TEAM").map((pk) => pk.id));
  S.captainDraft = me.captain_id || "";
  S.viceDraft = me.vice_id || "";
  const sq = starterQuota(), flex = leagueFlex();
  $("lineup-rule").textContent =
    "Pick an eligible starting XI. The rest are subs — a sub only scores when their starter doesn't play.";
  renderLineup();
  $("lineup-sheet").classList.remove("hidden");
}

function lineupCounts() {
  const me = myManager();
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const pk of managerPicks(me.id)) {
    if (S.lineupDraft.has(pk.id)) counts[pk.position]++;
  }
  return counts;
}

function lineupValid(counts) {
  // Flex formation: the starting XI must be within the min–max bounds and total.
  if (isFlexFormation()) return formationValid(counts, formationBounds());
  return flexComplete(counts, starterQuota(), lineupFlex());
}

/* Club crest for a team. API competitions carry the id on every player; the
   legacy WC pool has it in photos.json. Empty string when unknown, so callers
   can drop it in without guarding. */
function teamCrestHtml(team, size = "w-4 h-4") {
  const id = S.photos?.teams?.[team] ?? teamLogoId(team);
  if (!id) return "";
  return `<img src="https://media.api-sports.io/football/teams/${id}.png" loading="lazy" data-avatar
    class="${size} inline-block object-contain shrink-0 align-[-2px]" alt="" title="${esc(team)}">`;
}

// "Bruno Fernandes" → "Fernandes"; single-word names stay whole. Pitch chips
// are ~62px wide, so a surname is all that fits and all that's needed.
// "v BUR" / "@ NEW" — the next opponent in the least space that still says
// who and where. Empty when nothing is scheduled.
function oppShort(team) {
  const f = nextFixtureFor(team);
  if (!f) return "";
  const opp = f.home === team ? f.away : f.home;
  const code = S.players.find((p) => p.team === opp)?.team_code
    || String(opp).slice(0, 3).toUpperCase();
  return `${f.home === team ? "v" : "@"} ${code}`;
}

function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
}

/* The XI laid out on a pitch. Shared by the lineup picker, the head-to-head
   preview and the post-round comparison, so it takes plain rows and leaves
   interaction to the caller via `tapAttr`.
     byPos : { GK:[e], DEF:[e], MID:[e], FWD:[e] }
     e     : { id, player_id, name, team, badge?, note?, dim? }              */
function pitchHtml(byPos, opts = {}) {
  return `<div class="pitch">
    ${PITCH_MARKS}
    <div class="pitch-rows">${pitchRowsHtml(byPos, opts)}</div>
  </div>`;
}

/* Two squads on one pitch, facing each other the way a television graphic
   shows them: the top half is drawn keeper-first so that side attacks
   downwards, the bottom half keeps the normal keeper-at-the-back layout, and
   the two attacks meet on the halfway line. Reads as a fixture rather than as
   two unrelated lists. */
function pitchFacingHtml(topByPos, botByPos, opts = {}) {
  // A faint wash of each manager's colour over their own half: without it the
  // two halves are identical green and you have to re-read the name bars to
  // work out which end is yours.
  const wash = (c, dir) => c
    ? ` style="background:linear-gradient(${dir},${c}2e,transparent 70%)"` : "";
  return `<div class="pitch pitch-vs">
    ${PITCH_MARKS}
    <div class="pitch-rows pitch-rows-down"${wash(opts.topColor, "180deg")}>${pitchRowsHtml(topByPos, opts)}</div>
    <div class="pitch-rows"${wash(opts.botColor, "0deg")}>${pitchRowsHtml(botByPos, opts)}</div>
  </div>`;
}

const PITCH_MARKS =
  '<div class="pitch-half"></div><div class="pitch-box b"></div><div class="pitch-box t"></div>';

/* The bench, drawn as a bench. A stack of full-width rows said "list of spare
   players"; a row of faces under the pitch, numbered left to right, says the
   thing that actually matters — who comes on first.
     e : { player_id, name, team, position, note? }                          */
function dugoutHtml(subs, opts = {}) {
  if (!subs.length) return "";
  return `<div class="dugout">${subs.map((e, i) => {
    /* Pick id when the caller supplies one, matching pitchRowsHtml. The two
       disagreed: the pitch wrote e.id and the dugout wrote e.player_id, so the
       trade handlers -- which all look up S.picks by id -- silently found
       nothing for a bench player. You could only ever trade a starter. */
    const tapVal = e.id != null ? e.id : e.player_id;
    const tap = opts.tapAttr ? `${opts.tapAttr}="${esc(tapVal)}"` : "";
    return `<button type="button" ${tap} class="sub-chip">
      <span class="sub-no">${i + 1}</span>
      <span class="relative inline-flex">
        ${avatarHtml(e.player_id, e.team, "w-9 h-9")}
        ${teamCrestHtml(e.team) ? `<span class="absolute -bottom-0.5 -left-1 rounded-full bg-slate-900/90 p-0.5 inline-flex">${teamCrestHtml(e.team, "w-3 h-3")}</span>` : ""}
        ${e.note != null ? `<span class="pp-pts">${e.note}</span>` : ""}
      </span>
      <span class="sub-name">${esc(shortName(e.name))}</span>
      <span class="text-[9px] pos-${e.position} rounded px-1 leading-tight">${esc(e.position || "")}</span>
    </button>`;
  }).join("")}</div>`;
}

function pitchRowsHtml(byPos, opts = {}) {
  const av = opts.small ? "w-8 h-8" : "w-10 h-10";
  const chip = (e) => {
    // An empty slot: a dashed shirt where a player still has to go.
    if (e.ghost) return `<div class="pp opacity-70">
      <span class="${av} rounded-full border-2 border-dashed border-white/40 inline-flex items-center justify-center text-[10px] font-bold text-white/60">+</span>
      <span class="pp-name text-white/60">${esc(e.name || "")}</span>
    </div>`;
    const tap = opts.tapAttr ? `${opts.tapAttr}="${esc(e.id)}"` : "";
    // The button itself is a transparent finger-sized box (the mobile rule in
    // index.html floors every button at 38px); only the inner span is painted,
    // so the badge sits on the corner of the avatar instead of covering the face.
    const rm = e.remove && opts.removeAttr
      ? `<button type="button" ${opts.removeAttr}="${esc(e.removeId ?? e.id)}"
           aria-label="Remove from lineup"
           class="absolute -top-3 -left-3 z-10 inline-flex items-center justify-center w-9 h-9"
           ><span class="rounded-full bg-wcred text-white text-sm font-bold w-5 h-5 inline-flex items-center justify-center leading-none shadow ring-2 ring-slate-900/60">−</span></button>` : "";
    return `<div class="relative flex justify-center">
      ${rm}
      <button type="button" ${tap} class="pp ${e.dim ? "opacity-50" : ""} ${e.planned ? "pp-planned" : ""}">
        <span class="relative inline-flex">
          ${avatarHtml(e.player_id, e.team, av)}
          ${opts.crests && teamCrestHtml(e.team) ? `<span class="absolute -bottom-0.5 -left-1 rounded-full bg-slate-900/90 p-0.5 inline-flex">${teamCrestHtml(e.team, "w-3.5 h-3.5")}</span>` : ""}
          ${e.badge ? `<span class="absolute -top-1 -right-1 rounded-full bg-wcgold text-slate-900 text-[10px] font-bold w-4 h-4 inline-flex items-center justify-center">${e.badge}</span>` : ""}
          ${e.note != null ? `<span class="pp-pts">${e.note}</span>` : ""}
          ${e.swapFor ? `<span class="absolute -bottom-1 -right-2 inline-flex items-center rounded-full bg-slate-900/95 ring-1 ring-wcgold/70 p-0.5"
             title="replacing">${avatarHtml(e.swapFor, "", "w-4 h-4")}</span>` : ""}
        </span>
        <span class="pp-name">${esc(shortName(e.name))}</span>
        ${e.opp ? `<span class="pp-opp">${esc(e.opp)}</span>` : ""}
      </button>
    </div>`;
  };
  return ["GK", "DEF", "MID", "FWD"].map((g) =>
    `<div class="pitch-row">${(byPos[g] || []).map(chip).join("")}</div>`).join("");
}

// While a full-screen sheet is open the page behind it must not scroll, or a
// swipe that overshoots drags the board around underneath.
function lockScroll(on) {
  document.body.style.overflow = on ? "hidden" : "";
}

/* Sub priority. The auto-sub engine promotes the first eligible bench player,
   so the bench's ORDER decides who covers a no-show — but until now that order
   was whatever the draft happened to produce. S.benchDraft holds the working
   order while editing; managers.bench_order persists it. */
function benchInOrder(subs) {
  const order = S.benchDraft || myManager()?.bench_order || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  return subs.slice().sort((a, b) =>
    (rank.has(a.id) ? rank.get(a.id) : 1e6) - (rank.has(b.id) ? rank.get(b.id) : 1e6));
}

// A tap on ▲/▼ used to repaint the entire sheet — pitch, formation, captain
// pickers and all — which made a two-row swap feel like a page load. Only the
// bench list can change, so only the bench list is rebuilt.
let _benchListHtml = null;

function wireLineupControls(root) {
  // A tap on any player — pitch or bench, either mode — opens their card.
  root.querySelectorAll("[data-peek]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.peek));
  root.querySelectorAll("[data-bup]").forEach((b) => b.onclick = () =>
    moveBench(b.dataset.bup, -1));
  root.querySelectorAll("[data-bdn]").forEach((b) => b.onclick = () =>
    moveBench(b.dataset.bdn, 1));
  root.querySelectorAll("[data-lineup]").forEach((b) => b.onclick = () => {
    const id = b.dataset.lineup;
    if (S.lineupDraft.has(id)) S.lineupDraft.delete(id);
    else S.lineupDraft.add(id);
    renderLineup();
  });
}

/* FLIP. The rows have already been rebuilt in their new order, so put each one
   back where it just was and let the compositor animate the gap to zero: the
   two swapped rows visibly trade places instead of teleporting, and nothing
   re-lays out mid-animation. */
function flipRows(box, was, rowAttr = "data-brow") {
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  box.querySelectorAll(`[${rowAttr}]`).forEach((r) => {
    const y0 = was.get(r.getAttribute(rowAttr));
    if (y0 == null) return;
    const dy = y0 - r.getBoundingClientRect().top;
    if (!dy) return;
    r.style.transition = "none";
    r.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      r.style.transition = "transform .2s cubic-bezier(.2,.8,.3,1)";
      r.style.transform = "";
    });
  });
}

function moveBench(pickId, dir) {
  const me = myManager();
  if (!me) return;
  const cur = benchInOrder(managerPicks(me.id)
    .filter((pk) => pk.slot !== "TEAM" && !S.lineupDraft.has(pk.id))).map((pk) => pk.id);
  const i = cur.indexOf(pickId), j = i + dir;
  if (i < 0 || j < 0 || j >= cur.length) return;
  [cur[i], cur[j]] = [cur[j], cur[i]];
  S.benchDraft = cur;
  const box = document.getElementById("lineup-bench");
  if (!box || !_benchListHtml) { renderLineup(); return; }
  const was = new Map();
  box.querySelectorAll("[data-brow]").forEach((r) =>
    was.set(r.dataset.brow, r.getBoundingClientRect().top));
  box.innerHTML = _benchListHtml();
  wireLineupControls(box);
  flipRows(box, was);
  markQueueMoved(pickId);
}

function renderLineup() {
  const me = myManager();
  const mine = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM");
  const order = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  mine.sort((a, b) => order[a.position] - order[b.position] || a.pick_number - b.pick_number);
  // Starters go on the pitch; everyone else sits on the bench beneath it.
  // Tapping a player ALWAYS opens their card, in either mode — moving them in
  // or out is the − and + controls' job, so a tap can't cost you your XI.
  const editing = !!S.lineupEdit;
  const starters = mine.filter((pk) => S.lineupDraft.has(pk.id));
  const bench = benchInOrder(mine.filter((pk) => !S.lineupDraft.has(pk.id)));
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const pk of starters) {
    (byPos[pk.position] ||= []).push({
      id: pk.player_id, removeId: pk.id,
      player_id: pk.player_id, name: pk.player_name, team: pk.team,
      opp: oppShort(pk.team),
      remove: editing,
      badge: captainEnabled() && S.captainDraft === pk.player_id ? "C"
           : captainEnabled() && S.viceDraft === pk.player_id ? "V" : "",
    });
  }
  const benchRow = (pk, i, arr) => `<div data-brow="${esc(pk.id)}" class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 border border-slate-700 bg-slate-800/60">
      ${editing ? `<span class="w-4 shrink-0 text-xs font-mono text-slate-400">${i + 1}</span>` : ""}
      <button data-peek="${esc(pk.player_id)}" class="min-w-0 flex-1 flex items-center gap-2 text-left">
        ${avatarHtml(pk.player_id, pk.team, "w-7 h-7")}
        <span class="min-w-0 flex-1 leading-tight">
          <span class="flex items-center gap-1 min-w-0">
            <span class="truncate text-sm">${esc(pk.player_name)}</span>
            <span class="shrink-0 flex items-center gap-1">${availBadges(pk.player_id)}</span>
          </span>
          <span class="flex items-center gap-1 truncate text-xs text-slate-400">
            ${teamCrestHtml(pk.team, "w-3.5 h-3.5")}<span class="truncate">${esc(pk.team)}</span>
            ${oppShort(pk.team) ? `<span class="shrink-0">· ${esc(oppShort(pk.team))}</span>` : ""}</span>
        </span>
      </button>
      <span class="shrink-0 text-xs pos-${pk.position} rounded px-1.5 py-0.5">${pk.position}</span>
      ${editing ? `
        <span class="nudge-col shrink-0 leading-none">
          <button data-bup="${esc(pk.id)}" class="nudge text-slate-400 ${i === 0 ? "opacity-30" : ""}" ${i === 0 ? "disabled" : ""} aria-label="Higher sub priority">▲</button>
          <button data-bdn="${esc(pk.id)}" class="nudge text-slate-400 ${i === arr.length - 1 ? "opacity-30" : ""}" ${i === arr.length - 1 ? "disabled" : ""} aria-label="Lower sub priority">▼</button>
        </span>
        <button data-lineup="${esc(pk.id)}" aria-label="Add to lineup"
          class="shrink-0 inline-flex items-center justify-center w-9 h-9"
          ><span class="rounded-full bg-wcgold text-slate-900 text-sm font-bold w-6 h-6 inline-flex items-center justify-center leading-none">+</span></button>` : ""}
    </div>`;

  $("lineup-list").innerHTML = `
    ${pitchHtml(byPos, { tapAttr: "data-peek", removeAttr: "data-lineup", crests: true })}
    <div class="mt-2">
      <div class="flex items-baseline justify-between gap-2 mb-1">
        <span class="eyebrow">Bench · ${bench.length}</span>
        ${editing && bench.length > 1 ? '<span class="text-xs text-slate-400">hold to drag · order = sub priority</span>' : ""}
      </div>
      <div id="lineup-bench" class="space-y-1">${bench.map(benchRow).join("")
        || '<p class="text-xs text-slate-400">Nobody on the bench.</p>'}</div>
    </div>`;
  // Reordering the bench repaints only this list (see moveBench), so the markup
  // has to be reproducible — and re-sorted — without re-running the whole render.
  _benchListHtml = () =>
    benchInOrder(mine.filter((pk) => !S.lineupDraft.has(pk.id))).map(benchRow).join("");

  wireLineupControls($("lineup-list"));
  if (editing) makeReorderable($("lineup-bench"), "data-brow", (order, moved) => {
    S.benchDraft = order;
    animateReorder("lineup-bench", "data-brow", () => {
      $("lineup-bench").innerHTML = _benchListHtml();
      wireLineupControls($("lineup-bench"));
    }, moved);
  });

  const counts = lineupCounts();
  const total = counts.GK + counts.DEF + counts.MID + counts.FWD;
  const ok = lineupValid(counts);
  const need = isFlexFormation()
    ? formationBounds().starters
    : ["GK", "DEF", "MID", "FWD"].reduce((a, g) => a + (starterQuota()[g] || 0), 0) + lineupFlex();
  // Outfield shape only — "3-4-3" is how anyone actually describes a formation.
  $("lineup-formation").textContent = `${counts.DEF}-${counts.MID}-${counts.FWD}`;
  $("lineup-formation").className = "text-3xl font-bold scoreboard tracking-tight "
    + (ok ? "text-wcgold" : "text-danger");
  $("lineup-count").textContent = `${total}/${need} picked${counts.GK !== 1 ? " · needs a keeper" : ""}`;
  $("lineup-count").className = "text-xs " + (ok ? "text-slate-400" : "text-danger");
  const prim = $("lineup-primary"), sec = $("lineup-secondary");
  if (editing) {
    sec.textContent = "Discard changes";
    prim.textContent = "Save edits";
    prim.disabled = !ok;
  } else {
    sec.textContent = "Exit";
    prim.textContent = "Edit lineup";
    prim.disabled = false;
  }
  // Captain / vice pickers (only among the chosen starters).
  const capBox = $("lineup-captain");
  if (captainEnabled()) {
    capBox.classList.remove("hidden");
    const starterPicks = mine.filter((pk) => S.lineupDraft.has(pk.id));
    const nameOf = (pid) => starterPicks.find((pk) => pk.player_id === pid)?.player_name;
    if (!editing) {
      /* Read-only outside edit mode. The dropdowns were live in the view, so
         you could change the armband with no Save button anywhere on screen —
         the change looked applied and was thrown away on the next render. */
      const shown = (label, mark, pid) => `<div class="rounded-lg bg-slate-800/60 px-2 py-1.5">
        <div class="eyebrow">${label} ${mark}</div>
        <div class="text-sm truncate ${pid ? "" : "text-slate-500"}">${
          pid ? esc(nameOf(pid) || "—") : "not set"}</div></div>`;
      capBox.innerHTML = shown("Captain", "© ×2", S.captainDraft)
        + shown("Vice", "Ⓥ backup", S.viceDraft);
    } else {
      const opts = (sel) => '<option value="">— none —</option>' + starterPicks.map((pk) =>
        `<option value="${esc(pk.player_id)}"${pk.player_id === sel ? " selected" : ""}>${esc(pk.player_name)}</option>`).join("");
      capBox.innerHTML = `
        <label class="text-xs text-slate-400">Captain © <span class="text-slate-400">×2</span>
          <select id="lineup-cap-sel" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm">${opts(S.captainDraft)}</select></label>
        <label class="text-xs text-slate-400">Vice Ⓥ <span class="text-slate-400">backup</span>
          <select id="lineup-vice-sel" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm">${opts(S.viceDraft)}</select></label>`;
      // Re-render so the armband on the pitch follows the selection — it used to
      // only update on the next full render, which read as nothing happening.
      $("lineup-cap-sel").onchange = (e) => { S.captainDraft = e.target.value; renderLineup(); };
      $("lineup-vice-sel").onchange = (e) => { S.viceDraft = e.target.value; renderLineup(); };
    }
  } else capBox.classList.add("hidden");
}

async function saveLineup() {
  const me = myManager();
  if (!lineupOpen())
    return toast("Lineups are locked — the window closed while you were editing.");
  if (!lineupValid(lineupCounts())) return;
  // Persist sub priority alongside the XI: the auto-sub engine reads roster
  // order, so this is what decides who covers a no-show.
  if (S.benchDraft) {
    me.bench_order = S.benchDraft.slice();
    queueManagerWrite(me.id, "bench_order", me.bench_order);
  }
  /* Applied locally first, then written. The old order — write, await, wait for
     the refetch — meant the saved XI only appeared after a round trip, and a
     read that predated the writes put the OLD XI back on screen first. */
  const changes = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM").map((pk) => {
    const isSub = !S.lineupDraft.has(pk.id);
    return { pk, isSub, slot: isSub ? "SUB_" + pk.position : pk.position };
  }).filter(({ pk, isSub }) => pk.is_sub !== isSub);
  const onSaveErr = (error) => { toast("Save failed: " + error.message); scheduleRefetch(); };
  /* Freeze the rounds already played BEFORE any pick is touched. Without this
     the edit rewrites their scores through rosterAtFor's live-roster fallback,
     and last week's result changes under the manager. `changes` above only
     computed what to do -- nothing has been mutated yet. */
  await pinHistory(me.id).catch(() => {});
  // Stamped for the lock this XI applies to, so it can never rewrite a round
  // already under way — an edit made mid-matchweek lands on the NEXT lock.
  setTimeout(() => snapshotForNextLock(me.id).catch(() => {}), 0);
  for (const { pk, isSub, slot } of changes) {
    pk.is_sub = isSub; pk.slot = slot;
    queueFieldWrite("picks", pk.id, "is_sub", isSub, onSaveErr);
    queueFieldWrite("picks", pk.id, "slot", slot, onSaveErr);
  }
  // Persist captain/vice (only valid if still among the starters).
  if (captainEnabled()) {
    const starterIds = new Set(managerPicks(me.id).filter((pk) => S.lineupDraft.has(pk.id)).map((pk) => pk.player_id));
    const cap = starterIds.has(S.captainDraft) ? S.captainDraft : null;
    const vice = starterIds.has(S.viceDraft) && S.viceDraft !== cap ? S.viceDraft : null;
    if (cap !== (me.captain_id || null) || vice !== (me.vice_id || null)) {
      const capErr = (error) => toast(/captain|column|schema cache/.test(error.message)
        ? "Captain needs a schema update — run schema.sql." : error.message);
      me.captain_id = cap; me.vice_id = vice;
      queueManagerWrite(me.id, "captain_id", cap, capErr);
      queueManagerWrite(me.id, "vice_id", vice, capErr);
    }
  }
  toast(changes.length ? "Lineup saved." : "Lineup unchanged.");
  S.lineupEdit = false;      // back to the read-only view, sheet stays open
  S._lineupSaved = null;
  renderLineup();
  scheduleRefetch();
}

/* ---------- trading: free-agent swap ---------- */

// Position group of a slot: GK/SUB_GK -> GK, etc. TEAM stays its own group
// and is excluded from all trading.
const slotGroup = (slot) => SLOT_POS[slot] || null;

function openSwap(pick) {
  if (!tradingOpen()) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  if (pick.slot === "TEAM") return;
  const cap = maxFaPerWindow();
  if (cap != null && faMovesLeft(pick.manager_id) <= 0)
    return toast(`No free-agent moves left this window — the cap is ${cap}.`);
  S.swapPick = pick;
  // Say what will actually happen. In waiver mode nothing is instant — the
  // claim queues and resolves at window close — and calling it a swap was a
  // straight lie about the rules the league is playing under.
  const waiver = faDeferToClose();
  $("swap-title").innerHTML = `
    <div class="flex items-center gap-2">
      ${avatarHtml(pick.player_id, pick.team, "w-8 h-8")}
      <span class="min-w-0 flex-1 leading-tight">
        <span class="block text-sm font-semibold truncate">Replace ${esc(pick.player_name)}</span>
        <span class="block text-xs text-slate-400 truncate">${esc(pick.team)} · ${esc(pick.slot)}${
          cap == null ? "" : ` · ${faMovesLeft(pick.manager_id)}/${cap} moves left`}</span>
      </span>
    </div>
    <p class="text-xs ${waiver ? "text-amber-300" : "text-slate-400"} mt-1.5">${waiver
      ? "⏳ Claims are not instant — yours queues and resolves when the window closes, in waiver order."
      : "Applies immediately, first come first served."}</p>`;
  $("swap-search").value = "";
  if (!$("swap-team").options.length) {
    $("swap-team").innerHTML = '<option value="">All teams</option>' +
      S.teams.map((t) => `<option>${esc(t)}</option>`).join("");
  }
  $("swap-team").value = "";
  // Default to the pick's own position -- the common case -- but "All" is one
  // tap away, which is the whole point of it being a filter now.
  $("swap-pos").value = slotGroup(pick.slot) || "";
  renderSwapList();
  $("swap-sheet").classList.remove("hidden");
}

function closeSwap() {
  S.swapPick = null;
  $("swap-sheet").classList.add("hidden");
}

// Sub-line under a player: country, plus next fixture when fixtures.json
// is available.
function teamFixLine(team) {
  const t = fixtureText(team);
  return esc(team) + (t ? ` <span class="text-slate-400">· ${esc(t)}</span>` : "");
}

function renderSwapList() {
  const pick = S.swapPick;
  if (!pick) return;
  const me = myManager();
  /* The list used to be hard-locked to the pick's own position, with no way to
     look at any other -- so a forward could only ever be swapped or traded for
     another forward. That contradicts the rule the rest of the app follows
     (see pairValid: any position for any position; the squad quota bites when
     you next pick an XI). It is now a FILTER, defaulting to the pick's own
     position because that is the common case, with "All" one tap away. */
  const group = slotGroup(pick.slot);
  const posF = $("swap-pos").value;
  const teamF = $("swap-team").value;
  const q = $("swap-search").value.trim().toLowerCase();
  const match = (name, team) => (!teamF || team === teamF)
    && (!q || name.toLowerCase().includes(q) || team.toLowerCase().includes(q));

  const free = (posF ? availableForGroup(posF) : availableForAnyGroup())
    .filter((e) => match(e.name, e.team) && !isEliminated(e.team)).slice(0, 60);
  // Players already on other rosters: tapping one jumps straight into a trade
  // proposal with their owner.
  const owned = S.picks
    .filter((pk) => (!posF || pk.position === posF) && pk.slot !== "TEAM"
      && pk.manager_id !== me?.id && match(pk.player_name, pk.team))
    .map((pk) => ({ pk, owner: S.managers.find((m) => m.id === pk.manager_id) }))
    .slice(0, 40);

  const freeRows = free.map((e) => `
    <li class="flex items-center py-2 gap-2">
      ${avatarHtml(e.player_id, e.team)}
      <div class="min-w-0 flex-1 leading-tight">
        <div class="flex items-center gap-1 min-w-0">
          <span class="truncate text-sm">${esc(e.name)}</span>
          <span class="shrink-0 flex items-center gap-1">${availBadges(e.player_id)}</span>
        </div>
        <div class="flex items-center gap-1 text-xs text-slate-400 min-w-0">
          ${teamCrestHtml(e.team, "w-3.5 h-3.5")}<span class="truncate">${esc(e.team)}</span>
          <span class="shrink-0 font-mono">${entryPoints(e.player_id, e.position, e.team)}p</span>
        </div>
      </div>
      <button data-swapin="${esc(e.player_id)}" class="shrink-0 bg-wcred hover:bg-wcred-hov rounded-lg px-3 py-2 text-xs font-semibold">${faDeferToClose() ? "Claim" : "Swap in"}</button>
    </li>`).join("") || '<li class="py-4 text-sm text-slate-400">No free agents match.</li>';
  const ownedRows = owned.map(({ pk, owner }) => `
    <li class="flex items-center py-2 gap-2">
      ${avatarHtml(pk.player_id, pk.team)}
      <div class="min-w-0 flex-1 leading-tight">
        <div class="flex items-center gap-1 min-w-0">
          <span class="truncate text-sm">${esc(pk.player_name)}</span>
          <span class="shrink-0 flex items-center gap-1">${availBadges(pk.player_id)}</span>
        </div>
        <div class="flex items-center gap-1 text-xs text-slate-400 min-w-0">
          <span class="shrink-0 inline-flex items-center justify-center rounded w-4 h-4 text-[10px]"
                style="background:${managerColor(owner)}26;border:1px solid ${managerColor(owner)}88">${managerMark(owner)}</span>
          <span class="truncate">${esc(owner?.name ?? "?")}</span>
          <span class="shrink-0 font-mono">${entryPoints(pk.player_id, pk.position, pk.team)}p</span>
        </div>
      </div>
      <button data-tradefor="${pk.id}" class="shrink-0 bg-slate-800 border border-wcgold/60 text-wcgold rounded-lg px-3 py-2 text-xs font-semibold">Offer</button>
    </li>`).join("");
  $("swap-list").innerHTML = freeRows + (ownedRows
    ? `<li class="pt-3 pb-1 text-xs uppercase tracking-wide text-slate-400">On other rosters — tap Trade to propose a swap</li>${ownedRows}`
    : "");
  $("swap-list").querySelectorAll("[data-swapin]").forEach((b) => b.onclick = () => {
    const entry = free.find((e) => e.player_id === b.dataset.swapin);
    if (!entry) return;
    const msg = faDeferToClose()
      ? `Queue a waiver claim — ${entry.name} for ${pick.player_name}? Resolves at window close, in waiver order.`
      : `Swap ${pick.player_name} out for ${entry.name}?`;
    if (confirm(msg)) swapOrClaim(pick, entry).catch((er) => toast(er.message));
  });
  $("swap-list").querySelectorAll("[data-tradefor]").forEach((b) => b.onclick = () => {
    const theirs = S.picks.find((pk) => pk.id === b.dataset.tradefor);
    if (!theirs) return;
    closeSwap();
    openBuilder(theirs.manager_id, null, [{ mine: pick.id, theirs: theirs.id }]);
  });
}

async function doSwap(pick, entry) {
  /* Belt and braces. swapOrClaim() is the router that sends a waiver league's
     moves to the queue, but relying on every caller to go through it means one
     missed call site hands a manager a free agent nobody got to bid against --
     silently, and irreversibly once the window shuts. So the instant swap
     refuses on its own terms rather than trusting the path that reached it. */
  if (faDeferToClose()) return submitFaClaim(pick, entry);
  if (!tradingOpen()) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  if (faMovesLeft(pick.manager_id) <= 0)
    return toast(`No free-agent moves left this window — the cap is ${maxFaPerWindow()}.`);
  /* The POSITION has to travel with the player. Without it a keeper swapped
     into a forward's pick stays recorded as a forward -- and scoring reads the
     pick's position, so they would be scored as one: no clean sheets, wrong
     value per goal, saves ignored. The slot follows, keeping bench players on
     the bench. (accept_trade does the same thing server-side for trades.) */
  await pinHistory(pick.manager_id).catch(() => {});   // freeze played rounds first
  const inPos = S.playerById[entry.player_id]?.position || entry.position || pick.position;
  const { error } = await S.sb.from("picks")
    .update({ player_id: entry.player_id, player_name: entry.name, team: entry.team,
              position: inPos, slot: pick.is_sub ? "SUB_" + inPos : inPos })
    .eq("id", pick.id).eq("player_id", pick.player_id);
  if (error) {
    toast(error.code === "23505" ? "That player was just taken — pick another." : error.message);
    return;
  }
  // Log the swap for the Transactions history (best-effort: if the
  // transactions table hasn't been added yet, the swap still succeeds).
  S.sb.from("transactions").insert({
    league_id: S.league.id, manager_id: pick.manager_id, kind: "swap",
    window_key: faWindowKey(),
    out_player_id: pick.player_id, out_player_name: pick.player_name,
    in_player_id: entry.player_id, in_player_name: entry.name,
  }).then(() => {}, () => {});
  toast(`Swapped in ${entry.name} for ${pick.player_name}.`);
  closeSwap();
  scheduleRefetch();
}

/* ---------- waiver-order free-agent claims (mechanics-notes §1) ---------- */
const faDeferToClose = () => cfgOf().fa_defer_to_close === true;
// Optional cap on free-agent moves per manager, PER trade window. Waiver mode
// enforces it at claim resolution; instant mode counts swaps made this window.
const maxFaPerWindow = () => cfgOf().max_fa_per_window ?? null;
// When the current trade window began: auto mode → the fixture-derived open
// time; manual mode → the last lineup lock (each close snapshots rosters, so
// the newest snapshot marks the start of the window now in progress).
function faWindowStartMs() {
  if (autoWindowsEnabled()) {
    const w = autoWindowState();
    if (w.tradeWindow) return w.tradeWindow.openAt;
  }
  // Otherwise the last lock that has actually taken effect. Keyed on
  // effective_from for the same reason txWindowStarts is: created_at is now
  // just "someone edited their team", which would reset the count mid-window.
  return txWindowStarts()[0] ?? 0;
}
/* Which trade window a move belongs to, recorded ON the move when it is made.

   Counting by timestamp against faWindowStartMs() looked equivalent and is not:
   that boundary is derived from the fixture list and stored nowhere, so it
   moves whenever the fixtures do. A rescheduled game -- or a rebuilt test
   calendar -- drags last window's moves into this one, and a manager who has
   made no transfers is told they have used their cap.

   The key is the matchweek the window leads INTO, which survives the dates
   shifting under it. */
function faWindowKey() {
  if (autoWindowsEnabled()) {
    const w = autoWindowState();
    if (w?.tradeWindow) return String(w.tradeWindow.to || w.tradeWindow.closeAt);
  }
  return "lock:" + (txWindowStarts()[0] ?? 0);
}

const faMovesThisWindow = (mid) => {
  const key = faWindowKey(), start = faWindowStartMs();
  return (S.transactions || []).filter((t) => t.manager_id === mid
    && (t.kind === "swap" || t.kind === "waiver")
    // Rows written before the key existed still fall back to the old test, so
    // an unapplied migration behaves exactly as it did.
    && (t.window_key ? t.window_key === key
                     : Date.parse(t.created_at || 0) >= start)).length;
};
const faMovesLeft = (mid) => {
  const cap = maxFaPerWindow();
  return cap == null ? Infinity : Math.max(0, cap - faMovesThisWindow(mid));
};
const myClaims = () => (S.faClaims || [])
  .filter((c) => c.manager_id === myManager()?.id && c.status === "pending")
  .sort((a, b) => a.rank - b.rank);

// Manager ids best-first: H2H log order when enabled, else total points desc.
function standingsOrder() {
  if (h2hEnabled()) return h2hStandings().order;
  return computeScores().sort((a, b) => b.total - a.total).map((s) => s.manager.id);
}

// Instant swap vs a queued waiver claim, per the league's trade mode.
function swapOrClaim(pick, entry) {
  return faDeferToClose() ? submitFaClaim(pick, entry) : doSwap(pick, entry);
}

async function submitFaClaim(pick, entry) {
  const me = myManager();
  if (!me) return toast("Join as a manager first.");
  const mine = myClaims();
  const rank = mine.length ? Math.max(...mine.map((c) => c.rank)) + 1 : 0;
  const { error } = await S.sb.from("fa_claims").insert({
    league_id: S.league.id, manager_id: me.id, pick_id: pick.id, rank,
    out_player_id: pick.player_id, out_player_name: pick.player_name,
    in_player_id: entry.player_id, in_player_name: entry.name, status: "pending",
  });
  if (error) return toast(/fa_claims|column|relation|schema cache/.test(error.message)
    ? "Waiver claims need a schema update — run schema.sql." : error.message);
  toast(`Claim #${rank + 1} queued: ${entry.name} for ${pick.player_name}. Resolves at window close.`);
  closeSwap();
  scheduleRefetch();
}

/* Reorder claims to an arbitrary new sequence of ids — a nudge is just the
   two-element case. Applied locally first so the list moves under the finger,
   then the ranks are rewritten to match. */
/* Apply a new claim sequence locally and persist it. Deliberately does NOT
   render: the caller drives the repaint through animateReorder, which measures
   the rows first so they can slide. Rendering here too meant two repaints per
   move — the FLIP measured positions that had already changed, so the rows
   jumped instead of gliding. */
function setClaimOrder(ids) {
  const list = myClaims();
  const ranks = list.map((c) => c.rank).sort((a, b) => a - b);
  const byId = new Map(list.map((c) => [c.id, c]));
  const next = ids.map((id) => byId.get(id)).filter(Boolean);
  if (next.length !== list.length) return false;
  next.forEach((c, i) => { c.rank = ranks[i]; });      // optimistic
  for (const c of next) queueFieldWrite("fa_claims", c.id, "rank", c.rank);
  return true;
}

function reorderClaim(id, dir) {
  const list = myClaims();
  const i = list.findIndex((c) => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const ids = list.map((c) => c.id);
  [ids[i], ids[j]] = [ids[j], ids[i]];
  if (setClaimOrder(ids))
    animateReorder("fa-claim-list", "data-clrow", renderClaimList, id);
}

async function cancelClaim(id) {
  await S.sb.from("fa_claims").delete().eq("id", id);
  scheduleRefetch();
}

// Seed waiver priority from reverse standings (worst-placed picks first = 0).
async function resetWaiverOrder() {
  const worstFirst = standingsOrder().slice().reverse();
  await Promise.all(worstFirst.map((id, i) =>
    S.sb.from("managers").update({ waiver_order: i }).eq("id", id)));
}

// Resolve every queued claim at window close, in waiver priority (uses the pure
// resolveFaClaims), applies awards to picks, and writes back the waiver order.
async function processFaClaims() {
  const pending = (S.faClaims || []).filter((c) => c.status === "pending");
  if (!pending.length) return;
  const order = {};
  for (const m of S.managers) if (m.waiver_order != null) order[m.id] = m.waiver_order;
  let maxo = Math.max(-1, ...Object.values(order));
  for (const id of standingsOrder().slice().reverse()) if (order[id] == null) order[id] = ++maxo;
  const taken = S.picks.map((p) => p.player_id);
  const holds = Object.fromEntries(S.picks.map((p) => [p.id, p.player_id]));
  const { awards, failed, order: newOrder } =
    resolveFaClaims(pending, order, taken, maxFaPerWindow(), holds);
  // Same reason as saveLineup: pin the played rounds before the squads move.
  for (const mid of new Set(awards.map((c) => c.manager_id)))
    await pinHistory(mid).catch(() => {});
  for (const c of awards) {
    const inP = S.playerById[c.in_player_id];
    const team = inP?.team || null;
    const outPick = S.picks.find((pk) => pk.id === c.pick_id);
    // Same rule as doSwap: the position travels with the player, or scoring
    // will value them as whoever used to hold the slot.
    const pos = inP?.position || outPick?.position || null;
    const upd = { player_id: c.in_player_id, player_name: c.in_player_name, team };
    if (pos) { upd.position = pos; upd.slot = outPick?.is_sub ? "SUB_" + pos : pos; }
    const { error } = await S.sb.from("picks").update(upd)
      .eq("id", c.pick_id).eq("player_id", c.out_player_id);
    if (!error) S.sb.from("transactions").insert({
      league_id: S.league.id, manager_id: c.manager_id, kind: "waiver",
      window_key: faWindowKey(),
      out_player_id: c.out_player_id, out_player_name: c.out_player_name,
      in_player_id: c.in_player_id, in_player_name: c.in_player_name,
    }).then(() => {}, () => {});
  }
  /* Stamp the winners' squads at the lock following the window these claims
     belong to. Run on time that is a future stamp; run late — nobody opened the
     app and a whole matchweek went by — it is a PAST one, and the round rescores
     with the players the manager should have had. Late becomes correct rather
     than merely slow. */
  if (awards.length && autoWindowsEnabled()) {
    const win = lastClosedTradeWindow(S.fixtures || [], Date.now(), cfgOf().windows || {});
    const at = win ? lockAfterWindow(S.fixtures || [], win.closeAt, cfgOf().windows || {}) : null;
    if (at != null)
      for (const mid of new Set(awards.map((c) => c.manager_id)))
        await snapshotAt(mid, at, roundKeyLockedAt(S.fixtures || [], at)).catch(() => {});
  }
  /* A claim can land a keeper in an outfielder's place and leave the XI
     illegal. The manager was not there to see it, so fix it rather than let
     them play the week with a side that does not add up. */
  for (const mid of new Set(awards.map((c) => c.manager_id)))
    await repairLineupFor(mid).catch(() => {});
  if (awards.length) await S.sb.from("fa_claims").update({ status: "awarded" }).in("id", awards.map((c) => c.id));
  if (failed.length) await S.sb.from("fa_claims").update({ status: "failed" }).in("id", failed);
  for (const m of S.managers)
    if (newOrder[m.id] != null && newOrder[m.id] !== m.waiver_order)
      await S.sb.from("managers").update({ waiver_order: newOrder[m.id] }).eq("id", m.id);
  toast(`Waivers processed: ${awards.length} awarded, ${failed.length} failed.`);
}

/* Resolve an auto-window league's claims once its trade window shuts.

   Manual leagues resolve on the admin's close-the-window tap. Auto leagues have
   no such tap — the window closes by clock — so nothing ever called this and
   claims sat pending for good. There is no server-side scheduler, so whichever
   client notices first does the work.

   That makes double-processing the danger, and awarding the same player twice
   is far worse than a batch running late. So the league row is claimed with a
   compare-and-swap FIRST: exactly one client can move fa_processed_until
   forward to this window's close, and everyone else matches zero rows and does
   nothing. The cost is that a client dying mid-run leaves the batch unfinished;
   the admin's "Process now" button is the recovery path for that. */
/* ---------- Phase 1 (ROUNDS_DESIGN.md): the round-settlement transition ----------

   "The window closed" used to be a predicate that nobody acted on; the effects
   it implies were scattered (waivers here, repairs there) and each grew its own
   ad-hoc lock. This is the one transition that owns them, in order, exactly
   once per round -- recorded as a row in `rounds` so it is visible, idempotent,
   and safe for any number of clients to race.

   The claim is the INSERT: unique (league_id, round_no) means exactly one
   racer wins; the rest get 23505 and stand down. A claim older than
   SETTLE_STALE_MS whose ritual never finished (client died mid-run) may be
   retaken with a guarded UPDATE -- the same shape as the old
   fa_processed_until CAS, now owned by the entity it belongs to.

   Deliberately NOT in the ritual: snapshotting every roster at the lock. This
   transition usually runs LATE (whenever someone next opens the app), and a
   late snapshot would stamp CURRENT squads at an old lock time -- recreating
   the history-rewrite bug that forward-stamping and pinHistory exist to
   prevent. History is their job; settlement is this one's. */

/* The last CLOSED window and the round it led into. Pure; null only when no
   window has closed at all.

   `roundKey` is the round's own label, verbatim, and is ALWAYS present — that
   is the Phase 1.5 change. `roundNo` is that label parsed to an int and stays
   null for every knockout round ("Round of 16", "Final"), which is why it was
   the wrong thing to key on: the World Cup calendar is six such rounds in a
   row, so keying by number made the app's own competition unrecordable for
   half a tournament. */
function closedWindowRounds(fixtures, nowMs, opts) {
  return closedTradeWindows(fixtures || [], nowMs, opts || {}).map((win) => {
    const n = Number(mwNo(win.to));
    return { roundKey: String(win.to), roundNo: n >= 1 ? n : null, win };
  });
}

// The newest one. Display and the bench readout want this; settlement works
// through closedWindowRounds() so a backlog is not silently skipped.
function closedWindowRound(fixtures, nowMs, opts) {
  const all = closedWindowRounds(fixtures, nowMs, opts);
  return all.length ? all[all.length - 1] : null;
}

// Which round's settlement is due, as a number. Retained for the display and
// ordering paths that want a matchweek int; the settlement claim itself keys on
// roundKey and no longer cares whether this is null.
function roundToSettle(fixtures, nowMs, opts) {
  const r = closedWindowRound(fixtures, nowMs, opts);
  return r && r.roundNo != null ? { roundNo: r.roundNo, win: r.win } : null;
}

const SETTLE_STALE_MS = 10 * 60e3;
const _missingRoundsTable = (e) =>
  /rounds/.test(e?.message || "") && /schema cache|does not exist|42P01|PGRST205/i.test((e?.message || "") + (e?.code || ""));

/* Why the last settlement attempt stopped. A transition whose whole purpose is
   to be VISIBLE was, on every path except success, returning a bare false: an
   insert refused by RLS, a league with auto-windows off and a genuine "nothing
   due" were indistinguishable from each other and from never having run. The
   test bench reads this to say what actually happened. */
let advanceStalled = null;

/* Settle ONE round: claim it, run the ritual, mark it settled. Returns true,
   false (someone else holds it / refused), or a fallback token. `resolveClaims`
   is false for the older rounds of a backlog — fa_claims carry no window and
   are cleared when a window reopens, so anything pending belongs to the NEWEST
   closed window, not to a round being caught up on. */
async function settleRound(due, resolveClaims) {
  const stop = (why) => { advanceStalled = why; return false; };
  const w = due.win;
  const row = {
    league_id: S.league.id, round_key: due.roundKey, round_no: due.roundNo,
    status: "settling",
    opens_at: new Date(w.openAt).toISOString(),
    locks_at: new Date(w.closeAt).toISOString(),
    claimed_at: new Date().toISOString(),
  };
  // Whichever column identifies this round in the database we are talking to.
  let keyed = (q) => q.eq("round_key", due.roundKey);

  let claimed = false;
  let ins = await S.sb.from("rounds").insert(row).select("id");
  /* Unapplied Phase 1.5 migration. A numbered round can still be claimed the
     old way; an unnumbered one has nothing left to key on, so it falls back
     to the legacy settlement path rather than going unsettled. */
  if (ins.error && /round_key/.test(ins.error.message || "")) {
    if (due.roundNo == null) return "no-round";
    delete row.round_key;
    keyed = (q) => q.eq("round_no", due.roundNo);
    ins = await S.sb.from("rounds").insert(row).select("id");
  }
  if (!ins.error) claimed = true;
  else if (/permission denied|row-level security|42501/i.test(
             (ins.error.message || "") + (ins.error.code || ""))) {
    /* RLS refused the claim. Almost always an rls.sql predating the `rounds`
       table: the table then has RLS enabled by schema.sql and no policy at
       all, so reads come back empty and writes are refused -- which looks
       exactly like "nothing has settled yet", forever. */
    return stop("the database refused to record it — re-run rls.sql (it must "
      + "include `rounds`, added in Phase 1)");
  }
  else if (ins.error.code === "23505" || /duplicate key/.test(ins.error.message || "")) {
    /* A stale half-run may be retaken; a live one may not. The conflict can
       also come from the legacy (league_id, round_no) unique when an older
       client already settled this round under a key we cannot see — then this
       matches nothing, and standing down is the right answer. */
    const cutoff = new Date(Date.now() - SETTLE_STALE_MS).toISOString();
    const take = await keyed(S.sb.from("rounds")
      .update({ claimed_at: new Date().toISOString() })
      .eq("league_id", S.league.id))
      .eq("status", "settling").lt("claimed_at", cutoff).select("id");
    claimed = !take.error && (take.data || []).length > 0;
  } else if (_missingRoundsTable(ins.error)) {
    return "no-table";                    // caller falls back to the legacy path
  } else {
    return stop("could not record it: " + (ins.error.message || "unknown error"));
  }
  if (!claimed) return false;             // a live claim by someone else; fine

  /* The settlement ritual, in order. Each step is itself idempotent and
     late-safe (waiver awards stamp at the lock that follows their window;
     repair only writes picks that actually move), so a retaken half-run
     finishes cleanly rather than double-applying. */
  if (resolveClaims && faDeferToClose()
      && (S.faClaims || []).some((c) => c.status === "pending"))
    await processFaClaims();
  for (const m of activeManagers())
    await repairLineupFor(m.id).catch(() => {});

  await keyed(S.sb.from("rounds")
    .update({ status: "settled", settled_at: new Date().toISOString() })
    .eq("league_id", S.league.id));
  S.rounds = [...(S.rounds || []).filter((r) => r.round_key !== due.roundKey),
              { ...row, round_key: due.roundKey, status: "settled" }];
  advanceStalled = null;
  return true;
}

// The row already recording a round, if any. Keyed rows match on the key;
// rows written before Phase 1.5 have none, so those match on the number.
const roundRowFor = (due) => (S.rounds || []).find((r) =>
  (r.round_key != null && r.round_key === due.roundKey)
  || (r.round_key == null && due.roundNo != null && r.round_no === due.roundNo));

/* Which closed rounds still owe a settlement, oldest first.

   lastClosedTradeWindow() named only the NEWEST closed window, so a league
   nobody opened for a fortnight settled one round and skipped the rest for
   good. Today that costs the skipped rounds their waivers; once Phase 2 reads
   scores from recorded rounds it would cost them their POINTS.

   The catch-up is bounded deliberately. Phase 1 chose not to backfill old
   seasons, and a first run against a season already in progress must not
   suddenly settle a dozen historical rounds. So: the newest closed round is
   always eligible, and older ones only once something later has been recorded
   — which is exactly the "we were here, then we went away" case. A database
   with no rounds at all still settles only the newest. */
function roundsOwedSettlement(fixtures, nowMs, opts) {
  const all = closedWindowRounds(fixtures, nowMs, opts);
  if (!all.length) return [];
  /* Start AT the last recorded round, not after it: a row that is still
     `settling` counts as recorded for the purpose of "how far back do we go",
     but the round itself may yet be a dead claim the filter below retakes.
     Starting past it made a half-run by a client that died unrecoverable. */
  let start = all.length - 1;                       // no backfill by default
  for (let i = all.length - 1; i >= 0; i--)
    if (roundRowFor(all[i])) { start = i; break; }
  return all.slice(start).filter((due) => {
    const row = roundRowFor(due);
    return !(row && (row.status === "settled"
      || Date.now() - Date.parse(row.claimed_at || 0) < SETTLE_STALE_MS));
  });
}

let _advanceRunning = false;
async function advanceRound() {
  const stop = (why) => { advanceStalled = why; return false; };
  if (_advanceRunning) return false;
  if (!S.sb || !S.league?.id) return stop("no league loaded");
  if (!autoWindowsEnabled()) return stop("this league is on manual windows — settlement only runs on auto");

  const all = closedWindowRounds(S.fixtures, Date.now(), cfgOf().windows || {});
  if (!all.length) return false;
  const owed = roundsOwedSettlement(S.fixtures, Date.now(), cfgOf().windows || {});
  if (!owed.length) return false;
  const newestKey = all[all.length - 1].roundKey;

  _advanceRunning = true;
  try {
    let any = false;
    for (const due of owed) {
      // Pending claims belong to the newest closed window; see settleRound.
      const r = await settleRound(due, due.roundKey === newestKey);
      if (r === "no-table" || r === "no-round") return r;
      if (r) any = true;
    }
    return any;
  } finally { _advanceRunning = false; }
}

/* The refetch hook: rounds-table path first, legacy fa_processed_until CAS as
   the fallback. Two things still fall back, both of them unmigrated databases:

     "no-table" — no `rounds` table at all (pre-Phase-1).
     "no-round" — no `rounds.round_key` column (pre-Phase-1.5) AND an unnumbered
                  round, so nothing left to key the claim on.

   Once Phase 1.5 is applied the second case cannot arise: every round has a
   label, so every round is recordable, and knockout rounds settle through the
   ritual like any other. The fallback resolves waivers and repairs the winners'
   line-ups but not the ritual's league-wide repair — a bounded difference that
   now only affects databases behind on migrations. */
async function maybeAdvanceRounds() {
  const r = await advanceRound().catch(() => false);
  if (r === "no-table" || r === "no-round") return maybeProcessAutoWaivers();
  return r;
}

/* DEPRECATED (ROUNDS_DESIGN.md Phase 2 removes it): the pre-rounds settlement
   path, kept verbatim as the fallback for databases without the rounds table.
   Its fa_processed_until CAS is the pattern advanceRound() generalises. */
let _waiverRunning = false;
async function maybeProcessAutoWaivers() {
  if (_waiverRunning) return false;
  if (!S.sb || !S.league?.id) return false;
  if (!autoWindowsEnabled() || !faDeferToClose()) return false;
  if (!(S.faClaims || []).some((c) => c.status === "pending")) return false;
  const win = lastClosedTradeWindow(S.fixtures || [], Date.now(), cfgOf().windows || {});
  const seen = S.league.fa_processed_until ? Date.parse(S.league.fa_processed_until) : null;
  if (!waiverDue(win, isNaN(seen) ? null : seen)) return false;

  _waiverRunning = true;
  try {
    const iso = new Date(win.closeAt).toISOString();
    let q = S.sb.from("leagues").update({ fa_processed_until: iso }).eq("id", S.league.id);
    q = seen == null || isNaN(seen)
      ? q.is("fa_processed_until", null)
      : q.lt("fa_processed_until", iso);
    const { data, error } = await q.select("id");
    if (error) {
      // Unapplied migration: stay quiet rather than resolving with no lock,
      // which would let every open client award the same claims.
      if (/fa_processed_until/.test(error.message || "")) return false;
      return false;
    }
    if (!data || !data.length) return false;   // another client claimed it
    S.league.fa_processed_until = iso;
    await processFaClaims();
    return true;
  } finally { _waiverRunning = false; }
}

// Admin escape hatch: resolve whatever is still pending, right now. Also the
// recovery path if an automatic run was interrupted part-way.
async function processWaiversNow() {
  if (!isAdmin()) return;
  const pending = (S.faClaims || []).filter((c) => c.status === "pending");
  if (!pending.length) return toast("No claims are waiting.");
  if (!confirm(`Resolve ${pending.length} waiting claim${pending.length === 1 ? "" : "s"} now?`)) return;
  const win = lastClosedTradeWindow(S.fixtures || [], Date.now(), cfgOf().windows || {});
  if (win) {
    /* Record the manual settlement on the round row too, so the automatic path
       knows this round is done. Keyed by label since Phase 1.5, which means a
       knockout round now records here as readily as a numbered one — before, an
       admin resolving the Round of 16 by hand left no trace at all. Best-effort
       throughout: the legacy write below is the fallback either way. */
    const n = Number(mwNo(win.to));
    const rnd = {
      league_id: S.league.id, round_key: String(win.to),
      round_no: n >= 1 ? n : null, status: "settled",
      opens_at: new Date(win.openAt).toISOString(),
      locks_at: new Date(win.closeAt).toISOString(),
      settled_at: new Date().toISOString(),
    };
    const rec = await S.sb.from("rounds")
      .upsert(rnd, { onConflict: "league_id,round_key" }).then((r) => r, (e) => ({ error: e }));
    // Pre-1.5 database: record it the old way, which only numbered rounds have.
    if (rec?.error && /round_key/.test(rec.error.message || "") && n >= 1) {
      delete rnd.round_key;
      await S.sb.from("rounds").upsert(rnd, { onConflict: "league_id,round_no" })
        .then(() => {}, () => {});
    }
    const iso = new Date(win.closeAt).toISOString();
    await S.sb.from("leagues").update({ fa_processed_until: iso }).eq("id", S.league.id);
    S.league.fa_processed_until = iso;
  }
  await processFaClaims();
}

/* ---------- trading: manager-to-manager ---------- */

const pickById = (id) => S.picks.find((p) => p.id === id);

// Both sides of a trade pair must be in the same position group; subs and
// starters mix freely within a group (SUB_GK ↔ GK is fine). TEAM picks
// are never tradable.
/* Any position for any position. Same-position-only was a house rule the app
   invented; real leagues trade a keeper for a striker and live with the hole.
   The squad quota is checked when you next pick a line-up, which is where the
   consequence actually bites. TEAM picks still can't be traded. */
function pairValid(a, b) {
  return !!a && !!b && a.slot !== "TEAM" && b.slot !== "TEAM";
}

// pairs: [{ mine: pick, theirs: pick }] -> error message, or null if valid.
function tradeError(pairs) {
  if (!pairs.length) return "Add at least one pair.";
  const offered = new Set(), requested = new Set();
  for (const { mine, theirs } of pairs) {
    if (!mine || !theirs) return "Every pair needs a player on both sides.";
    if (!pairValid(mine, theirs)) return "TEAM picks can't be traded.";
    if (offered.has(mine.id) || requested.has(theirs.id))
      return "A player can only appear in one pair.";
    offered.add(mine.id);
    requested.add(theirs.id);
  }
  return null;
}

function openBuilder(targetId = "", parentId = null, pairs = null) {
  S.builder = { target: targetId, parent: parentId,
                pairs: pairs || [{ mine: "", theirs: "" }] };
  setBoardTab("trades");
  S.tradeTab = "deals";   // the builder lives here; without this it opened unseen
  renderTrades();
}


/* Choose a player by tapping them on a pitch, not from a dropdown that reads
   "SUB_FWD · R. Ngumoha (Liverpool, 0 pts)". A squad is a shape; picking from
   it should look like the shape.
     mgrId  : whose squad
     opts.tapAttr  : attribute written onto each chip (value = pick id)
     opts.eligible : (pick) => boolean — others are dimmed and untappable
     opts.selected : pick id currently chosen                              */
function squadChooserHtml(mgrId, opts = {}) {
  const picks = orderedRoster(S.managers.find((m) => m.id === mgrId) || { id: mgrId })
    .filter((pk) => pk.slot !== "TEAM");
  const ok = opts.eligible || (() => true);
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  const bench = [];
  for (const pk of picks) {
    const usable = ok(pk);
    const e = {
      id: pk.id, player_id: pk.player_id, name: pk.player_name, team: pk.team,
      position: pk.position, opp: oppShort(pk.team),
      dim: !usable, badge: opts.selected === pk.id ? "✓" : "",
    };
    if (pk.is_sub) bench.push(e);
    else if (byPos[pk.position]) byPos[pk.position].push(e);
  }
  const tap = opts.tapAttr || "data-choose";
  return `
    ${pitchHtml(byPos, { tapAttr: tap, crests: true })}
    ${bench.length ? `<div class="mt-1.5">
      <div class="eyebrow mb-1">Bench</div>
      ${dugoutHtml(bench, { tapAttr: tap })}
    </div>` : ""}`;
}

/* The league's waiver order, so "you're #4" means something. Top-down, because
   an order is a ranking and a horizontal strip that scrolls off the edge hides
   exactly the part you want — who is ahead of you. Folded away by default. */
function waiverOrderHtml(me) {
  const ranked = activeManagers()
    .filter((m) => m.waiver_order != null)
    .sort((a, b) => a.waiver_order - b.waiver_order);
  if (!ranked.length) return "";
  const mine = ranked.findIndex((m) => m.id === me?.id) + 1;
  return `<details class="rounded-lg border border-slate-700 bg-slate-800/40">
    <summary class="px-2.5 py-2 cursor-pointer select-none flex items-center justify-between gap-2">
      <span class="eyebrow">Waiver order</span>
      <span class="text-xs text-slate-400">${mine ? `you're #${mine} of ${ranked.length}` : `${ranked.length} managers`} ▾</span>
    </summary>
    <ol class="px-2 pb-2 space-y-1">
      ${ranked.map((m, i) => `<li class="flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        m.id === me?.id ? "bg-wcgold/10 border border-wcgold/40" : "bg-slate-900/60"}">
        <span class="w-5 shrink-0 font-mono text-xs ${i === 0 ? "text-wcgold" : "text-slate-400"}">${i + 1}</span>
        <span class="shrink-0 inline-flex items-center justify-center rounded-md w-6 h-6 text-xs"
              style="background:${managerColor(m)}26;border:1px solid ${managerColor(m)}99">${managerMark(m)}</span>
        <span class="min-w-0 flex-1 truncate text-sm">${esc(m.name)}${
          m.id === me?.id ? ' <span class="text-wcgold text-xs">(you)</span>' : ""}</span>
        ${i === 0 ? '<span class="shrink-0 text-[10px] text-wcgold">first refusal</span>' : ""}
      </li>`).join("")}
    </ol>
  </details>`;
}

/* The trade builder, as two squads you tap rather than a stack of dropdowns.

   Step 1 pick who you're dealing with, step 2 tap one of your players, step 3
   tap one of theirs — and the pair appears as a card you can remove. Only one
   thing is on screen at a time, which is the whole difference. */
function builderHtml(me) {
  const b = S.builder;
  const others = activeManagers().filter((m) => m.id !== me.id);
  const waiver = faDeferToClose();
  const head = (title, sub) => `<div class="flex items-baseline justify-between gap-2">
      <h3 class="font-semibold text-sm">${title}</h3>
      ${sub ? `<span class="text-xs text-slate-400">${sub}</span>` : ""}
    </div>`;

  // ---- step 1: who ----
  if (!b.target) {
    return `<div class="rounded-xl border border-wcgold bg-slate-900 p-3 space-y-2 mt-3">
      ${head("New deal", "step 1 of 3")}
      <p class="text-xs text-slate-400">Who are you dealing with?</p>
      <button data-partner="FA" class="w-full text-left rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 flex items-center gap-2">
        <span class="text-lg">🆓</span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold">Free agents</span>
          <span class="block text-xs text-slate-400">${waiver
            ? "Claims queue and resolve at window close, in waiver order"
            : "Swap straight away — no approval needed"}</span>
        </span></button>
      ${others.map((m) => `<button data-partner="${esc(m.id)}" class="w-full text-left rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 flex items-center gap-2">
        <span class="shrink-0 inline-flex items-center justify-center rounded-lg w-8 h-8 text-base"
              style="background:${managerColor(m)}26;border:1px solid ${managerColor(m)}99">${managerMark(m)}</span>
        <span class="min-w-0">
          <span class="block text-sm font-semibold truncate">${esc(m.name)}</span>
          <span class="block text-xs text-slate-400">${managerPicks(m.id).filter((pk) => pk.slot !== "TEAM").length} players</span>
        </span></button>`).join("")}
      <button id="trade-discard" class="w-full bg-slate-800 border border-slate-700 rounded-lg py-1.5 text-xs font-semibold">Cancel</button>
    </div>`;
  }

  // ---- free agents: pick who leaves, then who arrives ----
  if (b.target === "FA") {
    const want = S.faTarget;
    return `<div class="rounded-xl border border-wcgold bg-slate-900 p-3 space-y-2 mt-3">
      ${head(want ? `🆓 ${waiver ? "Claim" : "Sign"} ${esc(shortName(want.name))}` : "🆓 Free agents",
             want ? "who makes way?" : "step 2 of 3")}
      ${want ? `<div class="flex items-center gap-2 rounded-lg bg-live/10 border border-live/40 px-2 py-1.5">
          ${avatarHtml(want.player_id, want.team, "w-8 h-8")}
          <span class="min-w-0 flex-1 leading-tight">
            <span class="block truncate text-sm">Coming in: <b>${esc(want.name)}</b></span>
            <span class="block truncate text-xs text-slate-400">${esc(want.team)} · ${esc(want.position)}</span>
          </span>
          <button data-clearfa="1" class="shrink-0 text-xs text-slate-400 underline">change</button>
        </div>` : ""}
      <p class="text-xs ${waiver ? "text-amber-300" : "text-slate-400"}">${
        want
          ? (waiver
              ? `Tap whoever makes way — any position. The claim queues and resolves at window close, in waiver order.`
              : `Tap whoever makes way — any position. The swap applies immediately.`)
          : (waiver
              ? "Tap the player you'd drop, then choose who to claim. Claims resolve at window close, in waiver order."
              : "Tap the player you want to drop, then choose their replacement.")}</p>
      ${squadChooserHtml(me.id, { tapAttr: "data-faswap" })}
      <button id="trade-discard" class="w-full bg-slate-800 border border-slate-700 rounded-lg py-1.5 text-xs font-semibold">Close</button>
    </div>`;
  }

  // ---- manager trade: tap yours, tap theirs ----
  const partner = S.managers.find((m) => m.id === b.target);
  const pending = b.pairs.find((pr) => !pr.mine || !pr.theirs)
    || (b.pairs.length ? null : (b.pairs.push({ mine: "", theirs: "" }), b.pairs[0]));
  const done = b.pairs.filter((pr) => pr.mine && pr.theirs);
  const mineSel = pending && pending.mine ? pickById(pending.mine) : null;
  const paired = new Set(b.pairs.flatMap((pr) => [pr.mine, pr.theirs]).filter(Boolean));

  const pairCard = (pr, i) => {
    const mp = pickById(pr.mine), tp = pickById(pr.theirs);
    const side = (pk, who) => `<span class="min-w-0 flex-1 flex items-center gap-1.5 ${who === "in" ? "flex-row-reverse text-right" : ""}">
      ${avatarHtml(pk.player_id, pk.team, "w-7 h-7")}
      <span class="min-w-0">
        <span class="block truncate text-sm">${esc(shortName(pk.player_name))}</span>
        <span class="block truncate text-xs text-slate-400">${esc(pk.team)}</span>
      </span></span>`;
    return `<div class="rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2 flex items-center gap-2">
      ${side(mp, "out")}
      <span class="shrink-0 text-slate-400">⇄</span>
      ${side(tp, "in")}
      <button data-rmpair="${i}" class="shrink-0 text-slate-500 hover:text-wcred px-1" aria-label="Remove">✕</button>
    </div>`;
  };

  const step = !pending ? "" : !pending.mine
    ? `<div class="space-y-1.5">
         <p class="text-xs text-slate-400">Tap the player <b class="text-slate-200">you</b> would give up.</p>
         ${squadChooserHtml(me.id, { tapAttr: "data-pickmine", eligible: (pk) => !paired.has(pk.id) })}
       </div>`
    : `<div class="space-y-1.5">
         <div class="flex items-center gap-2 rounded-lg bg-wcred/15 border border-wcred/40 px-2 py-1.5">
           ${avatarHtml(mineSel.player_id, mineSel.team, "w-7 h-7")}
           <span class="min-w-0 flex-1 text-sm truncate">You give <b>${esc(mineSel.player_name)}</b></span>
           <button data-clearmine="1" class="shrink-0 text-xs text-slate-400 underline">change</button>
         </div>
         <p class="text-xs text-slate-400">Now tap the <b class="text-slate-200">${esc(partner?.name || "their")}</b> player you want — any position.</p>
         ${squadChooserHtml(b.target, { tapAttr: "data-picktheirs",
           eligible: (pk) => !paired.has(pk.id) })}
       </div>`;

  return `<div class="rounded-xl border border-wcgold bg-slate-900 p-3 space-y-2 mt-3">
    ${head(b.parent ? "Counter-offer" : "New deal",
           `with ${esc(partner?.name || "?")}`)}
    ${done.length ? `<div class="space-y-1">${done.map((pr) =>
      pairCard(pr, b.pairs.indexOf(pr))).join("")}</div>` : ""}
    ${step}
    <div class="flex gap-2 pt-1">
      <button id="trade-discard" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg py-2 text-xs font-semibold">Discard</button>
      <button id="trade-submit" class="flex-1 bg-wcred hover:bg-wcred-hov disabled:bg-slate-800 disabled:text-slate-500 rounded-lg py-2 text-xs font-semibold"${
        done.length ? "" : " disabled"}>Send ${done.length ? `(${done.length})` : ""}</button>
    </div>
  </div>`;
}

const TRADE_STATUS_STYLE = {
  proposed: "text-amber-300", accepted: "text-wcgold", rejected: "text-red-400",
  cancelled: "text-slate-400", countered: "text-sky-300",
};

/* A proposal, as the deal it is: their face, your players out on one side and
   theirs in on the other, with the arrow between them. The old card was two
   names and a slot code on one line of 12px text. */
function tradeSectionHtml(title, list, incoming) {
  const cards = list.map((t) => {
    const other = S.managers.find((m) =>
      m.id === (incoming ? t.proposer_manager_id : t.target_manager_id));
    const col = managerColor(other);
    const items = (t.trade_items || []).map((it) => {
      // "offered" is always from the proposer's side, so which column a player
      // belongs in flips depending on who is reading the card.
      const o = pickById(it.offered_pick_id), r = pickById(it.requested_pick_id);
      return incoming ? { gain: o, give: r } : { gain: r, give: o };
    });
    const col2 = (pk, tint) => pk ? `<span class="flex items-center gap-1.5 min-w-0">
        ${avatarHtml(pk.player_id, pk.team, "w-7 h-7")}
        <span class="min-w-0 leading-tight">
          <span class="block truncate text-sm">${esc(shortName(pk.player_name))}</span>
          <span class="block truncate text-[11px] ${tint}">${esc(pk.team)} · ${esc(pk.position)}</span>
        </span></span>` : '<span class="text-sm text-slate-500">?</span>';
    const rows = items.map(({ gain, give }) => `
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 rounded-lg bg-slate-800/60 px-2 py-1.5">
        ${col2(give, "text-red-300/70")}
        <span class="shrink-0 text-slate-500 text-xs">⇄</span>
        <span class="flex justify-end min-w-0">${col2(gain, "text-live/70")}</span>
      </div>`).join("");
    const actions = t.status !== "proposed" ? "" : incoming
      ? `${tradingOpen() ? `<button data-acc="${t.id}" class="flex-1 bg-wcred hover:bg-wcred-hov rounded-lg py-2 text-xs font-semibold">✓ Accept</button>` : ""}
         <button data-cnt="${t.id}" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg py-2 text-xs font-semibold">↩ Counter</button>
         <button data-rej="${t.id}" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg py-2 text-xs font-semibold text-slate-400">Reject</button>`
      : `<button data-can="${t.id}" class="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 text-xs font-semibold text-slate-400">Withdraw offer</button>`;
    return `<div class="rounded-xl border bg-slate-900 p-3 space-y-2"
                 style="border-color:${col}55">
      <div class="flex items-center gap-2">
        <span class="shrink-0 inline-flex items-center justify-center rounded-lg w-8 h-8 text-base"
              style="background:${col}26;border:1px solid ${col}99">${managerMark(other)}</span>
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block text-sm font-semibold truncate">${esc(other?.name ?? "?")}</span>
          <span class="block text-[11px] text-slate-400">${incoming ? "wants to deal" : "waiting on them"}${
            t.parent_trade_id ? " · counter-offer" : ""}</span>
        </span>
        <span class="shrink-0 text-[11px] font-semibold ${TRADE_STATUS_STYLE[t.status] || ""}">${t.status}</span>
      </div>
      <div class="grid grid-cols-[1fr_auto_1fr] gap-1.5 px-2 eyebrow">
        <span>you give</span><span></span><span class="text-right">you get</span>
      </div>
      <div class="space-y-1">${rows}</div>
      ${actions ? `<div class="flex gap-1.5 pt-0.5">${actions}</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="space-y-2">
    <h3 class="font-semibold text-sm px-1">${title}</h3>
    ${cards || '<p class="text-xs text-slate-400 px-1">None.</p>'}
  </div>`;
}

// Transactions log (bottom of the Trades tab): every completed roster move in
// the league, newest first — accepted manager-to-manager trades AND free-agent
// swaps merged into one chronological list. Trades read from `trades` (using
// the player-name snapshots on each trade_items row so they stay faithful even
// after later swaps/redrafts); swaps read from the `transactions` table. Always
// renders the heading so the section is discoverable even when empty.
function txWhen(ts) {
  return new Date(ts).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", timeZone: SA_TZ });
}

/* History cards. Every move in the league, told as a move: who was involved,
   which faces went which way, and when. The old cards were three lines of 12px
   grey text with arrows in them. */
const txAvatar = (pid, name, tint) => `<span class="flex items-center gap-1.5 min-w-0">
    ${avatarHtml(pid || "", "", "w-7 h-7")}
    <span class="min-w-0 leading-tight">
      <span class="block truncate text-xs">${esc(shortName(name || "?"))}</span>
      <span class="block text-[10px] ${tint}">${tint.includes("red") ? "out" : "in"}</span>
    </span></span>`;

const txMgrChip = (m) => `<span class="inline-flex items-center gap-1 min-w-0">
    <span class="shrink-0 inline-flex items-center justify-center rounded w-5 h-5 text-[11px]"
          style="background:${managerColor(m)}26;border:1px solid ${managerColor(m)}99">${managerMark(m)}</span>
    <span class="truncate text-xs">${esc(m?.name ?? "?")}</span></span>`;

function txShell(icon, headline, when, body, accent) {
  return `<div class="rounded-xl border bg-slate-900 overflow-hidden" style="border-color:${accent}44">
    <div class="flex items-center gap-2 px-3 py-2" style="background:${accent}14">
      <span class="shrink-0 text-base leading-none">${icon}</span>
      <span class="min-w-0 flex-1 text-xs">${headline}</span>
      <span class="shrink-0 text-[10px] text-slate-500">${esc(when)}</span>
    </div>
    <div class="px-3 py-2 space-y-1">${body}</div>
  </div>`;
}

function tradeTxCard(t) {
  const proposer = S.managers.find((m) => m.id === t.proposer_manager_id);
  const target   = S.managers.find((m) => m.id === t.target_manager_id);
  const pairs = (t.trade_items || []).map((it) => {
    const toProposer = it.requested_player_name ?? pickById(it.offered_pick_id)?.player_name;
    const toTarget   = it.offered_player_name   ?? pickById(it.requested_pick_id)?.player_name;
    return `<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-lg bg-slate-800/50 px-2 py-1.5">
      ${txAvatar(it.offered_player_id, toTarget, "text-red-300/70")}
      <span class="shrink-0 text-slate-500 text-xs">⇄</span>
      <span class="flex justify-end min-w-0">${txAvatar(it.requested_player_id, toProposer, "text-live/70")}</span>
    </div>`;
  }).join("");
  return txShell("🤝",
    `<span class="flex items-center gap-1.5 min-w-0">${txMgrChip(proposer)}
       <span class="shrink-0 text-slate-500">⇄</span>${txMgrChip(target)}</span>`,
    txWhen(t.updated_at), pairs, managerColor(proposer));
}

function swapTxCard(x) {
  const mgr = S.managers.find((m) => m.id === x.manager_id);
  const waiver = x.kind === "waiver";
  return txShell(waiver ? "⏳" : "🔁",
    `<span class="flex items-center gap-1.5 min-w-0">${txMgrChip(mgr)}
       <span class="shrink-0 text-slate-400">${waiver ? "won a waiver claim" : "took a free agent"}</span></span>`,
    txWhen(x.created_at),
    `<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-lg bg-slate-800/50 px-2 py-1.5">
       ${txAvatar(x.out_player_id, x.out_player_name, "text-red-300/70")}
       <span class="shrink-0 text-slate-500 text-xs">→</span>
       <span class="flex justify-end min-w-0">${txAvatar(x.in_player_id, x.in_player_name, "text-live/70")}</span>
     </div>`,
    managerColor(mgr));
}

/* When each trading window began: the moment of every lineup lock, newest
   first. The log uses the most recent one to split "this window" from the rest.
   (Deleted by a region rewrite of the history cards; its absence threw inside
   renderTrades BEFORE the innerHTML assignment, so tapping History did
   nothing at all rather than showing an error.) */
function txWindowStarts() {
  /* Keyed on effective_from -- when the line-up LOCKED -- not on when the row
     happened to be written. Since a save is now stamped for the lock ahead of
     it, created_at is just "someone edited their team", which would cut the
     window at the last edit and push everything since the real lock into
     "earlier". Future stamps are excluded for the same reason: that lock has
     not happened yet, so it cannot have started a window. */
  const now = Date.now();
  return [...new Set((S.snapshots || [])
    .map((sn) => Date.parse(sn.effective_from || sn.created_at))
    .filter((t) => !isNaN(t) && t <= now))].sort((a, b) => b - a);   // newest first
}

function transactionsLogHtml() {
  const entries = [];
  for (const t of S.trades.filter((t) => t.status === "accepted"))
    entries.push({ when: t.updated_at, html: tradeTxCard(t) });
  for (const x of (S.transactions || []))
    entries.push({ when: x.created_at, html: swapTxCard(x) });
  entries.sort((a, b) => String(b.when).localeCompare(String(a.when)));
  if (!entries.length)
    return `<div class="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center space-y-2">
      <div class="text-3xl">📜</div>
      <p class="text-sm text-slate-300">Nothing has moved yet.</p>
      <p class="text-xs text-slate-500">Trades, free agents and waiver claims all land here.</p></div>`;

  // Everything since the most recent lock is "this window".
  const cut = txWindowStarts()[0] ?? null;
  const current = cut == null ? entries
    : entries.filter((e) => Date.parse(e.when) >= cut);
  const earlier = cut == null ? []
    : entries.filter((e) => Date.parse(e.when) < cut);
  // With no lock yet, or a window nobody has used, still show the recent few.
  const shown = current.length ? current : entries.slice(0, 3);
  const rest  = current.length ? earlier : entries.slice(3);

  return `<div class="space-y-2">
    <div class="flex items-baseline justify-between gap-2 px-1">
      <h3 class="font-semibold text-sm">Every move</h3>
      <span class="eyebrow">${current.length ? "this window" : "recent"}</span>
    </div>
    ${shown.map((e) => e.html).join("")}
    ${rest.length ? `<details class="rounded-xl border border-slate-700 bg-slate-900">
      <summary class="px-3 py-2.5 text-sm font-semibold cursor-pointer select-none flex items-center justify-between gap-2">
        <span>Earlier windows</span>
        <span class="text-xs text-slate-400">${rest.length} move${rest.length === 1 ? "" : "s"} ▾</span>
      </summary>
      <div class="px-3 pb-3 space-y-2">${rest.slice(0, 60).map((e) => e.html).join("")}</div>
    </details>` : ""}
  </div>`;
}

// Your private shortlist — collapsed behind a "View shortlist" button,
// with the same position + category filters as the Stats tab. Players are
// tappable for the full detail card, and carry a Trade shortcut when the
// window is open. Only ever built from your own shortlist.
/* The watchlist. It used to carry its own position chips, sort dropdown and
   unpicked / hide-KO toggles — a second, worse copy of the Players page bolted
   under a collapsed header. A shortlist is a short list: it needs the same row
   as everywhere else and nothing around it. */
/* The watchlist: the Players page's row, plus the filters that page has —
   club, position, sort (including per 90), and free-agents-only — because a
   28-name list is a list you need to narrow. Form dots come along too. */
function shortlistSectionHtml(me) {
  const open = tradingOpen();
  const allIds = myShortlist();
  const owned = pickedIdSet();
  const per90 = !!S.wlPer90;
  const sortKey = S.wlSort || "points";

  let players = allIds.map((pid) => S.playerById[pid]).filter(Boolean);
  const teams = [...new Set(players.map((p) => p.team).filter(Boolean))].sort();
  if (S.wlTeam) players = players.filter((p) => p.team === S.wlTeam);
  if (S.wlPos && S.wlPos !== "ALL") players = players.filter((p) => p.position === S.wlPos);
  if (S.wlFree) players = players.filter((p) => !owned.has(p.player_id));

  const ranked = players.map((p) => {
    const rows = statsScopedRows(p.player_id, p.team, 0);
    const mins = sumMinutes(rows);
    const raw = sortKey === "points" ? playerPoints(p.player_id, p.position)
                                     : playerStatTotal(p.player_id, sortKey);
    const val = per90 && mins > 0 ? Math.round((raw / mins) * 90 * 10) / 10 : raw;
    return { p, val, mins };
  }).sort((a, b) => b.val - a.val || a.p.name.localeCompare(b.p.name));

  const chip = (on) => `rounded-full px-2.5 py-1 border text-xs ${
    on ? "border-wcgold text-wcgold bg-wcgold/10" : "border-slate-700 text-slate-400"}`;

  const rows = ranked.map(({ p, val, mins }) => {
    const ownPick = S.picks.find((pk) => pk.player_id === p.player_id);
    const mine = ownPick && ownPick.manager_id === me.id;
    return `<li class="flex items-center gap-1">
      ${starHtml(p.player_id)}
      <button data-sldetail="${esc(p.player_id)}" class="flex-1 min-w-0 flex items-center gap-2 py-2 text-left">
        ${avatarHtml(p.player_id, p.team)}
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1 text-sm min-w-0">
            <span class="truncate">${esc(p.name)}</span>
            <span class="shrink-0 flex items-center gap-1">${availBadges(p.player_id)}</span>
          </span>
          <span class="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
            ${mine ? '<span class="shrink-0 text-wcgold">yours</span>'
                   : ownerChipHtml(p.player_id) || '<span class="shrink-0 text-live">free</span>'}
            ${teamCrestHtml(p.team, "w-3.5 h-3.5")}<span class="truncate">${esc(p.team_code || p.team)}</span>
            <span class="min-w-0 truncate">${formDots(p.player_id, p.position)}</span>
          </span>
        </span>
        <span class="pos-${p.position} rounded px-1.5 py-0.5 text-xs font-semibold shrink-0">${p.position}</span>
        <span class="shrink-0 w-9 text-right leading-tight">
          <span class="block font-mono font-bold ${val > 0 ? "text-wcgold" : "text-slate-400"}">${val}</span>
          ${per90 ? `<span class="block text-[10px] text-slate-500">${mins}′</span>` : ""}
        </span>
      </button>
      ${!mine && open ? `<button data-sltrade="${esc(p.player_id)}" class="shrink-0 rounded-lg bg-wcred hover:bg-wcred-hov px-2.5 py-1.5 text-xs font-semibold">${
        owned.has(p.player_id) ? "Offer" : (faDeferToClose() ? "Claim" : "Swap")}</button>` : ""}
    </li>`;
  }).join("");

  return `<div class="space-y-2">
    <div class="flex items-baseline justify-between gap-2 px-1">
      <span class="text-sm font-semibold">★ Watchlist</span>
      <span class="text-xs text-slate-400">${ranked.length} of ${allIds.length} · only you</span>
    </div>
    ${allIds.length ? `
      <div class="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5">
        ${["ALL", ...GROUPS.slice(0, 4)].map((g) =>
          `<button data-wlpos="${g}" class="shrink-0 ${chip((S.wlPos || "ALL") === g)}">${g}</button>`).join("")}
        <button data-wlfree="1" class="shrink-0 ${chip(!!S.wlFree)}">🟢 Free only</button>
        <button data-wl90="1" class="shrink-0 ${chip(per90)}">⏱ per 90</button>
      </div>
      <div class="flex gap-2">
        <select id="wl-team" class="min-w-0 flex-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs">
          <option value="">All clubs</option>
          ${teams.map((tm) => `<option value="${esc(tm)}" ${S.wlTeam === tm ? "selected" : ""}>${esc(tm)}</option>`).join("")}
        </select>
        <select id="wl-sort" class="min-w-0 flex-1 rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs">
          ${STAT_SORTS.map(([k, lbl]) => `<option value="${k}" ${sortKey === k ? "selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </div>` : ""}
    ${rows
      ? `<ul class="rounded-xl border border-slate-700 bg-slate-900 px-3 divide-y divide-slate-800">${rows}</ul>
         <div class="flex gap-2">
           ${isCupCompetition() ? '<button id="sl-clean" class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300">🧹 Drop knocked-out</button>' : ""}
           <button id="sl-clear" class="flex-1 rounded-lg border border-red-500/40 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-red-400">Clear all</button>
         </div>`
      : allIds.length
        ? '<p class="text-xs text-slate-400 text-center py-4">Nothing matches those filters.</p>'
        : `<div class="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center space-y-2">
             <div class="text-3xl">★</div>
             <p class="text-sm text-slate-300">Nothing on your watchlist.</p>
             <p class="text-xs text-slate-500">Tap ☆ next to any player on the Players tab to keep an eye on them.</p>
           </div>`}
  </div>`;
}

// Trade shortcut from the shortlist: owned → propose to the owner with their
// player pre-filled; free agent → the normal swap screen (direct when you
// have one same-position player, else the FA swap builder to choose).
function tradeForShortlisted(pid) {
  if (!tradingOpen()) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  const me = myManager();
  const p = S.playerById[pid];
  if (!p) return;
  const ownPick = S.picks.find((pk) => pk.player_id === pid);
  if (ownPick && ownPick.manager_id === me.id) return toast("Already on your roster.");
  if (ownPick) {
    openBuilder(ownPick.manager_id, null, [{ mine: "", theirs: ownPick.id }]);
    return;
  }
  /* A free agent. Any of your players can go the other way — positions are no
     longer locked — so the question is only "who do you drop". Remember WHO
     you're chasing so the next screen finishes that job rather than starting a
     fresh, unrelated swap. */
  const mySwappable = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM");
  if (!mySwappable.length) return toast("You have no players to swap out.");
  S.faTarget = { player_id: pid, name: p.name, team: p.team, position: p.position };
  openBuilder("FA");
}

// Squad planner section (Trades tab): your whole squad, with planned
// replacements per slot. Collapsed behind a "Squad planner" button.
/* The planner, on the pitch. Which of your slots has a replacement lined up is
   a question about your team's shape, so it's answered on a pitch: a shirt with
   a plan wears a badge, and tapping any shirt opens or edits its plan. The
   detail (ranked choices, execute) lists underneath, but only for slots you've
   actually planned — the old version listed all fifteen whether or not there
   was anything to say. */
function plannerSectionHtml(me) {
  const open = tradingOpen();
  const myPickIds = new Set(managerPicks(me.id).map((pk) => pk.id));
  const planned = plannerMoves().filter((m) => myPickIds.has(m.out));
  const plannedFor = new Set(planned.map((m) => m.out));

  /* A planned slot shows the player you INTEND to have there, with the one
     they'd replace shrunk into the corner. Seeing the plan as the team it
     would produce is the point of planning it. */
  const firstChoice = (pk) => {
    const m = plannerMoves().find((x) => x.out === pk.id);
    const pid = m?.choices?.[0];
    return pid ? S.playerById[pid] : null;
  };
  const picks = orderedRoster(me).filter((pk) => pk.slot !== "TEAM");
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  const bench = [];
  for (const pk of picks) {
    const inc = firstChoice(pk);
    const e = inc
      ? { id: pk.id, player_id: inc.player_id, name: inc.name, team: inc.team,
          position: pk.position, opp: oppShort(inc.team), swapFor: pk.player_id, planned: true }
      : { id: pk.id, player_id: pk.player_id, name: pk.player_name, team: pk.team,
          position: pk.position, opp: oppShort(pk.team) };
    if (pk.is_sub) bench.push(e); else if (byPos[pk.position]) byPos[pk.position].push(e);
  }

  const detail = planned.map((m) => {
    const pk = pickById(m.out);
    return pk ? `<div class="rounded-xl border border-slate-700 bg-slate-900 p-2.5 space-y-1.5">
      <div class="flex items-center gap-1.5">
        ${avatarHtml(pk.player_id, pk.team, "w-6 h-6")}
        <span class="min-w-0 flex-1 leading-tight">
          <span class="block truncate text-sm">Out: ${esc(pk.player_name)}</span>
          <span class="block truncate text-xs text-slate-400">${pk.slot} · ${esc(pk.team)}</span>
        </span>
      </div>
      ${plannerMoveHtml(pk, m, open)}
    </div>` : "";
  }).join("");

  return `<div class="space-y-2">
    <div class="flex items-baseline justify-between gap-2 px-1">
      <span class="text-sm font-semibold">🗺 Squad planner</span>
      <span class="text-xs text-slate-400">only you can see this</span>
    </div>
    <p class="text-xs text-slate-400">Tap a shirt to line up a replacement — a first choice plus backups. ${
      open ? "The window's open, so you can execute them below." : "You can execute once the window opens."}</p>
    ${pitchHtml(byPos, { tapAttr: "data-plplan", crests: true })}
    ${bench.length ? `<div><div class="eyebrow mb-1">Bench</div>${dugoutHtml(bench, { tapAttr: "data-plplan" })}</div>` : ""}
    ${detail ? `<div class="space-y-2 pt-1">${detail}</div>`
      : '<p class="text-xs text-slate-400 text-center py-2">No plans yet — 🗺 marks a shirt once you make one.</p>'}
    ${plannerMoves().length ? '<button id="pl-clear" class="w-full text-xs text-slate-400 underline">clear planner</button>' : ""}
  </div>`;
}

// One planned move: ranked choices (with status) + execution controls.
function plannerMoveHtml(outPick, m, open) {
  const choices = (m.choices || []).map((pid) => ({ pid, p: S.playerById[pid], st: choiceStatus(pid) }))
    .filter((c) => c.p);
  const target = choices.find((c) => c.st.kind === "fa" || c.st.kind === "owned");
  const statusTxt = (st) => st.kind === "fa" ? '<span class="text-live">free agent</span>'
    : st.kind === "owned" ? `<span class="text-wcgold">${esc(st.manager?.name ?? "?")}</span>`
    : st.kind === "yours" ? '<span class="text-slate-400">already yours</span>'
    : '<span class="text-red-400">knocked out</span>';

  /* Same reorder mechanics as every other queue: a stacked arrow column and
     hold-to-drag. It used to be a single "↑" that promoted one place per tap
     and rebuilt the whole planner each time, which is why it crawled. */
  const choiceRows = choices.map((c, i) => `
    <div data-plrow="${esc(c.pid)}" class="flex items-center gap-1.5 rounded-lg bg-slate-900/60 px-1.5 py-1">
      <span class="w-4 shrink-0 font-mono text-xs ${i === 0 ? "text-wcgold font-bold" : "text-slate-400"}">${i + 1}</span>
      ${avatarHtml(c.pid, c.p.team, "w-6 h-6")}
      <span class="min-w-0 flex-1 leading-tight">
        <span class="flex items-center gap-1 min-w-0">
          <span class="truncate text-xs">${esc(c.p.name)}</span>
          <span class="shrink-0">${availBadges(c.pid)}</span>
        </span>
        <span class="block truncate text-[10px]">${statusTxt(c.st)}</span>
      </span>
      ${choices.length > 1 ? `<span class="nudge-col shrink-0 leading-none">
        <button data-plup="${outPick.id}|${c.pid}" ${i === 0 ? "disabled" : ""} class="nudge text-slate-400 ${i === 0 ? "opacity-30" : ""}" aria-label="Higher choice">▲</button>
        <button data-pldn="${outPick.id}|${c.pid}" ${i === choices.length - 1 ? "disabled" : ""} class="nudge text-slate-400 ${i === choices.length - 1 ? "opacity-30" : ""}" aria-label="Lower choice">▼</button>
      </span>` : ""}
      <button data-plrm="${outPick.id}|${c.pid}" class="tap shrink-0 text-slate-500 hover:text-wcred" aria-label="Remove">✕</button>
    </div>`).join("");

  let exec = "";
  if (open && target) {
    const backup = choices[0] !== target;
    const verb = target.st.kind === "fa" ? (faDeferToClose() ? "Claim" : "Swap in") : "Offer for";
    exec = `<button data-plexec="${outPick.id}|${target.pid}" class="w-full ${
      backup ? "bg-slate-800 border border-wcgold/60 text-wcgold" : "bg-wcred hover:bg-wcred-hov"
    } rounded-lg py-2 text-xs font-semibold">${verb} ${esc(shortName(target.p.name))}${
      backup ? " (backup — 1st is gone)" : ""}</button>`;
  } else if (open) {
    exec = '<div class="text-xs text-slate-400 text-center">Nothing on this list is available right now.</div>';
  }

  return `<div id="pl-choices-${esc(outPick.id)}" class="space-y-1">
    ${choiceRows || '<div class="text-xs text-slate-400">No options yet.</div>'}
    <div class="flex items-center gap-3">
      <button data-pladd="${outPick.id}" class="text-xs text-wcgold underline">+ add option</button>
      <button data-plrmmove="${outPick.id}" class="text-xs text-slate-400 underline ml-auto">remove plan</button>
    </div>
    ${exec}
  </div>`;
}

function plannerExec(outPickId, pid) {
  if (!tradingOpen()) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  const outPick = S.picks.find((pk) => pk.id === outPickId);
  if (!outPick) return toast("That player is no longer on your roster.");
  const p = S.playerById[pid];
  if (!p) return;
  const st = choiceStatus(pid);
  if (st.kind === "fa") {
    const waiver = faDeferToClose();
    const msg = waiver
      ? `Queue a waiver claim — ${p.name} for ${outPick.player_name}? It resolves at window close, in waiver order.`
      : `Swap out ${outPick.player_name} for ${p.name} (free agent)?`;
    if (confirm(msg))
      swapOrClaim(outPick, { player_id: pid, name: p.name, team: p.team })
        .catch((e) => toast(e.message));
  } else if (st.kind === "owned") {
    openBuilder(st.pick.manager_id, null, [{ mine: outPick.id, theirs: st.pick.id }]);
  } else {
    toast("That option isn't available to acquire.");
  }
}

// Candidate pool for the "plan a replacement" picker: every player in the
// slot's position except ones already on your roster, filtered by shortlist /
// nation / search and ranked by the chosen stat (points by default). Players
// already chosen for this move are NOT dropped — they stay so the picker can
// highlight them. Pure (DOM-free) so it's unit-tested.
function plannerPickPool(group, { shortlistOnly, q, sortKey, unpicked, hideKO } = {}) {
  const myIds = new Set(managerPicks(myManager()?.id).map((pk) => pk.player_id));
  const owned = unpicked ? pickedIdSet() : null;
  const sl = new Set(myShortlist());
  const key = sortKey || "points";
  const byPoints = key === "points";
  const valOf = (p) => byPoints ? playerPoints(p.player_id, p.position)
    : playerStatTotal(p.player_id, key);
  const t = (q || "").trim().toLowerCase();
  return S.players
    // group null = any position; trades are no longer position-locked.
    .filter((p) => (!group || p.position === group) && !myIds.has(p.player_id)
      && (!shortlistOnly || sl.has(p.player_id))
      && (!hideKO || !isEliminated(p.team))
      && (!unpicked || !owned.has(p.player_id))
      && (!t || p.name.toLowerCase().includes(t) || p.team.toLowerCase().includes(t)))
    .map((p) => ({ p, val: valOf(p), pts: playerPoints(p.player_id, p.position) }))
    .sort((a, b) => b.val - a.val || b.pts - a.pts || a.p.name.localeCompare(b.p.name))
    .slice(0, 80);
}

function openPlannerPick(outPickId) {
  const outPick = S.picks.find((pk) => pk.id === outPickId);
  if (!outPick) return;
  S.plannerPickFor = outPickId;
  S.plannerSearch = "";
  S.plannerSort = "points";
  // Open on your shortlist for this position when you've starred someone there.
  const group = slotGroup(outPick.slot);
  const sl = new Set(myShortlist());
  S.plannerShortlistOnly = S.players.some((p) => p.position === group && sl.has(p.player_id));
  $("planner-search").value = "";
  $("planner-title").textContent =
    `Replacement options for ${outPick.player_name} (${group})`;
  renderPlannerPick();
  $("planner-sheet").classList.remove("hidden");
}

function renderPlannerPick() {
  const outPick = S.picks.find((pk) => pk.id === S.plannerPickFor);
  if (!outPick) return;
  const group = slotGroup(outPick.slot);
  const move = moveFor(outPick.id);
  const choices = move?.choices || [];
  const chosen = new Set(choices);

  // Filter controls: shortlist toggle + stat leaderboard (team search covers
  // nation). The right column mirrors the Stats tab — stat tally + points.
  const chipCls = (on) => `rounded-full px-3 py-1 border ${
    on ? "border-wcgold text-wcgold" : "border-slate-700 text-slate-400"}`;
  $("planner-slfilter").className = chipCls(S.plannerShortlistOnly);
  $("planner-slfilter").textContent = "★ shortlist";
  $("planner-unpicked").className = chipCls(S.plannerUnpicked);
  $("planner-unpicked").textContent = "🟢 Unpicked";
  $("planner-hideko").className = chipCls(S.plannerHideKO);
  $("planner-hideko").textContent = "🚫 Hide KO";
  // Nobody is knocked out of a league season.
  $("planner-hideko").classList.toggle("hidden", !isCupCompetition());
  /* Opens filtered to the slot's own position, because that is the swap you
     usually mean — but trades are no longer position-locked, so it has to be
     possible to turn off rather than being the only thing on offer. */
  const anyPos = !!S.plannerAnyPos;
  $("planner-pos").className = chipCls(!anyPos);
  $("planner-pos").textContent = anyPos ? "⇄ any position" : `⇄ ${group} only`;
  $("planner-sort").innerHTML = STAT_SORTS.map(([k, lbl]) =>
    `<option value="${k}" ${S.plannerSort === k ? "selected" : ""}>${lbl}</option>`).join("");

  const sortKey = S.plannerSort || "points";
  const byPoints = sortKey === "points";
  const valOf = (p) => byPoints ? playerPoints(p.player_id, p.position)
    : playerStatTotal(p.player_id, sortKey);

  let list = plannerPickPool(anyPos ? null : group, {
    shortlistOnly: S.plannerShortlistOnly, q: S.plannerSearch, sortKey,
    unpicked: S.plannerUnpicked, hideKO: S.plannerHideKO,
  });
  // Keep already-chosen players visible even if a filter would hide them.
  const present = new Set(list.map((x) => x.p.player_id));
  const pinned = choices.map((pid) => S.playerById[pid]).filter((p) => p && !present.has(p.player_id))
    .map((p) => ({ p }));
  list = [...pinned, ...list];

  $("planner-list").innerHTML = list.map(({ p }) => {
    const st = choiceStatus(p.player_id);
    const stTxt = st.kind === "fa" ? "free agent" : st.kind === "owned" ? `👤 ${esc(st.manager?.name ?? "?")}`
      : st.kind === "yours" ? "already yours" : st.kind === "ko" ? "🚫 out" : "";
    const pts = playerPoints(p.player_id, p.position);
    const val = valOf(p);
    const next = upNextHtml(p.team, "w-3.5 h-3.5");
    const idx = choices.indexOf(p.player_id);
    const picked = idx >= 0;
    const badge = picked
      ? `<span class="ml-1 rounded px-1 py-0.5 text-xs ${idx === 0
          ? "bg-wcgold/20 text-wcgold" : "bg-slate-700 text-slate-300"}">${idx === 0 ? "1st choice" : "backup"}</span>`
      : "";
    return `<li class="flex items-center py-2 gap-1.5 ${picked ? "bg-wcgold/10 -mx-1 px-1 rounded" : ""}">
      ${starHtml(p.player_id)}
      <button data-plopen="${esc(p.player_id)}" class="min-w-0 flex-1 flex items-center gap-1.5 text-left">
        ${avatarHtml(p.player_id, p.team, "w-6 h-6")}
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm">${esc(p.name)} ${availBadges(p.player_id)}${badge}</span>
          <span class="flex items-center gap-1 truncate text-xs text-slate-400">${esc(p.team)} · ${stTxt}${next ? ` · ${next}` : ""}</span>
        </span>
      </button>
      <span class="shrink-0 w-10 text-right">
        <span class="block font-mono font-bold ${val > 0 ? "text-wcgold" : "text-slate-400"}">${val}</span>
        ${byPoints ? "" : `<span class="block text-xs text-slate-400">${pts}p</span>`}
      </span>
      <button data-pltoggle="${esc(p.player_id)}" class="shrink-0 rounded-lg px-3 py-1 text-xs font-semibold ${
        picked ? "bg-slate-800 border border-slate-600 text-slate-300" : "bg-wcred hover:bg-wcred-hov"}">${
        picked ? "✓ Added" : "Add"}</button>
    </li>`;
  }).join("") || '<li class="py-4 text-sm text-slate-400">No players match these filters.</li>';

  $("planner-list").querySelectorAll("[data-plopen]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.plopen));
  $("planner-list").querySelectorAll("[data-pltoggle]").forEach((b) => b.onclick = () => {
    const pid = b.dataset.pltoggle;
    (chosen.has(pid) ? plannerRemoveChoice(S.plannerPickFor, pid)
                     : plannerAddChoice(S.plannerPickFor, pid));   // optimistic
    renderPlannerPick();
  });
  wireStars($("planner-list"), renderPlannerPick);
}

// Your queued waiver claims, in preference order, with reorder + cancel.
/* One queued claim. The old row put a grey disc between two faces and gave the
   arrow its own grid column, which ate the width the names needed — every name
   truncated. Overlapping the two avatars says "this for that" in less space
   than an arrow does, so the names get the room back: the outgoing player sits
   behind in a red ring, the incoming one in front in green. */
function faClaimRowHtml(c, i, n) {
  return `
    <div data-clrow="${esc(c.id)}" class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2 py-2">
      <span class="w-4 shrink-0 font-mono text-sm ${i === 0 ? "text-wcgold font-bold" : "text-slate-500"}">${i + 1}</span>
      <span class="shrink-0 relative inline-flex items-center" style="width:3.15rem;height:2rem">
        <span class="absolute left-0 top-0 rounded-full ring-2 ring-red-400/70 opacity-70 inline-flex">
          ${avatarHtml(c.out_player_id, "", "w-7 h-7")}</span>
        <span class="absolute right-0 top-0 rounded-full ring-2 ring-live inline-flex shadow-md shadow-black/50">
          ${avatarHtml(c.in_player_id, "", "w-7 h-7")}</span>
      </span>
      <span class="min-w-0 flex-1 leading-tight">
        <span class="block truncate text-sm"><span class="text-live">in</span> ${esc(c.in_player_name || "?")}</span>
        <span class="block truncate text-xs text-slate-400"><span class="text-red-300/80">out</span> ${esc(c.out_player_name || "?")}</span>
      </span>
      ${n > 1 ? `<span class="nudge-col shrink-0 leading-none">
        <button data-claimup="${esc(c.id)}"${i === 0 ? " disabled" : ""} class="nudge text-slate-400 ${i === 0 ? "opacity-30" : ""}" aria-label="Higher priority">▲</button>
        <button data-claimdown="${esc(c.id)}"${i === n - 1 ? " disabled" : ""} class="nudge text-slate-400 ${i === n - 1 ? "opacity-30" : ""}" aria-label="Lower priority">▼</button>
      </span>` : ""}
      <button data-claimx="${esc(c.id)}" class="tap shrink-0 text-slate-500 hover:text-wcred" aria-label="Cancel claim">✕</button>
    </div>`;
}

const faClaimRowsHtml = () => {
  const mine = myClaims();
  return mine.map((c, i) => faClaimRowHtml(c, i, mine.length)).join("")
    || '<p class="text-xs text-slate-400">No claims queued — tap “Claim” on a free agent to add one.</p>';
};

/* Repaint ONLY the claim list. Reordering used to re-render the entire trades
   page — banner, proposals, planner and all — for a two-row swap, which is
   what made it stutter and jump. Same treatment the draft queue and the bench
   already had. */
function renderClaimList() {
  const box = $("fa-claim-list");
  if (!box) return;
  box.innerHTML = faClaimRowsHtml();
  wireClaimControls(box);
}

function wireClaimControls(box) {
  box.querySelectorAll("[data-claimup]").forEach((b) => b.onclick = () => reorderClaim(b.dataset.claimup, -1));
  box.querySelectorAll("[data-claimdown]").forEach((b) => b.onclick = () => reorderClaim(b.dataset.claimdown, 1));
  box.querySelectorAll("[data-claimx]").forEach((b) => b.onclick = () =>
    cancelClaim(b.dataset.claimx).catch((e) => toast(e.message)));
  makeReorderable(box, "data-clrow", (order, moved) => {
    if (setClaimOrder(order))
      animateReorder("fa-claim-list", "data-clrow", renderClaimList, moved);
  });
}

// Your queued waiver claims, in preference order, with reorder + cancel.
function faClaimsSectionHtml(me) {
  const mine = myClaims();
  const priority = me.waiver_order != null
    ? `You're <b class="text-wcgold">#${me.waiver_order + 1}</b>`
    : "priority set at window open";
  return `<div class="rounded-xl border border-slate-700 bg-slate-900 p-3 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-semibold text-sm">⏳ Waiver claims</h3>
      <span class="text-xs text-slate-400">${priority}</span>
    </div>
    <p class="text-xs text-slate-400">These resolve when the window closes, in waiver order (worst-placed picks first). Order yours by preference — the first still-available one lands.</p>
    ${waiverOrderHtml(me)}
    <div id="fa-claim-list" class="space-y-1">${faClaimRowsHtml()}</div>
    ${mine.length > 1 ? '<p class="text-xs text-slate-400">Hold a row to drag it anywhere in the queue.</p>' : ""}
  </div>`;
}

/* The Activity → Trades page, as four small pages instead of one long scroll.
   Everything used to be on screen at once — window banner, waiver queue,
   planner, watchlist and the builder — which is why it read as a wall. Each is
   a different job, so each gets a tab and the page only ever shows one. */
const TRADE_TABS = [
  ["deals", "Deals"], ["planner", "Planner"], ["watch", "Watchlist"], ["history", "History"],
];

function renderTrades() {
  const box = $("board-trades");
  const me = myManager();
  if (!me) {
    box.innerHTML = '<p class="text-sm text-slate-400 py-4">Join as a manager to trade.</p>';
    return;
  }
  const open = tradingOpen();
  const pendingIn = S.trades.filter((t) =>
    t.target_manager_id === me.id && t.status === "proposed");
  const pendingOut = S.trades.filter((t) =>
    t.proposer_manager_id === me.id && t.status === "proposed");
  const myPickIds = new Set(managerPicks(me.id).map((pk) => pk.id));
  const plans = plannerMoves().filter((m) => myPickIds.has(m.out)).length;
  const counts = { deals: pendingIn.length, planner: plans,
                   watch: myShortlist().length, history: 0 };
  const tab = S.tradeTab && TRADE_TABS.some(([k]) => k === S.tradeTab) ? S.tradeTab : "deals";
  S.tradeTab = tab;

  const nav = `<div class="flex gap-1 rounded-lg bg-slate-900 border border-slate-700 p-1 text-sm">
    ${TRADE_TABS.map(([k, label]) => `<button data-tradetab="${k}" class="flex-1 rounded-md py-1.5 text-xs font-semibold ${
      k === tab ? "bg-slate-700 text-wcgold" : "text-slate-400"}">${label}${
      counts[k] ? ` <span class="inline-flex items-center justify-center rounded-full bg-wcgold text-slate-900 w-4 h-4 text-[10px] align-middle">${counts[k]}</span>` : ""}</button>`).join("")}
  </div>`;

  // The window state leads every tab: it decides what you can do at all.
  const when = autoWindowsEnabled() ? (open ? lineupLockMessage() : tradeWindowMessage()) : "";
  const banner = `<div class="rounded-xl border ${open ? "border-wcgold/60 bg-wcred/10" : "border-slate-700 bg-slate-900"} px-3 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="min-w-0">
        <span class="block text-sm font-semibold">${open ? "🔓 Window open" : "🔒 Window closed"}</span>
        <span class="block text-xs text-slate-400 truncate">${open
          ? "Deals, free agents and line-up changes are live."
          : "You can still reply to pending offers."}</span>
      </span>
      ${open && !S.builder && tab === "deals"
        ? '<button id="trade-new" class="shrink-0 bg-wcred hover:bg-wcred-hov rounded-lg px-3 py-2 text-sm font-semibold">＋ New deal</button>' : ""}
    </div>
    ${when ? `<div class="mt-1.5 text-xs text-wcgold border-t border-white/10 pt-1.5">${esc(when)}</div>` : ""}
  </div>`;

  /* Build the tab's body inside a guard. A throw in here used to happen BEFORE
     the innerHTML assignment below, so the old markup stayed on screen and the
     tab looked like a dead button — which is exactly how a missing helper
     presented. A broken tab should say it is broken. */
  let body = "";
  try {
    body = tradeTabBodyHtml(tab, me, { open, pendingIn, pendingOut });
  } catch (e) {
    body = `<div class="rounded-xl border border-wcred/50 bg-wcred/10 p-4 space-y-1">
      <div class="text-sm font-semibold">This tab failed to load</div>
      <p class="text-xs text-slate-400">The rest of the app is fine — try another tab.</p>
      <p class="text-xs text-slate-500 font-mono break-words">${esc(String(e && e.message || e))}</p>
    </div>`;
  }

  box.innerHTML = `<div class="space-y-2">${nav}${banner}</div>` + `<div class="space-y-3 mt-3">${body}</div>`;
  box.querySelectorAll("[data-tradetab]").forEach((b) => b.onclick = () => {
    S.tradeTab = b.dataset.tradetab; renderTrades();
  });
  wireTrades(me);
}

function tradeTabBodyHtml(tab, me, { open, pendingIn, pendingOut }) {
  let body = "";
  if (tab === "deals") {
    if (S.builder) body += builderHtml(me);
    if (faDeferToClose()) body += faClaimsSectionHtml(me);
    if (pendingIn.length)
      body += tradeSectionHtml(`🔔 Waiting on you (${pendingIn.length})`, pendingIn, true);
    if (pendingOut.length)
      body += tradeSectionHtml(`📤 Sent — awaiting reply (${pendingOut.length})`, pendingOut, false);
    if (!S.builder && !pendingIn.length && !pendingOut.length && !faDeferToClose())
      body += `<div class="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center space-y-2">
        <div class="text-3xl">🤝</div>
        <p class="text-sm text-slate-300">No deals on the table.</p>
        <p class="text-xs text-slate-500">${open
          ? "Tap ＋ New deal to offer a swap, or raid the free agents."
          : "The window is closed — deals open again next window."}</p>
      </div>`;
  } else if (tab === "planner") {
    body += plannerSectionHtml(me);
  } else if (tab === "watch") {
    body += shortlistSectionHtml(me);
  } else {
    body += transactionsLogHtml();
  }
  return body;
}

function wireTrades(me) {
  const box = $("board-trades");
  const byId = (id) => S.trades.find((t) => t.id === id);
  wireStars(box, renderTrades);
  const claimBox = box.querySelector("#fa-claim-list");
  if (claimBox) wireClaimControls(claimBox);
  box.querySelectorAll("[data-wlpos]").forEach((b) => b.onclick = () => {
    S.wlPos = b.dataset.wlpos; renderTrades();
  });
  const wlFree = box.querySelector("[data-wlfree]");
  if (wlFree) wlFree.onclick = () => { S.wlFree = !S.wlFree; renderTrades(); };
  const wl90 = box.querySelector("[data-wl90]");
  if (wl90) wl90.onclick = () => { S.wlPer90 = !S.wlPer90; renderTrades(); };
  const wlTeam = box.querySelector("#wl-team");
  if (wlTeam) wlTeam.onchange = () => { S.wlTeam = wlTeam.value || ""; renderTrades(); };
  const wlSort = box.querySelector("#wl-sort");
  if (wlSort) wlSort.onchange = () => { S.wlSort = wlSort.value; renderTrades(); };
  const slClean = box.querySelector("#sl-clean");
  if (slClean) slClean.onclick = () => cleanShortlist().catch((e) => toast(e.message));
  const slClear = box.querySelector("#sl-clear");
  if (slClear) slClear.onclick = () => clearShortlist();
  box.querySelectorAll("[data-sldetail]").forEach((b) => b.onclick = () =>
    openPlayerDetail(b.dataset.sldetail));
  box.querySelectorAll("[data-sltrade]").forEach((b) => b.onclick = () =>
    tradeForShortlisted(b.dataset.sltrade));
  // ----- squad planner controls -----
  const plClear = box.querySelector("#pl-clear");
  if (plClear) plClear.onclick = () => {
    if (confirm("Clear your whole squad planner?")) setPlanner([]);
  };
  box.querySelectorAll("[data-plplan],[data-pladd]").forEach((b) => b.onclick = () =>
    openPlannerPick(b.dataset.plplan || b.dataset.pladd));
  box.querySelectorAll("[data-plrmmove]").forEach((b) => b.onclick = () =>
    plannerRemoveMove(b.dataset.plrmmove));
  const split = (v) => { const i = v.indexOf("|"); return [v.slice(0, i), v.slice(i + 1)]; };
  box.querySelectorAll("[data-plrm]").forEach((b) => b.onclick = () =>
    plannerRemoveChoice(...split(b.dataset.plrm)));
  /* Repaint only that plan's choice list, not the whole trades page. */
  const redrawPlan = (outId) => () => {
    const el = document.getElementById("pl-choices-" + outId);
    const pk = pickById(outId), mv = moveFor(outId);
    if (!el || !pk || !mv) { renderTrades(); return; }
    el.outerHTML = plannerMoveHtml(pk, mv, tradingOpen());
    wireTrades(me);
  };
  const slidePlan = (outId, pid, dir) => {
    plannerMoveChoice(outId, pid, dir);
    animateReorder("pl-choices-" + outId, "data-plrow", redrawPlan(outId), pid);
  };
  box.querySelectorAll("[data-plup]").forEach((b) => b.onclick = () =>
    slidePlan(...split(b.dataset.plup), -1));
  box.querySelectorAll("[data-pldn]").forEach((b) => b.onclick = () =>
    slidePlan(...split(b.dataset.pldn), 1));
  plannerMoves().forEach((m) => {
    const el = box.querySelector("#pl-choices-" + CSS.escape(m.out));
    if (el) makeReorderable(el, "data-plrow", (order, moved) => {
      plannerSetChoiceOrder(m.out, order);
      animateReorder("pl-choices-" + m.out, "data-plrow", redrawPlan(m.out), moved);
    });
  });
  box.querySelectorAll("[data-plexec]").forEach((b) => b.onclick = () =>
    plannerExec(...split(b.dataset.plexec)));
  const newBtn = box.querySelector("#trade-new");
  if (newBtn) newBtn.onclick = () => openBuilder();
  // Step 1: who. Step 2: tap one of yours. Step 3: tap one of theirs — which
  // completes the pair and immediately offers a fresh one, so multi-player
  // deals build up without an "add pair" button to find.
  box.querySelectorAll("[data-partner]").forEach((b) => b.onclick = () => {
    if (b.dataset.partner !== "FA") S.faTarget = null;
    S.builder.target = b.dataset.partner;
    S.builder.pairs = b.dataset.partner === "FA" ? [] : [{ mine: "", theirs: "" }];
    renderTrades();
  });
  box.querySelectorAll("[data-faswap]").forEach((b) => b.onclick = () => {
    const out = S.picks.find((pk) => pk.id === b.dataset.faswap);
    if (!out) return;
    const want = S.faTarget;
    if (!want) return openSwap(out);          // no target yet: browse the pool
    const waiver = faDeferToClose();
    const msg = waiver
      ? `Queue a claim for ${want.name}, dropping ${out.player_name}? It resolves at window close, in waiver order.`
      : `Swap ${out.player_name} out for ${want.name}?`;
    if (!confirm(msg)) return;
    swapOrClaim(out, { player_id: want.player_id, name: want.name, team: want.team })
      .then(() => { S.faTarget = null; S.builder = null; renderTrades(); })
      .catch((e) => toast(e.message));
  });
  const clearFa = box.querySelector("[data-clearfa]");
  if (clearFa) clearFa.onclick = () => { S.faTarget = null; renderTrades(); };
  box.querySelectorAll("[data-pickmine]").forEach((b) => b.onclick = () => {
    const pair = S.builder.pairs.find((pr) => !pr.mine || !pr.theirs);
    if (pair) { pair.mine = b.dataset.pickmine; pair.theirs = ""; }
    renderTrades();
  });
  box.querySelectorAll("[data-picktheirs]").forEach((b) => b.onclick = () => {
    const pair = S.builder.pairs.find((pr) => pr.mine && !pr.theirs);
    if (pair) pair.theirs = b.dataset.picktheirs;
    S.builder.pairs.push({ mine: "", theirs: "" });   // ready for the next one
    renderTrades();
  });
  const clearMine = box.querySelector("[data-clearmine]");
  if (clearMine) clearMine.onclick = () => {
    const pair = S.builder.pairs.find((pr) => pr.mine && !pr.theirs);
    if (pair) pair.mine = "";
    renderTrades();
  };
  box.querySelectorAll("[data-rmpair]").forEach((b) => b.onclick = () => {
    S.builder.pairs.splice(+b.dataset.rmpair, 1);
    if (!S.builder.pairs.length) S.builder.pairs.push({ mine: "", theirs: "" });
    renderTrades();
  });
  const discard = box.querySelector("#trade-discard");
  if (discard) discard.onclick = () => { S.builder = null; S.faTarget = null; renderTrades(); };
  const submit = box.querySelector("#trade-submit");
  if (submit) submit.onclick = () => submitTrade(me).catch((e) => toast(e.message));
  box.querySelectorAll("[data-acc]").forEach((b) => b.onclick = () =>
    acceptTrade(byId(b.dataset.acc)).catch((e) => toast(e.message)));
  box.querySelectorAll("[data-rej]").forEach((b) => b.onclick = () =>
    setTradeStatus(byId(b.dataset.rej), "rejected").catch((e) => toast(e.message)));
  box.querySelectorAll("[data-can]").forEach((b) => b.onclick = () =>
    setTradeStatus(byId(b.dataset.can), "cancelled").catch((e) => toast(e.message)));
  box.querySelectorAll("[data-cnt]").forEach((b) => b.onclick = () => {
    const t = byId(b.dataset.cnt);
    openBuilder(t.proposer_manager_id, t.id);
  });
}

async function submitTrade(me) {
  const b = S.builder;
  if (!b.target) return toast("Choose a manager to trade with.");
  if (b.target === "FA") return; // FA swaps execute per-player, no proposal
  // New proposals need the window open; counters are responses and are
  // allowed even after it closes (so negotiations don't get stuck).
  if (!tradingOpen() && !b.parent) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  /* The builder always keeps a blank pair on the end so the next swap can be
     built without hunting for an "add" button. That trailing blank was being
     validated along with the real ones, so a perfectly good one-for-one deal
     was rejected with "every pair needs a player on both sides". Only complete
     pairs are a proposal. */
  const pairs = b.pairs
    .filter((p) => p.mine && p.theirs)
    .map((p) => ({ mine: pickById(p.mine), theirs: pickById(p.theirs) }));
  const err = tradeError(pairs);
  if (err) return toast(err);
  const { data, error } = await S.sb.from("trades").insert({
    league_id: S.league.id, proposer_manager_id: me.id, target_manager_id: b.target,
    parent_trade_id: b.parent, status: "proposed",
  }).select().single();
  if (error) return toast(error.message);
  // Snapshot both players' names now so trade history stays faithful even
  // after these picks are later traded again, swapped, or wiped.
  try {
    await resilientWrite("trade_items", pairs.map((p) => ({
      trade_id: data.id, offered_pick_id: p.mine.id, requested_pick_id: p.theirs.id,
      offered_player_name: p.mine.player_name,
      requested_player_name: p.theirs.player_name,
      offered_player_id: p.mine.player_id,
      requested_player_id: p.theirs.player_id,
    })));
  } catch (e) { return toast(e.message); }
  if (b.parent) {
    await S.sb.from("trades")
      .update({ status: "countered", updated_at: new Date().toISOString() })
      .eq("id", b.parent).eq("status", "proposed");
  }
  toast(b.parent ? "Counter-offer sent — they'll see it in their Deals tab."
                 : "Offer sent — it's now waiting on them.");
  S.builder = null;
  renderTrades();          // don't wait on the refetch to show it went
  scheduleRefetch();
}

async function acceptTrade(t) {
  if (!tradingOpen()) return toast(autoWindowsEnabled() ? tradeWindowMessage() : "Trading window is closed.");
  const pairs = (t.trade_items || []).map((it) => ({
    mine: pickById(it.offered_pick_id), theirs: pickById(it.requested_pick_id),
  }));
  const err = tradeError(pairs);
  if (err) return toast("Trade is no longer valid: " + err);
  if (!confirm("Accept this trade? Players swap immediately.")) return;
  // Before the swap, not after: pinning afterwards would record the new squads
  // as history and protect nothing.
  for (const mid of new Set([t.proposer_manager_id, t.target_manager_id].filter(Boolean)))
    await pinHistory(mid).catch(() => {});
  const { error } = await S.sb.rpc("accept_trade", { p_trade_id: t.id });
  if (error) {
    // accept_trade raises a clear sentence (stale player / already closed);
    // re-sync so the roster and proposal reflect what actually happened.
    scheduleRefetch();
    return toast(error.message);
  }
  toast("Trade accepted — players swapped!");
  // Both squads changed, so both need re-stamping for the coming lock.
  await refetchAll().catch(() => {});
  for (const mid of new Set([t.proposer_manager_id, t.target_manager_id].filter(Boolean)))
    await snapshotForNextLock(mid).catch(() => {});
  scheduleRefetch();
}

async function setTradeStatus(t, status) {
  const { error } = await S.sb.from("trades")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", t.id).eq("status", "proposed");
  if (error) return toast(error.message);
  scheduleRefetch();
}

/* ---------- admin stats entry ---------- */

function admLabel() {
  const custom = $("adm-label").value.trim();
  if (custom) return custom;
  const home = $("adm-home").value, away = $("adm-away").value, date = $("adm-date").value;
  return home && away && date ? `${home} vs ${away} (${date})` : "";
}

function draftedIds() {
  return new Set(S.picks.filter((p) => !p.player_id.startsWith("team:"))
    .map((p) => p.player_id));
}

function admRenderPlayerSearch() {
  const q = $("adm-psearch").value.trim().toLowerCase();
  const box = $("adm-presults");
  if (q.length < 2) { box.innerHTML = ""; return; }
  let pool = S.players;
  if ($("adm-drafted").checked) {
    const ids = draftedIds();
    pool = pool.filter((p) => ids.has(p.player_id));
  }
  const hits = pool.filter((p) => p.name.toLowerCase().includes(q)
    || p.team.toLowerCase().includes(q)).slice(0, 10);
  box.innerHTML = hits.map((p) =>
    `<button data-pid="${esc(p.player_id)}" class="w-full text-left rounded-lg bg-slate-800 px-3 py-1.5 hover:bg-slate-700">
      ${esc(p.name)} <span class="text-xs text-slate-400">· ${esc(p.team)} · ${p.position}</span></button>`).join("");
  box.querySelectorAll("[data-pid]").forEach((b) => b.onclick = () => {
    S.admPlayer = S.players.find((p) => p.player_id === b.dataset.pid);
    box.innerHTML = "";
    $("adm-psearch").value = "";
    admRenderSelected();
  });
}

function admRenderSelected() {
  $("adm-selplayer").textContent = S.admPlayer
    ? `Selected: ${S.admPlayer.name} (${S.admPlayer.position}, ${S.admPlayer.team})`
    : "No player selected.";
}

async function admSave() {
  const label = admLabel();
  if (!S.admPlayer) return toast("Select a player first.");
  if (!label) return toast("Set the match (teams + date) or a custom label.");
  const num = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
  const row = {
    league_id: S.league.id,
    player_id: S.admPlayer.player_id,
    match_label: label,
    appeared: $("adm-appeared").checked,
    goals: num("adm-goals"), assists: num("adm-assists"),
    clean_sheet: $("adm-cs").checked,
    yellow_cards: num("adm-yc"), red_cards: num("adm-rc"),
    saves: num("adm-saves"), motm: $("adm-motm").checked,
    penalty_saved: num("adm-ps"), penalty_missed: num("adm-pm"),
    defensive_actions: num("adm-da"),
  };
  const { error } = await S.sb.from("match_stats")
    .upsert(row, { onConflict: "league_id,player_id,match_label" });
  if (error) return toast("Save failed: " + error.message);
  toast(`Saved: ${S.admPlayer.name} — ${label}`);
  S.admPlayer = null;
  admRenderSelected();
  ["adm-goals","adm-assists","adm-saves","adm-yc","adm-rc","adm-ps","adm-pm","adm-da"]
    .forEach((id) => $(id).value = 0);
  $("adm-cs").checked = false; $("adm-motm").checked = false; $("adm-appeared").checked = true;
  scheduleRefetch();
}

function admLoadRow(r) {
  const m = String(r.match_label).match(/^(.+) vs (.+) \((\d{4}-\d{2}-\d{2})\)$/);
  if (m) {
    $("adm-home").value = m[1]; $("adm-away").value = m[2]; $("adm-date").value = m[3];
    $("adm-label").value = "";
  } else {
    $("adm-label").value = r.match_label;
  }
  S.admPlayer = S.playerById[r.player_id]
    || { player_id: r.player_id, name: r.player_id, position: "?", team: "?" };
  admRenderSelected();
  $("adm-goals").value = r.goals; $("adm-assists").value = r.assists;
  $("adm-saves").value = r.saves; $("adm-yc").value = r.yellow_cards;
  $("adm-rc").value = r.red_cards; $("adm-ps").value = r.penalty_saved;
  $("adm-pm").value = r.penalty_missed;
  $("adm-da").value = r.defensive_actions || 0;
  $("adm-cs").checked = r.clean_sheet; $("adm-motm").checked = r.motm;
  $("adm-appeared").checked = r.appeared;
  $("adm-label-preview").textContent = admLabel();
  window.scrollTo(0, 0);
}

async function admDelete(r) {
  if (!confirm(`Delete stats for ${S.playerById[r.player_id]?.name || r.player_id} — ${r.match_label}?`)) return;
  const { error } = await S.sb.from("match_stats").delete().eq("id", r.id);
  if (error) return toast(error.message);
  scheduleRefetch();
}

function admRenderExisting() {
  const groups = {};
  for (const r of S.stats) (groups[r.match_label] ||= []).push(r);
  const labels = Object.keys(groups).sort((a, b) =>
    String(labelDate(b)).localeCompare(String(labelDate(a))) || a.localeCompare(b));
  // Each match is a collapsible section (long history stays scannable). Open
  // state is remembered across refetches; the most recent match opens first run.
  if (S.admOpenLabels === null)
    S.admOpenLabels = new Set(labels.slice(0, 1));
  $("adm-existing").innerHTML = labels.map((label) => `
    <details data-lbl="${esc(label)}" class="rounded-lg border border-slate-800 bg-slate-900/40" ${
      S.admOpenLabels.has(label) ? "open" : ""}>
      <summary class="cursor-pointer select-none px-2 py-1.5 text-xs text-slate-300 flex items-center gap-2">
        <span class="truncate flex-1">${esc(label)}</span>
        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400 shrink-0">${groups[label].length}</span>
      </summary>
      <div class="px-2 pb-2 pt-1">
      ${groups[label].map((r) => {
        const p = S.playerById[r.player_id];
        const bits = [];
        if (!r.appeared) bits.push("DNP");
        if (r.goals) bits.push(r.goals + "g");
        if (r.assists) bits.push(r.assists + "a");
        if (r.clean_sheet) bits.push("CS");
        if (r.saves) bits.push(r.saves + "sv");
        if (r.yellow_cards) bits.push(r.yellow_cards + "Y");
        if (r.red_cards) bits.push("R");
        if (r.defensive_actions) bits.push(r.defensive_actions + "da");
        if (r.motm) bits.push("MOTM");
        if (r.penalty_saved) bits.push(r.penalty_saved + "PS");
        if (r.penalty_missed) bits.push(r.penalty_missed + "PM");
        return `<div class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2 py-1.5 mb-1">
          <span class="truncate flex-1">${esc(p?.name || r.player_id)}</span>
          <span class="text-xs text-slate-400">${bits.join(" ") || "0"}</span>
          <button data-edit="${r.id}" class="text-xs underline text-wcgold">edit</button>
          <button data-del="${r.id}" class="text-xs underline text-red-400">del</button>
        </div>`;
      }).join("")}
      </div>
    </details>`).join("") || '<p class="text-slate-400">No stats rows yet.</p>';
  $("adm-existing").querySelectorAll("details[data-lbl]").forEach((d) =>
    d.ontoggle = () => {
      if (d.open) S.admOpenLabels.add(d.dataset.lbl);
      else S.admOpenLabels.delete(d.dataset.lbl);
    });
  $("adm-existing").querySelectorAll("[data-edit]").forEach((b) =>
    b.onclick = () => admLoadRow(S.stats.find((r) => r.id === b.dataset.edit)));
  $("adm-existing").querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = () => admDelete(S.stats.find((r) => r.id === b.dataset.del)));
}

function admRenderStages() {
  const q = $("adm-tsearch").value.trim().toLowerCase();
  const cur = Object.fromEntries(S.stages.map((s) => [s.team, s.stage]));
  const teams = S.teams.filter((t) => !q || t.toLowerCase().includes(q));
  $("adm-stages").innerHTML = teams.map((t) => {
    const stage = cur[t] || "group";
    return `<div class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2 py-1.5 text-sm ${
      isEliminated(t) ? "opacity-60" : ""}">
      <span class="truncate flex-1">${esc(t)}</span>
      <label class="flex items-center gap-1 text-xs text-slate-400 shrink-0" title="knocked out">
        <input type="checkbox" data-koteam="${esc(t)}" ${isEliminated(t) ? "checked" : ""}> out</label>
      <span class="text-xs text-slate-400 font-mono">+${calcTeamPoints(stage)}</span>
      <select data-team="${esc(t)}" class="stage-sel rounded bg-slate-900 border border-slate-700 px-1.5 py-1 text-xs">
        ${stageOrder().map((s) =>
          `<option value="${s}" ${stage === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>`;
  }).join("");
  $("adm-stages").querySelectorAll(".stage-sel").forEach((sel) =>
    sel.onchange = () => setTeamStage(sel.dataset.team, sel.value)
      .catch((e) => toast(e.message)));
  $("adm-stages").querySelectorAll("[data-koteam]").forEach((cb) =>
    cb.onchange = () => setTeamEliminated(cb.dataset.koteam, cb.checked)
      .catch((e) => toast(e.message)));
}

async function setTeamStage(team, stage) {
  const { error } = await S.sb.from("team_stages")
    .upsert({ league_id: S.league.id, team, stage }, { onConflict: "league_id,team" });
  if (error) return toast("Save failed: " + error.message);
  toast(`${team} → ${stage} (+${calcTeamPoints(stage)} pts)`);
  scheduleRefetch();
}

async function setTeamEliminated(team, eliminated) {
  const { error } = await S.sb.from("team_stages").upsert(
    { league_id: S.league.id, team, stage: stageOf(team), eliminated },
    { onConflict: "league_id,team" });
  if (error) return toast(/eliminated/.test(error.message)
    ? "Knocked-out flag needs a schema update — run schema.sql." : "Save failed: " + error.message);
  toast(`${team} ${eliminated ? "marked knocked out" : "back in"}.`);
  scheduleRefetch();
}

/* ---------- admin: on-demand stats pull (mirrors daily_pull.py) ---------- */

const foldName = (s) => String(s || "").normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

/* API-Football access. Prefer the server-side proxy (a Supabase Edge Function
   holding the key as a secret) so organisers never need their own key; fall
   back to a user-pasted key when the function isn't deployed on this project.
   _apiProxy: null = untried · true = available · false = not deployed. */
let _apiProxy = null;
const apiProxyUrl = () => {
  const u = getConfig()?.url;
  return u ? `${u}/functions/v1/api-football` : null;
};
const apiKeyOptional = () => _apiProxy === true;

// Unwrap an API-Football payload: throws on its `errors`, else returns response.
function apiFootballBody(data) {
  const errs = data?.errors &&
    (Array.isArray(data.errors) ? data.errors : Object.values(data.errors));
  if (errs && errs.length) throw new Error(errs.join("; "));
  return data?.response || [];
}

async function apiFootball(key, path, params) {
  if (_apiProxy !== false) {
    const base = apiProxyUrl(), cfg = getConfig();
    if (base) {
      const q = new URL(base);
      q.searchParams.set("path", path);
      for (const k in params) q.searchParams.set(k, params[k]);
      try {
        const resp = await fetch(q, {
          headers: { Authorization: "Bearer " + cfg.key, apikey: cfg.key },
          cache: "no-store",
        });
        if (resp.status === 404) {
          _apiProxy = false;             // function not deployed → use a pasted key
        } else {
          const data = await resp.json();
          _apiProxy = true;              // proxy is live; its errors are real errors
          return apiFootballBody(data);
        }
      } catch (e) {
        if (_apiProxy === true) throw e;  // genuine API/network error, not a missing proxy
        _apiProxy = false;
      }
    }
  }
  if (!key) throw new Error(
    "No API-Football key. Deploy the api-football function with a server key, or paste your own key.");
  const url = new URL("https://v3.football.api-sports.io/" + path);
  for (const k in params) url.searchParams.set(k, params[k]);
  // `no-store` stops the browser reusing a response (a pull during a live game
  // otherwise caches that fixture's in-play 49' snapshot). NB: send ONLY the
  // api key header — adding other request headers (Cache-Control/Pragma) makes
  // the browser send a CORS preflight API-Football rejects ("Failed to fetch"),
  // and do NOT add a cache-buster query param — API-Football validates params
  // and rejects unknown ones with "The <field> field does not exist.".
  const resp = await fetch(url, { headers: { "x-apisports-key": key }, cache: "no-store" });
  return apiFootballBody(await resp.json());
}

// API player -> players.json id. Match by NAME first (exact, then surname,
// trying both ends so Korean/Asian name order works too); the FIFA id's
// trailing number is the squad-list position, NOT a reliable jersey number,
// so shirt is only a tiebreaker/last resort. (daily_pull.py matches the same
// way; matching by shirt first mis-attributed stats to the wrong player.)
function mapApiPlayer(team, shirt, apiName) {
  const roster = S.players.filter((p) => p.team === team);
  if (!roster.length) return null;
  const target = foldName(apiName);
  let hits = roster.filter((p) => foldName(p.name) === target);   // exact name
  if (hits.length !== 1) {                                        // surname, both ends
    const t = target.split(" ").filter(Boolean);
    const ends = [t[0], t[t.length - 1]].filter(Boolean);
    hits = roster.filter((p) => {
      const pt = foldName(p.name).split(" ").filter(Boolean);
      return ends.includes(pt[0]) || ends.includes(pt[pt.length - 1]);
    });
  }
  if (hits.length === 1) return hits[0].player_id;
  // ambiguous or no name match: fall back to shirt, but only if it agrees
  // with (or narrows) the name hits — never override a clear name match.
  if (shirt) {
    const pid = roster[0].team_code.toLowerCase() + "_" + shirt;
    if (S.playerById[pid] && (hits.length === 0 || hits.some((h) => h.player_id === pid)))
      return pid;
  }
  return null;
}

// Tie this league to an API-Football competition. If that competition's pool is
// already loaded (by any other league), REUSE it — no API calls. Otherwise pull
// teams → squads → fixtures once into the SHARED competition_pools so every
// league on the competition reads the same data.
/* Which drafted picks a refreshed squad list says have changed club.

   Pure, so the rules are pinned rather than inferred:
     • only players still IN the pool are considered — one who has left the
       competition keeps the club he last played for rather than being blanked;
     • TEAM picks are not players and are skipped;
     • a changed POSITION is reported but never applied. Position is what the
       squad quota was built on and what every past round was scored with, so
       silently reclassifying a defender as a midfielder could leave a manager
       unable to field a legal XI and would re-score history. That is an
       admin's call, not a side effect of a data refresh.                    */
function pickReconciliation(picks, players) {
  const byId = new Map((players || []).map((p) => [p.player_id, p]));
  const moves = [], repositioned = [];
  for (const pk of (picks || [])) {
    if (pk.slot === "TEAM") continue;
    const p = byId.get(pk.player_id);
    if (!p) continue;
    if (p.team && p.team !== pk.team)
      moves.push({ id: pk.id, name: pk.player_name, from: pk.team, to: p.team });
    if (p.position && p.position !== pk.position)
      repositioned.push({ name: pk.player_name, from: pk.position, to: p.position });
  }
  return { moves, repositioned };
}

/* Follow the player: when someone transfers within the competition they stay
   in your squad and simply play for a different club now.

   This matters well beyond the badge on their card. `team` is what the auto-sub
   engine uses to ask "did this starter's club play in round N?", and what
   round-scoped stats map through — so a stale club silently promotes subs that
   should not come on and mis-files results. One write per moved player fixes
   all of it. Past rounds are untouched: lineup snapshots carry the club as at
   lock time, which is the club they actually played for that round. */
async function reconcilePicksToPool(players, log) {
  const { moves, repositioned } = pickReconciliation(S.picks, players);
  let done = 0;
  for (const m of moves) {
    const { error } = await S.sb.from("picks").update({ team: m.to }).eq("id", m.id);
    if (error) continue;
    const pk = S.picks.find((x) => x.id === m.id);
    if (pk) pk.team = m.to;                       // reflect locally at once
    done++;
  }
  if (log && (done || repositioned.length)) {
    const lines = [];
    if (done) lines.push(`${done} transfer${done === 1 ? "" : "s"}: `
      + moves.slice(0, 6).map((m) => `${m.name} ${m.from} → ${m.to}`).join(", ")
      + (moves.length > 6 ? `, +${moves.length - 6} more` : ""));
    if (repositioned.length) lines.push(`Position changed for ${repositioned.length} player`
      + `${repositioned.length === 1 ? "" : "s"} (not applied — squads and past rounds depend on it): `
      + repositioned.slice(0, 6).map((r) => `${r.name} ${r.from}→${r.to}`).join(", "));
    log(lines.join("\n"));
  }
  return { moved: done, moves, repositioned };
}

async function loadCompetition() {
  const apiKey = $("adm-api-key").value.trim();
  const apiLeagueId = +$("adm-comp-select").value;
  const season = +$("adm-comp-season").value;
  const comp = COMPETITIONS.find((c) => c.apiLeagueId === apiLeagueId);
  const name = comp?.name || ("League " + apiLeagueId);
  const compKey = `${apiLeagueId}-${season}`;
  const competition = { name, apiLeagueId, season };
  const log = (t) => { $("adm-comp-log").textContent = t; };
  if (!apiLeagueId || !season) return toast("Pick a competition and a season.");
  if ((S.stats?.length || 0) &&
      !confirm("This league already has scored games — changing competition can orphan them. Continue?")) return;
  const btn = $("adm-comp-load");
  // A refresh of the SAME competition reconciles transfers; switching to a
  // different one must not, or every pick would look like it had moved club.
  const sameComp = competitionKey() === compKey;
  btn.disabled = true;
  try {
    log("Checking shared competition data…");
    const existing = await S.sb.from("competition_pools").select("*")
      .eq("competition_key", compKey).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    let players, fixtures, roundOrder = [];
    if (existing.data?.players?.length &&
        confirm(`${name} ${season} is already loaded (${existing.data.players.length} players shared across leagues). Reuse it without re-pulling?  (Cancel = re-pull fresh squads from the API.)`)) {
      players = existing.data.players;
      fixtures = existing.data.fixtures || [];
      roundOrder = existing.data.round_order || [];
      log(`Reusing shared pool: ${players.length} players.`);
    } else {
      
      localStorage.setItem("wcf_apikey", apiKey);
      log("Fetching teams…");
      const built = await fetchCompetitionPool(apiKey, apiLeagueId, season,
        (d, t, tm) => log(`Loading squads ${d}/${t} — ${tm}`));
      players = built.players;
      if (!players.length) throw new Error("No players returned — check the season for this competition.");
      log(`${players.length} players across ${built.teams.length} teams. Fetching fixtures…`);
      fixtures = await fetchCompetitionFixtures(apiKey, apiLeagueId, season);
      roundOrder = await fetchCompetitionRounds(apiKey, apiLeagueId, season);
      const up = await S.sb.from("competition_pools").upsert(
        { competition_key: compKey, players, fixtures, round_order: roundOrder,
          updated_at: new Date().toISOString() });
      if (up.error) throw new Error(up.error.message);
    }
    const upd = await S.sb.from("leagues").update({ competition }).eq("id", S.league.id);
    if (upd.error) throw new Error(upd.error.message);
    // Reflect locally without a reload.
    S.league.competition = competition;
    S._compPool = { players, fixtures, round_order: roundOrder };
    S.roundOrder = roundOrder;
    S.players = players;
    S.teams = [...new Set(players.map((p) => p.team))].sort();
    S.playerById = Object.fromEntries(players.map((p) => [p.player_id, p]));
    S.fixtures = fixtures;
    let note = "";
    if (sameComp && S.picks.length) {
      const rec = await reconcilePicksToPool(players, null);
      if (rec.moved) note = ` · ${rec.moved} squad player${rec.moved === 1 ? "" : "s"} moved club`;
      if (rec.repositioned.length) note += ` · ${rec.repositioned.length} position change${
        rec.repositioned.length === 1 ? "" : "s"} flagged (not applied)`;
      if (rec.moved || rec.repositioned.length) {
        // rec.moves is the list captured BEFORE the writes — recomputing here
        // would find nothing, because the picks now agree with the pool.
        const lines = [];
        if (rec.moved) {
          lines.push("Transfers applied — these players now play for their new club:");
          for (const m of rec.moves) lines.push(`  ${m.name}: ${m.from} → ${m.to}`);
        }
        if (rec.repositioned.length) {
          lines.push("Position changed upstream (left as drafted — change it by hand if you want it):");
          for (const r of rec.repositioned) lines.push(`  ${r.name}: ${r.from} → ${r.to}`);
        }
        log(lines.join("\n"));
      }
    }
    log(`✅ ${name} ${season}: ${players.length} players, ${fixtures.length} fixtures${note}.`);
    toast("Competition set.");
    renderAdmin(); renderBoard();
  } catch (e) {
    log("⚠️ " + e.message);
    toast(/competition_pools|column|schema cache|relation|competition/.test(e.message)
      ? "Pool storage needs a schema update — run schema.sql on the database." : e.message);
  } finally {
    btn.disabled = false;
  }
}

// App-admin: list every loaded competition with an on/off switch for the daily
// scheduled pull (stored on competition_pools.scheduled; the cron runner reads it).
async function renderScheduleManager() {
  const box = $("adm-schedules");
  if (!box || !S.sb) return;
  const { data, error } = await S.sb.from("competition_pools")
    .select("competition_key, scheduled, updated_at").order("competition_key");
  if (error) {
    box.innerHTML = `<p class="text-xs text-slate-400">${
      /scheduled|column|relation|competition_pools/.test(error.message)
        ? "Run schema.sql to enable scheduled pulls." : esc(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    box.innerHTML = `<p class="text-xs text-slate-400">No API competitions loaded yet — load one above first.</p>`;
    return;
  }
  box.innerHTML = data.map((r) => {
    const [lid, season] = r.competition_key.split("-");
    const name = COMPETITIONS.find((c) => c.apiLeagueId === +lid)?.name || ("League " + lid);
    const on = !!r.scheduled;
    return `<div class="flex items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-3 py-2">
      <span class="text-sm min-w-0 truncate"><span class="font-medium">${esc(name)}</span>
        <span class="text-slate-400">${esc(season)}</span></span>
      <button data-sched="${esc(r.competition_key)}" data-on="${on}" class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
        on ? "bg-wcgreen text-slate-900" : "bg-slate-700 text-slate-300"}">${on ? "Scheduled ✓" : "Off"}</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-sched]").forEach((b) => b.onclick = async () => {
    const next = b.dataset.on !== "true";
    const { error } = await S.sb.from("competition_pools")
      .update({ scheduled: next }).eq("competition_key", b.dataset.sched);
    if (error) return toast(error.message);
    toast(next ? "Daily pull scheduled." : "Scheduled pull off.");
    renderScheduleManager();
  });
}

// Build competition_stats / match_stats rows for one fixture from its
// fixtures/players API response. keyField scopes the rows (competition vs
// league); fixName normalizes team names; pidOf(team, shirt, name, apiId)
// resolves the player id (null → unmappable, pushed to `skipped`). Shared by
// the admin daily pull and the on-demand history pull.
function buildFixtureStatRows(f, teamBlocks, keyField, fixName, pidOf, skipped) {
  const home = fixName(f.teams.home.name), away = fixName(f.teams.away.name);
  const label = `${home} vs ${away} (${f.fixture.date.slice(0, 10)})`;
  const conceded = { [f.teams.home.id]: f.goals.away || 0, [f.teams.away.id]: f.goals.home || 0 };
  const rows = [];
  let best = null;
  for (const tb of teamBlocks) {
    const team = fixName(tb.team.name);
    for (const e of tb.players) {
      const st = (e.statistics || [])[0] || {};
      const games = st.games || {};
      const minutes = +games.minutes || 0;
      const g = st.goals || {}, cards = st.cards || {}, pen = st.penalty || {}, tk = st.tackles || {};
      const def = (+tk.total || 0) + (+tk.blocks || 0) + (+tk.interceptions || 0);
      const passes = st.passes || {}, shots = st.shots || {}, dribbles = st.dribbles || {},
            duels = st.duels || {}, fouls = st.fouls || {};
      // Keep anyone with any contribution even if the API leaves minutes blank,
      // so a scorer is never dropped; skip true non-participants.
      const contributed = (+g.total || 0) || (+g.assists || 0) || (+g.saves || 0)
        || (+cards.yellow || 0) || (+cards.red || 0)
        || (+pen.saved || 0) || (+pen.missed || 0) || def;
      if (!minutes && !contributed) continue;
      const pid = pidOf(team, +games.number || 0, e.player.name, e.player.id);
      if (!pid) { skipped && skipped.push(`${e.player.name} (${team})`); continue; }
      const row = {
        ...keyField, player_id: pid, match_label: label, appeared: true,
        // The club they played for in THIS match, so a later transfer can't
        // strand the row (rounds are resolved per club).
        team,
        /* The matchweek this row belongs to, stamped now while the API fixture
           is in hand. Cups get null -- their round labels are names, not
           numbers -- and readers fall back to inference (ROUNDS_DESIGN.md). */
        round: Number(mwNo(f.league?.round)) || null,
        /* ...and the round's own label, which every competition has. `round`
           above is that label parsed to an int, so it is null for the entire
           knockout stage -- the same gap Phase 1.5 closed for `rounds` and
           `lineup_snapshots`. Settled scoring keys on this. */
        round_key: f.league?.round != null ? String(f.league.round) : null,
        // ...and which match this was, by the API's own id rather than by a
        // label that has to be parsed back apart to be useful.
        fixture_id: f.fixture?.id ?? null,
        goals: +g.total || 0, assists: +g.assists || 0,
        clean_sheet: minutes >= 60 && !(conceded[tb.team.id] || 0),
        yellow_cards: +cards.yellow || 0, red_cards: +cards.red || 0,
        saves: +g.saves || 0, motm: false,
        penalty_saved: +pen.saved || 0, penalty_missed: +pen.missed || 0,
        defensive_actions: def,
        home_score: +f.goals.home || 0, away_score: +f.goals.away || 0,
        minutes,
        raw: {
          "goals.total": +g.total || 0, "goals.assists": +g.assists || 0,
          "goals.saves": +g.saves || 0, "goals.conceded": +g.conceded || 0,
          "clean_sheet": minutes >= 60 && !(conceded[tb.team.id] || 0) ? 1 : 0,
          "cards.yellow": +cards.yellow || 0, "cards.red": +cards.red || 0,
          "penalty.saved": +pen.saved || 0, "penalty.missed": +pen.missed || 0,
          "defensive_actions": def, "minutes": minutes, "motm": 0,
          "passes.total": +passes.total || 0, "passes.key": +passes.key || 0,
          "passes.accuracy": parseInt(passes.accuracy) || 0,
          "shots.total": +shots.total || 0, "shots.on": +shots.on || 0,
          "dribbles.success": +dribbles.success || 0, "duels.won": +duels.won || 0,
          "fouls.drawn": +fouls.drawn || 0, "fouls.committed": +fouls.committed || 0,
          "offsides": +st.offsides || 0, "rating": parseFloat(games.rating) || 0,
        },
      };
      const rating = parseFloat(games.rating);
      if (!isNaN(rating) && (!best || rating > best.rating)) best = { row, rating };
      rows.push(row);
    }
  }
  if (best && best.rating >= 7.5) { best.row.motm = true; best.row.raw.motm = 1; }   // MOTM
  const maxMin = rows.reduce((mx, r) => Math.max(mx, r.minutes || 0), 0);
  const cs = rows.filter((r) => r.clean_sheet).length;
  return { rows, label, maxMin, cs };
}

async function pullStatsNow() {
  const key = $("adm-api-key").value.trim();
  const date = $("adm-pull-date").value;
  const log = (t) => $("adm-pull-log").textContent = t;
  // No key needed when the server proxy holds one; apiFootball reports if neither works.
  if (!date) return toast("Pick a date.");
  localStorage.setItem("wcf_apikey", key);
  const btn = $("adm-pull-now");
  btn.disabled = true;
  try {
    // Also sweep the previous UTC day: the API filters `date` by UTC, so an
    // evening game (e.g. 20:00Z) is on that UTC date — but a pull the "next
    // day" (the date box defaults to today) would miss it. Fetching both days
    // and deduping by fixture id means a game is caught whichever day you pull.
    const prev = new Date(date + "T00:00:00Z");
    prev.setUTCDate(prev.getUTCDate() - 1);
    const prevDate = prev.toISOString().slice(0, 10);
    log(`Fetching fixtures for ${prevDate} & ${date}…`);
    const done = ["FT", "AET", "PEN"];
    const notStarted = ["NS", "TBD", "PST", "CANC", "SUSP"];
    const seen = new Set();
    // Which competition's fixtures to pull — the league's, or the WC-2026 default.
    const comp = leagueCompetition() || { apiLeagueId: 1, season: 2026 };
    // Where the stats land: the SHARED competition_stats (so every league on this
    // competition sees them from one pull), or the legacy per-league match_stats.
    const compKey = competitionKey();
    const statsTable = compKey ? "competition_stats" : "match_stats";
    const keyField = compKey ? { competition_key: compKey } : { league_id: S.league.id };
    const onConflict = (compKey ? "competition_key" : "league_id") + ",player_id,match_label";
    const all = [
      ...await apiFootball(key, "fixtures", { date, league: comp.apiLeagueId, season: comp.season }),
      ...await apiFootball(key, "fixtures", { date: prevDate, league: comp.apiLeagueId, season: comp.season }),
    ].filter((f) => !seen.has(f.fixture.id) && seen.add(f.fixture.id));
    const fixtures = all.filter((f) => done.includes(f.fixture.status.short));
    // Games still being played are excluded (their stats aren't final) — call
    // them out so a "nothing changed" pull is never a mystery.
    const inPlay = all.filter((f) =>
      !done.includes(f.fixture.status.short) && !notStarted.includes(f.fixture.status.short));
    const inPlayNote = inPlay.length
      ? `\n⏱ Still in progress (skipped until full-time): ${inPlay.map((f) =>
          `${f.teams.home.name} v ${f.teams.away.name} [${f.fixture.status.short}]`).join(", ")}`
      : "";
    if (!fixtures.length) {
      log(`No completed fixtures on ${prevDate} or ${date} yet — in-progress games are excluded.` + inPlayNote);
      return;
    }
    const skipped = [];
    const summary = [];
    let total = 0;
    // FIFA-name normalization only applies to the legacy WC pool; an API
    // competition's stored fixtures/pool already use the API's own team names.
    const fixName = leagueCompetition() ? (n) => n : (n) => TEAM_NAME_FIX[n] || n;
    /* API-loaded pools carry the API id, so the id IS the identity — no lookup
       needed, and none wanted. Requiring pool membership silently discarded
       every player the squad list didn't know about: a January signing scoring
       a hat-trick produced no rows at all, because the fallback name-matcher
       searches the stored pool and finds nobody. Their stats now land from
       their debut, and they become draftable when the squad refresh catches up.
       Only the legacy World Cup pool needs name/shirt matching. */
    const pidOf = leagueCompetition()
      ? (team, num, name, apiId) => "api_" + apiId
      : (team, num, name, apiId) =>
          S.playerById["api_" + apiId] ? "api_" + apiId : mapApiPlayer(team, num, name);
    for (const f of fixtures) {
      log(`Pulling ${fixName(f.teams.home.name)} vs ${fixName(f.teams.away.name)}…`);
      const teamBlocks = await apiFootball(key, "fixtures/players", { fixture: f.fixture.id });
      // Diagnostic (maxMin/cs): a stuck-at-49 game is then obviously an upstream
      // (API) issue, not the write.
      const { rows, label, maxMin, cs } = buildFixtureStatRows(f, teamBlocks, keyField, fixName, pidOf, skipped);
      await resilientWrite(statsTable, rows, { upsert: true, onConflict });
      total += rows.length;
      summary.push(`${label}: ${rows.length} rows · API max ${maxMin}′ · ${cs} clean sheets`);
    }
    log(`Done — ${total} player rows from ${fixtures.length} match(es).`
      + "\n" + summary.join("\n")
      + (skipped.length
        ? `\nCould not map (enter manually): ${[...new Set(skipped)].join(", ")}`
        : "")
      + inPlayNote);
    scheduleRefetch();
  } catch (e) {
    log("Pull failed: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- admin: redrafts, eliminations & final phase ---------- */

function admQuotaInputs(prefix) {
  const v = (g) => Math.max(0, parseInt($(prefix + g.toLowerCase()).value, 10) || 0);
  return { GK: v("GK"), DEF: v("DEF"), MID: v("MID"), FWD: v("FWD") };
}

// Live "= N-player squad" hint under the redraft quota inputs.
function admQuotaSizePreview() {
  const el = $("adm-q-size");
  if (!el) return;
  const q = admQuotaInputs("adm-q-");
  const flex = Math.max(0, parseInt($("adm-q-flex").value, 10) || 0);
  el.textContent = `= ${q.GK + q.DEF + q.MID + q.FWD + flex}-player squad`;
}

// A manager's chosen keepers, in selection order, validated: each must
// still exist, be theirs, and not be the TEAM pick (which carries
// through automatically). Count/cap/quota limits are enforced elsewhere.
function keepersOf(m) {
  return (m.keeper_pick_ids || [])
    .map((id) => pickById(id))
    .filter((pk) => pk && pk.manager_id === m.id && pk.slot !== "TEAM");
}

async function removeManager(m) {
  const total = computeScores().find((s) => s.manager.id === m.id)?.total || 0;
  // The TEAM pick is kept and keeps scoring, so freeze only the non-TEAM
  // points; managerTeamBonus() is added back live on top of frozen_points.
  const tb = managerTeamBonus(m.id);
  const frozen = total - (tb ? tb.pts : 0);
  if (!confirm(`Remove ${m.name}? Their players go back to the pool, but they KEEP their TEAM pick`
      + `${tb ? ` (${tb.pick.team})` : ""} and it keeps scoring as that team advances. `
      + `Player points freeze at ${frozen}. This can't be undone.`))
    return;
  const { error } = await S.sb.from("managers")
    .update({ eliminated: true, frozen_points: frozen,
              eliminated_at: new Date().toISOString() }).eq("id", m.id);
  if (error) return toast(error.message);
  // Delete their players; the TEAM pick stays so it keeps earning stage points.
  const { error: e2 } = await S.sb.from("picks")
    .delete().eq("league_id", S.league.id).eq("manager_id", m.id).neq("slot", "TEAM");
  if (e2) return toast(e2.message);
  toast(`${m.name} removed — frozen at ${frozen} pts + their TEAM pick keeps scoring.`);
  scheduleRefetch();
}

// Opening the keeper window also locks in this redraft's keeper rules
// (max keepers + optional per-position caps) so managers select against
// known limits.
async function toggleKeeperWindow() {
  const next = !S.league.keeper_window;
  const payload = { keeper_window: next };
  if (next) {
    payload.keeper_max = Math.max(0, parseInt($("adm-k-max").value, 10) || 0);
    const caps = {};
    for (const g of ["GK", "DEF", "MID", "FWD"]) {
      const v = $("adm-k-" + g.toLowerCase()).value.trim();
      if (v !== "") caps[g] = Math.max(0, parseInt(v, 10) || 0);
    }
    payload.keeper_caps = Object.keys(caps).length ? caps : null;
  }
  const { error } = await S.sb.from("leagues")
    .update(payload).eq("id", S.league.id);
  if (error) return toast(error.message);
  toast(next ? `Keeper picks open — up to ${payload.keeper_max} each, chosen on the Home tab.`
             : "Keeper picks closed.");
  scheduleRefetch();
}

async function startRedraft() {
  const quota = admQuotaInputs("adm-q-"), starters = admQuotaInputs("adm-s-");
  const flex = Math.max(0, parseInt($("adm-q-flex").value, 10) || 0);
  const size = quota.GK + quota.DEF + quota.MID + quota.FWD + flex;
  if (!size) return toast("Set the squad size first.");
  // Starter minimums can't exceed the position minimum; the flex sits on top
  // of both the squad and the starting XI, so the starter total gets it too.
  for (const g of ["GK", "DEF", "MID", "FWD"]) {
    if (starters[g] > quota[g])
      return toast(`${g}: starter minimum (${starters[g]}) can't exceed the squad minimum (${quota[g]}).`);
  }
  const starterTotal = starters.GK + starters.DEF + starters.MID + starters.FWD + flex;
  if (starterTotal > size)
    return toast(`Starters (${starterTotal}) can't exceed the squad size (${size}).`);
  const active = activeManagers();
  // Kept players fill quota slots, so the pool only needs to cover the
  // full quota: quota*managers <= players at that position.
  for (const g of ["GK", "DEF", "MID", "FWD"]) {
    const pool = S.players.filter((p) => p.position === g).length;
    if (quota[g] * active.length > pool)
      return toast(`Not enough ${g}s in the pool: need ${quota[g] * active.length}, have ${pool}.`);
  }
  // Validate every manager's keepers in selection order against the
  // admin's max, the per-position caps, and the actual new quota (e.g. a
  // kept MID is dropped if MID is capped to 0 this round). Excess
  // selections are dropped, not blockers — the confirm lists them.
  const maxK = S.league.keeper_max ?? 1;
  const caps = S.league.keeper_caps || null;
  const keepersByMgr = {};
  const droppedNotes = [];
  for (const m of active) {
    const valid = [];
    const perPos = {};
    for (const pk of keepersOf(m)) {
      const g = pk.position;
      const limit = Math.min(caps?.[g] ?? Infinity, quota[g] || 0);
      if (valid.length >= maxK) {
        droppedNotes.push(`${m.name}: ${pk.player_name} (over the ${maxK}-keeper max)`);
      } else if ((perPos[g] || 0) >= limit) {
        droppedNotes.push(`${m.name}: ${pk.player_name} (${g} keeper limit is ${limit})`);
      } else {
        perPos[g] = (perPos[g] || 0) + 1;
        valid.push(pk);
        continue;
      }
    }
    keepersByMgr[m.id] = valid;
  }
  const noKeep = active.filter((m) => !keepersByMgr[m.id].length);
  const orderMode = $("adm-redraft-order").value === "random" ? "random" : "reverse";
  const orderText = orderMode === "random"
    ? "in a random snake order" : "last place picking first (reverse standings)";
  if (!confirm(`Start redraft for ${active.length} managers — squads of ${size} `
    + `(min ${quota.GK} GK, ${quota.DEF} DEF, ${quota.MID} MID, ${quota.FWD} FWD`
    + (flex ? ` + ${flex} flex outfield` : "") + "), "
    + "kept players included? Each keeper costs that manager's earliest draft round."
    + (droppedNotes.length ? `\n\nDROPPED keeper picks (won't be kept):\n${droppedNotes.join("\n")}` : "")
    + (noKeep.length ? `\n\nKeeping no one: ${noKeep.map((m) => m.name).join(", ")}` : "")
    + `\n\nEveryone else returns to the pool and the draft starts immediately, ${orderText}.`))
    return;
  // Bank the outgoing rosters, then reseed the draft order.
  await snapshotRosters();
  let order;
  if (orderMode === "random") {
    order = active.map((m) => ({ manager: m }));
    for (let i = order.length - 1; i > 0; i--) {   // Fisher–Yates shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  } else {
    order = computeScores().filter((s) => !s.eliminated)
      .sort((a, b) => a.total - b.total);
  }
  await Promise.all(order.map((s, i) => S.sb.from("managers")
    .update({ draft_position: i + 1 }).eq("id", s.manager.id)));
  // Keepers stay, slotted against the NEW starter quota (first keeper in
  // a position starts, extras bench); everything else is wiped.
  for (const m of active) {
    const keeps = keepersByMgr[m.id];
    const placed = [];
    for (const keep of keeps) {
      const have = placed.filter((x) => x === keep.position).length;
      const slot = have < (starters[keep.position] || 0)
        ? keep.position : "SUB_" + keep.position;
      placed.push(keep.position);
      const { error } = await S.sb.from("picks")
        .update({ kept: true, is_sub: slot.startsWith("SUB_"), slot })
        .eq("id", keep.id);
      if (error) return toast(error.message);
    }
    let del = S.sb.from("picks").delete()
      .eq("league_id", S.league.id).eq("manager_id", m.id).neq("slot", "TEAM");
    if (keeps.length)
      del = del.not("id", "in", `(${keeps.map((k) => k.id).join(",")})`);
    const { error: e2 } = await del;
    if (e2) return toast(e2.message);
  }
  // Selections are spent; a fresh window starts blank next time.
  await S.sb.from("managers").update({ keeper_pick_ids: null })
    .eq("league_id", S.league.id);
  // Open proposals reference deleted picks — clear them out.
  await S.sb.from("trades").update({ status: "cancelled" })
    .eq("league_id", S.league.id).eq("status", "proposed");
  const payload = {
    phase: (S.league.phase || 1) + 1,
    phase_quota: quota, phase_starters: starters, phase_flex: flex,
    keeper_window: false, trading_open: false,
    current_pick: 1, pick_started_at: new Date().toISOString(),
  };
  let { error } = await S.sb.from("leagues").update(payload).eq("id", S.league.id);
  if (error && /phase_flex/.test(error.message)) {
    // Column not migrated yet: fall back so the redraft still starts (no flex).
    if (flex) toast("Flex needs a schema update — run schema.sql. Starting without it.");
    delete payload.phase_flex;
    ({ error } = await S.sb.from("leagues").update(payload).eq("id", S.league.id));
  }
  if (error) return toast(error.message);
  toast("Redraft started!");
  await refetchAll();
}

async function startFinalPhase() {
  if (!confirm("Start the final phase? All squads dissolve (TEAM picks stay for stage bonuses) "
    + `and every surviving manager calls the champion for +${finalPickBonus()}. `
    + "Do this on a day with no matches. This can't be undone."))
    return;
  await snapshotRosters();              // bank everything up to the semis
  const { error } = await S.sb.from("picks").delete()
    .eq("league_id", S.league.id).neq("slot", "TEAM");
  if (error) return toast(error.message);
  await refetchAll();                   // refresh S.picks before the empty lock
  await snapshotRosters();              // TEAM-only lock: the final scores no squads
  const { error: e2 } = await S.sb.from("leagues")
    .update({ final_phase: true, trading_open: false, keeper_window: false })
    .eq("id", S.league.id);
  if (e2) return toast(e2.message);
  toast("Final phase — managers pick the champion on their Home tab.");
  scheduleRefetch();
}

// Shared "design your draft" field builders. `data-cfg` keys drive
// readConfigFromFields; `eff` is an effectiveConfig(...) so blanks never appear.
const cfgNum = (key, label, val, locked) =>
  `<label class="text-xs text-slate-400">${label}
    <input data-cfg="${key}" type="number" step="1" value="${val}"${locked ? " disabled" : ""}
      class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-sm${locked ? " opacity-60" : ""}"></label>`;
const cfgGrid = (cells, cols = 4) => `<div class="grid grid-cols-${cols} gap-2">${cells.join("")}</div>`;

// Stateful scoring-rules editor. Renders `rules` (mutated in place) into
// `container`: per rule a stat, a formula (flat / per-N / threshold), and a
// per-position toggle (one value, or GK/DEF/MID/FWD). Structural changes
// re-render; number edits update in place. `onChange` fires after any edit.
function renderRulesEditor(container, rules, opts = {}) {
  const { locked = false, onChange = () => {} } = opts;
  const dis = locked ? " disabled" : "";
  const inp = "rounded bg-slate-800 border border-slate-700 px-2 py-1 text-sm" + (locked ? " opacity-60" : "");
  const statOpts = (sel) => STAT_CATALOG.map((s) =>
    `<option value="${s.key}"${s.key === sel ? " selected" : ""}>${esc(s.label)}</option>`).join("");
  container.innerHTML = rules.map((rule, i) => {
    const pts = rule.perPosition
      ? `<div class="grid grid-cols-4 gap-1">${["GK", "DEF", "MID", "FWD"].map((g) =>
          `<label class="text-xs text-slate-400 text-center">${g}<input data-ri="${i}" data-rk="points.${g}" type="number" step="1" value="${rule.points?.[g] ?? 0}"${dis} class="mt-0.5 w-full ${inp}"></label>`).join("")}</div>`
      : `<label class="text-xs text-slate-400">Points <input data-ri="${i}" data-rk="points" type="number" step="1" value="${typeof rule.points === "number" ? rule.points : 0}"${dis} class="ml-1 w-20 ${inp}"></label>`;
    const extra = rule.mode === "per"
      ? `<label class="text-xs text-slate-400">per <input data-ri="${i}" data-rk="per" type="number" min="1" value="${rule.per ?? 1}"${dis} class="w-14 ${inp}"></label>`
      : rule.mode === "threshold"
      ? `<label class="text-xs text-slate-400">if ≥ <input data-ri="${i}" data-rk="gte" type="number" value="${rule.gte ?? 0}"${dis} class="w-16 ${inp}"></label>` : "";
    return `<div class="rounded-lg border border-slate-700 bg-slate-800/40 p-2 space-y-1.5">
      <div class="flex items-center gap-1.5">
        <select data-ri="${i}" data-rk="stat"${dis} class="flex-1 min-w-0 ${inp}">${statOpts(rule.stat)}</select>
        ${locked ? "" : `<button type="button" data-rdel="${i}" class="tap shrink-0 text-slate-400 hover:text-wcred" title="remove">✕</button>`}
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <select data-ri="${i}" data-rk="mode"${dis} class="${inp}">
          <option value="each"${rule.mode === "each" ? " selected" : ""}>flat / each</option>
          <option value="per"${rule.mode === "per" ? " selected" : ""}>per N</option>
          <option value="threshold"${rule.mode === "threshold" ? " selected" : ""}>if ≥ N</option>
        </select>
        ${extra}
        <label class="flex items-center gap-1 text-xs text-slate-400"><input type="checkbox" data-ri="${i}" data-rk="perPosition"${rule.perPosition ? " checked" : ""}${dis}> per position</label>
        <label class="flex items-center gap-1 text-xs text-slate-400" title="Only score if the player played at least this many minutes (e.g. 60 for a clean sheet)">min mins <input data-ri="${i}" data-rk="minMinutes" type="number" min="0" value="${rule.minMinutes ?? 0}"${dis} class="w-12 ${inp}"></label>
      </div>
      ${pts}
    </div>`;
  }).join("") + (locked ? "" :
    `<button type="button" data-radd="1" class="w-full rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-slate-200 py-1.5 text-xs">+ add stat</button>`);
  if (locked) return;
  const rerender = () => renderRulesEditor(container, rules, opts);
  // number edits: update in place (keep focus)
  for (const el of container.querySelectorAll('input[type="number"]'))
    el.oninput = () => {
      const r = rules[+el.dataset.ri], k = el.dataset.rk, v = Number(el.value);
      if (k.startsWith("points.")) { r.points = { ...(typeof r.points === "object" ? r.points : {}) }; r.points[k.slice(7)] = v; }
      else r[k] = v;
      onChange();
    };
  // structural edits: mutate + re-render
  for (const el of container.querySelectorAll("select, input[type=checkbox]"))
    el.onchange = () => {
      const r = rules[+el.dataset.ri], k = el.dataset.rk;
      if (k === "perPosition") {
        if (el.checked) { const n = typeof r.points === "number" ? r.points : 0; r.points = { GK: n, DEF: n, MID: n, FWD: n }; r.perPosition = true; }
        else { r.points = (r.points && (r.points.MID ?? r.points.DEF)) || 0; r.perPosition = false; }
      } else r[k] = el.value;
      rerender(); onChange();
    };
  for (const el of container.querySelectorAll("[data-rdel]"))
    el.onclick = () => { rules.splice(+el.dataset.rdel, 1); rerender(); onChange(); };
  const add = container.querySelector("[data-radd]");
  if (add) add.onclick = () => { rules.push({ stat: "goals.total", mode: "each", perPosition: false, points: 1 }); rerender(); onChange(); };
}

// Live "is this scoring balanced across positions?" panel. Renders per-position
// average ± sd (players with ≥5 games) and a collapsible top-20, from prior stat
// Ridgeline overlay of the points distribution per position: each position is a
// small frequency curve on a SHARED x-axis (points), stacked vertically so the
// positional bias is read by comparing where each curve sits. Vertical position
// + label carry identity (colour only reinforces — 4 overlapping series can't be
// told apart by colour alone), and each row's dashed line marks its average.
// Per-row height is normalised so shapes compare regardless of sample size.
function ridgelineSvg(players, perPos, opts) {
  opts = opts || {};
  const big = !!opts.big;
  const rowsAll = ["GK", "DEF", "MID", "FWD"].filter((p) => perPos[p].n > 0);
  if (!rowsAll.length) return "";
  const hist = pointsHistogram(players, big ? 30 : 14);   // finer bins when enlarged → sharper tails
  const COL = { GK: "#3987e5", DEF: "#d95926", MID: "#199e70", FWD: "#c98500" };  // validated dark categorical
  const W = big ? 660 : 320, L = big ? 46 : 34, R = big ? 16 : 8, TOP = big ? 10 : 4;
  const ROW = big ? 78 : 30, AX = big ? 24 : 15;
  const fMain = big ? 13 : 9, fTick = big ? 11 : 8, dot = big ? 4.5 : 3, sw = big ? 2 : 1.5;
  const H = TOP + rowsAll.length * ROW + AX;
  const x0 = L, x1 = W - R, span = (hist.max - hist.min) || 1;
  const xOf = (v) => x0 + (x1 - x0) * (v - hist.min) / span;
  const binC = (i) => hist.min + hist.binW * (i + 0.5);
  const plotBottom = TOP + rowsAll.length * ROW;
  // Per-position extremes (min & max actual totals) — what the enlarged view is for.
  const ext = {};
  for (const pos of rowsAll) { const v = players.filter((x) => x.pos === pos).map((x) => x.points); ext[pos] = { min: Math.min(...v), max: Math.max(...v) }; }
  const p = [];
  // Shared x gridlines + value ticks (min → max points). More ticks when big.
  const nTicks = big ? 6 : 2;
  for (let t = 0; t <= nTicks; t++) {
    const val = hist.min + (span) * t / nTicks, x = xOf(val).toFixed(1);
    p.push(`<line x1="${x}" y1="${TOP}" x2="${x}" y2="${plotBottom}" stroke="#334155" stroke-width="1" stroke-opacity="0.3"/>`);
    p.push(`<text x="${x}" y="${H - 4}" fill="#64748b" font-size="${fTick}" text-anchor="middle">${Math.round(val)}</text>`);
  }
  rowsAll.forEach((pos, r) => {
    const counts = hist.series[pos], maxC = Math.max(1, ...counts);
    const baseY = TOP + r * ROW + ROW - 3, amp = ROW - (big ? 18 : 8), col = COL[pos];
    const yOf = (c) => baseY - amp * c / maxC;
    let d = `M ${xOf(binC(0)).toFixed(1)} ${baseY.toFixed(1)}`;
    counts.forEach((c, i) => { d += ` L ${xOf(binC(i)).toFixed(1)} ${yOf(c).toFixed(1)}`; });
    d += ` L ${xOf(binC(counts.length - 1)).toFixed(1)} ${baseY.toFixed(1)} Z`;
    p.push(`<line x1="${x0}" y1="${baseY.toFixed(1)}" x2="${x1}" y2="${baseY.toFixed(1)}" stroke="#334155" stroke-width="1" stroke-opacity="0.4"/>`);
    p.push(`<path d="${d}" fill="${col}" fill-opacity="0.3" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"/>`);
    const mx = xOf(perPos[pos].mean).toFixed(1);   // average marker
    p.push(`<line x1="${mx}" y1="${(baseY - amp).toFixed(1)}" x2="${mx}" y2="${baseY.toFixed(1)}" stroke="${col}" stroke-width="1" stroke-dasharray="${big ? "3 2" : "2 2"}"/>`);
    const cy = (TOP + r * ROW + ROW / 2).toFixed(1);
    p.push(`<circle cx="${big ? 9 : 7}" cy="${cy}" r="${dot}" fill="${col}"/>`);
    p.push(`<text x="${big ? 17 : 13}" y="${(+cy + 3).toFixed(1)}" fill="#cbd5e1" font-size="${fMain}" font-weight="600">${pos}</text>`);
    // Enlarged: mark & label the low/high extremes so the tails are readable.
    if (big) {
      for (const [key, anchor] of [["min", "start"], ["max", "end"]]) {
        const val = ext[pos][key], x = xOf(val), off = key === "min" ? -3 : 3;
        p.push(`<circle cx="${x.toFixed(1)}" cy="${baseY.toFixed(1)}" r="2.5" fill="${col}"/>`);
        p.push(`<text x="${(x + off).toFixed(1)}" y="${(baseY - 5).toFixed(1)}" fill="#94a3b8" font-size="10" text-anchor="${anchor}">${Math.round(val)}</text>`);
      }
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:100%;height:auto" role="img" aria-label="Points distribution by position, shared scale">${p.join("")}</svg>`;
}

// rows scored under `rules`. meta[pid] = { name, team } for the leaderboard.
function renderScoringBalance(container, statRows, posOf, rules, meta) {
  if (!container) return;
  meta = meta || {};
  if (!statRows || !statRows.length) {
    container.innerHTML = '<span class="text-xs text-slate-400">No prior data loaded — pick an API competition that has been pulled to validate your scoring against real games.</span>';
    return;
  }
  const b = scoringBalance(statRows, posOf, rules, 5);
  if (!b.count) {
    container.innerHTML = '<span class="text-xs text-slate-400">No players with 5+ games in this data yet.</span>';
    return;
  }
  const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const cards = ["GK", "DEF", "MID", "FWD"].map((p) => {
    const s = b.perPos[p];
    return `<div class="rounded-lg border border-slate-700 bg-slate-800/40 px-1.5 py-1.5 text-center">
      <div class="text-xs text-slate-400">${p} <span class="text-slate-500">·${s.n}</span></div>
      <div class="text-sm font-semibold text-slate-200">${s.n ? fmt(s.mean) : "—"}</div>
      <div class="text-xs text-slate-400">±${s.n ? fmt(s.sd) : "—"}</div>
    </div>`;
  }).join("");
  const verdict = b.relSpread <= 0.15
    ? `<span class="text-emerald-400">✓ Well balanced</span> — position averages within ${fmt(b.spread)} pts of each other.`
    : b.relSpread <= 0.3
    ? `<span class="text-amber-400">⚠ Slightly skewed</span> — a ${fmt(b.spread)}-pt gap between the top and bottom position averages.`
    : `<span class="text-rose-400">⚠ Skewed</span> — a ${fmt(b.spread)}-pt gap between position averages; one position is favoured.`;
  const rows = b.top.slice(0, 20).map((e, i) => {
    const m = meta[e.pid] || {};
    return `<div class="flex items-center gap-2 px-2 py-1 text-xs ${i % 2 ? "bg-slate-800/30" : ""}">
      <span class="w-4 text-right text-slate-400">${i + 1}</span>
      <span class="w-7 text-slate-400">${e.pos}</span>
      <span class="flex-1 truncate">${esc(m.name || e.pid)}${m.team ? ` <span class="text-slate-500">${esc(m.team)}</span>` : ""}</span>
      <span class="text-slate-400">${e.games}g</span>
      <span class="w-10 text-right font-mono font-semibold text-wcgold">${fmt(e.points)}</span>
    </div>`;
  }).join("");
  const chart = ridgelineSvg(b.top, b.perPos);
  container.innerHTML = `
    <div class="grid grid-cols-4 gap-1.5">${cards}</div>
    <div class="text-xs leading-snug px-0.5">${verdict}</div>
    ${chart ? `<button type="button" data-openchart class="block w-full text-left rounded-lg border border-slate-700 bg-slate-900/40 p-2 hover:border-slate-500">
      <div class="text-xs text-slate-400 mb-1 flex items-center justify-between">
        <span>Points distribution by position <span class="text-slate-500">— shared scale; dashed line = average</span></span>
        <span class="text-slate-400">⤢ tap to enlarge</span>
      </div>
      ${chart}</button>` : ""}
    <details>
      <summary class="cursor-pointer text-xs text-slate-400 select-none">Top 20 scorers <span class="text-slate-500">(n=${b.count} with 5+ games)</span></summary>
      <div class="mt-1 rounded-lg border border-slate-700 overflow-hidden">${rows}</div>
    </details>`;
  container.querySelector("[data-openchart]")?.addEventListener("click", () => openChartSheet(b.top, b.perPos));
}

// Enlarged points-distribution chart in a modal — more bins, taller rows and
// labelled low/high extremes so the tails are easy to read.
function openChartSheet(players, perPos) {
  const body = $("chart-sheet-body");
  if (!body) return;
  body.innerHTML = ridgelineSvg(players, perPos, { big: true });
  $("chart-sheet").classList.remove("hidden");
}
function closeChartSheet() { $("chart-sheet")?.classList.add("hidden"); }

function squadFieldsHtml(eff, locked) {
  return `
    <div class="text-xs text-slate-400 font-medium">Squad size per position (draft quota)</div>
    ${cfgGrid(["GK", "DEF", "MID", "FWD"].map((p) => cfgNum(`quota.${p}`, p, eff.quota[p], locked)))}
    <div class="text-xs text-slate-400 font-medium">Starters per position (the rest are subs)</div>
    ${cfgGrid(["GK", "DEF", "MID", "FWD"].map((p) => cfgNum(`starters.${p}`, p, eff.starters[p], locked)))}`;
}

// Team-pick stage/champion bonuses (no TEAM quota — that's set alongside it).
function stageBonusFieldsHtml(eff, locked) {
  const sb = eff.stageBonus;
  return `
    <div class="text-xs text-slate-400 font-medium">Stage bonuses — cumulative, per knockout round the team reaches</div>
    ${cfgGrid(["r32", "r16", "qf", "sf", "final", "winner"].map((s) => cfgNum(`stageBonus.${s}`, s.toUpperCase(), sb[s], locked)), 3)}
    <div class="grid grid-cols-2 gap-2 items-end">
      ${cfgNum("finalPickBonus", "Champion pick bonus", eff.finalPickBonus, locked)}
    </div>`;
}

// Read a container's [data-cfg] number inputs (stage bonuses, quota, starters,
// champion bonus) into a partial config. Scoring rules come separately from the
// rules editor. Empty sub-objects are dropped.
function readConfigFromFields(container) {
  const cfg = { stageBonus: {}, quota: {}, starters: {} };
  for (const inp of container.querySelectorAll("[data-cfg]")) {
    if (inp.value.trim() === "") continue;
    const v = Number(inp.value);
    if (!Number.isFinite(v)) continue;
    const path = inp.dataset.cfg.split(".");
    if (path[0] === "stageBonus") cfg.stageBonus[path[1]] = v;
    else if (path[0] === "finalPickBonus") cfg.finalPickBonus = v;
    else if (path[0] === "quota") cfg.quota[path[1]] = v;
    else if (path[0] === "starters") cfg.starters[path[1]] = v;
  }
  for (const k of ["stageBonus", "quota", "starters"]) if (!Object.keys(cfg[k]).length) delete cfg[k];
  return cfg;
}

// Admin "Design your draft" editor (scoring + bonuses; squad is set at
// creation / redraft). Frozen once any game is scored so past totals never
// get retroactively rewritten.
function renderConfigEditor() {
  const box = $("adm-config");
  if (!box) return;
  const locked = (S.stats?.length || 0) > 0;
  const eff = effectiveConfig(cfgOf());
  S._admRules = eff.rules;
  box.innerHTML = `
    ${locked ? `<div class="rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-3 py-2">🔒 Games have already been scored — the draft design is locked so past totals never change.</div>` : ""}
    <div class="text-xs text-slate-400 font-medium">Scoring rules</div>
    <div id="adm-rules" class="space-y-1.5"></div>
    <div class="rounded-xl border border-slate-700 bg-slate-800/30 p-3 space-y-2">
      <div class="text-xs text-slate-400 font-medium">⚖️ Balance check <span class="text-slate-400 font-normal">— this league's games so far</span></div>
      <div id="adm-scoring-balance" class="space-y-2"></div>
    </div>
    ${stageBonusFieldsHtml(eff, locked)}
    <p class="text-xs text-slate-400">A champion TEAM banks ${calcTeamPoints("winner")} in total.</p>
    ${locked ? "" : `<div class="flex gap-2 pt-1">
      <button id="adm-config-save" class="flex-1 bg-wcred hover:bg-wcred-hov rounded-lg py-2 text-sm font-semibold">Save draft design</button>
      <button id="adm-config-reset" class="shrink-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-semibold">Reset to WC defaults</button>
    </div>`}`;
  const renderAdmBalance = () => {
    const posOf = {}, meta = {};
    for (const p of S.players) { posOf[p.player_id] = p.position; meta[p.player_id] = { name: p.name, team: p.team }; }
    renderScoringBalance($("adm-scoring-balance"), S.stats, posOf, S._admRules, meta);
  };
  renderRulesEditor($("adm-rules"), S._admRules, { locked, onChange: renderAdmBalance });
  renderAdmBalance();
  if (locked) return;
  $("adm-config-save").onclick = saveConfigEditor;
  $("adm-config-reset").onclick = resetConfigEditor;
}

async function saveConfigEditor() {
  const cfg = readConfigFromFields($("adm-config"));
  if (JSON.stringify(S._admRules) !== JSON.stringify(DEFAULT_RULES)) cfg.scoring = S._admRules;
  const { error } = await S.sb.from("leagues").update({ config: cfg }).eq("id", S.league.id);
  if (error) return toast(/config|column|schema cache/.test(error.message)
    ? "Config needs a schema update — run schema.sql." : error.message);
  S.league.config = cfg;
  toast("Draft design saved.");
  renderAdmin(); renderBoard();
}

async function resetConfigEditor() {
  if (!confirm("Reset scoring & bonuses to the standard World Cup values?")) return;
  const { error } = await S.sb.from("leagues").update({ config: null }).eq("id", S.league.id);
  if (error) return toast(error.message);
  S.league.config = null;
  toast("Reset to defaults.");
  renderAdmin(); renderBoard();
}

function renderAdmin() {
  const ok = isAdmin();
  $("admin-gate").classList.toggle("hidden", ok);
  $("admin-panel").classList.toggle("hidden", !ok);
  if (!ok) return;
  // Stages and redrafts are knockout machinery: a league season never has a
  // team "out", so the whole section is meaningless there.
  $("adm-sec-ko")?.classList.toggle("hidden", !isCupCompetition());
  $("adm-stages-card")?.classList.toggle("hidden", !isCupCompetition());

  /* Waiver claims only need an admin nudge where nothing else can give one:
     an auto-window league in waiver mode. Manual leagues resolve on the
     close-the-window tap, so the card would just be a second way to do it. */
  const wv = $("adm-waivers");
  if (wv) {
    const relevant = autoWindowsEnabled() && faDeferToClose();
    wv.classList.toggle("hidden", !relevant);
    if (relevant) {
      const pending = (S.faClaims || []).filter((c) => c.status === "pending").length;
      const win = lastClosedTradeWindow(S.fixtures || [], Date.now(), cfgOf().windows || {});
      const seen = S.league?.fa_processed_until ? Date.parse(S.league.fa_processed_until) : null;
      $("adm-waiver-status").textContent = !pending
        ? "Nothing waiting."
        : `${pending} claim${pending === 1 ? "" : "s"} waiting · ${
            waiverDue(win, isNaN(seen) ? null : seen)
              ? "the window has shut, so these resolve on the next refresh"
              : "they resolve when the window shuts"}.`;
      $("adm-waiver-run").disabled = !pending;
      $("adm-waiver-run").classList.toggle("opacity-40", !pending);
      $("adm-waiver-run").onclick = () => processWaiversNow().catch((e) => toast(e.message));
    }
  }

  /* Trading windows: fixture-driven or admin-driven, switchable mid-season.
     Switching to manual pins the CURRENT automatic answer into trading_open
     first, so the window can't spring open or slam shut the instant the mode
     changes — the state carries over rather than jumping. */
  const autoWin = autoWindowsEnabled();
  $("admin-panel").querySelectorAll("[data-winmode]").forEach((b) => {
    const on = (b.dataset.winmode === "auto") === autoWin;
    b.className = "flex-1 rounded-md py-1.5 font-semibold "
      + (on ? "bg-wcred text-white" : "text-slate-400");
    b.onclick = () => setWindowMode(b.dataset.winmode === "auto");
  });
  const wnote = $("adm-winmode-note");
  if (wnote) wnote.textContent = autoWin
    ? "Trading opens and closes itself around each matchweek, and line-ups lock before the first kick-off. The button below is ignored."
    : "You open and close the window yourself with the button below. Line-ups stay editable until you close it — including during matches, so close it before kick-off.";
  renderConfigEditor();
  // Competition selector + current-pool status.
  if (!$("adm-comp-select").options.length)
    $("adm-comp-select").innerHTML = COMPETITIONS.map((c) =>
      `<option value="${c.apiLeagueId}">${esc(c.name)}</option>`).join("");
  if (!$("adm-comp-season").value) $("adm-comp-season").value = new Date().getFullYear();
  const curComp = leagueCompetition();
  if (curComp) $("adm-comp-select").value = curComp.apiLeagueId;
  $("adm-comp-current").textContent = curComp
    ? `Current: ${curComp.name} ${curComp.season} — ${S.players.length} players`
    : "Current: built-in World Cup 2026 squads";
  renderScheduleManager();
  admQuotaSizePreview();
  if (!$("adm-home").options.length) {
    const opts = (sel) => $(sel).innerHTML =
      S.teams.map((t) => `<option>${esc(t)}</option>`).join("");
    opts("adm-home"); opts("adm-away");
    $("adm-date").value = new Date().toISOString().slice(0, 10);
  }
  $("adm-label-preview").textContent = admLabel();
  if (!$("adm-api-key").value)
    $("adm-api-key").value = localStorage.getItem("wcf_apikey") || "";
  if (!$("adm-pull-date").value)
    $("adm-pull-date").value = new Date().toISOString().slice(0, 10);
  const auto = autoWindowsEnabled(), open = tradingOpen();
  $("adm-trading-status").textContent = auto
    ? (open ? "Trading OPEN · " + tradeWindowMessage() : "Trading closed · " + tradeWindowMessage())
    : (open ? "Trading is OPEN" : "Trading is closed");
  $("adm-trading-status").className =
    "text-sm font-semibold " + (open ? "text-wcgold" : "text-slate-400");
  $("adm-trading-toggle").textContent = auto ? "Automatic — driven by fixtures"
    : (open ? "Close trading" : "Open trading");
  $("adm-trading-toggle").disabled = auto;
  $("adm-trading-toggle").classList.toggle("opacity-50", auto);
  $("adm-trading-toggle").classList.toggle("cursor-not-allowed", auto);
  // Line-ups get their own deadline in manual mode; under automatic windows
  // the fixture calendar owns both and the row would only mislead.
  const lopen = lineupOpen();
  $("adm-lineup-row").classList.toggle("hidden", auto);
  $("adm-lineup-status").textContent = lopen ? "Line-ups are OPEN" : "Line-ups are LOCKED";
  $("adm-lineup-status").className =
    "text-sm font-semibold " + (lopen ? "text-wcgold" : "text-slate-400");
  $("adm-lineup-toggle").textContent = lopen ? "Lock line-ups" : "Unlock line-ups";
  const sortOn = S.league.draft_stat_sort !== false;
  $("adm-sort-status").textContent = sortOn ? "Draft sort is ON" : "Draft sort is OFF";
  $("adm-sort-status").className =
    "text-sm font-semibold " + (sortOn ? "text-wcgold" : "text-slate-400");
  $("adm-sort-toggle").textContent = sortOn ? "Turn off draft sort" : "Turn on draft sort";
  const active = activeManagers();
  $("adm-phase-info").textContent = `Phase ${S.league.phase || 1}`
    + (S.league.final_phase ? " · final phase (champion picks)" : "")
    + ` · ${active.length} active manager${active.length === 1 ? "" : "s"}`;
  const chosen = active.filter((m) => keepersOf(m).length).length;
  $("adm-keeper-status").textContent = S.league.keeper_window
    ? `Keeper picks OPEN — up to ${S.league.keeper_max ?? 1} each · ${chosen}/${active.length} chose`
    : "Keeper picks closed";
  $("adm-keeper-toggle").textContent =
    S.league.keeper_window ? "Close keeper picks" : "Open keeper picks";
  $("adm-mgr-list").innerHTML = S.managers.map((m) => m.eliminated
    ? `<div class="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2 py-1.5 text-sm text-slate-400">
        <span class="truncate flex-1 line-through">${esc(m.name)}</span>
        <span class="text-xs">${(m.frozen_points || 0) + (managerTeamBonus(m.id)?.pts || 0)} pts${
          managerTeamBonus(m.id) ? " · TEAM live" : ""}</span></div>`
    : `<div class="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2 py-1.5 text-sm">
        <span class="truncate flex-1">${esc(m.name)}</span>${
        S.league.keeper_window ? `<span class="text-xs text-slate-400 truncate max-w-[50%]">${
          keepersOf(m).length
            ? "⭐ " + esc(keepersOf(m).map((pk) => pk.player_name).join(", "))
            : "no keepers yet"}</span>` : ""}
        <button data-rmmgr="${m.id}" class="text-xs underline text-red-400">remove</button></div>`).join("");
  $("adm-mgr-list").querySelectorAll("[data-rmmgr]").forEach((b) => b.onclick = () =>
    removeManager(S.managers.find((m) => m.id === b.dataset.rmmgr))
      .catch((e) => toast(e.message)));
  admRenderSelected();
  admRenderExisting();
  admRenderStages();
}

async function toggleDraftSort() {
  const next = S.league.draft_stat_sort === false;   // false -> on, else off
  const { error } = await S.sb.from("leagues")
    .update({ draft_stat_sort: next }).eq("id", S.league.id);
  if (error) return toast(/draft_stat_sort/.test(error.message)
    ? "Draft-sort toggle needs a schema update — run schema.sql." : error.message);
  toast(next ? "Draft sort turned on." : "Draft sort turned off — blind draft.");
  scheduleRefetch();
}

/* Switch trading windows between fixture-driven and admin-driven, mid-season.

   The hazard is the handover, not the modes. Going manual, `trading_open` may
   hold a value from whenever it was last touched — possibly months ago — and
   the moment the mode flips that stale flag becomes the truth, so the window
   can spring open or slam shut for no reason a manager can see. So the current
   automatic answer is written into it first: whatever the calendar says right
   now is what carries over.

   Going back to automatic needs no such care — the calendar is recomputed from
   the fixtures and `trading_open` stops being read at all. */
async function setWindowMode(auto) {
  if (auto === autoWindowsEnabled()) return;
  const cfg = { ...(S.league.config || {}) };
  const openNow = tradingOpen();
  if (auto) cfg.autoWindows = true;
  else delete cfg.autoWindows;
  const patch = { config: cfg };
  if (!auto) patch.trading_open = openNow;      // carry the state across
  const { error } = await S.sb.from("leagues").update(patch).eq("id", S.league.id);
  if (error) return toast(error.message);
  S.league.config = cfg;
  if (!auto) S.league.trading_open = openNow;
  toast(auto
    ? "Windows are automatic again — the fixture calendar decides."
    : `Manual windows — the window is ${openNow ? "open" : "closed"}, and stays that way until you change it.`);
  renderAdmin(); renderBoard();
  scheduleRefetch();
}

async function toggleTrading() {
  if (autoWindowsEnabled())
    return toast("Trade window is automatic — it opens and closes from the fixture calendar.");
  const next = !S.league.trading_open;
  const waiver = faDeferToClose();
  // Waiver mode: resolve all queued claims BEFORE the window shuts.
  if (!next && waiver) await processFaClaims();
  const { error } = await S.sb.from("leagues")
    .update({ trading_open: next }).eq("id", S.league.id);
  if (error) return toast(error.message);
  if (next && waiver) {
    await S.sb.from("fa_claims").delete().eq("league_id", S.league.id);  // fresh window
    await resetWaiverOrder();                                            // seed from standings
  }
  /* Closing trading no longer locks line-ups by itself: they are separate
     deadlines now (see lineupOpen). Opening trading unlocks both, because
     opening a window that leaves team selection shut would be a trap. */
  if (next) await S.sb.from("leagues").update({ lineups_open: true }).eq("id", S.league.id)
    .then(() => { S.league.lineups_open = true; }, () => {});
  toast(next ? "Trading window opened — deals and line-ups unlocked."
             : "Trading closed. Line-ups are still open — lock them before kick-off.");
  scheduleRefetch();
}

/* Lock or unlock team selection on its own. Locking is what takes the snapshot
   that the round is scored against, so it — not the trade window — is the
   moment that decides what everyone's XI was. */
async function toggleLineups() {
  if (autoWindowsEnabled())
    return toast("Line-up locking is automatic — it follows the fixture calendar.");
  const next = !lineupOpen();
  const { error } = await S.sb.from("leagues")
    .update({ lineups_open: next }).eq("id", S.league.id);
  if (error) return toast(/lineups_open|column|schema cache/.test(error.message)
    ? "Separate line-up locking needs a schema update — run schema.sql." : error.message);
  S.league.lineups_open = next;
  if (!next) await snapshotRosters();      // locking = freeze everyone's XI
  toast(next ? "Line-ups unlocked — managers can change their team."
             : "Line-ups locked in for the next games.");
  scheduleRefetch();
}

/* ---------- home & init ---------- */

function renderHome() {
  const sess = getSession();
  const has = !!sess?.leagueId;
  $("home-resume").classList.toggle("hidden", !has);
  if (has) $("home-resume-name").textContent = "Tap to rejoin your league";
  $("home-hero").classList.toggle("hidden", !!authUser());
  renderAccount();
}

// Toggle the account card between signed-in and signed-out states.
/* The signed-out panel does three jobs: sign in, sign up, and ask for a reset
   link. A fourth state -- setting the new password -- is NOT a mode here,
   because by then Supabase has already signed the user in (that is how it
   proves they own the mailbox). It is driven by _pwRecovery instead, and takes
   precedence over the signed-in panel, or the user would land on their account
   page having never been asked for a new password. */
let _accountMode = "signin";   // "signin" | "signup" | "reset"
let _pwRecovery = false;
function renderAccount() {
  const inEl = $("account-in"), outEl = $("account-out"), newEl = $("account-newpw");
  if (!inEl || !outEl) return;
  const u = authUser();
  const recovering = _pwRecovery && !!u;
  if (newEl) newEl.classList.toggle("hidden", !recovering);
  inEl.classList.toggle("hidden", !u || recovering);
  outEl.classList.toggle("hidden", !!u);
  if (recovering) return;
  if (u) { $("account-email-label").textContent = u.email || "your account"; loadMyLeagues(); return; }
  const reset = _accountMode === "reset", signup = _accountMode === "signup";
  $("account-mode-title").textContent =
    reset ? "Reset your password" : signup ? "Create an account" : "Sign in";
  $("account-toggle").textContent =
    _accountMode === "signup" ? "I already have an account" : "Create an account";
  $("account-submit").textContent =
    reset ? "Email me a reset link" : signup ? "Create account" : "Sign in";
  // Nothing to type in the password box when all we need is the address, and
  // nothing about Google or "stay signed in" belongs on a reset screen.
  $("account-pw").classList.toggle("hidden", reset);
  $("account-google")?.classList.toggle("hidden", reset);
  $("account-or")?.classList.toggle("hidden", reset);
  $("account-toggle")?.classList.toggle("hidden", reset);
  const blurb = $("account-blurb");
  if (blurb) blurb.textContent = reset
    ? "Enter the email address you signed up with and we'll send you a link to set a new password."
    : "Sign in to create or join a league. Your teams follow you across devices, and you stay signed in until you sign out.";
  $("account-pw").autocomplete = signup ? "new-password" : "current-password";
  // Offering "forgot password" while creating an account makes no sense, and
  // while already on the reset screen it is the way back that matters.
  const forgot = $("account-forgot");
  if (forgot) {
    forgot.classList.toggle("hidden", signup);
    forgot.textContent = reset ? "Back to sign in" : "Forgot your password?";
  }
}

async function submitAccount() {
  const email = $("account-email").value.trim();
  const pw = $("account-pw").value;
  const msg = (t, ok) => { const el = $("account-msg"); el.textContent = t; el.className = "text-xs " + (ok ? "text-emerald-400" : "text-slate-400"); };
  if (_accountMode === "reset") {
    if (!email) return msg("Enter your email address.");
    const btn0 = $("account-submit"); btn0.disabled = true;
    try {
      const { error } = await S.sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,   // must be allowlisted in Supabase
      });
      if (error) return msg(error.message);
      /* Deliberately the same reply whether or not that address has an account:
         a different one would let anyone check who has signed up here. */
      return msg("If that address has an account, a reset link is on its way.", true);
    } finally { btn0.disabled = false; }
  }
  if (!email || !pw) return msg("Enter your email and password.");
  const btn = $("account-submit"); btn.disabled = true;
  try {
    if (_accountMode === "signup") {
      const { data, error } = await S.sb.auth.signUp({ email, password: pw });
      if (error) return msg(error.message);
      // With email confirmation on, there's a user but no session until confirmed.
      if (!data.session) return msg("Account created — check your email to confirm, then sign in.", true);
      msg("Account created — you're signed in.", true);
    } else {
      const { error } = await S.sb.auth.signInWithPassword({ email, password: pw });
      if (error) return msg(error.message);
    }
    await refreshAuthUser();
    $("account-pw").value = "";
    renderAccount();
  } finally { btn.disabled = false; }
}

/* Finish a reset: the user is already signed in off the back of the emailed
   link, so this just sets the password on that session. */
async function saveNewPassword() {
  const el = $("account-newpw-input"), out = $("account-newpw-msg");
  const msg = (t, ok) => { if (out) { out.textContent = t; out.className = "text-xs " + (ok ? "text-emerald-400" : "text-slate-400"); } };
  const pw = el ? el.value : "";
  // Checked here as well as server-side, so the reply is instant and specific
  // rather than a round trip ending in "Password should be at least...".
  if (pw.length < 6) return msg("Use at least 6 characters.");
  const btn = $("account-newpw-save"); if (btn) btn.disabled = true;
  try {
    const { data, error } = await S.sb.auth.updateUser({ password: pw });
    if (error) return msg(error.message);
    if (el) el.value = "";
    _pwRecovery = false;
    /* Take the user straight from the reply rather than re-reading the session.
       A second round trip here can fail transiently, and the cost of that is
       the user appearing signed OUT the instant after they set a password --
       which reads as "it didn't work" and sends them round again. */
    if (data?.user) S.authUser = data.user;
    msg("Password updated — you're signed in.", true);
    renderAccount();
  } finally { if (btn) btn.disabled = false; }
}

// Google OAuth: redirects to Google and back to this page, where
// detectSessionInUrl finishes the sign-in and onAuthStateChange updates the UI.
async function signInWithGoogle() {
  const msg = (t) => { const el = $("account-msg"); if (el) { el.textContent = t; el.className = "text-xs text-slate-400"; } };
  const { error } = await S.sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },   // must be allowlisted in Supabase
  });
  if (error) msg(/provider is not enabled/i.test(error.message)
    ? "Google sign-in isn't enabled on the project yet (enable it in Supabase → Authentication → Providers)."
    : error.message);
  // On success the page navigates to Google; nothing more to do here.
}

async function signOutAccount() {
  await S.sb.auth.signOut();
  S.authUser = null;
  renderAccount();
  toast("Signed out.");
}

// The leagues this account is a member of (managers linked by user_id) — so
// they follow you to any device. Tapping one opens it without an invite code.
async function loadMyLeagues() {
  const box = $("account-leagues");
  if (!box) return;
  if (!authUid()) { box.innerHTML = ""; return; }
  const { data: mine, error } = await S.sb.from("managers")
    .select("id,name,league_id").eq("user_id", authUid());
  if (error || !mine?.length) { box.innerHTML = ""; return; }   // no link column / no leagues
  const ids = [...new Set(mine.map((m) => m.league_id))];
  const { data: lgs } = await S.sb.from("leagues").select("id,name").in("id", ids);
  const byId = Object.fromEntries((lgs || []).map((l) => [l.id, l]));
  box.innerHTML = `<div class="text-xs text-slate-400">Your leagues</div>` + mine.map((m) => {
    const l = byId[m.league_id];
    return l ? `<button data-openleague="${esc(m.league_id)}" data-mgr="${esc(m.id)}" class="w-full text-left rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm hover:border-wcgold">${esc(l.name)} <span class="text-slate-400 text-xs">· as ${esc(m.name)}</span></button>` : "";
  }).join("");
  box.querySelectorAll("[data-openleague]").forEach((b) => b.onclick = () => {
    setSession({ leagueId: b.dataset.openleague, managerId: b.dataset.mgr, adminToken: getSession()?.adminToken || null });
    enterLeagueWithFeedback();
  });
}

// Publish the sticky header's real height so anything pinned beneath it (the
// draft clock) sits flush rather than behind it.
function syncHeaderHeight() {
  const h = document.querySelector("header")?.offsetHeight;
  if (h) document.documentElement.style.setProperty("--hdr-h", h + "px");
}

function wire() {
  syncHeaderHeight();
  window.addEventListener("resize", () => { syncHeaderHeight(); syncDraftMini(); });
  window.addEventListener("scroll", syncDraftMini, { passive: true });
  $("cfg-save").onclick = () => {
    const url = $("cfg-url").value.trim().replace(/\/$/, "");
    const key = $("cfg-key").value.trim();
    if (!url.startsWith("https://") || !key) return toast("Enter the project URL and anon key.");
    setConfig({ url, key });
    location.reload();
  };
  $("home-create").onclick = () => { renderCreateForm(); showView("create"); };
  $("home-join").onclick = () => showView("join");
  $("account-toggle").onclick = () => {
    _accountMode = _accountMode === "signup" ? "signin" : "signup";
    $("account-msg").textContent = ""; renderAccount();
  };
  $("account-forgot").onclick = () => {
    _accountMode = _accountMode === "reset" ? "signin" : "reset";
    $("account-msg").textContent = ""; renderAccount();
  };
  $("account-newpw-save").onclick = () => saveNewPassword();
  $("account-google").onclick = () => signInWithGoogle().catch((e) => toast(e.message));
  $("account-submit").onclick = () => submitAccount().catch((e) => toast(e.message));
  $("account-signout").onclick = () => signOutAccount().catch((e) => toast(e.message));
  $("account-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAccount().catch(() => {}); });
  $("hdr-exit").onclick = () => {
    if (!confirm("Exit this league? You'll go back to the join screen — rejoin any time with your invite code."))
      return;
    leaveLeague();
    showView("join");
  };
  // Built-in creds mean the config screen is never auto-shown; let
  // "Reconfigure" open it on demand to override with a different project.
  /* The "change Supabase connection" link is gone from Home. The connection is
     baked into the build (BUILTIN_SUPABASE_*), so for a hosted product there is
     nothing a user should be pointing anywhere else -- and clearing it stranded
     them on a setup screen asking for a project URL they do not have. The
     config VIEW stays, as the fallback when a build genuinely ships without
     credentials (see the showView("config") in boot). */
  $("home-resume-go").onclick = () => enterLeagueWithFeedback();
  $("home-resume-leave").onclick = leaveLeague;
  $("error-retry").onclick = () => enterLeagueWithFeedback();
  $("error-home").onclick = () => { leaveLeague(); showView("home"); };
  $("create-go").onclick = () => createLeague().catch((e) => toast(e.message));
  $("create-tolobby").onclick = () => enterLeagueWithFeedback();
  $("join-find").onclick = () => findLeague().catch((e) => toast(e.message));
  $("join-go").onclick = () => joinLeague().catch((e) => toast(e.message));
  $("lobby-start").onclick = () => startDraft().catch((e) => toast(e.message));
  $("lobby-addbots").onclick = () => addBots().catch((e) => toast(e.message));
  $("lobby-order-shuffle").onclick = () => {
    const ids = shuffled(S.managers).map((m) => m.id);
    ids.forEach((id, i) => {
      const m = S.managers.find((x) => x.id === id);
      if (m) m.draft_position = i + 1;
    });
    setDraftOrder(ids);
    renderLobbyOrder();
  };
  $("home-practice").onclick = () => {
    const n = Math.max(1, Math.min(13, Number($("practice-bots").value) || 7));
    startPracticeDraft(n).catch((e) => toast("Practice draft failed: " + e.message));
  };
  $("lobby-num-set").onclick = async () => {
    if (!isAdmin()) return;
    const n = Math.max(2, Math.min(15, parseInt($("lobby-num-input").value, 10) || 0));
    if (n < S.managers.length) return toast(`${S.managers.length} already joined — kick someone first.`);
    const { error } = await S.sb.from("leagues").update({ num_managers: n }).eq("id", S.league.id);
    if (error) return toast(error.message);
    toast(`League now needs ${n} managers.`);
  };
  $("lobby-join-go").onclick = () => joinFromLobby().catch((e) => toast(e.message));
  $("pool-search").oninput = (e) => { S.poolSearch = e.target.value; renderPool(true); };
  $("pool-team").onchange = () => renderPool(true);
  $("pool-sort").onchange = (e) => { S.poolSort = e.target.value; renderPool(true); };
  $("stats-search").oninput = (e) => { S.statsSearch = e.target.value; renderStatsTab(); };
  $("stats-sort").onchange = (e) => { S.statsSort = e.target.value; renderStatsTab(); };
  $("stats-round").onchange = (e) => { S.statsRound = Number(e.target.value); renderStatsTab(); };
  $("stats-per90").onclick = () => { S.statsPer90 = !S.statsPer90; renderStatsTab(); };
  $("stats-unpicked").onclick = () => { S.statsUnpicked = !S.statsUnpicked; renderStatsTab(); };
  $("stats-hideko").onclick = () => { S.statsHideKO = !S.statsHideKO; renderStatsTab(); };
  $("player-sheet").onclick = (e) => {
    if (e.target.id === "player-sheet") $("player-sheet").classList.add("hidden");
  };
  $("planner-search").oninput = (e) => { S.plannerSearch = e.target.value; renderPlannerPick(); };
  $("planner-sort").onchange = (e) => { S.plannerSort = e.target.value; renderPlannerPick(); };
  $("planner-slfilter").onclick = () => { S.plannerShortlistOnly = !S.plannerShortlistOnly; renderPlannerPick(); };
  $("planner-unpicked").onclick = () => { S.plannerUnpicked = !S.plannerUnpicked; renderPlannerPick(); };
  $("planner-hideko").onclick = () => { S.plannerHideKO = !S.plannerHideKO; renderPlannerPick(); };
  $("planner-pos").onclick = () => { S.plannerAnyPos = !S.plannerAnyPos; renderPlannerPick(); };
  $("planner-done").onclick = () => $("planner-sheet").classList.add("hidden");
  $("planner-sheet").onclick = (e) => {
    if (e.target.id === "planner-sheet") $("planner-sheet").classList.add("hidden");
  };
  $("draft-force").onclick = () => {
    if (confirm("Force a random auto-pick for the manager on the clock?"))
      autoPick(pickInfo(S.league.current_pick)).catch((e) => toast(e.message));
  };
  $("draft-timer-set").onclick = async () => {
    if (!isAdmin()) return;
    const secs = Math.max(0, Math.min(600, parseInt($("draft-timer-input").value, 10) || 0));
    // Reset the current pick's clock so the new limit takes effect immediately.
    const { error } = await S.sb.from("leagues")
      .update({ pick_duration_seconds: secs, pick_started_at: new Date().toISOString() })
      .eq("id", S.league.id);
    if (error) return toast(error.message);
    autoPickedFor = 0;
    toast(secs ? `Timer set to ${secs}s.` : "Timer off (no limit).");
  };
  $("hdr-admin").onclick = () => { renderAdmin(); showView("admin"); };
  document.querySelectorAll(".nav-btn").forEach((b) => b.onclick = () => {
    const panes = navGroups()[b.dataset.nav] || [];
    // Returning to a section lands on the view you last used inside it.
    const last = S._navLast?.[b.dataset.nav];
    setBoardTab(panes.includes(last) ? last : panes[0]);
    renderBoard();
  });
  // Leave the admin view first, then let route() pick the phase view.
  $("admin-back").onclick = () => { showView("board"); route(); };
  $("admin-unlock").onclick = () => {
    const tok = $("admin-token-input").value.trim();
    if (!tok || tok !== S.league?.admin_token) return toast("Wrong token.");
    setSession({ ...getSession(), adminToken: tok });
    renderAdmin();
  };
  $("adm-psearch").oninput = admRenderPlayerSearch;
  $("adm-drafted").onchange = admRenderPlayerSearch;
  $("adm-tsearch").oninput = admRenderStages;
  $("adm-trading-toggle").onclick = () => toggleTrading().catch((e) => toast(e.message));
  $("adm-lineup-toggle").onclick = () => toggleLineups().catch((e) => toast(e.message));
  $("adm-sort-toggle").onclick = () => toggleDraftSort().catch((e) => toast(e.message));
  $("adm-keeper-toggle").onclick = () => toggleKeeperWindow().catch((e) => toast(e.message));
  $("adm-redraft").onclick = () => startRedraft().catch((e) => toast(e.message));
  $("adm-final").onclick = () => startFinalPhase().catch((e) => toast(e.message));
  ["adm-q-gk", "adm-q-def", "adm-q-mid", "adm-q-fwd", "adm-q-flex"].forEach((id) =>
    $(id).oninput = admQuotaSizePreview);
  $("adm-pull-now").onclick = () => pullStatsNow().catch((e) => toast(e.message));
  $("adm-comp-load").onclick = () => loadCompetition().catch((e) => toast(e.message));
  $("adm-snapshot").onclick = () => {
    if (confirm("Snapshot every manager's current lineup as the locked state from today?"))
      snapshotRosters().then(() => { toast("Lineups locked."); scheduleRefetch(); })
        .catch((e) => toast(e.message));
  };
  $("swap-close").onclick = closeSwap;
  $("chart-close").onclick = closeChartSheet;
  $("recap-close").onclick = closeRecap;
  $("reveal-close").onclick = closeReveal;
  $("reveal-sheet").onclick = (e) => { if (e.target.id === "reveal-sheet") closeReveal(); };
  $("recap-sheet").onclick = (e) => { if (e.target.id === "recap-sheet") closeRecap(); };
  $("chart-sheet").onclick = (e) => { if (e.target.id === "chart-sheet") closeChartSheet(); };  // tap backdrop
  $("swap-search").oninput = renderSwapList;
  $("swap-team").onchange = renderSwapList;
  $("swap-pos").onchange = renderSwapList;
  $("lineup-secondary").onclick = () => {
    if (S.lineupEdit) return discardLineupEdit();          // back to viewing
    $("lineup-sheet").classList.add("hidden"); lockScroll(false);
  };
  $("lineup-primary").onclick = () => {
    if (!S.lineupEdit) return enterLineupEdit();
    saveLineup().catch((e) => toast(e.message));
  };

  ["adm-home", "adm-away", "adm-date", "adm-label"].forEach((id) =>
    $(id).onchange = () => $("adm-label-preview").textContent = admLabel());
  $("adm-save").onclick = () => admSave().catch((e) => toast(e.message));
  document.querySelectorAll(".back-btn").forEach((b) => b.onclick = () => showView("home"));
  document.querySelectorAll(".copy-btn").forEach((b) => b.onclick = () => {
    navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast("Copied"));
  });
}

async function init() {
  wire();
  setInterval(tickTimer, 500);
  setInterval(tickMatchday, 1000);   // the matchday countdown
  // Banner LIVE/FT states are time-based; the render cache makes this a
  // no-op whenever nothing changed, so the ticker animation never jumps.
  setInterval(renderBanner, 60e3);
  const cfg = getConfig();
  if (!cfg) { showView("config"); return; }
  // Persist the auth session so a login survives reloads (no re-login each
  // visit) and auto-refresh the token. detectSessionInUrl completes the Google
  // OAuth redirect. The unique storageKey isolates our token from other apps on
  // the shared *.github.io localStorage.
  S.sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
      storageKey: "wcf-supabase-auth",
    },
  });
  await refreshAuthUser();
  S.sb.auth.onAuthStateChange((event, session) => {
    S.authUser = session?.user || null;
    /* Arriving from a reset link signs the user in AND fires PASSWORD_RECOVERY.
       Without catching it they would simply land on their account page, still
       not knowing their password and with no way to set one. */
    if (event === "PASSWORD_RECOVERY") _pwRecovery = true;
    if (event === "SIGNED_OUT") _pwRecovery = false;
    renderAccount();
    if (_shownView === "home") renderHome();
  });
  renderHome();
  const sess = getSession();
  if (sess?.leagueId) await enterLeagueWithFeedback();
  else showView("home");
}

document.addEventListener("DOMContentLoaded", init);
