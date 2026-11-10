import OpenAI, { toFile } from 'openai';
import { buildPrompt } from './styles.js';

// 공식 문서(2026-11 확인): gpt-image-2.5-sunburst 는 /v1/images/edits 를 지원합니다.
// https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
// ※ input_fidelity 는 이 모델의 지원 여부가 문서에 명시되지 않아 보내지 않습니다.
//   (얼굴·정체성 보존은 프롬프트로 지시)
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
// low | medium | high | xhigh | max | auto  (높을수록 느리고 비쌉니다)
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

export const isMock = () => process.env.MOCK_STYLING === 'true';

let client;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new StylingError(500, '서버에 OpenAI API 키가 설정되지 않았어요. 관리자에게 문의해 주세요.');
  }
  // API 키는 서버(.env / Vercel 환경변수)에서만 읽고, 프론트엔드로 절대 보내지 않습니다.
  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 180 * 1000, // 문서: 복잡한 요청은 최대 2분 정도 걸릴 수 있음
    maxRetries: 1,
  });
  return client;
}

/**
 * 업로드한 사진을 선택한 스타일의 룩북 이미지로 바꿉니다.
 *
 * @param {object} p
 * @param {Buffer} p.buffer    이미지 바이너리
 * @param {string} p.mimetype  'image/jpeg' | 'image/png'
 * @param {string} p.style     lib/styles.js 의 id
 * @param {string} p.notes     추가 요청 (빈 문자열 가능)
 * @returns {Promise<{ image: string, mock: boolean }>}  image 는 data URL
 */
export async function styleImage({ buffer, mimetype, style, notes }) {
  if (isMock()) {
    // 테스트용 응답: AI를 호출하지 않고 받은 이미지를 그대로 돌려줍니다. (비용 없음)
    await new Promise((r) => setTimeout(r, 800));
    return { image: `data:${mimetype};base64,${buffer.toString('base64')}`, mock: true };
  }

  const ext = mimetype === 'image/png' ? 'png' : 'jpg';

  try {
    const result = await getClient().images.edit({
      model: MODEL,
      image: await toFile(buffer, `photo.${ext}`, { type: mimetype }),
      prompt: buildPrompt(style, notes),
      size: 'auto',          // 원본 비율에 맞춰 모델이 결정
      quality: QUALITY,
      output_format: 'jpeg', // PNG보다 훨씬 가벼워 Vercel 응답 한도(4.5MB) 안에 들어옵니다.
      output_compression: 90,
      n: 1,
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) throw new StylingError(502, 'AI가 이미지를 만들지 못했어요. 다시 생성해 주세요.');

    const u = result.usage;
    if (u) console.log(`[OpenAI] ${MODEL} · quality=${QUALITY} · 토큰 입력 ${u.input_tokens} / 출력 ${u.output_tokens}`);
    return { image: `data:image/jpeg;base64,${b64}`, mock: false };
  } catch (err) {
    throw toFriendlyError(err);
  }
}

/** OpenAI 오류를 사용자에게 보여줄 한국어 메시지로 바꿉니다. */
function toFriendlyError(err) {
  if (err instanceof StylingError) return err;

  // 서버 로그에는 원인을 남깁니다. (API 키는 포함되지 않음)
  console.error('[OpenAI 오류]', err.status ?? '', err.code ?? '', err.message);

  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new StylingError(504, '스타일링 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.');
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new StylingError(502, 'AI 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  }

  const code = err.code || err.error?.code;
  if (code === 'moderation_blocked' || code === 'content_policy_violation') {
    return new StylingError(400, '이 사진이나 요청은 안전 정책에 따라 편집할 수 없어요. 다른 사진이나 요청으로 시도해 주세요.');
  }
  // 모델 이름 오류는 404 가 아니라 400(invalid_value, param=model)으로 오기도 합니다.
  if (code === 'model_not_found' || err.param === 'model' || /model .*(does not exist|not found)/i.test(err.message)) {
    return new StylingError(500, `모델(${MODEL})을 찾을 수 없거나 사용할 수 없어요. 서버의 OPENAI_IMAGE_MODEL 설정을 확인해 주세요.`);
  }
  if (code === 'insufficient_quota') {
    return new StylingError(503, 'API 사용 한도를 초과했어요. OpenAI 결제/사용량 설정을 확인해 주세요.');
  }

  switch (err.status) {
    case 400: return new StylingError(400, '이미지를 편집할 수 없어요. 인물이 잘 보이는 다른 사진으로 시도해 주세요.');
    case 401: return new StylingError(500, 'OpenAI API 키가 올바르지 않아요. 서버 설정을 확인해 주세요.');
    case 403: return new StylingError(500, '이 API 키로는 해당 모델을 쓸 권한이 없어요. (조직 인증 필요 여부 확인)');
    case 404: return new StylingError(500, `모델(${MODEL})을 찾을 수 없어요. 모델 이름을 확인해 주세요.`);
    case 429: return new StylingError(429, '요청이 너무 많아요. 1분 정도 후에 다시 시도해 주세요.');
    default:  return new StylingError(502, 'AI 스타일링 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export class StylingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // 사용자에게 그대로 보여줘도 되는 메시지
  }
}
