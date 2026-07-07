# Turning WC-Fantasy into a sellable product — roadmap

**Goal:** go from "one private app my friends use for World Cup 2026" to "a
product where anyone can sign up, design their own fantasy draft, invite their
friends, and pay for it."

**Status of this doc:** planning only. Nothing here is built yet. It exists so we
can agree on scope and sequencing *before* the current tournament ends — the
build itself is a post-final project (see "Sequencing" at the bottom).

---

## 1. Where we are today (honest baseline)

The current app is a single-file, client-side app (`index.html`) talking
directly to one Supabase project. It was built for **one trusted friend group**,
and several deliberate shortcuts make it great for that and unsellable to
strangers as-is:

| Piece | Today | Why it blocks a product |
| --- | --- | --- |
| **Auth** | None. A baked-in anon key + local `admin_token` / `join_token`. | No real user accounts to attach data, billing, or permissions to. |
| **Security (RLS)** | Wide open — every table policy is `using(true)`. | Anyone with the app can read/write **every** league's data. Fatal once strangers share the database. |
| **Draft design** | Scoring, positions, stage bonuses, squad quotas all hardcoded constants. | "Design your own draft" means these must be per-league config. |
| **Player pool** | `players.json` is World Cup 2026 squads only. | A general product must support other competitions / custom pools. |
| **Billing** | None. | No revenue mechanism. |
| **Onboarding** | Share a URL + invite code. | No sign-up, no landing page, no self-serve league creation tied to an account. |

**What's already product-shaped (the good news):** the data model is
*multi-league from day one*. `leagues` has invite codes, admin tokens, and an
admin panel that already configures per-league **quotas, starters, keeper rules,
draft timing, and phases**. Many independent leagues already coexist in one DB.
We are extending a multi-tenant-ish model, not inventing one.

---

## 2. The four workstreams

Ordered by dependency. #1 gates everything commercial.

### 🔴 Workstream A — Accounts + real security *(the hard blocker)*

Nothing paid can ship until data is isolated per user/league. This is the
biggest single piece.

- **Add Supabase Auth** (email magic-link + Google). Replace the baked-in-key /
  local-token identity model with real sessions.
- **Rewrite Row-Level Security.** Every table (`leagues`, `managers`, `picks`,
  `match_stats`, `team_stages`, `trades`, `trade_items`, `lineup_snapshots`,
  `transactions`) moves from `using(true)` to policies scoped to *"you are a
  member of this league"* and *"you are this league's owner"* for admin writes.
  - Add `leagues.owner_id uuid references auth.users`.
  - Add `managers.user_id uuid references auth.users` (link a seat to an
    account); keep `join_token` as the invite mechanism that *claims* a seat.
  - Membership helper: a `league_members` view or a `security definer` function
    `is_member(league_id)` / `is_owner(league_id)` used by every policy.
- **Server-authoritative admin actions.** Things that must not be client-trusted
  once strangers play — advancing the pick clock, settling stats, closing the
  trade window, awarding stage bonuses — move into Supabase **RPC / edge
  functions** guarded by `is_owner()`. (Today the client does these; fine among
  friends, not among paying strangers.)
- **Keep the app client-side.** We don't need a custom backend server — Supabase
  Auth + RLS + a handful of edge functions is the whole backend. The frontend
  stays the same shape (and the PWA from the near-term step is reused verbatim).

**Definition of done:** a logged-in user can only ever see/modify leagues they
own or have joined, proven by trying to hit another league's rows and being
denied by the database itself (not just the UI).

### 🟠 Workstream B — Configurable draft design ("design your own")

This is the product's actual selling point. Today these live as constants in
`index.html`; they become a per-league **config object** (a `leagues.config
jsonb` column, or a `league_configs` table) edited in a "Design your draft"
screen at creation time.

Make configurable (all currently hardcoded — file/line references for the build):

- **Scoring** — `SCORING` (`index.html:439`): goal points by position, assist,
  clean sheet, cards, saves, def-actions, MOTM, penalty saved/missed.
- **Squad shape** — `PHASE1_QUOTA` (`:430`) and positions `GROUPS` (`:432`);
  starters-per-position (already per-league via `phase_starters`).
- **TEAM bonuses** — `STAGE_ORDER` / `STAGE_BONUS` (`:455-456`) and
  `FINAL_PICK_BONUS` (`:460`).
- **Draft mechanics** — timer, snake vs linear, managers count (partly done:
  `pick_duration_seconds`, `num_managers`), the new blind-draft toggle
  (`draft_stat_sort`) generalizes into "which columns are visible during draft."

