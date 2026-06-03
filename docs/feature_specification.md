# [기획 문서] 즐겨찾기 및 회원관리 기능 추가

본 문서는 사서 추천 도서 플랫폼에 **회원가입/로그인**, **개인정보 암호화 및 보안**, **즐겨찾기(카테고리/트리 구조)** 및 **읽은 책 표시(UI 구상)** 기능을 추가하기 위한 기능 기획 및 설계 문서입니다.

---

## 1. 기능 요구사항 (Functional Requirements)

### 1.1. 즐겨찾기 (Favorites) 기능
* **즐겨찾기 추가/해제**: 도서 목록 및 상세 보기 모달에서 즐겨찾기(별 아이콘) 버튼을 클릭하여 추가/해제할 수 있습니다.
* **비로그인 상태 제어**: 로그인하지 않은 사용자가 즐겨찾기 버튼을 누르면 로그인/회원가입을 유도하는 모달창이 나타납니다.
* **즐겨찾기 목록 표시**: 브라우저 우측에 즐겨찾기 목록 사이드바(Drawer)가 위치하며, 로그인 성공 시 해당 사용자의 즐겨찾기 목록을 동적으로 불러옵니다.

### 1.2. 회원가입 및 로그인 (Authentication)
* **간편 인증 설계**: 사용자의 편의성을 극대화하기 위해 이메일이나 전화번호 대신 **별명(Nickname)**과 **비밀번호(Password)**만으로 간편하게 가입 및 로그인할 수 있도록 설계합니다.
* **중복 방지**: 동일한 별명으로 중복 가입할 수 없습니다.
* **세션 관리**: 로그인 시 서버에서 보안 세션 토큰을 발급하여 브라우저의 `localStorage` 또는 `cookie`에 안전하게 저장하고, API 요청 시 헤더를 통해 인증합니다.

### 1.3. 개인정보 보안 및 암호화 (Security & Encryption)
* **비밀번호 단방향 암호화**: 개인정보 보호법 및 정보보안 가이드를 준수하여 사용자의 비밀번호를 평문으로 저장하지 않습니다.
  * Node.js 내장 `crypto` 모듈의 **`scrypt`** 또는 **`pbkdf2`** 알고리즘을 사용해 **솔트(Salt)**를 추가하여 해싱합니다. (외부 라이브러리 의존성 없음, 윈도우 환경 호환성 극대화)
* **API 보안**: 회원가입/로그인 및 즐겨찾기 API는 SQL Injection 방지를 위해 SQLite 파라미터 바인딩을 필수적으로 적용합니다.
* **XSS 방지**: 사용자가 입력한 별명 등을 화면에 렌더링할 때 HTML 이스케이프 처리를 적용합니다.

### 1.4. 즐겨찾기 목록 편집 및 카테고리 트리 UI
* **우측 사이드바 Layout**: 화면 우측에 슬라이드 인/아웃 방식의 즐겨찾기 패널을 배치합니다.
* **카테고리(폴더) 분류**: 
  * 기본적으로 '미분류' 폴더가 제공됩니다.
  * 사용자는 새 폴더(카테고리)를 생성하고 이름을 변경할 수 있습니다.
* **트리 구조 및 편집**:
  * 아코디언/트리 구조로 폴더를 펼치고 접을 수 있습니다.
  * 도서를 다른 폴더로 이동하거나 폴더 순서를 변경할 수 있는 간단하고 직관적인 UI(이동 버튼 또는 드래그 앤 드롭 형태)를 제공합니다.

### 1.5. [추후 개발] 읽은 책 표시 UI 구상
* **독서 상태 관리**: 사용자가 책을 읽었는지 여부를 표시하는 기능을 추가할 예정입니다.
* **UI 시나리오**: 도서 카드 및 상세 페이지에 체크박스 또는 책 아이콘(읽기 완료 상태 표시)을 제공하고, 읽은 책은 흐리게(딤드 처리) 보이거나 즐겨찾기처럼 우측 패널에서 '읽은 책' 탭을 통해 모아볼 수 있도록 구성합니다.

---

## 2. 데이터베이스(DB) 설계

기존 `books` 테이블 외에 회원 관리, 세션, 즐겨찾기 및 카테고리 관리를 위해 아래 테이블들을 추가합니다.

