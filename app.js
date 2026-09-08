/* Experiment 1 page (計画書_聴取Web_20260908 §2.2).  Plain JS, no framework.
   The trial list comes from trials/exp1/<P>.json (opaque stim_ids only); randomness was
   drawn offline.  One row is inserted into Supabase per trial; on failure the row is kept in
   localStorage and re-sent before the next trial (nothing is skipped). */
(function () {
  "use strict";
  var CFG = window.LISTEN_CONFIG;
  var EXP = 1;
  var P = new URLSearchParams(location.search).get("p") || "";
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) {
    ["s-noid", "s-intro", "s-volume", "s-trial", "s-break", "s-done", "s-error"].forEach(function (s) { $(s).hidden = (s !== id); });
    window.scrollTo(0, 0);
  };
  $("ver").textContent = "v" + CFG.VERSION;
  if (!/^L\d{2}$/.test(P)) { show("s-noid"); return; }
  $("pid").textContent = P;

  var LS = "listen_" + EXP + "_" + P;
  var state = JSON.parse(localStorage.getItem(LS) || "{}");   // {consented, volume, pending:[rows], lock}
  var save = function () { localStorage.setItem(LS, JSON.stringify(state)); };
  var trials = null, idx = 0, cur = null, tRef = null, tTest = null, nRef = 0, nTest = 0, firstPlay = 0, testEnded = false;

  // ---------- Supabase (insert-only with the publishable key) ----------
  function sb(path, body, method) {
    return fetch(CFG.SUPABASE_URL + "/rest/v1/" + path, {
      method: method || "POST",
      headers: { "apikey": CFG.SUPABASE_ANON_KEY, "Authorization": "Bearer " + CFG.SUPABASE_ANON_KEY,
                 "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(body)
    });
  }
  function insertRow(table, row) {
    return sb(table, row).then(function (r) {
      if (r.ok || r.status === 409) return true;           // 409 = already saved (unique key)
      return r.text().then(function (t) { throw new Error(table + " " + r.status + " " + t.slice(0, 120)); });
    });
  }
  function progress() {
    return sb("rpc/progress", { p: P, e: EXP }).then(function (r) { return r.ok ? r.json() : 0; }).then(function (n) { return Number(n) || 0; });
  }
  function logEvent(kind, detail, trial_no) {
    insertRow("events", { participant: P, exp: EXP, kind: kind, trial_no: trial_no || null, detail: detail || null }).catch(function () {});
  }
  function flushPending() {
    var q = state.pending || [];
    if (!q.length) return Promise.resolve(true);
    return insertRow("responses", q[0]).then(function () { state.pending = q.slice(1); save(); return flushPending(); });
  }

  // ---------- audio ----------
  function audioFor(stim) {
    var a = new Audio(CFG.AUDIO_BASE + "/exp1/" + stim + ".wav");
    a.preload = "auto";
    return a;
  }
  function wirePlay(btn, getAudio, onPlay, onEnd) {
    btn.onclick = function () {
      var a = getAudio(); if (!a) return;
      a.currentTime = 0;
      a.play().then(function () { btn.classList.add("playing"); onPlay(); }).catch(function (e) { $("hint").textContent = "再生できませんでした: " + e; });
      a.onended = function () { btn.classList.remove("playing"); if (onEnd) onEnd(); };
    };
  }

  // ---------- flow ----------
  function loadTrials() {
    return fetch("trials/exp" + EXP + "/" + P + ".json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("trials " + r.status);
      return r.json();
    });
  }
  $("b-start").onclick = function () { $("m-consent").hidden = false; };
  $("b-decline").onclick = function () { $("m-consent").hidden = true; };
  $("b-consent").onclick = function () {
    $("m-consent").hidden = true;
    if (!state.consented) {
      insertRow("participants", { id: P, exp: EXP, ua: navigator.userAgent.slice(0, 200) }).catch(function () {});
      state.consented = Date.now(); save(); logEvent("consent");
    }
    startVolume();
  };
  function startVolume() {
    show("s-volume");
    var a = audioFor(trials.trials[0].ref);           // alpha=0 reference of the first trial (計画書 §2.1)
    var played = false;
    wirePlay($("b-volplay"), function () { return a; }, function () { played = true; $("b-volok").disabled = false; }, null);
    $("b-volok").onclick = function () { state.volume = Date.now(); save(); logEvent("volume_ok"); startTrials(); };
  }
  function startTrials() {
    progress().then(function (n) {
      idx = n + (state.pending || []).length;          // rows still pending locally count as answered
      if (idx >= trials.n_trials) return finish();
      show("s-trial");
      logEvent(n ? "resume" : "start", { from: idx + 1 });
      showTrial();
    });
  }
  function showTrial() {
    cur = trials.trials[idx];
    $("bar").style.width = Math.round(100 * idx / trials.n_trials) + "%";
    $("pcount").textContent = (idx + 1) + " / " + trials.n_trials;
    tRef = audioFor(cur.ref); tTest = audioFor(cur.test);
    nRef = 0; nTest = 0; firstPlay = 0; testEnded = false;
    $("b-yes").disabled = $("b-no").disabled = true;
    $("hint").textContent = "テスト音声を最後まで 1 回聴くと答えられます";
    $("b-ref").classList.remove("playing"); $("b-test").classList.remove("playing");
    wirePlay($("b-ref"), function () { return tRef; }, function () { nRef++; }, null);
    wirePlay($("b-test"), function () { return tTest; },
      function () { nTest++; if (!firstPlay) firstPlay = Date.now(); },
      function () { testEnded = true; $("b-yes").disabled = $("b-no").disabled = false; $("hint").textContent = ""; });
    if (idx + 1 < trials.n_trials) { audioFor(trials.trials[idx + 1].test); audioFor(trials.trials[idx + 1].ref); }  // prefetch
  }
  function answer(v) {
    if (!testEnded) return;
    $("b-yes").disabled = $("b-no").disabled = true;
    var row = { participant: P, exp: EXP, trial_no: cur.no, ref: cur.ref, test: cur.test, answer: v,
                rt_ms: firstPlay ? Date.now() - firstPlay : null, n_play_ref: nRef, n_play_test: nTest,
                client_ts: new Date().toISOString() };
    tRef.pause(); tTest.pause();
    state.pending = (state.pending || []).concat([row]); save();
    flushPending().then(function () {
      idx++;
      if (idx >= trials.n_trials) return finish();
      if (idx === trials.break_after) { show("s-break"); logEvent("break", null, idx); return; }
      showTrial();
    }).catch(function (e) {
      $("errmsg").textContent = "回答は端末に保存されています。通信が戻ったら「もう一度送る」を押してください。(" + e.message + ")";
      show("s-error"); logEvent("error", { msg: String(e.message).slice(0, 120) }, cur.no);
    });
  }
  $("b-yes").onclick = function () { answer("yes"); };
  $("b-no").onclick = function () { answer("no"); };
  $("b-resume").onclick = function () { show("s-trial"); logEvent("resume", null, idx + 1); showTrial(); };
  $("b-retry").onclick = function () {
    flushPending().then(function () { startTrials(); })   // startTrials recounts from the server
      .catch(function (e) { $("errmsg").textContent = "まだ送れません。少し待ってからもう一度押してください。(" + e.message + ")"; });
  };
  function finish() {
    var code = P + "-" + Date.now().toString(36).toUpperCase().slice(-6);
    if (!state.code) { state.code = code; save(); logEvent("finish", { code: code }); }
    $("code").textContent = state.code; show("s-done");
  }

  // ---------- boot ----------
  loadTrials().then(function (t) {
    trials = t;
    $("ntr").textContent = t.n_trials;
    if (state.code) return finish();
    if (state.consented && state.volume) return startTrials();
    show("s-intro");
  }).catch(function (e) { $("s-noid").hidden = false; $("s-noid").querySelector("p").textContent = "リンクの番号が登録されていません (" + e.message + ")"; });
})();
