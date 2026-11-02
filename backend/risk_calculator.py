import math


def _positive_number(value, name, allow_zero=False):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number.") from None
    if not math.isfinite(number) or (number < 0 if allow_zero else number <= 0):
        qualifier = "zero or greater" if allow_zero else "greater than zero"
        raise ValueError(f"{name} must be {qualifier}.")
    return number


def _floor_to_step(value, step):
    return math.floor((value / step) + 1e-12) * step


def calculate_position(
    *,
    instrument_type,
    direction,
    entry_price,
    stop_price,
    target_price,
    risk_budget,
    account_equity=250000,
    contract_multiplier,
    quantity_step,
    fee_bps=0,
    slippage_per_unit=0,
    planned_quantity=None,
    margin_pct=None,
):
    """Size a position from user-supplied contract specifications and costs."""
    if instrument_type == "nifty_index":
        raise ValueError("The NIFTY cash index is not directly tradable. Choose a futures or options contract.")
    if instrument_type not in {"spot", "futures", "options", "custom"}:
        raise ValueError("Choose a supported instrument type.")
    if direction not in {"BUY", "SELL"}:
        raise ValueError("Direction must be BUY or SELL.")

    entry = _positive_number(entry_price, "Entry price")
    stop = _positive_number(stop_price, "Stop-loss price")
    target = _positive_number(target_price, "Target price")
    budget = _positive_number(risk_budget, "Risk budget", allow_zero=True)
    equity = _positive_number(account_equity, "Account equity")
    multiplier = _positive_number(contract_multiplier, "Contract multiplier")
    step = _positive_number(quantity_step, "Quantity step / lot size")
    fees = _positive_number(fee_bps, "Fees", allow_zero=True)
    slippage = _positive_number(slippage_per_unit, "Estimated slippage", allow_zero=True)
    if fees > 10000:
        raise ValueError("Fees must not exceed 10,000 basis points.")

    risk_distance = entry - stop if direction == "BUY" else stop - entry
    reward_distance = target - entry if direction == "BUY" else entry - target
    if risk_distance <= 0:
        raise ValueError("Stop-loss must be below entry for BUY and above entry for SELL.")
    if reward_distance <= 0:
        raise ValueError("Target must be above entry for BUY and below entry for SELL.")

    fee_rate = fees / 10000
    unit_risk = (
        (risk_distance + 2 * slippage) * multiplier
        + (entry + stop) * multiplier * fee_rate
    )
    risk_quantity = _floor_to_step(budget / unit_risk, step) if unit_risk > 0 else 0
    margin_rate = None
    if margin_pct is not None:
        margin_rate = _positive_number(margin_pct, "Margin percentage")
        if margin_rate > 100:
            raise ValueError("Margin percentage must not exceed 100%.")
    capital_per_quantity = entry * multiplier * (margin_rate / 100 if margin_rate is not None else 1)
    capital_quantity = _floor_to_step(equity / capital_per_quantity, step)
    max_quantity = round(min(risk_quantity, capital_quantity), 8)
    normalized_planned_quantity = None
    planned_risk = None
    if planned_quantity is not None:
        normalized_planned_quantity = _positive_number(planned_quantity, "Planned quantity")
        planned_risk = normalized_planned_quantity * unit_risk

    target_unit_profit = (
        (reward_distance - 2 * slippage) * multiplier
        - (entry + target) * multiplier * fee_rate
    )
    potential_profit = max_quantity * target_unit_profit
    potential_loss = max_quantity * unit_risk
    position_value = entry * max_quantity * multiplier
    margin_requirement = position_value * margin_rate / 100 if margin_rate is not None else None

    return {
        "risk_budget": budget,
        "capital_quantity_limit": round(capital_quantity, 8),
        "risk_per_unit": unit_risk,
        "maximum_quantity": max_quantity,
        "quantity_step": step,
        "lots": round(max_quantity / step, 8),
        "planned_quantity": normalized_planned_quantity,
        "planned_risk": planned_risk,
        "risk_percent_of_equity": potential_loss / equity * 100 if equity > 0 else None,
        "potential_loss": potential_loss,
        "potential_profit": potential_profit,
        "position_value": position_value,
        "margin_requirement": margin_requirement,
        "risk_reward": potential_profit / potential_loss if potential_loss > 0 else None,
        "fees_and_slippage_included": True,
    }


