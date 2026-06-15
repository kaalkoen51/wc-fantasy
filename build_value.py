#!/usr/bin/env python3
"""Offline player-value model for the WC-2026 fantasy draft.

This is a STANDALONE analysis tool. It does not touch the app: it never
writes to Supabase or edits any app file. It reads players.json /
fixtures.json (and injuries.json if present) read-only, pulls recent
national-team matches from API-Football (cached in .value_cache/), and
prints draft rankings plus value.csv / value.json.

What it estimates
-----------------
Player value = expected fantasy points over the tournament, under this
game's exact scoring (a copy of daily_pull.SCORING), converted to
Value-Over-Replacement (VOR) so positions are comparable for a snake draft.

Three layers:
  1. Team-strength model (Dixon-Coles bivariate Poisson) fit by weighted
     MLE on national-team scorelines. Opponent strength lives here: it gives
     expected goals for/against in any matchup. Matches are weighted by
     time-decay x competition weight (friendlies downweighted).
  2. Player model: weighted per-team-match rates + attacking *shares* of
     team output, with empirical-Bayes (Gamma-Poisson) shrinkage toward
     position priors (samples are tiny -- ~8-15 caps).
  3. Tournament aggregation: a Monte-Carlo of the real group draw +
     knockout bracket gives each team P(reach stage) and a matches-played
     distribution, which scales per-match expected points into a season
     projection with p10/p50/p90 bands. The TEAM slot is valued from the
     same sim as expected STAGE_BONUS.

Usage
-----
    export API_FOOTBALL_KEY=...          # same key daily_pull.py uses
    pip install -r requirements-value.txt
    python build_value.py                # full run -> value.csv/json + tables
    python build_value.py --backtest 2022  # self-validation on WC 2022
    python build_value.py --demo         # synthetic data, no network (smoke test)

Key caveats (read these before trusting a number)
  * Availability dominates value and is the hardest thing to predict
    (manager selection). start_prob here is a recent-minutes proxy, not
    truth -- eyeball it and override with judgement.
  * The knockout bracket uses a neutral-venue random re-draw among
    survivors each round (the exact official 2026 slotting is not modelled);
    deep-run probabilities are approximate.
  * Competition league ids / seasons in COMPETITIONS are best-effort and
    overridable with --leagues; verify against API-Football /leagues.
"""

import argparse
import json
import os
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

try:
    import requests
except ImportError:  # only needed for live (non --demo) runs
    requests = None

HERE = Path(__file__).parent
API_BASE = "https://v3.football.api-sports.io"
CACHE = HERE / ".value_cache"
PLAYERS_JSON = HERE / "players.json"
FIXTURES_JSON = HERE / "fixtures.json"
INJURIES_JSON = HERE / "injuries.json"

# ---------------------------------------------------------------------------
# Scoring + matching constants, COPIED from daily_pull.py (kept inline so this
# tool stays standalone). If daily_pull.SCORING changes, mirror it here.
# ---------------------------------------------------------------------------
SCORING = {
    "goal": {"GK": 8, "DEF": 6, "MID": 5, "FWD": 4},
    "assist": 3,
    "clean_sheet": {"GK": 6, "DEF": 4, "MID": 1, "FWD": 0},
    "yellow_card": -1,
    "red_card": -3,
    "save_per_2": 1,
    "def_action_per_2": 1,
    "motm": 3,
    "penalty_saved": 5,
    "penalty_missed": -2,
}
# TEAM-slot stage bonuses, copied from index.html (STAGE_ORDER / STAGE_BONUS).
STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "final", "winner"]
STAGE_BONUS = {"r32": 5, "r16": 10, "qf": 15, "sf": 20, "final": 25, "winner": 15}
FINAL_PICK_BONUS = 5  # champion-prediction bonus (separate slot; reported as EV)

POSITION_MAP = {
    "G": "GK", "D": "DEF", "M": "MID", "F": "FWD",
    "Goalkeeper": "GK", "Defender": "DEF", "Midfielder": "MID", "Attacker": "FWD",
}
TEAM_NAME_FIX = {
    "Bosnia & Herzegovina": "Bosnia And Herzegovina",
    "Cape Verde Islands": "Cabo Verde",
    "Czech Republic": "Czechia",
    "Iran": "IR Iran",
    "Ivory Coast": "Côte D'Ivoire",
    "South Korea": "Korea Republic",
}
MOTM_MIN_RATING = 7.5
FUZZY_MIN_RATIO = 0.75
COMPLETED_STATUSES = {"FT", "AET", "PEN"}
POSITIONS = ("GK", "DEF", "MID", "FWD")

# Phase-1 draft quota (copied from index.html PHASE1_QUOTA) -- drives VOR.
QUOTA = {"GK": 2, "DEF": 4, "MID": 4, "FWD": 3, "TEAM": 1}

# Competitions feeding the model: (label, api_league_id, [seasons], weight).
# Weight expresses signal quality; friendlies are downweighted. league ids are
# API-Football's; verify with /leagues and override via --leagues if needed.
COMPETITIONS = [
    ("World Cup 2022",        1,  [2022],             1.00),
    ("WC 2026 qualifiers",   32,  [2023, 2024, 2025], 0.85),
    ("UEFA Nations League",   5,  [2022, 2024, 2025], 0.80),
    ("Euro 2024",             4,  [2024],             1.00),
    ("Copa America 2024",     9,  [2024],             1.00),
    ("AFCON",                 6,  [2023, 2025],       0.90),
    ("Asian Cup 2023",        7,  [2023],             0.90),
    ("Friendlies",           10,  [2022, 2023, 2024, 2025, 2026], 0.35),
]
DEFAULT_DECAY_HALFLIFE_DAYS = 540.0  # ~18 months


