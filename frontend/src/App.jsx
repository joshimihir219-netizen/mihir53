import React, {useEffect, useMemo, useRef, useState} from "react";
import "./signal-details.css";
import "./strategy-lab.css";
import {Line} from "react-chartjs-2";
import {Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler} from "chart.js";
import {LayoutDashboard, Activity, FlaskConical, ShieldCheck, FileText, Settings, Bell, Search, Menu, TrendingUp, TrendingDown, LogIn} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const API = "/api";
const TIMEFRAME_MAX_DURATION_DAYS = {
  "1m": 7, "2m": 60, "5m": 60, "15m": 60, "30m": 60,
  "60m": 60, "90m": 60, "1h": 60, "1d": 1825, "5d": 1825,
  "1wk": 3650, "1mo": 3650, "3mo": 3650
};
function maxDurationForUnit(timeframe, unit){
  const divisor = unit === "years" ? 365 : unit === "months" ? 30 : 1;
  return Math.floor(TIMEFRAME_MAX_DURATION_DAYS[timeframe] / divisor);
}
const nav = [
  ["Dashboard", LayoutDashboard], ["Signals", Activity], ["Options Trading", TrendingUp], ["Backtesting", FlaskConical],
  ["Risk Management", ShieldCheck], ["Reports", FileText], ["Strategies", Settings]
];
const defaultStrategies = [
  {name: "Price Action Break & Retest", rule: "price_action_retest", risk: "Medium", status: "READY", description: "Prior 20-bar resistance breaks; the next bar retests the level and closes bullish above it. Exit below prior 10-bar support or EMA 20.", entryRules: ["Close above the highest high of the prior 20 completed bars.", "The following bar touches within 0.3% of the broken level and closes bullish above it."], exitRules: ["Close below the prior 10-bar low.", "Or close below EMA 20."]},
  {name: "Smart Money Structure (SMC)", rule: "smc_order_block_retest", risk: "High", status: "READY", description: "A 20-bar structure break is followed by a retest of the last bearish candle's range within 10 bars. Exit below prior 10-bar support or EMA 20.", entryRules: ["Close above the prior 20-bar structure high.", "Within 10 bars, retest the last bearish candle range from the 5 bars before the break and close bullish above its midpoint."], exitRules: ["Setup expires after 10 bars or a close below the order-block low before entry.", "After entry, close below prior 10-bar support or EMA 20."]},
  {name: "ICT Liquidity Sweep", rule: "ict_liquidity_sweep", risk: "High", status: "READY", description: "Sweep below the prior 20-bar low, then bullish displacement through the 5-bar high with a three-candle fair-value gap. Exit below support or EMA 20.", entryRules: ["Sweep below the prior 20-bar low and close back above it.", "Within the next 4 bars, bullish displacement closes above the prior 5-bar high and forms a three-candle fair-value gap."], exitRules: ["Close below the prior 10-bar low.", "Or close below EMA 20."]},
  {name: "EMA Trend Pullback", rule: "ema_trend_pullback", risk: "Medium", status: "READY", description: "EMA 20 above EMA 50; a recent EMA 20 pullback closes bullish back above the average. Exit below EMA 20 or on trend loss.", entryRules: ["EMA 20 and price are above EMA 50.", "A low in the prior 3 bars touched EMA 20; current candle closes bullish above EMA 20."], exitRules: ["Close below EMA 20.", "Or EMA 20 falls below EMA 50."]},
  {name: "Donchian Trend Breakout", rule: "donchian_breakout", risk: "High", status: "READY", description: "A close crosses the prior 20-bar high while EMA 20 is above EMA 50. Exit below prior 10-bar support or on trend loss.", entryRules: ["Close crosses above the highest high of the prior 20 completed bars.", "EMA 20 is above EMA 50."], exitRules: ["Close below the prior 10-bar low.", "Or EMA 20 falls below EMA 50."]}
  ,{name: "VWAP Reversal", rule: "vwap_reversal", risk: "Medium", status: "READY", description: "Reversal after a close falls below session VWAP by one 20-bar standard deviation and then prints a bullish recovery candle.", entryRules: ["Close is below session VWAP minus 20-bar deviation.", "Bullish candle closes above prior close."], exitRules: ["Close returns to or above session VWAP."]}
  ,{name: "RSI Mean Reversion", rule: "rsi_mean_reversion", risk: "High", status: "READY", description: "RSI(14) recovers from oversold territory; exit on momentum normalization or return to its 20-bar mean.", entryRules: ["RSI(14) is below 30 and rising.", "Current candle is bullish."], exitRules: ["RSI exceeds 60 or price closes above its 20-bar mean."]}
  ,{name: "MACD Momentum", rule: "macd_momentum", risk: "Medium", status: "READY", description: "Bullish MACD signal-line crossover above zero; exit on the reverse crossover.", entryRules: ["MACD(12,26) crosses above its 9-period signal.", "MACD is positive."], exitRules: ["MACD crosses below its signal line."]}
  ,{name: "ADX Trend Following", rule: "adx_trend_following", risk: "Medium", status: "READY", description: "Directional movement confirms a strong trend above EMA 20; exit on DI reversal or weakening ADX.", entryRules: ["ADX(14) exceeds 25 and +DI crosses above -DI.", "Close is above EMA 20."], exitRules: ["-DI exceeds +DI or ADX falls below 18."]}
  ,{name: "Bollinger Band Breakout", rule: "bollinger_breakout", risk: "High", status: "READY", description: "Close breaks above the 20-period upper band; exit on a return below the middle band or support.", entryRules: ["Close crosses above SMA(20) + 2 standard deviations."], exitRules: ["Close is below SMA(20) or prior 10-bar support."]}
  ,{name: "Previous Day High/Low Breakout", rule: "previous_day_breakout", risk: "High", status: "READY", description: "Intraday close breaks the previous observed session high; invalidation is previous session low or EMA 20.", entryRules: ["Close crosses above previous session high."], exitRules: ["Close is below previous session low or EMA 20."]}
  ,{name: "Volume-Based Breakout", rule: "volume_breakout", risk: "High", status: "READY", description: "Prior 20-bar resistance breakout requires volume above 1.5 times the preceding 20-bar average.", entryRules: ["Close crosses prior 20-bar high.", "Volume exceeds 1.5× prior 20-bar average."], exitRules: ["Close breaks prior 10-bar support or relative volume falls below 0.5× average."]}
  ,{name: "Opening Range Breakout", rule: "opening_range_breakout", risk: "High", status: "READY", description: "After the first 30 minutes of each observed session, enter on an opening-range high break.", entryRules: ["Close crosses above the session's first 30-minute high after that range completes."], exitRules: ["Close falls below the opening-range low or EMA 20."]}
  ,{name: "Support and Resistance Reversal", rule: "support_resistance_reversal", risk: "Medium", status: "READY", description: "Bullish rejection within 0.2% of prior 20-bar support; exit on support invalidation or EMA 20 loss.", entryRules: ["Low tests prior 20-bar support within 0.2%.", "Candle closes bullish back above support."], exitRules: ["Close falls below support or EMA 20."]}
  ,{name: "Fair Value Gap Retracement", rule: "fvg_retracement", risk: "High", status: "READY", description: "A three-candle bullish gap sets a zone; enter on a bullish mitigation close within ten bars.", entryRules: ["Current low exceeds the high from two candles earlier.", "Within ten bars price retests the gap and closes bullish above its midpoint."], exitRules: ["Setup expires after ten bars or closes below the gap low.", "Position exits below 10-bar support or EMA 20."]}
  ,{name: "Order Block Mitigation", rule: "order_block_mitigation", risk: "High", status: "READY", description: "A bullish displacement break creates a zone from the last bearish candle; enter on a later bullish mitigation.", entryRules: ["Bullish displacement exceeds 0.8 ATR and closes above prior 10-bar structure.", "Within ten bars, retest the last bearish candle zone and close above its midpoint."], exitRules: ["Setup expires after ten bars or invalidates below the block low.", "Position exits below 10-bar support or EMA 20."]}
  ,{name: "Supertrend Trend Following", rule: "supertrend_following", risk: "Medium", status: "READY", description: "Long when the 3×ATR(14) trailing Supertrend state flips bullish; exit on bearish flip.", entryRules: ["Close crosses above the prior final upper Supertrend band."], exitRules: ["Supertrend state flips bearish."]}
  ,{name: "ATR Volatility Breakout", rule: "atr_volatility_breakout", risk: "High", status: "READY", description: "Prior 20-bar high breakout with ATR(14) above its trailing 50-bar median volatility ratio.", entryRules: ["Close breaks prior 20-bar high plus 0.1 ATR.", "ATR/price is above its trailing 50-bar median."], exitRules: ["Close below prior 10-bar support or EMA 20."]}
];

function toCurrency(value){
  if(typeof value === "number" && Number.isFinite(value)) return `₹${value.toLocaleString("en-IN", {maximumFractionDigits: 2})}`;
  return "—";
}

function formatPercent(value){
  const clean = Number(value ?? 0);
  return `${clean >= 0 ? "+" : ""}${clean.toFixed(2)}%`;
}

function normalCdf(value){
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989422804 * Math.exp(-0.5 * absolute * absolute);
  const probability = 1 - density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? probability : 1 - probability;
}

function estimateOptionPremium(spot, strike, daysToExpiry, optionType, volatility = 0.2){
  if (!spot || !strike || daysToExpiry <= 0) return 0;
  const time = daysToExpiry / 365;
  const rootTime = Math.sqrt(time);
  const d1 = (Math.log(spot / strike) + 0.5 * volatility * volatility * time) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  const premium = optionType === "CALL"
    ? spot * normalCdf(d1) - strike * normalCdf(d2)
    : strike * normalCdf(-d2) - spot * normalCdf(-d1);
  return Math.max(0.05, Number(premium.toFixed(2)));
}

function nextOptionsExpiry(daysFromToday){
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTradeDate(date = new Date()){
  return date.toLocaleDateString("en-IN", {day: "numeric", month: "short", year: "numeric"});
}

function createOptionsSignalMetadata(key){
  const generatedAt = new Date();
  const dateParts = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0")
  ];
  const timeParts = [
    String(generatedAt.getHours()).padStart(2, "0"),
    String(generatedAt.getMinutes()).padStart(2, "0"),
    String(generatedAt.getSeconds()).padStart(2, "0"),
    String(generatedAt.getMilliseconds()).padStart(3, "0")
  ];
  return {
    key,
    date: formatTradeDate(generatedAt),
    tradeNumber: `OPT-${dateParts.join("")}-${timeParts.join("")}`
  };
}

function formatMarketPrice(symbol, value){
  if (!Number.isFinite(value)) return "—";
  const isCrypto = ["BTC/USDT", "ETH/USDT"].includes(symbol);
  return `${isCrypto ? "$" : "₹"}${value.toLocaleString(isCrypto ? "en-US" : "en-IN", {maximumFractionDigits: 2})}`;
}

