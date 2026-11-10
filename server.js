import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { STYLE_IDS } from './lib/styles.js';
import { styleImage, isMock } from './lib/styling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Vercel 서버리스 함수의 요청 본문 한도(4.5MB)를 넘지 않도록 4MB로 제한합니다.
// 프론트엔드가 업로드 전에 큰 사진을 자동으로 줄여서 보냅니다.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_NOTES = 300;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

// 파일을 디스크에 저장하지 않고 메모리에서만 처리합니다. (임시 파일 없음 → Vercel에 적합)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 4 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new HttpError(400, 'JPG 또는 PNG 형식의 이미지만 업로드할 수 있어요.'));
  },
});

// 로컬에서는 Express가 public/ 을 서빙합니다. (Vercel에서는 public/ 을 CDN이 자동 서빙)
app.use(express.static(path.join(__dirname, 'public')));

// 서버 상태 확인용 — API 키 값은 절대 응답에 포함하지 않습니다.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mock: isMock(), hasApiKey: Boolean(process.env.OPENAI_API_KEY) });
});

// 요청 횟수 제한: 공개 배포 시 내 API 키로 무제한 호출되는 것을 막습니다.
// 기본값 IP당 10분에 5회 (테스트 응답 모드에서는 적용하지 않음, 0이면 제한 없음)
// - 검증을 통과해 실제로 AI를 호출하는 요청만 셉니다. (잘못된 파일·스타일 등은 세지 않음)
// - AI 호출이 실패하면 그 1회는 돌려줍니다.
// ※ 서버 메모리에 기록하므로 Vercel 인스턴스가 여러 개면 인스턴스별로 계산됩니다(최소한의 보호).
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 5);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MIN ?? 10) * 60 * 1000;
const hits = new Map(); // ip → [요청 시각들]

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

/** 한도 안이면 1회를 기록하고 되돌리기 함수를, 초과면 HttpError(429)를 던집니다. */
function takeRateSlot(ip) {
  if (!RATE_LIMIT_MAX || isMock()) return () => {};
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent);
    const waitMin = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 60000);
    throw new HttpError(429, `스타일링은 ${RATE_LIMIT_WINDOW_MS / 60000}분에 ${RATE_LIMIT_MAX}번까지 가능해요. 약 ${waitMin}분 후에 다시 시도해 주세요.`);
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // 메모리 보호
  return () => {
    const list = hits.get(ip);
    const i = list ? list.lastIndexOf(now) : -1;
    if (i !== -1) list.splice(i, 1);
  };
}

// 파일 앞부분(매직 넘버)으로 실제 JPG/PNG인지 확인합니다. (확장자·MIME은 위조 가능)
function sniffImageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

// 룩북 스타일링 요청
//   POST /api/style  (multipart/form-data: image, style, notes)
//   → 200 { image: "data:image/...;base64,...", mock: boolean }
//   → 4xx/5xx { error: "사용자에게 보여줄 메시지" }
app.post('/api/style', upload.single('image'), async (req, res, next) => {
  try {
    const style = String(req.body?.style ?? '');
    // 제어 문자를 제거하고 공백을 정리합니다.
    const notes = String(req.body?.notes ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!req.file) throw new HttpError(400, '이미지 파일이 없어요. 사진을 먼저 업로드해 주세요.');
    if (req.file.size === 0) throw new HttpError(400, '빈 파일이에요. 다른 사진을 올려 주세요.');
    const realType = sniffImageType(req.file.buffer);
    if (!realType) throw new HttpError(400, '올바른 JPG/PNG 이미지가 아니에요. 다른 파일을 올려 주세요.');
    if (!STYLE_IDS.includes(style)) throw new HttpError(400, '지원하지 않는 스타일이에요. 캐주얼·비즈니스·스트리트·빈티지 중에서 골라 주세요.');
    if (notes.length > MAX_NOTES) throw new HttpError(400, `추가 요청은 ${MAX_NOTES}자 이내로 입력해 주세요.`);

    // 검증을 모두 통과한 요청만 횟수 제한에 포함합니다.
    const releaseSlot = takeRateSlot(clientIp(req));

    const started = Date.now();
    const kb = Math.round(req.file.size / 1024);
    try {
      const result = await styleImage({ buffer: req.file.buffer, mimetype: realType, style, notes });
      console.log(`[스타일링 성공] ${style} · ${kb}KB · ${((Date.now() - started) / 1000).toFixed(1)}초${result.mock ? ' · 테스트 응답' : ''}`);
      res.json(result);
    } catch (err) {
      releaseSlot(); // AI 호출이 실패하면 이번 1회는 세지 않음
      console.log(`[스타일링 실패] ${style} · ${kb}KB · ${err.message}`);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// 존재하지 않는 API 경로
app.use('/api', (req, res) => res.status(404).json({ error: '요청한 API를 찾을 수 없어요.' }));

// 공통 오류 처리: 항상 { error } JSON 으로 응답합니다.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = {
      LIMIT_FILE_SIZE: '파일이 너무 커요. 4MB 이하의 이미지를 올려 주세요.',
      LIMIT_FILE_COUNT: '사진은 한 번에 한 장만 올릴 수 있어요.',
      LIMIT_UNEXPECTED_FILE: '사진은 한 번에 한 장만 올릴 수 있어요.',
      LIMIT_FIELD_VALUE: '추가 요청이 너무 길어요.',
    }[err.code] || '파일 업로드 중 문제가 발생했어요.';
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  const safe = err.expose || status < 500; // 의도적으로 만든 오류 메시지만 노출
  if (!safe) console.error(err);
  res.status(status).json({ error: safe ? err.message : '서버에서 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' });
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 로컬 실행 시에만 포트를 엽니다. Vercel은 export 된 app 을 직접 실행합니다.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
    console.log(isMock() ? '🧪 테스트 응답 모드 (MOCK_STYLING=true) — AI를 호출하지 않습니다.' : '🤖 실제 AI 호출 모드');
    if (!process.env.OPENAI_API_KEY) console.warn('⚠️  .env 에 OPENAI_API_KEY 가 없습니다.');
  });
}

export default app;
