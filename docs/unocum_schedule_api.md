# unocum.kr 일정 연동 API (라온/회원 샵 연동용)

작성일: 2026-10-30
대상: laon.kr(또는 회원 샵 사이트) 개발 담당자

## 1. 개요

unocum.kr에 등록된 회원 일정을 **읽기 전용**으로 제공합니다.

- push(라온으로 밀어넣기) 방식은 라온 측 호스팅(Cafe24)에서 수신 API 운영이 어려워 사용하지 않습니다.
- **pull(가져가기)** 방식이며, 조회 시점의 최신 데이터를 가져가므로 사실상 실시간입니다.
- 표준 형식은 **iCalendar(RFC 5545, `.ics`)** 입니다. 구글/애플/아웃룩/네이버 등 대부분의 캘린더가 구독 URL로 바로 사용할 수 있습니다.
- JSON API는 프로그램에서 직접 처리할 때 사용하는 보조 수단입니다.

## 2. 표준 형식: iCalendar (.ics) — 권장

```
GET https://unocum.kr/api/v1/unocum_schedules.ics
```

응답: `Content-Type: text/calendar; charset=utf-8`

### 인증 (둘 중 하나)

| 방식 | 사용 주체 | 방법 |
|---|---|---|
| **회원 토큰** (권장) | 라온 서버 | 헤더 `X-Unocum-Token: <회원 토큰>` 또는 `?token=<회원 토큰>` |
| 회원 링크(`sig`) | 캘린더 구독 등 | `?email=<회원이메일>&sig=<서명>` |

> **토큰은 회원마다 1개**입니다. 일정 화면의 **일정 공유** 버튼으로 발급되며, 그 회원 일정에만 접근할 수 있습니다.
> 재발급(`?rotate=1`)하면 이전 토큰은 즉시 무효가 됩니다.
> `email`을 함께 보내면 토큰의 회원과 일치해야 합니다(불일치 시 401).

### CORS