# ---------------------------------------------------------------------------
# Small helpers (copied/adapted from daily_pull.py)
# ---------------------------------------------------------------------------
def to_int(value) -> int:
    return int(value) if value else 0


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fix_team_name(name: str) -> str:
    return TEAM_NAME_FIX.get(name, name)


def normalize_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = "".join(c if c.isalnum() else " " for c in s.lower())
    return " ".join(s.split())


def surname_key(name: str) -> str:
    tokens = normalize_name(name).split()
    return tokens[-1] if tokens else ""


class PlayerMatcher:
    """API-Football player -> players.json entry. Copied from daily_pull.py."""

    def __init__(self, players: list):
        self.by_team, self.by_number, self.by_surname = {}, {}, {}
        for p in players:
            team = normalize_name(p["team"])
            self.by_team.setdefault(team, []).append(p)
            self.by_surname.setdefault((team, surname_key(p["name"])), []).append(p)
            shirt = p["player_id"].rsplit("_", 1)[-1]
            if shirt.isdigit():
                self.by_number[(team, int(shirt))] = p

    def match(self, api_name: str, api_team: str, shirt_number=None):
        team = normalize_name(fix_team_name(api_team))
        roster = self.by_team.get(team)
        if not roster:
            return None
        target = normalize_name(api_name)
        candidates = [p for p in roster if normalize_name(p["name"]) == target]
        if not candidates:
            candidates = self.by_surname.get((team, surname_key(api_name)), [])
        if not candidates:
            scored = [(SequenceMatcher(None, target, normalize_name(p["name"])).ratio(), p)
                      for p in roster]
            best = max((r for r, _ in scored), default=0)
            if best >= FUZZY_MIN_RATIO:
                candidates = [p for r, p in scored if r == best]
        if len(candidates) > 1 and shirt_number is not None:
            byn = self.by_number.get((team, shirt_number))
            if byn in candidates:
                return byn
        if len(candidates) > 1 and target:
            first = target.split()[0]
            narrowed = [p for p in candidates
                        if normalize_name(p["name"]).split()[0].startswith(first)]
            if len(narrowed) == 1:
                candidates = narrowed
        if len(candidates) == 1:
            return candidates[0]
        if shirt_number is not None:
            byn = self.by_number.get((team, shirt_number))
            if byn:
                return byn
        return None


# ---------------------------------------------------------------------------
# Pure model functions (unit-tested in test_value.py)
# ---------------------------------------------------------------------------
def dc_lambdas(att_h, def_h, att_a, def_a, home_adv):
    """Dixon-Coles expected goals for a (home, away) matchup on the log scale.

    lambda_home = exp(home_adv + att_home - def_away)
    lambda_away = exp(att_away - def_home)
    Pass home_adv=0 for a neutral venue.
    """
    lam_home = np.exp(home_adv + att_h - def_a)
    lam_away = np.exp(att_a - def_h)
    return float(lam_home), float(lam_away)


def dixon_coles_tau(x, y, lam, mu, rho):
    """Low-score dependence correction (Dixon & Coles, 1997). Returns a
    positive multiplier on the independent-Poisson joint pmf."""
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


def gamma_poisson_shrink(events, exposure, prior_rate, prior_strength):
    """Empirical-Bayes posterior mean rate under a Gamma(a, b) prior with
    mean prior_rate and 'prior_strength' pseudo-exposure:
        rate = (events + prior_rate*prior_strength) / (exposure + prior_strength)
    As exposure -> 0 it returns the prior; as exposure -> inf, the observed
    rate. Keeps tiny-sample players from dominating on noise.
    """
    return (events + prior_rate * prior_strength) / (exposure + prior_strength)


def poisson_zero_prob(lam):
    """P(Poisson(lam) == 0) = exp(-lam) -- used for clean-sheet probability."""
    return float(np.exp(-lam))


def expected_floor_div2(mean_count):
    """E[floor(N/2)] for N~Poisson(mean). Approximated as mean/2 - 0.25
    (the long-run bias of integer division by 2), floored at 0. Used for the
    saves and defensive-actions 'per 2' scoring."""
    return max(0.0, mean_count / 2.0 - 0.25)


def value_over_replacement(values, replacement_rank):
    """Given a list of projected points (any order) and a replacement rank
    (1-based), return {index: vor} where vor = value - replacement_value and
    replacement_value is the points of the player ranked `replacement_rank`."""
    order = sorted(range(len(values)), key=lambda i: values[i], reverse=True)
    idx = min(replacement_rank, len(order)) - 1
    repl = values[order[idx]] if order else 0.0
    return {i: values[i] - repl for i in range(len(values))}, repl


# ---------------------------------------------------------------------------
# Data acquisition (live API; cached). Skipped entirely in --demo.
# ---------------------------------------------------------------------------
def cached_get(path: str, params: dict) -> dict:
    if requests is None:
        sys.exit("Error: the 'requests' package is required for live runs.")
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        sys.exit("Error: API_FOOTBALL_KEY env var is required (or use --demo).")
    CACHE.mkdir(exist_ok=True)
    name = path.replace("/", "_") + "_" + "_".join(
        f"{k}-{v}" for k, v in sorted(params.items()))
    cache_file = CACHE / f"{name}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    resp = requests.get(f"{API_BASE}/{path}", headers={"x-apisports-key": key},
                        params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if data.get("errors"):
        sys.exit(f"API-Football error on /{path}: {data['errors']}")
    cache_file.write_text(json.dumps(data), encoding="utf-8")
    return data


