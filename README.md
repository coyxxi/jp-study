# 일본어 공부방 · 설치 안내서

JLPT N5 → N2, 워홀 회화를 위한 개인 공부 사이트입니다.

| 구성 | 맡는 일 | 비용 |
|---|---|---|
| **GitHub Pages** | 사이트 화면 | 무료 |
| **Supabase** | 로그인, 학습 기록, 수업 사진 | 무료 플랜 |
| **Gemini API** | 사진 정리, 문제 만들기, 작문 채점, 회화 상대 | 무료 한도 또는 소액 |

처음 한 번만 아래 순서대로 설정하면 됩니다. 30~40분 정도 걸려요. 코드는 `config.js` 두 줄만 바꾸면 됩니다.

---

## 1단계. Supabase 프로젝트 만들기

1. https://supabase.com 에 가입하고 **New project**를 누릅니다.
2. 아래처럼 채웁니다.
   - **Name:** `jp-study`
   - **Database Password:** 아무 비밀번호 (따로 적어두기)
   - **Region:** Northeast Asia (Seoul)
3. 프로젝트가 만들어질 때까지 1~2분 기다립니다.

## 2단계. 저장 공간 만들기

1. 왼쪽 메뉴에서 **SQL Editor** → **New query**를 엽니다.
2. 이 폴더의 `supabase/schema.sql` 내용을 전부 복사해 붙여넣고 **Run**을 누릅니다.
3. "Success"가 나오면 끝입니다.

이 단계에서 만들어지는 것:

- 학습 기록 테이블. 로그인한 본인만 읽고 쓸 수 있게 잠겨 있어요.
- 수업 사진 보관함 (비공개).

## 3단계. 내 계정 만들고 회원가입 막기

1. **Authentication → Users → Add user → Create new user**를 누릅니다.
2. 이메일과 비밀번호를 넣고 **Auto Confirm User**를 체크한 뒤 만듭니다. 이 계정으로 공부방에 로그인합니다.
3. **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 끕니다. 다른 사람이 가입하지 못하게 막는 설정이에요.
   - 메뉴 이름은 Supabase 화면 개편에 따라 조금 다를 수 있어요.

## 4단계. AI 연결 (Gemini)

**API 키 발급**

1. https://aistudio.google.com 에 Google 계정으로 들어가 **Get API key → Create API key**로 키를 만들고 복사합니다.

**키를 Supabase에 저장**

2. Supabase에서 **Edge Functions → Secrets**로 갑니다.
3. 이름 `GEMINI_API_KEY`, 값에 복사한 키를 넣고 저장합니다.
   - 키는 Supabase 서버에만 보관돼요. 사이트 코드에는 들어가지 않아요.

**AI 함수 배포**

4. **Edge Functions → Deploy a new function → Via Editor**를 누릅니다.
5. 함수 이름을 정확히 `ai`로 정합니다.
6. 에디터 내용을 지우고 이 폴더의 `supabase/functions/ai/index.ts` 내용을 붙여넣습니다.
7. **Deploy**를 누릅니다.
   - **Verify JWT** 설정은 켜진 그대로 두세요. 로그인한 사람만 AI를 쓸 수 있게 해 줍니다.

**모델을 바꾸고 싶을 때 (선택)**

기본값은 다음과 같아요.

| 용도 | 기본 모델 |
|---|---|
| 일반 작업 | `gemini-3.8-flash` |
| 빠른 작업 | `gemini-3.5-flash-lite` |

바꾸려면 Secrets에 `GEMINI_MODEL` 또는 `GEMINI_MODEL_QUICK`를 추가하고 원하는 모델 이름을 넣으세요. 무료 한도로 쓸 수 있는 모델과 한도는 AI Studio의 요금·한도 화면에서 확인할 수 있어요. 지정한 모델이 없으면 자동으로 `gemini-3.6-flash`, `gemini-2.5-flash` 순으로 시도합니다.

> **참고:** Gemini 무료 등급은 입력 내용이 Google 서비스 개선에 쓰일 수 있어요. 신경 쓰이면 AI Studio에서 결제(유료 등급)를 켜면 됩니다. 이 공부방의 사용량이면 월 몇천 원 수준이에요.

## 5단계. 연결 정보 넣기

1. Supabase **Project Settings → API**(또는 **API Keys**)에서 두 값을 복사합니다.
   - **Project URL**
   - **anon public** 키 (또는 **publishable** 키)
