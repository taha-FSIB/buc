import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Viewer } from '../lib/auth';
import {
  HomeIcon, VaultIcon, GroupsIcon, SouvenirIcon, MoreIcon, BackIcon, LockIcon,
} from './icons';

interface LayoutProps {
  title: string;
  viewer: Viewer | null;
  /** Which bottom tab to highlight. */
  tab?: 'home' | 'vault' | 'groups' | 'book' | 'more';
  /** Renders a "back" affordance so no screen is ever a dead end. */
  back?: { href: string; label: string };
}

const TABS = [
  { key: 'home',   href: '/',         Icon: HomeIcon,     label: 'Home' },
  { key: 'vault',  href: '/vault',    Icon: VaultIcon,    label: 'My Vault' },
  { key: 'groups', href: '/groups',   Icon: GroupsIcon,   label: 'Groups' },
  { key: 'book',   href: '/souvenir', Icon: SouvenirIcon, label: 'Souvenir' },
  { key: 'more',   href: '/more',     Icon: MoreIcon,     label: 'More' },
] as const;

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title, viewer, tab, back, children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · BUC Alumni</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap"
      />
      <link rel="stylesheet" href="/styles.css" />
      <meta name="theme-color" content="#fffbeb" />
    </head>
    <body>
      <a class="skip-link" href="#main">Skip to main content</a>

      <header class="site-header">
        <div class="wrap">
          <a class="brand" href={viewer ? '/' : '/welcome'}>
            BUC Alumni
            <span>Pioneer Batch</span>
          </a>
          {viewer ? (
            <a class="header-link" href="/more">
              {viewer.preferred_name ?? viewer.full_name}
            </a>
          ) : (
            <a class="btn btn-secondary btn-compact" href="/signin">Sign in</a>
          )}
        </div>
      </header>

      <main id="main" class="wrap">
        {back && (
          <a class="back" href={back.href}>
            <BackIcon />
            {back.label}
          </a>
        )}
        {children}
      </main>

      {viewer && (
        <nav class="tabbar" aria-label="Main">
          {TABS.map(({ key, href, Icon, label }) => (
            <a href={href} aria-current={tab === key ? 'page' : undefined}>
              <Icon />
              {label}
            </a>
          ))}
        </nav>
      )}
    </body>
  </html>
);

/**
 * Who can see this post. The padlock on "Only you" means the state is never
 * communicated by colour alone.
 */
export const VisibilityChip: FC<{ kind: 'private' | 'shared' | 'pending' | 'public' }> = ({ kind }) => {
  const text = {
    private: 'Only you',
    shared:  'Shared',
    pending: 'Waiting for approval',
    public:  'Public',
  }[kind];
  return (
    <span class={`chip chip-${kind}`}>
      {kind === 'private' && <LockIcon />}
      {text}
    </span>
  );
};

/** Field-level + announced error. Errors must never be visual-only. */
export const ErrorNotice: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div class="notice notice-error" role="alert">
    <strong>{title}</strong>
    {children}
  </div>
);
