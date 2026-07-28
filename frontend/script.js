"use strict";


const STORAGE_RESULT_KEY = "sentio:last_result";
const STORAGE_URL_KEY = "sentio:last_url";
const ORB_RING_CIRCUMFERENCE = 376.8; // 2 * PI * r(60)
const SENTIMENT_LABELS_FR = { positive: "Positif", neutral: "Neutre", negative: "Négatif" };
const SENTIMENT_COLOR = { positive: "#22c07d", neutral: "#f5a623", negative: "#ef4444" };

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Lightweight client-side echo of backend youtube.extract_video_id, for instant UX feedback. */
function isLikelyYouTubeUrl(raw) {
  const value = (raw || "").trim();
  if (!value) return false;
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return true;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return url.pathname.length > 1;
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.has("v");
    if (/^\/(shorts|embed|live)\//.test(url.pathname)) return true;
  }
  return false;
}



function countUpPercent(el, target, duration) {
  if (prefersReducedMotion()) {
    el.textContent = `${Math.round(target)}%`;
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = `${Math.round(target * eased)}%`;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Animate an .orb-cluster: ring fill (stroke-dashoffset) + counting percentage,
 * per sentiment. Expects each direct entry to be an .orb-item[data-sentiment]
 * containing a .ring-fg (colored via .positive/.neutral/.negative), a
 * .ring-value, and an optional .ring-count.
 * `values` = { positive: 0-100, neutral: 0-100, negative: 0-100 }
 * `counts` (optional) = raw comment counts, shown under the label.
 */
const RING_FILL_TRANSITION_MS = 1400;

/**
 * Position on the ring's own (pre-rotation) coordinate circle for a given
 * fill percentage. The <svg class="ring"> is rotated -90deg in CSS so the
 * fill visually starts at 12 o'clock; computing the point here in the same
 * unrotated frame the stroke-dasharray math uses means the CSS rotation
 * carries the cap to the correct final spot for free.
 */
function ringCapPoint(percent) {
  const angleRad = (percent / 100) * 2 * Math.PI;
  return {
    x: 70 + 60 * Math.cos(angleRad),
    y: 70 + 60 * Math.sin(angleRad),
  };
}

function animateOrbCluster(rootEl, values, counts) {
  if (!rootEl) return;
  const items = Array.from(rootEl.querySelectorAll(".orb-item"));
  const reduced = prefersReducedMotion();

  items.forEach((item, i) => {
    const sentiment = item.dataset.sentiment;
    const value = clamp(Number(values[sentiment]) || 0, 0, 100);
    const ring = item.querySelector(".ring-fg");
    const valueEl = item.querySelector(".ring-value");
    const countEl = item.querySelector(".ring-count");
    const ringWrap = item.querySelector(".ring-wrap");
    const cap = item.querySelector(".ring-cap");
    const offset = ORB_RING_CIRCUMFERENCE * (1 - value / 100);

    if (ringWrap) ringWrap.style.setProperty("--orb-delay", reduced ? "0s" : `${i * 0.15}s`);

    if (cap) {
      const point = ringCapPoint(value);
      cap.setAttribute("cx", point.x.toFixed(2));
      cap.setAttribute("cy", point.y.toFixed(2));
    }

    if (reduced) {
      ring.style.transition = "none";
      ring.style.strokeDashoffset = String(offset);
      valueEl.textContent = `${Math.round(value)}%`;
      if (cap) cap.classList.add("is-visible");
    } else {
      ring.style.strokeDashoffset = String(ORB_RING_CIRCUMFERENCE);
      const startDelay = i * 150;
      requestAnimationFrame(() => {
        setTimeout(() => {
          ring.style.strokeDashoffset = String(offset);
        }, startDelay);
      });
      countUpPercent(valueEl, value, 1300);
      if (cap) {
        setTimeout(() => cap.classList.add("is-visible"), startDelay + RING_FILL_TRANSITION_MS);
      }
    }

    if (countEl) {
      countEl.textContent = counts && counts[sentiment] != null ? `${counts[sentiment]} commentaires` : "";
    }
  });
}

/* ==========================================================================
   Scroll reveal
   ========================================================================== */

function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;

  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  els.forEach((el) => observer.observe(el));
}

/* ==========================================================================
   Loading screen — segmented ring reflecting the real state of a request
   ========================================================================== */

const LOADING_STEPS = [
  { title: "Récupération des commentaires", icon: "document" },
  { title: "Analyse du sentiment", icon: "chip" },
  { title: "Préparation des résultats", icon: "chart" },
];
const LOADING_STEP_INTERVAL_MS = 1500;

/**
 * Drives the app.html loading screen. Steps advance on a timer while the
 * request is in flight (we only get a single /api/analyze response, not
 * per-phase progress from the server, so this is an honest best-effort
 * pace) but the screen only ever completes -- ring fully blue, checkmark,
 * exit transition -- once the real response has actually arrived.
 */
function createLoadingScreen(rootEl) {
  const arcs = Array.from(rootEl.querySelectorAll(".loading-ring__arc"));
  const icons = Array.from(rootEl.querySelectorAll(".loading-ring__icon-svg"));
  const stepCounter = rootEl.querySelector("[data-step-current]");
  const titleEl = rootEl.querySelector("[data-step-title]");
  const items = Array.from(rootEl.querySelectorAll(".loading-checklist__item"));
  const videoEl = rootEl.querySelector("[data-loading-video]");

  let currentStep = -1;
  let timer = null;

  function showIcon(name) {
    icons.forEach((icon) => icon.classList.toggle("is-visible", icon.dataset.icon === name));
  }

  function setTitle(text) {
    if (prefersReducedMotion()) {
      titleEl.textContent = text;
      return;
    }
    titleEl.style.opacity = "0";
    setTimeout(() => {
      titleEl.textContent = text;
      titleEl.style.opacity = "1";
    }, 200);
  }

  function goToStep(i) {
    currentStep = i;
    arcs.forEach((arc, idx) => arc.classList.toggle("is-active", idx <= i));
    items.forEach((item, idx) => {
      item.classList.toggle("is-active", idx === i);
      item.classList.toggle("is-done", idx < i);
    });
    const step = LOADING_STEPS[i];
    if (step) {
      setTitle(step.title);
      showIcon(step.icon);
      stepCounter.textContent = String(i + 1);
    }
  }

  function start(videoUrl) {
    rootEl.hidden = false;
    rootEl.classList.remove("is-leaving");
    videoEl.textContent = videoUrl;
    currentStep = -1;
    goToStep(0);

    if (timer) clearInterval(timer);
    if (!prefersReducedMotion()) {
      timer = setInterval(() => {
        if (currentStep < LOADING_STEPS.length - 1) {
          goToStep(currentStep + 1);
        }
        // holds, pulsing, on the last step until complete()/stopForError() is called
      }, LOADING_STEP_INTERVAL_MS);
    }
  }

  /** Called once the real API response has arrived successfully. */
  function complete(onDone) {
    if (timer) clearInterval(timer);
    arcs.forEach((arc) => arc.classList.add("is-active"));
    items.forEach((item) => {
      item.classList.remove("is-active");
      item.classList.add("is-done");
    });
    setTitle("Résultats prêts");
    showIcon("check");
    stepCounter.textContent = String(LOADING_STEPS.length);

    if (prefersReducedMotion()) {
      onDone();
      return;
    }
    setTimeout(() => {
      rootEl.classList.add("is-leaving");
      setTimeout(onDone, 600);
    }, 500);
  }

  /** Called if the request fails: stop advancing, hand control back to the form. */
  function stopForError() {
    if (timer) clearInterval(timer);
    rootEl.hidden = true;
  }

  return { start, complete, stopForError };
}

/* ==========================================================================
   Tabs (used for the comments section on results.html)
   ========================================================================== */

function initTabs(rootEl) {
  if (!rootEl) return;
  const list = rootEl.querySelector(".tab-underline-list");
  const thumb = rootEl.querySelector(".tab-underline-indicator");
  const buttons = Array.from(rootEl.querySelectorAll(".tabs__btn"));
  const panels = Array.from(rootEl.querySelectorAll(".tabs__panel"));
  if (!buttons.length) return;

  function moveThumb(btn) {
    if (!thumb || !list) return;
    const listRect = list.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    thumb.style.width = `${btnRect.width}px`;
    thumb.style.transform = `translateX(${btnRect.left - listRect.left}px)`;
  }

  function activate(sentiment) {
    const btn = buttons.find((b) => b.dataset.sentiment === sentiment);
    buttons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sentiment === sentiment)));
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.sentiment === sentiment));
    if (btn) moveThumb(btn);
  }

  buttons.forEach((btn, i) => {
    btn.addEventListener("click", () => activate(btn.dataset.sentiment));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") buttons[(i + 1) % buttons.length].focus();
      if (e.key === "ArrowLeft") buttons[(i - 1 + buttons.length) % buttons.length].focus();
    });
  });

  window.addEventListener("resize", () => {
    const active = buttons.find((b) => b.getAttribute("aria-selected") === "true");
    if (active) moveThumb(active);
  });

  activate(buttons[0].dataset.sentiment);
}