**The big sub-project: the player pool.** The app is wired to WC-2026 squads
(`players.json`) plus the pull scripts (`daily_pull.py`, `build_fixtures.py`,
etc.) that only know API-Football's league 1 / season 2026. A general product
needs one of:

1. **Curated catalog** — we maintain player pools for several competitions
   (World Cup, Euros, Champions League, domestic leagues) and a league creator
   picks one. Highest quality, most ongoing maintenance.
2. **Bring-your-own pool** — the creator uploads / picks a competition and we
   auto-pull the squads + fixtures + stats via API-Football (the pull scripts
   get parameterized by `league_id`/`season` instead of hardcoded 2026). More
   flexible, more support surface (bad data, weird competitions).

Recommendation: ship **v1 with a small curated catalog** (whatever tournaments
are live that season), add BYO later. This keeps stats reliable — the whole app
lives or dies on the stat pull being correct.

### 🟠 Workstream C — Billing

Mechanically simple once Workstream A exists.

- **Stripe** via Supabase (Stripe customer id on the user, webhook → edge
  function updates entitlement).
- **Pricing model to decide** (this is a business call, not a technical one):
  - Per-league one-off fee (e.g. "$X to run a draft") — matches the mental model
    of "set up a tournament for my friends," lowest friction, no recurring
    commitment.
  - Subscription (monthly/seasonal) — better revenue, higher churn risk for a
    seasonal use-case.
  - Freemium — free small leagues, pay for size/features (custom scoring, more
    managers, private branding).
- Gate creation/among features behind entitlement in RLS/edge functions, never
  just the UI.

### 🟡 Workstream D — Product surface

The lighter, non-blocking polish:

- Landing page (what it is, screenshots, "create your draft" CTA).
- Sign-up / onboarding flow → "Design your draft" wizard → invite friends.
- A name + branding (the app is generically "WC Fantasy" today).
- Support basics: a way for a league owner to reset/fix things, an FAQ, an
  email.
- Legal: terms + privacy (needed the moment you take payment and hold accounts).

---

## 3. Suggested milestones

Each is a shippable checkpoint, not a big-bang rewrite.

1. **M0 — Near-term (this tournament):** PWA + private hosting on the *current*
   app. Not part of the SaaS build, but it's the front-end the product reuses,
   so it's not throwaway. *(Decided separately.)*
2. **M1 — Auth + RLS on a fresh Supabase project.** Rebuild the security model
   clean, migrate the app to log in. **No new features** — same app, real
   accounts, real isolation. This is the make-or-break milestone.
3. **M2 — Self-serve league creation** tied to accounts (owner creates, invites
   claim seats). Still WC-shaped scoring.
4. **M3 — Configurable draft design** (Workstream B minus BYO pool): scoring,
   quotas, bonuses editable per league, from a curated catalog of ≥1
   competition.
5. **M4 — Billing** (Workstream C) with the chosen pricing model.
6. **M5 — Polish + launch** (Workstream D): landing page, onboarding, name,
   legal.
7. **M6+ — Bring-your-own pool**, more competitions, advanced customization.

Realistic effort: M1–M5 is **weeks of focused work**, not an afternoon. M1 alone
(auth + rewriting every RLS policy + moving admin actions server-side) is the
chunk most likely to be underestimated.

---

## 4. Sequencing — and the one hard rule

**Do not rebuild the backend while the current friends' league is live on it.**
Swapping in Auth + new RLS mid-tournament is exactly how you lock out or corrupt
an active draft.

- **Now:** M0 (PWA + private host). Serve this World Cup; get the installable
  front-end.
- **After the final:** start M1 on a **separate, clean Supabase project** so the
  live league is never at risk. Migrate/copy data only when the new model is
  proven.

---

## 5. Open decisions to make before building

1. **Pricing model** — per-league fee vs subscription vs freemium (§C). Business
   call; shapes M4 and some of M1's data model.
2. **Player-pool strategy** — curated catalog vs bring-your-own for v1 (§B). The
   single biggest scope lever; recommend curated first.
3. **How custom is "custom"?** — just tune scoring/quotas of a soccer draft, or
   truly generic (other sports, arbitrary player lists, custom positions)? Wider
   = much bigger. Recommend "tunable soccer draft" for v1.
4. **Name / branding.**
5. **Auth providers** — email + Google is plenty for v1; add Apple if you want
   smooth iOS.

---

*This is a living document — we'll turn each milestone into concrete tasks when
we start it.*
