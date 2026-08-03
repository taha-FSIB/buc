import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Viewer } from '../lib/auth';
import {
  HomeIcon, VaultIcon, GroupsIcon, SouvenirIcon, MoreIcon, BackIcon, LockIcon,
  PenIcon, CalendarIcon, MailIcon, TalkIcon,
} from './icons';

/** One screen of a page. The keyword is what appears in the section navbar. */
export interface Section {
  id: string;
  key: string;
}

interface LayoutProps {
  title: string;
  viewer: Viewer | null;
  /** Which bottom tab to highlight. */
  tab?: 'home' | 'talk' | 'vault' | 'groups' | 'book' | 'more';
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
  /**
   * The sections of THIS page, in order, as keywords for the navbar.
   *
   * Omit it and the page renders as a single panel — which is what every page
   * not yet cut into sections does, and why this could be rolled out without a
   * flag day. A one-panel page still cannot scroll the document; if its
   * content is taller than the screen the panel scrolls inside itself.
   */
  sections?: Section[];
  /**
   * Draw the 1979-2026 rule under the keywords. Only true where those years
   * carry meaning — the public pages and the story. On /admin/members it would
   * be a picture of nothing, and it costs 1.8rem of a phone screen.
   */
  timeline?: boolean;
}

/*
 * Five, still. The Hub earned a place because it is the thing members will
 * open every day, and the souvenir gave one up because sending in your page is
 * a task you do once — that belongs in a prompt on the home page, not in a
 * permanent tab. The souvenir is one tap away under More, and stays linked
 * from Home until a member has sent their page in.
 */
const TABS = [
  { key: 'home',   href: '/',       Icon: HomeIcon,   label: 'Home' },
  { key: 'talk',   href: '/talk',   Icon: TalkIcon,   label: 'Talk' },
  { key: 'vault',  href: '/vault',  Icon: VaultIcon,  label: 'My Vault' },
  { key: 'groups', href: '/groups', Icon: GroupsIcon, label: 'Groups' },
  { key: 'more',   href: '/more',   Icon: MoreIcon,   label: 'More' },
] as const;

/** The same five-item ceiling as the member bar, for the same reason. */
const PUBLIC_TABS = [
  { key: 'home',    href: '/',           Icon: HomeIcon,     label: 'Home' },
  { key: 'story',   href: '/our-story',  Icon: SouvenirIcon, label: 'Our Story' },
  { key: 'stories', href: '/stories',    Icon: PenIcon,      label: 'Memories' },
  { key: 'reunion', href: '/reunion',    Icon: CalendarIcon, label: 'Reunion' },
  { key: 'contact', href: '/contact',    Icon: MailIcon,     label: 'Contact' },
] as const;

/**
 * One full screen. Pages that declare `sections` wrap each screen in this, and
 * the `id` must match the section's `id` or the navbar keyword will not track.
 */
export const Panel: FC<PropsWithChildren<{ id?: string; list?: boolean }>> = ({
  id, list, children,
}) => (
  <section class={list ? 'panel panel-list' : 'panel'} id={id}>
    <div class="panel-inner">{children}</div>
  </section>
);

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title, viewer, tab, publicTab, back, description, sections, timeline, children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      {/*
        No maximum-scale and no user-scalable=no. Pinch-zoom is the one
        accessibility control every member already knows how to use, and a
        design confident in its own type size has no reason to take it away.
      */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>{title} · BUC Alumni</title>
      {description && <meta name="description" content={description} />}
      {description && <meta property="og:description" content={description} />}
      <meta property="og:title" content={`${title} · BUC Alumni`} />
      <meta property="og:type" content="website" />
      {/*
        The typefaces are served from this Worker, not from a font CDN. Two DNS
        lookups and two TLS handshakes used to stand between a member on mobile
        data and the first glyph on the page. Preloaded because the body face
        is on the critical path for every screen.
      */}
      <link
        rel="preload" as="font" type="font/woff2" crossorigin=""
        href="/fonts/merriweather-400.woff2"
      />
      <link rel="stylesheet" href="/styles.css" />
      <meta name="theme-color" content="#fbf6ea" />
    </head>
    <body>
      <a class="skip-link" href="#main">Skip to main content</a>

      <header class={timeline ? 'sectionbar' : 'sectionbar sectionbar-plain'}>
        <div class="sectionbar-row">
          {/* Always the root: signed in that is the member feed, signed out it
              is the public home. Either way it is "the start". */}
          <a class="wordmark" href="/">BUC<span>.</span></a>

          {back ? (
            <a class="back" href={back.href}>
              <BackIcon />
              {back.label}
            </a>
          ) : viewer ? (
            <a class="header-link" href="/more">
              {viewer.preferred_name ?? viewer.full_name}
            </a>
          ) : (
            <a class="header-link" href="/signin">Sign in</a>
          )}

          {sections && sections.length > 1 && (
            <ul class="keys" aria-label="Sections of this page">
              {sections.map((s) => (
                <li>
                  <a href={`#${s.id}`} data-section={s.id}>{s.key}</a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {timeline && (
          <div class="timeline" aria-hidden="true">
            <div class="timeline-rule"></div>
            <div class="bead" id="bead" style="left:6%"></div>
            <div class="timeline-years"><span>1979</span><span>2026</span></div>
          </div>
        )}
      </header>

      {/*
        Still `main`, still `#main`, so the skip link and anything else keyed to
        it keep working. It is the scroller now: the document cannot scroll,
        this can, and it snaps a panel at a time.
      */}
      <main id="main" class="deck">
        {sections ? children : <Panel>{children}</Panel>}
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

      {/* Deferred, so nothing anybody came here to read waits on it. */}
      <script src="/motion.js" defer></script>
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