/* ==========================================================================
   Landing page
   ========================================================================== */

/** Horizontal scroll-snap carousel for the "Pourquoi Sentio" feature cards. */
function initCarousel() {
  const track = document.getElementById("track");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  if (!track || !prevBtn || !nextBtn) return;

  function cardStep() {
    const card = track.querySelector(".feature-card");
    if (!card) return track.clientWidth;
    const gap = parseFloat(window.getComputedStyle(track).columnGap || "0");
    return card.getBoundingClientRect().width + gap;
  }

  prevBtn.addEventListener("click", () => track.scrollBy({ left: -cardStep(), behavior: "smooth" }));
  nextBtn.addEventListener("click", () => track.scrollBy({ left: cardStep(), behavior: "smooth" }));

  function updateNavState() {
    prevBtn.disabled = track.scrollLeft <= 4;
    nextBtn.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
  }
  track.addEventListener("scroll", updateNavState);
  updateNavState();
}

/** Loops the hero pill word through a typewriter type/erase cycle. */
function initHeroTypewriter() {
  const el = document.querySelector("[data-typewriter]");
  if (!el) return;

  const words = ["pense", "ressent", "retient"];

  if (prefersReducedMotion()) {
    el.textContent = words[0];
    return;
  }

  const TYPE_MS = 90;
  const ERASE_MS = 50;
  const HOLD_MS = 1400;
  let wordIndex = 0;

  function typeWord(word, i) {
    el.textContent = word.slice(0, i);
    if (i < word.length) {
      setTimeout(() => typeWord(word, i + 1), TYPE_MS);
    } else {
      setTimeout(() => eraseWord(word, word.length), HOLD_MS);
    }
  }

  function eraseWord(word, i) {
    el.textContent = word.slice(0, i);
    if (i > 0) {
      setTimeout(() => eraseWord(word, i - 1), ERASE_MS);
    } else {
      wordIndex = (wordIndex + 1) % words.length;
      typeWord(words[wordIndex], 0);
    }
  }

  typeWord(words[wordIndex], 0);
}

