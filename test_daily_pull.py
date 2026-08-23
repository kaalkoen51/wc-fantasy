#!/usr/bin/env python3
"""Tests for the API-Football -> FIFA squad-list id mapping in daily_pull.

Run:
    python -m unittest test_daily_pull -v
"""

import json
import os
import unittest
from pathlib import Path

import argparse

import build_injuries
import daily_pull
import live_pull
from daily_pull import (
    PLAYERS_JSON,
    PlayerMatcher,
    build_competition_payload,
    build_stats_payload,
    extract_player_rows,
    featured,
    normalize_name,
    parse_league_ids,
    surname_key,
)

# A fully-populated match_stats source row for upsert tests.
daily_pull_ROW = {
    "player_id": "arg_10", "match_label": "Argentina vs Scotland (2026-06-15)",
    "minutes": 90, "conceded": 0, "goals": 1, "assists": 0,
    "yellow_cards": 0, "red_cards": 0, "saves": 0, "motm": True,
    "penalty_saved": 0, "penalty_missed": 0, "defensive_actions": 2,
    "home_score": 1, "away_score": 0,
}

ROSTER = [
    {"player_id": "sco_1", "name": "Angus Gunn", "position": "GK", "team": "Scotland", "team_code": "SCO"},
    {"player_id": "sco_8", "name": "Scott McTominay", "position": "MID", "team": "Scotland", "team_code": "SCO"},
    {"player_id": "kor_7", "name": "Son Heung-Min", "position": "FWD", "team": "Korea Republic", "team_code": "KOR"},
    {"player_id": "arg_10", "name": "Lionel Messi", "position": "FWD", "team": "Argentina", "team_code": "ARG"},
    {"player_id": "arg_19", "name": "Nicolás Otamendi", "position": "DEF", "team": "Argentina", "team_code": "ARG"},
    {"player_id": "bra_4", "name": "Carlos Silva", "position": "DEF", "team": "Brazil", "team_code": "BRA"},
    {"player_id": "bra_14", "name": "Eduardo Silva", "position": "MID", "team": "Brazil", "team_code": "BRA"},
]


class TestNormalize(unittest.TestCase):
    def test_accents_and_punctuation(self):
        self.assertEqual(normalize_name("N'Golo Kanté"), "n golo kante")

    def test_initials_and_case(self):
        self.assertEqual(normalize_name("S. McTominay"), "s mctominay")

    def test_surname_key_is_last_token(self):
        self.assertEqual(surname_key("Kevin De Bruyne"), "bruyne")
        self.assertEqual(surname_key("Son Heung-Min"), "min")


class TestFeatured(unittest.TestCase):
    """A player is kept if they have minutes OR any stat, so a scorer with
    API-Football's occasional minutes:null isn't dropped (the regression that
    made goals vanish for whole matchdays)."""

    def test_played_minutes(self):
        self.assertTrue(featured({"minutes": 90}))

    def test_scorer_with_blank_minutes_is_kept(self):
        self.assertTrue(featured({"minutes": 0, "goals": 1}))
        self.assertTrue(featured({"minutes": 0, "assists": 1}))
        self.assertTrue(featured({"minutes": 0, "defensive_actions": 3}))

    def test_true_non_participant_is_dropped(self):
        self.assertFalse(featured({"minutes": 0, "goals": 0, "assists": 0}))
        self.assertFalse(featured({"minutes": 0}))


class TestPlayerMatcher(unittest.TestCase):
    def setUp(self):
        self.m = PlayerMatcher(ROSTER)

    def assert_match(self, expected_id, expected_how, *args, **kwargs):
        player, how = self.m.match(*args, **kwargs)
        self.assertIsNotNone(player, f"expected a match, got reason: {how}")
        self.assertEqual(player["player_id"], expected_id)
        self.assertIn(expected_how, how)

    def test_exact_name(self):
        self.assert_match("arg_10", "exact name", "Lionel Messi", "Argentina")

    def test_abbreviated_first_name_matches_surname(self):
        self.assert_match("sco_8", "surname", "S. McTominay", "Scotland")

    def test_accented_surname(self):
        self.assert_match("arg_19", "surname", "N. Otamendi", "Argentina")

    def test_team_name_fix_applied(self):
        # API-Football says "South Korea"; players.json says "Korea Republic".
        self.assert_match("kor_7", "exact name", "Son Heung-Min", "South Korea")

    def test_fuzzy_match_on_typo(self):
        self.assert_match("arg_10", "fuzzy", "Lionel Mesi", "Argentina")

    def test_ambiguous_surname_resolved_by_shirt_number(self):
        self.assert_match(
            "bra_14", "shirt number", "E. Silva", "Brazil", shirt_number=14
        )

    def test_ambiguous_surname_resolved_by_first_initial(self):
        self.assert_match("bra_14", "first initial", "E. Silva", "Brazil")

    def test_ambiguous_surname_without_number_is_unmatched(self):
        player, reason = self.m.match("Silva", "Brazil")
        self.assertIsNone(player)
        self.assertIn("ambiguous", reason)

    def test_shirt_number_fallback_when_name_unknown(self):
        self.assert_match(
            "arg_10", "shirt number only", "Pulga", "Argentina", shirt_number=10
        )

    def test_unknown_team(self):
        player, reason = self.m.match("Lionel Messi", "Atlantis")
        self.assertIsNone(player)
        self.assertIn("not in players.json", reason)

    def test_no_match_at_all(self):
        player, reason = self.m.match("Zinedine Zidane", "Argentina")
        self.assertIsNone(player)
        self.assertEqual(reason, "no name match")


