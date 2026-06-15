#!/usr/bin/env python3
"""Unit tests for the pure pieces of build_value.py (no network needed).

    python -m unittest test_value
"""

import math
import unittest

import numpy as np

import build_value as bv


class PureFunctions(unittest.TestCase):
    def test_dc_lambdas_neutral_symmetry(self):
        # Equal-strength teams at a neutral venue -> equal expected goals.
        lf, la = bv.dc_lambdas(0.3, 0.1, 0.3, 0.1, home_adv=0.0)
        self.assertAlmostEqual(lf, la, places=9)

    def test_dc_lambdas_opponent_strength_monotonic(self):
        # Weakening the opponent's defence raises my expected goals.
        weak_def, strong_def = -0.4, 0.6
        lf_weak, _ = bv.dc_lambdas(0.2, 0.0, 0.0, weak_def, 0.0)
        lf_strong, _ = bv.dc_lambdas(0.2, 0.0, 0.0, strong_def, 0.0)
        self.assertGreater(lf_weak, lf_strong)

    def test_dc_lambdas_home_advantage(self):
        lf0, _ = bv.dc_lambdas(0.0, 0.0, 0.0, 0.0, home_adv=0.0)
        lf1, _ = bv.dc_lambdas(0.0, 0.0, 0.0, 0.0, home_adv=0.3)
        self.assertGreater(lf1, lf0)

    def test_dixon_coles_tau_cases(self):
        lam, mu, rho = 1.2, 0.9, -0.05
        self.assertAlmostEqual(bv.dixon_coles_tau(0, 0, lam, mu, rho), 1 - lam * mu * rho)
        self.assertAlmostEqual(bv.dixon_coles_tau(0, 1, lam, mu, rho), 1 + lam * rho)
        self.assertAlmostEqual(bv.dixon_coles_tau(1, 0, lam, mu, rho), 1 + mu * rho)
        self.assertAlmostEqual(bv.dixon_coles_tau(1, 1, lam, mu, rho), 1 - rho)
        self.assertEqual(bv.dixon_coles_tau(2, 3, lam, mu, rho), 1.0)

    def test_shrink_toward_prior_when_no_data(self):
        # exposure 0 -> exactly the prior rate.
        self.assertAlmostEqual(
            bv.gamma_poisson_shrink(0.0, 0.0, prior_rate=0.4, prior_strength=6.0), 0.4)

    def test_shrink_toward_observed_with_lots_of_data(self):
        # large exposure -> close to observed events/exposure (=1.0 here).
        r = bv.gamma_poisson_shrink(100000.0, 100000.0, prior_rate=0.0, prior_strength=6.0)
        self.assertAlmostEqual(r, 1.0, places=3)

    def test_shrink_is_between_prior_and_observed(self):
        prior, obs_events, obs_exp = 0.2, 8.0, 4.0  # observed rate = 2.0
        r = bv.gamma_poisson_shrink(obs_events, obs_exp, prior, prior_strength=6.0)
        self.assertGreater(r, prior)
        self.assertLess(r, obs_events / obs_exp)

    def test_poisson_zero_prob(self):
        self.assertAlmostEqual(bv.poisson_zero_prob(0.0), 1.0)
        self.assertAlmostEqual(bv.poisson_zero_prob(1.0), math.exp(-1.0))
        # stronger opponent (higher lambda against) -> lower clean-sheet prob
        self.assertGreater(bv.poisson_zero_prob(0.5), bv.poisson_zero_prob(2.0))

    def test_expected_floor_div2_nonnegative_and_increasing(self):
        self.assertEqual(bv.expected_floor_div2(0.0), 0.0)
        self.assertGreaterEqual(bv.expected_floor_div2(0.4), 0.0)
        self.assertGreater(bv.expected_floor_div2(6.0), bv.expected_floor_div2(2.0))

    def test_value_over_replacement(self):
        vals = [10.0, 7.0, 5.0, 2.0]
        vor, repl = bv.value_over_replacement(vals, replacement_rank=3)
        self.assertEqual(repl, 5.0)               # 3rd-best is replacement
        self.assertEqual(vor[0], 5.0)             # 10 - 5
        self.assertEqual(vor[2], 0.0)             # replacement himself
        self.assertEqual(vor[3], -3.0)            # below replacement


class TeamModelFit(unittest.TestCase):
    def test_recovers_strength_ordering(self):
        rng = np.random.default_rng(1)
        strengths = {"A": 0.8, "B": 0.2, "C": -0.2, "D": -0.8}
        teams = list(strengths)
        results = []
        for _ in range(40):
            for h in teams:
                for a in teams:
                    if h == a:
                        continue
                    lf = math.exp(0.2 + strengths[h] - strengths[a])
                    la = math.exp(strengths[a] - strengths[h])
                    results.append({"home": h, "away": a, "weight": 1.0,
                                    "hg": int(rng.poisson(lf)), "ag": int(rng.poisson(la))})
        model = bv.TeamModel(results).fit()
        # the strongest team should end up with the highest scalar strength
        ranked = sorted(teams, key=model.strength, reverse=True)
        self.assertEqual(ranked[0], "A")
        self.assertEqual(ranked[-1], "D")

    def test_expected_goals_uses_opponent(self):
        rng = np.random.default_rng(2)
        strengths = {"A": 0.8, "B": 0.0, "C": -0.8}
        teams = list(strengths)
        results = []
        for _ in range(60):
            for h in teams:
                for a in teams:
                    if h == a:
                        continue
                    lf = math.exp(strengths[h] - strengths[a])
                    la = math.exp(strengths[a] - strengths[h])
                    results.append({"home": h, "away": a, "weight": 1.0,
                                    "hg": int(rng.poisson(lf)), "ag": int(rng.poisson(la))})
        model = bv.TeamModel(results).fit()
        vs_weak, _ = model.expected_goals("A", "C", neutral=True)
        vs_strong, _ = model.expected_goals("A", "A", neutral=True)
        self.assertGreater(vs_weak, vs_strong)


class GroupInference(unittest.TestCase):
    def test_infer_groups_of_four(self):
        teams = [f"T{i}" for i in range(8)]
        g1, g2 = teams[:4], teams[4:]
        fixtures = []
        for g in (g1, g2):
            for i in range(4):
                for j in range(i + 1, 4):
                    fixtures.append({"home": g[i], "away": g[j]})
        groups = bv.infer_groups(fixtures, teams)
        self.assertEqual(len(groups), 2)
        self.assertTrue(all(len(g) == 4 for g in groups))
        self.assertEqual({frozenset(g) for g in groups},
                         {frozenset(g1), frozenset(g2)})

    def test_infer_groups_ignores_unknown_teams(self):
        teams = ["A", "B"]
        fixtures = [{"home": "A", "away": "B"},
                    {"home": "A", "away": "Winner Group X"}]  # placeholder ignored
        groups = bv.infer_groups(fixtures, teams)
        self.assertEqual(len(groups), 1)
        self.assertEqual(set(groups[0]), {"A", "B"})


class TeamSlotValue(unittest.TestCase):
    def test_team_value_monotonic_in_progression(self):
        deep = {"reach": {"r32": 1.0, "r16": 1.0, "qf": 1.0, "sf": 0.5,
                          "final": 0.3, "winner": 0.2}}
        shallow = {"reach": {"r32": 0.5, "r16": 0.1, "qf": 0.0, "sf": 0.0,
                             "final": 0.0, "winner": 0.0}}
        vals = bv.team_slot_value({"deep": deep["reach"], "shallow": shallow["reach"]})
        self.assertGreater(vals["deep"], vals["shallow"])


if __name__ == "__main__":
    unittest.main()
