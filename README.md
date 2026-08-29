# AI RUN : 바이러스 러너

바이브 코딩 실습용 HTML Canvas 러닝 게임입니다. 삐야(병아리)와 오르(곰) 중 캐릭터를 고르고, 3레인 사이버 도로에서 바이러스를 피하며 달립니다.

## 실행 방법

### macOS (추천)

`게임실행.command` 더블클릭 → Safari에서 자동 실행

### 터미널

```bash
python3 -m http.server 8765
```

브라우저에서 [http://127.0.0.1:8765/](http://127.0.0.1:8765/) 접속

> `file://`로 직접 열면 Safari에서 이미지·사운드가 차단될 수 있습니다. 반드시 로컬 서버를 사용하세요.

## 조작

| 입력 | 동작 |
|------|------|
| ← / → 또는 A / D | 레인 이동 |
| 화면 좌·우 터치 | 레인 이동 (모바일) |
| Esc | 일시정지 |

## 프로젝트 구조

```
├── index.html          # 게임 화면
├── style.css           # 사이버 테마 UI
├── game.js             # 게임 로직
├── assets/
│   ├── characters/     # 캐릭터 스프라이트
│   └── sounds/         # BGM·효과음
├── scripts/
│   └── slice_sprites.py  # 스프라이트 시트 분할
└── 기획안.md
```

## 사운드

BGM·효과음은 [Mixkit](https://mixkit.co/) 무료 라이선스 음원을 사용합니다. 출처는 `assets/sounds/ATTRIBUTION.md`를 참고하세요.

## 스프라이트 재생성

원본 시트 PNG를 수정한 뒤:

```bash
python3 scripts/slice_sprites.py
```

필요 패키지: `pypng` (`pip install pypng`)
