import numpy as np
import pandas as pd


STRATEGIES = {
    "Price Action Break & Retest": "price_action_retest",
    "Smart Money Structure (SMC)": "smc_order_block_retest",
    "ICT Liquidity Sweep": "ict_liquidity_sweep",
    "EMA Trend Pullback": "ema_trend_pullback",
    "Donchian Trend Breakout": "donchian_breakout",
}

STRATEGY_DETAILS = {
    "price_action_retest": {
        "name": "Price Action Break & Retest",
        "style": "Long-only price-action setup",
        "entry_rules": [
            "A close breaks above the prior 20-bar resistance.",
            "The following bar retests that level and closes bullish above it.",
        ],
        "exit_rules": [
            "Close below the prior 10-bar support or EMA 20.",
            "Protective stop is evaluated against each bar's low.",
        ],
        "entry_reason": "Prior 20-bar resistance broke and held on a bullish retest.",
        "exit_reason": "Close fell below prior 10-bar support or EMA 20.",
    },
    "smc_order_block_retest": {
        "name": "Smart Money Structure (SMC)",
        "style": "Long-only structure and order-block setup",
        "entry_rules": [
            "A close breaks above the prior 20-bar structure high.",
            "Within 10 bars, price retests the last bearish candle's range before the break and closes bullish above its midpoint.",
        ],
        "exit_rules": [
            "Close below prior 10-bar support or EMA 20.",
            "The order-block setup expires if price closes below its low before entry.",
        ],
        "entry_reason": "Bullish structure break followed by a confirmed order-block retest.",
        "exit_reason": "Close fell below prior 10-bar support or EMA 20.",
    },
    "ict_liquidity_sweep": {
        "name": "ICT Liquidity Sweep",
        "style": "Long-only ICT-inspired setup",
        "entry_rules": [
            "Price sweeps below the prior 20-bar low and closes back above it.",
            "Within the next 4 bars, a bullish body at least 0.8 ATR(14) breaks the prior 5-bar high and leaves a three-candle fair-value gap.",
        ],
        "exit_rules": [
            "Close below prior 10-bar support or EMA 20.",
            "Protective stop is evaluated against each bar's low.",
        ],
        "entry_reason": "Sell-side liquidity sweep followed by bullish displacement and a fair-value gap.",
        "exit_reason": "Close fell below prior 10-bar support or EMA 20.",
    },
    "ema_trend_pullback": {
        "name": "EMA Trend Pullback",
        "style": "Long-only trend continuation",
        "entry_rules": [
            "EMA 20 is above EMA 50 and price is above EMA 50.",
            "A recent pullback reaches EMA 20, then closes bullish back above EMA 20.",
        ],
        "exit_rules": [
            "Close below EMA 20 or EMA 20 crosses below EMA 50.",
            "Protective stop is evaluated against each bar's low.",
        ],
        "entry_reason": "Bullish EMA trend resumed after a pullback to EMA 20.",
        "exit_reason": "Close fell below EMA 20 or EMA 20 crossed below EMA 50.",
    },
    "donchian_breakout": {
        "name": "Donchian Trend Breakout",
        "style": "Long-only volatility breakout",
        "entry_rules": [
            "A close crosses above the prior 20-bar high.",
            "EMA 20 is above EMA 50 to filter counter-trend breakouts.",
        ],
        "exit_rules": [
            "Close below the prior 10-bar low or EMA 20 crosses below EMA 50.",
            "Protective stop is evaluated against each bar's low.",
        ],
        "entry_reason": "Bullish close broke the prior 20-bar high with trend alignment.",
        "exit_reason": "Close fell below prior 10-bar support or EMA 20 crossed below EMA 50.",
    },
}


