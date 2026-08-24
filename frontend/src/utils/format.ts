export function formatKST(value?: string | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const hasTz = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(value.trim());
  const base: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  const o = { ...base, ...(opts || {}) };
  if (hasTz) {
    return d.toLocaleString('ko-KR', { ...o, timeZone: 'Asia/Seoul' });
  }
  // tz 표시가 없는 값은 서버가 KST(naive 벽시계)로 저장하므로 KST로 해석
  const dKst = new Date(value + '+09:00');
  if (!isNaN(dKst.getTime())) {
    return dKst.toLocaleString('ko-KR', { ...o, timeZone: 'Asia/Seoul' });
  }
  return d.toLocaleString('ko-KR', o);
}