def competition_weight(decay_halflife, now):
    """Return a function(date_str, comp_weight) -> combined match weight."""
    lam = np.log(2.0) / max(1.0, decay_halflife)

    def weigh(date_str, comp_weight):
        try:
            d = datetime.fromisoformat(date_str[:10]).replace(tzinfo=timezone.utc)
        except ValueError:
            return comp_weight
        days = max(0.0, (now - d).days)
        return comp_weight * float(np.exp(-lam * days))

    return weigh


def fetch_dataset(competitions, matcher, weigh, only_before=None):
    """Pull fixtures + per-player stats across competitions.

    Returns (results, appearances):
      results: list of dicts {date, home, away, hg, ag, weight} for the
               team model (all completed matches, any teams).
      appearances: list of per-player-per-match dicts (mapped to FIFA ids)
               with weight, minutes, opponent, and the raw stat line.
    `only_before` (YYYY-MM-DD) excludes later matches -- used by --backtest.
    """
    results, appearances = [], []
    seen_fixtures = set()
    for label, league, seasons, cweight in competitions:
        for season in seasons:
            fixtures = cached_get("fixtures", {"league": league, "season": season})
            for f in fixtures.get("response", []):
                fx = f["fixture"]
                if fx["status"]["short"] not in COMPLETED_STATUSES:
                    continue
                date = fx["date"][:10]
                if only_before and date >= only_before:
                    continue
                fid = fx["id"]
                if fid in seen_fixtures:
                    continue
                seen_fixtures.add(fid)
                home = fix_team_name(f["teams"]["home"]["name"])
                away = fix_team_name(f["teams"]["away"]["name"])
                goals = f.get("goals", {})
                hg, ag = to_int(goals.get("home")), to_int(goals.get("away"))
                w = weigh(date, cweight)
                results.append({"date": date, "home": home, "away": away,
                                "hg": hg, "ag": ag, "weight": w})
                _collect_appearances(fid, f, matcher, w, appearances)
    return results, appearances


def _collect_appearances(fid, fixture, matcher, weight, out):
    teams_data = cached_get("fixtures/players", {"fixture": fid}).get("response", [])
    goals = fixture.get("goals", {})
    conceded = {fixture["teams"]["home"]["id"]: to_int(goals.get("away")),
                fixture["teams"]["away"]["id"]: to_int(goals.get("home"))}
    rows = []
    for block in teams_data:
        tid = block.get("team", {}).get("id")
        tname = block.get("team", {}).get("name", "")
        for entry in block.get("players", []):
            stats = (entry.get("statistics") or [{}])[0]
            games = stats.get("games", {}) or {}
            g = stats.get("goals", {}) or {}
            cards = stats.get("cards", {}) or {}
            pen = stats.get("penalty", {}) or {}
            tk = stats.get("tackles", {}) or {}
            minutes = to_int(games.get("minutes"))
            if minutes <= 0:
                continue
            matched = matcher.match(entry.get("player", {}).get("name", ""),
                                    tname, to_int(games.get("number")) or None)
            if not matched:
                continue
            rows.append({
                "player_id": matched["player_id"], "name": matched["name"],
                "team": matched["team"], "position": matched["position"],
                "weight": weight, "minutes": minutes,
                "rating": to_float(games.get("rating")),
                "goals": to_int(g.get("total")), "assists": to_int(g.get("assists")),
                "saves": to_int(g.get("saves")),
                "conceded": conceded.get(tid, 0),
                "yellow": to_int(cards.get("yellow")), "red": to_int(cards.get("red")),
                "pen_saved": to_int(pen.get("saved")),
                "pen_missed": to_int(pen.get("missed")),
                "def_actions": (to_int(tk.get("total")) + to_int(tk.get("blocks"))
                                + to_int(tk.get("interceptions"))),
                "motm": False,
            })
    rated = [r for r in rows if r["rating"] is not None]
    if rated:
        best = max(rated, key=lambda r: r["rating"])
        if best["rating"] >= MOTM_MIN_RATING:
            best["motm"] = True
    out.extend(rows)


