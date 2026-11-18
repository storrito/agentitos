// The theme a person chose where this page is shown: the page around it
// (rragent shows it in a frame of its own origin and keeps the choice as
// data-theme on its root), else what that origin's browser keeps of it
// when the page is opened on its own. Without either the stylesheet
// follows the system. A switch of the theme there is followed at once.
(function () {
  var root = document.documentElement;
  function chosen() {
    try {
      var around = parent !== window && parent.document.documentElement.dataset.theme;
      if (around === 'dark' || around === 'light') return around;
    } catch (e) {}
    try {
      var kept = localStorage.getItem('rragent.theme');
      if (kept === 'dark' || kept === 'light') return kept;
    } catch (e) {}
    return null;
  }
  function follow() {
    var theme = chosen();
    if (theme) root.dataset.theme = theme;
  }
  follow();
  try {
    if (parent !== window) {
      new MutationObserver(follow).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
  } catch (e) {}
})();
