// Runtime instrumentation: wrap globalThis.fetch to log every outbound URL
// with a short stack trace. Used via `node --require ./scripts/debug-fetch.cjs`.
// Remove this from the start command once the rogue fetcher is identified.

const origFetch = globalThis.fetch
if (typeof origFetch !== 'function') {
  console.error('[debug-fetch] no global fetch available; skipping')
  return
}

let counter = 0

globalThis.fetch = function patchedFetch(input, init) {
  const id = ++counter
  const url =
    typeof input === 'string'
      ? input
      : input && typeof input.url === 'string'
        ? input.url
        : input && typeof input.href === 'string'
          ? input.href
          : '<unknown>'
  const method = (init && init.method) || (input && input.method) || 'GET'
  // Capture an Error here to get a clean stack to the call site.
  const stack = new Error().stack || ''
  const lines = stack.split('\n').slice(2, 14).join('\n')
  console.log(`[debug-fetch #${id}] ${method} ${url}\n${lines}`)
  return origFetch.call(this, input, init).then(
    (res) => {
      console.log(`[debug-fetch #${id}] <- ${res.status} ${url}`)
      return res
    },
    (err) => {
      console.log(`[debug-fetch #${id}] !! ${err && err.message} ${url}`)
      throw err
    },
  )
}

console.log('[debug-fetch] global fetch wrapper installed')
