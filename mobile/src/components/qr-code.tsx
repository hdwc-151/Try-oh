import { useMemo } from 'react';
import { View } from 'react-native';
import { toQR } from 'toqr';

/** Mã QR vẽ bằng View (không cần thư viện SVG). Mỗi hàng gộp các ô đen liền nhau để ít View. */
export function QrCode({ value, size, color = '#141A3C', background = '#FFFFFF' }: { value: string; size: number; color?: string; background?: string }) {
  const rows = useMemo(() => {
    const modules = toQR(value, 0); // 0 = mức sửa lỗi M
    const count = Math.round(Math.sqrt(modules.length));
    const result: { start: number; length: number }[][] = [];
    for (let y = 0; y < count; y += 1) {
      const runs: { start: number; length: number }[] = [];
      let x = 0;
      while (x < count) {
        if (modules[y * count + x]) {
          const start = x;
          while (x < count && modules[y * count + x]) x += 1;
          runs.push({ start, length: x - start });
        } else x += 1;
      }
      result.push(runs);
    }
    return { count, rows: result };
  }, [value]);

  const quiet = 2; // viền trắng quanh mã (tính theo ô)
  const cell = size / (rows.count + quiet * 2);
  return <View accessibilityRole="image" accessibilityLabel="Mã QR" style={{ width: size, height: size, backgroundColor: background, padding: cell * quiet }}>
    {rows.rows.map((runs, y) => <View key={y} style={{ height: cell, flexDirection: 'row' }}>
      {runs.map((run) => <View key={run.start} style={{ position: 'absolute', left: run.start * cell, width: run.length * cell + 0.5, height: cell + 0.5, backgroundColor: color }}/>)}
    </View>)}
  </View>;
}
