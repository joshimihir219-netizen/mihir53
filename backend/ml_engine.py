from backtest import STRATEGIES, strategy_mask


def generate_signal(df, strategy="EMA Trend Pullback"):
    latest = df.iloc[-1]
    rsi = float(latest["rsi"])
    macd = float(latest["macd"])
    close = float(latest["close"])
    sma = float(latest["sma20"])
    macd_signal = float(latest["signal_line"])
    rule = STRATEGIES.get(strategy, strategy)
    entries, exits = strategy_mask(df, rule)
    signal = "BUY" if entries[-1] else "SELL" if exits[-1] else "HOLD"
    confirmations = (
        int(close > sma) if signal == "BUY" else int(close < sma)
    ) + (
        int(macd > macd_signal) if signal == "BUY" else int(macd < macd_signal)
    ) + int(40 <= rsi <= 70)
    return {
        "signal": signal,
        "confidence": 50 + confirmations * 10 if signal != "HOLD" else 50,
        "rsi": round(rsi, 2),
        "macd": round(macd, 4),
        "strategy": strategy,
        "model": "Deterministic technical rules",
        "note": "Rule-strength score counts indicator confirmations; it is not a probability or validated forecast. Confirm the current quote before acting.",
    }
