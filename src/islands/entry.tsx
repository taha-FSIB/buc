import { render } from 'preact';
import { Flipbook, type Page } from './Flipbook';
import { MemberPicker, type Person } from './MemberPicker';

/**
 * Island bootstrap.
 *
 * Finds every `<div data-island="...">` on the page, reads its props from the
 * adjacent JSON script tag, and renders into it — replacing the
 * server-rendered fallback that was already sitting there.
 *
 * Nothing here runs on pages without an island, and the whole bundle is
 * deferred, so the reading experience never waits on it.
 */

function propsFor(el: HTMLElement): any {
  const id = el.getAttribute('data-props');
  if (!id) return {};
  const script = document.getElementById(id);
  if (!script?.textContent) return {};
  try {
    return JSON.parse(script.textContent);
  } catch {
    return {};
  }
}

function mount() {
  document.querySelectorAll<HTMLElement>('[data-island]').forEach((el) => {
    const props = propsFor(el);
    switch (el.getAttribute('data-island')) {
      case 'flipbook':
        if (Array.isArray(props.pages) && props.pages.length) {
          el.innerHTML = '';
          render(<Flipbook pages={props.pages as Page[]} start={props.start ?? 0} />, el);
        }
        break;
      case 'member-picker':
        if (Array.isArray(props.people) && props.people.length) {
          el.innerHTML = '';
          render(<MemberPicker people={props.people as Person[]} name={props.name} />, el);
        }
        break;
    }
  });
}

if (document.readyState === 'loading') {
  addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