# ---------------------------------------------------------------------------
# Team-strength model
# ---------------------------------------------------------------------------
class TeamModel:
    """Weighted Dixon-Coles bivariate-Poisson team-strength model."""

    def __init__(self, results):
        teams = sorted({r["home"] for r in results} | {r["away"] for r in results})
        self.teams = teams
        self.idx = {t: i for i, t in enumerate(teams)}
        self.attack = {t: 0.0 for t in teams}
        self.defence = {t: 0.0 for t in teams}
        self.home_adv = 0.25
        self.rho = -0.05
        self._results = results

    def fit(self):
        n = len(self.teams)
        if n < 2 or not self._results:
            return self
        H = np.array([self.idx[r["home"]] for r in self._results])
        A = np.array([self.idx[r["away"]] for r in self._results])
        X = np.array([r["hg"] for r in self._results], dtype=float)
        Y = np.array([r["ag"] for r in self._results], dtype=float)
        W = np.array([r["weight"] for r in self._results], dtype=float)
        # params: attack[0..n-1], defence[0..n-1], home_adv, rho
        p0 = np.concatenate([np.zeros(n), np.zeros(n), [0.25, -0.05]])

        def negll(p):
            att, dfc = p[:n], p[n:2 * n]
            att = att - att.mean()  # identifiability: mean attack = 0
            home_adv, rho = p[2 * n], p[2 * n + 1]
            lam = np.exp(home_adv + att[H] - dfc[A])
            mu = np.exp(att[A] - dfc[H])
            ll = X * np.log(lam) - lam + Y * np.log(mu) - mu
            # DC low-score correction (vectorised over the four corner cases)
            tau = np.ones_like(lam)
            m00 = (X == 0) & (Y == 0); tau[m00] = 1 - lam[m00] * mu[m00] * rho
            m01 = (X == 0) & (Y == 1); tau[m01] = 1 + lam[m01] * rho
            m10 = (X == 1) & (Y == 0); tau[m10] = 1 + mu[m10] * rho
            m11 = (X == 1) & (Y == 1); tau[m11] = 1 - rho
            tau = np.clip(tau, 1e-6, None)
            ll = ll + np.log(tau)
            return -np.sum(W * ll)

        bounds = [(-3, 3)] * (2 * n) + [(-0.5, 1.0), (-0.2, 0.2)]
        res = minimize(negll, p0, method="L-BFGS-B", bounds=bounds,
                       options={"maxiter": 500})
        p = res.x
        att = p[:n] - p[:n].mean()
        dfc = p[n:2 * n]
        self.attack = {t: float(att[i]) for t, i in self.idx.items()}
        self.defence = {t: float(dfc[i]) for t, i in self.idx.items()}
        self.home_adv = float(p[2 * n])
        self.rho = float(p[2 * n + 1])
        return self

    def expected_goals(self, team, opp, neutral=True):
        """(lambda_for, lambda_against) for `team` vs `opp`."""
        ha = 0.0 if neutral else self.home_adv
        lf, la = dc_lambdas(self.attack.get(team, 0.0), self.defence.get(team, 0.0),
                            self.attack.get(opp, 0.0), self.defence.get(opp, 0.0), ha)
        return lf, la

    def strength(self, team):
        """Scalar strength for seeding / fallbacks: attack - defence (defence
        higher = better, so subtract). Higher is stronger."""
        return self.attack.get(team, 0.0) + self.defence.get(team, 0.0)


# ---------------------------------------------------------------------------
# Player model
# ---------------------------------------------------------------------------
def aggregate_players(appearances, players, team_match_weight):
    """Collapse appearance rows into one weighted record per player_id.

    team_match_weight: {team -> total weight of that team's matches in window},
    so per-team-match rates account for games the player sat out.
    """
    by_id = defaultdict(lambda: defaultdict(float))
    meta = {}
    for r in appearances:
        a = by_id[r["player_id"]]
        meta[r["player_id"]] = (r["name"], r["team"], r["position"])
        w = r["weight"]
        a["w_minutes"] += w * r["minutes"]
        a["w_apps"] += w
        a["w_starts"] += w if r["minutes"] >= 60 else 0.0
        a["nineties"] += w * r["minutes"] / 90.0
        for k in ("goals", "assists", "saves", "def_actions", "yellow", "red",
                  "pen_saved", "pen_missed"):
            a[f"w_{k}"] += w * r[k]
        a["w_motm"] += w * (1.0 if r["motm"] else 0.0)

    # also include squad players with zero appearances (priors only)
    records = {}
    for p in players:
        pid = p["player_id"]
        a = by_id.get(pid, defaultdict(float))
        name, team, pos = meta.get(pid, (p["name"], p["team"], p["position"]))
        tmw = team_match_weight.get(team, 0.0)
        records[pid] = {
            "player_id": pid, "name": name, "team": team, "position": pos,
            "team_match_weight": tmw, **{k: a[k] for k in a},
        }
    return records


def position_priors(records, team_goal_rate):
    """Per-position prior per-team-match rates (pooled, weighted), used as the
    shrinkage target. Returns {pos: {stat: prior_per_team_match}}."""
    pools = defaultdict(lambda: defaultdict(float))
    tw = defaultdict(float)
    for r in records.values():
        pos = r["position"]
        w = r.get("team_match_weight", 0.0)
        if w <= 0:
            continue
        tw[pos] += w
        for k in ("w_goals", "w_assists", "w_saves", "w_def_actions",
                  "w_yellow", "w_red", "w_motm", "w_starts"):
            pools[pos][k] += r.get(k, 0.0)
    priors = {}
    for pos in POSITIONS:
        denom = tw[pos] or 1.0
        priors[pos] = {k: pools[pos][k] / denom for k in pools[pos]}
        priors[pos].setdefault("w_starts", 0.0)
    return priors