def assess_protection(
    *,
    account_equity,
    risk_per_trade_pct,
    daily_loss_limit,
    daily_loss_mode,
    max_drawdown_pct,
    max_open_risk_pct,
    daily_net_pnl,
    overall_net_pnl,
    current_open_risk,
    trades_today,
    max_trades_per_day=None,
    proposed_risk=0,
):
    equity = _positive_number(account_equity, "Account equity")
    risk_pct = _positive_number(risk_per_trade_pct, "Risk per trade")
    daily_limit_value = _positive_number(daily_loss_limit, "Daily loss limit")
    drawdown_pct = _positive_number(max_drawdown_pct, "Maximum drawdown")
    open_pct = _positive_number(max_open_risk_pct, "Maximum open risk")
    open_risk = _positive_number(current_open_risk, "Current open risk", allow_zero=True)
    proposed = _positive_number(proposed_risk, "Proposed risk", allow_zero=True)
    if risk_pct > 100 or drawdown_pct > 100 or open_pct > 100:
        raise ValueError("Risk percentages must not exceed 100%.")
    if daily_loss_mode not in {"amount", "percent"}:
        raise ValueError("Daily loss mode must be amount or percent.")
    if daily_loss_mode == "percent" and daily_limit_value > 100:
        raise ValueError("Daily loss percentage must not exceed 100%.")

    daily_limit = equity * daily_limit_value / 100 if daily_loss_mode == "percent" else daily_limit_value
    daily_used = max(0, -float(daily_net_pnl))
    overall_limit = equity * drawdown_pct / 100
    overall_used = max(0, -float(overall_net_pnl))
    open_limit = equity * open_pct / 100
    daily_remaining = max(0, daily_limit - daily_used)
    overall_remaining = max(0, overall_limit - overall_used)
    open_remaining = max(0, open_limit - open_risk)
    trade_budget = equity * risk_pct / 100
    allowed_risk = min(trade_budget, daily_remaining, overall_remaining, open_remaining)

    reasons = []
    if daily_remaining <= 0 or proposed > daily_remaining:
        reasons.append("Daily loss limit reached or exceeded.")
    if overall_remaining <= 0 or proposed > overall_remaining:
        reasons.append("Overall drawdown limit reached or exceeded.")
    if open_remaining <= 0 or proposed > open_remaining:
        reasons.append("Maximum simultaneous open risk reached or exceeded.")
    if proposed > trade_budget:
        reasons.append("Proposed risk exceeds the per-trade risk limit.")
    if max_trades_per_day is not None and trades_today >= int(max_trades_per_day):
        reasons.append("Maximum trades per day reached.")

    daily_status = "LIMIT REACHED" if daily_remaining <= 0 else "WARNING" if daily_remaining <= daily_limit * 0.2 else "SAFE"
    overall_status = "LIMIT REACHED" if overall_remaining <= 0 else "WARNING" if overall_remaining <= overall_limit * 0.2 else "SAFE"
    return {
        "daily_limit": daily_limit,
        "daily_loss_used": daily_used,
        "daily_remaining": daily_remaining,
        "overall_limit": overall_limit,
        "overall_loss_used": overall_used,
        "overall_remaining": overall_remaining,
        "open_risk_limit": open_limit,
        "current_open_risk": open_risk,
        "open_risk_remaining": open_remaining,
        "trade_risk_limit": trade_budget,
        "maximum_permitted_risk": allowed_risk,
        "daily_status": daily_status,
        "overall_status": overall_status,
        "blocked": bool(reasons),
        "reasons": reasons,
    }