import { useState } from 'react';

/**
 * Trạng thái cho tấm trượt hiển thị một mục: `hide()` cho tấm trượt chạy hiệu ứng đóng
 * trong khi vẫn giữ nội dung, `clear()` (gọi từ `onClosed`) mới bỏ mục đi.
 */
export function useSheetItem<T>() {
  const [item, setItem] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  return {
    item,
    visible: open && item !== null,
    show: (next: T) => { setItem(next); setOpen(true); },
    hide: () => setOpen(false),
    clear: () => { setOpen(false); setItem(null); },
  };
}
