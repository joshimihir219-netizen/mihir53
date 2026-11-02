import React, {useEffect, useState} from "react";
import {
  Activity, ArrowLeft, Ban, Check, FileClock, Layers3, LayoutDashboard,
  LogOut, MessageSquare, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  Trash2, Users, X
} from "lucide-react";
import "./admin-panel.css";

const API = "/api";
const NAV_ITEMS = [
  ["Overview", LayoutDashboard], ["Users", Users], ["Strategies", Layers3],
  ["AI Signals", Activity], ["Backtesting", FileClock], ["Risk Settings", ShieldCheck],
  ["Feedback", MessageSquare], ["Admin Settings", Settings2]
];
const EMPTY_OVERVIEW = {
  users: {total: 0, active: 0, suspended: 0},
  strategies: {total: 0, active: 0, published: 0},
  signals: {total: 0}, recent_activity: []
};
const DEFAULT_ENTRY = JSON.stringify({logic: "AND", conditions: [{left: {indicator: "CLOSE"}, operator: "gt", right: {indicator: "EMA", period: 20}}]}, null, 2);
const DEFAULT_EXIT = JSON.stringify({logic: "OR", conditions: [{left: {indicator: "CLOSE"}, operator: "lt", right: {indicator: "EMA", period: 20}}]}, null, 2);
const EMPTY_STRATEGY = {
  name: "", description: "", category: "Trend", symbol: "NIFTY 50", timeframe: "15m",
  direction: "Long", active: true, published: false, entryText: DEFAULT_ENTRY, exitText: DEFAULT_EXIT,
  stopLossPct: "1.5", targetR: "2"
};

async function request(path, options = {}){
  const response = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {...(options.body ? {"Content-Type": "application/json"} : {}), ...(options.headers || {})}
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.detail === "string" ? payload.detail : payload.detail?.message || "The admin request failed.");
    error.status = response.status;
    error.detail = payload.detail;
    throw error;
  }
  return payload;
}

function currency(value){
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-IN", {style: "currency", currency: "INR", maximumFractionDigits: 2}).format(number);
}

