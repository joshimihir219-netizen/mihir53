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

Options trading uses Angel One SmartAPI for live index candles, listed option contracts, exchange expiries, and option LTP quotes. Signals use the nearest listed expiry and closest-to-spot strike, map BUY to CE and SELL to PE (STBT uses the opposite right and sells), and calculate target/stop scenarios from the live premium (25%/20% for buys; 20%/25% for sells). Configure backend credentials before using the live signals by editing `backend/.env`:

```dotenv
ANGELONE_API_KEY=your-api-key
ANGELONE_CLIENT_CODE=your-client-code
ANGELONE_PASSWORD=your-password-or-pin
ANGELONE_TOTP_SECRET=your-totp-secret
```

The backend loads this file automatically on startup. It is excluded from version control; keep credentials out of frontend code and never commit or share them. Restart the backend after editing it. Docker Compose also reads this file. Without credentials or if Angel One is unavailable, the live signal panel shows the provider error and does not substitute demo values. The separate options-chain display and paper-order form remain theoretical simulators and are not used for live signal prices. Signal direction is a rule-based estimate, and target/stop prices are scenarios—not guaranteed fills or investment advice. Paper-order confirmations are stored in the browser only; no broker order execution is connected.

Backtesting supports Yahoo Finance intervals from 1 minute through 3 months (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, and 3mo), plus a duration amount selectable in days, months, or years. Yahoo limits how far intraday intervals reach into history: 1-minute uses up to 7 days and other intraday intervals use up to 60 days. Daily intervals support up to 5 years, and weekly/monthly intervals up to 10 years. Duration units that exceed a timeframe's available history are disabled. Actual availability depends on the instrument and Yahoo Finance. If the provider is unavailable, the backtest returns an error instead of calculating performance from synthetic demo candles.

## Strategy rules
The strategy engine implements five deterministic, long-only templates. Signals use completed candles, require a 50-candle warm-up, and are filled at the next candle's open in backtests. The names SMC and ICT describe explicit, simplified rule interpretations for this app; those trading concepts have no single standardized algorithm.

- **Price Action Break & Retest:** A close breaks above the highest high of the prior 20 bars. The next bar must retest within 0.3% of that level and close bullish above it. Exit on a close below prior 10-bar support or EMA 20.
- **Smart Money Structure (SMC):** A close breaks the prior 20-bar structure high. Within 10 bars, price must retest the full range of the last bearish candle from the five bars before the break and close bullish above its midpoint. The setup expires after 10 bars or a close below the block low. Exit on prior 10-bar support or EMA 20.
- **ICT Liquidity Sweep:** Price sweeps below the prior 20-bar low and closes back above. Within four bars, a bullish candle body of at least 0.8 ATR(14) must break the prior 5-bar high and form a three-candle bullish fair-value gap. Exit on prior 10-bar support or EMA 20.
- **EMA Trend Pullback:** EMA 20 and price are above EMA 50. One of the prior three lows must touch EMA 20; the current candle must close bullish above EMA 20. Exit below EMA 20 or when EMA 20 falls below EMA 50.
- **Donchian Trend Breakout:** A close crosses above the prior 20-bar high while EMA 20 is above EMA 50. Exit below the prior 10-bar low or when EMA 20 falls below EMA 50.

Signals show the actual rule trigger. For BUY setups only, the reference is the signal candle's close, the stop scenario is 1.5 ATR(14) below it, and the target scenario is 2R above it. These are not fills or probabilities. A custom strategy name only selects one of the five executable templates; risk labels are descriptive settings and do not alter sizing or execution.

Backtest entries/exits generated by a completed bar execute at the next bar's open. Available bars before the selected start date warm up the strategy indicators; only bars inside the selected period contribute to the equity curve and metrics. Protective stops are checked against candle lows, and a gap through a stop fills at the worse observed open. Position size supports fractional units for research and does not enforce exchange lot sizes. Fees are a user estimate per side. The simulator does not model taxes, exact brokerage schedules, slippage, market impact, liquidity, corporate actions, or exchange-specific order behavior. Yahoo history can be delayed or adjusted and is not exchange-authoritative. These rules are educational hypotheses, not validated profitable strategies or investment advice; validate on licensed data and paper trading.

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
Create an account from the login screen before signing in. Locally, usernames and hashed passwords are stored in the backend SQLite database at `backend/trademind-auth.sqlite3` by default. Set `TRADEMIND_AUTH_DB` to choose a different SQLite path. Existing browser-only sessions are not server accounts, so those users need to sign up once.

For persistent accounts on Vercel, create a PostgreSQL database in Neon and add its pooled connection string as the `DATABASE_URL` environment variable in the Vercel project's **Settings → Environment Variables**. Keep the connection string private, enable it for Production (and Preview if needed), then redeploy so the backend can create its tables in Neon. The backend also recognizes `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`. Until a database URL is configured, account signup and login are disabled on Vercel instead of writing accounts to unreliable temporary storage; `/api/health` reports `database: "not_configured"`. Use `/api/health` after redeployment to confirm it reports `database: "postgresql"` and `persistent_storage: true`. The backend creates the account tables automatically; any accounts previously created on temporary storage are not migrated, so users must sign up again.

## Telegram signal alerts
After signing in, open the profile settings and enter a Telegram bot token and chat ID, then use **Test Telegram connection** to confirm delivery. Create the bot with Telegram's BotFather and send it `/start` from the target chat before testing; a bot cannot start a private chat on its own. Signal alerts are sent by the backend through the Telegram Bot API when the selected signal changes. Keep the dashboard open and signed in to receive automatic alerts. Telegram settings are stored in this browser, so only save a bot token on a device you trust.

## Trading safety
The included `/api/orders/paper` endpoint is **paper trading only**. No real orders are sent to a broker.

For real-money order execution, the project must be connected to a broker API such as Zerodha Kite Connect, Upstox, Angel One SmartAPI, or another broker supported by the user's account. Broker choice, API credentials, authentication flow, order types, and exchange permissions must be configured explicitly before enabling live execution.