두 엔드포인트 모두 브라우저 호출을 지원합니다.

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: X-Unocum-Token, Content-Type`
- `OPTIONS` 사전요청(204) 지원

즉 **서버 간 호출과 브라우저(JS) 호출 모두 가능**합니다. 단, 브라우저 코드에 회원 토큰을 넣지 말고 **회원 링크(`sig`) 방식**을 사용하세요.

### 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `email` | 선택 | 회원 이메일. **토큰 회원과 일치해야 함** (불일치 시 401) |
| `from` | 선택 | 시작일 `YYYY-MM-DD` (기본: 이번 달 1일) |
| `to` | 선택 | 종료일 `YYYY-MM-DD` (기본: 이번 달 말일) |
| `sig` | 선택 | 개인 링크용 서명 |

- `from`~`to` 범위는 최대 **366일**입니다.
- 반복 일정은 범위 안의 발생일마다 1건씩 VEVENT로 반환됩니다.
- 종일 일정은 `DTSTART;VALUE=DATE`, 시간 일정은 UTC(`...Z`)로 반환됩니다.

### 사용 방법 (구독)

- **구글 캘린더**: 다른 캘린더 → URL로 추가 → 위 URL 입력
- **애플 캘린더**: 파일 → 캘린더 구독 → URL 입력
- **아웃룩**: 인터넷 캘린더 추가 → URL 입력
- **샵 페이지**: 서버에서 URL을 받아 `.ics`를 파싱해 표시하거나, 캘린더 위젯에 구독 URL로 등록

## 3. JSON API (프로그램 연동용, 보조)

```
GET https://unocum.kr/api/v1/unocum_schedules
```

인증·파라미터는 `.ics`와 동일합니다.

### 응답

```json
{
  "schedules": [
    {
      "target_date": "2026-11-03",
      "end_date": "2026-11-03",
      "is_all_day": 1,
      "start_time": null,
      "end_time": null,
      "title": "두물머리 농부시장"
    },
    {
      "target_date": "2026-11-08",
      "end_date": "2026-11-08",
      "is_all_day": 0,
      "start_time": "14:00",
      "end_time": "17:00",
      "title": "전시회 관람"
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `target_date` | string | 시작일 `YYYY-MM-DD` |
| `end_date` | string | 종료일 `YYYY-MM-DD` (여러 날 일정이면 시작일과 다름) |
| `is_all_day` | number | 종일이면 `1`, 시간 지정이면 `0` |
| `start_time` | string \| null | `HH:MM` (종일이면 `null`) |
| `end_time` | string \| null | `HH:MM` (종일이면 `null`) |
| `title` | string | 일정 제목 (없으면 빈 문자열) |

- 같은 날짜·시간·제목의 중복은 제거됩니다.
- 정렬: `target_date` → `start_time` 오름차순
- 여러 날 일정(출장 등)은 `target_date`~`end_date` 범위로 표시하면 됩니다.
- 예약 가능일 계산 시 `target_date`~`end_date` 구간 전체를 사용 불가로 처리하세요.

### 실시간 반영

- 이 API는 저장된 데이터를 **호출할 때마다 새로 조회**합니다. (캐시 없음: `Cache-Control: no-store`)
- 따라서 회원이 일정을 새로 등록/수정/삭제하면 **다음 호출부터 즉시 반영**됩니다.
- 반영 시점은 호출하는 쪽의 조회 주기에 따릅니다.
  - 예약 화면을 열 때마다 호출 → 사실상 실시간
  - 주기적 폴링(예: 1~5분) → 최대 폴링 주기만큼 지연
  - 캘린더 구독(구글/애플 등) → 해당 앱의 자체 갱신 주기(수십 분~수 시간)
- laon 쪽에서 응답을 자체 캐시하지 마세요.

### 오류 (공통)

| 코드 | 의미 |
|---|---|
| `401` | 토큰/서명 없음 또는 불일치 |
| `404` | 해당 이메일 회원 없음 |
| `400` | 날짜 범위 오류 (역순, 366일 초과) |

## 3-1. 일정 읽기 API v2 (location/source 포함) — 1단계

라온 예약 차단은 **장소(location)** 가 필요하므로 아래 API를 사용하세요. 기존 ICS 피드는 그대로 유지됩니다.

```
GET https://www.unocum.kr/api/v1/schedules?email=<회원이메일>&sig=<서명>
```

- 인증: `X-Unocum-Token`(회원 토큰) 헤더/`token` 파라미터, 또는 회원 `sig`
- 토큰은 **그 회원 일정만** 반환합니다. 다른 회원 이메일을 지정하면 401
- 기본 조회 범위: **오늘 -30일 ~ +90일** (`from`, `to`로 변경 가능)

### 응답

```json
{
  "success": true,
  "events": [
    {
      "id": "a3ff441d2659a0a8",
      "title": "경실련 서진숙외1 이훈 미팅 이동",
      "location": "양수로156번길 4 가동",
      "start": "2026-10-01T11:40:00+09:00",
      "end": "2026-10-01T11:50:00+09:00",
      "all_day": false,
      "source": ""
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 일정 고유 ID (16자리) |
| `title` | string | 제목 |
| `location` | string | 장소 (없으면 빈 문자열) |
| `start` | string | ISO8601 + KST(+09:00) |
| `end` | string | ISO8601 + KST(+09:00) |
| `all_day` | bool | 종일 여부 |
| `source` | string | 라온이 등록한 일정이면 `"laon"`, 직접 입력은 `""` |

- `start` 오름차순 정렬, 반복 일정은 발생일마다 1건
- 오류: sig/토큰 불일치 `401`, 회원 없음 `404`

> `source` 값은 2단계(쓰기 API + `source` 컬럼) 완료 후 `"laon"`으로 채워집니다. 그 전까지는 `""`입니다.

## 3-2. 예약가능 구분

일정 등록 화면의 **`예약가능`** 체크로 구분합니다 (**기본값: 체크 안 됨 = 바쁨**).

| 구분 | 공유 피드 반영 | 일정 중복 |
|---|---|---|
| **기본(바쁨)** | 피드에 포함 → 그 시간 예약 불가 | 같은 시간에 다른 일정 등록 불가 |
| **`예약가능` 체크** | 피드에서 제외 → 그 시간 예약 가능 | 겹쳐도 등록 가능 |

- 바쁨 일정과 `예약가능` 일정이 **겹치면, 겹친 구간만 잘라내어** 예약 가능 시간으로 비웁니다.
  - 예: 종일 일정 + 12:00~14:00 `예약가능` → 피드에는 00:00~12:00, 14:00~23:59 두 건으로 전달
- 여러 날 일정(출장 등) 중 특정 시간만 예약을 받고 싶을 때 유용합니다.
- 과거 일정처럼 `busy` 값이 없는 데이터는 **바쁨으로 간주**합니다.

## 4-1. 쓰기 API (라온 예약 → unocum 일정 자동 등록) — 2단계

라온에서 예약이 확정되면 회원 일정에 자동 등록합니다. **회원 토큰이 필수**입니다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/v1/events` | 등록 (같은 `source`+`source_id`면 갱신) |
| `PUT` | `/api/v1/events/{event_id}` | 수정 (변경할 필드만) |
| `DELETE` | `/api/v1/events/{event_id}` | 삭제 (소프트 삭제: `status='canceled'`) |

### 인증과 회원 범위

- **회원 토큰**(`X-Unocum-Token` 또는 `?token=`)이 필수입니다.
  - 읽기: 헤더 또는 `?token=` 모두 허용
  - **쓰기: 헤더 `X-Unocum-Token`만 허용** (링크 유출 시 무단 쓰기 방지)
- 토큰은 회원마다 발급되며 **그 회원 일정에만** 읽기/쓰기가 가능합니다.
  - 다른 회원 이메일을 지정하면 `401`
  - 다른 회원의 `event_id`를 수정/삭제하면 `404`
- `email`은 선택이며, 보내면 토큰 회원과 일치해야 합니다.
- `sig`는 선택이며, 보내면 토큰 회원의 서명과 일치해야 합니다.
- 토큰 재발급: `GET /api/bot/schedule/share-feed?rotate=1` (로그인 세션 필요) → 새 토큰 발급, 기존 토큰 무효

### 등록 요청

```json
{
  "email": "eou@kakao.com",
  "source": "laon",
  "source_id": "RES-20261030-0001",
  "title": "[라온카페] 핸드드립 체험 - 홍길동",
  "location": "양수로156번길 4 가동",
  "description": "예약번호 RES-20261030-0001 / 2명 / 010-0000-0000",
  "start": "2026-11-10T14:00:00+09:00",
  "end": "2026-11-10T15:30:00+09:00",
  "all_day": false
}
```

응답: `{"success": true, "event_id": "evt_123"}`

### 규칙

- 같은 `source`+`source_id` 재요청 시 **같은 `event_id`로 갱신** (DB UNIQUE)
- 인증: `X-Unocum-Token` (불일치 `401`)
- 삭제는 `status='canceled'` 처리 → 읽기 API 목록에서 제외
- 검증: `title` ≤255자, `source` 영문/숫자/`_`, `source_id` ≤64자, `start < end`
- 레이트리밋: 동일 `source_id` **분당 10회** (초과 시 `429`)
- `PUT`/`DELETE`는 라온이 등록한 일정(`source_id` 있음)만 가능

### 읽기 응답의 source

라온이 등록한 일정은 읽기 API에서 `source`가 `"laon"`으로 반환됩니다.
**라온은 `source == "laon"`인 일정을 예약 차단 계산에서 제외**해야 자기 예약을 외출로 오인하지 않습니다.

## 4-2. 호출 예시

```bash
# 표준 iCalendar 피드 (회원 토큰)
curl -H "X-Unocum-Token: <회원 토큰>" \
  "https://unocum.kr/api/v1/unocum_schedules.ics?token=<회원 토큰>&from=2026-11-01&to=2026-11-30"

# JSON (회원 개인 링크)
curl "https://unocum.kr/api/v1/unocum_schedules?email=member@example.com&sig=<서명>&from=2026-11-01&to=2026-11-30"
```

### 쓰기 (라온 예약 자동 등록)

```bash
# 등록 (회원 링크의 sig를 함께 보내면 그 회원 일정에만 기록)
curl -X POST https://www.unocum.kr/api/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Unocum-Token: <회원 토큰>" \
  -d '{
    "email": "eou@kakao.com",
    "sig": "<회원 링크의 sig>",
    "source": "laon",
    "source_id": "RES-20261030-0001",
    "title": "[라온카페] 핸드드립 체험 - 홍길동",
    "location": "양수로156번길 4 가동",
    "description": "예약번호 RES-20261030-0001 / 2명",
    "start": "2026-11-10T14:00:00+09:00",
    "end": "2026-11-10T15:30:00+09:00",
    "all_day": false
  }'

# 수정 / 삭제 (sig로 회원 범위 확인)
curl -X PUT "https://www.unocum.kr/api/v1/events/evt_123?sig=<sig>" \
  -H "Content-Type: application/json" -H "X-Unocum-Token: <회원 토큰>" \
  -d '{"title":"[라온카페] 핸드드립 체험 - 홍길동 (변경)"}'

curl -X DELETE "https://www.unocum.kr/api/v1/events/evt_123?sig=<sig>" \
  -H "X-Unocum-Token: <회원 토큰>"
```

## 5. 샵 페이지 삽입 예제 (PHP, JSON 방식)

`.ics` 구독이 불가능한 샵은 아래처럼 JSON을 받아 달력을 그릴 수 있습니다. `$FEED_URL`만 회원이 받은 링크(또는 토큰 방식 URL)로 바꾸면 됩니다.

```php
<?php
// unocum_schedule_calendar.php
$FEED_URL = 'https://unocum.kr/api/v1/unocum_schedules?email=member@example.com&sig=발급받은서명';
// 회원 토큰 방식이면:
// $FEED_URL = 'https://unocum.kr/api/v1/unocum_schedules';
// $SHARED_TOKEN = '발급받은회원토큰';

$month = isset($_GET['m']) && preg_match('/^\d{4}-\d{2}$/', $_GET['m']) ? $_GET['m'] : date('Y-m');
$from  = $month . '-01';
$to    = date('Y-m-t', strtotime($from));

$ch = curl_init($FEED_URL . '&from=' . $from . '&to=' . $to);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_HTTPHEADER => isset($SHARED_TOKEN) ? ['X-Unocum-Token: ' . $SHARED_TOKEN] : [],
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$schedules = [];
if ($code === 200) {
    $json = json_decode($body, true);
    $schedules = $json['schedules'] ?? [];
}

$byDay = [];
foreach ($schedules as $s) {
    $byDay[$s['target_date']][] = $s;
}

$first = strtotime($from);
$days  = (int)date('t', $first);
$startDow = (int)date('w', $first);
?>
<div class="unocum-calendar">
  <div class="nav">
    <a href="?m=<?= date('Y-m', strtotime($month . '-01 -1 month')) ?>">◀</a>
    <strong><?= htmlspecialchars($month) ?></strong>
    <a href="?m=<?= date('Y-m', strtotime($month . '-01 +1 month')) ?>">▶</a>
  </div>
  <table>
    <thead><tr><th>일</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>토</th></tr></thead>
    <tbody>
    <tr>
    <?php for ($i = 0; $i < $startDow; $i++) echo '<td></td>'; ?>
    <?php for ($d = 1; $d <= $days; $d++):
        $date = sprintf('%s-%02d', $month, $d);
        $list = $byDay[$date] ?? [];
    ?>
      <td>
        <div class="day"><?= $d ?></div>
        <?php foreach ($list as $s): ?>
          <div class="event">
            <?php if ($s['is_all_day']): ?>
              <?= htmlspecialchars($s['title']) ?>
            <?php else: ?>
              <?= htmlspecialchars($s['start_time'] . ($s['end_time'] ? '~' . $s['end_time'] : '')) ?>
              <?= htmlspecialchars($s['title']) ?>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </td>
      <?php if ((($startDow + $d) % 7) === 0 && $d !== $days): ?></tr><tr><?php endif; ?>
    <?php endfor; ?>
    </tr>
    </tbody>
  </table>
</div>
```

## 6. 연동 절차

1. 회원이 unocum.kr 일정 화면에서 **일정 공유** 버튼 클릭 → 개인 피드 URL 복사
2. 그 URL을 캘린더 구독에 등록하거나, 샵 관리 화면에 등록
3. 서버 간 연동이면 회원 토큰을 회원별로 보관하고 `X-Unocum-Token` 헤더로 호출

## 7. 보안 주의

- 개인 링크(`sig`)는 해당 회원 일정만 조회 가능하지만, 링크를 아는 사람은 조회할 수 있으니 공개 게시판 등에 노출하지 마세요.
- 회원 토큰은 **서버에서만** 보관하고 브라우저/프론트엔드 코드에 넣지 마세요. 토큰이 유출돼도 **그 회원 일정에만** 영향이 있습니다.
- API는 읽기 전용이며 수정·삭제 기능은 없습니다. unocum의 기존 일정 기능(등록·수정·삭제·경로·숙소)에는 어떤 영향도 주지 않습니다.
