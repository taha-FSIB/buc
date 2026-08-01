import { useState, useMemo, useId } from 'react';

/**
 * A searchable replacement for the "choose a friend" dropdown.
 *
 * The second place React earns its keep. A native <select> holding 60 names
 * is a genuinely bad experience on a phone for someone with imprecise touch
 * — you scroll a tiny wheel hunting for one name. Typing three letters is
 * far kinder.
 *
 * The server renders a real <select name="audience_id"> first. This island
 * replaces it only after the bundle loads, so sharing works either way.
 */

export interface Person {
  id: string;
  name: string;
}

/** Fold accents so "Fernándo" is found by typing "fernando". */
const normalise = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function MemberPicker({ people, name }: { people: Person[]; name: string }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Person | null>(null);
  const inputId = useId();

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return people;
    return people.filter((p) => normalise(p.name).includes(q));
  }, [people, query]);

  if (chosen) {
    return (
      <div class="field">
        <input type="hidden" name={name} value={chosen.id} />
        <label>Sharing with</label>
        <p style="display:flex;align-items:center;gap:0.75rem;margin:0">
          <strong>{chosen.name}</strong>
          <button type="button" class="linklike" onClick={() => { setChosen(null); setQuery(''); }}>
            Choose someone else
          </button>
        </p>
      </div>
    );
  }

  return (
    <div class="field">
      <label for={inputId}>Choose a friend</label>
      <span class="hint">Start typing their name, or pick from the list.</span>
      <input
        id={inputId}
        type="text"
        autocomplete="off"
        value={query}
        placeholder="Type a name"
        onInput={(e: Event) => setQuery((e.target as HTMLInputElement).value)}
      />

      <ul class="picker-list" role="listbox" aria-label="People you can share with">
        {matches.length === 0 ? (
          <li class="picker-empty">
            Nobody by that name. Check the spelling, or clear the box to see everyone.
          </li>
        ) : (
          matches.slice(0, 40).map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected="false"
                      onClick={() => setChosen(p)}>
                {p.name}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