def project_player(rec, model, opp_list, priors, prior_strength, injured_ids):
    """Expected fantasy points for ONE player in ONE average future match
    (averaged over opp_list), plus per-match variance and a start probability.

    Opponent strength enters via the team model's expected goals against each
    opponent; attacking output is the player's *share* of team goals/assists.
    """
    pos = rec["position"]
    team = rec["team"]
    tmw = rec.get("team_match_weight", 0.0)
    pri = priors.get(pos, {})

    # Start probability from recent minutes; injured -> heavily damped.
    start_rate = gamma_poisson_shrink(
        rec.get("w_starts", 0.0), tmw, pri.get("w_starts", 0.3), prior_strength)
    start_rate = float(np.clip(start_rate, 0.0, 1.0))
    if rec["player_id"] in injured_ids:
        start_rate *= 0.2

    # Per-team-match shrunk rates for non-shared categories.
    def rate(key, prior_key):
        return gamma_poisson_shrink(rec.get(key, 0.0), tmw,
                                    pri.get(prior_key, 0.0), prior_strength)

    saves_r = rate("w_saves", "w_saves")
    da_r = rate("w_def_actions", "w_def_actions")
    yel_r = rate("w_yellow", "w_yellow")
    red_r = rate("w_red", "w_red")
    ps_r = rate("w_pen_saved", "w_pen_saved")
    pm_r = rate("w_pen_missed", "w_pen_missed")
    motm_r = rate("w_motm", "w_motm")

    # Attacking *share* of team output (shrunk toward a positional default).
    team_g = max(0.2, team_goal_rate_for(team, model))
    goal_share = gamma_poisson_shrink(
        rec.get("w_goals", 0.0), tmw, pri.get("w_goals", 0.0), prior_strength) / team_g
    assist_share = gamma_poisson_shrink(
        rec.get("w_assists", 0.0), tmw, pri.get("w_assists", 0.0), prior_strength) / team_g

    mus, vars = [], []
    for opp in opp_list:
        lf, la = model.expected_goals(team, opp, neutral=True)
        opp_scale = la / max(0.2, team_avg_conceded(team, model))  # workload vs strong opp

        e_goals = lf * goal_share
        e_assists = lf * assist_share
        e_saves_pts = expected_floor_div2(saves_r * opp_scale) * SCORING["save_per_2"] \
            if pos == "GK" else 0.0
        e_da_pts = expected_floor_div2(da_r * min(2.0, opp_scale)) * SCORING["def_action_per_2"] \
            if pos != "GK" else 0.0
        cs_pts = poisson_zero_prob(la) * start_rate * SCORING["clean_sheet"][pos]

        mu = (e_goals * SCORING["goal"][pos] + e_assists * SCORING["assist"]
              + cs_pts + e_saves_pts + e_da_pts
              + yel_r * SCORING["yellow_card"] + red_r * SCORING["red_card"]
              + ps_r * SCORING["penalty_saved"] + pm_r * SCORING["penalty_missed"]
              + motm_r * SCORING["motm"])
        # availability: counting stats already include playing time via shares/
        # per-team-match rates; clean sheet handled above. Apply a mild extra
        # damp for fringe players so non-starters don't carry full rates.
        mu *= 0.4 + 0.6 * start_rate

        # crude per-match variance for p10/p90 bands (independent categories)
        var = (e_goals * SCORING["goal"][pos] ** 2 + e_assists * SCORING["assist"] ** 2
               + poisson_zero_prob(la) * (1 - poisson_zero_prob(la))
               * (start_rate * SCORING["clean_sheet"][pos]) ** 2
               + max(0.0, e_saves_pts) + max(0.0, e_da_pts)
               + yel_r * SCORING["yellow_card"] ** 2 + motm_r * SCORING["motm"] ** 2)
        mus.append(mu)
        vars.append(max(0.05, var))

    return float(np.mean(mus)), float(np.mean(vars)), start_rate


def team_goal_rate_for(team, model):
    """A team's expected goals vs an average opponent (for share denominators)."""
    avg_def = np.mean(list(model.defence.values())) if model.defence else 0.0
    return float(np.exp(model.attack.get(team, 0.0) - avg_def))


def team_avg_conceded(team, model):
    avg_att = np.mean(list(model.attack.values())) if model.attack else 0.0
    return float(np.exp(avg_att - model.defence.get(team, 0.0)))


# ---------------------------------------------------------------------------
# Tournament simulation (group draw + knockout)
# ---------------------------------------------------------------------------
def infer_groups(fixtures, teams):
    """Group the WC group-stage fixtures into groups of 4 via connected
    components of the 'plays during group stage' graph (each group is a K4)."""
    adj = defaultdict(set)
    known = set(teams)
    for f in fixtures:
        h, a = f.get("home"), f.get("away")
        if h in known and a in known:
            adj[h].add(a)
            adj[a].add(h)
    groups, seen = [], set()
    for t in adj:
        if t in seen:
            continue
        comp, stack = set(), [t]
        while stack:
            x = stack.pop()
            if x in comp:
                continue
            comp.add(x)
            stack.extend(adj[x] - comp)
        seen |= comp
        groups.append(sorted(comp))
    return [g for g in groups if len(g) >= 2]