def strategy_mask(df, strategy):
    key = STRATEGIES.get(strategy, strategy)
    if key not in STRATEGY_DETAILS:
        raise ValueError(f"Unknown strategy: {strategy}")
    required = {"open", "high", "low", "close"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Missing OHLC columns: {', '.join(sorted(missing))}")

    open_price = pd.to_numeric(df["open"], errors="coerce")
    close = df["close"]
    high = df["high"]
    low = df["low"]
    previous_high = high.shift(1).rolling(20, min_periods=20).max()
    previous_low = low.shift(1).rolling(10, min_periods=10).min()
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    previous_close = close.shift(1)
    bullish = close > open_price
    previous_support = low.shift(1).rolling(10, min_periods=10).min()

    if key == "price_action_retest":
        level = previous_high.shift(1)
        broke_out = (previous_close > level) & (close.shift(2) <= level.shift(1))
        enter = broke_out & (low <= level * 1.003) & (close > level) & bullish
        exit_ = (close < previous_support) | (close < ema20)
    elif key == "smc_order_block_retest":
        prior_resistance = previous_high
        structure_break = (close > prior_resistance) & (previous_close <= prior_resistance.shift(1))
        entries = np.zeros(len(df), dtype=bool)
        pending_zone = None
        break_index = -1
        for index in range(len(df)):
            if pending_zone is not None:
                age = index - break_index
                zone_low, zone_top = pending_zone
                if age > 10 or close.iloc[index] < zone_low:
                    pending_zone = None
                elif (
                    age > 0
                    and low.iloc[index] <= zone_top
                    and close.iloc[index] >= (zone_low + zone_top) / 2
                    and bullish.iloc[index]
                ):
                    entries[index] = True
                    pending_zone = None
            if pending_zone is None and structure_break.iloc[index]:
                start = max(0, index - 5)
                bearish_indices = [
                    candidate
                    for candidate in range(start, index)
                    if close.iloc[candidate] < open_price.iloc[candidate]
                ]
                if bearish_indices:
                    block_index = bearish_indices[-1]
                    pending_zone = (low.iloc[block_index], high.iloc[block_index])
                    break_index = index
        enter = pd.Series(entries, index=df.index)
        exit_ = (close < previous_support) | (close < ema20)
    elif key == "ict_liquidity_sweep":
        prior_liquidity = low.shift(1).rolling(20, min_periods=20).min()
        swept = (low < prior_liquidity) & (close > prior_liquidity)
        swept_recently = swept.shift(1).rolling(4, min_periods=1).sum().fillna(0).gt(0)
        prior_short_high = high.shift(1).rolling(5, min_periods=5).max()
        true_range = pd.concat(
            [high - low, (high - previous_close).abs(), (low - previous_close).abs()], axis=1
        ).max(axis=1)
        atr = true_range.rolling(14, min_periods=14).mean()
        bullish_fvg = low > high.shift(2)
        displacement = bullish & ((close - open_price) >= atr * 0.8) & (close > prior_short_high)
        enter = swept_recently & displacement & bullish_fvg
        exit_ = (close < previous_support) | (close < ema20)
    elif key == "ema_trend_pullback":
        uptrend = (ema20 > ema50) & (close > ema50)
        touched_ema = low.shift(1).rolling(3, min_periods=3).min() <= ema20.shift(1) * 1.003
        enter = uptrend & touched_ema & (close > ema20) & bullish
        exit_ = (close < ema20) | (ema20 < ema50)
    else:
        crossed_resistance = (close > previous_high) & (previous_close <= previous_high.shift(1))
        enter = crossed_resistance & (ema20 > ema50)
        exit_ = (close < previous_support) | (ema20 < ema50)

    entries = enter.fillna(False).to_numpy(dtype=bool, copy=True)
    exits = exit_.fillna(False).to_numpy(dtype=bool, copy=True)
    warmup_bars = min(50, len(df))
    entries[:warmup_bars] = False
    exits[:warmup_bars] = False
    return entries, exits


def run_backtest(df, initial_capital=100000, strategy="Price Action Break & Retest", position_size=1000, stop_loss_pct=1.5, fee_bps=10, start_index=0):
    initial_capital = float(initial_capital)
    position_size = float(position_size)
    stop_loss_pct = max(0.0, float(stop_loss_pct))
    fee_bps = max(0.0, float(fee_bps))
    if initial_capital <= 0 or position_size <= 0:
        raise ValueError("Initial capital and position budget must be greater than zero.")
    if df.empty:
        raise ValueError("Backtest requires at least one candle.")
    start_index = int(start_index)
    if not 0 <= start_index < len(df):
        raise ValueError("Backtest start index must identify a candle in the data.")

    cash = initial_capital
    shares = 0.0
    entry_price = 0.0
    entry_cost = 0.0
    completed_trades = 0
    wins = 0
    closed_pnls = []
    equity = []
    trade_log = []
    entries, exits = strategy_mask(df, strategy)
    fee_rate = fee_bps / 10000

    def close_position(row, fill_price, reason):
        nonlocal cash, shares, entry_price, entry_cost, completed_trades, wins
        proceeds = shares * fill_price * (1 - fee_rate)
        pnl = proceeds - entry_cost
        cash += proceeds
        completed_trades += 1
        wins += int(pnl > 0)
        closed_pnls.append(pnl)
        trade_log.append({
            "side": "SELL",
            "time": str(row.time),
            "price": round(fill_price, 4),
            "quantity": round(shares, 6),
            "pnl": round(pnl, 2),
            "reason": reason,
        })
        shares = 0.0
        entry_price = 0.0
        entry_cost = 0.0

    for i, row in enumerate(df.itertuples(index=False)):
        if i < start_index:
            continue
        open_price = float(row.open)
        close_price = float(row.close)
        low = float(row.low)
        signal_index = i - 1
        exited_this_bar = False

        if shares and stop_loss_pct:
            stop_price = entry_price * (1 - stop_loss_pct / 100)
            if low <= stop_price:
                stop_fill = min(open_price, stop_price)
                close_position(row, stop_fill, "stop_loss")
                exited_this_bar = True

        if shares and signal_index >= 0 and exits[signal_index]:
            close_position(row, open_price, "strategy_exit_next_open")
            exited_this_bar = True

        if not shares and not exited_this_bar and signal_index >= 0 and entries[signal_index]:
            budget = min(cash, position_size)
            shares = budget / (open_price * (1 + fee_rate)) if budget else 0.0
            if shares:
                entry_price = open_price
                entry_cost = shares * open_price * (1 + fee_rate)
                cash -= entry_cost
                trade_log.append({
                    "side": "BUY",
                    "time": str(row.time),
                    "price": round(open_price, 4),
                    "quantity": round(shares, 6),
                    "pnl": None,
                    "reason": "strategy_entry_next_open",
                })

        if shares and not exited_this_bar and stop_loss_pct:
            stop_price = entry_price * (1 - stop_loss_pct / 100)
            if low <= stop_price:
                stop_fill = min(open_price, stop_price)
                close_position(row, stop_fill, "stop_loss")

        equity.append(cash + shares * close_price)

    if shares and len(df):
        row = df.iloc[-1]
        close_position(row, float(row["close"]), "end_of_period")
        if equity:
            equity[-1] = cash

    if not equity:
        equity = [initial_capital]
    peak = np.maximum.accumulate(equity)
    drawdown = (np.asarray(equity) - peak) / np.maximum(peak, 1) * 100
    final_value = float(equity[-1])
    pnl = final_value - initial_capital
    gross_profit = sum(value for value in closed_pnls if value > 0)
    gross_loss = abs(sum(value for value in closed_pnls if value < 0))
    winning_trades = [value for value in closed_pnls if value > 0]
    losing_trades = [value for value in closed_pnls if value < 0]
    avg_win = np.mean(winning_trades) if winning_trades else 0
    avg_loss = abs(np.mean(losing_trades)) if losing_trades else 0
    return {
        "initial_capital": initial_capital,
        "final_value": round(final_value, 2),
        "pnl": round(pnl, 2),
        "return_pct": round(pnl / initial_capital * 100, 2),
        "trades": completed_trades,
        "win_rate": round(wins / completed_trades * 100, 2) if completed_trades else 0,
        "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss else None,
        "average_win": round(float(avg_win), 2),
        "average_loss": round(float(avg_loss), 2),
        "expectancy": round(float(np.mean(closed_pnls)), 2) if closed_pnls else 0,
        "max_drawdown": round(abs(float(drawdown.min())) if len(drawdown) else 0, 2),
        "equity_curve": [round(float(x), 2) for x in equity],
        "equity_timestamps": [str(value) for value in df["time"].iloc[start_index:]] if "time" in df else [],
        "trade_log": trade_log,
        "strategy": strategy,
        "position_size": position_size,
        "stop_loss_pct": stop_loss_pct,
        "fee_bps": fee_bps,
        "execution_model": "Signals use completed bars and execute at the next bar open; stop gaps fill at the worse observed open.",
    }
