import React, {useEffect, useMemo, useState} from "react";
import "./risk-management.css";

const API = "/api";
const DEFAULTS = {
  accountEquity: "250000",
  riskPerTradePct: "1",
  dailyLossMode: "amount",
  dailyLossValue: "5000",
  maxDrawdownPct: "8",
  maxOpenRiskPct: "3",
  maxTradesPerDay: "5",
  tradingTimezone: "Asia/Kolkata",
  tradingDayStart: "00:00",
  currency: "INR"
};
const INSTRUMENTS = [
  {label: "NIFTY 50 cash index", value: "nifty_index", type: "nifty_index"},
  {label: "NIFTY futures", value: "NIFTY futures", type: "futures"},
  {label: "NIFTY options (premium based)", value: "NIFTY options", type: "options"},
  {label: "GOLD futures", value: "GOLD futures", type: "futures"},
  {label: "Bitcoin spot", value: "Bitcoin spot", type: "spot"},
  {label: "Bitcoin futures / CFD", value: "Bitcoin futures / CFD", type: "futures"},
  {label: "Custom instrument", value: "Custom instrument", type: "custom"}
];

function finitePositive(value){
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function floorStep(value, step){
  return Math.floor(value / step + 1e-12) * step;
}

function money(value, currency = "INR"){
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value));
}

async function responseJson(response){
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    const message = typeof detail === "string" ? detail : detail?.message || "The risk service could not complete this request.";
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  return body;
}