function initLandingPage() {
  initCarousel();
  initHeroTypewriter();

  const form = document.querySelector("[data-analyze-form]");
  if (!form) return;
  const input = form.querySelector("input[type=text]");
  const errorEl = form.querySelector(".form-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!isLikelyYouTubeUrl(value)) {
      errorEl.textContent = "Colle une URL YouTube valide (ex : https://www.youtube.com/watch?v=...).";
      errorEl.classList.add("is-visible");
      input.focus();
      return;
    }
    errorEl.classList.remove("is-visible");
    window.location.href = `app.html?url=${encodeURIComponent(value)}`;
  });
}

/* ==========================================================================
   App page — input + live pipeline driven by the real fetch() to /api/analyze
   ========================================================================== */

function initAppPage() {
  const form = document.querySelector("[data-analyze-form]");
  const input = form.querySelector("input[type=text]");
  const submitBtn = form.querySelector("button[type=submit]");
  const errorBanner = document.querySelector("[data-error-banner]");
  const formWrap = document.querySelector("[data-form-wrap]");
  const loadingRoot = document.querySelector("[data-loading-screen]");
  const loadingScreen = createLoadingScreen(loadingRoot);

  const params = new URLSearchParams(window.location.search);
  const prefillUrl = params.get("url");
  if (prefillUrl) input.value = prefillUrl;

  function setError(message) {
    if (!message) {
      errorBanner.classList.remove("is-visible");
      errorBanner.textContent = "";
      return;
    }
    errorBanner.textContent = message;
    errorBanner.classList.add("is-visible");
  }

  async function runAnalysis(videoUrl) {
    setError(null);
    submitBtn.classList.add("is-loading");
    submitBtn.disabled = true;
    if (formWrap) formWrap.hidden = true;
    loadingScreen.start(videoUrl);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_url: videoUrl, max_comments: 500 }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const message = (data && data.detail) || `Erreur inattendue (HTTP ${response.status}).`;
        throw new Error(typeof message === "string" ? message : "Requête invalide.");
      }

      // The screen only ever completes once this real response is in hand --
      // never before, regardless of where the timer-driven steps had gotten to.
      sessionStorage.setItem(STORAGE_RESULT_KEY, JSON.stringify(data));
      sessionStorage.setItem(STORAGE_URL_KEY, videoUrl);

      loadingScreen.complete(() => {
        window.location.href = "results.html";
      });
    } catch (err) {
      loadingScreen.stopForError();
      if (formWrap) formWrap.hidden = false;
      setError(err.message || "Une erreur est survenue pendant l'analyse.");
      submitBtn.classList.remove("is-loading");
      submitBtn.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!isLikelyYouTubeUrl(value)) {
      setError("Colle une URL YouTube valide (ex : https://www.youtube.com/watch?v=...).");
      input.focus();
      return;
    }
    runAnalysis(value);
  });

  if (prefillUrl && isLikelyYouTubeUrl(prefillUrl)) {
    runAnalysis(prefillUrl);
  }
}