### 2.1. 사용자 테이블 (`users`)
사용자의 고유 식별자와 인증 정보를 저장합니다.
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,      -- 사용자 로그인 ID 역할을 하는 별명
  password_hash TEXT NOT NULL,        -- scrypt/pbkdf2로 암호화된 해시값
  salt TEXT NOT NULL,                 -- 해싱에 사용된 고유 솔트값
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2. 세션 테이블 (`sessions`)
로그인 상태를 유지하기 위한 토큰 정보를 저장합니다. (서버 메모리 유실 대응)
```sql
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 2.3. 즐겨찾기 카테고리 테이블 (`favorite_categories`)
트리 구조를 지원할 수 있도록 셀프 참조(`parent_id`) 구조를 도입합니다.
```sql
CREATE TABLE IF NOT EXISTS favorite_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER DEFAULT NULL,      -- 상위 폴더 ID (트리 구조 지원, NULL이면 최상위)
  sort_order INTEGER DEFAULT 0,        -- 표시 순서 정렬용
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES favorite_categories(id) ON DELETE SET NULL
);
```

### 2.4. 즐겨찾기 도서 테이블 (`favorites`)
사용자가 어떤 도서를 어떤 카테고리에 넣었는지 매핑합니다.
```sql
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  category_id INTEGER DEFAULT NULL,    -- 소속 카테고리 ID (NULL이면 미분류)
  sort_order INTEGER DEFAULT 0,        -- 카테고리 내 도서 정렬 순서
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY(category_id) REFERENCES favorite_categories(id) ON DELETE SET NULL
);
```

---

## 3. 회원가입/로그인 설계 (최적의 간편 설계)

### 3.1. 별명 & 패스워드 인증 Flow
1. **별명 입력**: 영문/숫자/한글 조합 2~15자 제한. 이메일 인증 같은 번거로운 단계 없음.
2. **비밀번호 입력**: 최소 6자 이상.
3. **가입 즉시 로그인**: 회원가입 완료와 동시에 세션 토큰을 발급하여 흐름을 매끄럽게 만듭니다.

### 3.2. 암호화 알고리즘 (Node.js Built-in Crypto)
별도의 외부 C++ 바인딩 모듈(bcrypt 등 Windows에서 자주 오류를 일으키는 모듈) 대신, Node.js 내장 `crypto`의 **`pbkdf2`** 또는 **`scrypt`**를 활용합니다.
* **해싱 로직 예시 (Back-end)**:
  ```javascript
  import crypto from 'crypto';

  // 비밀번호 해싱 생성
  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
  }

  // 비밀번호 검증
  function verifyPassword(password, salt, storedHash) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === storedHash;
  }
  ```

---

## 4. UI/UX 디자인 상세 설계

### 4.1. 우측 즐겨찾기 사이드바 (Favorites Drawer Panel)
* **레이아웃 구성**:
  * 메인화면 오른쪽에 `position: fixed` 형태의 슬라이드 패널 배치.
  * 모바일 환경에서는 100% 너비로 전체 화면을 덮고, 데스크톱 환경에서는 오른쪽 350px~400px 영역을 차지함.
  * 상단에 **"내 서재 / 즐겨찾기"** 타이틀과 **"폴더 추가(+)"** 버튼 배치.
  * 사용자의 로그인 상태에 따라 로그인 버튼 또는 사용자 닉네임과 "로그아웃" 버튼 표시.

* **카테고리 트리 UI 시나리오**:
  ```
  📂 소설책 (폴더)  [이름변경] [삭제]
    ├── 📖 아몬드 (도서) [이동] [해제]
    └── 📖 모순 (도서) [이동] [해제]
  📂 공부용 전공 서적 (폴더)
    └── 📖 미적분학 (도서)
  📂 미분류
    └── 📖 아주 작은 습관의 힘 (도서)
  ```
  * 각 폴더 왼쪽의 `▶` / `▼` 화살표 아이콘을 클릭하여 폴더 내부 도서 목록을 접거나 펼칠 수 있습니다.
  * 각 폴더 우측에 `이름 변경` 및 `삭제` 아이콘 제공 (폴더 삭제 시 소속 도서는 '미분류'로 이동되거나 일괄 삭제 옵션 선택 가능).
  * 도서 우측에 `이동` 아이콘을 클릭하면 이동할 대상 폴더 목록 팝업이 뜨고, 선택 시 즉시 이동됩니다.

### 4.2. 로그인/회원가입 모달 (Login/Signup Modal)
* 즐겨찾기 별표(`★`) 아이콘 클릭 시, 로그인하지 않은 경우 화면 중앙에 세련된 모달 노출.
* **상단 탭**: `로그인` | `회원가입`
* **입력 폼**:
  * 별명 (Nickname)
  * 비밀번호 (Password)
* **보안 안내**: "별명과 패스워드는 암호화되어 안전하게 보관됩니다." 안내 문구 노출로 신뢰도 향상.

---

## 5. [추후 개발] "읽은 책" 표시 UI 상세 구상

나중에 사용자가 독서 진행 상황을 기록할 수 있도록 디자인 가이드를 미리 잡아둡니다.

1. **도서 카드에 상태 아이콘 표시**:
   * 도서 목록의 각 책 카드에 **책 체크 아이콘 (📖/✔️)** 또는 **"읽음 완료"** 토글 스위치 배치.
   * 클릭 시 아이콘이 활성화(초록색 또는 테마 색상)되며 카드 배경에 미세한 불투명 효과(딤드)나 "읽음" 리본 뱃지가 부착됨.
2. **독서량 통계 대시보드 (우측 사이드바 상단)**:
   * 즐겨찾기 사이드바 상단에 `"내가 읽은 책: 12권 / 즐겨찾기: 24권"` 형태의 간단한 대시보드를 제공해 흥미 유발.
3. **필터링과의 연계**:
   * 메인 화면 좌측 필터바에 `[ ] 내가 읽은 책 제외` 또는 `[ ] 내가 읽은 책만 보기` 옵션을 추가해 가시성 극대화.

---

## 6. 구현 및 검증 계획 (Verification Plan)

### 6.1. 보안 점검 항목
* SQL Injection 방지를 위한 SQLite 파라미터화 쿼리 검사.
* 회원 데이터에 대한 평문 비밀번호 유출 가능성 차단 검증.
* 세션 만료 및 로그인 유효성 체크.

### 6.2. 사용자 시나리오 테스트
1. **비로그인 사용자**: 즐겨찾기 아이콘 클릭 시 로그인 유도 모달이 잘 뜨는지 확인.
2. **회원가입**: 임의의 별명/비밀번호로 회원가입이 정상적으로 완료되고 즉시 로그인되는지 확인.
3. **폴더 관리**: 새 폴더 생성, 이름 변경, 폴더 하위에 도서 이동이 문제없이 DB와 동기화되는지 확인.
4. **반응형 웹**: 모바일 화면에서 우측 즐겨찾기 Drawer 및 로그인 모달이 터치 인터페이스와 화면 비율에 맞게 잘 작동하는지 확인.
