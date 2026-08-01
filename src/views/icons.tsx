import type { FC } from 'hono/jsx';

/**
 * Inline SVG icons, Lucide-style: 24px, 2px stroke, `currentColor`.
 *
 * These replace the Unicode glyphs (⌂ ⛁ ☺) used in the first pass. Those are
 * not icons — depending on the phone they render as a monochrome symbol, a
 * full-colour emoji, or an empty tofu box. On a mid-2010s Android handset,
 * which is what a good number of the batch are carrying, several were tofu.
 *
 * Every icon here is decorative: it always sits beside a visible text label,
 * so it carries aria-hidden and contributes nothing to the accessible name.
 */

const Svg: FC<{ children: unknown }> = ({ children }) => (
  <svg
    width="24" height="24" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false"
  >
    {children}
  </svg>
);

export const HomeIcon: FC = () => (
  <Svg>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
  </Svg>
);

/** A book/album, not a database cylinder — this is a keepsake, not storage. */
export const VaultIcon: FC = () => (
  <Svg>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M4 17h16" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);

export const GroupsIcon: FC = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.5a3.25 3.25 0 0 1 0 6" />
    <path d="M18 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Svg>
);

export const SouvenirIcon: FC = () => (
  <Svg>
    <path d="M12 6.5S10 4 6.5 4H3v14h3.5C10 18 12 20.5 12 20.5" />
    <path d="M12 6.5S14 4 17.5 4H21v14h-3.5C14 18 12 20.5 12 20.5" />
    <path d="M12 6.5v14" />
  </Svg>
);

export const MoreIcon: FC = () => (
  <Svg>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </Svg>
);

export const BackIcon: FC = () => (
  <Svg>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Svg>
);

export const PlusIcon: FC = () => (
  <Svg>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

/** Padlock — used on the "Only you" chip so privacy is not colour-only. */
export const LockIcon: FC = () => (
  <Svg>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Svg>
);