/* ==========================================================================
   Results page
   ========================================================================== */

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return iso || "—";
  }
}

/** Top most-frequent words per sentiment, rendered as a pill cloud sized by frequency. */
const WORD_PILL_MIN_REM = 0.78;
const WORD_PILL_MAX_REM = 1.6;

function renderWords(container, words) {
  if (!container) return;
  container.innerHTML = "";
  if (!words || !words.length) {
    container.innerHTML = '<p class="empty-state">Pas assez de données.</p>';
    return;
  }
  const sentiment = container.dataset.sentiment;
  const reduced = prefersReducedMotion();
  const max = Math.max(...words.map((w) => w.count));

  words.forEach((w, i) => {
    const pill = document.createElement("span");
    pill.className = "word-pill";
    pill.dataset.sentiment = sentiment;
    const ratio = max > 0 ? w.count / max : 0;
    pill.style.fontSize = `${(WORD_PILL_MIN_REM + ratio * (WORD_PILL_MAX_REM - WORD_PILL_MIN_REM)).toFixed(2)}rem`;
    if (!reduced) pill.style.animationDelay = `${i * 0.05}s`;

    const word = document.createElement("span");
    word.textContent = w.word;
    const count = document.createElement("span");
    count.className = "word-pill__count";
    count.textContent = String(w.count);

    pill.appendChild(word);
    pill.appendChild(count);
    container.appendChild(pill);
  });
}

const LIKE_ICON_URL = "https://img.icons8.com/?size=100&id=JNSbMYfKGHeR&format=png&color=000000";
const TOP_LIKED_ICON_URL = "https://img.icons8.com/?size=100&id=kPENNmiEJv3b&format=png&color=000000";

