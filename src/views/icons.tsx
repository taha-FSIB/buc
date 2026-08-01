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

/* -- What kind of thing am I adding? --------------------------------------- */

export const PenIcon: FC = () => (
  <Svg>
    <path d="M4 20h4l10.5-10.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </Svg>
);

export const PhotoIcon: FC = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.75" />
    <path d="m4 17 5-5 4.5 4.5L16 14l4 4" />
  </Svg>
);

export const MicIcon: FC = () => (
  <Svg>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </Svg>
);

export const VideoIcon: FC = () => (
  <Svg>
    <rect x="3" y="6" width="12" height="12" rx="2" />
    <path d="m15 10.5 6-3.5v10l-6-3.5z" />
  </Svg>
);

/* -- Who can see it? ------------------------------------------------------- */

export const PersonIcon: FC = () => (
  <Svg>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

export const GlobeIcon: FC = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
  </Svg>
);
