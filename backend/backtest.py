import numpy as np
import pandas as pd


STRATEGIES = {
    "Opening Range Breakout": "opening_range_breakout",
    "VWAP Pullback": "vwap_pullback",
    "EMA Trend Pullback": "ema_trend_pullback",
    "Donchian Breakout": "donchian_breakout",
    "Bollinger Reversal": "bollinger_reversal",
}


def strategy_mask(df, strategy):
    key = STRATEGIES.get(strategy, strategy)
    close = df["close"]
    high = df["high"]
    low = df["low"]
    raw_volume = df["volume"].clip(lower=0)
    volume = raw_volume.clip(lower=1)
    sma = close.rolling(20).mean()
    rsi = df["rsi"]
    macd = df["macd"]
    macd_signal = df["signal_line"]
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    if key == "opening_range_breakout":
        local = pd.to_datetime(df["time"], utc=True).dt.tz_convert("Asia/Kolkata")
        session = local.dt.strftime("%Y-%m-%d")
        minute = local.dt.hour * 60 + local.dt.minute
        opening = (minute >= 555) & (minute < 570)
        range_high = high.where(opening).groupby(session).transform("max")
        range_low = low.where(opening).groupby(session).transform("min")
        average_volume = volume.rolling(20, min_periods=5).mean()
        range_expansion = (high - low) >= (high - low).rolling(20, min_periods=5).mean() * 1.2
        volume_ok = ((average_volume > 1) & (volume >= average_volume * 1.2)) | ((average_volume <= 1) & range_expansion)
        enter = (minute >= 570) & (close > range_high) & volume_ok
        exit_ = (close < range_low) | (close < ema20)
    elif key == "vwap_pullback":
        local = pd.to_datetime(df["time"], utc=True).dt.tz_convert("Asia/Kolkata")
        session = local.dt.strftime("%Y-%m-%d")
        typical = (high + low + close) / 3
        pv = typical * volume
        vwap = pv.groupby(session).cumsum() / volume.groupby(session).cumsum()
        has_real_volume = raw_volume.groupby(session).transform("sum") > 1
        uptrend = (ema20 > ema50) & (close > ema50)
        touched = (low.shift(1) <= vwap.shift(1) * 1.002) | (close.shift(1) <= vwap.shift(1))
        enter = has_real_volume & uptrend & touched & (close > vwap) & (close > df["open"])
        exit_ = (close < vwap) | (ema20 < ema50)
    elif key == "ema_trend_pullback":
        uptrend = (ema20 > ema50) & (ema50 > ema50.shift(5))
        pulled_back = (low.shift(1).rolling(3).min() <= ema20.shift(1) * 1.005)
        enter = uptrend & pulled_back & (close > ema20) & (macd > macd_signal) & (rsi < 70)
        exit_ = (close < ema20) | (ema20 < ema50)
    elif key == "donchian_breakout":
        prior_high = high.shift(1).rolling(20).max()
        prior_low = low.shift(1).rolling(10).min()
        average_volume = volume.rolling(20, min_periods=10).mean()
        range_expansion = (high - low) >= (high - low).rolling(20, min_periods=10).mean() * 1.2
        volume_ok = ((average_volume > 1) & (volume >= average_volume * 1.2)) | ((average_volume <= 1) & range_expansion)
        enter = (close > prior_high) & volume_ok & (ema20 > ema50)
        exit_ = (close < prior_low) | (ema20 < ema50)
    elif key == "bollinger_reversal":
        std = close.rolling(20).std()
        lower = sma - 2 * std
        enter = (close.shift(1) < lower.shift(1)) & (close > lower) & (rsi < 40)
        exit_ = (close >= sma) | (rsi > 60)
    else:
        raise ValueError(f"Unknown strategy: {strategy}")
    return enter.fillna(False).to_numpy(), exit_.fillna(False).to_numpy()


def run_backtest(df, initial_capital=100000, strategy="Opening Range Breakout", position_size=1000, stop_loss_pct=1.5, fee_bps=10):
    initial_capital = float(initial_capital)
    cash = initial_capital
    shares = 0.0
    entry_price = 0.0
    wins = trades = 0
    closed_pnls = []
    equity = []
    trade_log = []
    entries, exits = strategy_mask(df, strategy)
    fee_rate = max(0.0, float(fee_bps)) / 10000

    for i, row in enumerate(df.itertuples(index=False)):
        price = float(row.close)
        low = float(row.low)
        stop = entry_price * (1 - max(0.0, float(stop_loss_pct)) / 100) if shares else 0
        exit_price = min(price, stop) if shares and stop and low <= stop else price
        should_exit = shares and (exits[i] or (stop and low <= stop))
        if should_exit:
            gross = shares * exit_price
            proceeds = gross * (1 - fee_rate)
            pnl = proceeds - (shares * entry_price * (1 + fee_rate))
            cash += proceeds
            trades += 1
            wins += int(pnl > 0)
            closed_pnls.append(pnl)
            trade_log.append({"side": "SELL", "time": str(row.time), "price": round(exit_price, 4), "quantity": round(shares, 6), "pnl": round(pnl, 2), "reason": "stop_loss" if stop and low <= stop else "strategy_exit"})
            shares = 0.0
            entry_price = 0.0
        if not shares and entries[i]:
            budget = min(cash, max(0.0, float(position_size)))
            shares = budget / (price * (1 + fee_rate)) if budget else 0.0
            if shares:
                entry_price = price
                cash -= shares * price * (1 + fee_rate)
                trade_log.append({"side": "BUY", "time": str(row.time), "price": round(price, 4), "quantity": round(shares, 6), "pnl": None, "reason": "strategy_entry"})
        equity.append(cash + shares * price)

    if shares and len(df):
        row = df.iloc[-1]
        price = float(row["close"])
        gross = shares * price
        proceeds = gross * (1 - fee_rate)
        pnl = proceeds - shares * entry_price * (1 + fee_rate)
        cash += proceeds
        trades += 1
        wins += int(pnl > 0)
        closed_pnls.append(pnl)
        trade_log.append({"side": "SELL", "time": str(row["time"]), "price": round(price, 4), "quantity": round(shares, 6), "pnl": round(pnl, 2), "reason": "end_of_period"})
        shares = 0
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
    avg_win = np.mean([value for value in closed_pnls if value > 0]) if gross_profit else 0
    avg_loss = abs(np.mean([value for value in closed_pnls if value < 0])) if gross_loss else 0
    return {
        "initial_capital": initial_capital,
        "final_value": round(final_value, 2),
        "pnl": round(pnl, 2),
        "return_pct": round(pnl / initial_capital * 100, 2),
        "trades": trades,
        "win_rate": round(wins / max(trades, 1) * 100, 2),
        "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss else None,
        "average_win": round(float(avg_win), 2),
        "average_loss": round(float(avg_loss), 2),
        "expectancy": round(float(np.mean(closed_pnls)), 2) if closed_pnls else 0,
        "max_drawdown": round(abs(float(drawdown.min())) if len(drawdown) else 0, 2),
        "equity_curve": [round(float(x), 2) for x in equity],
        "trade_log": trade_log,
        "strategy": strategy,
        "position_size": float(position_size),
        "stop_loss_pct": float(stop_loss_pct),
        "fee_bps": float(fee_bps),
    }
