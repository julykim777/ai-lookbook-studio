/* ==========================================================
   AI 룩북 스튜디오 — 프론트엔드
   ----------------------------------------------------------
   페이지가 열리면 /api/health 로 Node 서버가 있는지 확인한다.
     - 서버 있음 → POST /api/style 로 요청 (server.js)
     - 서버 없음 (index.html 을 파일로 직접 연 경우) → 브라우저 예시 모드

   백엔드 계약
     POST /api/style   (multipart/form-data)
       image : 파일 (JPG/PNG, 업로드 직전 4MB 이하로 자동 축소)
       style : casual | business | street | vintage
       notes : 추가 요청 (≤ 300자, 선택)
     응답 200 : { "image": "data:image/...;base64,...", "mock": boolean }
     응답 4xx/5xx : { "error": "사용자에게 보여줄 메시지" }
   ========================================================== */

const CONFIG = {
  API_URL: "/api/style",
  HEALTH_URL: "/api/health",
  MAX_BYTES: 10 * 1024 * 1024,        // 사용자가 고를 수 있는 원본 크기
  UPLOAD_MAX_BYTES: 3.8 * 1024 * 1024, // 서버로 보내는 크기 (서버 한도 4MB, Vercel 4.5MB)
  UPLOAD_MAX_SIDE: 2048,               // 서버로 보낼 때 긴 변 최대 픽셀
  ALLOWED_TYPES: ["image/jpeg", "image/png"],
};

const STYLE_LABELS = {
  casual: "캐주얼",
  business: "비즈니스",
  street: "스트리트",
  vintage: "빈티지",
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $("dropzone"),
  fileInput: $("fileInput"),
  previewImg: $("previewImg"),
  dropHint: $("dropHint"),
  fileName: $("fileName"),
  fileError: $("fileError"),
  genError: $("genError"),
  sampleBtn: $("sampleBtn"),
  notes: $("notes"),
  noteCount: $("noteCount"),
  generateBtn: $("generateBtn"),
  progress: $("progress"),
  progressFill: $("progressFill"),
  progressText: $("progressText"),
  emptyState: $("emptyState"),
  sliderView: $("sliderView"),
  sideView: $("sideView"),
  cmpBefore: $("cmpBefore"),
  cmpAfter: $("cmpAfter"),
  cmpBeforeWrap: $("cmpBeforeWrap"),
  cmpHandle: $("cmpHandle"),
  cmpRange: $("cmpRange"),
  sideBefore: $("sideBefore"),
  sideAfter: $("sideAfter"),
  sideCaption: $("sideCaption"),
  resultActions: $("resultActions"),
  downloadBtn: $("downloadBtn"),
  regenBtn: $("regenBtn"),
  modeBadge: $("modeBadge"),
};

/* ---------- State ---------- */
const state = {
  file: null,        // 업로드한 원본 (File 또는 Blob)
  originalUrl: null, // 원본 object URL
  resultUrl: null,   // 결과 이미지 URL
  resultStyle: null,
  busy: false,
  requestId: 0,      // 사진이 바뀌면 증가 → 진행 중이던 이전 요청 결과를 버린다
  view: "slider",
  server: null,      // null = 서버 없음(브라우저 예시 모드), { mock } = 서버 연결됨
};

/* ---------- 서버 연결 확인 ---------- */
async function detectServer() {
  if (location.protocol === "file:") return setMode(null);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(CONFIG.HEALTH_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const data = await res.json();
    setMode(res.ok && data.ok ? { mock: !!data.mock } : null);
  } catch {
    setMode(null);
  }
}

function setMode(server) {
  state.server = server;
  const b = el.modeBadge;
  b.classList.toggle("live", !!server && !server.mock);
  if (!server) {
    b.textContent = "예시 모드";
    b.title = "서버 없이 브라우저 안에서 예시 결과를 만듭니다 (npm start 로 서버를 켜면 연결돼요)";
  } else if (server.mock) {
    b.textContent = "서버 테스트 모드";
    b.title = "서버에 연결됐지만 AI 대신 테스트용 응답을 받습니다 (MOCK_STYLING=true)";
  } else {
    b.textContent = "AI 연결됨";
    b.title = "실제 이미지 편집 API를 사용합니다";
  }
}

