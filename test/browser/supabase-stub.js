/* An in-memory stand-in for the Supabase client, served in place of
 * vendor/supabase.js so the browser harness can drive the REAL app.
 *
 * What it is for: the loop that has been done by hand -- create a league,
 * draft, play weeks, transfer, close a window, read the round pager back.
 * Everything above the database is the actual application code.
 *
 * WHAT IT DOES NOT MODEL, and must not be trusted for:
 *   - row-level security. There are no policies here, so every read and write
 *     succeeds. The RLS failure that made settlement fail in silence is
 *     invisible to this file by construction; test_sql.sh is what covers it.
 *   - concurrency. One tab, one thread, no racing clients.
 *   - PostgREST's exact error shapes beyond the few modelled below.
 * A stub is a model of the database written by the same hand as the tests, so
 * it can be wrong in the same direction as the code. It closes the "does the
 * app work" gap, not the "does the database agree" one.
 *
 * Unique constraints ARE modelled, because the settlement claim is built on
 * one: advanceRound() relies on the second INSERT failing with 23505. Without
 * that here, a test of the claim would prove nothing.
 */
(function () {
  const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

  // (table -> list of column sets that must be unique). Mirrors schema.sql.
  const UNIQUE = {
    rounds: [["league_id", "round_key"], ["league_id", "round_no"]],
    match_stats: [["league_id", "player_id", "match_label"]],
    competition_stats: [["competition_key", "player_id", "match_label"]],
    lineup_snapshots: [["league_id", "manager_id", "effective_from"]],
    picks: [["league_id", "pick_number"]],
    competition_pools: [["competition_key"]],
  };

  const db = { tables: {}, log: [] };
  const rowsOf = (t) => (db.tables[t] ||= []);

  // Null is distinct in a Postgres unique constraint -- which is exactly why a
  // knockout round (round_no null) can be recorded at all. Getting this wrong
  // would make the stub disagree with the engine on the one thing that matters.
  const conflicts = (table, row, ignore) => {
    for (const cols of UNIQUE[table] || []) {
      if (cols.some((c) => row[c] == null)) continue;
      const hit = rowsOf(table).find((r) =>
        r !== ignore && cols.every((c) => r[c] === row[c]));
      if (hit) return { hit, cols };
    }
    return null;
  };

  const err = (code, message) => ({ data: null, error: { code, message } });

  /* Every row that leaves here is a COPY. A real client parses JSON off the
     wire, so the app can never hold a reference to a database row -- and the
     first version of this handed out the stored objects themselves, which
     meant an UPDATE silently rewrote the app's own state too. That is not a
     harmless shortcut: it hides exactly the bugs where the app forgets to
     refetch, because the data appears to update on its own. */
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  function builder(table) {
    const filters = [];
    let mode = "select", payload = null, opts = {}, wantRows = false;
    let single = null, orderBy = null, range = null;

    const match = (r) => filters.every((f) => f(r));
    const q = {
      select(_cols) { wantRows = true; return q; },
      insert(v) { mode = "insert"; payload = v; return q; },
      update(v) { mode = "update"; payload = v; return q; },
      upsert(v, o) { mode = "upsert"; payload = v; opts = o || {}; return q; },
      delete() { mode = "delete"; return q; },
      eq(c, v) { filters.push((r) => r[c] === v); return q; },
      neq(c, v) { filters.push((r) => r[c] !== v); return q; },
      lt(c, v) { filters.push((r) => r[c] < v); return q; },
      lte(c, v) { filters.push((r) => r[c] <= v); return q; },
      gt(c, v) { filters.push((r) => r[c] > v); return q; },
      gte(c, v) { filters.push((r) => r[c] >= v); return q; },
      is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
      contains(c, v) { filters.push((r) => JSON.stringify(r[c] ?? "").includes(
        typeof v === "string" ? v : JSON.stringify(v).slice(1, -1))); return q; },
      order(c, o) { orderBy = { c, asc: !o || o.ascending !== false }; return q; },
      range(a, b) { range = [a, b]; return q; },
      limit(n) { range = [0, n - 1]; return q; },
      maybeSingle() { single = "maybe"; wantRows = true; return q; },
      single() { single = "one"; wantRows = true; return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };

    function run() {
      db.log.push({ table, mode });
      const rows = rowsOf(table);
      let out;
      if (mode === "select") {
        out = rows.filter(match);
        if (orderBy) out = out.slice().sort((a, b) => {
          const x = a[orderBy.c], y = b[orderBy.c];
          return (x > y ? 1 : x < y ? -1 : 0) * (orderBy.asc ? 1 : -1);
        });
        if (range) out = out.slice(range[0], range[1] + 1);
      } else if (mode === "insert" || mode === "upsert") {
        const incoming = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
          id: uuid(), created_at: new Date().toISOString(), ...clone(r),
        }));
        out = [];
        for (const row of incoming) {
          const clash = conflicts(table, row);
          if (clash) {
            if (mode === "insert")
              return err("23505", `duplicate key value violates unique constraint on ${table}`);
            Object.assign(clash.hit, row, { id: clash.hit.id });   // upsert = update
            out.push(clash.hit);
          } else {
            rows.push(row); out.push(row);
          }
        }
      } else if (mode === "update") {
        out = rows.filter(match);
        for (const r of out) {
          const next = { ...r, ...clone(payload) };
          if (conflicts(table, next, r))
            return err("23505", `duplicate key value violates unique constraint on ${table}`);
          Object.assign(r, payload);
        }
      } else if (mode === "delete") {
        out = rows.filter(match);
        db.tables[table] = rows.filter((r) => !out.includes(r));
      }
      const data = wantRows ? clone(single ? (out[0] ?? null) : out) : null;
      if (single === "one" && !out.length) return err("PGRST116", "no rows returned");
      return { data, error: null };
    }
    return q;
  }

  // Auth: signed in as a fixed user. The app requires an account to do
  // anything, and none of what this harness drives depends on WHICH account.
  const USER = { id: "00000000-0000-4000-8000-000000000001", email: "tester@example.com" };
  const SESSION = { user: USER, access_token: "stub" };

  window.__db = db;
  window.supabase = {
    createClient() {
      return {
        from: builder,
        auth: {
          getSession: async () => ({ data: { session: SESSION }, error: null }),
          getUser: async () => ({ data: { user: USER }, error: null }),
          onAuthStateChange: (cb) => {
            setTimeout(() => cb("SIGNED_IN", SESSION), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signInWithPassword: async () => ({ data: { session: SESSION, user: USER }, error: null }),
          signUp: async () => ({ data: { session: SESSION, user: USER }, error: null }),
          signInWithOAuth: async () => ({ data: {}, error: null }),
          signOut: async () => ({ error: null }),
          updateUser: async () => ({ data: { user: USER }, error: null }),
          resetPasswordForEmail: async () => ({ data: {}, error: null }),
        },
        // Realtime is a no-op: this harness drives the app directly, so there
        // is no second client to hear from.
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
      };
    },
  };
})();