function RiskManagement({riskRules, setRiskRules, saveRiskRules, addLog, isLoggedIn}){
  const [instrument, setInstrument] = useState(INSTRUMENTS[0].value);
  const [direction, setDirection] = useState("BUY");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [contractMultiplier, setContractMultiplier] = useState("");
  const [quantityStep, setQuantityStep] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [feeBps, setFeeBps] = useState("0");
  const [slippage, setSlippage] = useState("0");
  const [marginPct, setMarginPct] = useState("");
  const [riskSnapshot, setRiskSnapshot] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const settings = {
    ...DEFAULTS,
    ...riskRules,
    accountEquity: riskRules.accountEquity ?? riskRules.capitalBox ?? DEFAULTS.accountEquity,
    riskPerTradePct: riskRules.riskPerTradePct ?? riskRules.riskPerTrade ?? DEFAULTS.riskPerTradePct,
    dailyLossValue: riskRules.dailyLossValue ?? riskRules.dailyLoss ?? DEFAULTS.dailyLossValue,
    maxDrawdownPct: riskRules.maxDrawdownPct ?? riskRules.maxDrawdown ?? DEFAULTS.maxDrawdownPct
  };

  function updateSetting(field, value){
    const aliases = {
      accountEquity: {capitalBox: value},
      riskPerTradePct: {riskPerTrade: value},
      dailyLossValue: {dailyLoss: value},
      maxDrawdownPct: {maxDrawdown: value}
    };
    setRiskRules((current) => ({...current, [field]: value, ...(aliases[field] || {})}));
    setSaveError("");
    setSettingsDirty(true);
  }

  const equity = finitePositive(settings.accountEquity) || 0;
  const tradeLimit = equity * (Number(settings.riskPerTradePct) || 0) / 100;
  const dailyLimit = settings.dailyLossMode === "percent"
    ? equity * (Number(settings.dailyLossValue) || 0) / 100
    : Number(settings.dailyLossValue) || 0;
  const overallLimit = equity * (Number(settings.maxDrawdownPct) || 0) / 100;
  const openRiskLimit = equity * (Number(settings.maxOpenRiskPct) || 0) / 100;
  const dailyRemaining = riskSnapshot ? Math.max(0, dailyLimit - Number(riskSnapshot.daily_loss_used || 0)) : dailyLimit;
  const overallRemaining = riskSnapshot ? Math.max(0, overallLimit - Number(riskSnapshot.overall_loss_used || 0)) : overallLimit;
  const openRiskRemaining = riskSnapshot ? Math.max(0, openRiskLimit - Number(riskSnapshot.current_open_risk || 0)) : openRiskLimit;
  const tradeCountLimitReached = Boolean(riskSnapshot && settings.maxTradesPerDay !== "" && settings.maxTradesPerDay != null && riskSnapshot.trades_today >= Number(settings.maxTradesPerDay));
  const maxRiskBudget = tradeCountLimitReached ? 0 : Math.max(0, Math.min(tradeLimit, dailyRemaining, overallRemaining, openRiskRemaining));

  const selectedInstrument = INSTRUMENTS.find((item) => item.value === instrument) || INSTRUMENTS[0];
  const calculation = useMemo(() => {
    if (selectedInstrument.type === "nifty_index") return {error: "NIFTY 50 is a cash index, not a directly tradable quantity. Choose a futures or options contract."};
    const entry = finitePositive(entryPrice);
    const stop = finitePositive(stopPrice);
    const target = finitePositive(targetPrice);
    const multiplier = finitePositive(contractMultiplier);
    const step = finitePositive(quantityStep);
    if (!entry || !stop || !target) return {error: "Enter an entry, stop-loss, and target to size this trade."};
    if (!multiplier || !step) return {error: "Enter the current contract multiplier and quantity step or lot size. No default contract size is assumed."};
    const riskDistance = direction === "BUY" ? entry - stop : stop - entry;
    const rewardDistance = direction === "BUY" ? target - entry : entry - target;
    if (riskDistance <= 0) return {error: `Stop-loss must be ${direction === "BUY" ? "below" : "above"} entry.`};
    if (rewardDistance <= 0) return {error: `Target must be ${direction === "BUY" ? "above" : "below"} entry.`};
    const fees = Number(feeBps);
    const slip = Number(slippage);
    const marginRate = marginPct === "" ? null : Number(marginPct);
    if (!Number.isFinite(fees) || fees < 0 || fees > 10000 || !Number.isFinite(slip) || slip < 0) return {error: "Fees and slippage must be valid non-negative values."};
    if (marginRate !== null && (!Number.isFinite(marginRate) || marginRate <= 0 || marginRate > 100)) return {error: "Margin percentage must be greater than 0 and no more than 100."};
    const feeRate = fees / 10000;
    const unitRisk = (riskDistance + 2 * slip) * multiplier + (entry + stop) * multiplier * feeRate;
    const riskQuantity = floorStep(maxRiskBudget / unitRisk, step);
    const capitalPerQuantity = entry * multiplier * (marginRate === null ? 1 : marginRate / 100);
    const capitalQuantity = floorStep(equity / capitalPerQuantity, step);
    const maximumQuantity = Math.min(riskQuantity, capitalQuantity);
    const quantity = plannedQuantity === "" ? null : Number(plannedQuantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) return {error: "Planned quantity must be greater than zero."};
    const quantityIsStepValid = quantity === null || Math.abs(quantity / step - Math.round(quantity / step)) < 1e-8;
    const plannedRisk = quantity === null ? null : quantity * unitRisk;
    const potentialLoss = maximumQuantity * unitRisk;
    const targetProfitPerUnit = (rewardDistance - 2 * slip) * multiplier - (entry + target) * multiplier * feeRate;
    const potentialProfit = maximumQuantity * targetProfitPerUnit;
    const positionValue = entry * maximumQuantity * multiplier;
    return {
      error: "",
      entry,
      stop,
      target,
      multiplier,
      step,
      unitRisk,
      maximumQuantity,
      lots: maximumQuantity / step,
      quantity,
      plannedRisk,
      quantityIsStepValid,
      plannedOverLimit: (plannedRisk !== null && plannedRisk > maxRiskBudget + 1e-8) || (quantity !== null && quantity > capitalQuantity + 1e-8),
      plannedOverCapital: quantity !== null && quantity > capitalQuantity + 1e-8,
      potentialLoss,
      potentialProfit,
      positionValue,
      marginRequirement: marginRate === null ? null : positionValue * marginRate / 100,
      riskReward: potentialLoss > 0 ? potentialProfit / potentialLoss : null,
      riskPercent: equity > 0 ? potentialLoss / equity * 100 : null
    };
  }, [selectedInstrument, direction, entryPrice, stopPrice, targetPrice, contractMultiplier, quantityStep, plannedQuantity, feeBps, slippage, marginPct, maxRiskBudget, equity]);

  async function refreshRiskLimits(){
    if (!isLoggedIn) {
      setRiskSnapshot(null);
      return;
    }
    try {
      setRiskSnapshot(await fetch(`${API}/risk/status`).then(responseJson));
      setLoadError("");
    } catch (error) {
      setRiskSnapshot(null);
      setLoadError(error.message);
    }
  }

  useEffect(() => { refreshRiskLimits(); }, [isLoggedIn]);

  async function submitSettings(event){
    event.preventDefault();
    setSaving(true);
    setSaveError("");
    setToast("");
    const payload = {
      ...settings,
      accountEquity: String(settings.accountEquity),
      capitalBox: String(settings.accountEquity),
      riskPerTradePct: String(settings.riskPerTradePct),
      riskPerTrade: String(settings.riskPerTradePct),
      dailyLossValue: String(settings.dailyLossValue),
      dailyLoss: String(settings.dailyLossValue),
      maxDrawdownPct: String(settings.maxDrawdownPct),
      maxDrawdown: String(settings.maxDrawdownPct)
    };
    setRiskRules(payload);
    try {
      await saveRiskRules(event, payload);
      setToast("Account risk settings saved.");
      setSettingsDirty(false);
      addLog("Account risk settings saved.", "success");
      await refreshRiskLimits();
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function recordPosition(){
    if (!isLoggedIn || !calculation || calculation.error || !calculation.quantity || calculation.plannedOverLimit || !calculation.quantityIsStepValid) return;
    setRecording(true);
    setLoadError("");
    try {
      await responseJson(await fetch(`${API}/risk/positions`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          instrument,
          instrument_type: selectedInstrument.type,
          direction,
          entry_price: calculation.entry,
          stop_price: calculation.stop,
          target_price: calculation.target,
          quantity: calculation.quantity,
          contract_multiplier: calculation.multiplier,
          quantity_step: calculation.step,
          fee_bps: Number(feeBps),
          slippage_per_unit: Number(slippage),
          margin_pct: marginPct === "" ? null : Number(marginPct)
        })
      }));
      setToast("Position added to your manual risk journal.");
      addLog(`Manual ${direction} position recorded for ${instrument} after server-side risk checks.`, "success");
      setPlannedQuantity("");
      await refreshRiskLimits();
    } catch (error) {
      const detail = error.detail;
      setLoadError(detail?.reasons ? `${error.message} ${detail.reasons.join(" ")} Maximum permitted risk: ${money(detail.maximum_permitted_risk, settings.currency)}.` : error.message);
    } finally {
      setRecording(false);
    }
  }

  const tradeCanBeRecorded = isLoggedIn && !settingsDirty && calculation && !calculation.error && calculation.quantity > 0 && !calculation.plannedOverLimit && calculation.quantityIsStepValid;

  return (
    <div className="riskPage">
      <header className="riskPageHeading">
        <div><p className="eyebrow">CAPITAL PROTECTION</p><h1>Risk Management</h1><p>Plan each position against the limits you set for this account.</p></div>
        <span className="riskDataTag">{isLoggedIn ? "ACCOUNT SETTINGS" : "SIGN IN TO SAVE"}</span>
      </header>

      <section className="riskSection" aria-labelledby="risk-settings-title">
        <div className="riskSectionHeading"><span className="riskSectionIndex">01</span><div><h2 id="risk-settings-title">Account Risk Settings</h2><p>Set the maximum loss you are willing to accept. Values apply to this account only.</p></div></div>
        <form className="riskSettingsGrid" onSubmit={submitSettings}>
          <label className="riskField"><span>Account balance / equity</span><input type="number" min="0.01" step="any" required value={settings.accountEquity} onChange={(event) => updateSetting("accountEquity", event.target.value)} /><small>Current account value used for sizing. Manual input, not a broker balance.</small></label>
          <label className="riskField"><span>Risk per trade <i title="The most you plan to lose if one position reaches its stop-loss.">ⓘ</i></span><input type="number" min="0.01" max="100" step="any" required value={settings.riskPerTradePct} onChange={(event) => updateSetting("riskPerTradePct", event.target.value)} /><small>{money(tradeLimit, settings.currency)} maximum planned loss per trade</small></label>
          <label className="riskField"><span>Maximum daily loss</span><div className="riskInputPair"><input type="number" min="0.01" step="any" required value={settings.dailyLossValue} onChange={(event) => updateSetting("dailyLossValue", event.target.value)} /><select aria-label="Daily loss limit unit" value={settings.dailyLossMode} onChange={(event) => updateSetting("dailyLossMode", event.target.value)}><option value="amount">{settings.currency}</option><option value="percent">%</option></select></div><small>{money(dailyLimit, settings.currency)} maximum loss in one trading day</small></label>
          <label className="riskField"><span>Maximum overall drawdown <i title="Total recorded loss allowed before new positions are blocked.">ⓘ</i></span><input type="number" min="0.01" max="100" step="any" required value={settings.maxDrawdownPct} onChange={(event) => updateSetting("maxDrawdownPct", event.target.value)} /><small>{money(overallLimit, settings.currency)} total recorded loss allowance</small></label>
          <label className="riskField"><span>Maximum simultaneous open risk</span><input type="number" min="0.01" max="100" step="any" required value={settings.maxOpenRiskPct} onChange={(event) => updateSetting("maxOpenRiskPct", event.target.value)} /><small>{money(openRiskLimit, settings.currency)} across all open journal positions</small></label>
          <label className="riskField"><span>Maximum trades per day <em>Optional</em></span><input type="number" min="1" step="1" value={settings.maxTradesPerDay ?? ""} onChange={(event) => updateSetting("maxTradesPerDay", event.target.value)} placeholder="No limit" /><small>Leave blank if you do not want a trade-count limit.</small></label>
          <label className="riskField"><span>Trading timezone</span><input type="text" maxLength="64" required value={settings.tradingTimezone} onChange={(event) => updateSetting("tradingTimezone", event.target.value)} placeholder="Asia/Kolkata" /><small>Used to determine when the daily loss counter rolls over.</small></label>
          <label className="riskField"><span>Trading day starts at</span><input type="time" required value={settings.tradingDayStart} onChange={(event) => updateSetting("tradingDayStart", event.target.value)} /><small>Daily history remains saved when a new trading day begins.</small></label>
          <div className="riskSettingsActions"><button className="primary" type="submit" disabled={!isLoggedIn || saving}>{saving ? "Saving…" : "Save account settings"}</button>{!isLoggedIn && <span>Sign in to save account settings.</span>}{toast && <span className="riskToast" role="status">{toast}</span>}{saveError && <span className="riskError" role="alert">{saveError}</span>}</div>
        </form>
      </section>

      <section className="riskSection riskCalculatorSection" aria-labelledby="risk-calculator-title">
        <div className="riskSectionHeading"><span className="riskSectionIndex">02</span><div><h2 id="risk-calculator-title">Trade Risk Calculator</h2><p>Results recalculate as you edit. Contract specifications are required; none are assumed.</p></div></div>
        <div className="riskCalculatorLayout">
          <div className="riskCalculatorFields">
            <label className="riskField"><span>Market / instrument</span><select value={instrument} onChange={(event) => setInstrument(event.target.value)}>{INSTRUMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="riskField"><span>Direction</span><select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></label>
            <label className="riskField"><span>Entry price</span><input type="number" min="0" step="any" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} placeholder="0.00" /></label>
            <label className="riskField"><span>Stop-loss price</span><input type="number" min="0" step="any" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} placeholder="0.00" /><small>{selectedInstrument.type === "options" ? "Use the option premium stop, not the underlying index level." : "The stop must be on the loss side of entry."}</small></label>
            <label className="riskField"><span>Target price</span><input type="number" min="0" step="any" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="0.00" /></label>
            <label className="riskField"><span>Contract multiplier</span><input type="number" min="0" step="any" value={contractMultiplier} onChange={(event) => setContractMultiplier(event.target.value)} placeholder="Required from contract specs" /><small>Point value / units represented by one quantity unit.</small></label>
            <label className="riskField"><span>Quantity step / lot size</span><input type="number" min="0" step="any" value={quantityStep} onChange={(event) => setQuantityStep(event.target.value)} placeholder="Required from contract specs" /><small>Quantity rounds down to this multiple.</small></label>
            <label className="riskField"><span>Planned quantity <em>Optional</em></span><input type="number" min="0" step="any" value={plannedQuantity} onChange={(event) => setPlannedQuantity(event.target.value)} placeholder="Check a proposed size" /></label>
            <label className="riskField"><span>Fees (basis points)</span><input type="number" min="0" max="10000" step="any" value={feeBps} onChange={(event) => setFeeBps(event.target.value)} /><small>Applied to entry and exit notional.</small></label>
            <label className="riskField"><span>Estimated slippage per unit</span><input type="number" min="0" step="any" value={slippage} onChange={(event) => setSlippage(event.target.value)} /><small>Price points / premium movement on each side.</small></label>
            <label className="riskField"><span>Margin requirement <em>Optional</em></span><input type="number" min="0.01" max="100" step="any" value={marginPct} onChange={(event) => setMarginPct(event.target.value)} placeholder="% only if verified" /><small>Uses your entered estimate; if blank, full position value is checked against equity.</small></label>
          </div>
          <aside className="riskResults" aria-live="polite">
            <div className="riskResultTop"><span>Maximum allowed risk</span><strong>{money(maxRiskBudget, settings.currency)}</strong><small>Lowest of trade, daily, overall, and open-risk allowances</small></div>
            {calculation.error ? <p className="riskResultHint">{calculation.error}</p> : <>
              <p className="riskResultSentence">Your current limits allow a maximum of <b>{Number(calculation.maximumQuantity.toFixed(8)).toLocaleString()}</b> units{calculation.step !== 1 ? ` (${calculation.lots.toLocaleString()} lots)` : ""} at this stop distance.</p>
              <dl className="riskResultList">
                <div><dt>Loss per unit / quantity step</dt><dd>{money(calculation.unitRisk * calculation.step, settings.currency)}</dd></div>
                <div><dt>Risk at maximum quantity</dt><dd>{money(calculation.potentialLoss, settings.currency)} <small>({calculation.riskPercent?.toFixed(2)}% of equity)</small></dd></div>
                <div><dt>Total position value</dt><dd>{money(calculation.positionValue, settings.currency)}</dd></div>
                <div><dt>Potential profit after estimated costs</dt><dd>{money(calculation.potentialProfit, settings.currency)}</dd></div>
                <div><dt>Risk-to-reward after costs</dt><dd>{calculation.riskReward ? `1:${calculation.riskReward.toFixed(2)}` : "—"}</dd></div>
                <div><dt>Balance after stop / target</dt><dd>{money(equity - calculation.potentialLoss, settings.currency)} / {money(equity + calculation.potentialProfit, settings.currency)}</dd></div>
                {calculation.marginRequirement !== null && <div><dt>Estimated margin</dt><dd>{money(calculation.marginRequirement, settings.currency)}</dd></div>}
              </dl>
            </>}
            {calculation.plannedOverLimit && <div className="riskTradeWarning" role="alert"><b>{calculation.plannedOverCapital ? "CAPITAL / MARGIN LIMIT EXCEEDED" : "TRADE RISK TOO HIGH"}</b><span>{calculation.plannedOverCapital ? "Planned quantity exceeds the capital or margin capacity used by this estimate." : `Planned loss is ${money(calculation.plannedRisk, settings.currency)}; the currently allowed risk is ${money(maxRiskBudget, settings.currency)}.`} Reduce quantity to {Number(calculation.maximumQuantity.toFixed(8)).toLocaleString()} or less. The stop is not changed.</span></div>}
            {!calculation.quantityIsStepValid && <p className="riskError" role="alert">Planned quantity must be a whole multiple of the configured lot or quantity step.</p>}
            {loadError && <p className="riskError" role="alert">{loadError}</p>}
            <button type="button" className="primary riskRecordButton" disabled={!tradeCanBeRecorded || recording} onClick={recordPosition}>{recording ? "Checking limits…" : "Add as open manual position"}</button>
            {!isLoggedIn && <small className="riskMuted">Sign in to save positions and use server-side checks.</small>}
            {settingsDirty && <small className="riskMuted">Save changed account limits before recording a position.</small>}
          </aside>
        </div>
      </section>

    </div>
  );
}

export default RiskManagement;