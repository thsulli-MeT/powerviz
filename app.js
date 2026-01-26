(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a,b,t) => a + (b-a)*t;

  const c = $("#c");
  const ctx2d = c.getContext("2d");

  const audioEl = $("#audio");
  const fileEl = $("#file");
  const playBtn = $("#play");
  const micBtn = $("#mic");
  const tabBtn = $("#tab");

  const hudMode = $("#hudMode");
  const hudSrc = $("#hudSrc");
  const hudAudio = $("#hudAudio");
  const hudEnergy = $("#hudEnergy");
  const hudFlux = $("#hudFlux");
  const hudCentroid = $("#hudCentroid");
  const hudPeak = $("#hudPeak");

  const segBtns = $$(".seg-btn");

  // WebAudio
  let actx = null;
  let analyser = null;
  let srcNode = null;
  let micStream = null;
  let tabStream = null;

  // buffers
  let timeBuf = null;
  let freqBuf = null;
  let prevFreq = null;

  // smoothing for spectrum bars
  let barSmooth = null;

  // mode state
  let lock = "auto";
  let mode = "wave";
  let lastSwitch = 0;

  const HOLD = { orbit: 1400, wave: 900, blocks: 1100, radiate: 520, flow: 1500 };

  // smoothed features
  const SMOOTH = 0.15;
  let sEnergy = 0, sFlux = 0, sCentroid = 0, sPeak = 1;

  // baseline + trend
  let baseEnergy = 0.08;
  const BASE_FOLLOW = 0.003;
  let prevSE = 0;
  let trend = 0;
  const TREND_SMOOTH = 0.08;

  // visualization history for wave rows
  const ROWS = 10;
  const BANDS = 8; // multi-track feeling
  const HISTORY = 240;
  const hist = Array.from({length: ROWS}, () => Array.from({length: BANDS}, () => new Float32Array(HISTORY)));
  let histIdx = 0;

  // particles for flow/orbit
  const PCOUNT = 360;
  const parts = Array.from({length: PCOUNT}, () => ({
    x: Math.random(), y: Math.random(),
    vx: 0, vy: 0,
    a: Math.random()
  }));

  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(c.clientWidth * dpr);
    const h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
    }
  }
  window.addEventListener("resize", resize);

  function ensureAudio() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;

    timeBuf = new Float32Array(analyser.fftSize);
    freqBuf = new Uint8Array(analyser.frequencyBinCount);
    prevFreq = new Uint8Array(analyser.frequencyBinCount);

    barSmooth = new Float32Array(160); // #bars for BLOCKS mode

    hudAudio.textContent = actx.state;
  }

  function disconnectSource() {
    if (srcNode) {
      try { srcNode.disconnect(); } catch {}

  function stopStream(st) {
    if (!st) return null;
    try { st.getTracks().forEach(t => t.stop()); } catch {}
    return null;
  }
      srcNode = null;
    }
  }

  async function resumeAudio() {
    ensureAudio();
    if (actx.state === "suspended") await actx.resume();
    hudAudio.textContent = actx.state;
  }

  async function useFile(file) {
    await resumeAudio();

    if (micStream) {
      micStream = stopStream(micStream);
      micBtn.classList.remove("on");
    }
    if (tabStream) {
      tabStream = stopStream(tabStream);
      tabBtn?.classList.remove("on");
    }
    disconnectSource();

    const url = URL.createObjectURL(file);
    audioEl.src = url;
    audioEl.loop = false;
    audioEl.load();

    srcNode = actx.createMediaElementSource(audioEl);
    srcNode.connect(analyser);
    analyser.connect(actx.destination);

    playBtn.disabled = false;
    hudSrc.textContent = "FILE";
  }

  async function useMic() {
    await resumeAudio();

    audioEl.pause();
    disconnectSource();

    if (micStream) {
      micStream = stopStream(micStream);
      micBtn.classList.remove("on");
      hudSrc.textContent = "—";
      return;
    }

    if (tabStream) {
      tabStream = stopStream(tabStream);
      tabBtn?.classList.remove("on");
    }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    srcNode = actx.createMediaStreamSource(micStream);
    srcNode.connect(analyser);
    // no destination connect to avoid feedback

    micBtn.classList.add("on");
    playBtn.textContent = "Play";
    hudSrc.textContent = "MIC";
  }
  async function captureTab() {
    await resumeAudio();

    // stop other sources
    audioEl.pause();
    disconnectSource();

    if (micStream) {
      micStream = stopStream(micStream);
      micBtn.classList.remove("on");
    }

    if (tabStream) {
      tabStream = stopStream(tabStream);
      tabBtn.classList.remove("on");
      hudSrc.textContent = "—";
      return;
    }

    // Screen/tab capture. User should choose the Chrome tab (and enable "Share audio").
    // On some browsers, you must pick "Chrome Tab" and check "Share audio".
    tabStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // Create audio source from captured stream
    srcNode = actx.createMediaStreamSource(tabStream);
    srcNode.connect(analyser);

    tabBtn.classList.add("on");
    hudSrc.textContent = "TAB";

    // We don't render the video; stop it right away to reduce overhead while keeping audio.
    // Some browsers stop audio if you stop video; if that happens for you, comment the next line.
    const vTracks = tabStream.getVideoTracks();
    if (vTracks && vTracks[0]) {
      try { vTracks[0].stop(); } catch {}
    }
  }


  function setMode(m) {
    mode = m;
    const label = lock === "auto" ? `AUTO → ${m.toUpperCase()}` : m.toUpperCase();
    hudMode.textContent = label;
  }

  function setLock(next) {
    lock = next;
    segBtns.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lock === lock)));
    if (lock !== "auto") setMode(lock);
  }

  function analyze() {
    if (!analyser) return null;
    analyser.getFloatTimeDomainData(timeBuf);
    let sum = 0;
    for (let i=0;i<timeBuf.length;i++){ const v=timeBuf[i]; sum += v*v; }
    const rms = Math.sqrt(sum / timeBuf.length);

    analyser.getByteFrequencyData(freqBuf);

    let magSum=0, weighted=0, maxMag=0;
    for (let i=0;i<freqBuf.length;i++){
      const m=freqBuf[i];
      magSum += m;
      weighted += i*m;
      if (m>maxMag) maxMag=m;
    }
    const meanMag = magSum / freqBuf.length;
    const centroid = (magSum>0) ? (weighted/magSum)/(freqBuf.length-1) : 0;

    let flux=0;
    for (let i=0;i<freqBuf.length;i++){
      const d=freqBuf[i]-prevFreq[i];
      if (d>0) flux += d;
      prevFreq[i]=freqBuf[i];
    }
    const fluxN = Math.min(1, flux / (freqBuf.length * 14));
    const peakiness = (meanMag>0) ? (maxMag/meanMag) : 1;

    return { rms, flux: fluxN, centroid, peakiness };
  }

  function updateFeatures(m) {
    // smooth
    sEnergy = lerp(sEnergy, m.rms, SMOOTH);
    sFlux = lerp(sFlux, m.flux, SMOOTH);
    sCentroid = lerp(sCentroid, m.centroid, SMOOTH);
    sPeak = lerp(sPeak, m.peakiness, SMOOTH);

    // baseline & trend
    baseEnergy = lerp(baseEnergy, sEnergy, BASE_FOLLOW);
    const dE = sEnergy - prevSE;
    prevSE = sEnergy;
    trend = lerp(trend, dE, TREND_SMOOTH);

    // HUD
    hudEnergy.textContent = sEnergy.toFixed(2);
    hudFlux.textContent = sFlux.toFixed(2);
    hudCentroid.textContent = sCentroid.toFixed(2);
    hudPeak.textContent = sPeak.toFixed(2);
  }

  function bandEnergy(bandIdx) {
    // take a slice of the spectrum for band energy (0..1)
    const n = freqBuf.length;
    const start = Math.floor((bandIdx / BANDS) * n);
    const end = Math.floor(((bandIdx + 1) / BANDS) * n);
    let s = 0;
    for (let i=start;i<end;i++) s += freqBuf[i];
    const avg = s / Math.max(1,(end-start));
    return avg / 255;
  }

  function pushHistory() {
    for (let r=0;r<ROWS;r++){
      for (let b=0;b<BANDS;b++){
        // slight row offset so it feels like "multiple tracks" interacting
        const e = bandEnergy(b);
        const wobble = (r/ROWS) * 0.04;
        hist[r][b][histIdx] = Math.max(0, Math.min(1, e + wobble));
      }
    }
    histIdx = (histIdx + 1) % HISTORY;
  }

  function wantMode(m) {
    const rel = m.rms / Math.max(0.03, baseEnergy);
    const calm = rel < 0.85 && m.flux < 0.08;
    const airy = rel < 1.05 && m.centroid < 0.55 && m.flux < 0.12;
    const rising = trend > 0.007;
    const build = rising && rel >= 0.95 && rel < 1.40 && m.flux < 0.18 && m.peakiness < 4.2;
    const peakDrop = rel >= 1.20 && (m.flux > 0.18 || m.peakiness > 4.2);
    if (peakDrop) return "radiate";
    if (build) return "blocks";
    if (airy) return "flow";
    if (calm) return "orbit";
    return "wave";
  }

  const ALLOW = {
    orbit: ["wave","flow"],
    wave: ["blocks","flow","orbit","radiate"],
    blocks: ["radiate","wave"],
    radiate: ["flow","wave","blocks"],
    flow: ["wave","blocks","orbit"]
  };

  function pickMode(m) {
    const want = wantMode(m);
    if (want === mode) return mode;
    const allowed = ALLOW[mode] || ["wave"];
    if (allowed.includes(want)) return want;
    // fallback: choose closest feel
    if (want === "radiate" && allowed.includes("blocks")) return "blocks";
    if (want === "blocks" && allowed.includes("wave")) return "wave";
    return allowed[0] || "wave";
  }

  // ===== RENDERERS =====
  function clearBG(w,h, hue, intensity) {
    ctx2d.globalCompositeOperation = "source-over";
    ctx2d.fillStyle = `hsla(${hue} 40% ${6 + intensity*12}% , ${0.22 + (1-intensity)*0.25})`;
    ctx2d.fillRect(0,0,w,h);
    // vignette
    const g = ctx2d.createRadialGradient(w*0.5,h*0.5, Math.min(w,h)*0.1, w*0.5,h*0.5, Math.min(w,h)*0.7);
    g.addColorStop(0, "rgba(255,255,255,0.04)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx2d.fillStyle = g;
    ctx2d.fillRect(0,0,w,h);
  }

  function renderWave(w,h, hue, intensity) {
    clearBG(w,h,hue,intensity);
    ctx2d.globalCompositeOperation = "lighter";

    const rowH = h / ROWS;
    for (let r=0;r<ROWS;r++){
      const y0 = r*rowH;
      const mid = y0 + rowH*0.5;

      // draw each band as its own polyline, stacked (multi-track vibe)
      for (let b=0;b<BANDS;b++){
        const baseHue = (hue + b*18 + r*2) % 360;
        ctx2d.strokeStyle = `hsla(${baseHue}, 95%, 65%, ${0.14 + intensity*0.65})`;
        ctx2d.lineWidth = 1.6 + intensity*4.2;

        ctx2d.beginPath();
        for (let i=0;i<HISTORY;i++){
          const idx = (histIdx + i) % HISTORY;
          const e = hist[r][b][idx];
          const x = (i/(HISTORY-1))*w;
          const amp = (rowH*0.42) * (0.15 + e*1.2) * (0.35 + intensity);
          const y = mid + (Math.sin((i*0.06) + b*0.9 + r*0.2) * amp) - (b-(BANDS-1)/2)*rowH*0.035;
          if (i===0) ctx2d.moveTo(x,y);
          else ctx2d.lineTo(x,y);
        }
        ctx2d.stroke();
      }

      // row separator glow
      ctx2d.fillStyle = `rgba(255,255,255,${0.02 + intensity*0.03})`;
      ctx2d.fillRect(0, y0 + rowH - 1, w, 1);
    }
  }

  function renderRadiate(w,h, hue, intensity) {
    clearBG(w,h,hue,intensity);
    ctx2d.globalCompositeOperation = "lighter";
    const cx=w*0.5, cy=h*0.5;

    const minR = Math.min(w,h)*0.10;
    const maxR = Math.min(w,h)*0.58;

    const bins = 320;
    const ringCount = 3;

    for (let r=0;r<ringCount;r++){
      const rr = minR + (r/(ringCount-1))*(maxR-minR) * (0.55 + intensity*0.55);
      const lw = 8 + r*6 + intensity*10;
      ctx2d.lineWidth = lw;
      for (let i=0;i<bins;i+=2){
        const a0 = (i/bins) * Math.PI*2;
        const idx = Math.floor((i/bins) * freqBuf.length);
        const v = (freqBuf[idx]||0) / 255;
        const seg = (Math.PI*2/bins) * (0.8 + v*0.9);
        const hh = (hue + v*180 + i*0.25 + r*30) % 360;
        ctx2d.strokeStyle = `hsla(${hh}, 95%, 62%, ${0.05 + v*0.35 + intensity*0.10})`;
        ctx2d.beginPath();
        ctx2d.arc(cx,cy, rr + v*40*(0.3+intensity), a0, a0+seg);
        ctx2d.stroke();
      }
    }

    ctx2d.lineWidth = 2.0 + intensity*4.5;
    for (let i=0;i<bins;i++){
      const a = (i/bins) * Math.PI*2;
      const idx = Math.floor((i/bins) * freqBuf.length);
      const v = (freqBuf[idx]||0) / 255;
      const r1 = minR + v*v*(maxR-minR) * (0.35 + intensity*1.25);
      const r2 = r1 + 16 + v*70*(0.25+intensity);
      const x1 = cx + Math.cos(a)*r1;
      const y1 = cy + Math.sin(a)*r1;
      const x2 = cx + Math.cos(a)*r2;
      const y2 = cy + Math.sin(a)*r2;
      const hh = (hue + v*220 + i*0.2) % 360;
      ctx2d.strokeStyle = `hsla(${hh}, 95%, 70%, ${0.06 + v*0.55})`;
      ctx2d.beginPath();
      ctx2d.moveTo(x1,y1);
      ctx2d.lineTo(x2,y2);
      ctx2d.stroke();
    }

    const coreR = minR*(1.35 + intensity*1.1);
    const core = ctx2d.createRadialGradient(cx,cy,0,cx,cy,coreR);
    core.addColorStop(0, `hsla(${(hue+30)%360}, 95%, 65%, ${0.28+intensity*0.45})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx2d.fillStyle = core;
    ctx2d.beginPath();
    ctx2d.arc(cx,cy,coreR,0,Math.PI*2);
    ctx2d.fill();
  }

  function renderBlocks(w,h, hue, intensity) {
    clearBG(w,h,hue,intensity);
    ctx2d.globalCompositeOperation = "lighter";

    const bars = barSmooth ? barSmooth.length : 160;
    const padX = w * 0.035;
    const padY = h * 0.08;
    const usableW = w - padX*2;
    const usableH = h - padY*1.15;

    const n = freqBuf.length;
    const minIdx = 2;
    const maxIdx = n - 1;

    const gap = Math.max(1, Math.floor(usableW / (bars*40)));
    const bw = (usableW - gap*(bars-1)) / bars;

    for (let i=0;i<bars;i++){
      const t = i / (bars-1);
      const logT = Math.pow(t, 2.25);
      const idx = Math.floor(minIdx + logT * (maxIdx - minIdx));

      let v = (freqBuf[idx] || 0) / 255;
      v = Math.pow(v, 0.78);

      const cur = barSmooth[i] || 0;
      const attack = 0.34 + intensity*0.18;
      const release = 0.06 + intensity*0.08;
      const next = v > cur ? (cur + (v-cur)*attack) : (cur + (v-cur)*release);
      barSmooth[i] = next;

      const hh = (hue + t*220 + next*140) % 360;

      const barH = next * usableH * (0.25 + intensity*1.10);
      const x = padX + i*(bw+gap);
      const y = h - padY - barH;

      ctx2d.fillStyle = `hsla(${hh}, 95%, 60%, ${0.14 + next*0.70})`;
      ctx2d.fillRect(x, y, bw, barH);

      ctx2d.fillStyle = `hsla(${(hh+20)%360}, 95%, 70%, ${0.06 + next*0.22})`;
      ctx2d.fillRect(x, y, bw, Math.max(2, barH*0.06));

      if (i % 6 === 0){
        ctx2d.fillStyle = `rgba(255,255,255,${0.02 + intensity*0.02})`;
        ctx2d.fillRect(x, h-padY, bw, 1);
      }
    }

    const wash = ctx2d.createLinearGradient(0, h, 0, 0);
    wash.addColorStop(0, "rgba(0,0,0,0)");
    wash.addColorStop(1, `hsla(${(hue+60)%360}, 95%, 65%, ${0.05 + intensity*0.09})`);
    ctx2d.fillStyle = wash;
    ctx2d.fillRect(0,0,w,h);
  }

  // simple pseudo-noise field (fast)
  function fieldAngle(x,y,t, centroid) {
    const s = 2.2 + centroid*2.6;
    const nx = x*s, ny = y*s;
    const v = Math.sin(nx + t*0.0009) + Math.cos(ny - t*0.0011) + Math.sin((nx+ny)*0.7 + t*0.0006);
    return v * 1.25;
  }

  function renderFlow(w,h, hue, intensity) {
    clearBG(w,h,hue,intensity);
    ctx2d.globalCompositeOperation = "lighter";

    const t = performance.now();
    const spd = (0.0010 + intensity*0.0035);
    const drag = 0.955;

    for (let i=0;i<parts.length;i++){
      const p = parts[i];
      const px = p.x, py = p.y;

      const ang = fieldAngle(p.x, p.y, t, sCentroid);
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;

      p.vx = (p.vx + vx) * drag;
      p.vy = (p.vy + vy) * drag;

      p.x += p.vx * (1 + sFlux*2.2);
      p.y += p.vy * (1 + sFlux*2.2);

      if (p.x < -0.05) p.x = 1.05;
      if (p.x > 1.05) p.x = -0.05;
      if (p.y < -0.05) p.y = 1.05;
      if (p.y > 1.05) p.y = -0.05;

      const x1 = px * w;
      const y1 = py * h;
      const x2 = p.x * w;
      const y2 = p.y * h;

      const band = i % BANDS;
      const v = bandEnergy(band);
      const hh = (hue + band*28 + p.a*120 + v*140) % 360;

      ctx2d.strokeStyle = `hsla(${hh}, 95%, 66%, ${0.05 + intensity*0.16 + v*0.14})`;
      ctx2d.lineWidth = 1.2 + intensity*4.2 + v*2.2;
      ctx2d.beginPath();
      ctx2d.moveTo(x1,y1);
      ctx2d.lineTo(x2,y2);
      ctx2d.stroke();
    }

    const cx = w*0.5, cy = h*0.5;
    for (let k=0;k<3;k++){
      const rr = Math.min(w,h)*(0.22 + k*0.12) * (0.75 + intensity*0.7);
      const offx = Math.sin(t*0.0006 + k)*w*0.12;
      const offy = Math.cos(t*0.0005 + k*1.3)*h*0.10;
      const g = ctx2d.createRadialGradient(cx+offx, cy+offy, 0, cx+offx, cy+offy, rr);
      g.addColorStop(0, `hsla(${(hue+40+k*30)%360}, 95%, 65%, ${0.06 + intensity*0.12})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx2d.fillStyle = g;
      ctx2d.fillRect(0,0,w,h);
    }
  }

  function renderOrbit(w,h, hue, intensity) {
    clearBG(w,h,hue,intensity);
    ctx2d.globalCompositeOperation = "lighter";

    const t = performance.now()*0.001;
    const cx=w*0.5, cy=h*0.5;
    const base = Math.min(w,h)*0.18;
    const r = base + (1-intensity)*Math.min(w,h)*0.14;

    for (let k=0;k<3;k++){
      const rr = r*(1 + k*0.28);
      const lw = 4 + k*4 + (1-intensity)*4;
      ctx2d.lineWidth = lw;

      const segs = 14;
      for (let s=0;s<segs;s++){
        const a0 = (s/segs)*Math.PI*2 + t*(0.12 + k*0.06);
        const a1 = a0 + (Math.PI*2/segs) * (0.55 + 0.25*Math.sin(t + s));
        const hh = (hue + k*35 + s*6) % 360;
        ctx2d.strokeStyle = `hsla(${hh}, 85%, 68%, ${0.06 + (1-intensity)*0.12})`;
        ctx2d.beginPath();
        ctx2d.arc(cx,cy,rr,a0,a1);
        ctx2d.stroke();
      }
    }

    const dots = 18;
    for (let i=0;i<dots;i++){
      const band = i % BANDS;
      const v = bandEnergy(band);
      const a = t*(0.55 + intensity*0.9) + i*(Math.PI*2/dots);
      const rr = r*(1.05 + 0.55*Math.sin(i*0.7 + t*0.6)) + intensity*24;
      const x = cx + Math.cos(a)*rr;
      const y = cy + Math.sin(a)*rr;

      const hh = (hue + band*26 + v*180) % 360;
      const alpha = 0.12 + (1-intensity)*0.14 + v*0.35;
      const rad = 6 + v*24*(0.4+intensity);

      const g = ctx2d.createRadialGradient(x,y,0,x,y,rad);
      g.addColorStop(0, `hsla(${hh}, 95%, 70%, ${alpha})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx2d.fillStyle = g;
      ctx2d.beginPath();
      ctx2d.arc(x,y,rad,0,Math.PI*2);
      ctx2d.fill();
    }

    const coreR = base*(0.85 + intensity*0.7);
    const core = ctx2d.createRadialGradient(cx,cy,0,cx,cy,coreR);
    core.addColorStop(0, `hsla(${(hue+20)%360}, 95%, 65%, ${0.10 + intensity*0.18})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx2d.fillStyle = core;
    ctx2d.fillRect(0,0,w,h);
  }

  function render(w,h) {
    // intensity & hue from features
    const intensity = clamp01((sEnergy*2.35) + (sFlux*0.85));
    const punch = Math.pow(intensity, 0.55); // boosts low levels
    const i2 = clamp01(punch*1.15);
    const hue = ((sCentroid*220) + (sFlux*110) + (i2*40)) % 360;

    if (mode === "wave") return renderWave(w,h,hue,i2);
    if (mode === "radiate") return renderRadiate(w,h,hue,i2);
    if (mode === "blocks") return renderBlocks(w,h,hue,i2);
    if (mode === "flow") return renderFlow(w,h,hue,i2);
    return renderOrbit(w,h,hue,i2);
  }

  function tick(now) {
    resize();

    const m = analyze();
    if (m) {
      updateFeatures(m);
      pushHistory();

      if (lock === "auto") {
        const target = pickMode(m);
        const hold = HOLD[mode] ?? 900;
        if (target !== mode && (now - lastSwitch) > hold) {
          setMode(target);
          lastSwitch = now;
        } else if (hudMode.textContent === "AUTO") {
          hudMode.textContent = `AUTO → ${mode.toUpperCase()}`;
        }
      }
    }

    render(c.width, c.height);
    requestAnimationFrame(tick);
  }

  // UI
  fileEl.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    useFile(f);
  });

  playBtn.addEventListener("click", async () => {
    await resumeAudio();
    if (audioEl.paused) {
      await audioEl.play();
      playBtn.textContent = "Pause";
      hudSrc.textContent = "FILE";
    } else {
      audioEl.pause();
      playBtn.textContent = "Play";
    }
  });

  micBtn.addEventListener("click", async () => {
    try { await useMic(); }
    catch (err) {
      console.error(err);
      alert("Mic access blocked. If you opened via file://, run a local server.");
    }
  });

  tabBtn?.addEventListener("click", async () => {
    try { await captureTab(); }
    catch (err) {
      console.error(err);
      alert("Tab capture failed. Use a Chromium browser, choose a Chrome Tab, and enable Share audio.");
    }
  });

  segBtns.forEach(btn => btn.addEventListener("click", () => setLock(btn.dataset.lock)));

  window.addEventListener("keydown", (e) => {
    if (e.key === " "){ e.preventDefault(); if (!playBtn.disabled) playBtn.click(); }
    if (e.key === "0") return setLock("auto");
    if (e.key === "1") return setLock("wave");
    if (e.key === "2") return setLock("radiate");
    if (e.key === "3") return setLock("flow");
    if (e.key === "4") return setLock("blocks");
    if (e.key === "5") return setLock("orbit");
  });

  // start
  setMode("wave");
  hudMode.textContent = "AUTO";
  requestAnimationFrame(tick);
})();