class TestExtractPlayerRows(unittest.TestCase):
    def make_fixture(self):
        return {
            "fixture": {"id": 1, "date": "2026-06-15T18:00:00+00:00"},
            "teams": {
                "home": {"id": 26, "name": "Argentina"},
                "away": {"id": 1108, "name": "Scotland"},
            },
            "goals": {"home": 2, "away": 0},
        }

    def make_teams_data(self):
        def entry(api_id, name, minutes, position, number=None):
            return {
                "player": {"id": api_id, "name": name},
                "statistics": [
                    {
                        "games": {
                            "minutes": minutes,
                            "position": position,
                            "number": number,
                            "rating": "7.0",
                        },
                        "goals": {}, "cards": {}, "penalty": {},
                        "tackles": {"total": 3, "blocks": 1, "interceptions": 2},
                    }
                ],
            }

        return [
            {
                "team": {"id": 26, "name": "Argentina"},
                "players": [
                    entry(154, "L. Messi", 90, "Attacker", 10),
                    entry(999, "Total Stranger", 12, "Midfielder"),
                ],
            },
            {
                "team": {"id": 1108, "name": "Scotland"},
                "players": [entry(284, "S. McTominay", 90, "Midfielder", 8)],
            },
        ]

    def test_goals_conceded_is_the_clubs_not_the_players(self):
        """Reported from the app: "goals conceded does not seem to be working
        properly". raw["goals.conceded"] read stat_goals["conceded"], which
        API-Football fills in for goalkeepers and leaves at 0 for everyone
        else -- so a league scoring "-1 per 2 conceded" for defenders and
        midfielders charged its keepers and nobody else.

        The legacy `conceded` column had used the team total all along, so
        this is the two halves of the same row agreeing again. Argentina 2-0
        Scotland: every Scot is charged 2, every Argentine 0.
        """
        teams = self.make_teams_data()
        # A deliberately absurd per-player figure: if the API's field ever
        # leaks back in, this fails rather than passing on a coincidence.
        teams[0]["players"][0]["statistics"][0]["goals"]["conceded"] = 99
        rows = extract_player_rows(self.make_fixture(), teams, PlayerMatcher(ROSTER))
        by_api = {r["api_player_id"]: r for r in rows}

        self.assertEqual(by_api["284"]["raw"]["goals.conceded"], 2)   # Scotland let in 2
        self.assertEqual(by_api["154"]["raw"]["goals.conceded"], 0)   # Argentina let in none
        # ...and the legacy column, which was right all along, still agrees.
        self.assertEqual(by_api["284"]["conceded"], 2)
        self.assertEqual(by_api["154"]["conceded"], 0)
        # Clean sheet is derived from the same fact and must not disagree.
        self.assertEqual(by_api["154"]["raw"]["clean_sheet"], 1)
        self.assertEqual(by_api["284"]["raw"]["clean_sheet"], 0)

    def test_rows_carry_fifa_ids_and_unmatched_is_none(self):
        rows = extract_player_rows(
            self.make_fixture(), self.make_teams_data(), PlayerMatcher(ROSTER)
        )
        by_api = {r["api_player_id"]: r for r in rows}

        self.assertEqual(by_api["154"]["player_id"], "arg_10")
        self.assertEqual(by_api["154"]["player_name"], "Lionel Messi")
        self.assertEqual(by_api["284"]["player_id"], "sco_8")
        # squad-list position wins over the API one
        self.assertEqual(by_api["284"]["position"], "MID")

        self.assertIsNone(by_api["999"]["player_id"])
        self.assertEqual(by_api["999"]["match_note"], "no name match")

        # tackles + blocks + interceptions roll up into defensive_actions
        self.assertEqual(by_api["154"]["defensive_actions"], 6)

        # official score from fixture["goals"] is stored per row
        self.assertEqual(by_api["154"]["home_score"], 2)
        self.assertEqual(by_api["154"]["away_score"], 0)
        self.assertEqual(by_api["284"]["home_score"], 2)
        self.assertEqual(by_api["284"]["away_score"], 0)

        self.assertEqual(
            by_api["154"]["match_label"],
            "Argentina vs Scotland (2026-06-15)",
        )

    def test_raw_stat_map_captured(self):
        rows = extract_player_rows(
            self.make_fixture(), self.make_teams_data(), PlayerMatcher(ROSTER))
        raw = next(r["raw"] for r in rows if r["api_player_id"] == "154")
        self.assertEqual(raw["defensive_actions"], 6)     # 3 + 1 + 2
        self.assertEqual(raw["goals.total"], 0)
        for k in ("passes.total", "passes.accuracy", "shots.on", "duels.won"):
            self.assertIn(k, raw)                          # full stat set present


