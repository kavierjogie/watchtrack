import { AnimatePresence } from 'framer-motion'
import { LinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { EmptyState, PageHeader, PosterGridSkeleton } from '../components/cards'
import { planImport, type ImportPlan } from '../lib/backup'
import { decodeTransfer } from '../lib/transfer'
import { useLibrary } from '../state/library'
import { ImportDialog } from './Settings'

/** Opens a transfer link (/transfer#…) in the same import dialog a backup file uses: preview, then merge or replace. */
export function TransferPage() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const { loading, titles } = useLibrary()
  const [state, setState] = useState<{ plan: ImportPlan } | { error: string } | null>(null)

  useEffect(() => {
    if (loading) return
    let alive = true
    decodeTransfer(hash).then(
      (backup) => alive && setState({ plan: planImport(backup, titles) }),
      (err: unknown) => alive && setState({ error: err instanceof Error ? err.message : 'The link could not be read.' }),
    )
    return () => {
      alive = false
    }
    // Planned once per link, against the library as it was when opened: the import's own writes mustn't re-plan it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, loading])

  return (
    <div className="space-y-6">
      <PageHeader title="Move library to this device" />
      {!state ? (
        <PosterGridSkeleton count={4} />
      ) : 'error' in state ? (
        <EmptyState
          icon={LinkIcon}
          title="This link can't be opened"
          body={
            <>
              <p>{state.error}</p>
              <p className="mt-2">It was probably cut off when it was copied or sent. On your other device, export a backup file in Settings or turn on Google Drive sync instead.</p>
            </>
          }
          action={
            <Link to="/" className="btn-secondary">
              Go to WatchTrack
            </Link>
          }
        />
      ) : (
        <AnimatePresence>
          <ImportDialog plan={state.plan} onClose={() => navigate('/', { replace: true })} />
        </AnimatePresence>
      )}
    </div>
  )
}
