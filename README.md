# AI 룩북 스튜디오

인물 사진 한 장을 올리고 스타일을 고르면, OpenAI 이미지 편집 API(`gpt-image-2.5-sunburst`)가 **얼굴·포즈·배경은 그대로 두고 옷차림만** 캐주얼·비즈니스·스트리트·빈티지 룩으로 바꿔 주는 가상 스타일링 웹 앱입니다.

> 생성 이미지는 가상 스타일링 참고용입니다. 얼굴이나 의상 세부가 원본과 다를 수 있고, 실제 사이즈·핏을 보장하지 않습니다. 본인 또는 사용 허락을 받은 사진만 업로드해 주세요.

## 주요 기능

- **사진 업로드:** JPG / PNG, 최대 10MB. 클릭하거나 끌어다 놓아 올리고, 예시 사진도 제공합니다.
- **스타일 선택:** 캐주얼 · 비즈니스 · 스트리트 · 빈티지
- **추가 요청:** 색상, 분위기, 착용 상황을 입력합니다(300자). 빠른 입력 칩도 있습니다.
- **AI 스타일링:** 진행 상태를 표시하고, 오류가 나면 한국어로 안내합니다.
- **결과 비교:** 슬라이더 / 나란히 보기
- **다운로드 · 다시 생성**
- **모바일 대응 · 다크 모드**

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프론트엔드 | HTML, CSS, JavaScript (`public/`) |
| 백엔드 | Node.js + Express 5 (`server.js`), multer |
| 이미지 편집 API | OpenAI `gpt-image-2.5-sunburst` (`/v1/images/edits`) |
| 배포 | Vercel |

## 프로젝트 구조

```
├── server.js          # Express 서버: API 엔드포인트 + Vercel 진입점 (export default app)
├── lib/
│   ├── styles.js      # 스타일별 편집 지시문 + 프롬프트 생성 (얼굴·포즈 유지 규칙)
│   └── styling.js     # OpenAI 이미지 편집 호출, 테스트 응답 모드, 오류 메시지 변환
├── public/            # 프론트엔드 (index.html, style.css, app.js) — Vercel CDN이 서빙
├── .env.example       # 환경변수 견본 (실제 키는 .env 에만, GitHub에 올리지 않음)
├── .vercelignore
└── package.json
```

## 로컬에서 실행하기

필요 환경: **Node.js 20 이상**

```bash
# 1. 패키지 설치
npm install

# 2. 환경변수 파일 만들기
cp .env.example .env
#   .env 를 열어 OPENAI_API_KEY 에 본인의 API 키를 입력

# 3. 서버 실행
npm start          # → http://localhost:3000
```

- 개발 중에는 `npm run dev`로 실행하면, 코드를 고칠 때 서버가 자동으로 재시작됩니다.
- 비용 없이 화면 흐름만 확인하려면 `.env`에 `MOCK_STYLING=true`를 넣습니다. 이 모드에서는 AI를 호출하지 않고 테스트 응답을 돌려줍니다.
- `public/index.html`을 파일로 직접 열면 서버 없이 **브라우저 예시 모드**로 동작합니다.

화면 오른쪽 위 배지로 현재 모드를 확인할 수 있습니다.

| 배지 | 의미 |
|---|---|
| 예시 모드 | 서버 없음, 브라우저 안에서 색감 필터로 만든 예시 결과 |
| 서버 테스트 모드 | 서버 연결됨, `MOCK_STYLING=true` (AI 호출 없음) |
| AI 연결됨 | 실제 OpenAI 이미지 편집 호출 (호출마다 비용 발생) |

## 환경변수

| 이름 | 필수 | 설명 | 기본값 |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI API 키 (서버에서만 사용, 브라우저로 보내지 않음) | – |
| `MOCK_STYLING` | | `true`면 AI 호출 없이 테스트 응답 | `false` |
| `OPENAI_IMAGE_MODEL` | | 이미지 편집 모델 | `gpt-image-2.5-sunburst` |
| `OPENAI_IMAGE_QUALITY` | | `low` / `medium` / `high` / `xhigh` / `max` / `auto` | `medium` |
| `RATE_LIMIT_MAX` | | IP당 허용 횟수 (`0` = 제한 없음) | `5` |
| `RATE_LIMIT_WINDOW_MIN` | | 위 횟수를 세는 시간(분) | `10` |
| `PORT` | | 로컬 서버 포트 | `3000` |

## API

`POST /api/style` (`multipart/form-data`)

| 필드 | 설명 |
|---|---|
| `image` | JPG/PNG 파일 1장, **4MB 이하**. 브라우저가 업로드 전에 자동으로 줄입니다. |
| `style` | `casual` · `business` · `street` · `vintage` |
| `notes` | 추가 요청 (선택, 300자 이하) |

- 성공: `200 { "image": "data:image/jpeg;base64,...", "mock": false }`
- 실패: `4xx/5xx { "error": "사용자에게 보여줄 메시지" }`

`GET /api/health`는 `{ ok, mock, hasApiKey }`를 돌려줍니다. 키 값은 응답에 포함하지 않습니다.

## Vercel 배포

1. 이 저장소를 GitHub에 푸시합니다.
2. [Vercel](https://vercel.com)에서 **Add New → Project**를 누르고 저장소를 **Import**합니다. 프레임워크는 Express로 자동 인식되며, 별도 설정은 필요 없습니다.
3. **Environment Variables**에 `OPENAI_API_KEY`를 등록합니다. 필요하면 `RATE_LIMIT_MAX` 등도 추가합니다.
4. **Deploy**를 누릅니다.

### 배포 환경에서 고려한 점

| 항목 | 처리 방식 |
|---|---|
| 정적 파일 | `public/`은 Vercel CDN이 서빙하고, Express `express.static`은 로컬 전용입니다. |
| 요청 본문 한도 (Vercel 4.5MB) | 서버 업로드 한도 4MB. 브라우저가 긴 변 2048px·3.8MB 이하 JPG로 자동 축소해서 보냅니다. |
| 응답 크기 | 결과를 JPEG(압축 90)로 받아 보통 1MB 이하입니다. |
| 임시 파일 | multer `memoryStorage`로 메모리에서만 처리하며, 디스크에 저장하지 않습니다. |
| 실행 시간 | 이미지 편집은 보통 15~60초, 최대 2분 정도 걸립니다. OpenAI 호출 제한은 180초, 브라우저는 200초까지 기다립니다. |
| API 키 | Vercel 환경변수로만 관리합니다. `.env`는 `.gitignore`/`.vercelignore`로 제외됩니다. |
| 남용 방지 | IP당 요청 횟수 제한(기본 10분 5회). 인스턴스별 메모리 기준이라 최소한의 보호입니다. |

## 주의 사항

- 공개 URL에서는 누구나 내 API 키로 이미지를 생성할 수 있습니다. 요청 횟수 제한을 유지하고, OpenAI 대시보드에서 사용 한도(Usage limits)를 설정해 두세요.
- 업로드한 사진은 서버에 저장하지 않으며, 편집을 위해 OpenAI API로만 전송됩니다.
