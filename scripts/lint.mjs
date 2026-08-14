import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const failures = []

if (packageJson.name !== 'dsh-codex-connect') failures.push('package name must be dsh-codex-connect')
if (packageJson.version !== '0.1.0-alpha.2.1') failures.push('package version must be 0.1.0-alpha.2.1')
if (packageJson.displayName !== 'Codex Connect for dsh') failures.push('displayName mismatch')
if (packageJson.description !== 'ChatGPT OAuth and Codex models for DeepSeek Harness.') failures.push('description mismatch')

const productFiles = [
  'package.json',
  'README.md',
  'README.zh.md',
  'INSTALL.md',
  'MIGRATION.md',
  'docs/design.md',
  'docs/design.zh.md',
]
const forbiddenProductTerms = [`${'conserv'}ative`, `${'unoff'}icial`]
for (const filename of productFiles) {
  const text = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8')
  if (forbiddenProductTerms.some(term => text.toLowerCase().includes(term))) failures.push(`${filename} contains a forbidden product-description term`)
  if (/BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|refresh_token\s*[=:]\s*[^\s"']+/u.test(text)) {
    failures.push(`${filename} appears to contain secret material`)
  }
}

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const fullDescription = 'Connect your ChatGPT subscription to DeepSeek Harness with OAuth, user-controlled defaults, Harness-native approvals, diagnostics, and reliable session recovery.'
if (!readme.startsWith(`# Codex Connect for dsh\n\nEnglish | [中文](README.zh.md)\n\n${fullDescription}\n`)) {
  failures.push('README opening description mismatch')
}

const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
if (/^- id: agent-default-model/mu.test(patch) || /searchProvider:\s*openai-codex/u.test(patch)) {
  failures.push('bundle patch must not take over Harness routing')
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`lint: ${failure}\n`)
  process.exitCode = 1
}
