import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, House, ListMusic, MessageSquareMore, PlusCircle, Settings, Sliders, Tv } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'

type SideNavigationProps = {
  collapsed: boolean
  onToggleCollapsed: () => void
  currentPath: string
  isMobile: boolean
}

type NavigationItem = {
  label: string
  to: string
  icon: LucideIcon
  match: (path: string) => boolean
}

type NavigationGroup = {
  label: string
  icon: LucideIcon
  groupMatch: (path: string) => boolean
  children: NavigationItem[]
}

type NavEntry = NavigationItem | NavigationGroup

function isGroup(entry: NavEntry): entry is NavigationGroup {
  return 'children' in entry
}

const NAV_ITEMS: NavEntry[] = [
  {
    label: 'Home',
    to: '/',
    icon: House,
    match: (path) => path === '/',
  },
  {
    label: 'Requests',
    to: '/audience',
    icon: MessageSquareMore,
    match: (path) => path.startsWith('/audience'),
  },
  {
    label: 'Gigs',
    icon: CalendarDays,
    groupMatch: (path) => path.startsWith('/admin/gig') || path.startsWith('/admin/create-gig'),
    children: [
      {
        label: 'Gig List',
        to: '/admin/gigs',
        icon: CalendarDays,
        match: (path) => path === '/admin/gigs',
      },
      {
        label: 'Gig Control',
        to: '/admin/gig-control',
        icon: ListMusic,
        match: (path) => path.startsWith('/admin/gig-control'),
      },
      {
        label: 'Gig Settings',
        to: '/admin/gig-settings',
        icon: Sliders,
        match: (path) => path.startsWith('/admin/gig-settings'),
      },
      {
        label: 'Create Gig',
        to: '/admin/create-gig',
        icon: PlusCircle,
        match: (path) => path.startsWith('/admin/create-gig'),
      },
    ],
  },
  {
    label: 'Mirror',
    to: '/mirror',
    icon: Tv,
    match: (path) => path.startsWith('/mirror'),
  },
  {
    label: 'Settings',
    to: '/admin/settings',
    icon: Settings,
    match: (path) => path.startsWith('/admin/settings'),
  },
]