class TestCompetitionMode(unittest.TestCase):
    """Scheduled competition pull: API ids (not the FIFA matcher), raw team
    names, and a competition-keyed payload."""

    def make_fixture(self):
        return {
            "fixture": {"id": 7, "date": "2026-08-15T18:00:00+00:00"},
            "teams": {"home": {"id": 33, "name": "Manchester United"},
                      "away": {"id": 40, "name": "Liverpool"}},
            "goals": {"home": 1, "away": 2},
        }

    def make_teams_data(self):
        return [{
            "team": {"id": 33, "name": "Manchester United"},
            "players": [{
                "player": {"id": 500, "name": "B. Fernandes"},
                "statistics": [{
                    "games": {"minutes": 90, "position": "Midfielder",
                              "number": 8, "rating": "7.6"},
                    "goals": {"total": 1}, "cards": {}, "penalty": {}, "tackles": {},
                }],
            }],
        }]

    def test_uses_api_ids_and_raw_team_names(self):
        rows = extract_player_rows(
            self.make_fixture(), self.make_teams_data(), None, use_api_ids=True)
        r = rows[0]
        self.assertEqual(r["player_id"], "api_500")       # API id, not a FIFA map
        self.assertEqual(r["match_note"], "api-id")
        self.assertEqual(r["position"], "MID")
        # raw API team names (no FIFA normalization) so labels match stored fixtures
        self.assertEqual(r["match_label"], "Manchester United vs Liverpool (2026-08-15)")

    def test_competition_payload_keys_by_competition(self):
        rows = extract_player_rows(
            self.make_fixture(), self.make_teams_data(), None, use_api_ids=True)
        payload = build_competition_payload(rows, "39-2024")
        self.assertEqual(payload[0]["competition_key"], "39-2024")
        self.assertEqual(payload[0]["player_id"], "api_500")
        self.assertEqual(payload[0]["goals"], 1)
        self.assertNotIn("league_id", payload[0])


class TestMultiLeague(unittest.TestCase):
    """FANTASY_LEAGUE_ID can allowlist several leagues; the same rows are
    upserted once per league, with no extra API-Football calls."""

    ROW = {
        "player_id": "arg_10", "match_label": "Argentina vs Scotland (2026-06-15)",
        "minutes": 90, "conceded": 0, "goals": 1, "assists": 0,
        "yellow_cards": 0, "red_cards": 0, "saves": 0, "motm": True,
        "penalty_saved": 0, "penalty_missed": 0, "defensive_actions": 2,
        "home_score": 1, "away_score": 0,
    }

    def test_parse_league_ids(self):
        self.assertEqual(parse_league_ids("aaa"), ["aaa"])
        self.assertEqual(parse_league_ids(" aaa , bbb ,"), ["aaa", "bbb"])
        self.assertEqual(parse_league_ids(""), [])
        self.assertEqual(parse_league_ids(None), [])

    def test_payload_fans_out_per_league(self):
        payload = build_stats_payload([self.ROW, dict(self.ROW, player_id="sco_8")],
                                      ["league-a", "league-b"])
        self.assertEqual(len(payload), 4)
        self.assertEqual(sorted({p["league_id"] for p in payload}),
                         ["league-a", "league-b"])
        # same stats in every league's copy
        for p in payload:
            if p["player_id"] == "arg_10":
                self.assertEqual(p["goals"], 1)
                self.assertTrue(p["clean_sheet"])

    def test_single_league_string_still_works(self):
        payload = build_stats_payload([self.ROW], "league-a")
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["league_id"], "league-a")

    def test_comma_string_fans_out(self):
        payload = build_stats_payload([self.ROW], "league-a,league-b")
        self.assertEqual({p["league_id"] for p in payload},
                         {"league-a", "league-b"})


