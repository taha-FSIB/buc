import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Viewer } from '../lib/auth';
import {
  HomeIcon, VaultIcon, GroupsIcon, SouvenirIcon, MoreIcon, BackIcon, LockIcon,
  PenIcon, CalendarIcon, MailIcon,
} from './icons';

interface LayoutProps {
  title: string;
  viewer: Viewer | null;
  /** Which bottom tab to highlight. */
  tab?: 'home' | 'vault' | 'groups' | 'book' | 'more';
  /**
   * Which public tab to highlight. Set on the five pages a visitor can reach
   * without signing in; ignored once somebody is signed in, because then the
   * member navigation is the useful one.
   */
  publicTab?: 'home' | 'story' | 'stories' | 'reunion' | 'contact';
  /** Renders a "back" affordance so no screen is ever a dead end. */
  back?: { href: string; label: string };
  /** Description for search engines and for a link pasted into WhatsApp. */
  description?: string;
}

const TABS = [
  { key: 'home',   href: '/',         Icon: HomeIcon,     label: 'Home' },
  { key: 'vault',  href: '/vault',    Icon: VaultIcon,    label: 'My Vault' },
  { key: 'groups', href: '/groups',   Icon: GroupsIcon,   label: 'Groups' },
  { key: 'book',   href: '/souvenir', Icon: SouvenirIcon, label: 'Souvenir' },
  { key: 'more',   href: '/more',     Icon: MoreIcon,     label: 'More' },
] as const;

/** The same five-item ceiling as the member bar, for the same reason. */
const PUBLIC_TABS = [
  { key: 'home',    href: '/',           Icon: HomeIcon,     label: 'Home' },
  { key: 'story',   href: '/our-story',  Icon: SouvenirIcon, label: 'Our Story' },
  { key: 'stories', href: '/stories',    Icon: PenIcon,      label: 'Memories' },
  { key: 'reunion', href: '/reunion',    Icon: CalendarIcon, label: 'Reunion' },
  { key: 'contact', href: '/contact',    Icon: MailIcon,     label: 'Contact' },
] as const;

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title, viewer, tab, publicTab, back, description, children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · BUC Alumni</title>
      {description && <meta name="description" content={description} />}
      {description && <meta property="og:description" content={description} />}
      <meta property="og:title" content={`${title} · BUC Alumni`} />
      <meta property="og:type" content="website" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      {/*
        Atkinson Hyperlegible carries no Tamil or Sinhala glyphs, so a
        transcript in either would fall back to whatever the phone happens to
        have — which on a good number of older Android handsets is a row of
        empty boxes. Noto covers both. The stylesheet declares unicode-range
        per family, so a page with no Tamil or Sinhala on it downloads neither
        font file; the cost of carrying them is one stylesheet request.
      */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Sinhala:wght@400;700&display=swap"
      />
      <link rel="stylesheet" href="/styles.css" />
      <meta name="theme-color" content="#fffbeb" />
    </head>
    <body>
      <a class="skip-link" href="#main">Skip to main content</a>

      <header class="site-header">
        <div class="wrap">
          {/* Always the root: signed in that is the member feed, signed out it
              is the public home. Either way it is "the start". */}
          <a class="brand" href="/">
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

      {viewer ? (
        <nav class="tabbar" aria-label="Main">
          {TABS.map(({ key, href, Icon, label }) => (
            <a href={href} aria-current={tab === key ? 'page' : undefined}>
              <Icon />
              {label}
            </a>
          ))}
        </nav>
      ) : publicTab ? (
        <nav class="tabbar" aria-label="Main">
          {PUBLIC_TABS.map(({ key, href, Icon, label }) => (
            <a href={href} aria-current={publicTab === key ? 'page' : undefined}>
              <Icon />
              {label}
            </a>
          ))}
        </nav>
      ) : null}
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