function SideNavigation({ collapsed, onToggleCollapsed, currentPath, isMobile }: SideNavigationProps) {
  const { user, isHost, loading, signInHost, signOut } = useAuthStore()
  const [hostEmail, setHostEmail] = useState('')
  const [hostPassword, setHostPassword] = useState('')
  const [authBusy, setAuthBusy] = useState<null | 'signin' | 'signout'>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [gigsOpen, setGigsOpen] = useState(() =>
    NAV_ITEMS.some((e) => isGroup(e) && e.groupMatch(currentPath))
  )

  const handleHostSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (authBusy) {
      return
    }

    setAuthError(null)
    setAuthBusy('signin')

    try {
      await signInHost(hostEmail, hostPassword)
      setHostPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign in failed. Please try again.')
    } finally {
      setAuthBusy(null)
    }
  }

  const handleSignOut = async () => {
    if (authBusy) {
      return
    }

    setAuthError(null)
    setAuthBusy('signout')

    try {
      await signOut()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign out failed. Please try again.')
    } finally {
      setAuthBusy(null)
    }
  }

  return (
    <aside
      className={[
        'border-r border-cyan-400/20 bg-[#0A0A0A] transition-all duration-200',
        isMobile
          ? `fixed inset-y-0 left-0 z-50 h-dvh w-[240px] transform shadow-2xl ${collapsed ? '-translate-x-full' : 'translate-x-0'}`
          : `sticky left-0 top-0 z-40 h-screen shrink-0 ${collapsed ? 'w-[80px]' : 'w-[240px]'}`,
      ].join(' ')}
      aria-label="Application navigation"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-center px-3">
          <img
            src="/the-human-jukebox-logo.svg"
            alt="The Human Jukebox"
            className="h-9 w-9 rounded-md object-contain"
          />
        </div>

        <nav className="flex-1 px-2 py-3" aria-label="Primary">
          <ul className="space-y-1">
            {NAV_ITEMS.map((entry) => {
              if (isGroup(entry)) {
                const groupActive = entry.groupMatch(currentPath)
                const isOpen = gigsOpen || collapsed
                return (
                  <li key={entry.label}>
                    <button
                      type="button"
                      onClick={() => { if (!collapsed) setGigsOpen((o) => !o) }}
                      title={collapsed ? entry.label : undefined}
                      className={[
                        'group flex h-12 w-full items-center rounded-xl px-3 text-sm font-medium transition-all duration-200',
                        'hover:shadow-[0_0_18px_rgba(255,0,255,0.25)]',
                        collapsed ? 'justify-center' : 'justify-between',
                        groupActive
                          ? 'bg-cyan-400/10 text-[#00E5FF] ring-1 ring-cyan-300/40'
                          : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-cyan-100',
                      ].join(' ')}
                    >
                      <span className={['flex items-center', collapsed ? '' : 'gap-3'].join(' ')}>
                        <entry.icon size={20} className="shrink-0" aria-hidden="true" />
                        {!collapsed ? <span>{entry.label}</span> : null}
                      </span>
                      {!collapsed ? (
                        <ChevronDown
                          size={14}
                          className={['transition-transform duration-200', isOpen ? 'rotate-180' : ''].join(' ')}
                        />
                      ) : null}
                    </button>
                    {(isOpen || collapsed) ? (
                      <ul className={['space-y-1', collapsed ? '' : 'ml-3 mt-1 border-l border-cyan-400/15 pl-2'].join(' ')}>
                        {entry.children.map((child) => {
                          const ChildIcon = child.icon
                          const childActive = child.match(currentPath)
                          return (
                            <li key={child.label}>
                              <NavLink
                                to={child.to}
                                title={collapsed ? child.label : undefined}
                                className={[
                                  'group flex h-10 items-center rounded-xl px-3 text-xs font-medium transition-all duration-200',
                                  'hover:shadow-[0_0_18px_rgba(255,0,255,0.25)]',
                                  collapsed ? 'justify-center' : 'justify-start gap-3',
                                  childActive
                                    ? 'bg-cyan-400/10 text-[#00E5FF] ring-1 ring-cyan-300/40'
                                    : 'text-zinc-400 hover:bg-zinc-900/80 hover:text-cyan-100',
                                ].join(' ')}
                              >
                                <ChildIcon size={16} className="shrink-0" aria-hidden="true" />
                                {!collapsed ? <span>{child.label}</span> : null}
                              </NavLink>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </li>
                )
              }

              const Icon = entry.icon
              const isActive = entry.match(currentPath)

              return (
                <li key={entry.label}>
                  <NavLink
                    to={entry.to}
                    title={collapsed ? entry.label : undefined}
                    className={[
                      'group flex h-12 items-center rounded-xl px-3 text-sm font-medium transition-all duration-200',
                      'hover:shadow-[0_0_18px_rgba(255,0,255,0.25)]',
                      collapsed ? 'justify-center' : 'justify-start gap-3',
                      isActive
                        ? 'bg-cyan-400/10 text-[#00E5FF] ring-1 ring-cyan-300/40'
                        : 'text-zinc-300 hover:bg-zinc-900/80 hover:text-cyan-100',
                    ].join(' ')}
                  >
                    <Icon size={20} className="shrink-0" aria-hidden="true" />
                    {!collapsed ? <span>{entry.label}</span> : null}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-cyan-400/20 p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={[
              'flex h-12 w-full items-center rounded-xl px-3 text-zinc-200 transition-all duration-200',
              'hover:bg-zinc-900 hover:text-cyan-100 hover:shadow-[0_0_18px_rgba(255,0,255,0.25)]',
              collapsed ? 'justify-center' : 'justify-between',
            ].join(' ')}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {!collapsed ? <span className="text-sm font-medium">Collapse</span> : null}
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>

          {!collapsed ? (
            <div className="mt-2 rounded-xl border border-cyan-400/20 bg-zinc-950/70 p-3">
              {loading ? (
                <p className="text-xs text-zinc-400">Checking session...</p>
              ) : user ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-300">Session: {isHost ? 'Admin' : 'User'}</p>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={Boolean(authBusy)}
                    className="h-9 w-full rounded-lg border border-cyan-400/30 bg-zinc-900 text-xs font-semibold text-cyan-100 transition-all duration-200 hover:shadow-[0_0_14px_rgba(255,0,255,0.25)] disabled:opacity-60"
                  >
                    {authBusy === 'signout' ? 'Signing out...' : 'Sign Out'}
                  </button>
                </div>
              ) : (
                <form className="space-y-2" onSubmit={handleHostSignIn}>
                  <p className="text-xs text-zinc-300">Admin login</p>
                  <input
                    type="email"
                    value={hostEmail}
                    onChange={(event) => setHostEmail(event.target.value)}
                    required
                    placeholder="Host email"
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none transition-all duration-200 focus:border-cyan-300"
                  />
                  <input
                    type="password"
                    value={hostPassword}
                    onChange={(event) => setHostPassword(event.target.value)}
                    required
                    placeholder="Password"
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none transition-all duration-200 focus:border-cyan-300"
                  />
                  <button
                    type="submit"
                    disabled={Boolean(authBusy)}
                    className="h-9 w-full rounded-lg border border-cyan-400/35 bg-cyan-500/10 text-xs font-semibold text-cyan-200 transition-all duration-200 hover:shadow-[0_0_14px_rgba(255,0,255,0.25)] disabled:opacity-60"
                  >
                    {authBusy === 'signin' ? 'Signing in...' : 'Sign in to admin'}
                  </button>
                </form>
              )}

              {authError ? <p className="mt-2 text-xs text-rose-300">{authError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

export default SideNavigation