function AdminPanel({username, currentAdminId, onLogout, onReturnToWebsite, onAccessDenied}){
  const [page, setPage] = useState("Overview");
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [strategyDraft, setStrategyDraft] = useState(null);
  const [signals, setSignals] = useState({current: [], history: []});
  const [backtests, setBacktests] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [feedbackFilter, setFeedbackFilter] = useState("");
  const [settings, setSettings] = useState(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadPage(){
    setLoading(true);
    setError("");
    try {
      if (page === "Overview") setOverview(await request("/admin/overview"));
      if (page === "Users") {
        const params = new URLSearchParams();
        if (userQuery.trim()) params.set("query", userQuery.trim());
        if (userRole) params.set("role", userRole);
        if (userStatus) params.set("account_status", userStatus);
        setUsers(await request(`/admin/users?${params}`));
      }
      if (page === "Strategies") setStrategies(await request("/admin/strategies"));
      if (page === "AI Signals") setSignals(await request("/admin/signals"));
      if (page === "Backtesting") setBacktests(await request("/admin/backtests"));
      if (page === "Feedback") {
        const filter = feedbackFilter ? `?status=${feedbackFilter}` : "";
        setFeedback(await request(`/admin/feedback${filter}`));
      }
      if (page === "Risk Settings" || page === "Admin Settings") {
        const result = await request("/admin/settings");
        setSettings(result);
        setSettingsDirty(false);
      }
    } catch (requestError) {
      if (requestError.status === 401 || requestError.status === 403) onAccessDenied();
      else setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPage(); }, [page, userRole, userStatus, feedbackFilter]);

  async function updateUser(user, changes){
    const action = changes.role ? `${changes.role === "ADMIN" ? "promote" : "demote"} ${user.username}` : `${changes.account_status === "SUSPENDED" ? "suspend" : "restore"} ${user.username}`;
    if (!window.confirm(`Confirm: ${action}?`)) return;
    setError("");
    try {
      await request(`/admin/users/${user.id}`, {method: "PUT", body: JSON.stringify(changes)});
      setNotice(`Updated ${user.username}.`);
      await loadPage();
      if (selectedUser?.id === user.id) setSelectedUser(await request(`/admin/users/${user.id}`));
    } catch (requestError) { setError(requestError.message); }
  }

  function beginStrategy(strategy = null){
    if (!strategy) {
      setStrategyDraft({...EMPTY_STRATEGY});
      return;
    }
    setStrategyDraft({
      ...EMPTY_STRATEGY, ...strategy,
      entryText: JSON.stringify(strategy.entry, null, 2),
      exitText: JSON.stringify(strategy.exit, null, 2),
      stopLossPct: String(strategy.risk_settings?.stop_loss_pct ?? 1.5),
      targetR: String(strategy.risk_settings?.target_r ?? 2)
    });
  }

  async function saveStrategy(event){
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: strategyDraft.name.trim(), description: strategyDraft.description,
        category: strategyDraft.category, symbol: strategyDraft.symbol,
        timeframe: strategyDraft.timeframe, direction: strategyDraft.direction,
        active: strategyDraft.active, published: strategyDraft.published,
        entry: JSON.parse(strategyDraft.entryText), exit: JSON.parse(strategyDraft.exitText),
        risk_settings: {stop_loss_pct: Number(strategyDraft.stopLossPct), target_r: Number(strategyDraft.targetR)}
      };
      const isEditing = Number.isInteger(strategyDraft.id);
      await request(isEditing ? `/admin/strategies/${strategyDraft.id}` : "/admin/strategies", {
        method: isEditing ? "PUT" : "POST", body: JSON.stringify(payload)
      });
      setStrategyDraft(null);
      setNotice(isEditing ? "Strategy saved as a new version." : "Strategy created.");
      await loadPage();
    } catch (requestError) { setError(requestError.message === "The admin request failed." ? "Entry and exit rules must be valid JSON." : requestError.message); }
    finally { setSaving(false); }
  }

  async function deleteStrategy(strategy){
    if (!window.confirm(`Delete “${strategy.name}”? Existing backtest snapshots remain available.`)) return;
    try {
      await request(`/admin/strategies/${strategy.id}`, {method: "DELETE"});
      setNotice("Strategy deleted.");
      await loadPage();
    } catch (requestError) { setError(requestError.message); }
  }

  async function updateFeedback(item, status){
    try {
      await request(`/admin/feedback/${item.id}`, {method: "PUT", body: JSON.stringify({status})});
      setNotice(`Feedback marked ${status.toLowerCase().replace("_", " ")}.`);
      await loadPage();
    } catch (requestError) { setError(requestError.message); }
  }

  function updateRiskSetting(key, value){
    setSettings((current) => ({...current, settings: {...current.settings, [key]: value}}));
    setSettingsDirty(true);
  }

  async function saveSettings(event){
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = {...settings.settings,
        supported_instruments: settings.settings.supported_instruments_text.split(",").map((item) => item.trim()).filter(Boolean),
        supported_timeframes: settings.settings.supported_timeframes_text.split(",").map((item) => item.trim()).filter(Boolean)
      };
      delete next.supported_instruments_text;
      delete next.supported_timeframes_text;
      const result = await request("/admin/settings", {method: "PUT", body: JSON.stringify({settings: next})});
      setSettings((current) => ({...current, settings: {...result.settings, supported_instruments_text: result.settings.supported_instruments.join(", "), supported_timeframes_text: result.settings.supported_timeframes.join(", ")}, updated_at: result.updated_at}));
      setSettingsDirty(false);
      setNotice("Platform settings saved. Existing personal risk settings were not changed.");
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  async function refresh(){
    setNotice("");
    await loadPage();
  }

  function renderOverview(){
    return <>
      <div className="adminStatGrid">
        <Stat label="Total users" value={overview.users.total} detail={`${overview.users.active} active · ${overview.users.suspended} suspended`} />
        <Stat label="Strategies" value={overview.strategies.total} detail={`${overview.strategies.published} published`} />
        <Stat label="Active strategies" value={overview.strategies.active} detail="Stored rule definitions" />
        <Stat label="Signal records" value={overview.signals.total} detail="Live-provider candle snapshots" />
      </div>
      <section className="adminSection"><div className="adminSectionTitle"><div><h2>Recent administration activity</h2><p>Changes recorded by authorized administrators.</p></div><button className="adminTextButton" onClick={() => setPage("Admin Settings")}>Administration settings</button></div>
        {overview.recent_activity.length ? <ActivityTable rows={overview.recent_activity} /> : <EmptyState title="No admin activity yet" detail="Administrative changes will be listed here." />}
      </section>
    </>;
  }

  function renderUsers(){
    return <>
      <form className="adminFilters" onSubmit={(event) => {event.preventDefault(); loadPage();}}>
        <label className="adminSearch"><Search size={16} /><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search username or user ID" /></label>
        <select aria-label="Filter users by role" value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="">All roles</option><option value="USER">User</option><option value="ADMIN">Admin</option></select>
        <select aria-label="Filter users by status" value={userStatus} onChange={(event) => setUserStatus(event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select>
        <button className="adminButton" type="submit">Search</button>
      </form>
      {users.length ? <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>User</th><th>ID</th><th>Role</th><th>Created</th><th>Status</th><th>Activity</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
        <td><button className="adminInlineLink" onClick={async () => {try {setSelectedUser(await request(`/admin/users/${user.id}`));} catch (e) {setError(e.message);}}}>{user.username}</button></td>
        <td>#{user.id}</td><td><span className={`adminPill ${user.role === "ADMIN" ? "accent" : ""}`}>{user.role}</span></td><td>{formatDate(user.created_at)}</td>
        <td><span className={`adminPill ${user.account_status === "ACTIVE" ? "good" : "danger"}`}>{user.account_status}</span></td>
        <td>{user.strategy_count} strategies · {user.backtest_count} backtests</td>
        <td className="adminActionCell"><button title={user.role === "ADMIN" ? "Demote administrator" : "Promote to administrator"} disabled={user.id === currentAdminId} onClick={() => updateUser(user, {role: user.role === "ADMIN" ? "USER" : "ADMIN"})}>{user.role === "ADMIN" ? <ShieldCheck size={15} /> : <Users size={15} />}</button><button title={user.account_status === "ACTIVE" ? "Suspend account" : "Restore account"} disabled={user.id === currentAdminId} onClick={() => updateUser(user, {account_status: user.account_status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"})}>{user.account_status === "ACTIVE" ? <Ban size={15} /> : <Check size={15} />}</button></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No users match these filters" detail="Try a different search or filter." />}
      {selectedUser && <div className="adminModalBackdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setSelectedUser(null);}}><section className="adminModal" role="dialog" aria-modal="true" aria-labelledby="admin-user-title"><div className="adminModalHead"><div><span className="adminEyebrow">ACCOUNT DETAILS</span><h2 id="admin-user-title">{selectedUser.username}</h2></div><button className="adminIconButton" aria-label="Close user details" onClick={() => setSelectedUser(null)}><X size={17} /></button></div><div className="adminDetailGrid"><Detail label="User ID" value={`#${selectedUser.id}`} /><Detail label="Role" value={selectedUser.role} /><Detail label="Status" value={selectedUser.account_status} /><Detail label="Registered" value={formatDate(selectedUser.created_at)} /><Detail label="Feedback submitted" value={selectedUser.feedback_count} /></div><h3>Recent admin actions</h3>{selectedUser.admin_activity.length ? <ActivityTable rows={selectedUser.admin_activity} /> : <EmptyState title="No recorded actions" detail="No administrative changes are linked to this account." />}</section></div>}
    </>;
  }

  function renderStrategies(){
    return <>
      <div className="adminSectionTitle"><div><h2>Trading strategies</h2><p>Manage existing user strategies and publish selected rule sets for the user catalog.</p></div><button className="adminButton primary" onClick={() => beginStrategy()}><Plus size={15} /> New strategy</button></div>
      {strategies.length ? <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Strategy</th><th>Owner</th><th>Market / timeframe</th><th>Status</th><th>Backtests</th><th>Signals</th><th>Actions</th></tr></thead><tbody>{strategies.map((strategy) => <tr key={strategy.id}><td><b>{strategy.name}</b><small>{strategy.category} · v{strategy.version}</small></td><td>{strategy.owner_username}</td><td>{strategy.symbol} · {strategy.timeframe}</td><td><span className={`adminPill ${strategy.published ? "good" : ""}`}>{strategy.published ? "PUBLISHED" : strategy.active ? "DRAFT / PRIVATE" : "INACTIVE"}</span></td><td>{strategy.backtest_count}</td><td>{strategy.signal_count}</td><td className="adminActionCell"><button title="Edit strategy" onClick={() => beginStrategy(strategy)}><Settings2 size={15} /></button><button title={strategy.published ? "Unpublish strategy" : "Publish strategy"} onClick={() => beginStrategy({...strategy, published: !strategy.published})}>{strategy.published ? <Ban size={15} /> : <Check size={15} />}</button><button title="Delete strategy" onClick={() => deleteStrategy(strategy)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div> : <EmptyState title="No saved strategies" detail="Create the first managed strategy or wait for users to save their own." />}
      {strategyDraft && <div className="adminModalBackdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setStrategyDraft(null);}}><form className="adminModal adminStrategyModal" onSubmit={saveStrategy}><div className="adminModalHead"><div><span className="adminEyebrow">RULE CONFIGURATION</span><h2>{strategyDraft.id ? "Edit strategy" : "Create strategy"}</h2></div><button className="adminIconButton" type="button" aria-label="Close strategy form" onClick={() => setStrategyDraft(null)}><X size={17} /></button></div><div className="adminFormGrid">
        <label>Name<input required maxLength="80" value={strategyDraft.name} onChange={(event) => setStrategyDraft({...strategyDraft, name: event.target.value})} /></label>
        <label>Category<input required maxLength="60" value={strategyDraft.category} onChange={(event) => setStrategyDraft({...strategyDraft, category: event.target.value})} /></label>
        <label>Market<select value={strategyDraft.symbol} onChange={(event) => setStrategyDraft({...strategyDraft, symbol: event.target.value})}><option>NIFTY 50</option><option>BTC/USDT</option><option>GOLD</option></select></label>
        <label>Timeframe<select value={strategyDraft.timeframe} onChange={(event) => setStrategyDraft({...strategyDraft, timeframe: event.target.value})}>{["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"].map((timeframe) => <option key={timeframe}>{timeframe}</option>)}</select></label>
        <label>Direction<select value={strategyDraft.direction} onChange={(event) => setStrategyDraft({...strategyDraft, direction: event.target.value})}><option value="Long">Long only (current simulator)</option></select></label>
        <label>Description<input maxLength="1000" value={strategyDraft.description} onChange={(event) => setStrategyDraft({...strategyDraft, description: event.target.value})} /></label>
        <label>Stop loss (%)<input type="number" min="0.01" max="100" step="any" value={strategyDraft.stopLossPct} onChange={(event) => setStrategyDraft({...strategyDraft, stopLossPct: event.target.value})} /></label>
        <label>Target R<input type="number" min="0.01" max="100" step="any" value={strategyDraft.targetR} onChange={(event) => setStrategyDraft({...strategyDraft, targetR: event.target.value})} /></label>
        <label className="adminCheck"><input type="checkbox" checked={strategyDraft.active} onChange={(event) => setStrategyDraft({...strategyDraft, active: event.target.checked})} /> Active</label>
        <label className="adminCheck"><input type="checkbox" checked={strategyDraft.published} onChange={(event) => setStrategyDraft({...strategyDraft, published: event.target.checked})} /> Published to user strategy lists</label>
        <label className="adminWide">Entry rules (JSON)<textarea required rows="7" value={strategyDraft.entryText} onChange={(event) => setStrategyDraft({...strategyDraft, entryText: event.target.value})} /></label>
        <label className="adminWide">Exit rules (JSON)<textarea required rows="7" value={strategyDraft.exitText} onChange={(event) => setStrategyDraft({...strategyDraft, exitText: event.target.value})} /></label>
      </div><p className="adminFormNote">Rules are validated by the existing long-only custom strategy engine before saving. Publishing makes the strategy visible; it does not guarantee profitability.</p><div className="adminModalActions"><button type="button" className="adminButton" onClick={() => setStrategyDraft(null)}>Cancel</button><button className="adminButton primary" disabled={saving}>{saving ? "Saving…" : "Save strategy"}</button></div></form></div>}
    </>;
  }

  function renderSignals(){
    return <>
      <div className="adminSectionTitle"><div><h2>Current engine checks</h2><p>Computed from the existing signal engine and provider. No synthetic data is shown as a live signal.</p></div><button className="adminButton" onClick={refresh}><RefreshCw size={14} /> Refresh</button></div>
      {signals.current.length ? <div className="adminSignalGrid">{signals.current.map((signal) => <article className="adminSignalCard" key={signal.symbol}><div><span className="adminEyebrow">{signal.timeframe} · {signal.data_source}</span><b>{signal.symbol}</b></div><span className={`adminPill ${signal.signal === "BUY" ? "good" : signal.signal === "SELL" ? "danger" : ""}`}>{signal.signal}</span><dl><div><dt>Strategy</dt><dd>{signal.strategy}</dd></div><div><dt>Setup status</dt><dd>{signal.setup_status}</dd></div><div><dt>Entry</dt><dd>{signal.entry_price == null ? "—" : currency(signal.entry_price)}</dd></div><div><dt>Stop</dt><dd>{signal.stop_loss == null ? "—" : currency(signal.stop_loss)}</dd></div><div><dt>Target</dt><dd>{signal.target_price == null ? "—" : currency(signal.target_price)}</dd></div><div><dt>Last candle</dt><dd>{signal.created_at ? formatDate(signal.created_at) : "—"}</dd></div></dl></article>)}</div> : <EmptyState title="No signal checks yet" detail="Refresh to evaluate supported instruments through the existing provider." />}
      <section className="adminSection"><div className="adminSectionTitle"><div><h2>Recorded signal history</h2><p>One record per provider candle and strategy; unavailable instruments are not stored.</p></div></div>{signals.history.length ? <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Instrument</th><th>Signal</th><th>Strategy / timeframe</th><th>Entry / stop / target</th><th>Source</th><th>Observed</th></tr></thead><tbody>{signals.history.map((item) => <tr key={item.id}><td>{item.symbol}</td><td>{item.signal}</td><td>{item.strategy} · {item.timeframe}</td><td>{item.entry_price == null ? "—" : `${currency(item.entry_price)} / ${currency(item.stop_loss)} / ${currency(item.target_price)}`}</td><td>{item.data_source}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="No saved signal history" detail="A history record is added when a real provider candle is evaluated." />}</section>
    </>;
  }

  function renderBacktests(){
    return backtests.length ? <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Account</th><th>Strategy</th><th>Instrument / timeframe</th><th>Result</th><th>Trades</th><th>Win rate</th><th>Max drawdown</th><th>Created</th></tr></thead><tbody>{backtests.map((run) => <tr key={run.id}><td>{run.username} <small>#{run.user_id}</small></td><td>{run.strategy_name}<small>v{run.strategy_version}</small></td><td>{run.result.symbol || "—"} · {run.result.timeframe || "—"}</td><td className={Number(run.result.pnl) < 0 ? "adminLoss" : ""}>{currency(run.result.pnl)}</td><td>{run.result.trades ?? "—"}</td><td>{run.result.win_rate ?? "—"}%</td><td>{run.result.max_drawdown ?? "—"}%</td><td>{formatDate(run.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="No completed backtests" detail="Backtest records appear here after users save real runs." />;
  }

  function renderRiskSettings(){
    if (!settings) return null;
    const values = settings.settings;
    const instruments = values.supported_instruments_text ?? values.supported_instruments.join(", ");
    const timeframes = values.supported_timeframes_text ?? values.supported_timeframes.join(", ");
    return <form className="adminConfigForm" onSubmit={saveSettings}><div className="adminSectionTitle"><div><h2>Platform risk defaults</h2><p>Defaults apply only to new configurations; existing users’ personal settings are not overwritten.</p></div></div><div className="adminFormGrid">
      <label>Default risk per trade (%)<input type="number" min="0.01" max="100" step="any" value={values.risk_per_trade_pct} onChange={(event) => updateRiskSetting("risk_per_trade_pct", event.target.value)} /></label>
      <label>Default daily loss limit (%)<input type="number" min="0.01" max="100" step="any" value={values.daily_loss_pct} onChange={(event) => updateRiskSetting("daily_loss_pct", event.target.value)} /></label>
      <label>Maximum overall drawdown (%)<input type="number" min="0.01" max="100" step="any" value={values.max_drawdown_pct} onChange={(event) => updateRiskSetting("max_drawdown_pct", event.target.value)} /></label>
      <label>Maximum simultaneous open risk (%)<input type="number" min="0.01" max="100" step="any" value={values.max_open_risk_pct} onChange={(event) => updateRiskSetting("max_open_risk_pct", event.target.value)} /></label>
      <label className="adminWide">Supported instruments<input value={instruments} onChange={(event) => updateRiskSetting("supported_instruments_text", event.target.value)} /></label>
      <label className="adminWide">Supported timeframes<input value={timeframes} onChange={(event) => updateRiskSetting("supported_timeframes_text", event.target.value)} /></label>
    </div><div className="adminModalActions"><span>{settings.updated_at ? `Last updated ${formatDate(settings.updated_at)}` : "Defaults shown; not saved yet."}</span><button className="adminButton primary" disabled={!settingsDirty || saving}>{saving ? "Saving…" : "Save platform defaults"}</button></div></form>;
  }

  function renderFeedback(){
    return <>
      <div className="adminFilters"><select aria-label="Filter feedback by status" value={feedbackFilter} onChange={(event) => setFeedbackFilter(event.target.value)}><option value="">All feedback</option><option value="OPEN">Open</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option></select></div>
      {feedback.length ? <div className="adminFeedbackList">{feedback.map((item) => <article className="adminFeedbackItem" key={item.id}><div className="adminFeedbackTop"><span className="adminPill">{item.category}</span><span className={`adminPill ${item.status === "RESOLVED" ? "good" : ""}`}>{item.status}</span><small>{item.username} · {formatDate(item.created_at)}</small></div><h3>{item.subject}</h3><p>{item.message}</p><label>Update status<select value={item.status} onChange={(event) => updateFeedback(item, event.target.value)}><option value="OPEN">Open</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option></select></label></article>)}</div> : <EmptyState title="No feedback received" detail="User-submitted feedback will appear here." />}
    </>;
  }

  function renderAdminSettings(){
    return <>
      <section className="adminProfileSummary"><span className="adminAvatar">{username?.charAt(0).toUpperCase() || "A"}</span><div><span className="adminEyebrow">SIGNED IN ADMINISTRATOR</span><h2>{username}</h2><p>Uses your existing TradeMind account credentials and server-side ADMIN role.</p></div><span className="adminPill good">ADMIN</span></section>
      <p className="adminSecurityNote">There is no public admin signup or separate admin password. Keep the existing account password private. First-admin promotion is performed out-of-band with the backend CLI.</p>
      {renderRiskSettings()}
    </>;
  }

  const content = page === "Overview" ? renderOverview()
    : page === "Users" ? renderUsers()
      : page === "Strategies" ? renderStrategies()
        : page === "AI Signals" ? renderSignals()
          : page === "Backtesting" ? renderBacktests()
            : page === "Risk Settings" ? renderRiskSettings()
              : page === "Feedback" ? renderFeedback()
                : renderAdminSettings();

  return <div className="adminShell">
    <aside className="adminSidebar"><div className="adminBrand"><span className="adminBrandMark">TM</span><div><b>TradeMind</b><small>ADMIN CONSOLE</small></div></div><div className="adminSidebarLabel">MANAGEMENT</div><nav>{NAV_ITEMS.map(([name, Icon]) => <button key={name} className={page === name ? "adminNav active" : "adminNav"} onClick={() => setPage(name)}><Icon size={17} />{name}</button>)}</nav><div className="adminSidebarBottom"><span className="adminLiveDot" />Protected session active</div></aside>
    <main className="adminMain"><header className="adminTopbar"><button className="adminReturn" onClick={onReturnToWebsite}><ArrowLeft size={15} /> User website</button><div className="adminTopActions"><span>{username}</span><button title="Refresh this page" onClick={refresh}><RefreshCw size={15} /></button><button onClick={onLogout}><LogOut size={15} /> Logout</button></div></header>
      <div className="adminContent"><div className="adminPageHeading"><div><span className="adminEyebrow">TRADEMIND ADMINISTRATION</span><h1>{page}</h1><p>{page === "Overview" ? "Current account and platform records." : `Manage ${page.toLowerCase()} using the existing TradeMind database.`}</p></div></div>
        {notice && <div className="adminNotice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}
        {error && <div className="adminError" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={14} /></button></div>}
        {loading ? <div className="adminLoading"><span />Loading database records…</div> : content}
      </div>
    </main>
  </div>;
}

function Stat({label, value, detail}){return <article className="adminStat"><span>{label}</span><b>{Number(value || 0).toLocaleString()}</b><small>{detail}</small></article>;}
function Detail({label, value}){return <div className="adminDetail"><span>{label}</span><b>{value}</b></div>;}
function EmptyState({title, detail}){return <div className="adminEmpty"><b>{title}</b><span>{detail}</span></div>;}
function formatDate(value){return value ? new Date(value).toLocaleString() : "—";}
function ActivityTable({rows}){return <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Action</th><th>Administrator</th><th>Record</th><th>Time</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.action}</td><td>{row.admin_username || `#${row.admin_user_id}`}</td><td>{row.record_type ? `${row.record_type} ${row.record_id || ""}` : "—"}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div>;}

export default AdminPanel;