function renderComments(container, comments) {
  if (!container) return;
  container.innerHTML = "";
  if (!comments || !comments.length) {
    container.innerHTML = '<p class="empty-state">Aucun commentaire dans cette catégorie.</p>';
    return;
  }
  const sentiment = container.dataset.sentiment;
  const reduced = prefersReducedMotion();

  let topLikedIndex = 0;
  comments.forEach((c, i) => {
    if ((c.like_count ?? 0) > (comments[topLikedIndex].like_count ?? 0)) topLikedIndex = i;
  });

  comments.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "comment-row";
    row.dataset.sentiment = sentiment;
    if (!reduced) row.style.animationDelay = `${Math.min(i, 10) * 0.06}s`;

    const body = document.createElement("div");
    body.className = "comment-row__body";

    const header = document.createElement("div");
    header.className = "comment-row__header";

    const likes = document.createElement("span");
    likes.className = "comment-row__likes";
    const likeIcon = document.createElement("img");
    likeIcon.className = "comment-row__like-icon";
    likeIcon.src = LIKE_ICON_URL;
    likeIcon.alt = "J'aime";
    likes.appendChild(likeIcon);
    likes.appendChild(document.createTextNode(String(c.like_count ?? 0)));
    header.appendChild(likes);

    const authorEl = document.createElement("span");
    authorEl.className = "comment-row__author";
    authorEl.textContent = c.author || "Anonyme";
    header.appendChild(authorEl);

    if (i === topLikedIndex && (c.like_count ?? 0) > 0) {
      const topIcon = document.createElement("img");
      topIcon.className = "comment-row__top-icon";
      topIcon.src = TOP_LIKED_ICON_URL;
      topIcon.alt = "Commentaire le plus liké";
      header.appendChild(topIcon);
    }

    const text = document.createElement("p");
    text.className = "comment-row__text";
    text.textContent = c.text;

    body.appendChild(header);
    body.appendChild(text);

    const score = document.createElement("div");
    score.className = "comment-row__score mono";
    score.textContent = String(Math.round(c.score * 100) / 100);

    row.appendChild(body);
    row.appendChild(score);
    container.appendChild(row);
  });
}

/** Change between the last two points of a series (this month vs. the previous one). */
function monthOverMonthDelta(series) {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const previous = series[series.length - 2];
  return last - previous;
}

/** Renders the red/green "vs. last month" delta row under the chart title. */
function renderChartTrends(data) {
  const root = document.querySelector("[data-chart-trends]");
  if (!root) return;

  const timeline = data.timeline || [];
  const series = {
    positive: timeline.map((t) => t.positive),
    neutral: timeline.map((t) => t.neutral),
    negative: timeline.map((t) => t.negative),
  };

  Object.entries(series).forEach(([sentiment, values]) => {
    const el = root.querySelector(`[data-trend="${sentiment}"]`);
    if (!el) return;

    const delta = monthOverMonthDelta(values);
    el.classList.remove("is-up", "is-down");

    if (delta === null) {
      el.textContent = "—";
      return;
    }
    if (delta > 0) {
      el.textContent = `+${delta} ↑`;
      el.classList.add("is-up");
    } else if (delta < 0) {
      el.textContent = `${delta} ↓`;
      el.classList.add("is-down");
    } else {
      el.textContent = "0 →";
    }
  });
}

