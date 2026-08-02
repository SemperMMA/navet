import { spawn } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const appCliArgs = process.argv.slice(2)
if (appCliArgs[0] === '--') appCliArgs.shift()

const engine = spawn(pnpm, ['--filter', '@navet/music-engine', 'start'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NAVET_MUSIC_ENGINE_HOST: '127.0.0.1',
  },
})
const app = spawn(pnpm, ['--filter', '@navet/standalone', 'dev', ...appCliArgs], {
  stdio: 'inherit',
})

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
