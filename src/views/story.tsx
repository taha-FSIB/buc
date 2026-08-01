import type { FC } from 'hono/jsx';

/**
 * A story's words, in whichever languages exist for it.
 *
 * The member writes in one language. English gets optional Tamil and Sinhala
 * translations; Tamil or Sinhala gets an optional English one. What is shown
 * by default is always what the member actually wrote — a translation is
 * supplementary, never a replacement.
 *
 * LANGUAGE RULE (CLAUDE.md): the labels below are in English and stay in
 * English. "Tamil", not "தமிழ்". A member who reads only Sinhala must still be
 * able to find their way around a site whose chrome never changes shape, and
 * a switch that renames itself is exactly the kind of surprise this audience
 * does not need. The words inside the panel are in the language; everything
 * around it is not.
 *
 * This is used by both the members' post page and the public story page, so
 * the two cannot drift apart.
 */

export const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English',
  ta: 'Tamil',
  si: 'Sinhala',
};

/**
 * A fixed order for the switch, so the buttons never move about.
 *
 * Without this the order is whatever the database happened to return, which
 * can differ between two pages showing the same story. People learn a control
 * by where it sits, not by reading it every time; a switch whose second button
 * is Tamil today and Sinhala tomorrow is a small betrayal.
 *
 * What the member actually wrote always comes first, whatever this says.
 */
const LANGUAGE_ORDER = ['en', 'ta', 'si'];

const orderOf = (lang: string) => {
  const i = LANGUAGE_ORDER.indexOf(lang);
  return i === -1 ? LANGUAGE_ORDER.length : i;
};

export interface Transcript {
  language: string;
  body: string;
  source?: string;
}

const Paragraphs: FC<{ text: string }> = ({ text }) => (
  <>{text.split(/\n{2,}/).map((para) => <p>{para}</p>)}</>
);

export const StoryText: FC<{
  /** The language the member wrote in. */
  language: string;
  /** Their own words. May be empty for a recording that only has a transcript. */
  body: string | null;
  transcripts: Transcript[];
}> = ({ language, body, transcripts }) => {
  const panels = [
    ...(body ? [{ language, body, source: 'author' }] : []),
    ...transcripts
      .filter((t) => t.language !== language)
      .sort((a, b) => orderOf(a.language) - orderOf(b.language)),
  ];

  if (panels.length === 0) return null;

  // Nothing to switch between.
  if (panels.length === 1) {
    return (
      <div class="story" lang={panels[0].language}>
        <Paragraphs text={panels[0].body} />
      </div>
    );
  }

  return (
    <>
      {/* Every panel is rendered visible. transcripts.js hides all but the
          first once it loads. With JavaScript off or still arriving, the
          reader gets every language stacked and readable — which is worse
          looking and infinitely better than a translation nobody can reach.
          An earlier version marked them hidden server-side, which left the
          second translation unreachable without JavaScript. */}
      {panels.map((p) => (
        <div class="story" id={`story-${p.language}`} lang={p.language}
             data-story-panel={p.language} aria-labelledby={`story-tab-${p.language}`}>
          <Paragraphs text={p.body} />
          {p.source === 'machine' && (
            <p class="card-meta">
              This translation was made automatically and checked by a member.
            </p>
          )}
        </div>
      ))}

      {/*
        Beneath the words, as the brief asks, and never in the site navigation.
        Plain toggle buttons rather than role="tab": a tablist promises
        arrow-key navigation between tabs, and promising a keyboard behaviour
        we have not built is worse than not claiming it.
      */}
      <div class="transcripts" role="group" aria-label="Read this in another language">
        <p class="transcripts-label" id="transcripts-label">Read this in</p>
        <div class="transcript-tabs">
          {panels.map((p, i) => (
            <button type="button" id={`story-tab-${p.language}`}
                    aria-pressed={i === 0 ? 'true' : 'false'}
                    aria-controls={`story-${p.language}`}
                    data-story-tab={p.language}>
              {LANGUAGE_LABEL[p.language] ?? p.language}
              {i === 0 && <span class="visually-hidden"> — what was written</span>}
            </button>
          ))}
        </div>
      </div>
      <script src="/transcripts.js" defer></script>
    </>
  );
};