2. 이 폴더의 `config.js`를 열어 따옴표 안에 붙여넣습니다.

```js
window.JP_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

이 두 값은 공개되어도 괜찮은 값이에요. 기록은 2단계에서 본인만 볼 수 있게 잠가 두었어요.

## 6단계. GitHub에 올리고 사이트 열기

**저장소 만들기**

1. https://github.com 에 가입하고 오른쪽 위 **+ → New repository**를 누릅니다.
2. 이름을 `jp-study`로 하고 **Public**을 선택한 뒤 **Create repository**를 누릅니다.
   - 무료 계정은 공개 저장소만 사이트로 열 수 있어요.
   - 공개되는 것은 코드와 기본 단어 데이터뿐이에요. 내 학습 기록은 Supabase에 있어서 보이지 않아요.

**파일 올리기**

3. 저장소 화면에서 **uploading an existing file**을 누릅니다.
4. 이 폴더 안의 파일과 폴더를 **전부** 끌어다 놓습니다: `index.html`, `config.js`, `js/`, `data/`, `supabase/`, `README.md`
5. **Commit changes**를 누릅니다.

**사이트 켜기**

6. **Settings → Pages**에서 Source를 **Deploy from a branch**로, Branch를 **main / (root)**로 두고 **Save**를 누릅니다.
7. 1~2분 뒤 `https://내아이디.github.io/jp-study/` 주소로 열립니다.

## 7단계. 휴대폰에 설치

사이트 주소를 휴대폰 브라우저로 열고 로그인한 뒤 홈 화면에 추가하면 앱처럼 쓸 수 있어요.

- **iPhone (Safari):** 공유 → 홈 화면에 추가
- **Android (Chrome):** 메뉴 → 홈 화면에 추가

---

## 알아두면 좋은 것

- **첫 로그인:** 기존 구글 시트에 있던 단어·한자·문법 1,199개가 자동으로 "학원에서 배움" 상태로 들어가요.
- **Supabase 무료 프로젝트 일시정지:** 일주일 넘게 쓰지 않으면 프로젝트가 일시정지될 수 있어요. 그러면 Supabase 대시보드에서 **Restore**를 누르면 됩니다. 기록은 지워지지 않아요.
- **백업:** **내 실력 → 설정 → 백업 내려받기**로 모든 기록을 파일 하나로 받아둘 수 있어요. 한 달에 한 번 정도 추천해요.
- **기능을 고치고 싶을 때:** Claude에게 이 폴더를 주고 요청하면 바뀐 파일을 받을 수 있어요. 받은 파일을 GitHub 저장소에 같은 이름으로 다시 올리면 1~2분 뒤 반영돼요. 이때 `config.js`는 덮어쓰지 않게 주의하세요.
- **설정 화면:** 왼쪽 아래 **⚙ 설정**에 있어요. 휴대폰에서는 **내 실력 → ⚙ 설정**으로 들어가요. 공부방 이름·부제, 교재 목록, 시험 일정, AI 연결 테스트, 백업을 여기서 관리해요.
- **AI 함수를 고쳤을 때:** `supabase/functions/ai/index.ts`가 바뀌면 Supabase **Edge Functions → ai → Code**에 새 내용을 붙여넣고 **Deploy**를 다시 눌러야 반영돼요.
- **청해 음성:** 기기에 들어 있는 일본어 음성을 써요. 소리 품질은 기기마다 달라요.

## 폴더 구성

```
index.html                    화면
config.js                     Supabase 연결 정보 (직접 입력)
js/core.js                    학습 상태 · 복습 규칙 · 문제 은행
js/quiz.js                    시험 화면
js/views.js                   오늘 · 기록 · 시험 · 회화 · 내 실력
js/study.js                   공부 (단어장 · 한자 · 문법 · 카드)
js/supa.js                    Supabase 연결 (DB · 사진 · AI)
data/master.json              N5·N4 단어 · 한자 · 문법 기본 데이터
data/examples.json            예문 889개 (기존 시트)
data/seed-learned.json        기존 시트에서 배운 항목 목록
supabase/schema.sql           2단계에서 실행할 SQL
supabase/functions/ai/index.ts  4단계 AI 함수
```

**데이터 출처**

- **단어 목록:** JLPT 단어 목록(Jonathan Waller의 목록 기반, open-anki-jlpt-decks)
- **한자:** kanji-data (KANJIDIC 기반)
- **한국어 뜻·문법·예문:** 기존 학습 시트와 Claude가 정리
