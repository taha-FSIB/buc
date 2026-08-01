import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Viewer } from '../lib/auth';

interface LayoutProps {
  title: string;
  viewer: Viewer | null;
  /** Which bottom tab to highlight. */
  tab?: 'home' | 'vault' | 'groups' | 'book' | 'more';
  /** Renders a "back" affordance so no screen is ever a dead end. */
  back?: { href: string; label: string };
}

const TABS = [
  { key: 'home',   href: '/',          glyph: '⌂', label: 'Home' },
  { key: 'vault',  href: '/vault',     glyph: '⛁', label: 'My Vault' },
  { key: 'groups', href: '/groups',    glyph: '☺', label: 'Groups' },
  { key: 'book',   href: '/souvenir',  glyph: '☷', label: 'Souvenir' },
  { key: 'more',   href: '/more',      glyph: '≡', label: 'More' },
] as const;

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title, viewer, tab, back, children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · BUC Alumni</title>
      <link rel="stylesheet" href="/styles.css" />
      <meta name="theme-color" content="#fbf7f0" />
    </head>
    <body>
      <header class="site-header">
        <div class="wrap">
          <a class="brand" href={viewer ? '/' : '/welcome'}>
            BUC Alumni
            <span>Pioneer Batch</span>
          </a>
          {viewer ? (
            <a class="back" href="/more">
              {viewer.preferred_name ?? viewer.full_name}
            </a>
          ) : (
            <a class="btn btn-secondary" href="/signin">Sign in</a>
          )}
        </div>
      </header>

      <main class="wrap">
        {back && (
          <a class="back" href={back.href}>
            {'←'} {back.label}
          </a>
        )}
        {children}
      </main>

      {viewer && (
        <nav class="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <a
              href={t.href}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              <span class="glyph" aria-hidden="true">{t.glyph}</span>
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </body>
  </html>
);

/** Small labelled chip describing who can see a post. */
export const VisibilityChip: FC<{ kind: 'private' | 'shared' | 'pending' | 'public' }> = ({ kind }) => {
  const text = {
    private: 'Only you',
    shared:  'Shared',
    pending: 'Waiting for approval',
    public:  'Public',
  }[kind];
  return <span class={`chip chip-${kind}`}>{text}</span>;
};
