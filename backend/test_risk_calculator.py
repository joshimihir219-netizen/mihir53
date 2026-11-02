import unittest

from risk_calculator import assess_protection, calculate_position


class RiskCalculatorTests(unittest.TestCase):
    def calculate(self, **overrides):
        values = {
            "instrument_type": "spot",
            "direction": "BUY",
            "entry_price": 100,
            "stop_price": 98,
            "target_price": 104,
            "risk_budget": 500,
            "contract_multiplier": 1,
            "quantity_step": 1,
        }
        values.update(overrides)
        return calculate_position(**values)

    def test_buy_and_sell_use_directional_stop_and_target_geometry(self):
        buy = self.calculate()
        sell = self.calculate(direction="SELL", entry_price=100, stop_price=102, target_price=96)
        self.assertEqual(buy["maximum_quantity"], 250)
        self.assertEqual(sell["maximum_quantity"], 250)
        self.assertEqual(buy["potential_profit"], 1000)
        self.assertEqual(sell["potential_profit"], 1000)

    def test_futures_multiplier_applies_contract_point_value(self):
        result = self.calculate(instrument_type="futures", contract_multiplier=10, quantity_step=1)
        self.assertEqual(result["maximum_quantity"], 25)
        self.assertEqual(result["position_value"], 25000)

    def test_options_round_down_to_configured_lot_size(self):
        result = self.calculate(instrument_type="options", quantity_step=25, risk_budget=500)
        self.assertEqual(result["maximum_quantity"], 250)
        self.assertEqual(result["lots"], 10)

    def test_quantity_rounding_never_exceeds_budget(self):
        result = self.calculate(quantity_step=3, risk_budget=20)
        self.assertEqual(result["maximum_quantity"], 9)
        self.assertLessEqual(result["potential_loss"], 20)

    def test_fees_and_slippage_reduce_quantity_and_target_profit(self):
        result = self.calculate(fee_bps=10, slippage_per_unit=0.1)
        self.assertLess(result["maximum_quantity"], 250)
        self.assertLess(result["potential_profit"], 1000)
        self.assertTrue(result["fees_and_slippage_included"])

    def test_invalid_stops_targets_and_index_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Stop-loss"):
            self.calculate(direction="BUY", stop_price=100)
        with self.assertRaisesRegex(ValueError, "Target"):
            self.calculate(direction="SELL", stop_price=102, target_price=101)
        with self.assertRaisesRegex(ValueError, "not directly tradable"):
            self.calculate(instrument_type="nifty_index")

    def test_missing_contract_specs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Quantity step"):
            self.calculate(quantity_step=0)
        with self.assertRaisesRegex(ValueError, "Contract multiplier"):
            self.calculate(contract_multiplier=0)

    def test_margin_is_only_estimated_when_configured(self):
        without_margin = self.calculate()
        with_margin = self.calculate(margin_pct=20)
        self.assertIsNone(without_margin["margin_requirement"])
        self.assertEqual(with_margin["margin_requirement"], 5000)
        with self.assertRaisesRegex(ValueError, "Margin percentage"):
            self.calculate(margin_pct=0)

    def test_available_capital_and_margin_cap_maximum_quantity(self):
        unleveraged = self.calculate(account_equity=1000, risk_budget=500)
        margined = self.calculate(account_equity=1000, risk_budget=500, margin_pct=10)
        self.assertEqual(unleveraged["maximum_quantity"], 10)
        self.assertEqual(margined["maximum_quantity"], 100)
        self.assertEqual(margined["margin_requirement"], 1000)

    def test_daily_and_overall_limits_block_proposed_risk(self):
        result = assess_protection(
            account_equity=25000,
            risk_per_trade_pct=1,
            daily_loss_limit=2,
            daily_loss_mode="percent",
            max_drawdown_pct=8,
            max_open_risk_pct=3,
            daily_net_pnl=-400,
            overall_net_pnl=-1900,
            current_open_risk=100,
            trades_today=1,
            proposed_risk=200,
        )
        self.assertEqual(result["daily_remaining"], 100)
        self.assertEqual(result["overall_remaining"], 100)
        self.assertTrue(result["blocked"])

    def test_multiple_open_positions_are_aggregated(self):
        result = assess_protection(
            account_equity=10000,
            risk_per_trade_pct=1,
            daily_loss_limit=500,
            daily_loss_mode="amount",
            max_drawdown_pct=10,
            max_open_risk_pct=3,
            daily_net_pnl=0,
            overall_net_pnl=0,
            current_open_risk=250,
            trades_today=2,
            proposed_risk=60,
        )
        self.assertEqual(result["open_risk_remaining"], 50)
        self.assertTrue(result["blocked"])
        self.assertIn("Maximum simultaneous open risk reached or exceeded.", result["reasons"])

    def test_daily_trade_count_blocks_new_trade(self):
        result = assess_protection(
            account_equity=10000,
            risk_per_trade_pct=1,
            daily_loss_limit=500,
            daily_loss_mode="amount",
            max_drawdown_pct=10,
            max_open_risk_pct=5,
            daily_net_pnl=0,
            overall_net_pnl=0,
            current_open_risk=0,
            trades_today=3,
            max_trades_per_day=3,
            proposed_risk=50,
        )
        self.assertTrue(result["blocked"])
        self.assertIn("Maximum trades per day reached.", result["reasons"])


if __name__ == "__main__":
    unittest.main()