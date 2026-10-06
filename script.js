/* ============================================================
   Wenine Hours — behavior
   Sections below: constants & state, date helpers, storage
   (shared database or this browser), hour math, rendering,
   the two pop-ups (day editor, person editor), and boot.
   ============================================================ */

(function () {
  'use strict';

  /* ===================== constants & state ===================== */
  var DEFAULT_START = '2026-09-30';
  var DEFAULT_END = '2027-04-30';
  var LS_DATA = 'wenine-hours-v1';
  var LS_UI = 'wenine-ui-v1';
  var LS_SEEDED = 'wenine-fb-seeded-v1';

  /* Firebase project config. Safe to be public: this is the project's
     address, not a password — who may read/write is controlled by the
     Firestore rules in the Firebase console. */
  var FIREBASE_VERSION = '12.19.0';
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDqMggtkv--K-_IekSMpYBywyQ5LCDqvTM',
    authDomain: 'weninehourtracker.firebaseapp.com',
    projectId: 'weninehourtracker',
    storageBucket: 'weninehourtracker.firebasestorage.app',
    messagingSenderId: '57113093874',
    appId: '1:57113093874:web:c108078d8141c6db10d26b'
  };
  /* all visible text comes from i18n.js (window.WenineLang) */
  var L = window.WenineLang;
  var DAY_NAMES = L.arr('dayNamesFull');
  var DAY_SHORT = L.arr('dayShort');
  var MONTHS = L.arr('monthsFull');

  var state = {
    people: {},          // id -> {id,name,start,end}
    entries: {},         // "pid_date" -> {personId,date,status,from,to,hours,note}
    personId: null,
    view: null,          // {y,m}
    viewMode: 'cal',     // 'cal' (calendar) | 'list' (sheet) | 'plan' (planner)
    plan: null,          // current person's planner settings
    loaded: false,
    user: null,          // logged-in user (cloud mode only)
    admin: null,         // the user again, when they are an admin
    mode: null           // 'db' (claude.ai) | 'firebase' | 'local'
  };
  var store = null;      // {savePerson,deletePerson,saveEntry,deleteEntry}
  var dbRef = null;      // claude.ai database handle
  var fb = null;         // Firebase Firestore module (its functions)
  var fbDb = null;       // Firebase database handle
  var authFns = null;    // Firebase Auth module (its functions)
  var auth = null;       // Firebase Auth handle
  var entriesUnsub = null;
  var plannerUnsub = null;
  var peopleUnsub = null;
  var localPlanner = {};   // planner settings per person (localStorage mode)
  var editingDate = null;
  var editingPersonId = null; // null = adding
  var editStatus = 'worked';

  /* ===================== date helpers ===================== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dowMon(d) { return (d.getDay() + 6) % 7; } // 0 = Monday
  function isMonday(d) { return d.getDay() === 1; }
  function isWeekend(d) { var g = d.getDay(); return g === 0 || g === 6; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function todayStr() { return fmtDate(new Date()); }
  function isoWeek(d) {
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 3 - dowMon(t));
    var firstThu = new Date(t.getFullYear(), 0, 4);
    firstThu.setDate(firstThu.getDate() + 3 - dowMon(firstThu));
    return 1 + Math.round((t - firstThu) / (7 * 864e5));
  }
  function niceDate(s) {
    var d = parseDate(s);
    return DAY_NAMES[dowMon(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function shortDate(s) {
    var d = parseDate(s);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }

  function calcHours(from, to) {
    if (!from || !to) return null;
    var f = from.split(':'), t = to.split(':');
    var mins = (+t[0] * 60 + +t[1]) - (+f[0] * 60 + +f[1]);
    if (mins <= 0) mins += 24 * 60; // past midnight
    return Math.round(mins / 60 * 100) / 100;
  }
  function fmtH(n) {
    var r = Math.round(n * 100) / 100;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(2).replace(/0$/, ''));
  }

  /* ===================== storage ===================== */
  function initStorage() {
    var usePromise = null;
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        usePromise = window.claude.use('db');
      }
    } catch (e) { usePromise = null; }

    /* Storage is picked in this order:
       1. claude.ai artifact database (only exists on claude.ai)
       2. Firebase cloud database (GitHub Pages, local file, anywhere else)
       3. this browser's localStorage (last resort, offline) */
    var claudeDb = usePromise ? usePromise.catch(function () { return null; }) : Promise.resolve(null);
    claudeDb.then(function (db) {
      if (db) { initDb(db); return; }
      initFirebase().catch(function () { initLocal(); });
    });
  }

  function initDb(db) {
    dbRef = db;
    state.mode = 'db';
    store = {
      savePerson: function (p) { return db.doc('people/' + p.id).set(p); },
      deletePerson: function (id) { return db.doc('people/' + id).delete(); },
      saveEntry: function (e) { return db.doc('entries/' + e.personId + '_' + e.date).set(e); },
      deleteEntry: function (key) { return db.doc('entries/' + key).delete(); },
      savePlanner: function (p) { return db.doc('planner/' + p.personId).set(p); }
    };
    db.collection('people').onSnapshot(function (snap) {
      var m = {};
      snap.docs.forEach(function (d) { if (d.exists) { m[d.id] = d.data(); } });
      state.people = m;
      state.loaded = true;
      ensureSelection();
      render();
    }, function () {
      showToast(L.t('toastConnLost'));
    });
    setStorageNote('storageClaude');
  }

  /* every account that logs in or registers is recorded once, so the
     admin can pick registered emails from a list when linking people */
  function recordAccount(user) {
    if (!user || !user.email) return;
    var em = user.email.toLowerCase();
    var ref = fb.doc(fbDb, 'accounts', em);
    fb.getDoc(ref).then(function (s) {
      if (!s.exists()) return fb.setDoc(ref, { email: em });
    }).catch(function () { });
  }

  /* Firebase: loads Google's Firestore library over the internet, then
     connects to the WenineHourTracker project. Data saved here is
     permanent, shared, and syncs live to everyone with the page open. */
  function initFirebase() {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-auth.js')
    ]).then(function (mods) {
      var app = mods[0].initializeApp(FIREBASE_CONFIG);
      fb = mods[1];
      fbDb = fb.getFirestore(app);
      authFns = mods[2];
      auth = authFns.getAuth(app);
      state.mode = 'firebase';

      /* Everything is behind the login: data is only loaded once someone
         is signed in, and cleared again when they sign out. */
      authFns.onAuthStateChanged(auth, function (user) {
        state.user = user || null;
        state.admin = null;
        if (!user) {
          if (peopleUnsub) { peopleUnsub(); peopleUnsub = null; }
          if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
          if (plannerUnsub) { plannerUnsub(); plannerUnsub = null; }
          state.people = {}; state.entries = {}; state.plan = null;
          state.personId = null; state.loaded = false;
          render();
          return;
        }
        recordAccount(user);
        fb.getDoc(fb.doc(fbDb, 'admins', (user.email || '').toLowerCase())).then(function (s) {
          state.admin = s.exists() ? user : null;
          ensureSelection();
          render();
        }).catch(function () { });
        if (!peopleUnsub) {
          peopleUnsub = fb.onSnapshot(fb.collection(fbDb, 'people'), function (snap) {
            var m = {};
            snap.forEach(function (d) { m[d.id] = d.data(); });
            state.people = m;
            state.loaded = true;
            seedIfEmpty();
            ensureSelection();
            render();
          }, function () { showToast(L.t('toastDbRules')); });
        }
        render();
      });
      store = {
        savePerson: function (p) { return fb.setDoc(fb.doc(fbDb, 'people', p.id), p); },
        deletePerson: function (id) { return fb.deleteDoc(fb.doc(fbDb, 'people', id)); },
        saveEntry: function (e) { return fb.setDoc(fb.doc(fbDb, 'entries', e.personId + '_' + e.date), e); },
        deleteEntry: function (key) { return fb.deleteDoc(fb.doc(fbDb, 'entries', key)); },
        savePlanner: function (p) { return fb.setDoc(fb.doc(fbDb, 'planner', p.personId), p); }
      };
      setStorageNote('storageCloud');
    });
  }

  /* The very first time the cloud database is seen empty from this
     browser, create Darvan's calendar so the app doesn't start blank. */
  function seedIfEmpty() {
    if (state.mode !== 'firebase' || !state.admin || Object.keys(state.people).length > 0) return;
    var seeded = false;
    try { seeded = !!localStorage.getItem(LS_SEEDED); } catch (e) { }
    if (seeded) return;
    try { localStorage.setItem(LS_SEEDED, '1'); } catch (e) { }
    store.savePerson({ id: 'darvan', name: 'Darvan', start: DEFAULT_START, end: DEFAULT_END })
      .catch(function () { showToast(L.t('toastSeedFail')); });
  }

  function initLocal() {
    state.mode = 'local';
    var data = {};
    try { data = JSON.parse(localStorage.getItem(LS_DATA) || '{}'); } catch (e) { data = {}; }
    state.people = data.people || {};
    state.entries = data.entries || {};
    localPlanner = data.planner || {};
    if (Object.keys(state.people).length === 0) {
      state.people.darvan = { id: 'darvan', name: 'Darvan', start: DEFAULT_START, end: DEFAULT_END };
      persistLocal();
    }
    store = {
      savePerson: function (p) { state.people[p.id] = p; persistLocal(); return Promise.resolve(); },
      deletePerson: function (id) {
        delete state.people[id];
        Object.keys(state.entries).forEach(function (k) {
          if (state.entries[k].personId === id) delete state.entries[k];
        });
        persistLocal(); return Promise.resolve();
      },
      saveEntry: function (e) { state.entries[e.personId + '_' + e.date] = e; persistLocal(); return Promise.resolve(); },
      deleteEntry: function (key) { delete state.entries[key]; persistLocal(); return Promise.resolve(); },
      savePlanner: function (p) { localPlanner[p.personId] = p; state.plan = p; persistLocal(); return Promise.resolve(); }
    };
    state.loaded = true;
    ensureSelection();
    render();
    setStorageNote('storageLocal');
  }

  function persistLocal() {
    try {
      localStorage.setItem(LS_DATA, JSON.stringify({ people: state.people, entries: state.entries, planner: localPlanner }));
    } catch (e) { showToast(L.t('toastStorageFull')); }
  }

  /* Listen to one person's logged days. Re-subscribes when you switch
     person; localStorage mode keeps everything in memory instead. */
  /* the person's planner settings live in their own small document */
  function subscribePlanner(pid) {
    if (plannerUnsub) { plannerUnsub(); plannerUnsub = null; }
    state.plan = null;
    if (state.mode === 'db' && dbRef) {
      plannerUnsub = dbRef.doc('planner/' + pid).onSnapshot(function (snap) {
        state.plan = snap.exists ? snap.data() : null;
        render();
      }, function () { });
    } else if (state.mode === 'firebase' && fbDb) {
      plannerUnsub = fb.onSnapshot(fb.doc(fbDb, 'planner', pid), function (snap) {
        state.plan = snap.exists() ? snap.data() : null;
        render();
      }, function () { });
    } else if (state.mode === 'local') {
      state.plan = localPlanner[pid] || null;
    }
  }

  function subscribeEntries(pid) {
    subscribePlanner(pid);
    if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
    if (state.mode === 'db' && dbRef) {
      state.entries = {};
      entriesUnsub = dbRef.collection('entries').where('personId', '==', pid).onSnapshot(function (snap) {
        var m = {};
        snap.docs.forEach(function (d) { if (d.exists) { m[d.id] = d.data(); } });
        state.entries = m;
        render();
      }, function () { showToast(L.t('toastCalLoad')); });
    } else if (state.mode === 'firebase' && fbDb) {
      state.entries = {};
      var q = fb.query(fb.collection(fbDb, 'entries'), fb.where('personId', '==', pid));
      entriesUnsub = fb.onSnapshot(q, function (snap) {
        var m = {};
        snap.forEach(function (d) { m[d.id] = d.data(); });
        state.entries = m;
        render();
      }, function () { showToast(L.t('toastCalLoad')); });
    }
  }

  function ensureSelection() {
    var ids = Object.keys(state.people).sort(function (a, b) {
      return (state.people[a].name || '').localeCompare(state.people[b].name || '');
    });
    var saved = null;
    try { saved = (JSON.parse(localStorage.getItem(LS_UI) || '{}')).personId; } catch (e) { }
    if (state.personId && state.people[state.personId]) return;
    var mine = myPersonId();
    state.personId = (saved && state.people[saved]) ? saved
      : (mine && state.people[mine]) ? mine
        : (ids[0] || null);
    state.view = null;
    if (state.personId) subscribeEntries(state.personId);
  }

  function selectPerson(id) {
    if (state.personId === id) return;
    state.personId = id;
    state.view = null;
    saveUI();
    subscribeEntries(id);
    render();
  }

  /* people management: open in claude/local modes, admin-only in cloud mode */
  function canManagePeople() {
    return state.mode !== 'firebase' || !!state.admin;
  }

  /* which calendar belongs to the logged-in student? (matched by email) */
  function myPersonId() {
    if (state.mode !== 'firebase' || !state.user || !state.user.email) return null;
    var em = state.user.email.toLowerCase();
    var hit = null;
    Object.keys(state.people).forEach(function (id) {
      if ((state.people[id].email || '').toLowerCase() === em) hit = id;
    });
    return hit;
  }

  /* students may only change their own calendar; the admin changes any */
  function canEditPerson(pid) {
    return state.mode !== 'firebase' || !!state.admin || myPersonId() === pid;
  }

  function saveUI() {
    try {
      localStorage.setItem(LS_UI, JSON.stringify({ personId: state.personId, viewMode: state.viewMode }));
    } catch (e) { }
  }

  /* ===================== computations ===================== */
  function entryFor(pid, dateStr) { return state.entries[pid + '_' + dateStr] || null; }

  function countedHours(entry, d) {
    if (!entry || entry.status !== 'worked') return 0;
    var h = +entry.hours || 0;
    return isWeekend(d) ? h * 2 : h;
  }
  function rawHours(entry) {
    if (!entry || entry.status !== 'worked') return 0;
    return +entry.hours || 0;
  }

  function totalsFor(pid) {
    var person = state.people[pid];
    var base = 0, counted = 0, days = 0;
    Object.keys(state.entries).forEach(function (k) {
      var e = state.entries[k];
      if (e.personId !== pid || e.status !== 'worked') return;
      var d = parseDate(e.date);
      var h = +e.hours || 0;
      if (h > 0) days++;
      base += h;
      counted += isWeekend(d) ? h * 2 : h;
    });
    return { base: base, counted: counted, bonus: counted - base, days: days, person: person };
  }

  function weekTotals(pid, monday) {
    var base = 0, counted = 0;
    for (var i = 0; i < 7; i++) {
      var d = addDays(monday, i);
      var e = entryFor(pid, fmtDate(d));
      base += rawHours(e);
      counted += countedHours(e, d);
    }
    return { base: base, counted: counted, bonus: counted - base };
  }

  function monthIndex(y, m) { return y * 12 + m; }
  function clampView(person) {
    var now = new Date();
    var s = parseDate(person.start), e = parseDate(person.end);
    var vi = monthIndex(now.getFullYear(), now.getMonth());
    var si = monthIndex(s.getFullYear(), s.getMonth());
    var ei = monthIndex(e.getFullYear(), e.getMonth());
    var ci = Math.min(Math.max(vi, si), ei);
    return { y: Math.floor(ci / 12), m: ci % 12 };
  }

  /* ===================== rendering ===================== */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var storageKey = null;
  function setStorageNote(key) {
    storageKey = key;
    document.getElementById('storageNote').textContent = key ? L.t(key) : '';
  }

  /* While someone is typing in the list view, incoming data updates are
     held back — rebuilding the page would steal their cursor. The held
     update runs as soon as the focus leaves the list. */
  var pendingRender = false;
  function isEditingList() {
    var a = document.activeElement;
    return !!(a && a.closest && a.closest('.listgrid'));
  }
  function render() {
    if (isEditingList()) { pendingRender = true; return; }
    pendingRender = false;
    if (state.mode === 'firebase' && !state.user) {
      document.getElementById('peopleRow').textContent = '';
      renderGate(document.getElementById('mainArea'));
      return;
    }
    renderPeople();
    renderMain();
  }
  document.addEventListener('focusout', function () {
    if (!pendingRender) return;
    setTimeout(function () {
      if (pendingRender && !isEditingList()) render();
    }, 150);
  });

  function renderPeople() {
    var row = document.getElementById('peopleRow');
    row.textContent = '';
    if (!state.loaded) {
      row.appendChild(el('span', 'storage-note', L.t('loading')));
      return;
    }
    var ids = Object.keys(state.people).sort(function (a, b) {
      return (state.people[a].name || '').localeCompare(state.people[b].name || '');
    });
    ids.forEach(function (id) {
      var p = state.people[id];
      var b = el('button', 'chip' + (id === state.personId ? ' active' : ''), p.name);
      b.type = 'button';
      b.addEventListener('click', function () { selectPerson(id); });
      row.appendChild(b);
    });
    if (canManagePeople()) {
      var add = el('button', 'chip add', L.t('addPerson'));
      add.type = 'button';
      add.addEventListener('click', function () { openPersonModal(null); });
      row.appendChild(add);
    }

    var meta = el('div', 'person-meta');
    if (state.personId && state.people[state.personId]) {
      var p = state.people[state.personId];
      meta.appendChild(el('span', 'range', shortDate(p.start) + ' – ' + shortDate(p.end)));
      if (canManagePeople()) {
        var edit = el('button', 'icon-btn', L.t('edit'));
        edit.type = 'button';
        edit.setAttribute('aria-label', L.t('edit') + ' ' + p.name);
        edit.addEventListener('click', function () { openPersonModal(p.id); });
        meta.appendChild(edit);
      }
    }
    if (state.mode === 'firebase' && state.user) {
      if (state.admin) meta.appendChild(el('span', 'admin-pill on', L.t('adminOn')));
      var pb = el('button', 'icon-btn', L.t('profileBtn'));
      pb.type = 'button';
      pb.addEventListener('click', openProfile);
      meta.appendChild(pb);
      var ab = el('button', 'icon-btn', L.t('logout'));
      ab.type = 'button';
      ab.title = state.user.email || '';
      ab.addEventListener('click', function () { authFns.signOut(auth); });
      meta.appendChild(ab);
    }
    if (meta.childNodes.length) row.appendChild(meta);
  }

  function renderMain() {
    var main = document.getElementById('mainArea');
    main.textContent = '';
    if (!state.loaded) return;

    if (!state.personId) {
      var es = el('div', 'empty-state');
      es.appendChild(el('div', 'big', L.t('emptyBig')));
      es.appendChild(el('div', null, L.t('emptyText')));
      if (canManagePeople()) {
        var b = el('button', 'btn primary', L.t('addPerson'));
        b.type = 'button'; b.style.marginTop = '16px';
        b.addEventListener('click', function () { openPersonModal(null); });
        es.appendChild(b);
      }
      main.appendChild(es);
      return;
    }

    var person = state.people[state.personId];
    if (state.mode === 'firebase' && state.user && !state.admin && !myPersonId()) {
      main.appendChild(el('div', 'notice', L.t('noPersonLinked', { e: state.user.email || '' })));
    }
    main.appendChild(renderSummary(person));

    if (state.viewMode === 'list') {
      main.appendChild(renderListBar(person));
      main.appendChild(renderListView(person));
      return;
    }

    if (state.viewMode === 'plan') {
      main.appendChild(renderPlanBar());
      main.appendChild(renderPlanner(person));
      return;
    }

    if (!state.view) state.view = clampView(person);
    main.appendChild(renderMonthbar(person));
    main.appendChild(renderCalendar(person));
  }

  function renderSummary(person) {
    var t = totalsFor(person.id);
    var box = el('div', 'summary');

    function stat(label, valueNum, unit, sub, hero) {
      var s = el('div', 'stat' + (hero ? ' hero' : ''));
      s.appendChild(el('div', 'label', label));
      var v = el('div', 'value', fmtH(valueNum));
      v.appendChild(el('span', 'unit', ' ' + unit));
      s.appendChild(v);
      if (sub) s.appendChild(el('div', 'sub', sub));
      return s;
    }
    var hu = L.t('hourUnit');
    box.appendChild(stat(L.t('statTotal'), t.counted, hu, L.t('statTotalSub'), true));
    box.appendChild(stat(L.t('statFloor'), t.base, hu, L.t('statFloorSub')));
    box.appendChild(stat(L.t('statBonus'), t.bonus, hu, L.t('statBonusSub')));
    box.appendChild(stat(L.t('statDays'), t.days, t.days === 1 ? L.t('dayOne') : L.t('dayMany'), shortDate(person.start) + ' – ' + shortDate(person.end)));
    return box;
  }

  function renderMonthbar(person) {
    var bar = el('div', 'monthbar');
    var s = parseDate(person.start), e = parseDate(person.end);
    var vi = monthIndex(state.view.y, state.view.m);
    var si = monthIndex(s.getFullYear(), s.getMonth());
    var ei = monthIndex(e.getFullYear(), e.getMonth());

    var prev = el('button', 'nav-btn', '‹'); prev.type = 'button';
    prev.setAttribute('aria-label', L.t('prevMonth'));
    prev.disabled = vi <= si;
    prev.addEventListener('click', function () {
      var i = vi - 1; state.view = { y: Math.floor(i / 12), m: i % 12 }; render();
    });
    var next = el('button', 'nav-btn', '›'); next.type = 'button';
    next.setAttribute('aria-label', L.t('nextMonth'));
    next.disabled = vi >= ei;
    next.addEventListener('click', function () {
      var i = vi + 1; state.view = { y: Math.floor(i / 12), m: i % 12 }; render();
    });

    bar.appendChild(prev);
    bar.appendChild(el('h2', null, MONTHS[state.view.m] + ' ' + state.view.y));
    bar.appendChild(next);

    bar.appendChild(modeSeg());
    bar.appendChild(buildLegend());
    return bar;
  }

  /* the calendar / list switch */
  function modeSeg() {
    var seg = el('div', 'mode-seg');
    [['cal', 'viewCal'], ['list', 'viewList'], ['plan', 'viewPlan']].forEach(function (m) {
      var b = el('button', state.viewMode === m[0] ? 'on' : '', L.t(m[1]));
      b.type = 'button';
      b.addEventListener('click', function () {
        if (state.viewMode === m[0]) return;
        state.viewMode = m[0];
        saveUI();
        render();
      });
      seg.appendChild(b);
    });
    return seg;
  }

  function buildLegend() {
    var legend = el('div', 'legend');
    function key(cls, txt) {
      var k = el('span', 'key');
      k.appendChild(el('span', 'dot ' + cls, ''));
      k.appendChild(document.createTextNode(txt));
      return k;
    }
    legend.appendChild(key('worked', L.t('legWorked')));
    legend.appendChild(key('free', L.t('legFree')));
    legend.appendChild(key('x2', L.t('legX2')));
    legend.appendChild(el('span', 'key', L.t('legMondays')));
    legend.appendChild(el('span', 'key', '✓ ' + L.t('confirmed')));
    return legend;
  }

  /* ============ compact list view (like the paper stage sheet) ============ */
  function renderListBar(person) {
    var bar = el('div', 'monthbar');
    bar.appendChild(modeSeg());
    bar.appendChild(el('h2', null, shortDate(person.start) + ' – ' + shortDate(person.end)));
    bar.appendChild(buildLegend());
    return bar;
  }

  function renderListView(person) {
    var wrap = el('div', 'listgrid');
    var s = parseDate(person.start), e = parseDate(person.end);
    var si = monthIndex(s.getFullYear(), s.getMonth());
    var ei = monthIndex(e.getFullYear(), e.getMonth());
    var tStr = todayStr();
    for (var i = si; i <= ei; i++) {
      wrap.appendChild(renderMonthCard(person, Math.floor(i / 12), ((i % 12) + 12) % 12, tStr));
    }
    return wrap;
  }

  /* one month as a small, DIRECTLY EDITABLE table, like the paper sheet:
     Datum | Dag | Uren | Van | Tot | ×2 | Opmerkingen.
     Type straight into the cells — each row saves itself when you leave a
     field. In the Uren column a number means worked; a word (vrij, ziek,
     vak.) means free; emptying the whole row clears the day.
     Mondays are left out entirely — Wenine is closed, same as the sheet. */
  function renderMonthCard(person, y, m, tStr) {
    var card = el('div', 'mcard');
    card.appendChild(el('h3', null, MONTHS[m] + ' ' + y));
    var table = el('table', 'mtab');

    var thead = el('thead');
    var hr = el('tr');
    [L.t('colDate'), L.t('colDay'), L.t('hours'), L.t('from'), L.t('to'), L.t('colExtra'), L.t('note')]
      .forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    var tfootBase = null, tfootCounted = null;

    function refreshFoot() {
      var base = 0, counted = 0;
      var lastD = new Date(y, m + 1, 0).getDate();
      for (var dd = 1; dd <= lastD; dd++) {
        var dx = new Date(y, m, dd);
        var dsx = fmtDate(dx);
        if (dsx < person.start || dsx > person.end || isMonday(dx)) continue;
        var ex = entryFor(person.id, dsx);
        base += rawHours(ex);
        counted += countedHours(ex, dx);
      }
      tfootBase.textContent = fmtH(base) + L.t('hourUnit');
      tfootCounted.textContent = counted !== base ? '×2 → ' + fmtH(counted) + L.t('hourUnit') : '';
    }

    var lastDay = new Date(y, m + 1, 0).getDate();
    for (var day = 1; day <= lastDay; day++) {
      (function (day) {
        var d = new Date(y, m, day);
        var ds = fmtDate(d);
        if (ds < person.start || ds > person.end) return;
        if (isMonday(d)) return;
        var weekend = isWeekend(d);
        var entry = entryFor(person.id, ds);

        var tr = el('tr');
        if (ds === tStr) tr.classList.add('today-row');
        var dateTd = el('td', 'c-date', pad(day) + '-' + pad(m + 1));
        if (entry && entry.confirmed) {
          var bc = el('span', 'b-conf', ' ✓');
          bc.title = L.t('confirmedLock');
          dateTd.appendChild(bc);
        } else if (entry && entry.editedByAdmin) {
          var ba = el('span', 'b-admin', ' ✎');
          ba.title = L.t('byAdmin');
          dateTd.appendChild(ba);
        }
        tr.appendChild(dateTd);
        tr.appendChild(el('td', weekend ? 'wkd' : null, DAY_SHORT[dowMon(d)]));

        var uTd = el('td', 'e');
        var uIn = document.createElement('input');
        uIn.type = 'text';
        uIn.className = 'cin cin-uren';
        uIn.setAttribute('aria-label', L.t('hours') + ' ' + ds);
        if (entry && entry.status === 'worked') { uIn.value = fmtH(+entry.hours || 0); uTd.classList.add('u-worked'); }
        else if (entry && entry.status === 'free') { uIn.value = entry.label || L.t('free'); uTd.classList.add('u-free'); }
        uTd.appendChild(uIn);
        tr.appendChild(uTd);

        function timeInput(val) {
          var i = document.createElement('input');
          i.type = 'time';
          i.className = 'cin cin-time';
          i.value = val || '';
          return i;
        }
        var fIn = timeInput(entry && entry.from);
        var tIn = timeInput(entry && entry.to);
        var fTd = el('td', 'e'); fTd.appendChild(fIn); tr.appendChild(fTd);
        var tTd = el('td', 'e'); tTd.appendChild(tIn); tr.appendChild(tTd);

        var exTd = el('td', 'c-extra', '');
        tr.appendChild(exTd);

        var nTd = el('td', 'e c-note');
        var nIn = document.createElement('input');
        nIn.type = 'text';
        nIn.className = 'cin cin-note';
        nIn.value = entry && entry.note ? entry.note : '';
        nTd.appendChild(nIn);
        tr.appendChild(nTd);

        /* a confirmed day is locked for everyone except the admin;
           other people's calendars are read-only for students */
        var locked = (state.mode === 'firebase' && entry && entry.confirmed && !state.admin) || !canEditPerson(person.id);
        if (locked) {
          [uIn, fIn, tIn, nIn].forEach(function (i) { i.disabled = true; });
          tr.classList.add('locked');
        }

        function refreshExtra(en) {
          exTd.textContent = (en && en.status === 'worked' && weekend && +en.hours > 0)
            ? '+' + fmtH(+en.hours) : '';
        }
        refreshExtra(entry);

        /* filling both times auto-computes the hours, like the pop-up */
        function onTimes() {
          var auto = calcHours(fIn.value, tIn.value);
          if (auto != null) uIn.value = fmtH(auto);
        }
        fIn.addEventListener('change', onTimes);
        tIn.addEventListener('change', onTimes);

        function saveRow() {
          var raw = uIn.value.trim();
          var from = fIn.value || '';
          var to = tIn.value || '';
          var note = nIn.value.trim();
          var key = person.id + '_' + ds;
          var existing = state.entries[key];
          var isAdmin = !!state.admin;
          if (!canEditPerson(person.id)) { showToast(L.t('toastNotYours')); return; }
          if (state.mode === 'firebase' && existing && existing.confirmed && !isAdmin) {
            showToast(L.t('confirmedLock'));
            return;
          }
          var keepConf = !!(existing && existing.confirmed && isAdmin);

          /* everything emptied: clear the day */
          if (!raw && !from && !to && !note) {
            if (!existing) return;
            delete state.entries[key];
            store.deleteEntry(key).catch(function () { showToast(L.t('toastClearFail')); });
            uTd.className = 'e';
            refreshExtra(null);
            refreshFoot();
            pendingRender = true;
            return;
          }

          var numTxt = raw.replace(',', '.').replace(/[uh]\s*$/i, '');
          var num = numTxt === '' ? NaN : +numTxt;
          var en;
          if (raw !== '' && isNaN(num)) {
            /* a word (vrij, ziek, vak.) = not working that day */
            en = { personId: person.id, date: ds, status: 'free', from: '', to: '', hours: 0, note: note, label: raw.slice(0, 20), confirmed: keepConf, editedByAdmin: isAdmin };
          } else {
            var h = !isNaN(num) ? num : (calcHours(from, to) || 0);
            en = { personId: person.id, date: ds, status: 'worked', from: from, to: to, hours: Math.max(0, Math.min(24, h)), note: note, label: '', confirmed: keepConf, editedByAdmin: isAdmin };
          }
          if (existing &&
            existing.status === en.status && +existing.hours === +en.hours &&
            (existing.from || '') === en.from && (existing.to || '') === en.to &&
            (existing.note || '') === en.note && (existing.label || '') === en.label) return;

          state.entries[key] = en;
          store.saveEntry(en).catch(function () { showToast(L.t('toastSaveFail')); });
          uTd.className = 'e ' + (en.status === 'worked' ? 'u-worked' : 'u-free');
          refreshExtra(en);
          refreshFoot();
          pendingRender = true;
        }
        [uIn, fIn, tIn, nIn].forEach(function (inp) {
          inp.addEventListener('change', saveRow);
        });

        tbody.appendChild(tr);
      })(day);
    }
    table.appendChild(tbody);

    var tfoot = el('tfoot');
    var fr = el('tr');
    var lab = el('td', null, L.t('monthTotal'));
    lab.colSpan = 2;
    fr.appendChild(lab);
    tfootBase = el('td', 'u-worked', '');
    fr.appendChild(tfootBase);
    tfootCounted = el('td', 'c-extra', '');
    tfootCounted.colSpan = 4;
    fr.appendChild(tfootCounted);
    tfoot.appendChild(fr);
    table.appendChild(tfoot);
    refreshFoot();

    card.appendChild(table);
    return card;
  }

  function renderCalendar(person) {
    var scroll = el('div', 'cal-scroll');
    var cal = el('div', 'cal');
    DAY_SHORT.forEach(function (d) { cal.appendChild(el('div', 'head', d)); });
    cal.appendChild(el('div', 'head weekcol', L.t('weekCol')));

    var y = state.view.y, m = state.view.m;
    var monthStart = new Date(y, m, 1);
    var monthEnd = new Date(y, m + 1, 0);
    var gridStart = addDays(monthStart, -dowMon(monthStart));
    var gridEnd = addDays(monthEnd, 6 - dowMon(monthEnd));
    var startStr = person.start, endStr = person.end;
    var tStr = todayStr();

    var d = new Date(gridStart);
    while (d <= gridEnd) {
      var monday = new Date(d);
      for (var i = 0; i < 7; i++) {
        cal.appendChild(renderCell(person, new Date(d), m, startStr, endStr, tStr));
        d = addDays(d, 1);
      }
      var wt = weekTotals(person.id, monday);
      var wcell = el('div', 'cell weektotal');
      wcell.appendChild(el('div', 'wk', 'W' + isoWeek(monday)));
      wcell.appendChild(el('div', 'hrs', fmtH(wt.counted) + ' ' + L.t('hourUnit')));
      if (wt.bonus > 0) wcell.appendChild(el('div', 'bonus', L.t('inclBonus', { x: fmtH(wt.bonus) })));
      wcell.title = L.t('weekTitle', { d: shortDate(fmtDate(monday)), b: fmtH(wt.base), c: fmtH(wt.counted) });
      cal.appendChild(wcell);
    }
    scroll.appendChild(cal);
    return scroll;
  }

  function renderCell(person, d, viewMonth, startStr, endStr, tStr) {
    var ds = fmtDate(d);
    var inRange = ds >= startStr && ds <= endStr;
    var closed = isMonday(d);
    var e = entryFor(person.id, ds);
    var locked = (state.mode === 'firebase' && e && e.confirmed && !state.admin) || !canEditPerson(person.id);
    var clickable = inRange && !closed && !locked;

    var cell = el(clickable ? 'button' : 'div', 'cell');
    if (clickable) {
      cell.type = 'button';
      cell.addEventListener('click', function () { openDayModal(ds); });
      cell.setAttribute('aria-label', niceDate(ds));
    }
    if (d.getMonth() !== viewMonth) cell.classList.add('outmonth');
    if (!inRange) cell.classList.add('offrange');
    if (closed && inRange) cell.classList.add('closed');
    if (ds === tStr) cell.classList.add('today');

    var head = el('div', 'daynum', String(d.getDate()));
    if (ds === tStr) head.setAttribute('data-today', L.t('today'));
    if (isWeekend(d) && inRange) {
      head.appendChild(el('span', 'badge-x2', '×2'));
    }
    if (e && e.confirmed && inRange && !closed) {
      var cbdg = el('span', 'badge-conf', '✓');
      cbdg.title = L.t('confirmedLock');
      head.appendChild(cbdg);
    }
    if (e && e.editedByAdmin && inRange && !closed) {
      var abdg = el('span', 'badge-admin', '✎');
      abdg.title = L.t('byAdmin');
      head.appendChild(abdg);
    }
    cell.appendChild(head);

    if (closed && inRange) {
      cell.appendChild(el('div', 'closed-label', L.t('closed')));
      return cell;
    }
    if (!inRange) return cell;

    if (e) {
      if (e.status === 'worked') {
        var h = +e.hours || 0;
        var chip = el('span', 'entry-chip worked', fmtH(h) + ' ' + L.t('hourUnit'));
        if (isWeekend(d)) chip.title = L.t('countsAsTitle', { h: fmtH(h * 2) });
        cell.appendChild(chip);
        if (e.from && e.to) cell.appendChild(el('div', 'times', e.from + ' – ' + e.to));
      } else {
        cell.appendChild(el('span', 'entry-chip free', e.label || L.t('free')));
      }
      if (e.note) {
        var nm = el('div', 'notemark', '✎ ' + e.note);
        nm.title = e.note;
        cell.appendChild(nm);
      }
    }
    return cell;
  }

  /* ============ planner: can I reach my hours in time? ============ */
  function planCfg(person) {
    var p = (state.plan && state.plan.personId === person.id) ? state.plan : null;
    return {
      personId: person.id,
      target: p && +p.target > 0 ? +p.target : 1000,
      days: p && p.days && p.days.length ? p.days.slice() : [1, 2, 3, 4],  // Tue–Fri
      hoursPerDay: p && +p.hoursPerDay > 0 ? +p.hoursPerDay : 8
    };
  }

  /* Walk every day from tomorrow to the deadline. A day counts when it is
     one of the chosen weekdays, not a Monday (closed), and not already
     filled in. Weekend days contribute double, same as everywhere else. */
  function planCalc(person, cfg) {
    var t = totalsFor(person.id);
    var remaining = Math.max(0, cfg.target - t.counted);
    var end = parseDate(person.end);
    var capacity = 0, cum = 0, finish = null;
    var monthly = {};
    var d = addDays(new Date(), 1);
    while (d <= end) {
      var wd = dowMon(d);
      var ds = fmtDate(d);
      if (wd !== 0 && cfg.days.indexOf(wd) !== -1 && !entryFor(person.id, ds)) {
        var add = cfg.hoursPerDay * (isWeekend(d) ? 2 : 1);
        capacity += add;
        monthly[d.getFullYear() + '-' + d.getMonth()] = (monthly[d.getFullYear() + '-' + d.getMonth()] || 0) + add;
        if (!finish && remaining > 0) {
          cum += add;
          if (cum >= remaining) finish = ds;
        }
      }
      d = addDays(d, 1);
    }
    var weekly = 0;
    cfg.days.forEach(function (w) { weekly += cfg.hoursPerDay * (w >= 5 ? 2 : 1); });
    var daysLeft = Math.max(1, Math.round((end - new Date()) / 864e5));
    var needWeekly = remaining / Math.max(daysLeft / 7, 0.01);
    return {
      counted: t.counted, target: cfg.target, remaining: remaining,
      capacity: capacity, finish: finish, weekly: weekly,
      needWeekly: needWeekly, monthly: monthly
    };
  }

  function renderPlanBar() {
    var bar = el('div', 'monthbar');
    bar.appendChild(modeSeg());
    bar.appendChild(el('h2', null, L.t('viewPlan')));
    return bar;
  }

  function renderPlanner(person) {
    var cfg = planCfg(person);
    var res = planCalc(person, cfg);
    var wrap = el('div', 'plan-wrap');

    function saveCfg() {
      if (!canEditPerson(person.id)) { showToast(L.t('toastNotYours')); render(); return; }
      cfg.days.sort();
      var p = { personId: person.id, target: cfg.target, days: cfg.days, hoursPerDay: cfg.hoursPerDay };
      state.plan = p;
      store.savePlanner(p).catch(function () { showToast(L.t('toastSaveFail')); });
      render();
    }

    /* ---------- settings card ---------- */
    var set = el('div', 'plan-card');
    set.appendChild(el('h3', null, L.t('planSettings')));

    function numField(labelKey, value, step, onChange) {
      var f = el('div', 'field');
      f.appendChild(el('label', null, L.t(labelKey)));
      var i = document.createElement('input');
      i.type = 'number'; i.step = step; i.min = step; i.value = value;
      i.addEventListener('change', function () { onChange(+i.value); });
      f.appendChild(i);
      return f;
    }
    set.appendChild(numField('planTarget', cfg.target, '1', function (v) {
      cfg.target = Math.max(1, v || 1); saveCfg();
    }));

    var df = el('div', 'field');
    df.appendChild(el('label', null, L.t('planDays')));
    var chips = el('div', 'day-chips');
    for (var wd = 1; wd <= 6; wd++) {
      (function (wd) {
        var on = cfg.days.indexOf(wd) !== -1;
        var c = el('button', 'day-chip' + (wd >= 5 ? ' wkd' : '') + (on ? ' on' : ''), DAY_SHORT[wd]);
        c.type = 'button';
        c.addEventListener('click', function () {
          var i = cfg.days.indexOf(wd);
          if (i === -1) cfg.days.push(wd); else cfg.days.splice(i, 1);
          saveCfg();
        });
        chips.appendChild(c);
      })(wd);
    }
    df.appendChild(chips);
    set.appendChild(df);

    set.appendChild(numField('planPerDay', cfg.hoursPerDay, '0.5', function (v) {
      cfg.hoursPerDay = Math.max(0.5, Math.min(24, v || 8)); saveCfg();
    }));

    var dl = el('div', 'field');
    dl.appendChild(el('label', null, L.t('planDeadline')));
    dl.appendChild(el('div', 'plan-deadline', shortDate(person.end)));
    dl.appendChild(el('div', 'hint', L.t('planDeadlineNote')));
    set.appendChild(dl);
    set.appendChild(el('div', 'plan-note', L.t('planHint')));
    wrap.appendChild(set);

    /* ---------- result card ---------- */
    var out = el('div', 'plan-card');
    var verdict;
    if (res.remaining === 0) {
      verdict = el('div', 'verdict ok', L.t('planVerdictDone', { t: fmtH(res.target) }));
    } else if (res.finish) {
      verdict = el('div', 'verdict ok', L.t('planVerdictOk', {
        t: fmtH(res.target), d: shortDate(res.finish),
        s: fmtH(res.capacity - res.remaining), e: shortDate(person.end)
      }));
    } else {
      verdict = el('div', 'verdict bad', L.t('planVerdictShort', {
        e: shortDate(person.end), x: fmtH(res.counted + res.capacity),
        t: fmtH(res.target), y: fmtH(res.remaining - res.capacity)
      }));
    }
    out.appendChild(verdict);

    var pct = Math.min(100, res.target ? res.counted / res.target * 100 : 0);
    var pl = el('div', 'plan-progress-label');
    pl.appendChild(el('strong', null, fmtH(res.counted) + ' / ' + fmtH(res.target) + ' ' + L.t('hourUnit')));
    pl.appendChild(document.createTextNode(' · ' + Math.round(pct) + '%'));
    out.appendChild(pl);
    var pr = el('div', 'progress');
    var fill = el('div', 'fill', '');
    fill.style.width = pct + '%';
    pr.appendChild(fill);
    out.appendChild(pr);

    var stats = el('div', 'plan-stats');
    function ps(labelKey, val) {
      var s = el('div', 'ps');
      s.appendChild(el('div', 'l', L.t(labelKey)));
      s.appendChild(el('div', 'v', val));
      stats.appendChild(s);
    }
    ps('planRemaining', fmtH(res.remaining) + ' ' + L.t('hourUnit'));
    ps('planWeekly', fmtH(res.weekly) + ' ' + L.t('hourUnit'));
    ps('planNeedWeekly', fmtH(Math.max(0, res.needWeekly)) + ' ' + L.t('hourUnit'));
    ps('planFinish', res.remaining === 0 ? '✓' : (res.finish ? shortDate(res.finish) : '—'));
    out.appendChild(stats);
    wrap.appendChild(out);

    /* ---------- month-by-month projection ---------- */
    var mt = el('div', 'plan-card plan-months');
    mt.appendChild(el('h3', null, L.t('planSchedule')));
    var tbl = el('table', 'mtab');
    var th = el('thead');
    var hr2 = el('tr');
    [L.t('planMonth'), L.t('planPlanned'), L.t('planCum')].forEach(function (h) {
      hr2.appendChild(el('th', null, h));
    });
    th.appendChild(hr2);
    tbl.appendChild(th);
    var tb = el('tbody');
    var now = new Date();
    var mi = monthIndex(now.getFullYear(), now.getMonth());
    var endD = parseDate(person.end);
    var me = monthIndex(endD.getFullYear(), endD.getMonth());
    var cum = res.counted;
    var hit = res.counted >= res.target;
    for (var i = mi; i <= me; i++) {
      var yy = Math.floor(i / 12), mm = ((i % 12) + 12) % 12;
      var add = res.monthly[yy + '-' + mm] || 0;
      cum += add;
      var tr = el('tr');
      tr.appendChild(el('td', null, MONTHS[mm] + ' ' + yy));
      tr.appendChild(el('td', null, add ? '+' + fmtH(add) + ' ' + L.t('hourUnit') : '—'));
      tr.appendChild(el('td', 'u-worked', fmtH(cum) + ' ' + L.t('hourUnit')));
      if (!hit && cum >= res.target) { tr.classList.add('hitrow'); hit = true; }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    mt.appendChild(tbl);
    wrap.appendChild(mt);

    return wrap;
  }

  /* ===================== day modal ===================== */
  var dayOverlay = document.getElementById('dayOverlay');
  var inFrom = document.getElementById('inFrom');
  var inTo = document.getElementById('inTo');
  var inHours = document.getElementById('inHours');
  var inNote = document.getElementById('inNote');
  var hoursBlock = document.getElementById('hoursBlock');
  var calcLine = document.getElementById('calcLine');

  function openDayModal(ds) {
    editingDate = ds;
    var d = parseDate(ds);
    var e = entryFor(state.personId, ds);
    document.getElementById('dayTitle').textContent = niceDate(ds);
    var sub = document.getElementById('daySub');
    sub.textContent = '';
    sub.appendChild(document.createTextNode(state.people[state.personId].name + ' · '));
    if (isWeekend(d)) {
      sub.appendChild(el('span', 'x2note', L.t('subWeekend')));
    } else {
      sub.appendChild(document.createTextNode(L.t('subWeekday')));
    }
    if (e && e.editedByAdmin) {
      sub.appendChild(document.createTextNode(' · '));
      sub.appendChild(el('span', 'x2note', L.t('byAdmin')));
    }
    editStatus = e ? e.status : 'worked';
    inFrom.value = e && e.from ? e.from : '';
    inTo.value = e && e.to ? e.to : '';
    inHours.value = e && e.hours ? e.hours : '';
    inNote.value = e && e.note ? e.note : '';
    document.getElementById('btnDeleteEntry').style.visibility = e ? 'visible' : 'hidden';
    syncStatusUI();
    updateCalcLine();
    dayOverlay.classList.remove('hidden');
    inFrom.focus();
  }
  function closeDayModal() { dayOverlay.classList.add('hidden'); editingDate = null; }

  function syncStatusUI() {
    var w = document.getElementById('segWorked'), f = document.getElementById('segFree');
    w.classList.toggle('on', editStatus === 'worked');
    f.classList.toggle('on', editStatus === 'free');
    hoursBlock.classList.toggle('disabled-block', editStatus !== 'worked');
  }
  document.getElementById('segWorked').addEventListener('click', function () { editStatus = 'worked'; syncStatusUI(); });
  document.getElementById('segFree').addEventListener('click', function () { editStatus = 'free'; syncStatusUI(); });

  function updateCalcLine() {
    calcLine.textContent = '';
    var auto = calcHours(inFrom.value, inTo.value);
    var h = inHours.value !== '' ? +inHours.value : (auto != null ? auto : 0);
    if (editingDate == null) return;
    var weekend = isWeekend(parseDate(editingDate));
    calcLine.appendChild(document.createTextNode(L.t('countsAs')));
    calcLine.appendChild(el('strong', null, fmtH(weekend ? h * 2 : h) + ' ' + L.t('hourUnit')));
    if (weekend && h > 0) calcLine.appendChild(el('span', 'x2', L.t('x2weekend')));
  }
  function onTimesChanged() {
    var auto = calcHours(inFrom.value, inTo.value);
    if (auto != null) inHours.value = auto;
    updateCalcLine();
  }
  inFrom.addEventListener('input', onTimesChanged);
  inTo.addEventListener('input', onTimesChanged);
  inHours.addEventListener('input', updateCalcLine);

  document.getElementById('btnCancelDay').addEventListener('click', closeDayModal);
  document.getElementById('btnSaveDay').addEventListener('click', function () {
    if (!editingDate || !state.personId) return;
    if (!canEditPerson(state.personId)) { showToast(L.t('toastNotYours')); return; }
    var prevE = entryFor(state.personId, editingDate);
    var entry = {
      personId: state.personId,
      date: editingDate,
      status: editStatus,
      from: editStatus === 'worked' ? (inFrom.value || '') : '',
      to: editStatus === 'worked' ? (inTo.value || '') : '',
      hours: editStatus === 'worked' ? Math.max(0, Math.min(24, +inHours.value || 0)) : 0,
      note: inNote.value.trim(),
      label: '',
      confirmed: !!(prevE && prevE.confirmed && state.admin),
      editedByAdmin: !!state.admin
    };
    if (entry.status === 'worked' && entry.hours === 0 && !entry.note) {
      showToast(L.t('toastHoursFirst'));
      return;
    }
    var key = entry.personId + '_' + entry.date;
    store.saveEntry(entry).then(function () {
      state.entries[key] = entry;
      closeDayModal(); render();
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  });
  document.getElementById('btnDeleteEntry').addEventListener('click', function () {
    if (!editingDate) return;
    if (!canEditPerson(state.personId)) { showToast(L.t('toastNotYours')); return; }
    var key = state.personId + '_' + editingDate;
    store.deleteEntry(key).then(function () {
      closeDayModal(); render();
    }).catch(function () { showToast(L.t('toastClearFail')); });
  });

  /* ===================== person modal ===================== */
  var personOverlay = document.getElementById('personOverlay');
  var inName = document.getElementById('inName');
  var inStart = document.getElementById('inStart');
  var inEnd = document.getElementById('inEnd');

  function openPersonModal(id) {
    editingPersonId = id;
    var p = id ? state.people[id] : null;
    document.getElementById('personTitle').textContent = p ? L.t('personTitleEdit', { n: p.name }) : L.t('personTitleAdd');
    inName.value = p ? p.name : '';
    document.getElementById('inPersonEmail').value = p && p.email ? p.email : '';
    inStart.value = p ? p.start : DEFAULT_START;
    inEnd.value = p ? p.end : DEFAULT_END;
    var del = document.getElementById('btnDeletePerson');
    del.classList.toggle('hidden', !p);
    del.textContent = L.t('removePerson');
    deleteArmed = false;

    /* offer registered account emails as suggestions in the email field */
    var dl = document.getElementById('accountsList');
    dl.textContent = '';
    if (state.mode === 'firebase' && fbDb) {
      fb.getDocs(fb.collection(fbDb, 'accounts')).then(function (snap) {
        snap.forEach(function (d) {
          var a = d.data() || {};
          var o = document.createElement('option');
          o.value = a.email || d.id;
          var nm = ((a.firstName || '') + ' ' + (a.lastName || '')).trim();
          if (nm) o.label = nm;
          dl.appendChild(o);
        });
      }).catch(function () { });
    }

    personOverlay.classList.remove('hidden');
    inName.focus();
  }
  function closePersonModal() { personOverlay.classList.add('hidden'); editingPersonId = null; }

  document.getElementById('btnCancelPerson').addEventListener('click', closePersonModal);
  document.getElementById('btnSavePerson').addEventListener('click', function () {
    var name = inName.value.trim();
    if (!name) { showToast(L.t('toastName')); return; }
    if (!inStart.value || !inEnd.value) { showToast(L.t('toastDates')); return; }
    if (inEnd.value < inStart.value) { showToast(L.t('toastEndBeforeStart')); return; }
    var id = editingPersonId;
    if (!id) {
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'person';
      id += '-' + Math.random().toString(36).slice(2, 6);
    }
    var p = {
      id: id, name: name, start: inStart.value, end: inEnd.value,
      email: (document.getElementById('inPersonEmail').value || '').trim().toLowerCase()
    };
    store.savePerson(p).then(function () {
      state.people[id] = p;
      closePersonModal();
      state.view = null;
      selectPerson(id);
      render();
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  });
  var deleteArmed = false;
  document.getElementById('btnDeletePerson').addEventListener('click', function () {
    if (!editingPersonId) return;
    if (!deleteArmed) {
      deleteArmed = true;
      this.textContent = L.t('removeConfirm');
      return;
    }
    var pid = editingPersonId;
    // best-effort: remove this person's loaded entries too
    if (state.mode !== 'local') {
      Object.keys(state.entries).forEach(function (k) {
        if (state.entries[k].personId === pid) store.deleteEntry(k);
      });
    }
    store.deletePerson(pid).then(function () {
      delete state.people[pid];
      closePersonModal();
      state.personId = null;
      ensureSelection();
      render();
    }).catch(function () { showToast(L.t('toastRemoveFail')); });
  });

  /* ============== login gate (cloud mode: login comes first) ============== */
  var gateMode = 'login'; // 'login' | 'register'
  function renderGate(main) {
    main.textContent = '';
    var card = el('div', 'gate-card' + (gateMode === 'register' ? ' wide' : ''));
    card.appendChild(el('h3', null, L.t(gateMode === 'login' ? 'gateTitle' : 'registerBtn')));
    card.appendChild(el('div', 'modal-sub', L.t('gateSub')));

    /* registration asks for the student's details, stored with the account */
    var extra = null;
    if (gateMode === 'register') {
      extra = {};
      var grid = el('div', 'gate-grid');
      function gf(key, type) {
        var f = el('div', 'field');
        f.appendChild(el('label', null, L.t(key)));
        var i = document.createElement('input');
        i.type = type;
        f.appendChild(i);
        grid.appendChild(f);
        extra[key] = i;
      }
      gf('firstName', 'text');
      gf('lastName', 'text');
      gf('birthDate', 'date');
      gf('phone', 'tel');
      gf('school', 'text');
      gf('program', 'text');
      gf('schoolYear', 'text');
      card.appendChild(grid);
    }

    var fE = el('div', 'field');
    fE.appendChild(el('label', null, L.t('email')));
    var iE = document.createElement('input');
    iE.type = 'email'; iE.autocomplete = 'username';
    fE.appendChild(iE);
    card.appendChild(fE);

    var fP = el('div', 'field');
    fP.appendChild(el('label', null, L.t('password')));
    var iP = document.createElement('input');
    iP.type = 'password';
    iP.autocomplete = gateMode === 'login' ? 'current-password' : 'new-password';
    fP.appendChild(iP);
    card.appendChild(fP);

    function submit() {
      var em = iE.value.trim(), pw = iP.value;
      if (!em || !pw) { showToast(L.t('toastFill')); return; }
      var p;
      if (gateMode === 'login') {
        p = authFns.signInWithEmailAndPassword(auth, em, pw);
      } else {
        if (!extra.firstName.value.trim() || !extra.lastName.value.trim()) {
          showToast(L.t('toastName'));
          return;
        }
        p = authFns.createUserWithEmailAndPassword(auth, em, pw).then(function () {
          /* save the student's details on their account record */
          return fb.setDoc(fb.doc(fbDb, 'accounts', em.toLowerCase()), {
            email: em.toLowerCase(),
            firstName: extra.firstName.value.trim(),
            lastName: extra.lastName.value.trim(),
            birthDate: extra.birthDate.value || '',
            phone: extra.phone.value.trim(),
            school: extra.school.value.trim(),
            program: extra.program.value.trim(),
            schoolYear: extra.schoolYear.value.trim()
          });
        });
      }
      p.then(function () {
        showToast(L.t(gateMode === 'login' ? 'toastLoggedIn' : 'toastRegistered'));
      }).catch(function (err) { showToast(authErrText(err)); });
    }
    var go = el('button', 'btn primary', L.t(gateMode === 'login' ? 'loginBtn' : 'registerBtn'));
    go.type = 'button';
    go.addEventListener('click', submit);
    iP.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    card.appendChild(go);

    var sw = el('button', 'btn ghost gate-switch', L.t(gateMode === 'login' ? 'gateRegisterQ' : 'gateLoginQ'));
    sw.type = 'button';
    sw.addEventListener('click', function () {
      gateMode = gateMode === 'login' ? 'register' : 'login';
      render();
    });
    card.appendChild(sw);
    main.appendChild(card);
  }

  function authErrText(err) {
    var code = (err && err.code) || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return L.t('toastWrong');
    if (code === 'auth/email-already-in-use') return L.t('toastEmailInUse');
    if (code === 'auth/weak-password') return L.t('toastWeakPw');
    if (code === 'auth/too-many-requests') return L.t('toastTooMany');
    return L.t('toastLoginFail');
  }

  /* ===================== profile ===================== */
  var profileOverlay = document.getElementById('profileOverlay');
  function pfEl(id) { return document.getElementById(id); }

  function openProfile() {
    if (state.mode !== 'firebase' || !state.user || !state.user.email) return;
    var em = state.user.email.toLowerCase();
    pfEl('pfEmail').textContent = em;
    var mine = myPersonId();
    var lp = mine ? state.people[mine] : null;
    pfEl('pfLinked').textContent = lp
      ? L.t('profileLinked') + ': ' + lp.name + ' · ' + shortDate(lp.start) + ' – ' + shortDate(lp.end)
      : (state.admin ? 'Admin' : L.t('profileLinked') + ': —');
    ['pfFirst', 'pfLast', 'pfBirth', 'pfPhone', 'pfSchool', 'pfProgram', 'pfYear'].forEach(function (id) {
      pfEl(id).value = '';
    });
    pfEl('pfAvatar').textContent = em.charAt(0).toUpperCase();
    fb.getDoc(fb.doc(fbDb, 'accounts', em)).then(function (s) {
      var a = s.exists() ? (s.data() || {}) : {};
      pfEl('pfFirst').value = a.firstName || '';
      pfEl('pfLast').value = a.lastName || '';
      pfEl('pfBirth').value = a.birthDate || '';
      pfEl('pfPhone').value = a.phone || '';
      pfEl('pfSchool').value = a.school || '';
      pfEl('pfProgram').value = a.program || '';
      pfEl('pfYear').value = a.schoolYear || '';
      var ini = ((a.firstName || em).charAt(0) + (a.lastName || '').charAt(0)).toUpperCase();
      pfEl('pfAvatar').textContent = ini;
    }).catch(function () { });
    profileOverlay.classList.remove('hidden');
  }
  function closeProfile() { profileOverlay.classList.add('hidden'); }

  document.getElementById('btnCancelProfile').addEventListener('click', closeProfile);
  document.getElementById('btnSaveProfile').addEventListener('click', function () {
    if (state.mode !== 'firebase' || !state.user || !state.user.email) return;
    var em = state.user.email.toLowerCase();
    fb.setDoc(fb.doc(fbDb, 'accounts', em), {
      email: em,
      firstName: pfEl('pfFirst').value.trim(),
      lastName: pfEl('pfLast').value.trim(),
      birthDate: pfEl('pfBirth').value || '',
      phone: pfEl('pfPhone').value.trim(),
      school: pfEl('pfSchool').value.trim(),
      program: pfEl('pfProgram').value.trim(),
      schoolYear: pfEl('pfYear').value.trim()
    }).then(function () {
      showToast(L.t('toastSavedProfile'));
      closeProfile();
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  });

  /* ===================== shared UI ===================== */
  [dayOverlay, personOverlay, profileOverlay].forEach(function (ov) {
    ov.addEventListener('mousedown', function (ev) {
      if (ev.target === ov) {
        if (ov === dayOverlay) closeDayModal();
        else if (ov === personOverlay) closePersonModal();
        else closeProfile();
      }
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!dayOverlay.classList.contains('hidden')) closeDayModal();
      if (!personOverlay.classList.contains('hidden')) closePersonModal();
      if (!profileOverlay.classList.contains('hidden')) closeProfile();
    }
  });

  var toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ===================== language ===================== */
  var langSel = document.getElementById('langSel');
  if (langSel) {
    langSel.value = L.get();
    langSel.addEventListener('change', function () { L.set(langSel.value); });
  }
  L.onChange(function () {
    DAY_NAMES = L.arr('dayNamesFull');
    DAY_SHORT = L.arr('dayShort');
    MONTHS = L.arr('monthsFull');
    setStorageNote(storageKey);
    render();
  });

  /* ===================== boot ===================== */
  try {
    var ui0 = JSON.parse(localStorage.getItem(LS_UI) || '{}');
    if (ui0.viewMode === 'list' || ui0.viewMode === 'plan') state.viewMode = ui0.viewMode;
  } catch (e) { }
  L.applyStatic();
  render();
  initStorage();
})();
