/**
 * In-browser tarball extraction: gzip decode via the native `DecompressionStream`
 * plus a small dependency-free tar parser.
 *
 * Handles the variants npm tarballs actually use: ustar regular files, the
 * `prefix` field for long paths, PAX extended headers (`x`) and GNU long names
 * (`L`). Directories and other entry types are skipped.
 */
import { checkAborted } from '@/lib/check-aborted'

export interface TarEntry {
  name: string
  bytes: Uint8Array
}

/** Gunzip an npm `.tgz` payload using the platform `DecompressionStream`. */
export async function gunzip (input: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const body = input instanceof Uint8Array ? input : new Uint8Array(input)
  // Copy to a plain ArrayBuffer view — recent TS lib types reject the generic
  // `Uint8Array<ArrayBufferLike>` as a BlobPart (SharedArrayBuffer concern).
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  const stream = new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))
  const out = await new Response(stream).arrayBuffer()
  return new Uint8Array(out)
}

const BLOCK = 512

function readString (buf: Uint8Array, offset: number, length: number): string {
  let end = offset
  const limit = offset + length
  while (end < limit && buf[end] !== 0) {
    end++
  }
  return new TextDecoder().decode(buf.subarray(offset, end))
}

function readOctal (buf: Uint8Array, offset: number, length: number): number {
  const str = readString(buf, offset, length).trim()
  return str ? Number.parseInt(str, 8) : 0
}

/** Parse a `path=` (or other key) record out of a PAX extended header block. */
function parsePax (data: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(data)
  const records: Record<string, string> = {}
  let i = 0
  while (i < text.length) {
    const space = text.indexOf(' ', i)
    if (space === -1) {
      break
    }
    const len = Number.parseInt(text.slice(i, space), 10)
    if (!Number.isFinite(len) || len <= 0) {
      break
    }
    const record = text.slice(space + 1, i + len - 1) // drop trailing newline
    const eq = record.indexOf('=')
    if (eq !== -1) {
      records[record.slice(0, eq)] = record.slice(eq + 1)
    }
    i += len
  }
  return records
}

export async function untar (buf: Uint8Array, abortController: AbortController): Promise<TarEntry[]> {
  const entries: TarEntry[] = []
  let offset = 0
  let nextNameOverride: string | null = null

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK)

    // Two consecutive zero blocks mark the end of the archive.
    if (header.every(b => b === 0)) {
      break
    }

    const size = readOctal(buf, offset + 124, 12)
    const typeflag = String.fromCodePoint(buf[offset + 156] || 0x30)
    const dataStart = offset + BLOCK
    const data = buf.subarray(dataStart, dataStart + size)
    const padded = Math.ceil(size / BLOCK) * BLOCK

    if (typeflag === 'x' || typeflag === 'g') {
      // PAX header: applies to the *next* entry (global headers are coarse but
      // we treat them the same for the simple path use-case).
      const pax = parsePax(data)
      if (pax.path) {
        nextNameOverride = pax.path
      }
      offset = dataStart + padded
      continue
    }

    if (typeflag === 'L') {
      // GNU long name: the data block is the next entry's name.
      nextNameOverride = readString(buf, dataStart, size)
      offset = dataStart + padded
      continue
    }

    const overridden = nextNameOverride !== null
    let name = nextNameOverride ?? readString(buf, offset, 100)
    nextNameOverride = null

    if (!name) {
      offset = dataStart + padded
      continue
    }

    // ustar `prefix` field extends names longer than 100 bytes — but only when
    // the name came from the header itself (PAX/GNU overrides are already full).
    if (!overridden) {
      const prefix = readString(buf, offset + 345, 155)
      if (prefix) {
        name = `${prefix}/${name}`
      }
    }

    // Only keep regular files ('0' or NUL typeflag).
    if (typeflag === '0' || typeflag === '\0') {
      entries.push({ name, bytes: data.slice() })
    }

    offset = dataStart + padded
  }

  return entries
}