class TestUpsertGracefulDegradation(unittest.TestCase):
    """An unapplied additive migration (missing optional column) must not
    kill the whole pull: the offending column is dropped and the write
    retried. Scoring never depends on these columns."""

    class FakeResp:
        def __init__(self, status_code, text=""):
            self.status_code = status_code
            self.text = text

    def setUp(self):
        os.environ["SUPABASE_URL"] = "https://example.supabase.co"
        os.environ["SUPABASE_SERVICE_KEY"] = "service-key"
        self.posts = []

    def _patch_post(self, responses):
        """Each call pops the next FakeResp; records the payload sent."""
        seq = list(responses)

        def fake_post(url, params=None, headers=None, json=None, timeout=None):
            self.posts.append(json)
            return seq.pop(0)
        return fake_post

    def test_missing_column_is_dropped_and_retried(self):
        rows = [dict(daily_pull_ROW)]
        responses = [
            self.FakeResp(400, '{"code":"PGRST204","message":'
                          '"Could not find the \'away_score\' column of '
                          "'match_stats' in the schema cache\"}"),
            self.FakeResp(400, '{"code":"PGRST204","message":'
                          '"Could not find the \'home_score\' column of '
                          "'match_stats' in the schema cache\"}"),
            self.FakeResp(201),
        ]
        orig = daily_pull.requests.post
        daily_pull.requests.post = self._patch_post(responses)
        try:
            daily_pull.upsert_match_stats(rows, ["league-a"])
        finally:
            daily_pull.requests.post = orig
        # Three attempts; the final payload has both optional cols stripped.
        self.assertEqual(len(self.posts), 3)
        final = self.posts[-1][0]
        self.assertNotIn("away_score", final)
        self.assertNotIn("home_score", final)
        self.assertEqual(final["goals"], 1)  # real stats survive

    def test_real_error_still_fails(self):
        orig = daily_pull.requests.post
        daily_pull.requests.post = self._patch_post(
            [self.FakeResp(401, '{"message":"bad key"}')])
        try:
            with self.assertRaises(SystemExit):
                daily_pull.upsert_match_stats([dict(daily_pull_ROW)], ["l"])
        finally:
            daily_pull.requests.post = orig


class TestLivePull(unittest.TestCase):
    """In-match scoring, which for a club competition never happened.

    live_pull defaulted to --league 1 (the World Cup), mapped players onto
    FIFA squad ids from players.json, and wrote to match_stats. A league
    drafted from an API-Football competition matched none of those three, so
    it got no live scoring and nothing said so: points just appeared after
    the final whistle when the twice-daily sweep ran.
    """

    def _fixture(self, fid=7, league=39):
        return {"fixture": {"id": fid, "status": {"short": "2H"},
                            "date": "2026-08-21T19:00:00+00:00"},
                "league": {"id": league, "round": "Regular Season - 2"},
                "teams": {"home": {"id": 42, "name": "Arsenal"},
                          "away": {"id": 45, "name": "Coventry"}},
                "goals": {"home": 1, "away": 0}}

    def test_a_competition_writes_api_ids_to_the_shared_table(self):
        """The whole fix in one assertion: rows keyed api_<id>, landing in
        competition_stats under the competition's own key."""
        wrote = {}
        orig = (live_pull.fetch_fixture_players, live_pull.upsert_competition_stats,
                live_pull.upsert_match_stats, live_pull.fetch_fixture_events)
        live_pull.fetch_fixture_events = lambda fid, mock=False: []
        live_pull.fetch_fixture_players = lambda fid, mock=False: [{
            "team": {"id": 42, "name": "Arsenal"},
            "players": [{"player": {"id": 276, "name": "B. Saka"},
                         "statistics": [{"games": {"minutes": 70, "rating": "7.8"},
                                         "goals": {"total": 1, "assists": None,
                                                   "conceded": 0, "saves": None},
                                         "cards": {"yellow": 0, "red": 0},
                                         "penalty": {"saved": None, "missed": None},
                                         "tackles": {"total": 2, "interceptions": 1},
                                         "duels": {"total": 3, "won": 2}}]}]}]
        live_pull.upsert_competition_stats = lambda rows, key: wrote.update(
            {"rows": rows, "key": key})
        live_pull.upsert_match_stats = lambda rows, ids: wrote.update({"legacy": True})
        try:
            t = live_pull.Target(39, 2026, "competition", key="39-2026")
            live_pull.pull_fixture(self._fixture(), t, dry_run=False)
        finally:
            (live_pull.fetch_fixture_players, live_pull.upsert_competition_stats,
             live_pull.upsert_match_stats, live_pull.fetch_fixture_events) = orig

        self.assertEqual(wrote.get("key"), "39-2026")
        self.assertNotIn("legacy", wrote, "a competition wrote to match_stats")
        self.assertEqual([r["player_id"] for r in wrote["rows"]], ["api_276"])
        # Scored on the way in, the same as the sweep that later replaces it,
        # so a live row and a swept row differ by nothing.
        self.assertIn("points", wrote["rows"][0])

    def test_one_api_call_covers_every_competition_watched(self):
        """This loop wakes every fifteen minutes all season, so watching three
        competitions must not cost three times as much as watching one."""
        calls = []
        orig = live_pull.api_get
        live_pull.api_get = lambda path, params: (calls.append((path, params)) or {
            "response": [self._fixture(1, 39), self._fixture(2, 140),
                         self._fixture(3, 78)]})
        try:
            # Four competitions. A per-competition implementation makes four
            # calls here; this must make one however long the list gets.
            by_league = live_pull.fetch_live_fixtures([39, 140, 135, 61])
        finally:
            live_pull.api_get = orig
        self.assertEqual(len(calls), 1,
                         f"{len(calls)} calls for 4 competitions — should be 1")
        self.assertEqual(sorted(by_league), [39, 61, 135, 140])
        self.assertEqual([f["fixture"]["id"] for f in by_league[39]], [1])
        self.assertEqual([f["fixture"]["id"] for f in by_league[140]], [2])
        # A live game in a competition nobody drafted from is not our business.
        self.assertNotIn(78, by_league)

    def test_the_static_pool_still_writes_where_it_always_did(self):
        wrote = {}
        orig = (live_pull.fetch_fixture_players, live_pull.upsert_match_stats,
                live_pull.upsert_competition_stats, live_pull.fetch_fixture_events)
        live_pull.fetch_fixture_players = lambda fid, mock=False: []
        live_pull.fetch_fixture_events = lambda fid, mock=False: []
        live_pull.upsert_match_stats = lambda rows, ids: wrote.update({"ids": ids})
        live_pull.upsert_competition_stats = lambda rows, key: wrote.update(
            {"competition": True})
        try:
            matcher = PlayerMatcher([{"player_id": "arg_10", "name": "Lionel Messi",
                                      "team": "Argentina"}])
            t = live_pull.Target(1, 2026, "legacy", matcher=matcher,
                                 league_ids=["lg-1"])
            # No players in the payload, so nothing is written -- what is being
            # checked is that it did not take the competition branch.
            live_pull.pull_fixture(self._fixture(league=1), t, dry_run=False)
        finally:
            (live_pull.fetch_fixture_players, live_pull.upsert_match_stats,
             live_pull.upsert_competition_stats, live_pull.fetch_fixture_events) = orig
        self.assertNotIn("competition", wrote)

    def test_targets_come_from_the_admin_toggle(self):
        """The same switch the twice-daily sweep reads, rather than a second
        list somebody has to remember to keep in step."""
        orig = live_pull.fetch_scheduled_competitions
        live_pull.fetch_scheduled_competitions = lambda: [
            "39-2026", "140-2026", "rugby-1068-202501", "nonsense"]
        os.environ.pop("FANTASY_LEAGUE_ID", None)
        try:
            args = argparse.Namespace(no_competitions=False, league=1, season=2026)
            targets = live_pull.build_targets(args)
        finally:
            live_pull.fetch_scheduled_competitions = orig
        self.assertEqual([t.key for t in targets], ["39-2026", "140-2026"])
        self.assertTrue(all(t.kind == "competition" for t in targets))

    def test_a_rugby_competition_is_skipped_not_crashed_on(self):
        # It is not malformed, it is simply served by a different feed.
        self.assertIsNone(daily_pull.parse_competition_key("rugby-1068-202501"))
        self.assertEqual(daily_pull.parse_competition_key("39-2026"), (39, 2026))
        # A key of an unexpected shape is refused rather than guessed at. Both
        # halves of the guard earn their place: the try/except turns away
        # "rugby-...", and only the length check turns away this one.
        self.assertIsNone(daily_pull.parse_competition_key("39-2026-2"))
        self.assertIsNone(daily_pull.parse_competition_key(""))
        self.assertIsNone(daily_pull.parse_competition_key(None))

    def test_nothing_to_watch_is_not_a_failure(self):
        """The watchdog fires every fifteen minutes; exiting red when there is
        nothing to do would be ninety-six failure mails a day."""
        orig = live_pull.fetch_scheduled_competitions
        live_pull.fetch_scheduled_competitions = lambda: []
        os.environ.pop("FANTASY_LEAGUE_ID", None)
        try:
            args = argparse.Namespace(no_competitions=False, league=1, season=2026)
            self.assertEqual(live_pull.build_targets(args), [])
        finally:
            live_pull.fetch_scheduled_competitions = orig