detectServer();

/* ==========================================================
   1. 사진 업로드
   ========================================================== */
function validateFile(file) {
  if (!file) return "파일을 선택해 주세요.";
  if (!CONFIG.ALLOWED_TYPES.includes(file.type)) return "JPG 또는 PNG 파일만 올릴 수 있어요.";
  if (file.size > CONFIG.MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `파일이 너무 커요 (${mb}MB). 10MB 이하로 올려 주세요.`;
  }
  return null;
}

function setFile(file, displayName) {
  const error = validateFile(file);
  if (error) {
    showFileError(error);
    return;
  }
  showFileError(null);

  if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
  state.requestId++;  // 진행 중인 요청이 있으면 그 결과는 무시
  state.busy = false;
  state.file = file;
  state.originalUrl = URL.createObjectURL(file);

  el.previewImg.src = state.originalUrl;
  el.previewImg.hidden = false;
  el.dropHint.hidden = true;
  el.dropzone.classList.add("has-image");
  el.fileName.textContent = displayName || file.name || "업로드한 사진";

  clearResult();
  updateGenerateButton();
}

function showFileError(msg) {
  el.fileError.textContent = msg || "";
  el.fileError.hidden = !msg;
}

function showGenError(msg) {
  el.genError.textContent = msg || "";
  el.genError.hidden = !msg;
}

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files[0];
  if (file) setFile(file);
  el.fileInput.value = ""; // 같은 파일 다시 선택 가능하게
});

el.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    el.fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) =>
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((type) =>
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove("drag");
  })
);
el.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

el.sampleBtn.addEventListener("click", async () => {
  const blob = await makeSampleImage();
  const file = new File([blob], "sample-model.png", { type: "image/png" });
  setFile(file, "예시 사진 (sample-model.png)");
});

/* ==========================================================
   2~3. 스타일 선택 · 추가 요청
   ========================================================== */
function selectedStyle() {
  return document.querySelector('input[name="style"]:checked').value;
}

el.notes.addEventListener("input", () => {
  el.noteCount.textContent = el.notes.value.length;
});

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    const text = chip.textContent.trim();
    const cur = el.notes.value.trim();
    if (cur.includes(text)) return;
    el.notes.value = (cur ? cur + ", " : "") + text;
    el.notes.value = el.notes.value.slice(0, 300);
    el.notes.dispatchEvent(new Event("input"));
    el.notes.focus();
  })
);

/* ==========================================================
   4. 스타일링 생성
   ========================================================== */
function updateGenerateButton() {
  el.generateBtn.disabled = !state.file || state.busy;
  el.regenBtn.disabled = state.busy;
  el.generateBtn.textContent = state.busy ? "생성 중…" : "스타일링 생성";
}

function setProgress(pct, text) {
  el.progress.hidden = false;
  el.progressFill.style.width = pct + "%";
  if (text) el.progressText.textContent = text;
}

async function generate() {
  if (!state.file || state.busy) return;
  const style = selectedStyle();
  const notes = el.notes.value.trim();
  const id = ++state.requestId;
  const isCurrent = () => id === state.requestId;
  const progress = (pct, text) => isCurrent() && setProgress(pct, text);

  state.busy = true;
  updateGenerateButton();
  showFileError(null);
  showGenError(null);
  setProgress(5, "사진을 준비하고 있어요…");

  try {
    const resultUrl = await requestStyling({
      file: state.file, srcUrl: state.originalUrl, style, notes, onProgress: progress,
    });
    if (!isCurrent()) return; // 그사이 사진이 바뀜
    setProgress(100, `${STYLE_LABELS[style]} 룩북이 완성됐어요. 얼굴이나 옷이 어색하면 '다시 생성'을 눌러 보세요.`);
    showResult(resultUrl, style);
  } catch (err) {
    if (!isCurrent()) return;
    console.error(err);
    el.progress.hidden = true;
    showGenError(err.message || "스타일링에 실패했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (isCurrent()) {
      state.busy = false;
      updateGenerateButton();
    }
  }
}

