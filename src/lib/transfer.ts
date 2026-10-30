import { parseBackup, type Backup } from './backup'
import { MAX_PAYLOAD_CHARS, ShareError, unpackFragment } from './share'

/**
 * Transfer links moved a whole library to another device: /transfer#<payload>, payload = packFragment(backup JSON).
 * Creating them was removed (they couldn't hold big libraries; backup files and Drive sync can), but links people
 * already made still open. The fragment never reaches a server.
 */
/** Decompressed cap: a 30k-char link can't legitimately inflate past this. */
const MAX_JSON_BYTES = 4 * 1024 * 1024

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
