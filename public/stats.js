// The Harbor Log: play statistics, drawn from /api/stats.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const pctText = (p) => (p === null || p === undefined ? "–" : `${Math.round(p)}%`);
const LEVEL = { easy: "Easy bots", normal: "Normal bots", cunning: "Cunning bots" };
const MIN_GAMES = 5; // fewer than this and a percentage says little

let days = 30;
try { days = Number(localStorage.getItem("sh.statsDays")) || 30; } catch {}

async function load() {
  for (const b of document.querySelectorAll(".range button")) b.setAttribute("aria-checked", String(Number(b.dataset.days) === days));
  $("error").hidden = true;
  try {
    const res = await fetch(`/api/stats?days=${days}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 429 ? "Too many looks in a short time — wait a moment." : `The log couldn't be read (${res.status}).`);
    render(await res.json());
  } catch (e) {
    $("error").textContent = e.message || "The log couldn't be read.";
    $("error").hidden = false;
  }
}

function render(d) {
  const t = d.totals;
  $("updated").textContent = `Last ${d.days === 365 ? "year" : `${d.days} days`} · updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const empty = t.started === 0;
  $("empty").hidden = !empty;
  $("content").hidden = empty;
  if (empty) return;

  // Headline numbers.
  $("t-finished").textContent = t.finished;
  $("t-finished-note").textContent = t.started > t.finished
    ? `of ${t.started} started · ${pctText(t.finishPct)} played to the end`
    : "every one played to the end";
  $("t-length").textContent = t.medianMinutes === null ? "–" : `${t.medianMinutes} min`;
  $("t-length-note").textContent = t.avgPlayers ? `about ${Math.round(t.avgPlayers)} players a game` : "";
  $("t-shades").textContent = pctText(t.shadeWinPct);
  $("t-shades-note").textContent = t.games ? `${t.shades} Shade wins · ${t.keepers} Keeper wins` : "";
  $("t-people").textContent = t.people;
  $("t-people-note").textContent = `${d.people.solo} solo with bots · ${d.people.withFriends} with friends`;

  // Fairness, by bot cunning.
  $("balance").innerHTML = d.byLevel.map((b) => splitBar(LEVEL[b.level], b, verdict(b))).join("")
    + splitBar("All games", { games: t.games, keepers: t.keepers, shades: t.shades, shadeWinPct: t.shadeWinPct, medianMinutes: t.medianMinutes }, verdict(t), true);

  // People's own results.
  const ps = d.people.asShade, pk = d.people.asKeeper;
  $("p-shade").textContent = pctText(ps.winPct);
  $("p-shade-note").textContent = ps.games ? `won ${ps.won} of ${plural(ps.games, "game")}` : "no games yet";
  $("p-keeper").textContent = pctText(pk.winPct);
  $("p-keeper-note").textContent = pk.games ? `won ${pk.won} of ${plural(pk.games, "game")}` : "no games yet";
  $("p-friends").textContent = d.people.withFriends;
  $("p-friends-note").textContent = d.people.withFriends ? "games with two or more people" : "so far, people have played with bots";

  // Games each day.
  const most = Math.max(1, ...d.perDay.map((x) => x.finished + x.other));
  $("days").innerHTML = d.perDay.map((x) => {
    const all = x.finished + x.other;
    const label = `${dayName(x.day)}: ${plural(all, "game")}${x.other ? ` (${x.finished} finished)` : ""}`;
    return `<span class="day" tabindex="0" data-tip="${esc(label)}" aria-label="${esc(label)}"><span class="day-bar${all ? "" : " zero"}" style="height:${all ? Math.max(4, (all / most) * 100) : 0}%"></span></span>`;
  }).join("");
  $("days").setAttribute("aria-label", `Games each day. Busiest day: ${most}.`);
  $("days").style.setProperty("--n", d.perDay.length);
  $("day-first").textContent = dayName(d.perDay[0].day);
  $("day-last").textContent = "Today";
  $("day-note").textContent = `busiest day: ${plural(most, "game")}`;

  // How nights end.
  const endings = [
    ["Every lantern lit", "Keepers finished all their tasks", d.endings.tasks],
    ["Shades set adrift", "Keepers voted out every Shade", d.endings.adrift],
    ["The harbor went dark", "Shades matched the Keepers", d.endings.dark],
  ];
  const endMax = Math.max(1, ...endings.map((e) => e[2]));
  $("endings").innerHTML = endings.map(([name, why, n]) => countBar(name, why, n, endMax, t.games)).join("")
    + (t.calledOff || t.abandoned ? `<p class="muted small">Also: ${plural(t.calledOff, "game")} called off by the host, ${plural(t.abandoned, "game")} left unfinished.</p>` : "");

  // Table sizes.
  $("sizes").innerHTML = d.byPlayers.length
    ? d.byPlayers.map((b) => splitBar(`${b.players} players`, b, null)).join("")
    : `<p class="muted small">No finished games yet.</p>`;

  // Facts.
  const facts = [
    t.avgSnuffs !== null && `<strong>${t.avgSnuffs.toFixed(1)}</strong> lanterns snuffed in a typical game`,
    t.avgMeetings !== null && `<strong>${t.avgMeetings.toFixed(1)}</strong> meetings at the bell per game`,
    t.fogPct !== null && `The fog came down in <strong>${pctText(t.fogPct)}</strong> of games`,
    t.wrongVotePct !== null && `An innocent Keeper was set adrift in <strong>${pctText(t.wrongVotePct)}</strong> of games`,
    t.avgProgressPct !== null && `The harbor was <strong>${t.avgProgressPct}%</strong> lit by the end, on average`,
    d.ai.lines + d.ai.fallback > 0 && `<strong>${pctText(d.ai.aiPct)}</strong> of bot lines were written by the AI (the rest came from built-in lines)`,
  ].filter(Boolean);
  $("facts").innerHTML = facts.map((f) => `<li>${f}</li>`).join("");

  // Latest games.
  $("recent").innerHTML = d.recent.map((g) => `<tr>
      <td>${esc(when(g.at))}</td>
      <td>${resultTag(g)}</td>
      <td>${esc((LEVEL[g.level] || g.level).replace(" bots", ""))}</td>
      <td class="num">${g.players}${g.humans > 1 ? ` <span class="muted">(${g.humans} people)</span>` : ""}</td>
      <td class="num">${g.minutes}</td>
      <td class="num">${g.snuffs}</td>
      <td class="num">${g.meetings}</td>
    </tr>`).join("");
}

/** A Keepers-vs-Shades bar: two segments with a gap, labels in text colors. */
function splitBar(label, b, note, total = false) {
  const games = b.games;
  const kPct = games ? (b.keepers / games) * 100 : 0;
  const sPct = games ? (b.shades / games) * 100 : 0;
  const tip = games
    ? `${label}: Keepers won ${b.keepers}, Shades won ${b.shades}${b.medianMinutes ? ` · typical game ${b.medianMinutes} min` : ""}`
    : `${label}: no games yet`;
  return `<div class="bar-row${total ? " total" : ""}">
    <div class="bar-label"><span>${esc(label)}</span><span class="muted">${games ? plural(games, "game") : "no games"}</span></div>
    <div class="split" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
      ${games ? `${b.keepers ? `<span class="seg keepers" style="flex-grow:${kPct}"></span>` : ""}${b.shades ? `<span class="seg shades" style="flex-grow:${sPct}"></span>` : ""}` : `<span class="seg none"></span>`}
    </div>
    <div class="bar-values">${games ? `<span>Keepers ${Math.round(kPct)}%</span><span>Shades ${Math.round(sPct)}%</span>` : ""}</div>
    ${note ? `<p class="verdict ${note.kind}"><span aria-hidden="true">${note.icon}</span> ${esc(note.text)}</p>` : ""}
  </div>`;
}

function countBar(name, why, n, max, total) {
  const tip = `${name}: ${plural(n, "game")}${total ? ` (${Math.round((n / total) * 100)}%)` : ""} — ${why}`;
  return `<div class="bar-row">
    <div class="bar-label"><span>${esc(name)}</span><span class="muted">${n}${total ? ` · ${Math.round((n / total) * 100)}%` : ""}</span></div>
    <div class="count" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span class="fill" style="width:${n ? Math.max(2, (n / max) * 100) : 0}%"></span></div>
    <p class="muted small why">${esc(why)}</p>
  </div>`;
}

/** Plain-words fairness check. */
function verdict(b) {
  if (!b.games) return null;
  if (b.games < MIN_GAMES) return { kind: "wait", icon: "…", text: `Too few games to judge yet (${b.games} of ${MIN_GAMES}).` };
  const p = b.shadeWinPct;
  if (p < 35) return { kind: "warn", icon: "▲", text: "Keepers win too easily — the Shades need more of a chance." };
  if (p > 65) return { kind: "warn", icon: "▲", text: "Shades win too often — the Keepers need more of a chance." };
  return { kind: "ok", icon: "✓", text: "Close games — nicely balanced." };
}

function resultTag(g) {
  if (g.outcome === "keepers") return `<span class="tag-win keepers">Keepers won</span>`;
  if (g.outcome === "shades") return `<span class="tag-win shades">Shades won</span>`;
  if (g.outcome === "ended") return `<span class="muted">Called off</span>`;
  return `<span class="muted">Left unfinished</span>`;
}

function dayName(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function when(at) {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Hover / focus tooltips for every mark.
const tip = $("tip");
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
document.addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); });
document.addEventListener("pointermove", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
document.addEventListener("pointerleave", () => (tip.hidden = true));
document.addEventListener("focusin", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (!el) return (tip.hidden = true);
  const r = el.getBoundingClientRect();
  showTip(el, r.left + r.width / 2, r.top);
});
document.addEventListener("focusout", () => (tip.hidden = true));
window.addEventListener("scroll", () => (tip.hidden = true), { passive: true });

for (const b of document.querySelectorAll(".range button")) {
  b.addEventListener("click", () => {
    days = Number(b.dataset.days);
    try { localStorage.setItem("sh.statsDays", String(days)); } catch {}
    load();
  });
}

load();
// Keep it fresh while it's open.
setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
