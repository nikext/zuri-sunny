// Runtime gzip/brotli compression for dynamic Nitro responses.
//
// Why: `compressPublicAssets` only precompresses static files at build time —
// the SSR HTML and the heavy server-function JSON (buildings ~10 MB, POIs
// hundreds of KB) ship uncompressed otherwise. Railway's edge proxy doesn't
// auto-gzip in front of the app (verified with curl), so we do it ourselves.
//
// We wrap `nitro.fetch` (the outermost handler) so the compression sits on
// top of every response: SSR HTML, server-function payloads, anything else.
// The Web Fetch Response body is immutable, so we build a new Response whose
// body is the original stream piped through `node:zlib`.
//
// Skipped: responses that are already encoded, non-text content (images,
// fonts, video — already compressed at the codec level), and SSE streams
// (need to flush per-message, not worth the complexity here).

import { definePlugin } from 'nitro'
import { Readable } from 'node:stream'
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'node:zlib'

const COMPRESSIBLE_TYPE_MARKERS: ReadonlyArray<string> = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/xhtml+xml',
  'application/x-tss-framed', // TanStack Start RPC framed protocol
  'application/x-ndjson',
  'image/svg+xml',
]

const SKIP_TYPE_MARKERS: ReadonlyArray<string> = [
  'text/event-stream', // SSE — would buffer until close
]

function isCompressibleContentType(ct: string): boolean {
  const lower = ct.toLowerCase()
  if (SKIP_TYPE_MARKERS.some((t) => lower.includes(t))) return false
  return COMPRESSIBLE_TYPE_MARKERS.some((t) => lower.includes(t))
}

function pickEncoding(acceptEncoding: string): 'br' | 'gzip' | null {
  // Prefer brotli when available — typically 15–25 % smaller than gzip on
  // JSON/HTML at comparable CPU cost when quality is dialed down.
  if (acceptEncoding.includes('br')) return 'br'
  if (acceptEncoding.includes('gzip')) return 'gzip'
  return null
}

export default definePlugin((nitro) => {
  const original = nitro.fetch
  nitro.fetch = async (req: Request) => {
    const res: Response = await original(req)

    if (res.headers.get('content-encoding')) return res
    if (!res.body) return res
    if (res.status === 204 || res.status === 304) return res

    const contentType = res.headers.get('content-type') ?? ''
    if (!isCompressibleContentType(contentType)) return res

    const acceptEncoding = req.headers.get('accept-encoding') ?? ''
    const encoding = pickEncoding(acceptEncoding)
    if (!encoding) return res

    const transform =
      encoding === 'br'
        ? createBrotliCompress({
            // Quality 4 is roughly gzip-6 speed with ~10 % better ratio on
            // text. Default brotli quality is 11 — far too slow for a per-
            // request transform.
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
          })
        : createGzip({ level: 6 })

    const nodeIn = Readable.fromWeb(res.body as never)
    nodeIn.on('error', (err) => transform.destroy(err))
    const compressedNode = nodeIn.pipe(transform)
    const compressedWeb = Readable.toWeb(compressedNode) as unknown as ReadableStream<Uint8Array>

    const headers = new Headers(res.headers)
    headers.set('content-encoding', encoding)
    // Body length changes; let the runtime stream chunked.
    headers.delete('content-length')
    const existingVary = headers.get('vary')
    if (!existingVary) {
      headers.set('vary', 'Accept-Encoding')
    } else if (!/(^|,\s*)accept-encoding(\s*,|$)/i.test(existingVary)) {
      headers.set('vary', `${existingVary}, Accept-Encoding`)
    }

    return new Response(compressedWeb, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }
})