el.generateBtn.addEventListener("click", generate);
el.regenBtn.addEventListener("click", generate);

/**
 * 스타일링 요청 — 백엔드 연결 지점.
 * @returns {Promise<string>} 결과 이미지 URL (data URL 또는 object URL)
 */
async function requestStyling({ file, srcUrl, style, notes, onProgress }) {
  if (!state.server) return mockStyling({ srcUrl, style, notes, onProgress });

  const upload = await prepareUpload(file, srcUrl);
  const form = new FormData();
  form.append("image", upload, upload.name || "photo.jpg");
  form.append("style", style);
  form.append("notes", notes);

  // 실제 API는 진행률을 주지 않으므로 대기 중 단계 문구만 바꿔 준다.
  const steps = [
    [15, "사진을 서버로 보내는 중…"],
    [45, "AI가 체형과 포즈를 분석하는 중…"],
    [70, `${STYLE_LABELS[style]} 스타일 의상을 입히는 중…`],
    [88, "디테일을 다듬는 중… (보통 1~2분 걸려요)"],
  ];
  let i = 0;
  onProgress(...steps[i]);
  const timer = setInterval(() => {
    if (i < steps.length - 1) onProgress(...steps[++i]);
  }, 8000);

  // 서버(OpenAI 180초)보다 조금 길게 기다린 뒤 포기한다.
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 200 * 1000);

  let data;
  try {
    let res;
    try {
      res = await fetch(CONFIG.API_URL, { method: "POST", body: form, signal: ctrl.signal });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("응답이 너무 오래 걸려요. 잠시 후 다시 생성해 주세요.");
      throw new Error("서버에 연결할 수 없어요. 서버가 켜져 있는지, 인터넷 연결을 확인해 주세요.");
    }
    if (res.status === 504) throw new Error("스타일링 시간이 초과됐어요. 잠시 후 다시 생성해 주세요.");
    data = await res.json().catch(() => ({}));
    if (res.status === 413) throw new Error("사진 용량이 너무 커요. 더 작은 사진으로 시도해 주세요.");
    if (!res.ok) throw new Error(data.error || `요청에 실패했어요 (${res.status}).`);
    if (!data.image) throw new Error("결과 이미지를 받지 못했어요. 다시 시도해 주세요.");
  } finally {
    clearInterval(timer);
    clearTimeout(abortTimer);
  }

  // 서버 테스트 응답(mock)은 받은 사진을 그대로 돌려주므로, 구분되도록 표시를 입힌다.
  if (data.mock) {
    onProgress(92, "테스트 응답을 받았어요. 표시를 입히는 중…");
    return renderMockLookbook(data.image, style, notes, "서버 테스트 응답 · MOCK");
  }
  return data.image;
}

/**
 * 서버 업로드 한도(4MB)에 맞게 사진을 줄인다.
 * 이미 충분히 작으면 원본을 그대로 보낸다.
 */
async function prepareUpload(file, srcUrl) {
  const img = await loadImage(srcUrl);
  const longSide = Math.max(img.naturalWidth, img.naturalHeight);
  if (file.size <= CONFIG.UPLOAD_MAX_BYTES && longSide <= CONFIG.UPLOAD_MAX_SIDE) return file;

  let side = Math.min(longSide, CONFIG.UPLOAD_MAX_SIDE);
  for (const quality of [0.9, 0.82, 0.75, 0.75, 0.7]) {
    const scale = side / longSide;
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; // 투명 PNG → JPG 변환 시 검은 배경 방지
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= CONFIG.UPLOAD_MAX_BYTES) {
      return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
    side = Math.round(side * 0.8);
  }
  throw new Error("사진을 충분히 줄이지 못했어요. 더 작은 사진으로 시도해 주세요.");
}

/* ==========================================================
   5. 결과 비교
   ========================================================== */
