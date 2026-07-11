import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const engine = spawn(pnpm, ['--filter', '@navet/music-engine', 'start'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NAVET_DATA_PATH: path.join(repoRoot, 'apps/standalone/.cache'),
    NAVET_MUSIC_ENGINE_HOST: '127.0.0.1',
    NAVET_MUSIC_STREAM_BASE_URL:
      'http://navet.local:5200/__navet_music_engine__/stream',
  },
})
const app = spawn(pnpm, ['--filter', '@navet/standalone', 'dev'], { stdio: 'inherit' })

const stop = (signal = 'SIGTERM') => {
  engine.kill(signal)
  app.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal))
}

app.on('exit', (code) => {
  engine.kill('SIGTERM')
  process.exitCode = code ?? 1
})
engine.on('exit', (code) => {
  if (code && app.exitCode === null) {
    app.kill('SIGTERM')
    process.exitCode = code
  }
})
