// build: 2026-01-29-v20
console.log("SMV build 2026-01-29-v20 loaded");

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const canvas = $("#c");
  const errBox = $("#err");
  const ctx = canvas.getContext("2d", { alpha: false });

  const fileEl = $("#file");
  const playBtn = $("#play");
  const micBtn = $("#mic");
  const sysBtn = $("#sys");
  const audioEl = $("#audio");
  const layerBtns = $$(".layer-btn");
  const overlays = new Set(["wave"]);
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest(".layer-btn");
    if (!b) return;
    const k = b.dataset.layer;
    if (!k) return;
    if (overlays.has(k)) overlays.delete(k); else overlays.add(k);
    b.setAttribute("aria-pressed", String(overlays.has(k)));
  });


  function showErr(msg) {
    errBox.hidden = false;
    errBox.textContent = msg;
  }
  window.addEventListener("error", (e) => { showErr(String(e.message || e.error || e)); });
  window.addEventListener("unhandledrejection", (e) => { showErr(String(e.reason || e)); });

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

  function connectNode(node, toOutput) {
    try { if (srcNode) srcNode.disconnect(); } catch {}
    srcNode = node;
    try { srcNode.connect(analyser); } catch (e) { showErr("connect error: " + e); }
    if (toOutput) {
      try { srcNode.connect(outGain); } catch (e) { showErr("output connect error: " + e); }
    }
  }

  async function useFile(file) {
    await resumeAudio();
    audioEl.pause();
    audioEl.src = URL.createObjectURL(file);
    audioEl.load();

    try { if (srcNode) srcNode.disconnect(); } catch {}
    try {
      const node = actx.createMediaElementSource(audioEl);
      connectNode(node, true);
    } catch (e) {
      showErr("File source error: " + e);
      return;
    }

    playBtn.disabled = false;
    playBtn.textContent = "Pause";
    try { await audioEl.play(); } catch (e) {
      playBtn.textContent = "Play";
      console.warn(e);
    }
  }

  async function useMic() {
    await resumeAudio();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const node = actx.createMediaStreamSource(micStream);
    connectNode(node, false);
    playBtn.disabled = true;
  }

  async function useSystem() {
    await resumeAudio();
    sysStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    try { sysStream.getVideoTracks().forEach(t => t.stop()); } catch {}
    const node = actx.createMediaStreamSource(sysStream);
    connectNode(node, false);
    playBtn.disabled = true;
  }

  // visuals: animate always (idle if no analyser)
  const overlays = new Set(["wave"]);
  layerBtns.forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.layer;
    if (overlays.has(k)) overlays.delete(k);
    else overlays.add(k);
    b.setAttribute("aria-pressed", String(overlays.has(k)));
  }));

  let ph = 0;

  function getSpectrum() {
    if (analyser && actx && srcNode) {
      analyser.getByteFrequencyData(freqBuf);
      return freqBuf;
    }
    // idle spectrum
    ph += 0.016;
    for (let i=0;i<freqBuf.length;i++) {
      const t=i/(freqBuf.length-1);
      const v = 0.15 + 0.55*(0.5+0.5*Math.sin(ph*1.2 + t*10))*(0.25+0.75*t);
      freqBuf[i] = Math.floor(v*255);
    }
    return freqBuf;
  }

  function clearBG(w,h) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0,0,w,h);
  }

  function drawWave(w,h,spec) {
    ctx.globalCompositeOperation = "lighter";
    const mid = h*0.5;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    for (let x=0;x<w;x++) {
      const t = x/(w-1);
      const idx = Math.floor(t*(spec.length-1));
      const v = (spec[idx]||0)/255;
      const y = mid + Math.sin(t*10 + ph*2.0)*h*0.10*(0.3+v) + (v-0.5)*h*0.30;
      if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.strokeStyle = "rgba(125,249,255,0.55)";
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBlocks(w,h,spec) {
    ctx.globalCompositeOperation = "lighter";
    const bars = 120;
    const padX = w*0.04;
    const padY = h*0.10;
    const usableW = w - padX*2;
    const usableH = h - padY*1.2;
    const bw = usableW / bars;
    for (let i=0;i<bars;i++) {
      const t=i/(bars-1);
      const idx = Math.floor(Math.pow(t,2.2)*(spec.length-1));
      const v=(spec[idx]||0)/255;
      const bh = v*usableH;
      ctx.fillStyle = `rgba(255,255,255,${0.06+v*0.35})`;
      ctx.fillRect(padX+i*bw, h-padY-bh, bw*0.85, bh);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawRadiate(w,h,spec) {
    ctx.globalCompositeOperation="lighter";
    const cx=w*0.5, cy=h*0.5;
    const R=Math.min(w,h)*0.45;
    ctx.lineWidth=3;
    for (let i=0;i<360;i+=2) {
      const t=i/360;
      const idx=Math.floor(t*(spec.length-1));
      const v=(spec[idx]||0)/255;
      const a=t*Math.PI*2;
      const r1=R*(0.2+v*0.9);
      const r2=r1+20+v*60;
      const x1=cx+Math.cos(a)*r1, y1=cy+Math.sin(a)*r1;
      const x2=cx+Math.cos(a)*r2, y2=cy+Math.sin(a)*r2;
      ctx.strokeStyle = `rgba(255,79,216,${0.10+v*0.45})`;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.globalCompositeOperation="source-over";
  }

  function drawFlow(w,h,spec) {
    ctx.globalCompositeOperation="lighter";
    const n=140;
    for (let i=0;i<n;i++) {
      const t=i/(n-1);
      const idx=Math.floor(t*(spec.length-1));
      const v=(spec[idx]||0)/255;
      const x = (Math.sin(ph*0.7 + i)*0.5+0.5)*w;
      const y = (Math.cos(ph*0.6 + i*1.3)*0.5+0.5)*h;
      const len = 30 + v*180;
      const ang = ph*0.4 + i*0.02;
      ctx.lineWidth = 1 + v*3;
      ctx.strokeStyle = `rgba(125,249,255,${0.06+v*0.18})`;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.cos(ang)*len, y+Math.sin(ang)*len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation="source-over";
  }

  function drawOrbit(w,h,spec) {
    ctx.globalCompositeOperation="lighter";
    const cx=w*0.5, cy=h*0.5;
    const R=Math.min(w,h)*0.32;
    for (let k=0;k<12;k++) {
      const idx=Math.floor((k/12)*(spec.length-1));
      const v=(spec[idx]||0)/255;
      const a = ph*0.5 + k*(Math.PI*2/12);
      const r = R*(0.7+0.4*Math.sin(ph*0.4+k)) + v*40;
      const x = cx + Math.cos(a)*r;
      const y = cy + Math.sin(a)*r;
      const rad = 6 + v*26;
      const g = ctx.createRadialGradient(x,y,0,x,y,rad);
      g.addColorStop(0, `rgba(255,255,255,${0.06+v*0.25})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation="source-over";
  }

  function tick() {
    try {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      clearBG(w,h);
      const spec = getSpectrum();
      if (overlays.has("blocks")) drawBlocks(w,h,spec);
      if (overlays.has("radiate")) drawRadiate(w,h,spec);
      if (overlays.has("flow")) drawFlow(w,h,spec);
      if (overlays.has("orbit")) drawOrbit(w,h,spec);
      if (overlays.has("wave")) drawWave(w,h,spec);
    } catch (e) {
      showErr(String(e));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  fileEl.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    await useFile(f);
  });

  playBtn.addEventListener("click", async () => {
    try {
      await resumeAudio();
      if (audioEl.paused) {
        await audioEl.play();
        playBtn.textContent = "Pause";
      } else {
        audioEl.pause();
        playBtn.textContent = "Play";
      }
    } catch (e) {
      showErr("Play error: " + e);
    }
  });

  micBtn.addEventListener("click", async () => {
    sysStream = stopStream(sysStream);
    micStream = stopStream(micStream);
    try { await useMic(); } catch (e) { showErr("Mic error: " + e); }
  });

  sysBtn.addEventListener("click", async () => {
    micStream = stopStream(micStream);
    sysStream = stopStream(sysStream);
    try { await useSystem(); } catch (e) { showErr("System Audio error: " + e); }
  });
})();