class TestOnPitchConceded(unittest.TestCase):
    """Goals conceded while on the pitch, against the shared case table.

    The cases live in test/fixtures/on_pitch.json and are read by the
    JavaScript suite too. Two writers implement this rule, and a stat two
    writers disagree about is the exact bug it replaces -- so they get one
    specification rather than two copies of it that drift the first time
    somebody fixes only one.
    """

    @classmethod
    def setUpClass(cls):
        path = Path(__file__).parent / "test" / "fixtures" / "on_pitch.json"
        cls.spec = json.loads(path.read_text(encoding="utf-8"))

    def _events(self, case):
        """The case table's shorthand -> the shape API-Football actually sends."""
        out = []
        # "swap" builds the same substitution with the feed's two fields the
        # other way round. Nothing may read differently because of it.
        swap = case.get("swap")
        # "og_swap" files an own goal under the OTHER side, which is the
        # second thing the feed might do and the second thing nothing may
        # depend on.
        og_swap = case.get("og_swap")
        other = {case["home"]: case["away"], case["away"]: case["home"]}
        for e in case["events"]:
            on, off = e.get("on"), e.get("off")
            if swap:
                on, off = off, on
            team = e.get("team")
            if og_swap and "own goal" in str(e.get("detail", "")).lower():
                team = other.get(team, team)
            out.append({
                "type": e["type"],
                "detail": e.get("detail"),
                "time": {"elapsed": e.get("minute"), "extra": e.get("extra")},
                "team": {"id": team},
                "player": {"id": e.get("player", on)},
                "assist": {"id": off},
            })
        return out

    def _run(self, case):
        norm = daily_pull.normalise_events(self._events(case))
        home, away = case["home"], case["away"]
        for p in case["players"]:
            with self.subTest(case=case.get("name", "?"), player=p["id"]):
                window = daily_pull.on_pitch_window(
                    p["id"], norm, not p["substitute"]) if case["events"] else None
                self.assertEqual(
                    list(window) if window else None, p["expect"]["window"],
                    "on-pitch window")
                mins = daily_pull.conceded_minutes(
                    norm, p["team"], home, away,
                    case["score"]["home"], case["score"]["away"])
                on = daily_pull.conceded_while_on(window, mins)
                club = (case["score"]["away"] if p["team"] == home
                        else case["score"]["home"])
                conceded = on if on is not None else club
                self.assertEqual(conceded, p["expect"]["conceded"], "goals conceded")
                clean = 1 if (p["minutes"] >= 60 and conceded == 0) else 0
                self.assertEqual(clean, p["expect"]["clean_sheet"], "clean sheet")

    def test_every_case_in_the_shared_table(self):
        self.assertGreaterEqual(len(self.spec["cases"]), 10,
                                "the shared case table has shrunk")
        for case in self.spec["cases"]:
            self._run(case)

    def test_a_goalless_match_never_pays_for_the_extra_call(self):
        """The whole of this rule's cost control, and the easy thing to lose
        in a later refactor: nobody has conceded, so no on-pitch window can
        change a number, so the call is not made. It can never be wrong in
        the expensive direction -- a 0-0 that turns out to have had a goal is
        not a thing."""
        self.assertFalse(daily_pull.scored_in({"goals": {"home": 0, "away": 0}}))
        self.assertFalse(daily_pull.scored_in({"goals": {"home": None, "away": None}}))
        self.assertFalse(daily_pull.scored_in({}))
        self.assertTrue(daily_pull.scored_in({"goals": {"home": 1, "away": 0}}))
        self.assertTrue(daily_pull.scored_in({"goals": {"home": 0, "away": 3}}))

    def test_an_events_call_that_fails_degrades_instead_of_dying(self):
        """A pull that died because one optional call failed would lose the
        other twenty stats with it. Note SystemExit is deliberately NOT
        caught: a missing API key is a configuration error, not a feed
        wobble, and should stop the run rather than quietly score it wrong."""
        orig = daily_pull.api_get

        def boom(path, params):
            raise RuntimeError("503 from the feed")

        daily_pull.api_get = boom
        try:
            self.assertEqual(daily_pull.fetch_fixture_events(1), [])
        finally:
            daily_pull.api_get = orig

    def test_a_player_the_events_cannot_place_gets_the_clubs_total(self):
        self._run(self.spec["unplaceable"])

    def test_no_events_at_all_is_the_old_behaviour_for_everyone(self):
        self._run(self.spec["no_events"])

    def test_the_window_rule_tiles_across_a_substitution(self):
        """No goal is counted twice and none is dropped. Asserted over the
        whole table rather than one case, because 'start < m <= end' is the
        kind of boundary that is right in the example it was written for and
        wrong one minute either side of it."""
        for case in self.spec["cases"]:
            norm = daily_pull.normalise_events(self._events(case))
            home, away = case["home"], case["away"]
            for team in (home, away):
                mins = daily_pull.conceded_minutes(norm, team, home, away)
                for m in mins:
                    # Each side of every substitution: exactly one window owns it.
                    for e in norm:
                        if e["kind"] != "subst":
                            continue
                        won = daily_pull.on_pitch_window(e["on"], norm, False)
                        woff = daily_pull.on_pitch_window(e["off"], norm, True)
                        if not won or not woff:
                            continue
                        owns = sum([
                            1 if won[0] < m <= won[1] else 0,
                            1 if woff[0] < m <= woff[1] else 0,
                        ])
                        self.assertLessEqual(
                            owns, 1,
                            f"goal at {m}' charged to both sides of the {e['minute']}' change")


