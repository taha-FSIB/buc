/*
 * Transcript tabs. The only JavaScript on the site.
 *
 * Everything is already in the HTML — this just hides the panels the reader
 * did not pick. With JS off or still loading, every translation is visible,
 * stacked, and readable. Nothing is ever lost to a failed script.
 */
(function () {
  var tabs = document.querySelectorAll('[data-transcript-tab]');
  if (!tabs.length) return;

  function show(lang) {
    document.querySelectorAll('[data-transcript-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-transcript-panel') !== lang;
    });
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-transcript-tab') === lang;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      show(tab.getAttribute('data-transcript-tab'));
    });
  });
})();
