/**
 * Kite landing interactivity — Web Audio "Steam-like" hover tones,
 * stage carousel, magnetic cards, scroll reveals.
 * Sound is OFF until the user presses the Sound button (browser + courtesy).
 */
(function () {
  var reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sound engine (synthesized — no audio files) ---------- */
  var audioCtx = null;
  var master = null;
  var soundEnabled = false;
  var lastWhoosh = 0;

  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      master = audioCtx.createGain();
      master.gain.value = 0.22;
      master.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, type, gainVal) {
    var ctx = ensureAudio();
    if (!ctx || !soundEnabled) return;
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainVal || 0.08, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function whoosh(pitch) {
    var now = performance.now();
    if (now - lastWhoosh < 180) return;
    lastWhoosh = now;
    var ctx = ensureAudio();
    if (!ctx || !soundEnabled) return;
    var t0 = ctx.currentTime;
    var bufferSize = ctx.sampleRate * 0.35;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(400 + (pitch || 0), t0);
    filter.frequency.exponentialRampToValueAtTime(1200 + (pitch || 0), t0 + 0.28);
    filter.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    noise.connect(filter);
    filter.connect(g);
    g.connect(master);
    noise.start(t0);
    noise.stop(t0 + 0.35);
    tone(220 + (pitch || 0) * 0.15, 0.22, "triangle", 0.035);
  }

  function tick() {
    tone(880, 0.06, "sine", 0.04);
    tone(1320, 0.05, "sine", 0.02);
  }

  var soundBtn = document.getElementById("sound-btn");
  var soundDock = document.getElementById("sound-dock");
  function setSound(on) {
    soundEnabled = on;
    if (on) ensureAudio();
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
      soundBtn.innerHTML = on
        ? '<span class="eq" aria-hidden="true"></span> Sound on'
        : '<span class="eq off" aria-hidden="true"></span> Sound off';
    }
    try {
      localStorage.setItem("kite.landingSound", on ? "1" : "0");
    } catch (e) {}
    if (on) tick();
  }
  if (soundBtn) {
    soundBtn.addEventListener("click", function () {
      setSound(!soundEnabled);
      if (soundDock) soundDock.classList.remove("show-hint");
    });
    try {
      if (localStorage.getItem("kite.landingSound") === "1" && !reduced) {
        /* still require a click for AudioContext — just remember preference after */
      }
    } catch (e) {}
    if (!reduced) {
      setTimeout(function () {
        if (soundDock && !soundEnabled) soundDock.classList.add("show-hint");
      }, 1600);
      setTimeout(function () {
        if (soundDock) soundDock.classList.remove("show-hint");
      }, 7000);
    }
  }

  /* ---------- stage carousel ---------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll(".stage-card"));
  var dots = Array.prototype.slice.call(document.querySelectorAll(".stage-dot"));
  var active = 0;

  function setActive(i, play) {
    if (!cards.length) return;
    active = (i + cards.length) % cards.length;
    cards.forEach(function (c, idx) {
      c.classList.toggle("is-active", idx === active);
      c.setAttribute("aria-current", idx === active ? "true" : "false");
    });
    dots.forEach(function (d, idx) {
      d.setAttribute("aria-current", idx === active ? "true" : "false");
    });
    if (play) whoosh(180 + active * 90);
  }

  cards.forEach(function (card, idx) {
    card.addEventListener("mouseenter", function () {
      setActive(idx, true);
    });
    card.addEventListener("focus", function () {
      setActive(idx, true);
    });
    card.addEventListener("click", function () {
      setActive(idx, true);
      tick();
    });
  });
  dots.forEach(function (dot, idx) {
    dot.addEventListener("click", function () {
      setActive(idx, true);
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") setActive(active + 1, true);
    if (e.key === "ArrowLeft") setActive(active - 1, true);
  });
  setActive(0, false);

  if (!reduced) {
    setInterval(function () {
      if (document.hidden) return;
      var hovered = cards.some(function (c) {
        return c.matches(":hover");
      });
      if (!hovered) setActive(active + 1, soundEnabled);
    }, 5200);
  }

  /* ---------- magnetic download cards ---------- */
  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      card.style.setProperty("--mx", x + "%");
      card.style.setProperty("--my", y + "%");
      if (!reduced) {
        var dx = (e.clientX - (r.left + r.width / 2)) / 28;
        var dy = (e.clientY - (r.top + r.height / 2)) / 28;
        card.style.transform =
          "perspective(700px) rotateY(" +
          dx +
          "deg) rotateX(" +
          -dy +
          "deg) translateY(-2px)";
      }
    });
    card.addEventListener("pointerleave", function () {
      card.style.transform = "";
    });
    card.addEventListener("mouseenter", function () {
      whoosh(120);
    });
  });

  /* ---------- scroll reveals ---------- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("is-in");
    });
  }

  /* ---------- hero ready + platform detect + releases ---------- */
  requestAnimationFrame(function () {
    var hero = document.querySelector(".hero");
    if (hero) hero.classList.add("is-ready");
  });

  var repo = "taksha17/kite";
  var ua = navigator.userAgent;
  var key = /Windows/i.test(ua)
    ? "windows"
    : /Android|iPhone|iPad/i.test(ua)
      ? "android"
      : /Mac/i.test(ua)
        ? "mac-arm"
        : /Linux/i.test(ua)
          ? "linux"
          : null;
  if (key) {
    var el = document.querySelector('[data-platform="' + key + '"]');
    if (el) el.classList.add("detected");
    if (key === "mac-arm") {
      var intel = document.querySelector('[data-platform="mac-intel"]');
      if (intel) intel.classList.add("detected");
    }
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  fetch("https://api.github.com/repos/" + repo + "/releases/latest")
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (rel) {
      if (!rel) return;
      if (rel.tag_name) {
        var lv = document.getElementById("latest-version");
        var pill = document.getElementById("version-pill");
        if (lv) lv.textContent = rel.tag_name;
        if (pill) pill.textContent = rel.tag_name + " · AI-first · MIT";
      }
      (rel.assets || []).forEach(function (a) {
        var slot = document.querySelector('[data-meta="' + a.name + '"]');
        if (slot)
          slot.textContent =
            fmtSize(a.size) + " · " + a.download_count + " downloads";
      });
    })
    .catch(function () {});
})();
