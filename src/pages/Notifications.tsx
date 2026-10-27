import { CheckCheck, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertList } from '../components/Alerts'
import { PageHeader } from '../components/cards'
import { markRead, useAlerts, visible } from '../lib/alerts'

export function NotificationsPage() {
  const unread = visible(useAlerts().items).filter((a) => !a.read).length
  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle={unread ? `${unread} unread` : 'New seasons, release dates and episodes for your shows'}
        action={
          <div className="flex gap-2">
            <Link to="/settings#alerts" className="btn-ghost">
              <Settings className="size-4" aria-hidden /> Preferences
            </Link>
            <button type="button" className="btn-secondary" disabled={!unread} onClick={() => void markRead('all').catch(() => toast.error("Couldn't update alerts."))}>
              <CheckCheck className="size-4" aria-hidden /> Mark all read
            </button>
          </div>
        }
      />
      <div className="card p-2 sm:p-3">
        <AlertList />
      </div>
    </div>
  )
}
