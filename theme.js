/* ============================================================
   Wenine — theme switch (light / dark / auto)
   The stylesheet has two palettes. "Auto" follows the device
   setting; "light"/"dark" force one by stamping data-theme on
   the <html> element. The choice is remembered per browser.
   Loaded at the very top of each page so the right colors are
   there before anything is drawn.
   ============================================================ */

window.WenineTheme = (function () {
  'use strict';
  var KEY = 'wenine-theme';
  var cur = 'auto';
  try { cur = localStorage.getItem(KEY) || 'auto'; } catch (e) { }
  if (cur !== 'light' && cur !== 'dark') cur = 'auto';

  function apply() {
    var root = document.documentElement;
    if (cur === 'light' || cur === 'dark') root.setAttribute('data-theme', cur);
    else root.removeAttribute('data-theme');
  }

  function set(v) {
    cur = (v === 'light' || v === 'dark') ? v : 'auto';
    try { localStorage.setItem(KEY, cur); } catch (e) { }
    apply();
  }

  apply();
  return { get: function () { return cur; }, set: set };
})();
