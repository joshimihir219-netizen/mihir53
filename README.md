# AI Trading Dashboard

For questions or help with the dashboard, contact [fultonskipz44@gmail.com](mailto:fultonskipz44@gmail.com).

## Live market-data mode
The dashboard now attempts to load current market data through Yahoo Finance using `yfinance` from the FastAPI backend. It refreshes automatically every 15 seconds.

Supported symbols:
- NIFTY 50 (`^NSEI`)
- BANK NIFTY (`^NSEBANK`)
- SENSEX (`^BSESN`)
- RELIANCE, TCS, INFOSYS, HDFC BANK, ICICI BANK, SBIN, ITC, BHARTI AIRTEL (Yahoo Finance NSE symbols)
- BTC/USDT (`BTC-USD`)
- ETH/USDT (`ETH-USD`)

**Important:** Yahoo Finance data availability and exchange delays depend on the instrument/exchange. The app visibly falls back to demo data if the provider is unavailable. This is not a guaranteed tick-by-tick feed.

The dashboard chart supports line, area, candlestick, and OHLC views; 1-minute through monthly intervals; 1D-to-1Y range shortcuts; linear, logarithmic, and percentage price scales; volume, SMA (20), EMA (20), and Bollinger overlays; horizontal and trend-line drawings; watchlist selection; and price-crossing alerts. Replay steps through the loaded candles, and chart data can be exported as CSV. Save stores chart settings in the browser. Quotes and candles are sourced through Yahoo Finance and may be delayed or unavailable. For exchange-authoritative real-time quotes, connect an authorized broker or exchange market-data feed.

Read-only option contract analysis in the Signals page uses Angel One SmartAPI for live index candles, listed option contracts, exchange expiries, and option LTP quotes. It uses the nearest listed expiry and closest-to-spot strike, maps BUY to CE and SELL to PE (STBT uses the opposite right and sells), and calculates target/stop scenarios from the live premium (25%/20% for buys; 20%/25% for sells). TradeMind does not provide option-chain simulations, paper orders, or order/position management. Configure backend credentials before using live option analysis by editing `backend/.env`:

```dotenv
ANGELONE_API_KEY=your-api-key
ANGELONE_CLIENT_CODE=your-client-code
ANGELONE_PASSWORD=your-password-or-pin
ANGELONE_TOTP_SECRET=your-totp-secret
```

The backend loads this file automatically on startup. It is excluded from version control; keep credentials out of frontend code and never commit or share them. Restart the backend after editing it. Docker Compose also reads this file. Without credentials or if Angel One is unavailable, the Signals page shows the provider error and does not substitute demo values. Signal direction is a rule-based estimate, and target/stop prices are scenarios, not guaranteed fills or investment advice.

Backtesting supports Yahoo Finance intervals from 1 minute through 3 months (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, and 3mo), plus a duration amount selectable in days, months, or years. Yahoo limits how far intraday intervals reach into history: 1-minute uses up to 7 days and other intraday intervals use up to 60 days. Daily intervals support up to 5 years, and weekly/monthly intervals up to 10 years. Duration units that exceed a timeframe's available history are disabled. Actual availability depends on the instrument and Yahoo Finance. If the provider is unavailable, the backtest returns an error instead of calculating performance from synthetic demo candles.

## Strategy rules
The strategy engine implements 18 deterministic, long-only templates: Price Action Break & Retest, Smart Money Structure (SMC), ICT Liquidity Sweep, EMA Trend Pullback, Donchian Trend Breakout, VWAP Reversal, RSI Mean Reversion, MACD Momentum, ADX Trend Following, Bollinger Band Breakout, Previous Day High/Low Breakout, Volume-Based Breakout, Opening Range Breakout, Support and Resistance Reversal, Fair Value Gap Retracement, Order Block Mitigation, Supertrend Trend Following, and ATR Volatility Breakout. Signals use completed candles, require a 50-candle warm-up, and are filled at the next candle's open in backtests. SMC/ICT/order-block/FVG definitions are simplified deterministic interpretations; these concepts do not have a single standardized algorithm.

