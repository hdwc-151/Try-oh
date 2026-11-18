import { useEffect, useState } from 'react';

/** Thời điểm hiện tại, cập nhật mỗi `intervalMs` (cho đồng hồ đếm ngược). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "Còn 2 giờ 15 phút", "Còn 45 giây", "Đã kết thúc". */
export function formatRemaining(expiresAt: number, now: number) {
  const seconds = Math.floor((expiresAt - now) / 1000);
  if (seconds <= 0) return 'Đã kết thúc';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `Còn ${days} ngày ${hours} giờ`;
  if (hours) return `Còn ${hours} giờ ${minutes} phút`;
  if (minutes) return `Còn ${minutes} phút ${seconds % 60} giây`;
  return `Còn ${seconds} giây`;
}