/** Vertical dashed line at the active tooltip position, spanning the plot area. */
const crosshairPlugin = {
  id: "crosshair",
  afterDraw(chart) {
    const active = chart.tooltip && chart.tooltip._active;
    if (!active || !active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(29, 29, 31, 0.15)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

function renderCharts(data) {
  if (!window.Chart) return;

  const colors = SENTIMENT_COLOR;
  const timelineCanvas = document.getElementById("timelineChart");
  if (!timelineCanvas) return;

  const timeline = data.timeline || [];
  const series = {
    positive: timeline.map((t) => t.positive),
    neutral: timeline.map((t) => t.neutral),
    negative: timeline.map((t) => t.negative),
  };

  function lineDataset(label, key) {
    return {
      label,
      data: series[key],
      borderColor: colors[key],
      backgroundColor: colors[key],
      fill: false,
      tension: 0.4,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: colors[key],
      pointHoverBorderColor: "#fff",
      pointHoverBorderWidth: 2,
    };
  }

  new Chart(timelineCanvas, {
    type: "line",
    data: {
      labels: timeline.map((t) => t.period),
      datasets: [lineDataset("Positif", "positive"), lineDataset("Neutre", "neutral"), lineDataset("Négatif", "negative")],
    },
    plugins: [crosshairPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: prefersReducedMotion()
        ? false
        : {
            duration: 550,
            delay(ctx) {
              if (ctx.type === "data" && ctx.mode === "default") {
                return ctx.dataIndex * 12 + ctx.datasetIndex * 90;
              }
              return 0;
            },
          },
      scales: {
        x: {
          grid: { display: false },
          title: { display: true, text: "Mois", font: { family: "Inter", size: 11 }, color: "#6e6e73" },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: "rgba(0, 0, 0, 0.06)" },
          title: { display: true, text: "Commentaires", font: { family: "Inter", size: 11 }, color: "#6e6e73" },
        },
      },
      plugins: {
        legend: { display: false }, // replaced by the colored delta row under the chart (renderChartTrends)
        tooltip: {
          backgroundColor: "#1d1d1f",
          titleColor: "#fff",
          bodyColor: "rgba(255, 255, 255, 0.85)",
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
        },
      },
    },
  });
}

function initResultsPage() {
  const emptyState = document.querySelector("[data-no-results]");
  const content = document.querySelector("[data-results-content]");
  const raw = sessionStorage.getItem(STORAGE_RESULT_KEY);

  if (!raw) {
    emptyState?.classList.add("is-visible");
    if (content) content.style.display = "none";
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    emptyState?.classList.add("is-visible");
    if (content) content.style.display = "none";
    return;
  }

  if (content) content.style.display = "";

  // Each section is rendered independently: one section throwing (e.g. an
  // unexpected/missing field after an API change) must never blank out the
  // rest of the page, which is exactly what happened when a stale
  // frontend/backend pairing crashed mid-render and silently skipped
  // everything after it.
  runSection("video header", () => {
    document.querySelector("[data-video-title]").textContent = data.video.title;
    document.querySelector("[data-video-channel]").textContent = data.video.channel;
    document.querySelector("[data-video-published]").textContent = formatDate(data.video.published_at);

    const thumbEl = document.querySelector("[data-video-thumb]");
    if (thumbEl && data.video.thumbnail_url) {
      const img = document.createElement("img");
      img.src = data.video.thumbnail_url;
      img.alt = `Miniature : ${data.video.title}`;
      thumbEl.replaceChildren(img);
    }
  });

  runSection("orb cluster", () => {
    const orbRoot = document.querySelector("[data-results-orbs]");
    const counts = {
      positive: Math.round((data.video.comment_count * data.summary.positive_pct) / 100),
      neutral: Math.round((data.video.comment_count * data.summary.neutral_pct) / 100),
      negative: Math.round((data.video.comment_count * data.summary.negative_pct) / 100),
    };
    animateOrbCluster(orbRoot, {
      positive: data.summary.positive_pct,
      neutral: data.summary.neutral_pct,
      negative: data.summary.negative_pct,
    }, counts);
    initOrbParallax(document.getElementById("orb-parallax"));
  });

  runSection("metric strip", () => {
    document.querySelector("[data-avg-confidence]").textContent = data.summary.avg_confidence.toFixed(2);
    document.querySelector("[data-meta-latency-metric]").textContent = `${Math.round(data.meta.latency_ms_per_comment)}ms`;
  });

  runSection("charts", () => {
    renderCharts(data);
    renderChartTrends(data);
  });

  runSection("top words", () => {
    renderWords(document.querySelector('[data-words="positive"]'), data.top_words.positive);
    renderWords(document.querySelector('[data-words="neutral"]'), data.top_words.neutral);
    renderWords(document.querySelector('[data-words="negative"]'), data.top_words.negative);
  });

  runSection("comments", () => {
    renderComments(document.querySelector('[data-comments="positive"]'), data.comments.positive);
    renderComments(document.querySelector('[data-comments="neutral"]'), data.comments.neutral);
    renderComments(document.querySelector('[data-comments="negative"]'), data.comments.negative);
    initTabs(document.querySelector("[data-tabs]"));
  });

}

function runSection(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[Sentio] Échec du rendu de la section "${label}":`, err);
  }
}

/** Subtle pointer-tracked drift on the orb cluster (results hero only). */
function initOrbParallax(parallaxEl) {
  if (!parallaxEl || prefersReducedMotion()) return;
  const hero = parallaxEl.closest(".hero");
  if (!hero) return;

  hero.addEventListener("mousemove", (e) => {
    const rect = hero.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
    const y = (e.clientY - rect.top - rect.height / 2) / rect.height;
    parallaxEl.style.transform = `translate(${x * 14}px, ${y * 10}px)`;
  });
  hero.addEventListener("mouseleave", () => {
    parallaxEl.style.transform = "translate(0, 0)";
  });
}

/* ==========================================================================
   Dispatch
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initReveal();
  const page = document.body.dataset.page;
  if (page === "landing") initLandingPage();
  if (page === "app") initAppPage();
  if (page === "results") initResultsPage();
});
