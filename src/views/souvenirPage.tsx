import type { FC } from 'hono/jsx';

/**
 * One page of the reunion souvenir.
 *
 * Used by the flipbook viewer, by a member previewing their own page, and by
 * the admin approving it — so what somebody sees before they send it in is
 * exactly what everyone else will see afterwards.
 */

export interface SouvenirPageRow {
  id: string;
  page_type: string;
  heading: string | null;
  blurb: string | null;
  member_name: string | null;
  then_media_id: string | null;
  now_media_id: string | null;
}

export const titleOf = (p: SouvenirPageRow) =>
  p.heading || p.member_name || 'Our batch';

export const FlipPage: FC<{ page: SouvenirPageRow }> = ({ page }) => {
  const name = titleOf(page);

  if (page.page_type === 'photo') {
    const photo = page.then_media_id ?? page.now_media_id;
    return (
      <article class="flip-page">
        <h2>{name}</h2>
        {photo && (
          <img class="flip-photo" src={`/media/${photo}`}
               alt={page.blurb ?? name} loading="lazy" />
        )}
        {page.blurb && <p class="card-meta">{page.blurb}</p>}
      </article>
    );
  }

  if (page.page_type === 'article') {
    return (
      <article class="flip-page">
        <h2>{name}</h2>
        {page.member_name && page.heading && (
          <p class="card-meta">{page.member_name}</p>
        )}
        {page.blurb?.split(/\n{2,}/).map((para) => <p>{para}</p>)}
      </article>
    );
  }

  if (page.page_type === 'divider') {
    return (
      <article class="flip-page flip-divider">
        <h2>{name}</h2>
      </article>
    );
  }

  return (
    <article class="flip-page">
      <h2>{name}</h2>
      {(page.then_media_id || page.now_media_id) && (
        <div class="then-now">
          <figure>
            {page.then_media_id
              ? <img src={`/media/${page.then_media_id}`} alt={`${name}, back then`} loading="lazy" />
              : <div class="then-now-empty" />}
            <figcaption>Then</figcaption>
          </figure>
          <figure>
            {page.now_media_id
              ? <img src={`/media/${page.now_media_id}`} alt={`${name}, now`} loading="lazy" />
              : <div class="then-now-empty" />}
            <figcaption>Now</figcaption>
          </figure>
        </div>
      )}
      {page.blurb?.split(/\n{2,}/).map((para) => <p>{para}</p>)}
    </article>
  );
};
