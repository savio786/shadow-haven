// Task mini-games. Each one is given the server's challenge data and calls
// done(answer) when solved. The server checks the answer and the time taken.

// Fastest plausible finish per kind (mirrors the server); we never submit sooner.
const MIN_MS = { timing: 2500, sequence: 3000, match: 1500, connect: 2500, mash: 2000, hold: 3000 };

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const shake = (node) => {
  node.classList.remove("shake");
  void node.offsetWidth;
  node.classList.add("shake");
};

/**
 * Run a mini-game inside `root`.
 * @returns cleanup function
 */
export function runTask(kind, data, root, done) {
  const started = Date.now();
  let finished = false;
  const finish = (answer) => {
    if (finished) return;
    finished = true;
    const wait = Math.max(0, MIN_MS[kind] - (Date.now() - started));
    if (wait > 0) status.textContent = "Finishing up…";
    setTimeout(() => done(answer), wait);
  };
  root.innerHTML = "";
  const stage = el("div", "task-stage");
  const status = el("p", "task-status muted small");
  root.append(stage, status);
  const game = GAMES[kind];
  if (!game) {
    status.textContent = "This task can't be shown.";
    return () => {};
  }
  return game(data, stage, status, finish);
}

const GAMES = {
  // Light the great lamp: tap when the spark crosses the wick.
  timing(data, stage, status, finish) {
    const track = el("div", "timing-track");
    const zone = el("div", "timing-zone");
    const spark = el("div", "timing-spark");
    track.append(zone, spark);
    const btn = el("button", "primary wide", "Light it");
    stage.append(track, btn);
    let hits = 0;
    let zoneAt = 0;
    const placeZone = () => {
      zoneAt = 0.1 + Math.random() * (0.8 - data.zone);
      zone.style.left = zoneAt * 100 + "%";
      zone.style.width = data.zone * 100 + "%";
    };
    placeZone();
    status.textContent = `Catch the spark on the wick — 0 of ${data.hits}`;
    let pos = 0, dir = 1, last = performance.now(), raf;
    const loop = (t) => {
      pos += dir * data.speed * ((t - last) / 1000);
      last = t;
      if (pos >= 1) { pos = 1; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      spark.style.left = pos * 100 + "%";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const tap = () => {
      if (pos >= zoneAt && pos <= zoneAt + data.zone) {
        hits++;
        track.classList.add("hit");
        setTimeout(() => track.classList.remove("hit"), 250);
        status.textContent = `Catch the spark on the wick — ${hits} of ${data.hits}`;
        if (hits >= data.hits) {
          cancelAnimationFrame(raf);
          btn.disabled = true;
          stage.classList.add("lit");
          return finish(null);
        }
        placeZone();
      } else {
        shake(track);
      }
    };
    btn.addEventListener("click", tap);
    track.addEventListener("pointerdown", tap);
    return () => cancelAnimationFrame(raf);
  },

  // Light the candles: watch the order, then repeat it.
  sequence(data, stage, status, finish) {
    const row = el("div", "candles");
    const candles = Array.from({ length: data.candles }, (_, i) => {
      const b = el("button", "candle", `<svg viewBox="0 0 30 70" aria-hidden="true"><path class="c-flame" d="M15 4c5 7 5 13 0 17-5-4-5-10 0-17z"/><rect x="9" y="24" width="12" height="42" rx="2" class="c-wax"/></svg>`);
      b.setAttribute("aria-label", `Candle ${i + 1}`);
      row.append(b);
      return b;
    });
    stage.append(row);
    let input = [];
    let showing = false;
    const timers = [];
    const flash = (i, ms = 450) => {
      candles[i].classList.add("on");
      timers.push(setTimeout(() => candles[i].classList.remove("on"), ms));
    };
    const show = () => {
      showing = true;
      input = [];
      status.textContent = "Watch the order the flames rise…";
      data.order.forEach((c, k) => timers.push(setTimeout(() => flash(c), 400 + k * 650)));
      timers.push(setTimeout(() => {
        showing = false;
        status.textContent = "Now light them in the same order.";
      }, 400 + data.order.length * 650));
    };
    candles.forEach((b, i) => b.addEventListener("click", () => {
      if (showing) return;
      flash(i, 300);
      input.push(i);
      const k = input.length - 1;
      if (input[k] !== data.order[k]) {
        shake(row);
        status.textContent = "The flames gutter out. Watch again.";
        timers.push(setTimeout(show, 900));
        showing = true;
        return;
      }
      if (input.length === data.order.length) {
        candles.forEach((c) => c.classList.add("on"));
        showing = true;
        finish(input);
      }
    }));
    show();
    return () => timers.forEach(clearTimeout);
  },

  // Sort the signal flags: find the flag that matches.
  match(data, stage, status, finish) {
    const flag = (colors) => `<svg viewBox="0 0 60 40" aria-hidden="true">${colors
      .map((c, i) => `<rect y="${i * 13.33}" width="60" height="13.4" fill="${c}"/>`).join("")}<rect width="60" height="40" fill="none" stroke="#0005"/></svg>`;
    const target = el("div", "flag-target", `<p class="eyebrow">Signal from the lighthouse</p>${flag(data.target)}`);
    const opts = el("div", "flag-options");
    data.options.forEach((colors, i) => {
      const b = el("button", "flag-option", flag(colors));
      b.setAttribute("aria-label", `Flag ${i + 1}`);
      b.addEventListener("click", () => {
        if (colors.join() === data.target.join()) {
          b.classList.add("right");
          opts.querySelectorAll("button").forEach((x) => (x.disabled = true));
          finish(i);
        } else {
          b.disabled = true;
          shake(b);
        }
      });
      opts.append(b);
    });
    status.textContent = "Raise the flag that matches the signal.";
    stage.append(target, opts);
    return () => {};
  },

  // Mend the net: tie the knots in order, 1 to 6.
  connect(data, stage, status, finish) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("net");
    let grid = "";
    for (let i = 10; i < 100; i += 10) grid += `<path d="M${i} 0V100M0 ${i}H100" class="net-grid"/>`;
    svg.innerHTML = `${grid}<polyline class="net-line" points=""/>`;
    const line = svg.querySelector("polyline");
    const tied = [];
    data.points.forEach((p, i) => {
      const g = document.createElementNS(ns, "g");
      g.classList.add("knot");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `Knot ${i + 1}`);
      g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="6.5"/><text x="${p.x}" y="${p.y + 2.6}">${i + 1}</text>`;
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (tied.includes(i)) return;
        if (i !== tied.length) { shake(svg); return; }
        tied.push(i);
        g.classList.add("tied");
        line.setAttribute("points", tied.map((k) => `${data.points[k].x},${data.points[k].y}`).join(" "));
        status.textContent = tied.length < 6 ? `Tie knot ${tied.length + 1} next.` : "The net holds.";
        if (tied.length === 6) finish(tied);
      });
      svg.append(g);
    });
    status.textContent = "Tie the knots in order, 1 to 6.";
    stage.append(svg);
    return () => {};
  },

  // Haul in the rope: pull, pull, pull.
  mash(data, stage, status, finish) {
    const coil = el("div", "rope-meter", `<span></span>`);
    const fill = coil.firstChild;
    const btn = el("button", "primary wide big", "Pull!");
    stage.append(coil, btn);
    let n = 0;
    status.textContent = `Haul the rope in — 0 of ${data.pulls}`;
    btn.addEventListener("click", () => {
      n++;
      fill.style.width = (n / data.pulls) * 100 + "%";
      status.textContent = `Haul the rope in — ${Math.min(n, data.pulls)} of ${data.pulls}`;
      btn.classList.remove("tug"); void btn.offsetWidth; btn.classList.add("tug");
      if (n >= data.pulls) { btn.disabled = true; finish(null); }
    });
    return () => {};
  },

  // Wind the clock: hold the crank until the spring is tight.
  hold(data, stage, status, finish) {
    const crank = el("button", "crank", `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" class="crank-track"/>
      <circle cx="50" cy="50" r="44" class="crank-fill" pathLength="100"/>
      <g class="crank-arm"><rect x="47" y="14" width="6" height="36" rx="3"/><circle cx="50" cy="16" r="7"/></g>
      <circle cx="50" cy="50" r="7" class="crank-hub"/></svg>`);
    crank.setAttribute("aria-label", "Hold to wind the clock");
    const fill = crank.querySelector(".crank-fill");
    const arm = crank.querySelector(".crank-arm");
    stage.append(crank);
    status.textContent = "Press and hold to wind. Don't let go too soon.";
    let start = 0, raf, done = false;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / data.ms);
      fill.style.strokeDashoffset = String(100 - k * 100);
      arm.style.transform = `rotate(${k * 1080}deg)`;
      if (k >= 1) { done = true; crank.disabled = true; status.textContent = "Tick… tock. Wound."; return finish(null); }
      raf = requestAnimationFrame(tick);
    };
    const down = (e) => { if (done) return; e.preventDefault(); start = performance.now(); raf = requestAnimationFrame(tick); };
    const up = () => {
      if (done) return;
      cancelAnimationFrame(raf);
      fill.style.strokeDashoffset = "100";
      arm.style.transform = "";
      if (start) status.textContent = "The spring slipped. Hold it the whole way.";
      start = 0;
    };
    crank.addEventListener("pointerdown", down);
    crank.addEventListener("pointerup", up);
    crank.addEventListener("pointerleave", up);
    crank.addEventListener("pointercancel", up);
    crank.addEventListener("contextmenu", (e) => e.preventDefault());
    return () => cancelAnimationFrame(raf);
  },
};
