import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
    bin: 'src/bin.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  deps: {
    neverBundle: [
      '@deepseek-ai/schemastery',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-attachment',
      '@deepseek-ai/dsh-invariants',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-llm-pi-ai',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-web',
    ],
  },
})
