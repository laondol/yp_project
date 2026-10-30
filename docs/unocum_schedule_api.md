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
| A. 서버 공유토큰 | 라온 서버 | 헤더 `X-Unocum-Token: <공유토큰>` |
| B. 회원 개인 링크 | 회원 샵(개인) | unocum 일정 화면의 **일정 공유** 버튼으로 받은 URL 그대로 사용 (`email`, `sig` 포함) |

> 개인 링크의 `sig`는 회원별 서명값으로, **해당 회원 일정만** 조회할 수 있습니다.

### CORS

두 엔드포인트 모두 브라우저 호출을 지원합니다.

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: X-Unocum-Token, Content-Type`
- `OPTIONS` 사전요청(204) 지원

즉 **서버 간 호출과 브라우저(JS) 호출 모두 가능**합니다. 단, 브라우저 코드에 공유토큰을 넣지 말고 **개인 링크(`sig`) 방식**을 사용하세요.

### 파라미터

| 이름 | 필수 | 설명 |
|---|---|---|
| `email` | 선택 | 조회할 회원 이메일. **기본값 `eou@kakao.com`** |
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

## 4. 호출 예시

```bash
# 표준 iCalendar 피드 (서버 공유토큰)
curl -H "X-Unocum-Token: <공유토큰>" \
  "https://unocum.kr/api/v1/unocum_schedules.ics?email=eou@kakao.com&from=2026-11-01&to=2026-11-30"

# JSON (회원 개인 링크)
curl "https://unocum.kr/api/v1/unocum_schedules?email=member@example.com&sig=<서명>&from=2026-11-01&to=2026-11-30"
```

## 5. 샵 페이지 삽입 예제 (PHP, JSON 방식)

`.ics` 구독이 불가능한 샵은 아래처럼 JSON을 받아 달력을 그릴 수 있습니다. `$FEED_URL`만 회원이 받은 개인 링크(또는 공유토큰 방식 URL)로 바꾸면 됩니다.

```php
<?php
// unocum_schedule_calendar.php
$FEED_URL = 'https://unocum.kr/api/v1/unocum_schedules?email=member@example.com&sig=발급받은서명';
// 공유토큰 방식이면:
// $FEED_URL = 'https://unocum.kr/api/v1/unocum_schedules?email=eou@kakao.com';
// $SHARED_TOKEN = '발급받은공유토큰';

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
3. 서버 간 연동이면 공유토큰을 서버 환경변수/설정에 보관하고 `X-Unocum-Token` 헤더로 호출

## 7. 보안 주의

- 개인 링크(`sig`)는 해당 회원 일정만 조회 가능하지만, 링크를 아는 사람은 조회할 수 있으니 공개 게시판 등에 노출하지 마세요.
- 공유토큰은 **서버에서만** 보관하고 브라우저/프론트엔드 코드에 넣지 마세요.
- API는 읽기 전용이며 수정·삭제 기능은 없습니다. unocum의 기존 일정 기능(등록·수정·삭제·경로·숙소)에는 어떤 영향도 주지 않습니다.
