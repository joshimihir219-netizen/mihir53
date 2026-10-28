import pandas as pd

from backtest import STRATEGIES, STRATEGY_DETAILS, strategy_mask


def generate_signal(df, strategy="EMA Trend Pullback"):
    if df.empty:
        raise ValueError("Signal generation requires at least one candle.")

    latest = df.iloc[-1]
    close = float(latest["close"])
    rule = STRATEGIES.get(strategy, strategy)
    entries, exits = strategy_mask(df, rule)
    signal = "BUY" if entries[-1] else "SELL" if exits[-1] else "HOLD"
    true_range = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - df["close"].shift(1)).abs(),
            (df["low"] - df["close"].shift(1)).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = true_range.rolling(14, min_periods=14).mean().iloc[-1]
    entry_price = close if signal == "BUY" else None
    stop_loss = None
    target_price = None
    if entry_price is not None and pd.notna(atr) and atr > 0:
        risk = max(float(atr) * 1.5, close * 0.0025)
        stop_loss = round(close - risk, 4)
        target_price = round(close + risk * 2, 4)
    details = STRATEGY_DETAILS[rule]

    return {
        "signal": signal,
        "setup_status": {"BUY": "ENTRY", "SELL": "EXIT_LONG", "HOLD": "NO_SETUP"}[signal],
        "reference_price": round(close, 4),
        "entry_price": round(entry_price, 4) if entry_price is not None else None,
        "stop_loss": stop_loss,
        "target_price": target_price,
        "risk_reward": 2.0 if target_price is not None else None,
        "atr_14": round(float(atr), 4) if pd.notna(atr) else None,
        "rsi": round(float(latest["rsi"]), 2) if "rsi" in latest else None,
        "macd": round(float(latest["macd"]), 4) if "macd" in latest else None,
        "bar_time": pd.Timestamp(latest["time"]).isoformat() if "time" in latest else None,
        "strategy": strategy,
        "rule": rule,
        "rule_triggered": details["entry_reason"] if signal == "BUY" else details["exit_reason"] if signal == "SELL" else "No entry or exit rule triggered on the latest completed candle.",
        "model": "Deterministic technical rules",
        "note": "Rules evaluate completed OHLC candles. BUY levels use the last close as reference, a 1.5 ATR(14) stop, and a 2R target; they are scenarios, not fills or profit probabilities. Backtests fill at the next candle open.",
    }
