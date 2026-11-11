import { rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const projectRoot = process.cwd()
const generatedPaths = [
  'dist',
  'dist-server',
  'tsconfig.app.tsbuildinfo',
  'tsconfig.node.tsbuildinfo',
  'tsconfig.server.tsbuildinfo',
]

for (const generatedPath of generatedPaths) {
  const absolutePath = resolve(projectRoot, generatedPath)
  const relativePath = relative(projectRoot, absolutePath)

  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Từ chối xóa đường dẫn ngoài project: ${absolutePath}`)
  }

  rmSync(absolutePath, { recursive: true, force: true })
}