def simulate_tournament(model, groups, sims, rng):
    """Monte-Carlo the group stage (real draw) + a neutral random-redraw
    knockout. Returns:
      stage_prob: {team: {stage: probability}}
      matches_played: {team: np.array of length sims}
    """
    teams = [t for g in groups for t in g]
    stage_count = {t: defaultdict(float) for t in teams}
    matches = {t: np.zeros(sims) for t in teams}

    def play(a, b):
        lf, la = model.expected_goals(a, b, neutral=True)
        ga = rng.poisson(lf)
        gb = rng.poisson(la)
        return ga, gb

    for s in range(sims):
        thirds = []
        qualifiers = []
        for g in groups:
            pts = {t: 0 for t in g}
            gd = {t: 0 for t in g}
            gf = {t: 0 for t in g}
            for i in range(len(g)):
                for j in range(i + 1, len(g)):
                    a, b = g[i], g[j]
                    ga, gb = play(a, b)
                    matches[a][s] += 1
                    matches[b][s] += 1
                    gd[a] += ga - gb
                    gd[b] += gb - ga
                    gf[a] += ga
                    gf[b] += gb
                    if ga > gb:
                        pts[a] += 3
                    elif gb > ga:
                        pts[b] += 3
                    else:
                        pts[a] += 1
                        pts[b] += 1
            rank = sorted(g, key=lambda t: (pts[t], gd[t], gf[t], rng.random()),
                          reverse=True)
            qualifiers.extend(rank[:2])
            if len(rank) >= 3:
                thirds.append((rank[2], pts[rank[2]], gd[rank[2]], gf[rank[2]]))
        # best 8 third-placed teams fill the 32-team knockout
        thirds.sort(key=lambda x: (x[1], x[2], x[3], rng.random()), reverse=True)
        n_third = max(0, 32 - len(qualifiers))
        qualifiers.extend(t[0] for t in thirds[:n_third])

        for t in qualifiers:
            stage_count[t]["r32"] += 1
        # neutral random-redraw single elimination
        alive = list(qualifiers)
        rng.shuffle(alive)
        stage_names = ["r16", "qf", "sf", "final", "winner"]
        si = 0
        while len(alive) > 1:
            nxt = []
            for i in range(0, len(alive) - 1, 2):
                a, b = alive[i], alive[i + 1]
                ga, gb = play(a, b)
                matches[a][s] += 1
                matches[b][s] += 1
                w = a if (ga > gb or (ga == gb and rng.random() < 0.5)) else b
                nxt.append(w)
            alive = nxt
            if si < len(stage_names):
                for t in alive:
                    stage_count[t][stage_names[si]] += 1
            si += 1

    stage_prob = {t: {st: stage_count[t][st] / sims for st in STAGE_ORDER[1:]}
                  for t in teams}
    return stage_prob, matches


def team_slot_value(stage_prob):
    """Expected TEAM-slot points = sum P(reach stage) * STAGE_BONUS[stage]."""
    return {t: sum(p.get(st, 0.0) * STAGE_BONUS[st] for st in STAGE_BONUS)
            for t, p in stage_prob.items()}


# ---------------------------------------------------------------------------
# Assembling projections
# ---------------------------------------------------------------------------
def build_projections(records, model, groups, stage_prob, matches, priors,
                      prior_strength, injured_ids, managers, sims, rng):
    group_of = {t: g for g in groups for t in g}
    team_value = team_slot_value(stage_prob)
    rows = []

    for rec in records.values():
        team = rec["team"]
        opp_list = [o for o in group_of.get(team, []) if o != team] or [team]
        mu, var, start_rate = project_player(
            rec, model, opp_list, priors, prior_strength, injured_ids)
        n_played = matches.get(team)
        if n_played is None:
            n_played = np.full(sims, 3.0)
        # sim player points: per draw, n matches each ~Normal(mu, sd)
        n = n_played
        z = rng.standard_normal(sims)
        samples = mu * n + np.sqrt(np.maximum(n, 0)) * np.sqrt(var) * z
        samples = np.maximum(samples, np.minimum(0, mu * n))  # allow small negatives
        rows.append({
            "player_id": rec["player_id"], "name": rec["name"], "team": team,
            "position": rec["position"],
            "proj_points": float(mu * n.mean()),
            "p10": float(np.percentile(samples, 10)),
            "p50": float(np.percentile(samples, 50)),
            "p90": float(np.percentile(samples, 90)),
            "per_match": float(mu), "start_prob": round(start_rate, 3),
            "exp_matches": float(n.mean()),
        })

    # TEAM rows on the same scale
    for team, val in team_value.items():
        rows.append({
            "player_id": f"team:{team}", "name": team, "team": team,
            "position": "TEAM", "proj_points": float(val),
            "p10": float(val), "p50": float(val), "p90": float(val),
            "per_match": 0.0, "start_prob": 1.0,
            "exp_matches": float(matches.get(team, np.full(sims, 3.0)).mean()),
        })

    df = pd.DataFrame(rows)
    # Value over replacement, per position
    df["vor"] = 0.0
    for pos in list(POSITIONS) + ["TEAM"]:
        mask = df["position"] == pos
        vals = df.loc[mask, "proj_points"].tolist()
        if not vals:
            continue
        repl_rank = managers * QUOTA[pos]
        vor_map, _ = value_over_replacement(vals, repl_rank)
        df.loc[mask, "vor"] = [vor_map[i] for i in range(len(vals))]
    return df.sort_values("vor", ascending=False).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def print_leaderboards(df, top):
    cols = ["name", "team", "position", "proj_points", "p10", "p90", "vor",
            "start_prob", "exp_matches"]
    show = df[cols].copy()
    for c in ("proj_points", "p10", "p90", "vor", "exp_matches"):
        show[c] = show[c].round(1)
    print(f"\n=== Top {top} by VOR (all positions) ===")
    print(show.head(top).to_string(index=False))
    for pos in list(POSITIONS) + ["TEAM"]:
        sub = show[show["position"] == pos].head(top if pos != "TEAM" else 12)
        if len(sub):
            print(f"\n--- {pos} ---")
            print(sub.to_string(index=False))