class TestWatcherStaleness(unittest.TestCase):
    """A long-running watcher must not outlive the code it was started on.

    The failure this guards against was watched happening: a run that began
    before a fix was merged kept writing the old behaviour for over an hour,
    while three runs carrying the fix were cancelled queueing behind it on
    the workflow's concurrency group. Everything looked shipped and nothing
    was running.

    Every branch here decides whether the loop keeps going, and getting any
    of them backwards is either a watcher that never updates or one that
    quits constantly, so each is pinned rather than trusted to the shape of
    the expression.
    """

    def _with_head(self, head):
        orig = live_pull.origin_head_sha
        live_pull.origin_head_sha = lambda: head
        self.addCleanup(lambda: setattr(live_pull, "origin_head_sha", orig))

    def test_a_newer_commit_stops_the_loop(self):
        self._with_head("bbbb222")
        self.assertTrue(live_pull.code_has_moved("aaaa111"))

    def test_the_same_commit_keeps_it_going(self):
        self._with_head("aaaa111")
        self.assertFalse(live_pull.code_has_moved("aaaa111"))

    def test_a_run_that_does_not_know_its_own_commit_never_stops(self):
        """No GITHUB_SHA means a local or manual run, which is not behind
        anything and should not be asking the network whether it is."""
        called = []
        self._with_head(None)                       # registers the restore first
        live_pull.origin_head_sha = lambda: called.append(1) or "bbbb222"
        self.assertFalse(live_pull.code_has_moved(None))
        self.assertFalse(live_pull.code_has_moved(""))
        self.assertEqual(called, [], "it asked the network with nothing to compare")

    def test_an_unanswerable_question_keeps_it_going(self):
        """No git, no network, no remote. A watchdog that stops because it
        could not ask an optional question is worse than one that carries on
        -- the daily sweep reconciles either way, but a dead loop scores
        nothing at all."""
        self._with_head(None)
        self.assertFalse(live_pull.code_has_moved("aaaa111"))

    def test_git_failure_modes_all_answer_none(self):
        import subprocess as sp
        cases = {
            "non-zero exit": sp.CompletedProcess([], 128, "", "fatal: no remote"),
            "empty output": sp.CompletedProcess([], 0, "", ""),
            "whitespace only": sp.CompletedProcess([], 0, "\n\n", ""),
        }
        for name, result in cases.items():
            with self.subTest(name):
                orig = sp.run
                sp.run = lambda *a, **k: result
                try:
                    self.assertIsNone(live_pull.origin_head_sha())
                finally:
                    sp.run = orig

    def test_a_real_ls_remote_line_is_parsed(self):
        import subprocess as sp
        orig = sp.run
        sp.run = lambda *a, **k: sp.CompletedProcess(
            [], 0, "ef660b9c1d\tHEAD\nff11223344\trefs/heads/other\n", "")
        try:
            self.assertEqual(live_pull.origin_head_sha(), "ef660b9c1d")
        finally:
            sp.run = orig

    def test_a_thrown_exception_is_not_fatal(self):
        import subprocess as sp
        orig = sp.run

        def boom(*a, **k):
            raise OSError("git not found")

        sp.run = boom
        try:
            self.assertIsNone(live_pull.origin_head_sha())
        finally:
            sp.run = orig


