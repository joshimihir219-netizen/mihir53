import numpy as np
import pandas as pd


STRATEGIES = {
    "Price Action Break & Retest": "price_action_retest",
    "Smart Money Structure (SMC)": "smc_order_block_retest",
    "ICT Liquidity Sweep": "ict_liquidity_sweep",
    "EMA Trend Pullback": "ema_trend_pullback",
    "Donchian Trend Breakout": "donchian_breakout",
    "VWAP Reversal": "vwap_reversal",
    "RSI Mean Reversion": "rsi_mean_reversion",
    "MACD Momentum": "macd_momentum",
    "ADX Trend Following": "adx_trend_following",
    "Bollinger Band Breakout": "bollinger_breakout",
    "Previous Day High/Low Breakout": "previous_day_breakout",
    "Volume-Based Breakout": "volume_breakout",
    "Opening Range Breakout": "opening_range_breakout",
    "Support and Resistance Reversal": "support_resistance_reversal",
    "Fair Value Gap Retracement": "fvg_retracement",
    "Order Block Mitigation": "order_block_mitigation",
    "Supertrend Trend Following": "supertrend_following",
    "ATR Volatility Breakout": "atr_volatility_breakout",
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

for strategy_name, strategy_key in STRATEGIES.items():
    if strategy_key not in STRATEGY_DETAILS:
        STRATEGY_DETAILS[strategy_key] = {
            "name": strategy_name,
            "style": "Long-only technical setup",
            "entry_rules": ["Entry conditions are evaluated on completed OHLCV candles."],
            "exit_rules": ["Exit conditions are evaluated on completed OHLCV candles."],
            "entry_reason": f"{strategy_name} entry rule triggered on the last completed candle.",
            "exit_reason": f"{strategy_name} exit rule triggered on the last completed candle.",
        }


def _custom_value_series(df, definition, cache):
    if not isinstance(definition, dict):
        raise ValueError("Each condition value must be an object.")
    indicator = str(definition.get("indicator", "")).upper()
    period = definition.get("period", 14)
    source = str(definition.get("source", "close")).lower()
    if indicator in {"OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"}:
        return pd.to_numeric(df[indicator.lower()], errors="coerce")
    if not isinstance(period, int) or not 1 <= period <= 500:
        raise ValueError("Indicator periods must be whole numbers from 1 to 500.")
    if source not in {"open", "high", "low", "close", "volume"}:
        raise ValueError("Indicator source must be an OHLCV field.")
    cache_key = (indicator, period, source)
    if cache_key in cache:
        return cache[cache_key]
    values = pd.to_numeric(df[source], errors="coerce")
    if indicator == "EMA":
        result = values.ewm(span=period, adjust=False, min_periods=period).mean()
    elif indicator == "SMA":
        result = values.rolling(period, min_periods=period).mean()
    elif indicator == "RSI":
        delta = values.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        result = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    elif indicator == "ATR":
        previous_close = pd.to_numeric(df["close"], errors="coerce").shift(1)
        true_range = pd.concat([
            pd.to_numeric(df["high"], errors="coerce") - pd.to_numeric(df["low"], errors="coerce"),
            (pd.to_numeric(df["high"], errors="coerce") - previous_close).abs(),
            (pd.to_numeric(df["low"], errors="coerce") - previous_close).abs(),
        ], axis=1).max(axis=1)
        result = true_range.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    elif indicator == "VOLUME_AVERAGE":
        result = pd.to_numeric(df["volume"], errors="coerce").rolling(period, min_periods=period).mean()
    else:
        raise ValueError(f"Unsupported custom indicator: {indicator or '(empty)'}.")
    cache[cache_key] = result
    return result


def _evaluate_custom_group(df, group, cache, depth=0):
    if depth > 8 or not isinstance(group, dict):
        raise ValueError("Condition groups must be objects nested no more than 8 levels.")
    logic = str(group.get("logic", "AND")).upper()
    conditions = group.get("conditions")
    if logic not in {"AND", "OR", "NOT"} or not isinstance(conditions, list) or not conditions or len(conditions) > 100:
        raise ValueError("Each condition group needs 1 to 100 conditions and AND, OR, or NOT logic.")
    if logic == "NOT" and len(conditions) != 1:
        raise ValueError("NOT groups must contain exactly one condition.")
    evaluated = []
    for condition in conditions:
        if isinstance(condition, dict) and "logic" in condition:
            evaluated.append(_evaluate_custom_group(df, condition, cache, depth + 1))
            continue
        if not isinstance(condition, dict):
            raise ValueError("Conditions must be objects.")
        left = _custom_value_series(df, condition.get("left"), cache)
        right_definition = condition.get("right")
        if isinstance(right_definition, dict):
            right = _custom_value_series(df, right_definition, cache)
        elif isinstance(right_definition, (int, float)) and np.isfinite(right_definition):
            right = float(right_definition)
        else:
            raise ValueError("Condition right-hand values must be finite numbers or indicator definitions.")
        operator = str(condition.get("operator", ""))
        if operator == "gt":
            result = left > right
        elif operator == "gte":
            result = left >= right
        elif operator == "lt":
            result = left < right
        elif operator == "lte":
            result = left <= right
        elif operator == "crosses_above":
            result = (left > right) & (left.shift(1) <= (right.shift(1) if isinstance(right, pd.Series) else right))
        elif operator == "crosses_below":
            result = (left < right) & (left.shift(1) >= (right.shift(1) if isinstance(right, pd.Series) else right))
        else:
            raise ValueError(f"Unsupported condition operator: {operator or '(empty)'}.")
        evaluated.append(result.fillna(False))
    if logic == "NOT":
        return ~evaluated[0]
    combined = evaluated[0].copy()
    for result in evaluated[1:]:
        combined = combined & result if logic == "AND" else combined | result
    return combined


def custom_strategy_mask(df, definition):
    required = {"open", "high", "low", "close"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Missing OHLC columns: {', '.join(sorted(missing))}")
    if not isinstance(definition, dict):
        raise ValueError("A structured strategy definition is required.")
    cache = {}
    entries = _evaluate_custom_group(df, definition.get("entry", {}), cache)
    exits = _evaluate_custom_group(df, definition.get("exit", {}), cache)
    return entries.to_numpy(dtype=bool), exits.to_numpy(dtype=bool)


def strategy_mask(df, strategy, strategy_definition=None):
    key = STRATEGIES.get(strategy, strategy)
    if key == "custom":
        if strategy_definition is None:
            raise ValueError("A saved custom strategy definition is required.")
        return custom_strategy_mask(df, strategy_definition)
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
    true_range = pd.concat([high - low, (high - previous_close).abs(), (low - previous_close).abs()], axis=1).max(axis=1)
    atr14 = true_range.rolling(14, min_periods=14).mean()
    rsi_delta = close.diff()
    rsi_gain = rsi_delta.clip(lower=0).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    rsi_loss = (-rsi_delta.clip(upper=0)).ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    rsi = 100 - 100 / (1 + rsi_gain / rsi_loss.replace(0, np.nan))

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
        atr = atr14
        bullish_fvg = low > high.shift(2)
        displacement = bullish & ((close - open_price) >= atr * 0.8) & (close > prior_short_high)
        enter = swept_recently & displacement & bullish_fvg
        exit_ = (close < previous_support) | (close < ema20)
    elif key == "ema_trend_pullback":
        uptrend = (ema20 > ema50) & (close > ema50)
        touched_ema = low.shift(1).rolling(3, min_periods=3).min() <= ema20.shift(1) * 1.003
        enter = uptrend & touched_ema & (close > ema20) & bullish
        exit_ = (close < ema20) | (ema20 < ema50)
    elif key == "donchian_breakout":
        crossed_resistance = (close > previous_high) & (previous_close <= previous_high.shift(1))
        enter = crossed_resistance & (ema20 > ema50)
        exit_ = (close < previous_support) | (ema20 < ema50)
    elif key == "vwap_reversal":
        typical = (high + low + close) / 3
        volume = pd.to_numeric(df.get("volume", pd.Series(1, index=df.index)), errors="coerce").fillna(0)
        if "time" in df:
            sessions = pd.to_datetime(df["time"]).dt.date
            cumulative_volume = volume.groupby(sessions).cumsum().replace(0, np.nan)
            vwap = (typical * volume).groupby(sessions).cumsum() / cumulative_volume
        else:
            vwap = (typical * volume).cumsum() / volume.cumsum().replace(0, np.nan)
        deviation = (close - vwap).rolling(20, min_periods=10).std()
        enter = (close < vwap - deviation) & (close > previous_close) & bullish
        exit_ = close >= vwap
    elif key == "rsi_mean_reversion":
        enter = (rsi < 30) & (rsi > rsi.shift(1)) & bullish
        exit_ = (rsi > 60) | (close > close.rolling(20, min_periods=20).mean())
    elif key == "macd_momentum":
        macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
        signal_line = macd.ewm(span=9, adjust=False).mean()
        enter = (macd > signal_line) & (macd.shift(1) <= signal_line.shift(1)) & (macd > 0)
        exit_ = (macd < signal_line) & (macd.shift(1) >= signal_line.shift(1))
    elif key == "adx_trend_following":
        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
        minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
        smoothed_tr = true_range.rolling(14, min_periods=14).mean()
        plus_di = 100 * plus_dm.rolling(14, min_periods=14).mean() / smoothed_tr.replace(0, np.nan)
        minus_di = 100 * minus_dm.rolling(14, min_periods=14).mean() / smoothed_tr.replace(0, np.nan)
        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
        adx = dx.rolling(14, min_periods=14).mean()
        enter = (adx > 25) & (plus_di > minus_di) & (close > ema20) & (plus_di.shift(1) <= minus_di.shift(1))
        exit_ = (plus_di < minus_di) | (adx < 18)
    elif key == "bollinger_breakout":
        middle = close.rolling(20, min_periods=20).mean()
        width = close.rolling(20, min_periods=20).std(ddof=0) * 2
        upper = middle + width
        enter = (close > upper) & (previous_close <= upper.shift(1))
        exit_ = (close < middle) | (close < previous_support)
    elif key in {"previous_day_breakout", "opening_range_breakout"}:
        times = pd.to_datetime(df["time"], errors="coerce") if "time" in df else None
        if times is None:
            enter = pd.Series(False, index=df.index)
            exit_ = close < ema20
        elif key == "previous_day_breakout":
            session = times.dt.date
            daily = df.assign(_session=session).groupby("_session").agg(day_high=("high", "max"), day_low=("low", "min"))
            prior_day_high = session.map(daily["day_high"].shift(1))
            prior_day_low = session.map(daily["day_low"].shift(1))
            enter = (close > prior_day_high) & (previous_close <= prior_day_high.shift(1))
            exit_ = (close < prior_day_low) | (close < ema20)
        else:
            session = times.dt.date
            session_start = times.groupby(session).transform("min")
            opening = times < session_start + pd.Timedelta(minutes=30)
            opening_high = high.where(opening).groupby(session).transform("max")
            opening_low = low.where(opening).groupby(session).transform("min")
            after_opening = ~opening
            enter = after_opening & (close > opening_high) & (previous_close <= opening_high.shift(1))
            exit_ = (close < opening_low) | (close < ema20)
    elif key == "volume_breakout":
        volume = pd.to_numeric(df.get("volume", pd.Series(np.nan, index=df.index)), errors="coerce")
        average_volume = volume.shift(1).rolling(20, min_periods=20).mean()
        crossed_resistance = (close > previous_high) & (previous_close <= previous_high.shift(1))
        enter = crossed_resistance & (volume > average_volume * 1.5)
        exit_ = (close < previous_support) | (volume < average_volume * 0.5)
    elif key == "support_resistance_reversal":
        support = low.shift(1).rolling(20, min_periods=20).min()
        enter = (low <= support * 1.002) & (close > support) & bullish
        exit_ = (close < support.shift(1)) | (close < ema20)
    elif key in {"fvg_retracement", "order_block_mitigation"}:
        entries = np.zeros(len(df), dtype=bool)
        pending_zone = None
        setup_index = -1
        if key == "fvg_retracement":
            setup = low > high.shift(2)
            for index in range(len(df)):
                if pending_zone is not None:
                    zone_low, zone_top = pending_zone
                    if index - setup_index > 10 or close.iloc[index] < zone_low:
                        pending_zone = None
                    elif index > setup_index and low.iloc[index] <= zone_top and close.iloc[index] > (zone_low + zone_top) / 2 and bullish.iloc[index]:
                        entries[index] = True
                        pending_zone = None
                if pending_zone is None and setup.iloc[index]:
                    pending_zone = (high.iloc[index - 2], low.iloc[index])
                    setup_index = index
        else:
            structure_break = (close > high.shift(1).rolling(10, min_periods=10).max()) & (previous_close <= high.shift(1).rolling(10, min_periods=10).max().shift(1)) & (close - open_price >= atr14 * 0.8)
            for index in range(len(df)):
                if pending_zone is not None:
                    zone_low, zone_top = pending_zone
                    if index - setup_index > 10 or close.iloc[index] < zone_low:
                        pending_zone = None
                    elif index > setup_index and low.iloc[index] <= zone_top and close.iloc[index] > (zone_low + zone_top) / 2 and bullish.iloc[index]:
                        entries[index] = True
                        pending_zone = None
                if pending_zone is None and structure_break.iloc[index]:
                    candidates = [candidate for candidate in range(max(0, index - 5), index) if close.iloc[candidate] < open_price.iloc[candidate]]
                    if candidates:
                        block_index = candidates[-1]
                        pending_zone = (low.iloc[block_index], open_price.iloc[block_index])
                        setup_index = index
        enter = pd.Series(entries, index=df.index)
        exit_ = (close < previous_support) | (close < ema20)
    elif key == "supertrend_following":
        midpoint = (high + low) / 2
        basic_upper = midpoint + 3 * atr14
        basic_lower = midpoint - 3 * atr14
        upper = basic_upper.to_numpy(dtype=float, copy=True)
        lower = basic_lower.to_numpy(dtype=float, copy=True)
        trend = np.zeros(len(df), dtype=bool)
        close_values = pd.to_numeric(close, errors="coerce").to_numpy(dtype=float)
        for index in range(1, len(df)):
            if not np.isfinite(upper[index - 1]) or not np.isfinite(lower[index - 1]):
                upper[index] = basic_upper.iloc[index]
                lower[index] = basic_lower.iloc[index]
                continue
            upper[index] = basic_upper.iloc[index] if basic_upper.iloc[index] < upper[index - 1] or close_values[index - 1] > upper[index - 1] else upper[index - 1]
            lower[index] = basic_lower.iloc[index] if basic_lower.iloc[index] > lower[index - 1] or close_values[index - 1] < lower[index - 1] else lower[index - 1]
            if trend[index - 1] and close_values[index] >= lower[index]:
                trend[index] = True
            elif not trend[index - 1] and close_values[index] > upper[index - 1]:
                trend[index] = True
        trend = pd.Series(trend, index=df.index)
        prior_trend = trend.shift(1).fillna(False).astype(bool)
        enter = trend & ~prior_trend
        exit_ = ~trend & prior_trend
    else:
        volatility_floor = (atr14 / close).rolling(50, min_periods=25).median()
        breakout_level = previous_high + atr14 * 0.1
        enter = (close > breakout_level) & (previous_close <= breakout_level.shift(1)) & ((atr14 / close) > volatility_floor)
        exit_ = (close < previous_support) | (close < ema20)

    entries = enter.fillna(False).to_numpy(dtype=bool, copy=True)
    exits = exit_.fillna(False).to_numpy(dtype=bool, copy=True)
    warmup_bars = min(50, len(df))
    entries[:warmup_bars] = False
    exits[:warmup_bars] = False
    return entries, exits


def run_backtest(df, initial_capital=100000, strategy="Price Action Break & Retest", position_size=1000, stop_loss_pct=1.5, fee_bps=10, start_index=0, strategy_definition=None, take_profit_rr=None):
    initial_capital = float(initial_capital)
    position_size = float(position_size)
    stop_loss_pct = max(0.0, float(stop_loss_pct))
    fee_bps = max(0.0, float(fee_bps))
    take_profit_rr = None if take_profit_rr is None else float(take_profit_rr)
    if take_profit_rr is not None and (not np.isfinite(take_profit_rr) or not 0 < take_profit_rr <= 100):
        raise ValueError("Take-profit risk multiple must be greater than 0 and at most 100.")
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
    entries, exits = strategy_mask(df, strategy, strategy_definition)
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
        high = float(row.high)
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

        if shares and not exited_this_bar and take_profit_rr and stop_loss_pct:
            target_price = entry_price * (1 + stop_loss_pct / 100 * take_profit_rr)
            if high >= target_price:
                close_position(row, max(open_price, target_price), "take_profit")
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
                exited_this_bar = True

        if shares and not exited_this_bar and take_profit_rr and stop_loss_pct:
            target_price = entry_price * (1 + stop_loss_pct / 100 * take_profit_rr)
            if high >= target_price:
                close_position(row, max(open_price, target_price), "take_profit")
                exited_this_bar = True

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
        "take_profit_rr": take_profit_rr,
        "fee_bps": fee_bps,
        "execution_model": "Signals use completed bars and execute at the next bar open; stop gaps fill at the worse observed open.",
    }