function showResult(url, style) {
  if (state.resultUrl && state.resultUrl.startsWith("blob:")) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = url;
  state.resultStyle = style;

  el.cmpBefore.src = state.originalUrl;
  el.cmpAfter.src = url;
  el.sideBefore.src = state.originalUrl;
  el.sideAfter.src = url;
  el.sideCaption.textContent = `${STYLE_LABELS[style]} 룩북`;

  setCompare(50);
  el.emptyState.hidden = true;
  el.resultActions.hidden = false;
  applyView();

  if (window.matchMedia("(max-width: 900px)").matches) {
    el.sliderView.parentElement.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function clearResult() {
  state.resultUrl = null;
  el.emptyState.hidden = false;
  el.sliderView.hidden = true;
  el.sideView.hidden = true;
  el.resultActions.hidden = true;
  el.progress.hidden = true;
  showGenError(null);
}

function applyView() {
  const hasResult = !!state.resultUrl;
  el.sliderView.hidden = !hasResult || state.view !== "slider";
  el.sideView.hidden = !hasResult || state.view !== "side";
}

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    applyView();
  })
);

function setCompare(pct) {
  el.cmpRange.value = pct;
  el.cmpBeforeWrap.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  el.cmpHandle.style.left = pct + "%";
}
el.cmpRange.addEventListener("input", () => setCompare(Number(el.cmpRange.value)));

/* ==========================================================
   6. 다운로드
   ========================================================== */