class TestInjuriesFeed(unittest.TestCase):
    """The injury badge feed, which was invisible for every non-World-Cup league.

    A league built from an API-Football competition keys its pool on the API's
    own player id ("api_276"); the static World Cup pool keys on FIFA squad
    ids ("mex_9"). The builder only ever emitted the second, so nothing it
    wrote could match a Premier League squad.
    """

    def test_api_id_is_always_emitted(self):
        ids, why = build_injuries.ids_for({"id": 276, "name": "Someone"}, "Arsenal", None)
        self.assertEqual(ids, ["api_276"])
        self.assertIsNone(why)

    def test_both_id_spaces_when_a_matcher_is_supplied(self):
        matcher = PlayerMatcher([
            {"player_id": "arg_10", "name": "Lionel Messi", "team": "Argentina"},
        ])
        ids, why = build_injuries.ids_for(
            {"id": 154, "name": "L. Messi"}, "Argentina", matcher)
        # Both, so one file serves an API-backed league and the static pool
        # alike -- an id nobody recognises is simply inert.
        self.assertEqual(ids, ["api_154", "arg_10"])
        self.assertIsNone(why)

    def test_an_unmatched_name_still_keeps_its_api_id(self):
        matcher = PlayerMatcher([
            {"player_id": "arg_10", "name": "Lionel Messi", "team": "Argentina"},
        ])
        ids, why = build_injuries.ids_for(
            {"id": 999, "name": "Nobody At All"}, "Narnia", matcher)
        self.assertEqual(ids, ["api_999"])
        self.assertTrue(why, "an unmatched name should say why")

    def test_a_player_with_no_api_id_and_no_match_yields_nothing(self):
        ids, why = build_injuries.ids_for({"name": "Ghost"}, "Arsenal", None)
        self.assertEqual(ids, [])

    def test_status_from_player_type(self):
        self.assertEqual(build_injuries.injury_status("Missing Fixture"), "out")
        self.assertEqual(build_injuries.injury_status("Questionable"), "doubtful")
        self.assertEqual(build_injuries.injury_status(None), "doubtful")

    def test_stale_reports_are_dropped(self):
        """The app expires on `as_of`, which is always today. Over a 38-week
        season that meant a September hamstring was still being reported in
        May, so the freshness test has to happen here."""
        today = "2026-09-14"
        self.assertTrue(build_injuries.is_current("2026-09-10", today))
        self.assertTrue(build_injuries.is_current("2026-09-04", today))   # window edge
        self.assertFalse(build_injuries.is_current("2026-09-03", today))
        self.assertFalse(build_injuries.is_current("2026-03-01", today))
        # A future fixture the player is flagged to miss is the best case there
        # is, and an empty date comes from the current-state `injured` flag.
        self.assertTrue(build_injuries.is_current("2026-10-01", today))
        self.assertTrue(build_injuries.is_current("", today))

    def test_out_beats_doubtful_and_recent_beats_old(self):
        doubtful = {"status": "doubtful", "fixture_date": "2026-09-20"}
        out_old = {"status": "out", "fixture_date": "2026-09-01"}
        out_new = {"status": "out", "fixture_date": "2026-09-20"}
        self.assertTrue(build_injuries.better(None, doubtful))
        # The stronger claim wins even though its fixture is older.
        self.assertTrue(build_injuries.better(doubtful, out_old))
        self.assertFalse(build_injuries.better(out_old, doubtful))
        self.assertTrue(build_injuries.better(out_old, out_new))
        self.assertFalse(build_injuries.better(out_new, out_old))

    def test_competitions_parse(self):
        self.assertEqual(build_injuries.parse_competitions("39:2026,1:2026"),
                         [(39, 2026), (1, 2026)])
        self.assertEqual(build_injuries.parse_competitions(" 39:2026 , "),
                         [(39, 2026)])
        self.assertEqual(build_injuries.parse_competitions(""), [])

    def test_collect_files_a_club_report_under_the_pool_id_the_app_uses(self):
        """The whole path, with the network stubbed: a Premier League injury
        has to come out keyed `api_<id>`, because that is what
        parseSquadPlayer writes into the pool."""
        pages = {
            ("teams", 39): {"response": [{"team": {"id": 42, "name": "Arsenal"}}]},
            ("injuries", 39): {"response": [{
                "fixture": {"date": "2026-09-18T14:00:00+00:00"},
                "team": {"id": 42, "name": "Arsenal"},
                "player": {"id": 276, "name": "Bukayo Saka",
                           "type": "Missing Fixture", "reason": "Knee Injury"},
            }]},
            ("injuries", 42): {"response": []},
            ("players", 42): {"response": [
                {"player": {"id": 1485, "name": "Someone Else", "injured": True}},
                {"player": {"id": 9999, "name": "Fit Player", "injured": False}},
            ], "paging": {"current": 1, "total": 1}},
        }

        def fake_get(path, params):
            key = (path, params.get("league") or params.get("team"))
            return pages.get(key, {"response": [], "paging": {"total": 1}})

        orig = build_injuries.api_get
        build_injuries.api_get = fake_get
        try:
            best, log = {}, []
            build_injuries.collect(39, 2026, "2026-09-14", None, best, log)
        finally:
            build_injuries.api_get = orig

        self.assertEqual(sorted(best), ["api_1485", "api_276"])
        self.assertEqual(best["api_276"]["status"], "out")
        self.assertEqual(best["api_276"]["reason"], "Knee Injury")
        self.assertEqual(best["api_276"]["fixture_date"], "2026-09-18")
        self.assertEqual(best["api_276"]["as_of"], "2026-09-14")
        # The `injured` flag carries no fixture, and a fit player carries none
        # of this at all.
        self.assertEqual(best["api_1485"]["fixture_date"], "")
        self.assertNotIn("api_9999", best)

    def test_collect_drops_a_report_about_an_old_fixture(self):
        """Over a 38-week season this is the difference between a badge and a
        lie: the app expires on `as_of`, which is always today."""
        pages = {
            ("teams", 39): {"response": []},
            ("injuries", 39): {"response": [{
                "fixture": {"date": "2026-03-01T14:00:00+00:00"},
                "team": {"id": 42, "name": "Arsenal"},
                "player": {"id": 276, "name": "Bukayo Saka", "type": "Missing Fixture"},
            }]},
        }
        orig = build_injuries.api_get
        build_injuries.api_get = lambda path, params: pages.get(
            (path, params.get("league") or params.get("team")),
            {"response": [], "paging": {"total": 1}})
        try:
            best, log = {}, []
            build_injuries.collect(39, 2026, "2026-09-14", None, best, log)
        finally:
            build_injuries.api_get = orig
        self.assertEqual(best, {})
        self.assertTrue(any("too old" in line for line in log))

    def test_the_shipped_file_carries_ids_the_app_can_look_up(self):
        """A guard against the whole failure mode: a file none of whose ids
        belong to any live league is indistinguishable from no file at all."""
        path = PLAYERS_JSON.parent / "injuries.json"
        if not path.exists():
            self.skipTest("no injuries.json in the tree")
        rows = json.loads(path.read_text(encoding="utf-8"))
        for r in rows:
            self.assertTrue(r["player_id"].startswith("api_") or "_" in r["player_id"],
                            f"unrecognisable id shape: {r['player_id']}")
            self.assertIn(r["status"], ("out", "doubtful"))


class TestRealPlayersJson(unittest.TestCase):
    """Smoke test against the actual players.json shipped with the app."""

    def test_every_player_matches_itself(self):
        players = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
        matcher = PlayerMatcher(players)
        failures = []
        for p in players:
            shirt = int(p["player_id"].rsplit("_", 1)[-1])
            matched, how = matcher.match(p["name"], p["team"], shirt)
            if not matched or matched["player_id"] != p["player_id"]:
                failures.append(f"{p['player_id']} {p['name']}: {how}")
        self.assertEqual(failures, [], "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
