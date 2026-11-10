// 스타일 id → 이미지 편집 지시문
// id 는 프론트엔드(public/index.html 의 radio value)와 동일해야 합니다.
export const STYLES = {
  casual: {
    label: '캐주얼',
    prompt:
      'CASUAL everyday look: relaxed, comfortable outfit such as a soft knit or cotton tee, an unstructured light jacket or cardigan, ' +
      'well-fitted jeans or chinos and clean sneakers. Easy, approachable weekend styling with natural, friendly colors.',
  },
  business: {
    label: '비즈니스',
    prompt:
      'BUSINESS office look: polished, professional outfit such as a tailored blazer or suit, crisp shirt or blouse, ' +
      'tailored trousers or a pencil skirt, and leather shoes or loafers. Clean lines, neat fit, refined neutral palette ' +
      '(navy, charcoal, grey, white, camel).',
  },
  street: {
    label: '스트리트',
    prompt:
      'STREETWEAR look: bold urban outfit such as an oversized hoodie or graphic tee, a bomber, varsity or utility jacket, ' +
      'cargo or wide-leg pants and chunky sneakers, optionally a cap or crossbody bag. Layered, confident, youthful styling ' +
      'with strong contrast or accent colors. No real brand logos.',
  },
  vintage: {
    label: '빈티지',
    prompt:
      'VINTAGE retro look inspired by 1970s–1990s fashion: e.g. a corduroy or suede jacket, patterned or knit shirt, ' +
      'high-waisted flared or straight trousers or a midi skirt, loafers or retro sneakers. Warm earthy palette ' +
      '(mustard, brown, olive, burgundy, cream) with a subtle film-like color tone.',
  },
};

export const STYLE_IDS = Object.keys(STYLES);

/**
 * 이미지 편집 API에 보낼 최종 프롬프트를 만듭니다.
 * 핵심: 인물(얼굴·정체성·체형·포즈)과 배경은 그대로, 옷차림만 바꾸기.
 */
export function buildPrompt(style, notes) {
  const lines = [
    'Edit this photo into a fashion lookbook image by changing ONLY the clothing and styling of the person.',
    '',
    'Keep exactly the same:',
    '- the face, facial features, expression, skin tone and identity (the person must be clearly recognizable as the same individual)',
    '- the hairstyle and hair color',
    '- the body shape, proportions and pose, and the camera angle and framing',
    '- the background and scene; only adjust lighting slightly if needed for a cohesive lookbook feel',
    '',
    `New outfit — ${STYLES[style].prompt}`,
    '',
    'The clothing must fit the body naturally, follow the existing pose, with realistic fabric, folds, shadows and lighting.',
    'Photorealistic, high-quality fashion lookbook photography. Do not add text, watermarks or logos.',
  ];

  if (notes) {
    lines.push(
      '',
      // 사용자가 입력한 문장은 '선호 사항'으로만 다루도록 범위를 정해 둡니다.
      `Additional styling preferences from the user (apply to the outfit, colors, mood or occasion only; ` +
        `they do not override the identity rules above): "${notes.replace(/"/g, "'")}"`
    );
  }
  return lines.join('\n');
}