function formatSignalMove(entryPrice, currentPrice){
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice)) return "unavailable";
  const points = currentPrice - entryPrice;
  const percent = points / entryPrice * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`;
}

function authHeaders(includeJson = true){
  const headers = includeJson ? {"Content-Type": "application/json"} : {};
  try {
    const token = JSON.parse(localStorage.getItem("trademind-auth-session") || "null")?.accessToken;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {}
  return headers;
}

function App(){
  const [page, setPage] = useState("Dashboard");
  const [symbol, setSymbol] = useState("NIFTY 50");
  const [chartInterval, setChartInterval] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartInterval || "1d"; } catch { return "1d"; }
  });
  const [markets, setMarkets] = useState([]);
  const [market, setMarket] = useState(null);
  const [signal, setSignal] = useState(null);
  const [backtest, setBacktest] = useState(() => { try { return JSON.parse(localStorage.getItem("trademind-last-backtest") || "null"); } catch { return null; } });
  const [savedBacktests, setSavedBacktests] = useState([]);
  const [backtestError, setBacktestError] = useState("");
  const [backtestForm, setBacktestForm] = useState({
    symbol: "NIFTY 50",
    strategy: "Price Action Break & Retest",
    timeframe: "15m",
    durationValue: "5",
    durationUnit: "days",
    initialCapital: "100000",
    positionSize: "1000",
    stopLoss: "1.5",
    takeProfitRR: "2",
    feeBps: "10"
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    try { return Boolean(JSON.parse(localStorage.getItem("trademind-auth-session") || "null")?.accessToken); } catch { return false; }
  });
  const [authChecking, setAuthChecking] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const width = Number(localStorage.getItem("trademind-sidebar-width"));
      return Number.isFinite(width) && width >= 200 && width <= 420 ? width : 245;
    } catch { return 245; }
  });
  const [profile, setProfile] = useState(() => {
    try {
      const savedProfile = JSON.parse(localStorage.getItem("trademind-profile") || "null");
      const savedUser = JSON.parse(localStorage.getItem("trademind-user") || "null");
      return savedProfile || {name: savedUser?.username || "TradeMind User", email: "", phone: "", location: ""};
    } catch { return {name: "TradeMind User", email: "", phone: "", location: ""}; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [developerCardOpen, setDeveloperCardOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [notificationsReadAt, setNotificationsReadAt] = useState(() => {
    try { return Number(localStorage.getItem("trademind-notifications-read-at") || 0); } catch { return 0; }
  });
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-read-notification-ids") || "[]");
      return new Set(Array.isArray(saved) ? saved : []);
    } catch { return new Set(); }
  });
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [telegramConfig, setTelegramConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-telegram") || "{}");
      return { botToken: saved.botToken || "", chatId: saved.chatId || "" };
    } catch { return { botToken: "", chatId: "" }; }
  });
  const [logs, setLogs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-log") || "[]");
      if (Array.isArray(saved) && saved.length) {
        const migrated = saved.map((entry) => (
          (entry.type === "notification" || entry.type === "signal") && !entry.optionSignal
            ? {...entry, type: "info"}
            : entry
        ));
        localStorage.setItem("trademind-log", JSON.stringify(migrated));
        return migrated;
      }
      return [{time: new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message: "System ready", type: "info"}];
    } catch { return [{time: new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message: "System ready", type: "info"}]; }
  });
  const [riskRules, setRiskRules] = useState(() => {
    return {stopLoss: "2.0", maxDrawdown: "8.0", dailyLoss: "5000", capitalBox: "250000", riskPerTrade: "1", minimumRiskReward: "2", maxTradesPerDay: "5"};
  });
  const [strategies, setStrategies] = useState(() => {
    return defaultStrategies;
  });
  const [selectedStrategy, setSelectedStrategy] = useState("EMA Trend Pullback");
  useEffect(() => { try { if (backtest) localStorage.setItem("trademind-last-backtest", JSON.stringify(backtest)); } catch {} }, [backtest]);
  const lastSignalTelegramKeyRef = useRef("");
  const pendingSignalTelegramKeyRef = useRef("");
  const notifiedMarketSignalsRef = useRef(null);
  const loggedTradeAlertsRef = useRef(null);
  if (loggedTradeAlertsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-trade-alert-notifications") || "[]");
      loggedTradeAlertsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      loggedTradeAlertsRef.current = new Set();
    }
  }
  if (notifiedMarketSignalsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-market-signal-notifications") || "[]");
      notifiedMarketSignalsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      notifiedMarketSignalsRef.current = new Set();
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function validateSession(){
      try {
        const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
        if (!savedSession?.accessToken) {
          if (!cancelled) setIsLoggedIn(false);
          return;
        }
        const response = await fetch(API + "/auth/me", {
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        if (!response.ok) throw new Error("Session expired.");
        const account = await response.json();
        if (cancelled) return;
        localStorage.setItem("trademind-user", JSON.stringify({username: account.username}));
        setProfile((current) => ({
          ...current,
          name: current.name === "TradeMind User" ? account.username : current.name
        }));
        setIsLoggedIn(true);
      } catch {
        try {
          localStorage.removeItem("trademind-auth-session");
          localStorage.removeItem("trademind-session");
        } catch {}
        if (!cancelled) setIsLoggedIn(false);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }
    validateSession();
    return () => { cancelled = true; };
  }, []);

  const addLog = (message, type = "info", optionSignal = null) => {
    setLogs((current) => {
      const createdAt = Date.now();
      const next = [{id: `${createdAt}-${Math.random()}`, createdAt, time: new Date(createdAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}), message, type, ...(optionSignal ? {optionSignal} : {})}, ...current].slice(0, 30);
      try { localStorage.setItem("trademind-log", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    try { localStorage.setItem("trademind-sidebar-width", String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try { localStorage.setItem("trademind-profile", JSON.stringify(profile)); } catch {}
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem("trademind-telegram", JSON.stringify(telegramConfig)); } catch {}
  }, [telegramConfig]);

  function beginSidebarResize(event){
    event.preventDefault();
    const move = (moveEvent) => setSidebarWidth(Math.max(200, Math.min(420, moveEvent.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, {once: true});
  }

  function markNotificationsRead(){
    const readAt = Date.now();
    setNotificationsReadAt(readAt);
    try { localStorage.setItem("trademind-notifications-read-at", String(readAt)); } catch {}
  }

  function openNotification(entry){
    const id = entry.id || `${entry.time}-${entry.message}`;
    setReadNotificationIds((current) => {
      const next = new Set(current);
      next.add(id);
      try { localStorage.setItem("trademind-read-notification-ids", JSON.stringify([...next])); } catch {}
      return next;
    });
    setSelectedNotification(entry);
    setNotificationsOpen(false);
  }

  function saveProfile(event, updatedProfile = profile, updatedTelegram = telegramConfig){
    event.preventDefault();
    const savedProfile = {
      name: String(updatedProfile.name || "").trim() || "TradeMind User",
      email: String(updatedProfile.email || "").trim(),
      phone: String(updatedProfile.phone || "").trim(),
      location: String(updatedProfile.location || "").trim()
    };
    const cleanedTelegram = {
      botToken: String(updatedTelegram.botToken || "").trim(),
      chatId: String(updatedTelegram.chatId || "").trim()
    };
    setProfile(savedProfile);
    setTelegramConfig(cleanedTelegram);
    try { localStorage.setItem("trademind-profile", JSON.stringify(savedProfile)); } catch {}
    setProfileOpen(false);
    addLog(cleanedTelegram.botToken && cleanedTelegram.chatId ? "Profile and Telegram alerts saved on this device." : "Profile information saved on this device.", cleanedTelegram.botToken && cleanedTelegram.chatId ? "success" : "info");
  }

  const notifyTelegram = async (message, settings = telegramConfig) => {
    try {
      const botToken = String(settings.botToken || "").trim();
      const chatId = String(settings.chatId || "").trim();
      addLog(message, "info");
      if (!botToken || !chatId) {
        const error = "Add a Telegram bot token and chat ID in your profile settings.";
        addLog(`Telegram delivery failed: ${error}`, "warning");
        return {ok: false, error};
      }
      const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
      if (!savedSession?.accessToken) {
        const error = "Telegram delivery requires an active TradeMind login.";
        addLog(error, "warning");
        return {ok: false, error};
      }
      const response = await fetch(API + "/telegram/send", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${savedSession.accessToken}`},
        body: JSON.stringify({bot_token: botToken, chat_id: chatId, message})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Telegram rejected the message.");
      addLog("Telegram alert delivered.", "success");
      return {ok: true, error: ""};
    } catch (error) {
      const detail = error.message || "Could not reach the Telegram service.";
      addLog(`Telegram delivery failed: ${detail}`, "warning");
      return {ok: false, error: detail};
    }
  };

  useEffect(() => {
    const loadMarkets = () => fetch(API + "/markets").then((r) => r.json()).then(setMarkets).catch(() => {});
    loadMarkets();
    const timer = setInterval(loadMarkets, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setStrategies(defaultStrategies);
      setSavedBacktests([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(API + "/strategies", {headers: authHeaders(false)}).then(async (response) => {
        if (!response.ok) throw new Error("Could not load saved strategies.");
        return response.json();
      }),
      fetch(API + "/risk/settings", {headers: authHeaders(false)}).then(async (response) => {
        if (!response.ok) throw new Error("Could not load saved risk settings.");
        return response.json();
      }),
      fetch(API + "/backtests", {headers: authHeaders(false)}).then(async (response) => {
        if (!response.ok) throw new Error("Could not load saved backtests.");
        return response.json();
      })
    ]).then(([savedStrategies, savedRiskRules, userBacktests]) => {
      if (cancelled) return;
      setStrategies([...defaultStrategies, ...savedStrategies]);
      setRiskRules({stopLoss: "2.0", maxDrawdown: "8.0", dailyLoss: "5000", capitalBox: "250000", riskPerTrade: "1", minimumRiskReward: "2", maxTradesPerDay: "5", ...savedRiskRules});
      setSavedBacktests(userBacktests);
    }).catch((error) => addLog(error.message, "warning"));
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  useEffect(() => {
    const selected = strategies.find((item) => item.name === selectedStrategy);
    const signalParams = new URLSearchParams({strategy: selected?.rule || selectedStrategy, interval: chartInterval});
    if (selected?.rule === "custom") signalParams.set("strategy_id", String(selected.id));
    Promise.all([
      fetch(API + "/market/" + encodeURIComponent(symbol) + "?interval=" + chartInterval).then((r) => r.json()),
      fetch(API + "/signal/" + encodeURIComponent(symbol) + "?" + signalParams.toString(), {headers: authHeaders(false)}).then((r) => r.json())
    ])
      .then(([m, s]) => { setMarket(m); setSignal(s); })
      .catch(() => {});
  }, [symbol, chartInterval, selectedStrategy, strategies]);

  useEffect(() => {
    const timer = setInterval(() => {
      const selected = strategies.find((item) => item.name === selectedStrategy);
      const signalParams = new URLSearchParams({strategy: selected?.rule || selectedStrategy, interval: chartInterval});
      if (selected?.rule === "custom") signalParams.set("strategy_id", String(selected.id));
      fetch(API + "/market/" + encodeURIComponent(symbol) + "?interval=" + chartInterval).then((r) => r.json()).then(setMarket).catch(() => {});
      fetch(API + "/signal/" + encodeURIComponent(symbol) + "?" + signalParams.toString(), {headers: authHeaders(false)}).then((r) => r.json()).then(setSignal).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [symbol, chartInterval, selectedStrategy, strategies]);

  useEffect(() => {
    if (!isLoggedIn || !market?.live || !signal?.live) return;
    const direction = String(signal.signal || "").toUpperCase();
    if (!["BUY", "SELL", "HOLD"].includes(direction)) return;

    const now = new Date();
    const tradeDate = formatTradeDate(now);
    const localDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentPrice = Number(signal.reference_price ?? market.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

    const notificationKey = `${symbol}:${signal.rule || selectedStrategy}:${chartInterval}:${localDateKey}:${direction}`;
    const notificationMessage = `${symbol}: ${direction} · ${signal.strategy || selectedStrategy}. ${signal.rule_triggered || "No rule detail available."}`;
    const isNewMarketSignalNotification = !notifiedMarketSignalsRef.current.has(notificationKey);
    if (isNewMarketSignalNotification) {
      notifiedMarketSignalsRef.current.add(notificationKey);
      try {
        localStorage.setItem(
          "trademind-market-signal-notifications",
          JSON.stringify([...notifiedMarketSignalsRef.current].slice(-100))
        );
      } catch {}
    }

    let signalStates = {};
    let activeTrade = null;
    const tradeStorageKey = `trademind-market-trade:${symbol}:${signal.rule || selectedStrategy}:${chartInterval}`;
    const legacyTradeStorageKey = `trademind-market-trade:${symbol}`;
    try {
      signalStates = JSON.parse(localStorage.getItem("trademind-market-signal-directions") || "{}");
      if (!signalStates || typeof signalStates !== "object" || Array.isArray(signalStates)) signalStates = {};
      activeTrade = JSON.parse(localStorage.getItem(tradeStorageKey) || "null");
      localStorage.removeItem(legacyTradeStorageKey);
    } catch {}

    if (activeTrade?.model !== "rule-derived-v2") {
      activeTrade = null;
      try { localStorage.removeItem(tradeStorageKey); } catch {}
    }

    const signalDirectionKey = `${symbol}:${signal.rule || selectedStrategy}:${chartInterval}`;
    const directionChanged = signalStates[signalDirectionKey] !== direction;
    let telegramMessage = "";
    let telegramKey = "";
    const signalStatusKey = `${symbol}:${signal.rule || selectedStrategy}:${chartInterval}:${telegramConfig.chatId}:${telegramConfig.botToken.slice(-4)}:${localDateKey}:${direction}`;
    let deliveredSignalStates = {};
    try {
      deliveredSignalStates = JSON.parse(localStorage.getItem("trademind-telegram-signal-state") || "{}");
      if (!deliveredSignalStates || typeof deliveredSignalStates !== "object" || Array.isArray(deliveredSignalStates)) {
        deliveredSignalStates = {};
      }
    } catch {}

    if (activeTrade?.openedAt && new Date(activeTrade.openedAt).toLocaleDateString("en-CA") !== localDateKey) {
      activeTrade = null;
      try { localStorage.removeItem(tradeStorageKey); } catch {}
    }

    if (directionChanged) {
      signalStates[signalDirectionKey] = direction;
      try {
        localStorage.setItem("trademind-market-signal-directions", JSON.stringify(signalStates));
      } catch {}

      if (direction === "BUY" && !activeTrade) {
        const entryPrice = Number(signal.entry_price);
        const targetPrice = Number(signal.target_price);
        const stopPrice = Number(signal.stop_loss);
        if ([entryPrice, targetPrice, stopPrice].every((value) => Number.isFinite(value) && value > 0)) {
          activeTrade = {
            model: "rule-derived-v2",
            rule: signal.rule || selectedStrategy,
            timeframe: chartInterval,
            entryPrice,
            openedAt: signal.bar_time || now.toISOString(),
            targetPrice,
            stopPrice,
            lastProfitMilestone: 0
          };
          try { localStorage.setItem(tradeStorageKey, JSON.stringify(activeTrade)); } catch {}
        }
      }

      if (direction === "BUY") {
        telegramMessage = `${symbol} · BUY rule triggered · ${tradeDate}\n${signal.rule_triggered}\nReference close: ${formatMarketPrice(symbol, signal.entry_price)}\nTarget scenario: ${formatMarketPrice(symbol, signal.target_price)} · Stop scenario: ${formatMarketPrice(symbol, signal.stop_loss)}\nNo order was placed; these are rule-derived levels, not guaranteed fills.`;
      } else if (direction === "HOLD") {
        telegramMessage = activeTrade
          ? `${symbol} · HOLD existing BUY · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry (${formatMarketPrice(symbol, activeTrade.entryPrice)}): ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative signal move only; actual P&L depends on your entry, quantity, and costs.`
          : `${symbol} · WAIT · ${tradeDate}\n${signal.rule_triggered}\nNo active entry setup; no order was placed.`;
      } else {
        telegramMessage = activeTrade
          ? `${symbol} · SELL / EXIT BUY signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry (${formatMarketPrice(symbol, activeTrade.entryPrice)}): ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nIndicative exit signal only; no order was placed.`
          : `${symbol} · SELL signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nBearish signal: consider exiting an existing long or avoiding a new long. No order was placed.`;
        if (activeTrade) {
          activeTrade = null;
          try { localStorage.removeItem(tradeStorageKey); } catch {}
        }
      }
      telegramKey = signalStatusKey;
    }

    if (activeTrade && ["BUY", "HOLD"].includes(direction) && activeTrade.targetPrice && activeTrade.stopPrice) {
      const movePercent = (currentPrice / activeTrade.entryPrice - 1) * 100;
      if (currentPrice >= activeTrade.targetPrice) {
        telegramMessage = `${symbol} · TARGET REACHED · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget scenario: ${formatMarketPrice(symbol, activeTrade.targetPrice)}\nConsider reviewing or closing your position. This alert does not place an order.`;
        telegramKey = `${symbol}:TARGET:${activeTrade.openedAt}`;
        activeTrade = null;
        try { localStorage.removeItem(tradeStorageKey); } catch {}
      } else if (currentPrice <= activeTrade.stopPrice) {
        telegramMessage = `${symbol} · STOP-LOSS LEVEL REACHED · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nStop scenario: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nReview your risk and position. This alert does not place an order.`;
        telegramKey = `${symbol}:STOP:${activeTrade.openedAt}`;
        activeTrade = null;
        try { localStorage.removeItem(tradeStorageKey); } catch {}
      } else if (movePercent >= 1 && Math.floor(movePercent) > activeTrade.lastProfitMilestone) {
        activeTrade.lastProfitMilestone = Math.floor(movePercent);
        telegramMessage = `${symbol} · HOLD · SIGNAL MOVE IS POSITIVE · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative signal move only, not actual account P&L.`;
        telegramKey = `${symbol}:GAIN:${activeTrade.openedAt}:${activeTrade.lastProfitMilestone}`;
        try { localStorage.setItem(tradeStorageKey, JSON.stringify(activeTrade)); } catch {}
      }
    }

    if (
      !telegramMessage &&
      telegramConfig.botToken &&
      telegramConfig.chatId &&
      deliveredSignalStates[symbol] !== signalStatusKey
    ) {
      telegramMessage = direction === "BUY"
        ? `${symbol} · BUY rule remains active · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nReference close: ${formatMarketPrice(symbol, signal.reference_price)}\nTarget scenario: ${formatMarketPrice(symbol, signal.target_price)} · Stop scenario: ${formatMarketPrice(symbol, signal.stop_loss)}\nInformational rule output only; no order is placed.`
        : direction === "HOLD"
          ? activeTrade
            ? `${symbol} · HOLD existing BUY · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nMove since signal entry: ${formatSignalMove(activeTrade.entryPrice, currentPrice)}\nTarget: ${formatMarketPrice(symbol, activeTrade.targetPrice)} · Stop: ${formatMarketPrice(symbol, activeTrade.stopPrice)}\nIndicative move only; it is not actual account P&L.`
            : `${symbol} · HOLD / WAIT · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nNo active BUY signal is being tracked. No order was placed.`
          : `${symbol} · SELL signal · ${tradeDate}\nCurrent: ${formatMarketPrice(symbol, currentPrice)}\nBearish signal: consider exiting an existing long or avoiding a new long. No order was placed.`;
      telegramKey = signalStatusKey;
    }

    if (telegramMessage && telegramKey && !loggedTradeAlertsRef.current.has(telegramKey)) {
      loggedTradeAlertsRef.current.add(telegramKey);
      try {
        localStorage.setItem(
          "trademind-trade-alert-notifications",
          JSON.stringify([...loggedTradeAlertsRef.current].slice(-100))
        );
      } catch {}
      addLog(telegramMessage, "signal");
    }
    if (isNewMarketSignalNotification && !telegramMessage) {
      addLog(notificationMessage, "signal");
    }

    if (telegramMessage && telegramConfig.botToken && telegramConfig.chatId) {
      if (
        lastSignalTelegramKeyRef.current !== telegramKey &&
        pendingSignalTelegramKeyRef.current !== telegramKey
      ) {
        pendingSignalTelegramKeyRef.current = telegramKey;
        notifyTelegram(telegramMessage).then((delivery) => {
          if (delivery.ok) {
            lastSignalTelegramKeyRef.current = telegramKey;
            if (telegramKey === signalStatusKey) {
              deliveredSignalStates[symbol] = signalStatusKey;
              try {
                localStorage.setItem("trademind-telegram-signal-state", JSON.stringify(deliveredSignalStates));
              } catch {}
            }
          }
          if (pendingSignalTelegramKeyRef.current === telegramKey) pendingSignalTelegramKeyRef.current = "";
        });
      }
    }
  }, [isLoggedIn, symbol, market, signal, telegramConfig.botToken, telegramConfig.chatId]);

  async function runBacktest(customForm = backtestForm){
    setBacktestError("");
    setBacktest(null);
    try { localStorage.removeItem("trademind-last-backtest"); } catch {}
    const timeframe = customForm.timeframe || "1d";
    const durationUnit = customForm.durationUnit || "days";
    const maxDuration = maxDurationForUnit(timeframe, durationUnit);
    const duration = Math.min(maxDuration, Math.max(1, Number(customForm.durationValue) || 1));
    const form = {...customForm, durationValue: String(duration), durationUnit};
    const configuredStrategy = strategies.find((item) => item.name === form.strategy);
    const params = new URLSearchParams({
      symbol: form.symbol,
      initial_capital: String(form.initialCapital || 100000),
      timeframe,
      duration: String(duration),
      duration_unit: durationUnit,
      strategy: configuredStrategy?.rule || form.strategy,
      position_size: String(form.positionSize || 1000),
      stop_loss_pct: String(form.stopLoss || 0),
      fee_bps: String(form.feeBps || 10)
    });
    const takeProfitRR = Number(form.takeProfitRR || configuredStrategy?.risk_settings?.target_r);
    if (Number.isFinite(takeProfitRR) && takeProfitRR > 0) params.set("take_profit_rr", String(takeProfitRR));
    if (configuredStrategy?.rule === "custom") params.set("strategy_id", String(configuredStrategy.id));
    const r = await fetch(API + "/backtest?" + params.toString(), {method: "POST", headers: authHeaders(false)});
    const result = await r.json();
    if (!r.ok) {
      setBacktestError(result.detail || "Backtest failed.");
      throw new Error(result.detail || "Backtest failed.");
    }
    const merged = {...result, ...form, strategy: form.strategy, equity_curve: result.equity_curve || []};
    setBacktest(merged);
    if (result.saved_backtest_id) {
      setSavedBacktests((current) => [{id: result.saved_backtest_id, strategy_name: form.strategy, strategy_version: configuredStrategy?.version || 0, result: merged, created_at: new Date().toISOString()}, ...current].slice(0, 100));
    }
    setPage("Backtesting");
    addLog(`Backtest executed for ${form.symbol} using ${form.strategy} strategy on ${timeframe} timeframe over ${duration} ${durationUnit}.`, "info");
  }

  async function handleLogin(event){
    event.preventDefault();
    const username = loginForm.username.trim();
    const password = loginForm.password;
    if (username.length < 3 || !password || password.length < 8) {
      setLoginError("Enter a username with at least 3 characters and a password with at least 8 characters.");
      return;
    }
    if (authMode === "signup" && password !== confirmPassword) {
      setLoginError("Passwords do not match. Please confirm your account password.");
      return;
    }
    setLoginError("");
    try {
      const response = await fetch(API + (authMode === "signup" ? "/auth/signup" : "/auth/login"), {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username, password})
      });
      const result = await response.json();
      if (!response.ok) {
        setLoginError(result.detail || "Could not authenticate. Please try again.");
        return;
      }
      localStorage.setItem("trademind-auth-session", JSON.stringify({accessToken: result.access_token}));
      localStorage.setItem("trademind-user", JSON.stringify({username: result.username}));
      localStorage.removeItem("trademind-session");
      setProfile((current) => ({
        ...current,
        name: current.name === "TradeMind User" || current.name === loginForm.username ? result.username : current.name
      }));
      setIsLoggedIn(true);
      addLog(`${authMode === "signup" ? "Signed up and logged in" : "Logged in"} as ${result.username}.`, "success");
      if (telegramConfig.botToken && telegramConfig.chatId) {
        notifyTelegram(`TradeMind ${authMode === "signup" ? "signup" : "login"} successful for ${result.username}. Alerts are now enabled.`);
      }
    } catch {
      setLoginError("Unable to reach the account service. Check that the backend is running, then try again.");
    }
  }

  async function handleLogout(){
    try {
      const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
      if (savedSession?.accessToken) {
        const response = await fetch(API + "/auth/logout", {
          method: "POST",
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        if (!response.ok) addLog("Could not revoke the session on the server; local sign-out completed.", "warning");
      }
    } catch {
      addLog("Could not revoke the session on the server; local sign-out completed.", "warning");
    }
    try {
      localStorage.removeItem("trademind-session");
      localStorage.removeItem("trademind-auth-session");
    } catch {}
    setIsLoggedIn(false);
    setStrategies(defaultStrategies);
    setSavedBacktests([]);
    setRiskRules({stopLoss: "2.0", maxDrawdown: "8.0", dailyLoss: "5000", capitalBox: "250000", riskPerTrade: "1", minimumRiskReward: "2", maxTradesPerDay: "5"});
    setPage("Dashboard");
    addLog("Logged out from TradeMind.", "warning");
  }

  function handleSearch(event){
    if (event.key !== "Enter") return;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const marketMatch = markets.find((item) => item.symbol.toLowerCase().includes(query));
    const pageMatch = nav.find(([name]) => name.toLowerCase().includes(query));
    if (marketMatch) {
      setSymbol(marketMatch.symbol);
      setPage("Dashboard");
    } else if (pageMatch) {
      setPage(pageMatch[0]);
    } else if (strategies.some((item) => item.name.toLowerCase().includes(query))) {
      setPage("Strategies");
    } else {
      alert(`No market, section, or strategy found for "${searchQuery.trim()}".`);
    }
    setSearchQuery("");
  }

  async function saveRiskRules(event){
    event.preventDefault();
    if (!isLoggedIn) throw new Error("Sign in to save user-specific risk rules.");
    const response = await fetch(API + "/risk/settings", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({settings: riskRules})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Risk settings could not be saved.");
    return true;
  }

  async function saveStrategy(strategy){
    if (!isLoggedIn) throw new Error("Sign in to save private strategies.");
    const isEditing = Number.isInteger(strategy.id);
    const response = await fetch(API + (isEditing ? `/strategies/${strategy.id}` : "/strategies"), {
      method: isEditing ? "PUT" : "POST",
      headers: authHeaders(),
      body: JSON.stringify(strategy)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || "Strategy could not be saved.");
    setStrategies((current) => {
      const withoutSaved = current.filter((item) => item.id !== result.id);
      return [...withoutSaved, result];
    });
    return result;
  }

  async function removeStrategy(strategy){
    const response = await fetch(API + `/strategies/${strategy.id}`, {method: "DELETE", headers: authHeaders(false)});
    if (!response.ok) throw new Error("Strategy could not be deleted.");
    setStrategies((current) => current.filter((item) => item.id !== strategy.id));
  }

  function startStrategyBacktest(strategy){
    setBacktestForm((current) => ({...current, strategy: strategy.name, symbol: strategy.symbol || current.symbol, timeframe: strategy.timeframe || current.timeframe, ...(strategy.rule === "custom" ? {stopLoss: String(strategy.risk_settings?.stop_loss_pct || current.stopLoss), takeProfitRR: String(strategy.risk_settings?.target_r || current.takeProfitRR)} : {})}));
    setPage("Backtesting");
  }

  function exportReport(title, scope, period, result = backtest){
    const rows = [["Report", "Scope", "Period", "Generated", "Data source", "Timeframe", "Bars", "Initial capital", "Final value", "P&L", "Return %", "Trades", "Win rate %", "Profit factor", "Expectancy per trade", "Max drawdown %", "Position budget", "Stop loss %", "Fee per side (bps)"], [title, scope, period, new Date().toLocaleString(), result?.data_source || "No backtest", result?.timeframe || "", result?.bar_count ?? "", result?.initial_capital ?? "", result?.final_value ?? "", result?.pnl ?? "", result?.return_pct ?? "", result?.trades ?? "", result?.win_rate ?? "", result?.profit_factor ?? "", result?.expectancy ?? "", result?.max_drawdown ?? "", result?.position_size ?? "", result?.stop_loss_pct ?? "", result?.fee_bps ?? ""]];
    if (result?.trade_log?.length) {
      rows.push([], ["Trade log"], ["Side", "Time", "Price", "Quantity", "P&L", "Reason"]);
      result.trade_log.forEach((trade) => rows.push([trade.side, trade.time, trade.price, trade.quantity, trade.pnl ?? "", trade.reason]));
    }
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message = `${title} exported as ${link.download}.`;
    setExportMessage(message);
    addLog(message, "success");
    notifyTelegram(`Report exported: ${title} (${scope}, ${period}).`);
  }

  const notificationItems = logs.filter((entry) => entry.type === "signal");
  const notificationId = (entry) => entry.id || `${entry.time}-${entry.message}`;
  const unreadNotificationCount = notificationItems.filter((entry) =>
    Number(entry.createdAt || 0) > notificationsReadAt && !readNotificationIds.has(notificationId(entry))
  ).length;

  if (authChecking) {
    return <div className="loginShell"><div className="loginCard"><p role="status">Checking your account session…</p></div></div>;
  }

  if (!isLoggedIn) {
    return (
      <div className="loginShell">
        <div className="loginCard">
          <div className="brand"><div className="brandIcon">AI</div><div><b>TradeMind</b><small>AI Trading Lab</small></div></div>
          <div className="authToggle">
            <button type="button" className={authMode === "login" ? "toggle active" : "toggle"} onClick={() => setAuthMode("login")}>Log in</button>
            <button type="button" className={authMode === "signup" ? "toggle active" : "toggle"} onClick={() => setAuthMode("signup")}>Sign up</button>
          </div>
          <h1>{authMode === "login" ? "Log in" : "Create account"}</h1>
          <p>{authMode === "login" ? "Access the live trading dashboard and risk controls." : "Open a new market-ready trading workspace."}</p>
          <form onSubmit={handleLogin} className="loginForm">
            <label>Username<input autoComplete="username" minLength={3} maxLength={50} required value={loginForm.username} onChange={(event) => setLoginForm((current) => ({...current, username: event.target.value}))} placeholder="Choose a username" /></label>
            <label>Password<input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={128} required value={loginForm.password} onChange={(event) => setLoginForm((current) => ({...current, password: event.target.value}))} placeholder="At least 8 characters" /></label>
            {authMode === "signup" && <label>Confirm Password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" /></label>}
            {loginError && <div className="loginError" role="alert">{loginError}</div>}
            <button className="primary full" type="submit"><LogIn size={16} /> {authMode === "login" ? "Log in" : "Sign up"}</button>
          </form>
          <div className="demoCreds">{authMode === "login" ? "Only registered accounts can log in. New here? Sign up to create an account." : "Create a unique account with a username and password of at least 8 characters."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{"--sidebar-width": `${sidebarWidth}px`}}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandIcon">AI</div>
          <div><b>TradeMind</b><small>AI Trading Lab</small></div>
        </div>
        <button className="profileCard" type="button" onClick={() => setProfileOpen(true)} aria-label="View and edit profile">
          <span className="profileCardAvatar">{(profile.name || "U").trim().charAt(0).toUpperCase()}</span>
          <span className="profileCardText">
            <strong>{profile.name || "TradeMind User"}</strong>
            <small>{profile.email || "Add personal information"}</small>
          </span>
          <span className="profileEditHint">Edit</span>
        </button>
        <div className="sectionLabel">WORKSPACE</div>
        {nav.map(([name, Icon]) => <button key={name} className={page === name ? "nav active" : "nav"} onClick={() => setPage(name)}><Icon size={18} />{name}</button>)}
        <div className="sidebarBottom">
          <div className="riskMini"><span>●</span> System online<small>Market data connected</small></div>
          <div className="supportContact">
            <span>Need help?</span>
            <a href="mailto:fultonskipz44@gmail.com">fultonskipz44@gmail.com</a>
          </div>
        </div>
        <button
          className="sidebarResizeHandle"
          type="button"
          aria-label="Resize navigation panel"
          aria-valuemin={200}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          onPointerDown={beginSidebarResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSidebarWidth((width) => Math.max(200, width - 10));
            if (event.key === "ArrowRight") setSidebarWidth((width) => Math.min(420, width + 10));
          }}
        />
      </aside>
      <main>
        <header>
          <button className="mobileMenu" aria-label="Toggle navigation" onClick={() => document.querySelector(".sidebar")?.classList.toggle("open")}><Menu /></button>
          <div className="search"><Search size={17} /><input aria-label="Search symbols, strategies, or sections" placeholder="Search symbol, strategy..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={handleSearch} /></div>
          <div className="topActions">
            <div className="notificationWrap">
              <button
                className="iconButton notificationButton"
                aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ""}`}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell />
                {unreadNotificationCount > 0 && <span className="notificationCount">{unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}</span>}
              </button>
              {notificationsOpen && (
                <div className="notificationPanel" role="dialog" aria-label="Trading signals">
                  <div className="notificationPanelHead">
                    <div><strong>Trading Signals</strong><small>{unreadNotificationCount ? `${unreadNotificationCount} unread` : "You're all caught up"}</small></div>
                    <div className="notificationPanelActions">
                      <button className="linkButton" type="button" onClick={markNotificationsRead} disabled={!unreadNotificationCount}>Mark read</button>
                      <button className="popoverClose" type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>Close</button>
                    </div>
                  </div>
                  <div className="notificationList">
                    {notificationItems.length ? notificationItems.slice(0, 8).map((entry) => (
                      <button
                        className={`notificationItem ${Number(entry.createdAt || 0) > notificationsReadAt && !readNotificationIds.has(notificationId(entry)) ? "unread" : ""}`}
                        key={notificationId(entry)}
                        type="button"
                        aria-label={`Open notification: ${entry.message}`}
                        onClick={() => openNotification(entry)}
                      >
                        <span className={`notificationDot ${entry.type || "info"}`} />
                        <div className="notificationItemContent">
                          {entry.optionSignal ? <OptionSignalNotification details={entry.optionSignal} /> : <p>{entry.message}</p>}
                          <time>{entry.time || "Earlier"}</time>
                        </div>
                      </button>
                    )) : <p className="notificationEmpty">No trading signals yet. New signal alerts will appear here.</p>}
                  </div>
                </div>
              )}
            </div>
            <button className="logoutButton" onClick={handleLogout}>Logout</button>
            <div className="developerProfile">
              <button
                className="avatar"
                type="button"
                aria-label="Show developer name"
                aria-expanded={developerCardOpen}
                onClick={() => setDeveloperCardOpen((open) => !open)}
              >
                MJ
              </button>
              {developerCardOpen && (
                <div className="developerPopover" role="status">
                  <div className="developerPopoverHead">
                    <small>Developer</small>
                    <button className="popoverClose" type="button" aria-label="Close developer information" onClick={() => setDeveloperCardOpen(false)}>Close</button>
                  </div>
                  <strong>Mihir Joshi</strong>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="content">
          {page === "Dashboard" && <Dashboard markets={markets} symbol={symbol} setSymbol={setSymbol} market={market} signal={signal} chartInterval={chartInterval} setChartInterval={setChartInterval} runBacktest={() => runBacktest(backtestForm).catch((error) => addLog(error.message, "warning"))} onViewAll={() => setPage("Signals")} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Signals" && <Signals symbol={symbol} setSymbol={setSymbol} signal={signal} markets={markets} market={market} chartInterval={chartInterval} setChartInterval={setChartInterval} strategies={strategies} selectedStrategy={selectedStrategy} setSelectedStrategy={setSelectedStrategy} riskRules={riskRules} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Options Trading" && <OptionsTrading symbol={symbol} setSymbol={setSymbol} signal={signal} markets={markets} market={market} addLog={addLog} />}
          {page === "Backtesting" && <Backtesting backtest={backtest} backtestError={backtestError} runBacktest={() => runBacktest(backtestForm).catch((error) => addLog(error.message, "warning"))} symbol={symbol} backtestForm={backtestForm} setBacktestForm={setBacktestForm} strategies={strategies} savedBacktests={savedBacktests} onLoadSavedBacktest={(run) => { setBacktest(run.result); setBacktestForm((current) => ({...current, symbol: run.result.symbol || current.symbol, strategy: run.strategy_name, timeframe: run.result.timeframe || current.timeframe, durationValue: String(run.result.duration || current.durationValue), durationUnit: run.result.duration_unit || current.durationUnit, initialCapital: String(run.result.initial_capital || current.initialCapital), positionSize: String(run.result.position_size || current.positionSize), stopLoss: String(run.result.stop_loss_pct || current.stopLoss), takeProfitRR: String(run.result.take_profit_rr || current.takeProfitRR)})); }} notifyTelegram={notifyTelegram} addLog={addLog} />}
          {page === "Risk Management" && <Risk riskRules={riskRules} setRiskRules={setRiskRules} saveRiskRules={saveRiskRules} addLog={addLog} isLoggedIn={isLoggedIn} />}
          {page === "Reports" && <Reports backtest={backtest} exportReport={exportReport} exportMessage={exportMessage} notifyTelegram={notifyTelegram} />}
          {page === "Strategies" && <Strategies strategies={strategies} saveStrategy={saveStrategy} removeStrategy={removeStrategy} onBacktest={startStrategyBacktest} savedBacktests={savedBacktests} addLog={addLog} isLoggedIn={isLoggedIn} />}
        </div>
      </main>
      {profileOpen && <ProfileDialog profile={profile} telegramConfig={telegramConfig} onSave={saveProfile} onTestTelegram={(settings) => notifyTelegram("TradeMind Telegram connection test successful.", settings)} onClose={() => setProfileOpen(false)} />}
      {selectedNotification && (
        <div className="profileDialogBackdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedNotification(null);
        }}>
          <section className="profileDialog notificationDetailDialog" role="dialog" aria-modal="true" aria-labelledby="notification-detail-title">
            <div className="panelHead">
              <div>
                <p className="eyebrow">TRADING SIGNAL</p>
                <h2 id="notification-detail-title">Signal details</h2>
              </div>
              <button className="popoverClose" type="button" aria-label="Close notification details" onClick={() => setSelectedNotification(null)}>Close</button>
            </div>
            {selectedNotification.optionSignal
              ? <OptionSignalNotification details={selectedNotification.optionSignal} expanded />
              : <p className="notificationDetailMessage">{selectedNotification.message}</p>}
            <div className="notificationDetailMeta">
              <span className={`notificationDot ${selectedNotification.type || "info"}`} />
              <span>{selectedNotification.type || "info"}</span>
              <time>{selectedNotification.time || "Earlier"}</time>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MarketPriceChart({market, chartType, indicators, showVolume, priceScale, drawings, drawingTool, onChartClick}){
  const svgRef = useRef(null);
  const series = market?.series || [];
  const stats = useMemo(() => {
    const closes = series.map((candle) => Number(candle.close));
    const sma = closes.map((_, index) => {
      if (index < 19) return null;
      return closes.slice(index - 19, index + 1).reduce((sum, value) => sum + value, 0) / 20;
    });
    const ema = [];
    const alpha = 2 / 21;
    closes.forEach((value, index) => {
      ema.push(index ? value * alpha + ema[index - 1] * (1 - alpha) : value);
    });
    const deviation = closes.map((_, index) => {
      if (index < 19) return null;
      const window = closes.slice(index - 19, index + 1);
      const mean = sma[index];
      return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 20);
    });
    return {
      sma,
      ema,
      upperBand: sma.map((value, index) => value === null ? null : value + 2 * deviation[index]),
      lowerBand: sma.map((value, index) => value === null ? null : value - 2 * deviation[index])
    };
  }, [series]);
  const plotBottom = showVolume ? 250 : 340;
  const xAt = (index) => 30 + (index / Math.max(series.length - 1, 1)) * 840;
  const indicatorValues = [
    ...(indicators.sma ? stats.sma : []),
    ...(indicators.ema ? stats.ema : []),
    ...(indicators.bollinger ? [...stats.upperBand, ...stats.lowerBand] : [])
  ].filter((value) => value !== null && Number.isFinite(value));
  const prices = [
    ...series.flatMap((candle) => [Number(candle.low), Number(candle.high)]),
    ...indicatorValues
  ].filter(Number.isFinite);
  const basePrice = Number(series[0]?.close || 1);
  const transformPrice = (price) => {
    const value = Number(price);
    if (priceScale === "log") return Math.log(Math.max(value, Number.MIN_VALUE));
    if (priceScale === "percent") return ((value - basePrice) / basePrice) * 100;
    return value;
  };
  const scaledPrices = prices.map(transformPrice);
  const rawMin = scaledPrices.length ? Math.min(...scaledPrices) : 0;
  const rawMax = scaledPrices.length ? Math.max(...scaledPrices) : 1;
  const padding = (rawMax - rawMin) * 0.06 || 1;
  const minimum = rawMin - padding;
  const maximum = rawMax + padding;
  const range = maximum - minimum || 1;
  const yAt = (price) => 18 + ((maximum - transformPrice(price)) / range) * (plotBottom - 26);
  const priceAtY = (y) => {
    const scaledValue = maximum - ((y - 18) / (plotBottom - 26)) * range;
    if (priceScale === "log") return Math.exp(scaledValue);
    if (priceScale === "percent") return basePrice * (1 + scaledValue / 100);
    return scaledValue;
  };
  const formatScale = (scaledValue) => {
    if (priceScale === "percent") return `${scaledValue.toFixed(1)}%`;
    const value = priceScale === "log" ? Math.exp(scaledValue) : scaledValue;
    return value.toLocaleString(undefined, {maximumFractionDigits: 2});
  };
  const lineFor = (values) => values.map((value, index) => value === null || !Number.isFinite(value) ? null : `${xAt(index)},${yAt(value)}`).filter(Boolean).join(" ");
  const maxVolume = Math.max(1, ...series.map((candle) => Number(candle.volume) || 0));
  const bodyWidth = Math.max(2, Math.min(12, 840 / Math.max(series.length, 1) * 0.62));

  function handleDrawingClick(event){
    if (!svgRef.current || drawingTool === "cursor") return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 900;
    const y = ((event.clientY - bounds.top) / bounds.height) * 360;
    onChartClick({x, y, price: priceAtY(y)});
  }

  return (
    <svg
      ref={svgRef}
      className={`priceChartSvg ${drawingTool === "cursor" ? "" : "drawingActive"}`}
      viewBox="0 0 900 360"
      role="img"
      aria-label={`${chartType} chart for ${market?.symbol || "market"}`}
      preserveAspectRatio="none"
      onClick={handleDrawingClick}
    >
      {[0, 1, 2, 3, 4].map((line) => {
        const y = 18 + (line / 4) * (plotBottom - 26);
        const scaledValue = maximum - (line / 4) * range;
        return (
          <g key={line}>
            <line x1="22" x2="878" y1={y} y2={y} className="priceChartGridLine" />
            <text x="890" y={y + 4} textAnchor="end" className="priceChartScaleLabel">{formatScale(scaledValue)}</text>
          </g>
        );
      })}
      {chartType === "candlestick" || chartType === "ohlc" ? series.map((candle, index) => {
        const x = xAt(index);
        const openY = yAt(candle.open);
        const closeY = yAt(candle.close);
        const highY = yAt(candle.high);
        const lowY = yAt(candle.low);
        const rising = Number(candle.close) >= Number(candle.open);
        return (
          <g key={`${candle.time}-${index}`} className={rising ? "priceChartUp" : "priceChartDown"}>
            <title>{`${candle.time}: O ${candle.open}, H ${candle.high}, L ${candle.low}, C ${candle.close}`}</title>
            <line x1={x} x2={x} y1={highY} y2={lowY} className="priceChartWick" />
            {chartType === "candlestick" ? (
              <rect x={x - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(Math.abs(closeY - openY), 1)} className="priceChartCandleBody" />
            ) : (
              <>
                <line x1={x - bodyWidth / 2} x2={x} y1={openY} y2={openY} className="priceChartWick" />
                <line x1={x} x2={x + bodyWidth / 2} y1={closeY} y2={closeY} className="priceChartWick" />
              </>
            )}
          </g>
        );
      }) : (
        <>
          {chartType === "area" && series.length > 1 && <polygon points={`${xAt(0)},${plotBottom} ${lineFor(series.map((candle) => Number(candle.close)))} ${xAt(series.length - 1)},${plotBottom}`} className="priceChartArea" />}
          <polyline points={lineFor(series.map((candle) => Number(candle.close)))} className="priceChartCloseLine" />
        </>
      )}
      {indicators.bollinger && <polyline points={lineFor(stats.upperBand)} className="priceChartBollinger" />}
      {indicators.bollinger && <polyline points={lineFor(stats.lowerBand)} className="priceChartBollinger" />}
      {indicators.sma && <polyline points={lineFor(stats.sma)} className="priceChartSma" />}
      {indicators.ema && <polyline points={lineFor(stats.ema)} className="priceChartEma" />}
      {drawings.map((drawing) => (
        <line key={drawing.id} x1={drawing.x1} y1={drawing.y1} x2={drawing.x2} y2={drawing.y2} className="priceChartDrawing" />
      ))}
      {showVolume && series.map((candle, index) => {
        const volume = Number(candle.volume) || 0;
        const height = (volume / maxVolume) * 62;
        return <rect key={`volume-${candle.time}-${index}`} x={xAt(index) - bodyWidth / 2} y={348 - height} width={bodyWidth} height={height} className={Number(candle.close) >= Number(candle.open) ? "priceChartVolumeUp" : "priceChartVolumeDown"}><title>{`${candle.time}: volume ${volume.toLocaleString()}`}</title></rect>;
      })}
    </svg>
  );
}

function Dashboard({markets, symbol, setSymbol, market, signal, chartInterval, setChartInterval, runBacktest, onViewAll, notifyTelegram, addLog}){
  const [showSignalDetails, setShowSignalDetails] = useState(false);
  const [chartType, setChartType] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartType || "candlestick"; } catch { return "candlestick"; }
  });
  const [priceScale, setPriceScale] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").priceScale || "linear"; } catch { return "linear"; }
  });
  const [indicators, setIndicators] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").indicators || {sma: true, ema: false, bollinger: false}; } catch { return {sma: true, ema: false, bollinger: false}; }
  });
  const [showVolume, setShowVolume] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").showVolume !== false; } catch { return true; }
  });
  const [drawingTool, setDrawingTool] = useState("cursor");
  const [drawings, setDrawings] = useState([]);
  const [pendingTrendPoint, setPendingTrendPoint] = useState(null);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState("above");
  const [priceAlerts, setPriceAlerts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-price-alerts") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const [replayIndex, setReplayIndex] = useState(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const chartPanelRef = useRef(null);
  const alertedPriceIdsRef = useRef(new Set());
  const previousMarketPriceRef = useRef(null);
  const marketMap = useMemo(() => Object.fromEntries((markets || []).map((item) => [item.symbol, item])), [markets]);
  const breadth = useMemo(() => {
    const indiaSymbols = ["NIFTY 50", "BANK NIFTY", "SENSEX", "RELIANCE", "TCS", "INFOSYS", "HDFC BANK", "ICICI BANK", "SBIN", "ITC", "BHARTI AIRTEL"];
    const available = indiaSymbols.map((name) => marketMap[name]).filter(Boolean);
    const advancing = available.filter((item) => Number(item.change) > 0).length;
    const declining = available.filter((item) => Number(item.change) < 0).length;
    const unchanged = available.filter((item) => Number(item.change) === 0).length;
    return {advancing, declining, unchanged, total: available.length};
  }, [marketMap]);
  const marketStats = [
    {title: "Sensex", value: marketMap["SENSEX"] ? `₹${marketMap["SENSEX"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["SENSEX"] ? formatPercent(marketMap["SENSEX"].change) : "—", icon: "S"},
    {title: "Nifty 50", value: marketMap["NIFTY 50"] ? `₹${marketMap["NIFTY 50"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["NIFTY 50"] ? formatPercent(marketMap["NIFTY 50"].change) : "—", icon: "N"},
    {title: "Bank Nifty", value: marketMap["BANK NIFTY"] ? `₹${marketMap["BANK NIFTY"].price.toLocaleString("en-IN", {maximumFractionDigits: 2})}` : "—", delta: marketMap["BANK NIFTY"] ? formatPercent(marketMap["BANK NIFTY"].change) : "—", icon: "B"}
  ];
  const intervalChoices = [["1m", "1m"], ["2m", "2m"], ["5m", "5m"], ["15m", "15m"], ["30m", "30m"], ["60m", "60m"], ["90m", "90m"], ["1h", "1h"], ["1D", "1d"], ["5D", "5d"], ["1W", "1wk"], ["1M", "1mo"], ["3M", "3mo"]];
  const allChartSeries = market?.series || [];
  const chartRangeOptions = [["1D", 1], ["5D", 5], ["1M", 30], ["3M", 90], ["6M", 180], ["1Y", 365], ["All", null]];
  const [chartRange, setChartRange] = useState(() => {
    try { return JSON.parse(localStorage.getItem("trademind-chart-settings") || "{}").chartRange || "All"; } catch { return "All"; }
  });
  const rangeDays = chartRangeOptions.find(([label]) => label === chartRange)?.[1];
  const rangedSeries = rangeDays
    ? allChartSeries.filter((candle) => {
      const timestamp = new Date(candle.timestamp || candle.time).getTime();
      return Number.isFinite(timestamp) && timestamp >= Date.now() - rangeDays * 86400000;
    })
    : allChartSeries;
  const chartSeries = rangedSeries.length || !allChartSeries.length
    ? rangedSeries
    : allChartSeries.slice(-1);
  const visibleChartSeries = chartSeries.length ? chartSeries : allChartSeries.slice(-1);
  const visibleMarket = market ? {
    ...market,
    series: replayIndex === null ? chartSeries : visibleChartSeries.slice(0, replayIndex + 1),
    price: replayIndex === null ? market.price : visibleChartSeries[replayIndex]?.close || market.price
  } : null;
  const lastClose = Number(market?.price || 0);

  useEffect(() => {
    try { localStorage.setItem("trademind-price-alerts", JSON.stringify(priceAlerts)); } catch {}
  }, [priceAlerts]);

  useEffect(() => {
    if (!lastClose) return;
    const previous = previousMarketPriceRef.current;
    previousMarketPriceRef.current = {symbol, price: lastClose};
    if (!previous || previous.symbol !== symbol) return;
    const triggeredIds = new Set();
    for (const alert of priceAlerts) {
      if (alert.triggered || alert.symbol !== symbol || alertedPriceIdsRef.current.has(alert.id)) continue;
      const triggered = alert.condition === "above"
        ? previous.price < alert.price && lastClose >= alert.price
        : previous.price > alert.price && lastClose <= alert.price;
      if (!triggered) continue;
      alertedPriceIdsRef.current.add(alert.id);
      triggeredIds.add(alert.id);
      const message = `${symbol} price alert: ${lastClose.toLocaleString()} crossed ${alert.condition} ${alert.price.toLocaleString()}.`;
      addLog(message, "info");
      notifyTelegram(message);
    }
    if (triggeredIds.size) {
      setPriceAlerts((current) => current.map((alert) => triggeredIds.has(alert.id) ? {...alert, triggered: true} : alert));
    }
  }, [lastClose, symbol, priceAlerts, addLog, notifyTelegram]);

  useEffect(() => {
    if (!replayPlaying) return undefined;
    const timer = window.setInterval(() => {
      setReplayIndex((current) => {
        const next = (current ?? 0) + 1;
        if (next >= visibleChartSeries.length) {
          setReplayPlaying(false);
          return visibleChartSeries.length - 1;
        }
        return next;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [replayPlaying, visibleChartSeries.length]);

  useEffect(() => {
    const syncFullscreenState = () => setIsChartFullscreen(document.fullscreenElement === chartPanelRef.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  function handleChartDrawing(point){
    if (drawingTool === "horizontal") {
      setDrawings((current) => [...current, {id: `${Date.now()}-${Math.random()}`, x1: 22, x2: 878, y1: point.y, y2: point.y}]);
    } else if (drawingTool === "trendline") {
      if (!pendingTrendPoint) setPendingTrendPoint(point);
      else {
        setDrawings((current) => [...current, {id: `${Date.now()}-${Math.random()}`, x1: pendingTrendPoint.x, y1: pendingTrendPoint.y, x2: point.x, y2: point.y}]);
        setPendingTrendPoint(null);
        setDrawingTool("cursor");
      }
    }
  }

  function createPriceAlert(event){
    event.preventDefault();
    const price = Number(alertPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    const alert = {id: `${Date.now()}-${Math.random()}`, symbol, price, condition: alertCondition, triggered: false};
    setPriceAlerts((current) => [alert, ...current]);
    addLog(`Price alert set for ${symbol} ${alertCondition} ${price.toLocaleString()}.`, "info");
    setAlertPrice("");
    setShowAlertForm(false);
  }

  function saveChartLayout(){
    try {
      localStorage.setItem("trademind-chart-settings", JSON.stringify({chartType, priceScale, indicators, showVolume, chartInterval, chartRange}));
      addLog("Chart layout saved on this device.", "success");
    } catch {
      addLog("Chart layout could not be saved in this browser.", "warning");
    }
  }

  function resetChartLayout(){
    setChartType("candlestick");
    setPriceScale("linear");
    setIndicators({sma: true, ema: false, bollinger: false});
    setShowVolume(true);
    setChartInterval("1d");
    setChartRange("All");
    try { localStorage.removeItem("trademind-chart-settings"); } catch {}
    setDrawingTool("cursor");
    setPendingTrendPoint(null);
    setDrawings([]);
  }

  function downloadChartData(){
    const rows = [["Time", "Open", "High", "Low", "Close", "Volume"], ...chartSeries.map((item) => [item.time, item.open, item.high, item.low, item.close, item.volume])];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${chartInterval}-chart.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function toggleChartFullscreen(){
    try {
      if (document.fullscreenElement === chartPanelRef.current) await document.exitFullscreen();
      else if (chartPanelRef.current?.requestFullscreen) await chartPanelRef.current.requestFullscreen();
    } catch {
      addLog("Fullscreen is unavailable in this browser.", "warning");
    }
  }

  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">OVERVIEW</p><h1>Trading Dashboard</h1><p>AI-powered market intelligence and strategy monitoring.</p></div>
        <button className="primary" onClick={() => { runBacktest(); notifyTelegram(`Backtest launched for ${symbol}.`); }}>Run Backtest</button>
      </div>
      <div className="marketStrip">{(markets || []).map((m) => <button type="button" className={"marketPill " + (m.symbol === symbol ? "selected" : "")} onClick={() => setSymbol(m.symbol)} key={m.symbol}><span>{m.symbol}</span><b>{m.price.toLocaleString()}</b><em className={m.change >= 0 ? "up" : "down"}>{m.change >= 0 ? "+" : ""}{m.change}%</em></button>)}</div>
      <div className="grid4">
        {marketStats.map((item) => <Stat key={item.title} title={item.title} value={item.value} delta={item.delta} icon={item.icon} />)}
        <MarketBreadth breadth={breadth} />
      </div>
      <div className="mainGrid">
        <div className="panel chartPanel" ref={chartPanelRef}>
          <div className="panelHead">
            <div><h3>{symbol} · {chartInterval} <span className="liveDot">{market?.live ? "LIVE" : "DEMO"}</span></h3><span className="bigPrice">{Number(visibleMarket?.price || 0).toLocaleString(undefined, {maximumFractionDigits: 2}) || "—"}</span></div>
            <div className="marketChartControls">
              <label><span>Chart</span><select aria-label="Chart style" value={chartType} onChange={(event) => setChartType(event.target.value)}><option value="line">Line</option><option value="area">Area</option><option value="candlestick">Candlestick</option><option value="ohlc">OHLC bars</option></select></label>
              <label><span>Scale</span><select aria-label="Price scale" value={priceScale} onChange={(event) => setPriceScale(event.target.value)}><option value="linear">Linear</option><option value="log">Logarithmic</option><option value="percent">Percentage</option></select></label>
              <select aria-label="Chart market symbol" value={symbol} onChange={(event) => { setSymbol(event.target.value); setReplayIndex(null); setReplayPlaying(false); }}>{(markets || []).map((m) => <option key={m.symbol}>{m.symbol}</option>)}</select>
            </div>
          </div>
          <div className="chartIntervalBar" aria-label="Chart timeframe">
            {intervalChoices.map(([label, interval]) => <button key={interval} type="button" className={chartInterval === interval ? "chartToolButton active" : "chartToolButton"} aria-pressed={chartInterval === interval} onClick={() => { setChartInterval(interval); setReplayIndex(null); setReplayPlaying(false); }}>{label}</button>)}
            <span className="chartToolbarDivider" />
            <button type="button" className="chartToolButton" onClick={() => { setShowWatchlist((shown) => !shown); setShowAlertForm(false); }} aria-expanded={showWatchlist}>Watchlist</button>
            <button type="button" className="chartToolButton" onClick={() => { setShowAlertForm((shown) => !shown); setShowWatchlist(false); }} aria-expanded={showAlertForm}>＋ Alert</button>
            <button type="button" className="chartToolButton" onClick={() => {
              if (replayIndex === null) setReplayIndex(Math.max(0, Math.min(9, visibleChartSeries.length - 1)));
              else setReplayPlaying((playing) => !playing);
            }} disabled={visibleChartSeries.length < 2}>{replayIndex === null ? "◀ Replay" : replayPlaying ? "Ⅱ Pause" : "▶ Replay"}</button>
            {replayIndex !== null && <>
              <button type="button" className="chartToolButton" aria-label="Previous replay candle" onClick={() => { setReplayPlaying(false); setReplayIndex((index) => Math.max(0, (index ?? 0) - 1)); }}>◀</button>
              <button type="button" className="chartToolButton" aria-label="Next replay candle" onClick={() => { setReplayPlaying(false); setReplayIndex((index) => Math.min(visibleChartSeries.length - 1, (index ?? 0) + 1)); }}>▶</button>
              <button type="button" className="chartToolButton" onClick={() => { setReplayPlaying(false); setReplayIndex(null); }}>Exit replay</button>
            </>}
            <button type="button" className="chartToolButton" onClick={saveChartLayout}>Save</button>
            <button type="button" className="chartToolButton" onClick={resetChartLayout}>Reset</button>
            <button type="button" className="chartToolButton" onClick={downloadChartData}>Export</button>
            <button type="button" className="chartToolButton" aria-label={isChartFullscreen ? "Minimize chart" : "Maximize chart"} onClick={toggleChartFullscreen}>{isChartFullscreen ? "↙ Minimize" : "⛶ Maximize"}</button>
          </div>
          <div className="chartIndicatorBar" aria-label="Chart indicators and drawing tools">
            {[["sma", "SMA 20"], ["ema", "EMA 20"], ["bollinger", "Bollinger"]].map(([key, label]) => <button key={key} type="button" className={indicators[key] ? "chartToolButton active" : "chartToolButton"} aria-pressed={indicators[key]} onClick={() => setIndicators((current) => ({...current, [key]: !current[key]}))}>{label}</button>)}
            <button type="button" className={showVolume ? "chartToolButton active" : "chartToolButton"} aria-pressed={showVolume} onClick={() => setShowVolume((shown) => !shown)}>Volume</button>
            <span className="chartToolbarDivider" />
            <label>Draw<select aria-label="Drawing tool" value={drawingTool} onChange={(event) => { setDrawingTool(event.target.value); setPendingTrendPoint(null); }}><option value="cursor">Cursor</option><option value="horizontal">Horizontal line</option><option value="trendline">Trend line (two clicks)</option></select></label>
            <button type="button" className="chartToolButton" disabled={!drawings.length} onClick={() => setDrawings((current) => current.slice(0, -1))}>Undo drawing</button>
            <button type="button" className="chartToolButton" disabled={!drawings.length} onClick={() => setDrawings([])}>Clear drawings</button>
          </div>
          {showWatchlist && <div className="chartPopover chartWatchlist" role="region" aria-label="Market watchlist">
            <div className="chartPopoverHead"><strong>Watchlist</strong><button type="button" aria-label="Close watchlist" onClick={() => setShowWatchlist(false)}>×</button></div>
            {(markets || []).map((item) => <button key={item.symbol} type="button" className={item.symbol === symbol ? "chartWatchItem active" : "chartWatchItem"} onClick={() => { setSymbol(item.symbol); setReplayIndex(null); setReplayPlaying(false); setShowWatchlist(false); }}><span>{item.symbol}</span><b>{Number(item.price).toLocaleString()}</b><em className={item.change >= 0 ? "up" : "down"}>{formatPercent(item.change)}</em></button>)}
          </div>}
          {showAlertForm && <form className="chartPopover chartAlertForm" onSubmit={createPriceAlert}>
            <div className="chartPopoverHead"><strong>Price alert · {symbol}</strong><button type="button" aria-label="Close alert form" onClick={() => setShowAlertForm(false)}>×</button></div>
            <label>Trigger<select aria-label="Alert direction" value={alertCondition} onChange={(event) => setAlertCondition(event.target.value)}><option value="above">Price crosses above</option><option value="below">Price crosses below</option></select></label>
            <label>Price<input aria-label="Alert price" required min="0.01" step="any" type="number" value={alertPrice} onChange={(event) => setAlertPrice(event.target.value)} placeholder={lastClose ? String(lastClose) : "Enter price"} /></label>
            <button className="primary" type="submit">Create alert</button>
            {priceAlerts.filter((alert) => alert.symbol === symbol).map((alert) => <div className="chartAlertRow" key={alert.id}><span>{alert.condition} {alert.price.toLocaleString()} {alert.triggered ? "· Triggered" : "· Active"}</span><button type="button" aria-label={`Remove alert at ${alert.price}`} onClick={() => setPriceAlerts((current) => current.filter((item) => item.id !== alert.id))}>×</button></div>)}
          </form>}
          <div className="chart chartLive"><MarketPriceChart market={visibleMarket} chartType={chartType} indicators={indicators} showVolume={showVolume} priceScale={priceScale} drawings={drawings} drawingTool={drawingTool} onChartClick={handleChartDrawing} /></div>
          <div className="chartRangeBar" aria-label="Visible chart range">
            {chartRangeOptions.map(([label]) => <button key={label} type="button" className={chartRange === label ? "chartToolButton active" : "chartToolButton"} aria-pressed={chartRange === label} onClick={() => { setChartRange(label); setReplayIndex(null); setReplayPlaying(false); }}>{label}</button>)}
            <span className="chartRangeStatus">{market?.live ? "Yahoo Finance · delay possible" : "Synthetic demo feed"}{replayIndex === null ? ` · ${chartSeries.length} candles` : ` · Replay ${replayIndex + 1}/${visibleChartSeries.length}`}{market?.updated_at ? ` · Last bar ${new Date(market.updated_at).toLocaleTimeString()}` : ""}</span>
          </div>
        </div>
        <div className="panel signalPanel">
          <div className="panelHead"><h3>Strategy Signal</h3><span className="badge">RULE-BASED</span></div>
          <div className={"signal " + (signal?.signal || "HOLD").toLowerCase()}>{signal?.signal || "WAIT"}<small>{signal?.setup_status?.replaceAll("_", " ") || "WAITING FOR DATA"}</small></div>
          <div className="indicatorRows">
            <Row name="RSI" value={signal?.rsi ?? "—"} status={signal?.rsi > 70 ? "Overbought" : "Neutral"} />
            <Row name="MACD" value={signal?.macd ?? "—"} status="Trend" />
            <Row name="Strategy" value={signal?.strategy || "EMA Trend Pullback"} status="Active rule" />
          </div>
          <button className="outline" type="button" onClick={() => setShowSignalDetails(true)}>View Signal Details</button>
        </div>
      </div>
      {showSignalDetails && (
        <div className="signalDialogBackdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowSignalDetails(false);
        }}>
          <section className="signalDialog" role="dialog" aria-modal="true" aria-labelledby="signal-details-title">
            <div className="panelHead">
              <div>
                <p className="eyebrow">CURRENT MARKET SETUP</p>
                <h2 id="signal-details-title">{symbol} Signal Details</h2>
              </div>
              <button className="outline" type="button" aria-label="Close signal details" onClick={() => setShowSignalDetails(false)}>Close</button>
            </div>
            <div className="signalDetailGrid">
              <Row name="Signal" value={signal?.signal || "WAIT"} status={signal?.setup_status?.replaceAll("_", " ") || "Waiting"} />
              <Row name="Direction" value={signal?.signal === "BUY" ? "Long setup" : signal?.signal === "SELL" ? "Exit long" : "No trade"} status={market?.live ? "Provider data · delay possible" : "Synthetic demo data"} />
              <Row name="Market price" value={toCurrency(market?.price)} status={market?.updated_at ? new Date(market.updated_at).toLocaleString() : "Awaiting data"} />
              <Row name="Entry reference" value={toCurrency(signal?.entry_price)} status="Last signal close" />
              <Row name="Target scenario" value={toCurrency(signal?.target_price)} status={signal?.risk_reward ? `${signal.risk_reward}R` : "Not available"} />
              <Row name="Stop scenario" value={toCurrency(signal?.stop_loss)} status={signal?.atr_14 ? `ATR 14: ${signal.atr_14}` : "Not available"} />
              <Row name="RSI (14)" value={signal?.rsi ?? "—"} status={signal?.rsi > 70 ? "Overbought" : signal?.rsi < 30 ? "Oversold" : "Neutral"} />
              <Row name="MACD" value={signal?.macd ?? "—"} status="Trend indicator" />
            </div>
            <p className="signalDisclaimer">{signal?.rule_triggered || "No rule triggered on the latest candle."} Levels are calculated from the last close and ATR; they are scenarios, not fills or profit probabilities.</p>
            <div className="signalDialogActions">
              <button className="outline" type="button" onClick={() => setShowSignalDetails(false)}>Done</button>
              <button className="primary" type="button" onClick={() => {
                const message = `${symbol}: ${signal?.signal || "WAIT"} · ${signal?.strategy || "Strategy"}. ${signal?.rule_triggered || "No rule triggered."} Reference ${formatMarketPrice(symbol, signal?.reference_price)}, target ${formatMarketPrice(symbol, signal?.target_price)}, stop ${formatMarketPrice(symbol, signal?.stop_loss)}.`;
                addLog(message, "info");
                notifyTelegram(message);
              }}>Send details to Telegram</button>
            </div>
          </section>
        </div>
      )}
      <div className="bottomGrid">
        <div className="panel">
          <div className="panelHead"><h3>Technical Indicators</h3><span>Live</span></div>
          <div className="indicatorCards">
            <Indicator title="RSI (14)" value={signal?.rsi ?? "—"} sub="Neutral zone" />
            <Indicator title="MACD" value={signal?.macd ?? "—"} sub="Momentum" />
            <Indicator title="SMA (20)" value={market?.indicators?.sma20?.toLocaleString() ?? "—"} sub="Trend support" />
            <Indicator title="Latest volume" value={market?.series?.length ? Number(market.series.at(-1)?.volume || 0).toLocaleString() : "—"} sub="Provider volume" />
          </div>
        </div>
        <div className="panel activity">
          <div className="panelHead"><h3>Recent Signals</h3><button className="linkButton" onClick={onViewAll}>View all</button></div>
          {signal ? <><div className="signalLine"><i className={(signal.signal || "HOLD").toLowerCase()}>{signal.signal || "WAIT"}</i><b>{symbol}</b><span>{signal.bar_time ? new Date(signal.bar_time).toLocaleString() : "Latest bar"}</span><strong>{formatMarketPrice(symbol, signal.reference_price)}</strong></div><p>{signal.rule_triggered}</p></> : <p>No signal data is available yet.</p>}
        </div>
      </div>
    </>
  );
}

function ProfileDialog({profile, telegramConfig, onSave, onTestTelegram, onClose}){
  const [draft, setDraft] = useState(profile);
  const [draftTelegram, setDraftTelegram] = useState(telegramConfig);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestStatus, setTelegramTestStatus] = useState("");

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    setDraftTelegram(telegramConfig);
  }, [telegramConfig]);

  async function testTelegram(){
    setTestingTelegram(true);
    setTelegramTestStatus("");
    try {
      const delivery = await onTestTelegram(draftTelegram);
      setTelegramTestStatus(delivery.ok
        ? "Test message delivered. Check your Telegram chat."
        : `Test failed: ${delivery.error}`);
    } finally {
      setTestingTelegram(false);
    }
  }

  return (
    <div className="profileDialogBackdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form className="profileDialog" onSubmit={(event) => onSave(event, draft, draftTelegram)} role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <div className="panelHead">
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h2 id="profile-dialog-title">Personal profile</h2>
          </div>
          <button className="outline" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="profilePrivacyNote">Profile and Telegram alert settings are stored in this browser on this device.</p>
        <label>Full name<input autoComplete="name" value={draft.name || ""} onChange={(event) => setDraft((current) => ({...current, name: event.target.value}))} maxLength={80} /></label>
        <label>Email address<input type="email" autoComplete="email" value={draft.email || ""} onChange={(event) => setDraft((current) => ({...current, email: event.target.value}))} maxLength={120} /></label>
        <label>Phone number<input type="tel" autoComplete="tel" value={draft.phone || ""} onChange={(event) => setDraft((current) => ({...current, phone: event.target.value}))} maxLength={40} /></label>
        <label>Location<input autoComplete="address-level2" value={draft.location || ""} onChange={(event) => setDraft((current) => ({...current, location: event.target.value}))} maxLength={80} /></label>
        <label>Telegram bot token<input value={draftTelegram.botToken || ""} onChange={(event) => setDraftTelegram((current) => ({...current, botToken: event.target.value}))} placeholder="123456:ABCDEF" /></label>
        <label>Telegram chat ID<input value={draftTelegram.chatId || ""} onChange={(event) => setDraftTelegram((current) => ({...current, chatId: event.target.value}))} placeholder="-1001234567890" /></label>
        <p className="profilePrivacyNote">Use a Telegram bot token and your chat ID to receive signal notifications automatically.</p>
        <details className="telegramIdSuggestion">
          <summary>Suggestion: How do I find my bot token and chat ID?</summary>
          <p>Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and copy its API token; the bot ID is the number before the colon. To find your chat ID, send a message to your bot, then check <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> for <code>message.chat.id</code>.</p>
        </details>
        <div className="telegramTestActions">
          <button className="outline" type="button" onClick={testTelegram} disabled={testingTelegram}>
            {testingTelegram ? "Sending test…" : "Test Telegram connection"}
          </button>
          {telegramTestStatus && <span role="status" aria-live="polite">{telegramTestStatus}</span>}
        </div>
        <div className="profileDialogActions">
          <button className="outline" type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit">Save profile & alerts</button>
        </div>
      </form>
    </div>
  );
}

function Stat({title, value, delta, icon}){
  return <div className="stat"><div className="statIcon">{icon}</div><div><span>{title}</span><h2>{value}</h2><em>{delta} <small>vs last period</small></em></div></div>;
}

function MarketBreadth({breadth}){
  const advancingShare = breadth.total ? (breadth.advancing / breadth.total) * 100 : 0;
  const decliningShare = breadth.total ? (breadth.declining / breadth.total) * 100 : 0;

  return (
    <div className="stat breadthStat" aria-label={`Market breadth: ${breadth.advancing} advancing, ${breadth.declining} declining, ${breadth.unchanged} unchanged`}>
      <div className="statIcon">M</div>
      <div className="breadthContent">
        <span>India Market Breadth</span>
        {breadth.total ? (
          <>
            <h2>{breadth.advancing} <small>up</small> / {breadth.declining} <small>down</small></h2>
            <div className="breadthMeter" role="img" aria-label={`${advancingShare.toFixed(0)}% advancing, ${decliningShare.toFixed(0)}% declining`}>
              <span className="breadthAdvance" style={{width: `${advancingShare}%`}} />
              <span className="breadthDecline" style={{width: `${decliningShare}%`}} />
            </div>
            <em>{breadth.unchanged} unchanged · {breadth.total} tracked</em>
          </>
        ) : (
          <>
            <h2>—</h2>
            <em>Waiting for market data</em>
          </>
        )}
      </div>
    </div>
  );
}

function Row({name, value, status}){
  return <div className="row"><span>{name}</span><b>{value}</b><em>{status}</em></div>;
}

function Indicator({title, value, sub}){
  return <div className="indicator"><span>{title}</span><b>{value}</b><small>{sub}</small></div>;
}

function OptionSignalNotification({details, expanded = false}){
  const tradeType = {INTRADAY: "Intraday", BTST: "BTST", STBT: "STBT"}[details.tradeType] || details.tradeType;
  const signalDate = details.signalDate
    ? formatTradeDate(new Date(`${details.signalDate}T12:00:00`))
    : "—";

  return (
    <div className={`optionNotificationCard${expanded ? " expanded" : ""}`}>
      <div className="optionNotificationHeading">
        <strong>Index Options by TradeMind</strong>
        <span>Setup · Paper only</span>
      </div>
      <div className="optionNotificationContract">
        <b>{details.contract}</b>
        <span>{details.underlying} · {tradeType} · {details.action} {details.optionType}</span>
        <time>{signalDate} · Expiry {details.expiry}</time>
      </div>
      <div className="optionNotificationPrices">
        <div><span>Entry</span><b>{toCurrency(details.entry)}</b></div>
        <div><span>Target</span><b>{toCurrency(details.target)}</b></div>
        <div><span>SL</span><b>{toCurrency(details.stopLoss)}</b></div>
      </div>
      <small>Signal setup only. No order was placed or exited.</small>
    </div>
  );
}

function Signals({symbol, setSymbol, signal, markets, market, chartInterval, setChartInterval, strategies, selectedStrategy, setSelectedStrategy, riskRules, notifyTelegram, addLog}){
  const entry = Number(signal?.entry_price);
  const stop = Number(signal?.stop_loss);
  const target = Number(signal?.target_price);
  const completeSignalLevels = [entry, stop, target].every((value) => Number.isFinite(value) && value > 0);
  const validLongGeometry = completeSignalLevels && stop < entry && target > entry;
  const perUnitRisk = validLongGeometry ? entry - stop : 0;
  const positionRiskBudget = Number(riskRules.capitalBox || 0) * Number(riskRules.riskPerTrade || 0) / 100;
  const estimatedUnits = perUnitRisk > 0 ? Math.floor(positionRiskBudget / perUnitRisk) : 0;
  const estimatedLoss = estimatedUnits * perUnitRisk;
  const signalReward = validLongGeometry ? target - entry : 0;
  const signalRiskReward = perUnitRisk > 0 ? signalReward / perUnitRisk : null;
  const riskViolation = signal?.signal === "BUY" && (!validLongGeometry || !estimatedUnits || signalRiskReward < Number(riskRules.minimumRiskReward || 2));
  const assessmentStatus = signal?.signal !== "BUY" ? "NOT ASSESSED" : riskViolation ? "HIGH RISK · NOT APPROVED" : "WARNING · LEDGER CHECK UNAVAILABLE";
  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">RULE ENGINE</p><h1>Trading Signals</h1><p>Completed-candle setups with explicit entry and exit conditions.</p></div>
        <div className="signalToolbar"><select aria-label="Signal symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)}>{(markets || []).map((m) => <option key={m.symbol}>{m.symbol}</option>)}</select><select aria-label="Signal strategy" value={selectedStrategy} onChange={(event) => setSelectedStrategy(event.target.value)}>{strategies.map((item) => <option key={item.name}>{item.name}</option>)}</select><select aria-label="Signal timeframe" value={chartInterval} onChange={(event) => setChartInterval(event.target.value)}><option value="1m">1 minute</option><option value="2m">2 minutes</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="30m">30 minutes</option><option value="60m">1 hour</option><option value="1d">1 day</option><option value="1wk">1 week</option></select></div>
      </div>
      <div className="signalHero">
        <div>
          <span className="eyebrow">CURRENT SIGNAL</span>
          <div className={"heroSignal " + (signal?.signal || "HOLD").toLowerCase()}>{signal?.signal || "WAIT"}</div>
          <p>{signal?.setup_status?.replaceAll("_", " ") || "Waiting for market data"} · not a probability of profit</p>
        </div>
        <div className="featureList">
          <Row name="Signal candle" value={signal?.bar_time ? new Date(signal.bar_time).toLocaleString() : "—"} status="Last completed bar" />
          <Row name="RSI (14)" value={signal?.rsi ?? "—"} status="Calculated" />
          <Row name="MACD" value={signal?.macd ?? "—"} status="Calculated" />
          <Row name="Timeframe" value={signal?.timeframe || chartInterval} status="" />
          <Row name="Reference close" value={formatMarketPrice(symbol, signal?.reference_price)} status={signal?.bar_time ? new Date(signal.bar_time).toLocaleString() : "No bar"} />
          <Row name="Entry reference" value={formatMarketPrice(symbol, signal?.entry_price)} status="BUY only" />
          <Row name="Target scenario" value={formatMarketPrice(symbol, signal?.target_price)} status={signal?.risk_reward ? `${signal.risk_reward}R` : "Unavailable"} />
          <Row name="Stop scenario" value={formatMarketPrice(symbol, signal?.stop_loss)} status={signal?.atr_14 ? `1.5 ATR · ${signal.atr_14}` : "Unavailable"} />
          <Row name="Strategy" value={signal?.strategy || selectedStrategy} status={signal?.live ? "Yahoo history · delay possible" : "Synthetic demo data"} />
        </div>
      </div>
      <div className="panel signalLogPanel"><b>Rule trigger</b><p>{signal?.rule_triggered || "Waiting for market data."}</p></div>
      <section className="panel signalRiskAssessment">
        <div className="panelHead"><h3>Risk Assessment</h3><span className={riskViolation ? "riskPill danger" : signal?.signal === "BUY" ? "riskPill warning" : "riskPill neutral"}>{assessmentStatus}</span></div>
        {signal?.signal === "BUY" && completeSignalLevels ? <>
          <div className="signalRiskGrid"><Row name="Position risk budget" value={toCurrency(positionRiskBudget)} status={`${riskRules.riskPerTrade || 1}% of manual demo capital`} /><Row name="Estimated units" value={estimatedUnits > 0 ? estimatedUnits.toLocaleString() : "—"} status="Underlying units only; lot size unknown" /><Row name="Potential loss" value={estimatedUnits > 0 ? toCurrency(estimatedLoss) : "—"} status="Excludes charges and slippage" /><Row name="Potential reward" value={estimatedUnits > 0 ? toCurrency(estimatedUnits * signalReward) : "—"} status="Scenario, not forecast" /><Row name="Risk-to-reward" value={signalRiskReward ? `1:${signalRiskReward.toFixed(2)}` : "—"} status={signalRiskReward >= Number(riskRules.minimumRiskReward || 2) ? "Meets configured minimum" : "Below configured minimum"} /></div>
          {riskViolation ? <p className="warningText">Signal is not risk-approved: a BUY requires stop below entry, target above entry, positive position sizing, and the configured minimum R:R.</p> : <p className="warningText">Daily loss, current drawdown, open risk, and instrument lot constraints cannot be checked because no account or trade ledger is connected. This is not a full risk approval.</p>}
        </> : <p className="warningText">No new long-entry assessment. Missing entry, stop, or target levels are never treated as approved.</p>}
      </section>
      <p className="warningText">{signal?.note || "Signal is a technical rule output, not a validated forecast. Quotes may be delayed; confirm current prices with your broker before acting."}</p>
      <div className="panel signalLogPanel">
        <div className="panelHead"><h3>Signal alert</h3><button className="outline" onClick={() => {
          const message = `${symbol}: ${signal?.signal || "WAIT"} · ${signal?.strategy || selectedStrategy}. ${signal?.rule_triggered || "No rule triggered."} Reference ${formatMarketPrice(symbol, signal?.reference_price)}, target ${formatMarketPrice(symbol, signal?.target_price)}, stop ${formatMarketPrice(symbol, signal?.stop_loss)}.`;
          addLog(message, "info");
          notifyTelegram(message);
        }}>Send to Telegram</button></div>
      </div>
    </>
  );
}

function OptionsTrading({symbol, setSymbol, signal, markets, market, addLog}){
  const underlyings = ["NIFTY 50", "BANK NIFTY", "SENSEX"];
  const [expiry, setExpiry] = useState(() => nextOptionsExpiry(7));
  const [optionType, setOptionType] = useState("CALL");
  const [strike, setStrike] = useState(null);
  const [tradeType, setTradeType] = useState("INTRADAY");
  const [liveOptionSignal, setLiveOptionSignal] = useState(null);
  const [liveOptionError, setLiveOptionError] = useState("");
  const [liveOptionLoading, setLiveOptionLoading] = useState(true);
  const notifiedOptionSignalsRef = useRef(null);
  if (notifiedOptionSignalsRef.current === null) {
    try {
      const savedKeys = JSON.parse(localStorage.getItem("trademind-option-signal-notifications") || "[]");
      notifiedOptionSignalsRef.current = new Set(Array.isArray(savedKeys) ? savedKeys : []);
    } catch {
      notifiedOptionSignalsRef.current = new Set();
    }
  }
  const [side, setSide] = useState("BUY");
  const [quantity, setQuantity] = useState("1");
  const [orderError, setOrderError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paperOrders, setPaperOrders] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("trademind-paper-options") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  const underlying = underlyings.includes(symbol) ? symbol : "NIFTY 50";
  const selectedMarket = symbol === underlying ? market : (markets || []).find((item) => item.symbol === underlying);
  const spot = Number(selectedMarket?.price || 0);
  const strikeStep = underlying === "NIFTY 50" ? 50 : 100;
  const atmStrike = spot ? Math.round(spot / strikeStep) * strikeStep : strikeStep;
  const strikes = Array.from({length: 11}, (_, index) => atmStrike + (index - 5) * strikeStep);
  const selectedStrike = strikes.includes(Number(strike)) ? Number(strike) : atmStrike;
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToExpiry = Math.max(1, Math.ceil((expiryDate.getTime() - today.getTime()) / 86400000));
  const selectedPremium = estimateOptionPremium(spot, selectedStrike, daysToExpiry, optionType);
  const signalKey = [underlying, tradeType, liveOptionSignal?.signal, liveOptionSignal?.contract].join("|");
  const [signalMetadata, setSignalMetadata] = useState(() => createOptionsSignalMetadata(signalKey));

  useEffect(() => {
    let cancelled = false;
    async function loadLiveSignal(){
      setLiveOptionLoading(true);
      setLiveOptionError("");
      try {
        const savedSession = JSON.parse(localStorage.getItem("trademind-auth-session") || "null");
        if (!savedSession?.accessToken) throw new Error("Sign in to request a live Angel One options signal.");
        const params = new URLSearchParams({trade_type: tradeType});
        const response = await fetch(`${API}/options/signal/${encodeURIComponent(underlying)}?${params}`, {
          headers: {Authorization: `Bearer ${savedSession.accessToken}`}
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Unable to load a live options signal.");
        if (!cancelled) setLiveOptionSignal(result);
      } catch (error) {
        if (!cancelled) setLiveOptionError(error.message || "Unable to load a live options signal.");
      } finally {
        if (!cancelled) setLiveOptionLoading(false);
      }
    }
    loadLiveSignal();
    const timer = setInterval(loadLiveSignal, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [underlying, tradeType]);

  useEffect(() => {
    if (symbol !== underlying) setSymbol(underlying);
  }, [symbol, underlying, setSymbol]);

  useEffect(() => {
    setSignalMetadata((current) => current.key === signalKey ? current : createOptionsSignalMetadata(signalKey));
  }, [signalKey]);

  useEffect(() => {
    if (
      !liveOptionSignal?.contract ||
      !["BUY", "SELL"].includes(liveOptionSignal.signal) ||
      !Number.isFinite(Number(liveOptionSignal.entry_premium)) ||
      !Number.isFinite(Number(liveOptionSignal.target_premium)) ||
      !Number.isFinite(Number(liveOptionSignal.stop_loss_premium))
    ) return;

    const details = {
      underlying: liveOptionSignal.underlying,
      signal: liveOptionSignal.signal,
      contract: liveOptionSignal.contract,
      expiry: liveOptionSignal.expiry,
      tradeType: liveOptionSignal.trade_type,
      optionType: liveOptionSignal.option_type,
      action: liveOptionSignal.action,
      signalDate: liveOptionSignal.signal_date,
      entry: Number(liveOptionSignal.entry_premium),
      target: Number(liveOptionSignal.target_premium),
      stopLoss: Number(liveOptionSignal.stop_loss_premium)
    };
    const notificationKey = [
      details.underlying,
      details.signalDate,
      details.tradeType,
      details.contract,
      details.action
    ].join("|");
    if (notifiedOptionSignalsRef.current.has(notificationKey)) return;

    notifiedOptionSignalsRef.current.add(notificationKey);
    try {
      localStorage.setItem(
        "trademind-option-signal-notifications",
        JSON.stringify([...notifiedOptionSignalsRef.current].slice(-100))
      );
    } catch {}
    const message = `${details.contract} · ${details.tradeType} · ${details.signalDate} · Expiry ${details.expiry} · Entry ${toCurrency(details.entry)} · Target ${toCurrency(details.target)} · SL ${toCurrency(details.stopLoss)}`;
    addLog(message, "signal", details);
  }, [liveOptionSignal, addLog]);

  useEffect(() => {
    try { localStorage.setItem("trademind-paper-options", JSON.stringify(paperOrders.slice(0, 10))); } catch {}
  }, [paperOrders]);

  async function submitPaperOrder(event){
    event.preventDefault();
    setOrderError("");
    const units = Number(quantity);
    if (!Number.isInteger(units) || units < 1 || !selectedPremium) {
      setOrderError("Enter a positive whole-number quantity and wait for a valid underlying price.");
      return;
    }
    setSubmitting(true);
    try {
      const params = new URLSearchParams({
        symbol: underlying,
        side,
        quantity: String(units),
        price: selectedPremium.toFixed(2),
        option_type: optionType,
        strike: String(selectedStrike),
        expiry
      });
      const response = await fetch(`${API}/orders/paper?${params}`, {method: "POST"});
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Paper order was rejected.");
      const order = {...result, id: `${Date.now()}-${selectedStrike}`, created_at: new Date().toLocaleString()};
      setPaperOrders((current) => [order, ...current].slice(0, 10));
      addLog(`${side} ${units} ${underlying} ${selectedStrike} ${optionType} paper option accepted at ${toCurrency(selectedPremium)}.`, "info");
    } catch (error) {
      setOrderError(error.message || "Unable to submit the paper order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="pageHead">
        <div><p className="eyebrow">LIVE SIGNAL · PAPER ORDERS</p><h1>Options Trading</h1><p>Live Angel One listed contracts and premiums; the paper-order simulator remains separate.</p></div>
        <span className="optionDemoBadge">SIGNALS FROM ANGEL ONE · NO LIVE EXECUTION</span>
      </div>
      <div className="optionWorkspace">
        <section className="panel optionChainPanel">
          <div className="panelHead"><div><h3>Indicative options chain</h3><p className="optionSubheading">Separate simulator only; these estimates are not used in the live signal.</p></div></div>
          <div className="optionControls">
            <label>Underlying
              <select value={underlying} onChange={(event) => { setSymbol(event.target.value); setStrike(null); }}>
                {underlyings.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Simulated expiry
              <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
                {[7, 14, 30].map((days) => {
                  const date = nextOptionsExpiry(days);
                  return <option key={days} value={date}>{date} · {days}-day scenario</option>;
                })}
              </select>
            </label>
            <label>Option right
              <select value={optionType} onChange={(event) => setOptionType(event.target.value)}>
                <option value="CALL">Call</option><option value="PUT">Put</option>
              </select>
            </label>
          </div>
          <div className="optionUnderlyingStats">
            <span>Underlying spot <b>{toCurrency(spot)}</b></span>
            <span>Strike step <b>{toCurrency(strikeStep)}</b></span>
            <span>Pricing basis <b>20% assumed volatility</b></span>
          </div>
          <div className="optionChainScroll">
            <table className="optionChainTable">
              <thead><tr><th>Call premium</th><th>Call</th><th>Strike</th><th>Put</th><th>Put premium</th></tr></thead>
              <tbody>
                {strikes.map((rowStrike) => {
                  const call = estimateOptionPremium(spot, rowStrike, daysToExpiry, "CALL");
                  const put = estimateOptionPremium(spot, rowStrike, daysToExpiry, "PUT");
                  const active = selectedStrike === rowStrike;
                  return (
                    <tr className={active ? "selectedStrike" : ""} key={rowStrike}>
                      <td>{toCurrency(call)}</td>
                      <td><button type="button" className={`optionSelectButton ${optionType === "CALL" && active ? "active" : ""}`} onClick={() => { setStrike(rowStrike); setOptionType("CALL"); }}>Select</button></td>
                      <th scope="row">{rowStrike.toLocaleString("en-IN")}{rowStrike === atmStrike && <small> ATM</small>}</th>
                      <td><button type="button" className={`optionSelectButton ${optionType === "PUT" && active ? "active" : ""}`} onClick={() => { setStrike(rowStrike); setOptionType("PUT"); }}>Select</button></td>
                      <td>{toCurrency(put)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="panel optionTradePanel">
          <div className="panelHead"><div><h3>Paper trade</h3><p className="optionSubheading">No broker connection or real order placement.</p></div></div>
          <div className="optionContractSummary">
            <span>{underlying} · {selectedStrike} · {optionType}</span>
            <strong>{toCurrency(selectedPremium)}</strong>
            <small>Simulated premium · {expiry}</small>
          </div>
          <form className="optionTradeForm" onSubmit={submitPaperOrder}>
            <label>Action
              <select value={side} onChange={(event) => setSide(event.target.value)}>
                <option value="BUY">Buy</option><option value="SELL">Sell</option>
              </select>
            </label>
            <label>Quantity (units)
              <input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
            </label>
            <button className="primary" type="submit" disabled={submitting || !spot}>{submitting ? "Submitting…" : "Submit paper order"}</button>
          </form>
          {orderError && <p className="optionError" role="alert">{orderError}</p>}
          <div className="optionSignal">
            <p className="eyebrow">LIVE OPTIONS SIGNAL · {liveOptionSignal?.signal || "WAIT"} · {tradeType}</p>
            <div className="optionSignalMeta">
              <span>Signal date <b>{liveOptionSignal?.signal_date || signalMetadata.date}</b></span>
              <span>Trade No. <b>{signalMetadata.tradeNumber}</b></span>
              {liveOptionSignal?.confidence !== undefined && <span>Confidence <b>{liveOptionSignal.confidence}%</b></span>}
            </div>
            <div className="optionSignalControls">
              <label>Trade type
                <select value={tradeType} onChange={(event) => setTradeType(event.target.value)}>
                  <option value="INTRADAY">Intraday</option>
                  <option value="BTST">BTST · Buy today, sell tomorrow</option>
                  <option value="STBT">STBT · Sell today, buy tomorrow</option>
                </select>
              </label>
            </div>
            {liveOptionError ? (
              <p className="optionError" role="alert">{liveOptionError}</p>
            ) : liveOptionLoading && !liveOptionSignal ? (
              <p>Connecting to Angel One SmartAPI for live contract and quote data…</p>
            ) : liveOptionSignal?.contract ? (
              <dl className="optionSignalDetails">
                <div><dt>Signal</dt><dd>{liveOptionSignal.signal} · {liveOptionSignal.underlying}</dd></div>
                <div><dt>Exact option contract</dt><dd>{liveOptionSignal.contract}</dd></div>
                <div><dt>Expiry</dt><dd>{liveOptionSignal.expiry}</dd></div>
                <div><dt>Trade type / action</dt><dd>{liveOptionSignal.trade_type} · {liveOptionSignal.action} {liveOptionSignal.option_type}</dd></div>
                <div><dt>Live entry premium</dt><dd>{toCurrency(liveOptionSignal.entry_premium)}</dd></div>
                <div><dt>Target premium</dt><dd>{toCurrency(liveOptionSignal.target_premium)}</dd></div>
                <div><dt>Stop-loss premium</dt><dd>{toCurrency(liveOptionSignal.stop_loss_premium)}</dd></div>
                <div><dt>Underlying spot</dt><dd>{toCurrency(liveOptionSignal.spot)}</dd></div>
              </dl>
            ) : liveOptionSignal ? (
              <p>No directional options setup right now. Current {liveOptionSignal.underlying} signal: {liveOptionSignal.signal} ({liveOptionSignal.confidence}% confidence).</p>
            ) : <p>Waiting for a live signal.</p>}
            <small>{liveOptionSignal?.note || "Signal, expiry, and option premium require configured Angel One SmartAPI credentials. Target/stop levels are percentage scenarios, not guaranteed fills or investment advice."}</small>
          </div>
        </aside>
      </div>
      <section className="panel optionOrdersPanel">
        <div className="panelHead"><h3>Recent paper-order confirmations</h3><small>Saved in this browser only</small></div>
        {paperOrders.length ? (
          <div className="optionOrdersList">
            {paperOrders.map((order) => (
              <div className="optionOrderRow" key={order.id}>
                <b>{order.side} {order.quantity} {order.symbol} {order.strike} {order.option_type}</b>
                <span>{toCurrency(Number(order.price))} · {order.expiry}</span>
                <small>{order.created_at} · {order.status}</small>
              </div>
            ))}
          </div>
        ) : <p className="optionSubheading">No paper orders submitted yet.</p>}
      </section>
    </>
  );
}

function Backtesting({backtest, backtestError, runBacktest, symbol, backtestForm, setBacktestForm, strategies, savedBacktests, onLoadSavedBacktest, notifyTelegram, addLog}){
  const chartData = useMemo(() => {
    const values = backtest?.equity_curve || [];
    const labels = values.map((_, index) => backtest?.equity_timestamps?.[index]
      ? new Date(backtest.equity_timestamps[index]).toLocaleDateString()
      : `Bar ${index + 1}`);
    return {
      labels,
      datasets: [{label: "Equity", data: values, borderColor: "#62d5ff", backgroundColor: "rgba(98,213,255,.15)", fill: true, tension: 0.2, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2, spanGaps: true}]
    };
  }, [backtest]);

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">STRATEGY LAB</p><h1>Backtesting</h1><p>Historical rule-based simulation. Results depend on provider history, costs and assumptions.</p></div><button className="primary" onClick={() => { runBacktest(); notifyTelegram(`Backtest started for ${backtestForm.symbol} using ${backtestForm.strategy}.`); }}>Run {backtestForm.symbol} Test</button></div>
      <div className="panel backtestFormPanel">
        <div className="formGrid">
          <label>Market symbol<select value={backtestForm.symbol} onChange={(event) => setBacktestForm((current) => ({...current, symbol: event.target.value}))}><option>NIFTY 50</option><option>BANK NIFTY</option><option>SENSEX</option><option>RELIANCE</option><option>TCS</option><option>INFOSYS</option><option>HDFC BANK</option><option>ICICI BANK</option><option>SBIN</option><option>ITC</option><option>BHARTI AIRTEL</option><option>BTC/USDT</option><option>ETH/USDT</option></select></label>
          <label>Strategy<select value={backtestForm.strategy} onChange={(event) => setBacktestForm((current) => {
            const selected = strategies.find((strategy) => strategy.name === event.target.value);
            return {...current, strategy: event.target.value, ...(selected?.rule === "custom" ? {stopLoss: String(selected.risk_settings?.stop_loss_pct || current.stopLoss), takeProfitRR: String(selected.risk_settings?.target_r || current.takeProfitRR)} : {})};
          })}>{strategies.map((strategy) => <option key={strategy.name}>{strategy.name}</option>)}</select></label>
          <label>Timeframe<select value={backtestForm.timeframe} onChange={(event) => setBacktestForm((current) => {
            const timeframe = event.target.value;
            const durationUnit = maxDurationForUnit(timeframe, current.durationUnit) ? current.durationUnit : "days";
            const maxDuration = maxDurationForUnit(timeframe, durationUnit);
            return {...current, timeframe, durationUnit, durationValue: String(Math.min(Number(current.durationValue) || 1, maxDuration))};
          })}>
            <option value="1m">1 minute</option><option value="2m">2 minutes</option><option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="30m">30 minutes</option><option value="60m">60 minutes</option><option value="90m">90 minutes</option><option value="1h">1 hour</option><option value="1d">1 day</option><option value="5d">5 days</option><option value="1wk">1 week</option><option value="1mo">1 month</option><option value="3mo">3 months</option>
          </select></label>
          <label>Duration<div className="durationInputGroup"><input aria-label="Duration amount" type="number" min="1" max={maxDurationForUnit(backtestForm.timeframe, backtestForm.durationUnit)} step="1" required value={backtestForm.durationValue} onChange={(event) => setBacktestForm((current) => ({...current, durationValue: event.target.value}))} /><select aria-label="Duration unit" value={backtestForm.durationUnit} onChange={(event) => setBacktestForm((current) => ({...current, durationUnit: event.target.value, durationValue: "1"}))}><option value="days">Days</option><option value="months" disabled={!maxDurationForUnit(backtestForm.timeframe, "months")}>Months</option><option value="years" disabled={!maxDurationForUnit(backtestForm.timeframe, "years")}>Years</option></select></div></label>
          <label>Initial capital<input type="number" value={backtestForm.initialCapital} onChange={(event) => setBacktestForm((current) => ({...current, initialCapital: event.target.value}))} /></label>
          <label>Position budget (₹)<input type="number" min="1" value={backtestForm.positionSize} onChange={(event) => setBacktestForm((current) => ({...current, positionSize: event.target.value}))} /></label>
          <label>Protective stop loss (%)<input type="number" min="0" step="0.1" value={backtestForm.stopLoss} onChange={(event) => setBacktestForm((current) => ({...current, stopLoss: event.target.value}))} /></label>
          <label>Take-profit target (R)<input type="number" min="0.1" max="100" step="0.1" value={backtestForm.takeProfitRR || ""} onChange={(event) => setBacktestForm((current) => ({...current, takeProfitRR: event.target.value}))} /><small>Optional per-run override; blank uses the saved custom target when applicable.</small></label>
          <label>Estimated fee per side (bps)<input type="number" min="0" max="1000" step="1" value={backtestForm.feeBps || "10"} onChange={(event) => setBacktestForm((current) => ({...current, feeBps: event.target.value}))} /></label>
        </div>
      </div>
      {backtestError && <p className="warningText" role="alert">{backtestError}</p>}
      {backtest ? (
        <>
          <div className="grid4">
            <Stat title="Final Value" value={toCurrency(backtest.final_value)} delta={formatPercent(backtest.return_pct)} icon="₹" />
            <Stat title="P&L" value={toCurrency(backtest.pnl)} delta="Test result" icon="↗" />
            <Stat title="Win Rate" value={`${backtest.win_rate || 0}%`} delta={`${backtest.trades || 0} trades`} icon="W" />
            <Stat title="Max Drawdown" value={`${backtest.max_drawdown || 0}%`} delta="Risk metric" icon="↓" />
          </div>
          <div className="panel backtestQuality"><b>Trade quality after estimated fees</b><span>Profit factor: {backtest.profit_factor ?? "—"}</span><span>Average win: {toCurrency(backtest.average_win)} · Average loss: {toCurrency(backtest.average_loss)}</span><span>Expectancy: {toCurrency(backtest.expectancy)} per completed trade</span>{backtest.trades < 1 && <span>No completed trades in this sample; win rate and profit factor are not meaningful.</span>}</div>
          <div className="panel chartPanel"><div className="panelHead"><h3>{backtest.symbol} performance</h3><span>{backtest.strategy} · {backtest.duration} {backtest.duration_unit} · {backtest.bar_count} bars</span></div><p className={backtest.data_source?.includes("Synthetic") ? "warningText" : "dataSourceText"}>Data: {backtest.data_source} · {backtest.period_start} to {backtest.period_end}{backtest.warning ? ` — ${backtest.warning}` : ""}</p><div className="chart"><Line data={chartData} options={{responsive: true, maintainAspectRatio: false, interaction: {mode: "index", intersect: false}, plugins: {legend: {display: false}, tooltip: {enabled: true}}, scales: {x: {grid: {display: false}, ticks: {color: "#8190a5", autoSkip: true, maxTicksLimit: 8}}, y: {beginAtZero: false, grid: {color: "rgba(255,255,255,.05)"}, ticks: {color: "#8190a5", callback: (value) => toCurrency(Number(value))}}}}} /></div></div>
        </>
      ) : <div className="empty panel">Run a backtest to calculate P&L, win rate and maximum drawdown.</div>}
      {savedBacktests?.length > 0 && <section className="panel savedBacktestPanel"><div className="panelHead"><h3>Saved Backtest Runs</h3><span>{savedBacktests.length} recent account runs</span></div><div className="savedRunList">{savedBacktests.slice(0, 20).map((run) => <div className="savedRunRow" key={run.id}><div><strong>{run.result?.symbol || "Market"} · {run.strategy_name}</strong><small>Version {run.strategy_version || 0} · {run.result?.timeframe || "—"} · {run.created_at ? new Date(run.created_at).toLocaleString() : "Saved run"}</small></div><span className={Number(run.result?.pnl) >= 0 ? "positiveValue" : "negativeValue"}>{toCurrency(Number(run.result?.pnl || 0))}</span><button className="outline" type="button" onClick={() => onLoadSavedBacktest(run)}>Open</button></div>)}</div></section>}
    </>
  );
}

function Risk({riskRules, setRiskRules, saveRiskRules, addLog, isLoggedIn}){
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [direction, setDirection] = useState("BUY");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [instrument, setInstrument] = useState("NIFTY 50");
  const [lotSize, setLotSize] = useState("1");
  const [multiplier, setMultiplier] = useState("1");
  const [currency, setCurrency] = useState("INR");
  const updateRule = (field, value) => { setRiskRules((current) => ({...current, [field]: value})); setSaved(false); };
  const balance = Number(riskRules.capitalBox || 0);
  const entry = Number(entryPrice);
  const stop = Number(stopPrice);
  const target = Number(targetPrice);
  const lot = Number(lotSize);
  const contractMultiplier = Number(multiplier);
  const riskDistance = direction === "BUY" ? entry - stop : stop - entry;
  const rewardDistance = direction === "BUY" ? target - entry : entry - target;
  const riskBudget = balance * Number(riskRules.riskPerTrade || 0) / 100;
  const unitRisk = riskDistance * lot * contractMultiplier;
  const lots = unitRisk > 0 ? Math.floor(riskBudget / unitRisk) : 0;
  const quantity = lots * lot;
  const potentialLoss = quantity * riskDistance * contractMultiplier;
  const potentialProfit = quantity * rewardDistance * contractMultiplier;
  const riskReward = riskDistance > 0 && rewardDistance > 0 ? rewardDistance / riskDistance : null;
  const money = (value) => `${currency === "INR" ? "₹" : "$"}${Number(value).toLocaleString(currency === "INR" ? "en-IN" : "en-US", {maximumFractionDigits: 2})}`;

  async function submitRiskRules(event){
    setSaveError("");
    try {
      await saveRiskRules(event);
      setSaved(true);
      addLog("Risk rules saved to your account.", "success");
    } catch (error) {
      event.preventDefault();
      setSaveError(error.message);
    }
  }

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">PROTECTION</p><h1>Risk Management</h1><p>Rule-based limits and position sizing. Passing a check is not a profitability guarantee.</p></div><span className="statusBadge">{isLoggedIn ? "ACCOUNT SETTINGS" : "SIGN IN TO SAVE"}</span></div>
      <div className="riskOverview">
        <div className="riskMetric"><span>Configured balance</span><strong>{money(balance)}</strong><small>Manual demo capital, not a connected broker balance</small></div>
        <div className="riskMetric"><span>Available trading capital</span><strong>{money(balance)}</strong><small>Estimate based on configured demo capital</small></div>
        <div className="riskMetric"><span>Today's P&amp;L</span><strong>Not available</strong><small>No platform trade ledger connected</small></div>
        <div className="riskMetric"><span>Current drawdown</span><strong>Not available</strong><small>No actual account equity history</small></div>
      </div>
      <div className="riskOverview riskOverviewSecondary">
        <div className="riskMetric"><span>Total open risk</span><strong>Not available</strong><small>Open positions are not synced</small></div>
        <div className="riskMetric"><span>Daily loss allowance</span><strong>{money(Number(riskRules.dailyLoss || 0))}</strong><small>Limit configured; usage cannot be verified</small></div>
      </div>
      <div className="riskWorkspace">
        <form className="panel riskRulesForm" onSubmit={submitRiskRules}>
          <div className="panelHead"><h3>Risk Rules</h3><span>{isLoggedIn ? "Saved per account" : "Sign in required"}</span></div>
          <label>Manual demo capital ({currency})<input type="number" min="1" step="1000" value={riskRules.capitalBox || ""} onChange={(event) => updateRule("capitalBox", event.target.value)} required /></label>
          <label>Default risk per trade (%)<input type="number" min="0.01" max="100" step="0.1" value={riskRules.riskPerTrade || "1"} onChange={(event) => updateRule("riskPerTrade", event.target.value)} required /></label>
          <label>Maximum daily loss ({currency})<input type="number" min="0" step="100" value={riskRules.dailyLoss || "0"} onChange={(event) => updateRule("dailyLoss", event.target.value)} /></label>
          <label>Maximum drawdown (%)<input type="number" min="0" max="100" step="0.1" value={riskRules.maxDrawdown || "8"} onChange={(event) => updateRule("maxDrawdown", event.target.value)} /></label>
          <label>Maximum trades per day<input type="number" min="1" step="1" value={riskRules.maxTradesPerDay || "5"} onChange={(event) => updateRule("maxTradesPerDay", event.target.value)} /></label>
          <label>Minimum risk-to-reward<input type="number" min="0.1" step="0.1" value={riskRules.minimumRiskReward || "2"} onChange={(event) => updateRule("minimumRiskReward", event.target.value)} /></label>
          <label>Display currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="INR">INR (₹)</option><option value="USD">USD ($)</option></select></label>
          <button className="primary" type="submit" disabled={!isLoggedIn}>Save Risk Rules</button>
          {saved && <span role="status">Saved to your account.</span>}
          {saveError && <p className="warningText" role="alert">{saveError}</p>}
        </form>
        <section className="panel calculatorPanel">
          <div className="panelHead"><h3>Position Size &amp; R:R Calculator</h3><span>Uses your configured balance and risk</span></div>
          <div className="calculatorGrid">
            <label>Instrument<select value={instrument} onChange={(event) => setInstrument(event.target.value)}>{["NIFTY 50", "BANK NIFTY", "SENSEX", "GOLD", "SILVER", "BTC/USDT", "ETH/USDT", "Forex pair", "Custom"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label>
            <label>Entry price<input type="number" min="0" step="any" value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} /></label>
            <label>Stop-loss price<input type="number" min="0" step="any" value={stopPrice} onChange={(event) => setStopPrice(event.target.value)} /></label>
            <label>Target price<input type="number" min="0" step="any" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} /></label>
            <label>Lot size<input type="number" min="1" step="1" value={lotSize} onChange={(event) => setLotSize(event.target.value)} /></label>
            <label>Contract multiplier<input type="number" min="0.000001" step="any" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} /></label>
          </div>
          <div className="calculatorResults">
            <Row name="Maximum risk budget" value={money(riskBudget)} status={`${riskRules.riskPerTrade || 1}% of demo balance`} />
            <Row name="Recommended quantity" value={Number.isFinite(quantity) && quantity > 0 ? quantity.toLocaleString() : "—"} status={lots > 0 ? `${lots} lot(s)` : "Check prices and lot size"} />
            <Row name="Potential loss" value={potentialLoss > 0 ? money(potentialLoss) : "—"} status="Before fees and slippage" />
            <Row name="Potential profit" value={potentialProfit > 0 ? money(potentialProfit) : "—"} status="Before fees and slippage" />
            <Row name="Risk-to-reward" value={riskReward ? `1:${riskReward.toFixed(2)}` : "—"} status={riskReward && riskReward >= Number(riskRules.minimumRiskReward || 2) ? "Meets configured minimum" : "Below minimum or incomplete"} />
            <Row name="Break-even win rate" value={riskReward ? `${(100 / (1 + riskReward)).toFixed(1)}%` : "—"} status="Excludes costs" />
          </div>
          <p className="warningText">{instrument}: set lot size and contract multiplier from current contract specifications. The calculator does not fetch broker lot sizes, taxes, or option premiums.</p>
        </section>
      </div>
      <section className="panel drawdownNotice"><div><p className="eyebrow">DRAWDOWN MONITOR</p><h3>Equity history unavailable</h3><p>There is no connected account equity stream or completed-trade ledger, so drawdown, discipline statistics, daily lockout, and live risk alerts cannot be truthfully calculated yet.</p></div><Row name="Configured maximum drawdown" value={`${riskRules.maxDrawdown || 8}%`} status="Rule only; no observed equity" /></section>
    </>
  );
}

function Reports({backtest, exportReport, exportMessage, notifyTelegram}){
  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">ANALYTICS</p><h1>Reports</h1><p>Backtesting and strategy performance reports.</p></div></div>
      <div className="panel table">
        {backtest ? <><div className="signalLine"><b>{backtest.symbol} · {backtest.strategy}</b><span>{backtest.timeframe} · {backtest.duration} {backtest.duration_unit}</span><span>{backtest.data_source}</span><span>P&amp;L {toCurrency(backtest.pnl)}</span><button className="outline" onClick={() => { exportReport("Backtest Report", `${backtest.symbol} · ${backtest.strategy}`, `${backtest.duration} ${backtest.duration_unit}`, backtest); notifyTelegram("Backtest report exported."); }}>Export run</button></div><p>Report includes run parameters, provider status, performance metrics and the executed trade log.</p>{backtest.warning && <p className="warningText">{backtest.warning}</p>}</> : <p>Run a backtest first. Reports are generated from the last actual run and include the trade log; no sample report is shown.</p>}
        {exportMessage && <p role="status">{exportMessage}</p>}
      </div>
    </>
  );
}

function Strategies({strategies, saveStrategy, removeStrategy, onBacktest, savedBacktests, addLog, isLoggedIn}){
  const blankCondition = () => ({leftIndicator: "EMA", leftPeriod: "20", operator: "gt", rightMode: "indicator", rightIndicator: "EMA", rightPeriod: "50", rightValue: ""});
  const blankDraft = () => ({name: "", description: "", category: "Trend", symbol: "NIFTY 50", timeframe: "15m", direction: "Long", entryLogic: "AND", exitLogic: "OR", entryConditions: [blankCondition()], exitConditions: [ {...blankCondition(), leftIndicator: "CLOSE", operator: "lt", rightIndicator: "EMA", rightPeriod: "20"} ], stopLossPct: "1.5", targetR: "2", active: true});
  const [showBuilder, setShowBuilder] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [validationMessage, setValidationMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const indicatorChoices = ["CLOSE", "OPEN", "HIGH", "LOW", "VOLUME", "VOLUME_AVERAGE", "EMA", "SMA", "RSI", "ATR"];
  const operatorChoices = [["gt", "is above"], ["gte", "is at least"], ["lt", "is below"], ["lte", "is at most"], ["crosses_above", "crosses above"], ["crosses_below", "crosses below"]];
  const indicatorNeedsPeriod = (indicator) => ["EMA", "SMA", "RSI", "ATR", "VOLUME_AVERAGE"].includes(indicator);
  const describe = (condition) => `${condition.leftIndicator}${indicatorNeedsPeriod(condition.leftIndicator) ? ` ${condition.leftPeriod}` : ""} ${operatorChoices.find(([key]) => key === condition.operator)?.[1] || condition.operator} ${condition.rightMode === "indicator" ? `${condition.rightIndicator}${indicatorNeedsPeriod(condition.rightIndicator) ? ` ${condition.rightPeriod}` : ""}` : condition.rightValue || "?"}`;
  const rowsFromGroup = (group, fallback) => {
    if (!group || !Array.isArray(group.conditions)) return fallback;
    return group.conditions.filter((item) => !item.logic).map((item) => ({
      leftIndicator: item.left?.indicator || "CLOSE",
      leftPeriod: String(item.left?.period || 14),
      operator: item.operator || "gt",
      rightMode: typeof item.right === "object" ? "indicator" : "value",
      rightIndicator: item.right?.indicator || "EMA",
      rightPeriod: String(item.right?.period || 14),
      rightValue: typeof item.right === "number" ? String(item.right) : ""
    })).filter(Boolean).length ? group.conditions.filter((item) => !item.logic).map((item) => ({
      leftIndicator: item.left?.indicator || "CLOSE", leftPeriod: String(item.left?.period || 14), operator: item.operator || "gt",
      rightMode: typeof item.right === "object" ? "indicator" : "value", rightIndicator: item.right?.indicator || "EMA",
      rightPeriod: String(item.right?.period || 14), rightValue: typeof item.right === "number" ? String(item.right) : ""
    })) : fallback;
  };

  function openBuilder(strategy = null){
    if (!isLoggedIn) { setSaveError("Sign in to create and save private strategies."); setShowBuilder(true); return; }
    const base = blankDraft();
    if (strategy?.rule === "custom") {
      const definition = JSON.parse(JSON.stringify(strategy));
      setDraft({
        ...base, id: strategy.id, name: strategy.name, description: strategy.description || "", category: strategy.category || "Custom",
        symbol: strategy.symbol || base.symbol, timeframe: strategy.timeframe || base.timeframe, direction: strategy.direction || "Long",
        entryLogic: strategy.entry?.logic || "AND", exitLogic: strategy.exit?.logic || "OR",
        entryConditions: rowsFromGroup(strategy.entry, base.entryConditions), exitConditions: rowsFromGroup(strategy.exit, base.exitConditions),
        stopLossPct: String(strategy.risk_settings?.stop_loss_pct || 1.5), targetR: String(strategy.risk_settings?.target_r || 2),
        active: strategy.active !== false, existingDefinition: definition
      });
    } else {
      setDraft(base);
    }
    setValidationMessage("");
    setSaveError("");
    setShowBuilder(true);
  }

  function buildGroup(logic, rows){
    return {logic, conditions: rows.map((condition) => {
      const left = {indicator: condition.leftIndicator};
      const right = condition.rightMode === "indicator" ? {indicator: condition.rightIndicator} : Number(condition.rightValue);
      if (indicatorNeedsPeriod(condition.leftIndicator)) left.period = Number(condition.leftPeriod);
      if (condition.rightMode === "indicator" && indicatorNeedsPeriod(condition.rightIndicator)) right.period = Number(condition.rightPeriod);
      return {...condition, left, operator: condition.operator, right};
    })};
  }

  function validateDraft(){
    if (!draft.name.trim()) return "Add a strategy name.";
    if (!draft.entryConditions.length || !draft.exitConditions.length) return "At least one entry and one exit condition are required.";
    for (const condition of [...draft.entryConditions, ...draft.exitConditions]) {
      if (indicatorNeedsPeriod(condition.leftIndicator) && !(Number(condition.leftPeriod) >= 1 && Number(condition.leftPeriod) <= 500)) return "Indicator periods must be between 1 and 500.";
      if (condition.rightMode === "indicator" && indicatorNeedsPeriod(condition.rightIndicator) && !(Number(condition.rightPeriod) >= 1 && Number(condition.rightPeriod) <= 500)) return "Indicator periods must be between 1 and 500.";
      if (condition.rightMode === "value" && (!condition.rightValue.trim() || !Number.isFinite(Number(condition.rightValue)))) return "Enter a finite comparison value for every numeric condition.";
    }
    if ((draft.entryLogic === "NOT" && draft.entryConditions.length !== 1) || (draft.exitLogic === "NOT" && draft.exitConditions.length !== 1)) return "NOT groups require exactly one condition.";
    if (!(Number(draft.stopLossPct) > 0) || !(Number(draft.targetR) > 0)) return "Stop-loss percent and target R must be greater than zero.";
    return "Strategy definition is valid for the supported long-only rule engine.";
  }

  async function submitDraft(event){
    event.preventDefault();
    const validation = validateDraft();
    setValidationMessage(validation);
    if (!validation.startsWith("Strategy definition")) return;
    setSaving(true);
    setSaveError("");
    try {
      const {id, existingDefinition, entryLogic, exitLogic, entryConditions, exitConditions, stopLossPct, targetR, ...metadata} = draft;
      const saved = await saveStrategy({
        ...(id ? {id} : {}), ...metadata,
        entry: buildGroup(entryLogic, entryConditions), exit: buildGroup(exitLogic, exitConditions),
        risk_settings: {stop_loss_pct: Number(stopLossPct), target_r: Number(targetR)}
      });
      addLog(`${id ? "Updated" : "Created"} custom strategy ${saved.name} (version ${saved.version}).`, "success");
      setShowBuilder(false);
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function duplicateStrategy(strategy){
    if (strategy.rule !== "custom") {
      setSaveError("Built-in template rules cannot be duplicated as custom rules until all their price-action semantics are represented by the builder.");
      setShowBuilder(true);
      return;
    }
    openBuilder(strategy);
    setDraft((current) => ({...current, id: undefined, name: `${strategy.name} copy`}));
  }

  function updateCondition(groupName, index, field, value){
    setDraft((current) => ({...current, [groupName]: current[groupName].map((condition, conditionIndex) => conditionIndex === index ? {...condition, [field]: value} : condition)}));
  }

  function conditionEditor(title, groupName, logicName){
    const rows = draft[groupName];
    return <section className="builderConditionSection">
      <div className="panelHead"><h3>{title}</h3><label>Combine<select value={draft[logicName]} onChange={(event) => setDraft((current) => ({...current, [logicName]: event.target.value}))}><option value="AND">All (AND)</option><option value="OR">Any (OR)</option></select></label></div>
      {rows.map((condition, index) => <div className="conditionRow" key={`${groupName}-${index}`}>
        <label>Left<select value={condition.leftIndicator} onChange={(event) => updateCondition(groupName, index, "leftIndicator", event.target.value)}>{indicatorChoices.map((item) => <option key={item}>{item}</option>)}</select></label>
        {indicatorNeedsPeriod(condition.leftIndicator) && <label>Period<input type="number" min="1" max="500" value={condition.leftPeriod} onChange={(event) => updateCondition(groupName, index, "leftPeriod", event.target.value)} /></label>}
        <label>Operator<select value={condition.operator} onChange={(event) => updateCondition(groupName, index, "operator", event.target.value)}>{operatorChoices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Compare to<select value={condition.rightMode} onChange={(event) => updateCondition(groupName, index, "rightMode", event.target.value)}><option value="indicator">Indicator</option><option value="value">Number</option></select></label>
        {condition.rightMode === "indicator" ? <><label>Right<select value={condition.rightIndicator} onChange={(event) => updateCondition(groupName, index, "rightIndicator", event.target.value)}>{indicatorChoices.map((item) => <option key={item}>{item}</option>)}</select></label>{indicatorNeedsPeriod(condition.rightIndicator) && <label>Period<input type="number" min="1" max="500" value={condition.rightPeriod} onChange={(event) => updateCondition(groupName, index, "rightPeriod", event.target.value)} /></label>}</> : <label>Value<input type="number" step="any" value={condition.rightValue} onChange={(event) => updateCondition(groupName, index, "rightValue", event.target.value)} /></label>}
        <button className="iconButton" type="button" aria-label={`Remove ${title.toLowerCase()} condition ${index + 1}`} onClick={() => setDraft((current) => ({...current, [groupName]: current[groupName].filter((_, conditionIndex) => conditionIndex !== index)}))} disabled={rows.length === 1}>Remove</button>
      </div>)}
      <button className="outline" type="button" onClick={() => setDraft((current) => ({...current, [groupName]: [...current[groupName], blankCondition()]}))} disabled={rows.length >= 100}>Add condition</button>
    </section>;
  }

  return (
    <>
      <div className="pageHead"><div><p className="eyebrow">STRATEGY LAB</p><h1>Strategies</h1><p>Build, version, inspect, and backtest executable trading rules.</p></div><button className="primary" onClick={() => openBuilder()}>Create Custom Strategy</button></div>
      {!isLoggedIn && <p className="warningText">Sign in to save, edit, or backtest private custom strategies. Built-in strategies remain available.</p>}
      <section className="strategySection"><div className="sectionHeading"><div><p className="eyebrow">MY STRATEGIES</p><h2>Saved rules</h2></div><span>{strategies.filter((item) => item.rule === "custom").length} custom</span></div>
        <div className="strategyGrid">{strategies.map((strategy) => {
          const isCustom = strategy.rule === "custom";
          const entrySummary = isCustom ? (strategy.entry?.conditions || []).map((condition) => condition.logic ? "Nested rule group" : `${condition.left?.indicator || "?"} ${condition.operator} ${typeof condition.right === "object" ? condition.right.indicator : condition.right}`).join(strategy.entry?.logic === "OR" ? " OR " : " AND ") : strategy.entryRules?.join(" ");
          const exitSummary = isCustom ? (strategy.exit?.conditions || []).map((condition) => condition.logic ? "Nested rule group" : `${condition.left?.indicator || "?"} ${condition.operator} ${typeof condition.right === "object" ? condition.right.indicator : condition.right}`).join(strategy.exit?.logic === "AND" ? " AND " : " OR ") : strategy.exitRules?.join(" ");
          return <article className="panel strategyCard" key={strategy.id || strategy.rule}>
            <div className="strategyCardTop"><span className={`badge ${isCustom ? "" : "muted"}`}>{isCustom ? `CUSTOM · V${strategy.version || 1}` : "BUILT IN"}</span><span className={strategy.active === false ? "statusInactive" : "statusActive"}>{strategy.active === false ? "Inactive" : "Active"}</span></div>
            <h3>{strategy.name}</h3><p>{strategy.description || strategy.style || "Rule-based strategy"}</p>
            <div className="strategyRuleSummary"><b>Entry</b><span>{entrySummary || "No entry summary"}</span><b>Exit</b><span>{exitSummary || "No exit summary"}</span></div>
            <div className="strategyMeta"><span>{strategy.category || "Technical"}</span><span>{strategy.direction || "Long"}</span><span>{strategy.symbol || "Multi-market"}</span><span>{strategy.timeframe || "Multiple timeframes"}</span><span>{strategy.risk || "Risk configured per backtest"}</span></div>
            <div className="strategyActions"><button className="outline" type="button" onClick={() => setViewing(viewing === strategy.name ? null : strategy.name)}>View Details</button><button className="outline" type="button" onClick={() => onBacktest(strategy)}>Backtest</button>{isCustom && <><button className="outline" type="button" onClick={() => openBuilder(strategy)}>Edit</button><button className="outline" type="button" onClick={() => duplicateStrategy(strategy)}>Duplicate</button><button className="outline" type="button" onClick={async () => { try { await saveStrategy({...strategy, active: strategy.active === false}); } catch (error) { setSaveError(error.message); } }}>Activate / Deactivate</button><button className="dangerButton" type="button" onClick={async () => { try { await removeStrategy(strategy); } catch (error) { setSaveError(error.message); } }}>Delete</button></>}</div>
            {viewing === strategy.name && <div className="strategyDetail"><Row name="Category" value={strategy.category || "Built-in"} status="" /><Row name="Direction" value={strategy.direction || "Long only"} status="" /><Row name="Backtests" value={strategy.backtest_count ?? savedBacktests.filter((run) => run.strategy_name === strategy.name).length} status="Saved runs" />{strategy.latest_backtest?.result && <><Row name="Latest P&L" value={toCurrency(strategy.latest_backtest.result.pnl)} status={`${strategy.latest_backtest.result.win_rate ?? "—"}% win rate`} /><Row name="Profit factor" value={strategy.latest_backtest.result.profit_factor ?? "—"} status={`Max DD ${strategy.latest_backtest.result.max_drawdown ?? "—"}%`} /></>}<p>{isCustom ? `Version ${strategy.version || 1} · ${strategy.updated_at || "Saved to account"}` : "Built-in rule documentation"}</p></div>}
          </article>;
        })}</div>
      </section>
      <section className="strategySection"><div className="sectionHeading"><div><p className="eyebrow">STRATEGY TEMPLATES</p><h2>Executable built-ins</h2></div></div><div className="templateList">{defaultStrategies.map((template) => <div className="templateRow" key={template.rule}><div><strong>{template.name}</strong><p>{template.description}</p></div><button className="outline" type="button" onClick={() => onBacktest(template)}>Backtest template</button></div>)}</div></section>
      <section className="strategySection"><div className="sectionHeading"><div><p className="eyebrow">STRATEGY PERFORMANCE</p><h2>Recent saved results</h2></div><span>Actual completed backtests only</span></div>{savedBacktests.length ? <div className="templateList">{savedBacktests.slice(0, 10).map((run) => <div className="templateRow" key={`performance-${run.id}`}><div><strong>{run.strategy_name} · {run.result?.symbol || "Market"}</strong><p>Net P&amp;L {toCurrency(Number(run.result?.pnl || 0))} · {run.result?.trades || 0} trades · {run.result?.win_rate ?? "—"}% win rate · {run.result?.max_drawdown ?? "—"}% max drawdown</p></div><button className="outline" type="button" onClick={() => onBacktest({name: run.strategy_name, symbol: run.result?.symbol, timeframe: run.result?.timeframe})}>Run again</button></div>)}</div> : <p className="empty panel">No saved backtest performance is available for this account yet.</p>}</section>
      {saveError && <p className="warningText" role="alert">{saveError}</p>}
      {showBuilder && <div className="builderBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBuilder(false); }}><form className="strategyBuilder" onSubmit={submitDraft}>
        <div className="builderHeader"><div><p className="eyebrow">NO-CODE RULE EDITOR</p><h2>{draft.id ? `Edit ${draft.name}` : "Create custom strategy"}</h2></div><button className="iconButton" type="button" aria-label="Close strategy builder" onClick={() => setShowBuilder(false)}>Close</button></div>
        {!isLoggedIn ? <p className="warningText">Sign in to save private strategy definitions.</p> : <>
          <section className="builderBasic"><h3>Basic information</h3><div className="builderGrid">
            <label>Strategy name<input maxLength="80" value={draft.name} onChange={(event) => setDraft((current) => ({...current, name: event.target.value}))} required /></label>
            <label>Category<select value={draft.category} onChange={(event) => setDraft((current) => ({...current, category: event.target.value}))}><option>Trend</option><option>Mean reversion</option><option>Breakout</option><option>Price action</option><option>Custom</option></select></label>
            <label>Instrument<select value={draft.symbol} onChange={(event) => setDraft((current) => ({...current, symbol: event.target.value}))}>{[...new Set(["NIFTY 50", "BANK NIFTY", "SENSEX", "RELIANCE", "BTC/USDT", "ETH/USDT", draft.symbol])].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Timeframe<select value={draft.timeframe} onChange={(event) => setDraft((current) => ({...current, timeframe: event.target.value}))}>{["1m", "5m", "15m", "30m", "60m", "1d", "1wk"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Direction<select value={draft.direction} onChange={(event) => setDraft((current) => ({...current, direction: event.target.value}))}><option>Long</option><option disabled>Short (not supported by current simulator)</option><option disabled>Both (not supported by current simulator)</option></select></label>
            <label>Description<input maxLength="1000" value={draft.description} onChange={(event) => setDraft((current) => ({...current, description: event.target.value}))} /></label>
          </div></section>
          {conditionEditor("Entry conditions", "entryConditions", "entryLogic")}
          {conditionEditor("Exit conditions", "exitConditions", "exitLogic")}
          <details className="builderAdvanced" open={showAdvanced} onToggle={(event) => setShowAdvanced(event.currentTarget.open)}><summary>Risk and execution settings</summary><div className="builderGrid"><label>Protective stop loss (%)<input type="number" min="0.01" max="100" step="0.1" value={draft.stopLossPct} onChange={(event) => setDraft((current) => ({...current, stopLossPct: event.target.value}))} /></label><label>Target risk multiple<input type="number" min="0.1" step="0.1" value={draft.targetR} onChange={(event) => setDraft((current) => ({...current, targetR: event.target.value}))} /></label></div></details>
          <section className="logicPreview"><p className="eyebrow">LOGIC PREVIEW</p><h3>{draft.name || "Untitled strategy"}</h3><p><b>Entry ({draft.entryLogic}):</b> {draft.entryConditions.map(describe).join(draft.entryLogic === "AND" ? " AND " : " OR ")}</p><p><b>Exit ({draft.exitLogic}):</b> {draft.exitConditions.map(describe).join(draft.exitLogic === "AND" ? " AND " : " OR ")}</p><p><b>Risk:</b> {draft.stopLossPct}% protective stop · {draft.targetR}R target · {draft.direction} only · {draft.timeframe}</p></section>
          <div className="builderFooter"><button className="outline" type="button" onClick={() => setValidationMessage(validateDraft())}>Validate rules</button><span role="status">{validationMessage}</span><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save new version" : "Save strategy"}</button></div>
          {saveError && <p className="warningText" role="alert">{saveError}</p>}
        </>}
      </form></div>}
    </>
  );
}

export default App;
