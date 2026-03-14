/* build: v27 */
console.log("SMV build v27 loaded");

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const canvas = $("#c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const fileEl = $("#file");
  const playBtn = $("#play");
  const micBtn = $("#mic");
  const sysBtn = $("#sys"); // tolerate older ids
  const audioEl = $("#audio");
  const layersEl = $("#layers");
  const vizMethodEl = $("#vizMethod");
  const logoStyleEl = $("#logoStyle");
  const logoImageEl = $("#logoImage");
  const logoImageStateEl = $("#logoImageState");

  const uiParams = {
    hueShift: $("#hueShift"),
    excitement: $("#excitement"),
    shapeBand: $("#shapeBand"),
    amplitude: $("#amplitude"),
    period: $("#period")
  };
  const uiParamOut = {
    hueShift: $("#hueShiftVal"),
    excitement: $("#excitementVal"),
    shapeBand: $("#shapeBandVal"),
    amplitude: $("#amplitudeVal"),
    period: $("#periodVal")
  };

  const vizControls = {
    hueShift: 0,
    excitement: 1,
    shapeBand: 1,
    amplitude: 1,
    period: 1
  };

  let logoImage = null;
  let logoImageURL = null;
  let logoImageReady = false;

  // ---------- canvas sizing ----------
  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function fmtVal(k, v) {
    return k === "hueShift" ? String(Math.round(v)) : v.toFixed(2);
  }

  function updateParam(name) {
    const input = uiParams[name];
    if (!input) return;
    vizControls[name] = Number(input.value);
    if (uiParamOut[name]) uiParamOut[name].textContent = fmtVal(name, vizControls[name]);
  }

  Object.keys(uiParams).forEach((k) => {
    updateParam(k);
    uiParams[k]?.addEventListener("input", () => updateParam(k));
  });

  logoImageEl?.addEventListener("change", () => {
    const f = logoImageEl.files && logoImageEl.files[0];
    if (!f) {
      logoImageReady = false;
      if (logoImageStateEl) logoImageStateEl.textContent = "none";
      return;
    }
    if (logoImageURL) URL.revokeObjectURL(logoImageURL);
    logoImageURL = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      logoImage = img;
      logoImageReady = true;
      if (logoImageStateEl) logoImageStateEl.textContent = "loaded";
    };
    img.onerror = () => {
      logoImageReady = false;
      if (logoImageStateEl) logoImageStateEl.textContent = "error";
    };
    img.src = logoImageURL;
  });

  // ---------- audio graph ----------
  let actx = null;
  let analyser = null;
  let outGain = null;
  let srcNode = null;
  let micStream = null;
  let sysStream = null;

  const freqBuf = new Uint8Array(2048);

  function ensureAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    analyser = actx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.82;

    outGain = actx.createGain();
    outGain.gain.value = 1.0;
    outGain.connect(actx.destination);
  }

  async function resumeAudio() {
    ensureAudio();
    if (actx.state === "suspended") await actx.resume();
  }

  function stopStream(stream) {
    if (!stream) return null;
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
    return null;
  }

  function disconnectSrc() {
    try { if (srcNode) srcNode.disconnect(); } catch {}
    srcNode = null;
  }

  function connectNode(node, toOutput) {
    disconnectSrc();
    srcNode = node;
    try { srcNode.connect(analyser); } catch (e) { console.warn("connect analyser", e); }
    if (toOutput) {
      try { srcNode.connect(outGain); } catch (e) { console.warn("connect output", e); }
    }
  }

  async function useFile(file) {
    await resumeAudio();
    micStream = stopStream(micStream);
    sysStream = stopStream(sysStream);

    audioEl.pause();
    audioEl.src = URL.createObjectURL(file);
    audioEl.load();

    // IMPORTANT: once routed into WebAudio, you must also connect to destination to hear it
    const node = actx.createMediaElementSource(audioEl);
    connectNode(node, true);

    playBtn.disabled = false;
    playBtn.textContent = "Pause";
    try {
      await audioEl.play();
    } catch {
      playBtn.textContent = "Play";
    }
  }

  async function useMic() {
    await resumeAudio();
    sysStream = stopStream(sysStream);
    micStream = stopStream(micStream);

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const node = actx.createMediaStreamSource(micStream);
    connectNode(node, false); // avoid feedback
    playBtn.disabled = true;
  }

  async function useSystem() {
    await resumeAudio();
    micStream = stopStream(micStream);
    sysStream = stopStream(sysStream);

    // Chrome requires a user gesture (button click)
    sysStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    // stop video track; keep audio
    try { sysStream.getVideoTracks().forEach(t => t.stop()); } catch {}
    const node = actx.createMediaStreamSource(sysStream);
    connectNode(node, false); // avoid echo/feedback
    playBtn.disabled = true;
  }

  fileEl?.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await useFile(f);
  });

  playBtn?.addEventListener("click", async () => {
    await resumeAudio();
    if (audioEl.paused) {
      await audioEl.play();
      playBtn.textContent = "Pause";
    } else {
      audioEl.pause();
      playBtn.textContent = "Play";
    }
  });

  micBtn?.addEventListener("click", async () => {
    try { await useMic(); } catch (e) { console.warn(e); }
  });

  sysBtn?.addEventListener("click", async () => {
    try { await useSystem(); } catch (e) { console.warn(e); }
  });

  // ---------- layers ----------
  const overlays = new Set(["wave"]); // default

  // Delegated click handler: cannot “miss” even if buttons reflow
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".layer-btn");
    if (!btn) return;
    const k = btn.dataset.layer;
    if (!k) return;
    if (overlays.has(k)) overlays.delete(k);
    else overlays.add(k);
    btn.setAttribute("aria-pressed", String(overlays.has(k)));
    if (vizMethodEl) vizMethodEl.value = "custom";
  });

  function syncLayerButtons() {
    $$(".layer-btn").forEach((btn) => {
      const k = btn.dataset.layer;
      btn.setAttribute("aria-pressed", String(overlays.has(k)));
    });
  }

  function setVizMethod(method) {
    if (method === "custom") return;
    overlays.clear();
    if (method === "cymatic") {
      overlays.add("cymatic");
      overlays.add("wave");
    } else if (method === "orbital") {
      overlays.add("orbit");
      overlays.add("flow");
    } else if (method === "bars") {
      overlays.add("blocks");
      overlays.add("wave");
    } else if (method === "full") {
      ["wave", "blocks", "radiate", "flow", "orbit", "cymatic", "logos"].forEach((k) => overlays.add(k));
    } else if (method === "logos") {
      overlays.add("logos");
    }
    syncLayerButtons();
  }

  vizMethodEl?.addEventListener("change", () => {
    setVizMethod(vizMethodEl.value);
  });

  // Keyboard shortcuts 1-7 toggle layers
  const keyMap = {
    "1": "wave",
    "2": "blocks",
    "3": "radiate",
    "4": "flow",
    "5": "orbit",
    "6": "cymatic",
    "7": "logos"
  };
  window.addEventListener("keydown", (e) => {
    if (!keyMap[e.key]) return;
    const k = keyMap[e.key];
    if (overlays.has(k)) overlays.delete(k); else overlays.add(k);
    const btn = document.querySelector(`.layer-btn[data-layer="${k}"]`);
    if (btn) btn.setAttribute("aria-pressed", String(overlays.has(k)));
    if (vizMethodEl) vizMethodEl.value = "custom";
  });

  // ---------- analysis / idle spectrum ----------
  let ph = 0;
  function getSpectrum() {
    if (analyser && actx && srcNode) {
      analyser.getByteFrequencyData(freqBuf);
      return freqBuf;
    }
    // idle
    ph += 0.016;
    for (let i = 0; i < freqBuf.length; i++) {
      const t = i / (freqBuf.length - 1);
      const v = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(ph * 1.2 + t * 10)) * (0.25 + 0.75 * t);
      freqBuf[i] = Math.floor(v * 255);
    }
    return freqBuf;
  }

  function clearBG(w, h) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, w, h);
  }

  function drawWave(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";
    const mid = h * 0.5;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const idx = Math.floor(t * (spec.length - 1));
      const v = (spec[idx] || 0) / 255;
      const y = mid + Math.sin(t * 10 + ph * 2.0) * h * 0.10 * (0.3 + v) * vizControls.amplitude + (v - 0.5) * h * 0.30 * vizControls.amplitude;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const hue = 190 + vizControls.hueShift;
    ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 95%, 72%, ${Math.min(0.85, 0.36 + vizControls.excitement * 0.24).toFixed(3)})`;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBlocks(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";
    const bars = 140;
    const padX = w * 0.04;
    const padY = h * 0.08;
    const usableW = w - padX * 2;
    const usableH = h - padY * 1.2;
    const bw = usableW / bars;
    for (let i = 0; i < bars; i++) {
      const t = i / (bars - 1);
      const idx = Math.floor(Math.pow(t, 2.2) * (spec.length - 1));
      const v = (spec[idx] || 0) / 255;
      const bh = v * usableH * vizControls.amplitude;
      const hue = 200 + vizControls.hueShift + t * 70;
      ctx.fillStyle = `hsla(${hue.toFixed(1)}, 92%, ${(45 + vizControls.excitement * 14).toFixed(1)}%, ${(0.05 + v * 0.30 * vizControls.excitement).toFixed(3)})`;
      ctx.fillRect(padX + i * bw, h - padY - bh, bw * 0.86, bh);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawRadiate(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w, h) * 0.46;
    ctx.lineWidth = 3;
    for (let i = 0; i < 360; i += 2) {
      const t = i / 360;
      const idx = Math.floor(t * (spec.length - 1));
      const v = (spec[idx] || 0) / 255;
      const a = t * Math.PI * 2;
      const r1 = R * (0.2 + v * 0.9);
      const r2 = r1 + (25 + v * 85) * vizControls.amplitude;
      const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r2, y2 = cy + Math.sin(a) * r2;
      const hue = 318 + vizControls.hueShift * 0.6 + t * 24;
      ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 98%, 66%, ${(0.09 + v * 0.40 * vizControls.excitement).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawFlow(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";
    const n = Math.floor(90 + 90 * vizControls.excitement);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const idx = Math.floor(t * (spec.length - 1));
      const v = (spec[idx] || 0) / 255;
      const x = (Math.sin(ph * 0.7 + i) * 0.5 + 0.5) * w;
      const y = (Math.cos(ph * 0.6 + i * 1.3) * 0.5 + 0.5) * h;
      const len = (30 + v * 200) * vizControls.amplitude;
      const ang = ph * 0.4 + i * 0.02;
      ctx.lineWidth = 1 + v * 3;
      const hue = 196 + vizControls.hueShift + t * 40;
      ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 90%, 70%, ${(0.05 + v * 0.18 * vizControls.excitement).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // 3D-ish pulse sphere for Orbit
  const SPHERE_N = 520;
  const spherePts = (() => {
    const pts = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < SPHERE_N; i++) {
      const y = 1 - (i / (SPHERE_N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = phi * i;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      pts.push({ x, y, z });
    }
    return pts;
  })();
  const sustain64 = new Float32Array(64);

  function drawOrbit(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";
    const cx = w * 0.5, cy = h * 0.52;
    const baseR = Math.min(w, h) * 0.30 * vizControls.amplitude;

    for (let b = 0; b < 64; b++) {
      const t = b / 63;
      const idx = Math.floor(Math.pow(t, 1.7) * (spec.length - 1));
      const v = (spec[idx] || 0) / 255;
      const attack = 0.22;
      const release = 0.035;
      sustain64[b] = Math.max(v, sustain64[b] - release) * (1 - attack) + v * attack;
    }

    const rotY = ph * 0.9;
    const rotX = Math.sin(ph * 0.35) * 0.6;
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

    const zBias = 1.9;
    const persp = 1.25;

    const tmp = [];
    for (let i = 0; i < spherePts.length; i++) {
      const p = spherePts[i];
      let x = p.x * cosY - p.z * sinY;
      let z = p.x * sinY + p.z * cosY;
      let y = p.y * cosX - z * sinX;
      z = p.y * sinX + z * cosX;

      const band = Math.max(0, Math.min(63, Math.floor((y * 0.5 + 0.5) * 63)));
      const s = sustain64[band];

      const zPulse = z + (s - 0.25) * 1.35;
      const depth = (zPulse + zBias);
      const k = 1 / (1 + (1 - depth) * persp);

      const px = cx + x * baseR * k;
      const py = cy + y * baseR * k;

      const rad = 1.2 + s * 11.0;
      const alpha = 0.04 + s * 0.20 + Math.max(0, zPulse) * 0.04;
      tmp.push({ px, py, rad, alpha, z: zPulse });
    }
    tmp.sort((a, b) => a.z - b.z);

    for (const pt of tmp) {
      const g = ctx.createRadialGradient(pt.px, pt.py, 0, pt.px, pt.py, pt.rad);
      g.addColorStop(0, `rgba(255,255,255,${pt.alpha})`);
      const hueA = 190 + vizControls.hueShift;
      const hueB = 312 + vizControls.hueShift;
      g.addColorStop(0.35, `hsla(${hueA.toFixed(1)}, 96%, 70%, ${(pt.alpha * 0.65).toFixed(3)})`);
      g.addColorStop(1, `hsla(${hueB.toFixed(1)}, 92%, 62%, ${(pt.alpha * 0.28).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pt.px, pt.py, pt.rad, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(125,249,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, baseR * 1.02, baseR * 0.62, ph * 0.15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
  }



  function drawCymatic(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";

    const cx = w * 0.5;
    const cy = h * 0.5;
    const minDim = Math.min(w, h);

    let energySum = 0;
    for (let i = 0; i < spec.length; i++) energySum += spec[i];
    const loudness = energySum / (spec.length * 255);

    const low = (spec[12] || 0) / 255;
    const lowMid = (spec[64] || 0) / 255;
    const high = (spec[300] || 0) / 255;

    const shapeScale = vizControls.shapeBand;
    const modeA = 2 + Math.floor(low * 8 * shapeScale);
    const modeB = 3 + Math.floor(lowMid * 11 * shapeScale);
    const modeC = 5 + Math.floor(high * 14 * shapeScale);

    const points = 720;
    const rings = Math.floor(5 + 4 * Math.min(1.8, vizControls.excitement));

    for (let r = 0; r < rings; r++) {
      const rt = r / (rings - 1);
      const baseRadius = minDim * (0.10 + rt * 0.34) * vizControls.amplitude;
      const harmonicMix = 0.34 + rt * 0.66;
      const lineAlpha = 0.06 + loudness * 0.23 * vizControls.excitement + rt * 0.05;
      const hue = 190 + vizControls.hueShift + loudness * 120 + rt * 36;

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const t = i / points;
        const a = t * Math.PI * 2;

        const radialWave =
          Math.sin(a * modeA + ph * 1.25) * 0.30 +
          Math.sin(a * modeB - ph * 0.8) * 0.22 +
          Math.sin(a * modeC + ph * 0.45) * (0.12 + 0.08 * vizControls.excitement);

        const contour =
          1 +
          radialWave * harmonicMix +
          Math.sin(a * (modeB + modeA * 0.5) + ph * 0.6) * 0.08 * (0.4 + loudness);

        const radialScale = 1 + (loudness - 0.5) * 0.35;
        const rr = baseRadius * contour * radialScale;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.closePath();
      ctx.lineWidth = 1.2 + rt * 1.6 + loudness * 1.2;
      ctx.strokeStyle = `hsla(${hue.toFixed(1)}, 95%, ${(48 + loudness * 20).toFixed(1)}%, ${lineAlpha.toFixed(3)})`;
      ctx.stroke();
    }

    const grain = Math.floor(260 + 260 * vizControls.excitement);
    for (let i = 0; i < grain; i++) {
      const t = i / grain;
      const a = t * Math.PI * 2 + ph * 0.2;
      const mod = Math.abs(Math.sin(a * modeA) * Math.cos(a * modeC));
      const rr = minDim * (0.09 + mod * (0.12 + loudness * 0.35));
      const x = cx + Math.cos(a * (1 + lowMid * 0.8)) * rr;
      const y = cy + Math.sin(a * (1 + high * 1.0)) * rr;
      const glow = 0.04 + mod * (0.16 + loudness * 0.24);
      ctx.fillStyle = `hsla(${(220 + loudness * 80).toFixed(1)}, 100%, ${(55 + high * 30).toFixed(1)}%, ${glow.toFixed(3)})`;
      ctx.fillRect(x, y, 1.8, 1.8);
    }

    ctx.globalCompositeOperation = "source-over";
  }


  function drawSMVSquareLogo(left, top, drawW, drawH, localHue, v, tSpeed) {
    const radius = Math.max(10, Math.min(drawW, drawH) * 0.12);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left + radius, top);
    ctx.lineTo(left + drawW - radius, top);
    ctx.quadraticCurveTo(left + drawW, top, left + drawW, top + radius);
    ctx.lineTo(left + drawW, top + drawH - radius);
    ctx.quadraticCurveTo(left + drawW, top + drawH, left + drawW - radius, top + drawH);
    ctx.lineTo(left + radius, top + drawH);
    ctx.quadraticCurveTo(left, top + drawH, left, top + drawH - radius);
    ctx.lineTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = "rgba(0,0,0,0.90)";
    ctx.fillRect(left, top, drawW, drawH);

    const grad = ctx.createLinearGradient(left, top, left + drawW, top + drawH);
    grad.addColorStop(0, `hsla(${localHue.toFixed(1)}, 100%, 46%, ${(0.22 + v * 0.24).toFixed(3)})`);
    grad.addColorStop(0.55, `hsla(${(localHue + 58).toFixed(1)}, 100%, 58%, ${(0.24 + v * 0.28).toFixed(3)})`);
    grad.addColorStop(1, `hsla(${(localHue + 132).toFixed(1)}, 100%, 50%, ${(0.22 + v * 0.24).toFixed(3)})`);

    const flowX = Math.sin(tSpeed) * drawW * 0.26;
    const flowY = Math.cos(tSpeed * 0.8) * drawH * 0.22;
    ctx.fillStyle = grad;
    ctx.fillRect(left + flowX, top + flowY, drawW, drawH);
    ctx.fillRect(left - flowX * 0.6, top - flowY * 0.6, drawW, drawH);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${(drawW * 0.47).toFixed(1)}px Arial Black, Arial, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.fillText("SMV", left + drawW * 0.5, top + drawH * 0.46);

    ctx.font = `800 ${(drawW * 0.10).toFixed(1)}px Arial, sans-serif`;
    ctx.fillStyle = "rgba(250,250,255,0.92)";
    ctx.fillText("SHORT MUSIC VIDEOS", left + drawW * 0.5, top + drawH * 0.79);

    ctx.lineWidth = 1.8 + v * 2.2;
    ctx.strokeStyle = `hsla(${(localHue + 165).toFixed(1)}, 100%, 74%, ${(0.30 + v * 0.34).toFixed(3)})`;
    ctx.stroke();
    ctx.restore();
  }

  function drawPowerVizCrestLogo(left, top, drawW, drawH, localHue, v, tSpeed) {
    const cx = left + drawW * 0.5;
    const cy = top + drawH * 0.52;
    const r = Math.min(drawW, drawH) * 0.42;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, drawW * 0.48, drawH * 0.45, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fillRect(left, top, drawW, drawH);

    const ring = ctx.createRadialGradient(cx, cy, r * 0.18, cx, cy, r * 1.1);
    ring.addColorStop(0, `hsla(${(localHue + 20).toFixed(1)}, 100%, 60%, ${(0.26 + v * 0.18).toFixed(3)})`);
    ring.addColorStop(0.7, `hsla(${(localHue + 92).toFixed(1)}, 100%, 52%, ${(0.24 + v * 0.20).toFixed(3)})`);
    ring.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ring;
    ctx.fillRect(left, top, drawW, drawH);

    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(2.4, r * 0.1);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.05, r * 0.86, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.6, r * 0.05);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.82, r * 0.67, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = `900 ${(r * 0.46).toFixed(1)}px Arial Black, Arial, sans-serif`;
    ctx.fillText("SMV", cx, cy - r * 0.30);

    ctx.font = `900 ${(r * 0.55).toFixed(1)}px Arial Black, Arial, sans-serif`;
    ctx.fillText("POWER", cx, cy - r * 0.01);
    ctx.fillText("VIZ", cx, cy + r * 0.36);

    // audio wave stripe
    ctx.lineWidth = Math.max(1.6, r * 0.04);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    const n = 44;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = cx - r * 0.9 + t * r * 1.8;
      const y = cy + r * 0.64 + Math.sin(t * 26 + tSpeed * 3.2) * r * (0.06 + v * 0.08);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineWidth = 1.4 + v * 1.6;
    ctx.strokeStyle = `hsla(${(localHue + 175).toFixed(1)}, 100%, 74%, ${(0.30 + v * 0.30).toFixed(3)})`;
    ctx.strokeRect(left + 2, top + 2, drawW - 4, drawH - 4);
    ctx.restore();
  }

  function drawUploadedLogoTile(left, top, drawW, drawH, localHue, v, tSpeed) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, drawW, drawH);
    ctx.clip();

    ctx.fillStyle = "rgba(0,0,0,0.70)";
    ctx.fillRect(left, top, drawW, drawH);

    if (logoImageReady && logoImage) {
      const imgRatio = logoImage.width / Math.max(1, logoImage.height);
      const boxRatio = drawW / Math.max(1, drawH);
      let sw = logoImage.width;
      let sh = logoImage.height;
      let sx = 0;
      let sy = 0;
      if (imgRatio > boxRatio) {
        sw = Math.floor(sh * boxRatio);
        sx = Math.floor((logoImage.width - sw) * 0.5);
      } else {
        sh = Math.floor(sw / boxRatio);
        sy = Math.floor((logoImage.height - sh) * 0.5);
      }

      const driftX = Math.sin(tSpeed * 0.9) * drawW * 0.06;
      const driftY = Math.cos(tSpeed * 0.7) * drawH * 0.06;
      ctx.drawImage(logoImage, sx, sy, sw, sh, left + driftX, top + driftY, drawW, drawH);
      ctx.drawImage(logoImage, sx, sy, sw, sh, left - driftX * 0.45, top - driftY * 0.45, drawW, drawH);
    }

    const overlay = ctx.createLinearGradient(left, top, left + drawW, top + drawH);
    overlay.addColorStop(0, `hsla(${localHue.toFixed(1)}, 100%, 50%, ${(0.16 + v * 0.24).toFixed(3)})`);
    overlay.addColorStop(0.55, `hsla(${(localHue + 62).toFixed(1)}, 100%, 62%, ${(0.14 + v * 0.20).toFixed(3)})`);
    overlay.addColorStop(1, `hsla(${(localHue + 130).toFixed(1)}, 100%, 53%, ${(0.14 + v * 0.20).toFixed(3)})`);
    ctx.fillStyle = overlay;
    ctx.fillRect(left, top, drawW, drawH);

    ctx.lineWidth = 1.4 + v * 1.8;
    ctx.strokeStyle = `hsla(${(localHue + 180).toFixed(1)}, 100%, 75%, ${(0.26 + v * 0.28).toFixed(3)})`;
    ctx.strokeRect(left + 1.5, top + 1.5, drawW - 3, drawH - 3);
    ctx.restore();
  }

  function drawLogoWall(w, h, spec) {
    ctx.globalCompositeOperation = "lighter";

    let energySum = 0;
    for (let i = 0; i < spec.length; i++) energySum += spec[i];
    const loudness = energySum / (spec.length * 255);

    let bassSum = 0;
    const bassBins = 56;
    for (let i = 0; i < bassBins; i++) bassSum += spec[i] || 0;
    const bass = bassSum / (bassBins * 255);

    const beat = Math.min(1.6, 0.66 + bass * 1.45 * vizControls.excitement);
    const cell = Math.max(96, Math.min(260, 165 / vizControls.shapeBand));
    const gap = Math.max(6, 18 - vizControls.excitement * 4);

    const cols = Math.max(2, Math.ceil((w + gap) / (cell + gap)));
    const rows = Math.max(2, Math.ceil((h + gap) / (cell + gap)));
    const tileW = (w - gap * (cols + 1)) / cols;
    const tileH = (h - gap * (rows + 1)) / rows;

    const baseHue = 205 + vizControls.hueShift;
    const style = logoStyleEl?.value || "mix";
    const effectiveStyle = style === "uploaded" && !logoImageReady ? "mix" : style;

    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        const idx01 = (ry * cols + cx) / Math.max(1, rows * cols - 1);
        const band = Math.floor(idx01 * Math.min(spec.length - 1, 560));
        const v = (spec[band] || 0) / 255;

        const x = gap + cx * (tileW + gap);
        const y = gap + ry * (tileH + gap);

        const pulse = 0.38 + beat * 0.20 + v * 0.16;
        const s = pulse * (0.62 + vizControls.amplitude * 0.72);
        const cxm = x + tileW * 0.5;
        const cym = y + tileH * 0.5;

        const drawW = tileW * s;
        const drawH = tileH * s;
        const left = cxm - drawW * 0.5;
        const top = cym - drawH * 0.5;

        const tSpeed = ph * (0.8 + vizControls.period * 0.75) + cx * 0.49 - ry * 0.37;
        const localHue = baseHue + idx01 * 88 + Math.sin(tSpeed + idx01 * 8) * 24;

        const useUploaded = effectiveStyle === "uploaded";
        const useCrest = effectiveStyle === "crest" || (effectiveStyle === "mix" && ((cx + ry) % 2 === 0));
        if (useUploaded) drawUploadedLogoTile(left, top, drawW, drawH, localHue, v, tSpeed);
        else if (useCrest) drawPowerVizCrestLogo(left, top, drawW, drawH, localHue, v, tSpeed);
        else drawSMVSquareLogo(left, top, drawW, drawH, localHue, v, tSpeed);
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }


  syncLayerButtons();
  setVizMethod(vizMethodEl?.value || "custom");

  // ---------- render loop ----------
  function tick() {
    ph += 0.010 * vizControls.period;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    clearBG(w, h);
    const spec = getSpectrum();

    if (overlays.has("blocks")) drawBlocks(w, h, spec);
    if (overlays.has("radiate")) drawRadiate(w, h, spec);
    if (overlays.has("flow")) drawFlow(w, h, spec);
    if (overlays.has("orbit")) drawOrbit(w, h, spec);
    if (overlays.has("cymatic")) drawCymatic(w, h, spec);
    if (overlays.has("logos")) drawLogoWall(w, h, spec);
    if (overlays.has("wave")) drawWave(w, h, spec);

    if (Math.abs(vizControls.hueShift) > 1 || vizControls.excitement > 1.05) {
      const tintA = Math.min(0.16, 0.04 + (vizControls.excitement - 1) * 0.08);
      ctx.fillStyle = `hsla(${(200 + vizControls.hueShift).toFixed(1)}, 88%, 54%, ${tintA.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
