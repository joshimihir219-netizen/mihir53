import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from backtest import STRATEGIES, STRATEGY_DETAILS, run_backtest, strategy_mask
import market_data
from ml_engine import generate_signal


def candles(open_prices, high_prices, low_prices, close_prices):
    return pd.DataFrame({
        "time": pd.date_range("2025-01-01", periods=len(open_prices), freq="D"),
        "open": open_prices,
        "high": high_prices,
        "low": low_prices,
        "close": close_prices,
    })


class BacktestExecutionTests(unittest.TestCase):
    def test_entry_signal_executes_at_next_open(self):
        frame = candles([10, 10, 20, 21], [11, 12, 22, 22], [9, 10, 19, 20], [10, 11, 21, 21])
        entries = np.array([False, True, False, False])
        exits = np.zeros(4, dtype=bool)

        with patch("backtest.strategy_mask", return_value=(entries, exits)):
            result = run_backtest(frame, 10000, "test", 1000, 0, 0)

        entry = result["trade_log"][0]
        self.assertEqual(entry["time"], str(frame.time.iloc[2]))
        self.assertEqual(entry["price"], 20)
        self.assertEqual(result["pnl"], 50)

    def test_stop_gap_fills_at_worse_open(self):
        frame = candles(
            [10, 10, 10, 8.5, 9],
            [11, 12, 11, 9, 10],
            [9, 10, 9.5, 8, 8.8],
            [10, 11, 10.5, 8.8, 9.5],
        )
        entries = np.array([False, True, False, False, False])
        exits = np.zeros(5, dtype=bool)

        with patch("backtest.strategy_mask", return_value=(entries, exits)):
            result = run_backtest(frame, 10000, "test", 1000, 10, 0)

        stop = result["trade_log"][1]
        self.assertEqual(stop["reason"], "stop_loss")
        self.assertEqual(stop["price"], 8.5)
        self.assertEqual(stop["pnl"], -150)

    def test_signal_on_last_candle_does_not_create_fill(self):
        frame = candles([10, 10], [11, 12], [9, 10], [10, 11])
        entries = np.array([False, True])
        exits = np.zeros(2, dtype=bool)

        with patch("backtest.strategy_mask", return_value=(entries, exits)):
            result = run_backtest(frame, 10000, "test", 1000, 0, 0)

        self.assertEqual(result["trades"], 0)
        self.assertEqual(result["trade_log"], [])
        self.assertEqual(result["final_value"], 10000)

    def test_stop_takes_priority_over_strategy_exit(self):
        frame = candles(
            [10, 10, 10, 8.5, 9],
            [11, 12, 11, 9, 10],
            [9, 10, 9.5, 8, 8.8],
            [10, 11, 10.5, 8.8, 9.5],
        )
        entries = np.array([False, True, False, False, False])
        exits = np.array([False, False, True, False, False])

        with patch("backtest.strategy_mask", return_value=(entries, exits)):
            result = run_backtest(frame, 10000, "test", 1000, 10, 0)

        stop = result["trade_log"][1]
        self.assertEqual(stop["reason"], "stop_loss")
        self.assertEqual(stop["price"], 8.5)

    def test_preperiod_signal_can_fill_first_test_bar_without_scoring_warmup(self):
        frame = candles([10, 10, 20, 21], [11, 12, 22, 22], [9, 10, 19, 20], [10, 11, 21, 21])
        entries = np.array([False, True, False, False])
        exits = np.zeros(4, dtype=bool)

        with patch("backtest.strategy_mask", return_value=(entries, exits)):
            result = run_backtest(frame, 10000, "test", 1000, 0, 0, start_index=2)

        self.assertEqual(result["trade_log"][0]["time"], str(frame.time.iloc[2]))
        self.assertEqual(result["equity_timestamps"], [str(value) for value in frame.time.iloc[2:]])
        self.assertEqual(len(result["equity_curve"]), 2)


class StrategyRuleTests(unittest.TestCase):
    def test_each_strategy_has_executable_documented_rules(self):
        self.assertEqual(set(STRATEGIES.values()), set(STRATEGY_DETAILS))
        frame = candles(
            [100 + index * 0.1 for index in range(80)],
            [101 + index * 0.1 for index in range(80)],
            [99 + index * 0.1 for index in range(80)],
            [100.5 + index * 0.1 for index in range(80)],
        )
        for rule in STRATEGIES.values():
            entries, exits = strategy_mask(frame, rule)
            self.assertEqual(len(entries), len(frame))
            self.assertEqual(len(exits), len(frame))
            self.assertTrue(all(isinstance(value, (bool, np.bool_)) for value in entries))
            self.assertTrue(all(isinstance(value, str) for value in STRATEGY_DETAILS[rule]["entry_rules"]))

    def test_strategy_mask_does_not_use_future_candles(self):
        rng = np.random.default_rng(42)
        close = 100 * np.cumprod(1 + rng.normal(0.001, 0.015, 240))
        frame = pd.DataFrame({
            "time": pd.date_range("2025-01-01", periods=len(close), freq="h"),
            "open": close * (1 + rng.normal(0, 0.003, len(close))),
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
        })
        split = 180

        for rule in STRATEGIES.values():
            full = strategy_mask(frame, rule)
            prefix = strategy_mask(frame.iloc[:split], rule)
            np.testing.assert_array_equal(full[0][:split], prefix[0])
            np.testing.assert_array_equal(full[1][:split], prefix[1])


class MarketDataAndSignalTests(unittest.TestCase):
    def setUp(self):
        self.original_yfinance = market_data.yf
        market_data.yf = None
        market_data._cache.clear()

    def tearDown(self):
        market_data.yf = self.original_yfinance
        market_data._cache.clear()

    def test_cached_demo_candles_keep_synthetic_provenance(self):
        _, first_is_live = market_data.market_frame("NIFTY 50", 8, True, "5m")
        _, cached_is_live = market_data.market_frame("NIFTY 50", 8, True, "5m")

        self.assertFalse(first_is_live)
        self.assertFalse(cached_is_live)

    def test_signal_levels_only_exist_for_entry_setup(self):
        frame = candles(
            [100 + index * 0.1 for index in range(20)],
            [101 + index * 0.1 for index in range(20)],
            [99 + index * 0.1 for index in range(20)],
            [100.5 + index * 0.1 for index in range(20)],
        )
        entry = np.zeros(len(frame), dtype=bool)
        exit_ = np.zeros(len(frame), dtype=bool)

        with patch("ml_engine.strategy_mask", return_value=(entry, exit_)):
            wait_signal = generate_signal(frame, "Price Action Break & Retest")
        self.assertEqual(wait_signal["signal"], "HOLD")
        self.assertIsNone(wait_signal["entry_price"])
        self.assertIsNone(wait_signal["target_price"])
        self.assertNotIn("confidence", wait_signal)

        entry[-1] = True
        with patch("ml_engine.strategy_mask", return_value=(entry, exit_)):
            buy_signal = generate_signal(frame, "Price Action Break & Retest")
        self.assertEqual(buy_signal["signal"], "BUY")
        self.assertEqual(buy_signal["risk_reward"], 2.0)
        self.assertGreater(buy_signal["entry_price"], buy_signal["stop_loss"])
        self.assertGreater(buy_signal["target_price"], buy_signal["entry_price"])


if __name__ == "__main__":
    unittest.main()