el.downloadBtn.addEventListener("click", () => {
  if (!state.resultUrl) return;
  const t = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`; // 내 컴퓨터 시각
  const a = document.createElement("a");
  a.href = state.resultUrl;
  const ext = /^data:image\/jpe?g/.test(state.resultUrl) ? "jpg" : "png"; // AI 결과는 JPG, 예시는 PNG
  a.download = `lookbook-${state.resultStyle}-${stamp}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

/* ==========================================================
   예시(목업) 모드 — 백엔드 없이 화면을 확인하기 위한 코드
   ========================================================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 읽을 수 없어요. 다른 사진으로 시도해 주세요."));
    img.src = src;
  });
}

// 스타일별 색감 변환 (픽셀 단위 — 모든 브라우저에서 동작)
const TONE = {
  casual:   (r, g, b) => [r * 1.06 + 10, g * 1.03 + 6, b * 0.95],
  business: (r, g, b) => { const l = 0.3 * r + 0.59 * g + 0.11 * b; return [l * 0.55 + r * 0.4, l * 0.55 + g * 0.42, l * 0.55 + b * 0.5 + 12]; },
  street:   (r, g, b) => [(r - 128) * 1.35 + 128 + 8, (g - 128) * 1.3 + 128, (b - 128) * 1.3 + 128 - 6],
  vintage:  (r, g, b) => [r * 0.393 + g * 0.769 + b * 0.189, r * 0.349 + g * 0.686 + b * 0.168, r * 0.272 + g * 0.534 + b * 0.131 - 10],
};
const ACCENT = { casual: "#9cc3e6", business: "#2c3e57", street: "#ff5a36", vintage: "#8b5e3c" };

async function mockStyling({ srcUrl, style, notes, onProgress }) {
  onProgress(20, "사진을 분석하는 중…");
  await sleep(600);
  onProgress(50, `${STYLE_LABELS[style]} 스타일을 적용하는 중…`);
  await sleep(700);
  onProgress(80, "룩북 레이아웃을 입히는 중…");
  await sleep(400);
  return renderMockLookbook(srcUrl, style, notes, "브라우저 예시 · MOCK");
}

// 예시/테스트 결과 이미지: 색감 필터 + 룩북 캡션 + MOCK 표시
async function renderMockLookbook(src, style, notes, tag) {
  const img = await loadImage(src);
  const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const fn = TONE[style];
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = fn(px[i], px[i + 1], px[i + 2]);
    px[i] = r; px[i + 1] = g; px[i + 2] = b; // Uint8ClampedArray 가 0~255로 자동 보정
  }
  ctx.putImageData(data, 0, 0);

  // 룩북 캡션 (원본과 같은 크기를 유지해야 슬라이더 비교가 맞는다)
  const band = Math.round(h * 0.13);
  const grad = ctx.createLinearGradient(0, h - band * 1.6, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - band * 1.6, w, band * 1.6);

  const pad = Math.round(w * 0.05);
  const big = Math.max(16, Math.round(band * 0.34));
  const small = Math.max(11, Math.round(band * 0.17));
  ctx.fillStyle = ACCENT[style];
  ctx.fillRect(pad, h - band + 2, Math.round(big * 0.25), big);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.font = `800 ${big}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(`LOOKBOOK · ${style.toUpperCase()}`, pad + big * 0.5, h - band);
  ctx.font = `500 ${small}px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif`;
  const sub = notes ? `요청: ${notes}` : `${STYLE_LABELS[style]} 스타일 예시 결과`;
  ctx.fillText(truncate(ctx, sub, w - pad * 2 - big * 0.5), pad + big * 0.5, h - band + big * 1.25);

  ctx.font = `700 ${small}px system-ui, sans-serif`;
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  // 화면의 '원본/룩북' 라벨과 겹치지 않도록 캡션 바로 위 오른쪽에 둔다
  const tagY = h - band - small * 2.6;
  roundRect(ctx, w - pad - tw - small, tagY, tw + small, small * 1.9, small * 0.95);
  ctx.fillStyle = "#fff";
  ctx.fillText(tag, w - pad - tw - small / 2, tagY + small * 0.45);

  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return URL.createObjectURL(blob);
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

// 예시 인물 일러스트를 캔버스로 그려 PNG로 만든다 (외부 이미지 불필요)
function makeSampleImage() {
  const w = 768, h = 1024;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");

  const bg = x.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#e9e2d8");
  bg.addColorStop(1, "#cfc4b5");
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.fillStyle = "rgba(0,0,0,0.08)";
  x.beginPath(); x.ellipse(w / 2, 960, 170, 26, 0, 0, Math.PI * 2); x.fill();

  const cx = w / 2;
  // 다리 (청바지)
  x.fillStyle = "#4a6385";
  x.fillRect(cx - 78, 560, 70, 380);
  x.fillRect(cx + 8, 560, 70, 380);
  // 신발
  x.fillStyle = "#f4f4f4";
  x.beginPath(); x.ellipse(cx - 46, 945, 52, 18, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(cx + 46, 945, 52, 18, 0, 0, Math.PI * 2); x.fill();
  // 팔
  x.fillStyle = "#e7c3a3";
  x.save(); x.translate(cx - 120, 330); x.rotate(0.12); x.fillRect(-22, 0, 44, 260); x.restore();
  x.save(); x.translate(cx + 120, 330); x.rotate(-0.12); x.fillRect(-22, 0, 44, 260); x.restore();
  // 상의 (흰 티셔츠)
  x.fillStyle = "#fbfaf7";
  x.beginPath();
  x.moveTo(cx - 140, 300); x.lineTo(cx + 140, 300);
  x.lineTo(cx + 160, 420); x.lineTo(cx + 108, 430);
  x.lineTo(cx + 100, 590); x.lineTo(cx - 100, 590);
  x.lineTo(cx - 108, 430); x.lineTo(cx - 160, 420);
  x.closePath(); x.fill();
  x.strokeStyle = "rgba(0,0,0,0.08)"; x.lineWidth = 3; x.stroke();
  // 목·얼굴
  x.fillStyle = "#e7c3a3";
  x.fillRect(cx - 24, 250, 48, 60);
  x.beginPath(); x.ellipse(cx, 200, 78, 92, 0, 0, Math.PI * 2); x.fill();
  // 머리카락
  x.fillStyle = "#2b211c";
  x.beginPath(); x.ellipse(cx, 160, 86, 64, 0, Math.PI, Math.PI * 2); x.fill();
  x.fillRect(cx - 86, 158, 18, 80); x.fillRect(cx + 68, 158, 18, 80);
  // 얼굴 디테일
  x.fillStyle = "#2b211c";
  x.beginPath(); x.arc(cx - 26, 205, 6, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(cx + 26, 205, 6, 0, Math.PI * 2); x.fill();
  x.strokeStyle = "#a8624f"; x.lineWidth = 4; x.lineCap = "round";
  x.beginPath(); x.arc(cx, 232, 16, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();

  return new Promise((r) => c.toBlob(r, "image/png"));
}
