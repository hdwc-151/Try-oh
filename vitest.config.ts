import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, 'dist-server/**'],
    // Mỗi file test PostgreSQL dựng một PGlite riêng (vài trăm MB). Chạy quá nhiều file
    // cùng lúc làm máy hết RAM (nhất là Windows), nên giới hạn số worker.
    maxWorkers: 3,
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          setupFiles: './src/test/setup.ts',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
        },
      },
    ],
  },
})