def write_outputs(df):
    df.to_csv(HERE / "value.csv", index=False)
    (HERE / "value.json").write_text(
        df.to_json(orient="records"), encoding="utf-8")
    print(f"\nWrote {HERE/'value.csv'} and {HERE/'value.json'} "
          f"({len(df)} rows).")


# ---------------------------------------------------------------------------
# Demo dataset (no network) -- exercises the whole pipeline for a smoke test.
# ---------------------------------------------------------------------------
def demo_inputs(rng):
    teams = [f"T{i:02d}" for i in range(16)]
    strengths = {t: rng.normal(0, 0.4) for t in teams}
    players = []
    for t in teams:
        for n in range(1, 24):
            pos = ("GK" if n <= 3 else "DEF" if n <= 11 else "MID" if n <= 18 else "FWD")
            players.append({"player_id": f"{t.lower()}_{n}",
                            "name": f"{t} P{n}", "team": t, "position": pos})
    # results: round robin x2
    results = []
    for i in range(len(teams)):
        for j in range(len(teams)):
            if i == j:
                continue
            lf = np.exp(0.2 + strengths[teams[i]] - strengths[teams[j]])
            la = np.exp(strengths[teams[j]] - strengths[teams[i]])
            results.append({"date": "2024-06-01", "home": teams[i], "away": teams[j],
                            "hg": int(rng.poisson(lf)), "ag": int(rng.poisson(la)),
                            "weight": 1.0})
    # appearances: top ~13 outfield + 1 GK per team appear, scoring by strength
    pid_by_team = defaultdict(list)
    for p in players:
        pid_by_team[p["team"]].append(p)
    appearances = []
    for r in results:
        for team in (r["home"], r["away"]):
            squad = pid_by_team[team]
            for p in squad[:14]:
                mins = int(rng.choice([90, 90, 75, 0, 20]))
                if mins == 0:
                    continue
                base = max(0.0, 0.15 + strengths[team])
                appearances.append({
                    "player_id": p["player_id"], "name": p["name"], "team": team,
                    "position": p["position"], "weight": r["weight"], "minutes": mins,
                    "rating": 7.0, "goals": int(rng.poisson(base if p["position"] in ("MID", "FWD") else base / 3)),
                    "assists": int(rng.poisson(base / 2)),
                    "saves": int(rng.poisson(2)) if p["position"] == "GK" else 0,
                    "conceded": r["ag"] if team == r["home"] else r["hg"],
                    "yellow": int(rng.random() < 0.1), "red": 0,
                    "pen_saved": 0, "pen_missed": 0,
                    "def_actions": int(rng.poisson(3)) if p["position"] in ("DEF", "MID") else 0,
                    "motm": rng.random() < 0.05,
                })
    # group draw: 4 groups of 4
    groups = [teams[i:i + 4] for i in range(0, 16, 4)]
    fixtures = []
    for g in groups:
        for i in range(len(g)):
            for j in range(i + 1, len(g)):
                fixtures.append({"home": g[i], "away": g[j]})
    return players, results, appearances, fixtures


# ---------------------------------------------------------------------------
# Backtest (self-validation)
# ---------------------------------------------------------------------------
def run_backtest(season, matcher, players, weigh, sims, managers, prior_strength):
    """Fit on pre-tournament data, project that World Cup, compare to actual."""
    cutoff = f"{season}-11-01"  # WC 2022 started 2022-11-20; trains on prior data
    print(f"[backtest] training on matches before {cutoff} ...")
    results, appearances = fetch_dataset(COMPETITIONS, matcher, weigh, only_before=cutoff)
    if not results:
        sys.exit("[backtest] no training data fetched (check API key / leagues).")
    model = TeamModel(results).fit()
    tmw = defaultdict(float)
    for r in results:
        tmw[r["home"]] += r["weight"]
        tmw[r["away"]] += r["weight"]
    records = aggregate_players(appearances, players, tmw)
    priors = position_priors(records, None)

    # actual WC `season` fantasy points (no opponent weighting -- ground truth)
    actual_fix = [f for f in cached_get("fixtures", {"league": 1, "season": season})["response"]
                  if f["fixture"]["status"]["short"] in COMPLETED_STATUSES]
    actual = defaultdict(float)
    for f in actual_fix:
        apps = []
        _collect_appearances(f["fixture"]["id"], f, matcher, 1.0, apps)
        for a in apps:
            row = {"minutes": a["minutes"], "position": a["position"], "goals": a["goals"],
                   "assists": a["assists"], "conceded": a["conceded"], "saves": a["saves"],
                   "yellow_cards": a["yellow"], "red_cards": a["red"], "motm": a["motm"],
                   "penalty_saved": a["pen_saved"], "penalty_missed": a["pen_missed"],
                   "defensive_actions": a["def_actions"]}
            actual[a["player_id"]] += _points(row)

    # project per-match mu for players who actually featured, rank-correlate
    rng = np.random.default_rng(0)
    rows = []
    for pid, pts in actual.items():
        rec = records.get(pid)
        if not rec:
            continue
        team = rec["team"]
        mu, _, _ = project_player(rec, model, [t for t in model.teams if t != team][:5],
                                  priors, prior_strength, set())
        rows.append((pid, mu, pts))
    if len(rows) < 10:
        sys.exit("[backtest] too few overlapping players to validate.")
    proj = np.array([r[1] for r in rows])
    act = np.array([r[2] for r in rows])
    rho = _spearman(proj, act)
    top20_proj = {rows[i][0] for i in np.argsort(-proj)[:20]}
    top20_act = {rows[i][0] for i in np.argsort(-act)[:20]}
    print(f"[backtest] {len(rows)} players. Spearman(projected per-match, "
          f"actual total) = {rho:.3f}")
    print(f"[backtest] top-20 overlap = {len(top20_proj & top20_act)}/20")


