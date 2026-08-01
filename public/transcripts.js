/*
 * The language switch under a story. The only JavaScript on the site.
 *
 * Everything is already in the HTML. The server renders every language
 * stacked and visible, so with this file blocked, slow, or broken, a reader
 * still gets all of it — just one after another instead of one at a time.
 * Nothing is ever reachable only by script.
 *
 * The previous version hid all but the first panel server-side, which meant a
 * reader without JavaScript could never reach a second translation at all.
 */
(function () {
  var tabs = document.querySelectorAll('[data-story-tab]');
  var panels = document.querySelectorAll('[data-story-panel]');
  if (tabs.length < 2 || !panels.length) return;

  function show(lang) {
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-story-panel') !== lang;
    }
    for (var j = 0; j < tabs.length; j++) {
      var on = tabs[j].getAttribute('data-story-tab') === lang;
      tabs[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  for (var k = 0; k < tabs.length; k++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        show(tab.getAttribute('data-story-tab'));
      });
    })(tabs[k]);
  }

  // Collapse to one language only once the switch is known to work.
  show(tabs[0].getAttribute('data-story-tab'));
})();