- **Price Action Break & Retest:** A close breaks above the highest high of the prior 20 bars. The next bar must retest within 0.3% of that level and close bullish above it. Exit on a close below prior 10-bar support or EMA 20.
- **Smart Money Structure (SMC):** A close breaks the prior 20-bar structure high. Within 10 bars, price must retest the full range of the last bearish candle from the five bars before the break and close bullish above its midpoint. The setup expires after 10 bars or a close below the block low. Exit on prior 10-bar support or EMA 20.
- **ICT Liquidity Sweep:** Price sweeps below the prior 20-bar low and closes back above. Within four bars, a bullish candle body of at least 0.8 ATR(14) must break the prior 5-bar high and form a three-candle bullish fair-value gap. Exit on prior 10-bar support or EMA 20.
- **EMA Trend Pullback:** EMA 20 and price are above EMA 50. One of the prior three lows must touch EMA 20; the current candle must close bullish above EMA 20. Exit below EMA 20 or when EMA 20 falls below EMA 50.
- **Donchian Trend Breakout:** A close crosses above the prior 20-bar high while EMA 20 is above EMA 50. Exit below the prior 10-bar low or when EMA 20 falls below EMA 50.
- **VWAP Reversal:** Session VWAP deviation plus a bullish close; exit on a return to VWAP.
- **RSI Mean Reversion:** RSI(14) below 30 and rising with a bullish candle; exit on RSI normalization or a close above the 20-bar mean.
- **MACD Momentum:** Bullish MACD(12,26,9) crossover above zero; exit on bearish crossover.
- **ADX Trend Following:** ADX(14) above 25, +DI cross, and price above EMA 20; exit on DI reversal or ADX below 18.
- **Bollinger Band Breakout:** Close crosses above the 20-bar upper band; exit below the 20-bar mean or prior support.
- **Previous Day High/Low Breakout:** Intraday close crosses the prior observed daily high; exit below that session's low or EMA 20.
- **Volume-Based Breakout:** Prior 20-bar resistance break with volume above 1.5 times the preceding 20-bar average.
- **Opening Range Breakout:** After the first 30 minutes in the observed session, close breaks above that range's high.
- **Support and Resistance Reversal:** Bullish close rejects prior 20-bar support within 0.2%.
- **Fair Value Gap Retracement:** A three-candle bullish gap sets a zone; a bullish mitigation close within ten bars triggers entry.
- **Order Block Mitigation:** Bullish displacement above prior 10-bar structure sets a last-bearish-candle zone; enter on a later bullish mitigation.
- **Supertrend Trend Following:** Enter on a bullish flip of a trailing 3×ATR(14) Supertrend state; exit on a bearish flip.
- **ATR Volatility Breakout:** Prior 20-bar high plus 0.1 ATR break with ATR/price above its trailing 50-bar median.

Authenticated users can create private custom strategies from bounded indicator comparisons (OHLCV, EMA, SMA, RSI, ATR, and average volume), numeric thresholds, AND/OR/NOT groups, and nested structured definitions sent to the same causal evaluator for signals and backtests. Strategy edits create immutable definition versions. Custom rules currently execute long-only on one selected timeframe; the builder does not yet expose the full set of requested price-action/SMC detectors, per-condition timeframes, short positions, partial exits, or arbitrary nested-group editing. It never executes user-supplied code.

For BUY setups only, the reference is the signal candle's close, the stop scenario is 1.5 ATR(14) below it, and the target scenario is 2R above it. These are not fills or probabilities. A saved custom strategy has a percentage stop and R-multiple target in backtests. Saved risk rules and account backtests are user-scoped. The risk page uses explicitly manual demo capital and cannot report actual account balance, daily P&L, open risk, drawdown history, or discipline statistics without a connected broker/trade ledger. A signal risk panel cannot validate daily loss limits or instrument lot specifications.

Backtest entries/exits generated by a completed bar execute at the next bar's open. Available bars before the selected start date warm up the strategy indicators; only bars inside the selected period contribute to the equity curve and metrics. Protective stops are checked against candle lows, and a gap through a stop fills at the worse observed open. Position size supports fractional units for research and does not enforce exchange lot sizes. Fees are a user estimate per side. The simulator does not model taxes, exact brokerage schedules, slippage, market impact, liquidity, corporate actions, or exchange-specific order behavior. Yahoo history can be delayed or adjusted and is not exchange-authoritative. These rules are educational hypotheses, not validated profitable strategies or investment advice; validate on licensed data and paper trading.

For bars that touch both a custom take-profit and stop-loss in the same OHLC candle, the simulator assumes the stop was reached first. This conservative assumption does not reconstruct intrabar sequencing. The UI does not currently provide custom date ranges, optimization/walk-forward analysis, strategy comparison, PDF reports, live risk lockouts, or historical options backtests. No historical options premium feed or AI natural-language strategy provider is configured; options built from underlying prices are not presented as historical options performance.