def _points(row):
    """Same as daily_pull.calculate_points (copied)."""
    if row["minutes"] == 0:
        return 0
    pos = row["position"]
    p = row["goals"] * SCORING["goal"][pos] + row["assists"] * SCORING["assist"]
    if row["minutes"] >= 60 and row["conceded"] == 0:
        p += SCORING["clean_sheet"][pos]
    p += row["yellow_cards"] * SCORING["yellow_card"] + row["red_cards"] * SCORING["red_card"]
    if pos == "GK":
        p += (row["saves"] // 2) * SCORING["save_per_2"]
    else:
        p += (row.get("defensive_actions", 0) // 2) * SCORING["def_action_per_2"]
    if row["motm"]:
        p += SCORING["motm"]
    p += row["penalty_saved"] * SCORING["penalty_saved"]
    p += row["penalty_missed"] * SCORING["penalty_missed"]
    return p


def _spearman(a, b):
    ra = pd.Series(a).rank().to_numpy()
    rb = pd.Series(b).rank().to_numpy()
    if ra.std() == 0 or rb.std() == 0:
        return 0.0
    return float(np.corrcoef(ra, rb)[0, 1])


# ---------------------------------------------------------------------------
def load_injured_ids():
    if not INJURIES_JSON.exists():
        return set()
    try:
        data = json.loads(INJURIES_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    out = set()
    for item in data if isinstance(data, list) else []:
        pid = item.get("player_id") if isinstance(item, dict) else None
        if pid and (item.get("status") == "out"):
            out.add(pid)
    return out


def parse_leagues_override(spec):
    """--leagues "1:2022:1.0,10:2025:0.35" -> COMPETITIONS-shaped list."""
    comps = []
    for chunk in spec.split(","):
        parts = chunk.split(":")
        if len(parts) != 3:
            sys.exit(f"--leagues entry {chunk!r} must be id:season:weight")
        comps.append((f"league {parts[0]}", int(parts[0]), [int(parts[1])], float(parts[2])))
    return comps


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--managers", type=int, default=8, help="league size (VOR replacement)")
    ap.add_argument("--sims", type=int, default=10000, help="tournament Monte-Carlo runs")
    ap.add_argument("--decay", type=float, default=DEFAULT_DECAY_HALFLIFE_DAYS,
                    help="time-decay half-life in days")
    ap.add_argument("--prior-strength", type=float, default=6.0,
                    help="shrinkage pseudo-exposure (team-matches)")
    ap.add_argument("--no-friendlies", action="store_true", help="drop friendlies")
    ap.add_argument("--leagues", help="override COMPETITIONS: id:season:weight,...")
    ap.add_argument("--top", type=int, default=25, help="rows per leaderboard")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--backtest", type=int, metavar="SEASON",
                    help="validate against a past World Cup (e.g. 2022)")
    ap.add_argument("--demo", action="store_true",
                    help="run on synthetic data with no network (smoke test)")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    weigh = competition_weight(args.decay, datetime.now(timezone.utc))

    if args.demo:
        players, results, appearances, fixtures = demo_inputs(rng)
        print(f"[demo] {len(players)} players, {len(results)} results.")
    else:
        if not PLAYERS_JSON.exists():
            sys.exit("players.json not found.")
        players = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
        matcher = PlayerMatcher(players)
        comps = parse_leagues_override(args.leagues) if args.leagues else list(COMPETITIONS)
        if args.no_friendlies:
            comps = [c for c in comps if c[1] != 10]
        if args.backtest:
            run_backtest(args.backtest, matcher, players, weigh, args.sims,
                         args.managers, args.prior_strength)
            return
        print(f"[fetch] pulling {len(comps)} competition-seasons (cached) ...")
        results, appearances = fetch_dataset(comps, matcher, weigh)
        fixtures = (json.loads(FIXTURES_JSON.read_text(encoding="utf-8"))
                    if FIXTURES_JSON.exists() else [])

    if not results:
        sys.exit("No match results -- nothing to model.")
    print(f"[model] fitting Dixon-Coles on {len(results)} matches ...")
    model = TeamModel(results).fit()

    tmw = defaultdict(float)
    for r in results:
        tmw[r["home"]] += r["weight"]
        tmw[r["away"]] += r["weight"]
    records = aggregate_players(appearances, players, tmw)
    priors = position_priors(records, None)
    injured = load_injured_ids()

    teams = sorted({p["team"] for p in players})
    groups = infer_groups(fixtures, teams)
    if not groups:
        print("[warn] no group draw found in fixtures.json; assuming 3 matches each.")
        groups = [[t] for t in teams]
    print(f"[sim] simulating {len(groups)} groups x {args.sims} runs ...")
    stage_prob, matches = simulate_tournament(model, groups, args.sims, rng)

    df = build_projections(records, model, groups, stage_prob, matches, priors,
                           args.prior_strength, injured, args.managers, args.sims, rng)
    print_leaderboards(df, args.top)
    if not args.demo:
        write_outputs(df)
    else:
        print(f"\n[demo] pipeline OK -- {len(df)} projection rows produced.")


if __name__ == "__main__":
    main()
