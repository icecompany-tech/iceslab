import { useQueryClient } from '@tanstack/react-query'
import { useState, type MouseEvent } from 'react'
import { matchPath, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ROUTES, SERVED_NAV } from '@/app/contours'
import { GROUP_NAV, MAIN_NAV, type NavGroup, type NavItem } from '@/app/nav'
import styles from '@/app/shell/Sidebar.module.css'
import { signOutOnServer, useSession } from '@/lib/auth/session'
import { nodeHealth, useOverview } from '@/lib/domain/overview'
import { useDict, useLocale } from '@/lib/i18n'
import { guardedLeave, leaveGuarded } from '@/lib/leaveGuard'
import { Icon } from '@/ui/Icon/Icon'

const DICT = {
  ru: { logout: 'Выйти', problems: 'Нод с проблемами' },
  en: { logout: 'Sign out', problems: 'Nodes with problems' },
}

const oldPanel = import.meta.env.VITE_OLD_PANEL_URL

/** Where a menu item goes, or null: an item with nowhere to go is not shown (F-V1). */
function hrefOf(item: NavItem): { to: string } | { href: string } | null {
  if (SERVED_NAV.has(item.id)) return { to: item.path }
  if (item.external) return { href: item.external }
  if (oldPanel) return { href: `${oldPanel}${item.path}` }
  return null
}

/** F-29: a screen that holds the way out gets the leave instead of the link. */
function holdIfGuarded(event: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (!leaveGuarded()) return
  event.preventDefault()
  guardedLeave(go)
}

function Item({ item, badge }: { item: NavItem; badge?: number }) {
  const { locale } = useLocale()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // An address outside the item's own path can light it up too: /cascades lights «Ноды».
  const lit = ROUTES.some((r) => r.nav === item.id && matchPath(r.path, pathname) !== null)
  const target = hrefOf(item)
  if (!target) return null
  const body = (
    <>
      <Icon name={item.icon} size="xl" />
      <span className={styles.label}>{item.title[locale]}</span>
      {badge !== undefined && badge > 0 && <span className={styles.badge}>{badge}</span>}
    </>
  )
  if ('href' in target) {
    return (
      <a className={styles.item} href={target.href} onClick={(e) => holdIfGuarded(e, () => window.location.assign(target.href))}>
        {body}
      </a>
    )
  }
  return (
    <NavLink end={target.to === '/'} to={target.to} onClick={(e) => holdIfGuarded(e, () => void navigate(target.to))} className={({ isActive }) => `${styles.item} ${isActive || lit ? styles.active : ''}`}>
      {body}
    </NavLink>
  )
}

function Group({ group }: { group: NavGroup }) {
  const { locale } = useLocale()
  const { pathname } = useLocation()
  const here = group.items.some((i) => pathname.startsWith(i.path))
  const [open, setOpen] = useState(here)
  if (!group.items.some(hrefOf)) return null
  const shown = open || here
  return (
    <div className={styles.group}>
      <button type="button" className={`${styles.groupHead} ${shown ? styles.groupOpen : ''}`} aria-expanded={shown} onClick={() => setOpen(!shown)}>
        {group.title[locale]}
        {shown ? (
          <Icon name="chevronDown" size="md" />
        ) : (
          <span className={styles.chevronQuiet}>
            <Icon name="chevronRight" size="md" />
          </span>
        )}
      </button>
      {shown && group.items.map((item) => <Item key={item.id} item={item} />)}
    </div>
  )
}

export function Sidebar() {
  const session = useSession()
  const overview = useOverview()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const words = useDict(DICT)
  // Without an answer no number is drawn: not "0 problems" (F-K1).
  const problems = overview.data?.nodes.filter((n) => nodeHealth(n.status) === 'problem').length

  const logout = async () => {
    const confirmed = await signOutOnServer()
    queryClient.clear()
    await navigate('/login', { state: confirmed ? null : { notice: 'logoutUnconfirmed' } })
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.main}>
        {MAIN_NAV.map((item) => (
          <Item key={item.id} item={item} badge={item.id === 'nodes' ? problems : undefined} />
        ))}
      </div>
      <div className={styles.groups}>
        {GROUP_NAV.map((group) => (
          <Group key={group.id} group={group} />
        ))}
      </div>
      <div className={styles.account}>
        <NavLink to="/account" onClick={(e) => holdIfGuarded(e, () => void navigate('/account'))} className={({ isActive }) => `${styles.admin} ${isActive ? styles.adminHere : ''}`}>
          {session.data?.username}
        </NavLink>
        <button type="button" className={styles.logout} aria-label={words.logout} onClick={() => guardedLeave(() => void logout())}>
          <Icon name="logout" />
        </button>
      </div>
    </nav>
  )
}
