import { createBackup, parseBackup, type Backup } from './backup'
import { MAX_PAYLOAD_CHARS, packFragment, ShareError, unpackFragment } from './share'

/**
 * Transfer links move a whole library to another device: /transfer#<payload>, payload = packFragment(backup JSON).
 * Same format as a backup file minus uploaded images (too big for a link). Unlike share links they include notes and
 * history, so they're meant to be sent only to yourself. The fragment never reaches a server.
 */
export const TRANSFER_PATH = '/transfer'
/** Decompressed cap: a 30k-char link can't legitimately inflate past this. */
const MAX_JSON_BYTES = 4 * 1024 * 1024
/** Roughly what one QR code holds as a URL (version 40, low error correction, 2,953 bytes) after the origin and path. */
export const MAX_QR_PAYLOAD = 2_800

export async function encodeTransfer(backup?: Backup): Promise<string> {
  const b = backup ?? (await createBackup())
  const encoded = await packFragment(JSON.stringify({ ...b, images: [] }))
  if (encoded.length > MAX_PAYLOAD_CHARS) throw new ShareError('Your library is too big for a link. Use Google Drive sync to move it instead.')
  return encoded
}

export const transferUrl = (payload: string, origin = window.location.origin) => `${origin}${TRANSFER_PATH}#${payload}`

/** Untrusted input: validated exactly like an imported backup file. */
export async function decodeTransfer(fragment: string): Promise<Backup> {
  if (!fragment.replace(/^#/, '').trim()) throw new ShareError('This link has no library attached.')
  const json = await unpackFragment(fragment, MAX_PAYLOAD_CHARS, MAX_JSON_BYTES, 'This library is too large to open.')
  try {
    return parseBackup(json)
  } catch (err) {
    throw new ShareError(err instanceof Error ? err.message : 'The link is damaged or incomplete.')
  }
}
