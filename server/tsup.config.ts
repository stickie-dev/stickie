import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  noExternal: ['@stickie/shared'],
  clean: true,
})
