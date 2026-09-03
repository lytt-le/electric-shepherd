/* =====================================================================
   win98.js  -  the desk furniture
   ---------------------------------------------------------------------
   The menu bar, the Start menu, the title-bar buttons, the taskbar clock
   and the status line.

   None of this owns any behaviour. Every item here either clicks a button
   that already exists in the toolbar or dispatches the keyboard shortcut
   that main.js already listens for, so there is exactly one implementation
   of every command and this file cannot drift away from it. If you add a
   command, add the button and the key in main.js first, then name it here.

   The one thing it does own is the status line: it mirrors whatever the
   app last said in the canvas toast into the status bar, because a Win98
   window with a permanently empty status bar looks broken.
   ===================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function isMobile() { return document.body.classList.contains('mobile'); }

  /* ---------- the two ways to fire a command --------------------------- */

  /* click a toolbar button by id */
  function btn(id) {
    return function () { var b = $(id); if (b) b.click(); };
  }
  /* dispatch a keyboard shortcut main.js already binds on window */
  function key(k) {
    return function () {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    };
  }
  /* switch the side panel to a tab, opening the drawer first on a phone */
  function tab(name) {
    return function () {
      var t = document.querySelector('#tabs button[data-tab="' + name + '"]');
      if (!t) return;
      t.click();
      if (isMobile() && !document.body.classList.contains('drawer-open')) {
        var m = $('btnMenu'); if (m) m.click();
      }
      t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
  }
  function on(id) { return function () { var b = $(id); return !!b && b.classList.contains('on'); }; }

  function say(text) {
    var s = $('sbStatus');
    if (s) s.textContent = text;
  }

  /* ---------- the menus ------------------------------------------------
     label: what it says. key: the shortcut printed on the right, which is
     documentation only - the shortcut itself is bound in main.js.
     check: a predicate; when present the item carries a tick. */
  var MENUS = [
    { id: 'file', label: 'File', accel: 'F', items: [
      { label: 'New Sheep', key: 'R', run: btn('btnRandom') },
      { label: 'Mutate', key: 'M', run: btn('btnMutate') },
      { sep: true },
      { label: 'Keep to Flock', key: 'K', run: btn('btnKeep') },
      { label: 'Export PNG', key: 'E', run: key('e') },
      { sep: true },
      { label: 'Open the Flock', run: tab('library') },
      { label: 'Render Sequence', run: tab('output') },
      { sep: true },
      { label: 'Exit', run: function () { say('Nothing to close - the flock is the whole app.'); } }
    ] },
    { id: 'view', label: 'View', accel: 'V', items: [
      { label: 'Play / Pause', key: 'Space', run: btn('btnPlay') },
      { label: 'Previous Sheep', key: 'Left', run: btn('btnPrev') },
      { label: 'Next Sheep', key: 'Right', run: btn('btnSkip') },
      { sep: true },
      { label: 'Auto-frame', key: 'F', run: btn('btnFit') },
      { label: 'Restart Exposure', key: 'C', run: btn('btnClearAcc') },
      { sep: true },
      { label: 'Sheep Details', key: 'H', run: btn('btnOverlay'), check: on('btnOverlay') },
      { label: 'Hide Panels', key: 'U', run: key('u'),
        check: function () { return document.body.classList.contains('cinema'); } },
      { label: 'Full Screen', key: 'V', run: btn('btnFull') }
    ] },
    { id: 'panels', label: 'Panels', accel: 'P', items: [
      { label: 'Sheep', run: tab('sheep') },
      { label: 'Transforms', run: tab('transforms') },
      { label: 'Palette', run: tab('palette') },
      { label: 'Image', run: tab('render') },
      { label: 'Loop', run: tab('loop') },
      { label: 'Evolve', run: tab('evolve') },
      { label: 'Stream', run: tab('stream') },
      { label: 'Render', run: tab('output') },
      { label: 'Flock', run: tab('library') }
    ] },
    { id: 'stream', label: 'Stream', accel: 'S', items: [
      { label: 'Start / Stop Stream', key: 'S', run: btn('btnStream'), check: on('btnStream') },
      { sep: true },
      { label: 'Stream Settings', run: tab('stream') },
      { label: 'Evolve Settings', run: tab('evolve') }
    ] },
    { id: 'help', label: 'Help', accel: 'H', items: [
      { label: 'Handbook', key: 'F1', run: btn('btnHelp') },
      { sep: true },
      { label: 'About Electric Shepherd', run: about }
    ] }
  ];

  /* ---------- drop-down machinery -------------------------------------- */

  var openPop = null;      // the visible .menupop
  var openTop = null;      // the .menutop it hangs from
  var armed = false;       // menu bar is "armed": hovering another top opens it

  function closeMenus() {
    // the pops are built fresh on every open, so closing means removing them
    var live = document.querySelectorAll('.menupop');
    for (var i = 0; i < live.length; i++) live[i].parentNode.removeChild(live[i]);
    openPop = null;
    if (openTop) { openTop.classList.remove('open'); openTop.setAttribute('aria-expanded', 'false'); openTop = null; }
    var sb = $('startBtn'), sm = $('startMenu');
    if (sb) { sb.classList.remove('open'); sb.setAttribute('aria-expanded', 'false'); }
    if (sm) sm.classList.remove('open');
    armed = false;
  }

  /* Position a pop-up under (or above) an anchor, nudged left when it would
     hang off the right edge - the only geometry Win98 ever did. */
  function place(pop, anchor, above) {
    var r = anchor.getBoundingClientRect();
    pop.classList.add('open');                     // must be laid out to measure
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var x = Math.max(2, Math.min(r.left, window.innerWidth - w - 2));
    var y = above ? Math.max(2, r.top - h) : r.bottom;
    if (!above && y + h > window.innerHeight) y = Math.max(2, r.top - h);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }

  function buildItems(pop, items) {
    pop.innerHTML = '';
    items.forEach(function (it) {
      if (it.sep) { pop.appendChild(mk('div', 'menusep')); return; }
      var b = mk('button', 'menuitem');
      b.type = 'button';
      b.appendChild(document.createTextNode(it.label));
      if (it.key) {
        var k = mk('span', 'mi-key');
        k.textContent = it.key;
        b.appendChild(k);
      }
      if (it.check) b.classList.toggle('checked', !!it.check());
      b.addEventListener('click', function () {
        closeMenus();
        it.run();
      });
      pop.appendChild(b);
    });
  }

  function mk(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function openMenu(menu, top) {
    var wasOpen = (openTop === top);
    closeMenus();
    if (wasOpen) return;
    var pop = mk('div', 'menupop');
    buildItems(pop, menu.items);           // rebuilt each time so ticks are live
    document.body.appendChild(pop);
    place(pop, top, false);
    openPop = pop; openTop = top; armed = true;
    top.classList.add('open');
    top.setAttribute('aria-expanded', 'true');
  }

  function buildMenubar() {
    var bar = $('menubar');
    if (!bar) return;
    MENUS.forEach(function (m) {
      var top = mk('button', 'menutop');
      top.type = 'button';
      top.setAttribute('aria-haspopup', 'true');
      top.setAttribute('aria-expanded', 'false');
      // the accelerator letter is underlined, the way every Win98 menu was
      var i = m.label.indexOf(m.accel);
      if (i >= 0) {
        top.appendChild(document.createTextNode(m.label.slice(0, i)));
        var u = document.createElement('u');
        u.textContent = m.label.charAt(i);
        top.appendChild(u);
        top.appendChild(document.createTextNode(m.label.slice(i + 1)));
      } else top.textContent = m.label;

      top.addEventListener('click', function (e) { e.stopPropagation(); openMenu(m, top); });
      top.addEventListener('mouseenter', function () { if (armed && openTop !== top) openMenu(m, top); });
      bar.appendChild(top);
    });
  }

  /* ---------- Start menu ------------------------------------------------ */

  var START = [
    { label: 'New Sheep', icon: 'sheep', run: btn('btnRandom') },
    { label: 'The Flock', icon: 'folder', run: tab('library') },
    { label: 'Stream', icon: 'globe', run: btn('btnStream') },
    { sep: true },
    { label: 'Full Screen', icon: 'screen', run: btn('btnFull') },
    { label: 'Handbook', icon: 'help', run: btn('btnHelp') },
    { sep: true },
    { label: 'About Electric Shepherd', icon: 'info', run: about },
    { label: 'Shut Down', icon: 'power', run: function () { say('Shut down denied. The sheep dream on.'); } }
  ];

  var ICONS = {
    sheep:  "<rect width='16' height='16' fill='#000080'/><path d='M8 2 L13 8 L8 14 L3 8 Z' fill='#ff8000'/><path d='M8 5 L11 8 L8 11 L5 8 Z' fill='#ffff00'/>",
    folder: "<path d='M1 4h5l1 2h8v8H1z' fill='#ffcc00'/><path d='M1 4h5l1 2h8v1H1z' fill='#ffee88'/><path d='M1 4h5l1 2h8v8H1z' fill='none' stroke='#000'/>",
    globe:  "<circle cx='8' cy='8' r='6.5' fill='#3a7bd5' stroke='#000'/><path d='M1.5 8h13M8 1.5c3 3 3 10 0 13M8 1.5c-3 3-3 10 0 13' fill='none' stroke='#cfe4ff'/>",
    screen: "<rect x='1' y='2' width='14' height='10' fill='#c0c0c0' stroke='#000'/><rect x='2' y='3' width='12' height='8' fill='#000080'/><rect x='5' y='13' width='6' height='2' fill='#808080'/>",
    help:   "<circle cx='8' cy='8' r='6.5' fill='#000080' stroke='#000'/><path d='M6 6.2a2 2 0 1 1 2.6 2c-.6.4-.6 1-.6 1.4' fill='none' stroke='#fff' stroke-width='1.6'/><rect x='7.2' y='11' width='1.6' height='1.6' fill='#fff'/>",
    info:   "<circle cx='8' cy='8' r='6.5' fill='#ffffff' stroke='#000'/><rect x='7.2' y='3.4' width='1.6' height='1.8' fill='#000080'/><rect x='7.2' y='6.4' width='1.6' height='6' fill='#000080'/>",
    power:  "<rect x='2' y='5' width='12' height='7' fill='#c0c0c0' stroke='#000'/><rect x='3.5' y='6.5' width='9' height='2' fill='#000080'/><rect x='4' y='2' width='8' height='3' fill='#808080' stroke='#000'/>"
  };

  function icon(name) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', 'sm-ico');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  function buildStart() {
    var sm = mk('div', 'startmenu');
    sm.id = 'startMenu';
    var spine = mk('div', 'sm-spine');
    var sp = document.createElement('span');
    sp.textContent = 'Shepherd 98';
    spine.appendChild(sp);
    var list = mk('div', 'sm-items');
    START.forEach(function (it) {
      if (it.sep) { list.appendChild(mk('div', 'menusep')); return; }
      var b = mk('button', 'menuitem');
      b.type = 'button';
      b.appendChild(icon(it.icon));
      b.appendChild(document.createTextNode(it.label));
      b.addEventListener('click', function () { closeMenus(); it.run(); });
      list.appendChild(b);
    });
    sm.appendChild(spine);
    sm.appendChild(list);
    document.body.appendChild(sm);

    var sb = $('startBtn');
    if (!sb) return;
    sb.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = sm.classList.contains('open');
      closeMenus();
      if (wasOpen) return;
      sm.classList.add('open');
      sb.classList.add('open');
      sb.setAttribute('aria-expanded', 'true');
    });
  }

  /* ---------- About box -------------------------------------------------
     A modal dialog, built and thrown away each time. It is the only window
     in the app besides the handbook, so it does not need a system. */
  function about() {
    var old = $('aboutBox');
    if (old) old.parentNode.removeChild(old);

    var wrap = mk('div', 'helpwrap open');
    wrap.id = 'aboutBox';
    wrap.style.zIndex = '300';

    var card = mk('div', 'helpcard');
    card.style.width = '392px';
    card.style.height = 'auto';

    var head = mk('div', 'helphead');
    var t = mk('span', 'helptitle');
    t.textContent = 'About Electric Shepherd';
    var x = mk('button', 'helpclose');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Close');
    head.appendChild(t);
    head.appendChild(mk('span', 'spacer'));
    head.appendChild(x);

    var body = mk('div', 'aboutbody');
    body.innerHTML =
      "<div class='ab-top'>" +
        "<svg viewBox='0 0 32 32' width='32' height='32' aria-hidden='true'>" +
          "<path d='M16 2 L29 16 L16 30 L3 16 Z' fill='#000080'/>" +
          "<path d='M16 8 L23 16 L16 24 L9 16 Z' fill='#ff8000'/>" +
          "<path d='M16 13 L19 16 L16 19 L13 16 Z' fill='#ffff00'/>" +
        "</svg>" +
        "<div><b>Electric Shepherd</b><br>local flame engine<br>" +
        "Fractal flames, rendered on your own GPU.</div>" +
      "</div>" +
      "<div class='ab-rule'></div>" +
      "<div class='ab-kv'>" +
        "<span>Renderer</span><b>WebGL 2</b>" +
        "<span>Display</span><b id='abRes'>&mdash;</b>" +
        "<span>Flock</span><b id='abFlock'>&mdash;</b>" +
      "</div>" +
      "<div class='ab-btns'><button type='button' class='primary' id='abOK'>OK</button></div>";

    card.appendChild(head);
    card.appendChild(body);
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    // fill in whatever the running app can tell us
    try {
      var r = window.app && window.app.renderer;
      if (r && r.width) $('abRes').textContent = r.width + ' × ' + r.height + ' at ' + r.ss + '×';
      var lib = window.app && window.app.library;
      if (lib) $('abFlock').textContent = lib.items.length + ' sheep kept';
    } catch (e) { /* an About box is never worth an exception */ }

    function shut() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    x.addEventListener('click', shut);
    $('abOK').addEventListener('click', shut);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    $('abOK').focus();
  }

  /* ---------- title-bar buttons ---------------------------------------- */
  function wireTitlebar() {
    var mn = $('btnWinMin'), mx = $('btnWinMax'), cl = $('btnWinClose');
    if (mn) mn.addEventListener('click', key('u'));
    if (mx) mx.addEventListener('click', btn('btnFull'));
    if (cl) cl.addEventListener('click', function () {
      say('Nothing to close - the flock is the whole app.');
    });
    // an unfocused window wears the grey title bar
    window.addEventListener('blur', function () { document.body.classList.add('win-blur'); });
    window.addEventListener('focus', function () { document.body.classList.remove('win-blur'); });
  }

  /* ---------- taskbar clock -------------------------------------------- */
  function startClock() {
    var c = $('clock');
    if (!c) return;
    function tick() {
      var d = new Date();
      var h = d.getHours(), m = d.getMinutes();
      var ap = h < 12 ? 'AM' : 'PM';
      h = h % 12; if (h === 0) h = 12;
      c.textContent = h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
    }
    tick();
    setInterval(tick, 20000);
  }

  /* ---------- status line ----------------------------------------------
     main.js announces everything through the canvas toast. Watch that node
     and echo it, so the status bar says the same thing without main.js
     needing to know this bar exists. */
  function mirrorToasts() {
    var msg = $('msg');
    if (!msg || !window.MutationObserver) return;
    new MutationObserver(function () {
      var t = msg.textContent.trim();
      if (t) say(t);
    }).observe(msg, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- go -------------------------------------------------------- */
  function init() {
    buildMenubar();
    buildStart();
    wireTitlebar();
    startClock();
    mirrorToasts();
    document.addEventListener('click', function (e) {
      if (openPop && openPop.contains(e.target)) return;
      closeMenus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (openPop || document.querySelector('.startmenu.open'))) {
        e.preventDefault();
        closeMenus();
      }
    });
    window.addEventListener('resize', closeMenus);
    var ti = $('taskItem');
    if (ti) ti.addEventListener('click', function () {
      // the task button restores the window when the panels are hidden
      if (document.body.classList.contains('cinema')) key('u')();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