## Run
### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```

## Accounts
TradeMind temporarily uses username and password authentication only. Signup requires a unique username, password, and confirmation; passwords remain salted PBKDF2-SHA256 hashes. Sessions are opaque server-side tokens sent in HttpOnly cookies, with login/signup throttling and server-side logout revocation. Email verification, password reset, username recovery, and their API routes are disabled during this temporary mode. No email provider credentials are needed.

Existing accounts and dashboard data are preserved. Existing `email`, `email_verified`, and auth-token schema fields are intentionally retained but are not read or written by username authentication; new accounts leave email fields empty. The case-insensitive database username constraint remains active. Existing browser sessions continue through the server-side cookie/bearer compatibility check.

For Vercel, configure a persistent PostgreSQL connection as `DATABASE_URL` (the backend also recognizes `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`) in **Settings → Environment Variables**. No Resend, sender, or email-link variables are required while email auth is disabled. After deployment, `/api/health` should report `database: "postgresql"` and `persistent_storage: true`. Local accounts use SQLite at `backend/trademind-auth.sqlite3` by default; `TRADEMIND_AUTH_DB` selects another path.

Run the backend regression suite from `backend/` with `python -m unittest test_auth test_backtest` after installing `requirements.txt`. Tests use temporary SQLite databases and do not modify existing accounts.

## Admin console
The admin console is available at `/admin` on the same host as TradeMind (for example, `https://your-vercel-domain/admin`; locally, `http://localhost:5173/admin`). It reuses the normal username/password login and server-side session cookie. Only accounts with the database role `ADMIN` can load the console or call `/api/admin/*`; ordinary accounts are returned to the user dashboard.

After deploying the code, the backend applies additive migrations on startup: existing accounts receive the default `USER` role and `ACTIVE` status, existing strategies receive a private/unpublished flag, and admin activity, feedback, signal-history, and platform-settings tables are created if absent. Existing account and strategy data is preserved. No new Vercel environment variable is required beyond the existing persistent `DATABASE_URL` setting.

To create the first administrator, run the CLI from `backend/` against the same Neon database used by Vercel. Keep the existing `DATABASE_URL` configured in Vercel. For the one-time setup, set that same connection string and the requested admin credentials in your local shell; do not add `ADMIN_PASSWORD` to Vercel's persistent runtime environment. The password prompt below does not echo the value:

```bash
cd backend
export DATABASE_URL="<existing Neon connection string>"
export ADMIN_USERNAME="<chosen admin username>"
printf 'Initial admin password: '
read -rs ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
python promote_admin.py
unset ADMIN_USERNAME ADMIN_PASSWORD
```

Supply the values locally using your shell or secret manager; do not put credentials in source files or Vercel's persistent runtime environment. The password must be 12-128 characters and is stored only as the application's salted PBKDF2-SHA256 hash. The script refuses to overwrite an existing username or run if an administrator already exists. `TRADEMIND_INITIAL_ADMIN_USERNAME` and `TRADEMIND_INITIAL_ADMIN_PASSWORD` remain supported as backward-compatible aliases. To promote an already registered user instead, run `python promote_admin.py existing_username` against the same database. Local SQLite requires the explicit `--local` option.

After creation or promotion, visit `/admin` and sign in with that account. The admin sign-in screen reuses the existing username/password session service, but is separate from public signup. Further role changes are available only in the protected user-management screen; administrators cannot change their own role or lock themselves out, and the last active administrator cannot be suspended or demoted.

The console manages existing users, stored strategies and backtests, provider-backed signal checks, platform risk defaults, feedback, and administrator activity. Published strategies appear in users' strategy lists but remain read-only to their owners. Signal snapshots are stored only when real provider candles are available; unavailable markets show `NO DATA`. Feedback is submitted from the user sidebar and can be triaged in the console. Platform risk defaults do not overwrite individual account risk settings.

## Telegram signal alerts
After signing in, open the profile settings and enter a Telegram bot token and chat ID, then use **Test Telegram connection** to confirm delivery. Create the bot with Telegram's BotFather and send it `/start` from the target chat before testing; a bot cannot start a private chat on its own. Signal alerts are sent by the backend through the Telegram Bot API when the selected signal changes. Keep the dashboard open and signed in to receive automatic alerts. Telegram settings are stored in this browser, so only save a bot token on a device you trust.

## Trading safety
TradeMind is an analysis-only platform. It does not submit real or simulated orders and does not manage broker positions.
