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
  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var state = {
    people: {},          // id -> {id,name,start,end}
    entries: {},         // "pid_date" -> {personId,date,status,from,to,hours,note}
    personId: null,
    view: null,          // {y,m}
    loaded: false,
    mode: null           // 'db' (claude.ai) | 'firebase' | 'local'
  };
  var store = null;      // {savePerson,deletePerson,saveEntry,deleteEntry}
  var dbRef = null;      // claude.ai database handle
  var fb = null;         // Firebase Firestore module (its functions)
  var fbDb = null;       // Firebase database handle
  var entriesUnsub = null;
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
      deleteEntry: function (key) { return db.doc('entries/' + key).delete(); }
    };
    db.collection('people').onSnapshot(function (snap) {
      var m = {};
      snap.docs.forEach(function (d) { if (d.exists) { m[d.id] = d.data(); } });
      state.people = m;
      state.loaded = true;
      ensureSelection();
      render();
    }, function () {
      showToast('Connection to shared storage lost.');
    });
    setStorageNote('Shared storage — everyone sees the same data');
  }

  /* Firebase: loads Google's Firestore library over the internet, then
     connects to the WenineHourTracker project. Data saved here is
     permanent, shared, and syncs live to everyone with the page open. */
  function initFirebase() {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    return Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js')
    ]).then(function (mods) {
      var app = mods[0].initializeApp(FIREBASE_CONFIG);
      fb = mods[1];
      fbDb = fb.getFirestore(app);
      state.mode = 'firebase';
      store = {
        savePerson: function (p) { return fb.setDoc(fb.doc(fbDb, 'people', p.id), p); },
        deletePerson: function (id) { return fb.deleteDoc(fb.doc(fbDb, 'people', id)); },
        saveEntry: function (e) { return fb.setDoc(fb.doc(fbDb, 'entries', e.personId + '_' + e.date), e); },
        deleteEntry: function (key) { return fb.deleteDoc(fb.doc(fbDb, 'entries', key)); }
      };
      fb.onSnapshot(fb.collection(fbDb, 'people'), function (snap) {
        var m = {};
        snap.forEach(function (d) { m[d.id] = d.data(); });
        state.people = m;
        state.loaded = true;
        seedIfEmpty();
        ensureSelection();
        render();
      }, function () {
        showToast('No access to the database — check the Firestore rules.');
      });
      setStorageNote('Shared cloud storage — everyone sees the same data');
    });
  }

  /* The very first time the cloud database is seen empty from this
     browser, create Darvan's calendar so the app doesn't start blank. */
  function seedIfEmpty() {
    if (state.mode !== 'firebase' || Object.keys(state.people).length > 0) return;
    var seeded = false;
    try { seeded = !!localStorage.getItem(LS_SEEDED); } catch (e) { }
    if (seeded) return;
    try { localStorage.setItem(LS_SEEDED, '1'); } catch (e) { }
    store.savePerson({ id: 'darvan', name: 'Darvan', start: DEFAULT_START, end: DEFAULT_END })
      .catch(function () { showToast("Couldn't write to the database — check the Firestore rules."); });
  }

  function initLocal() {
    state.mode = 'local';
    var data = {};
    try { data = JSON.parse(localStorage.getItem(LS_DATA) || '{}'); } catch (e) { data = {}; }
    state.people = data.people || {};
    state.entries = data.entries || {};
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
      deleteEntry: function (key) { delete state.entries[key]; persistLocal(); return Promise.resolve(); }
    };
    state.loaded = true;
    ensureSelection();
    render();
    setStorageNote('Saved in this browser');
  }

  function persistLocal() {
    try {
      localStorage.setItem(LS_DATA, JSON.stringify({ people: state.people, entries: state.entries }));
    } catch (e) { showToast('Could not save — browser storage is full or blocked.'); }
  }

  /* Listen to one person's logged days. Re-subscribes when you switch
     person; localStorage mode keeps everything in memory instead. */
  function subscribeEntries(pid) {
    if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
    if (state.mode === 'db' && dbRef) {
      state.entries = {};
      entriesUnsub = dbRef.collection('entries').where('personId', '==', pid).onSnapshot(function (snap) {
        var m = {};
        snap.docs.forEach(function (d) { if (d.exists) { m[d.id] = d.data(); } });
        state.entries = m;
        render();
      }, function () { showToast('Could not load this calendar.'); });
    } else if (state.mode === 'firebase' && fbDb) {
      state.entries = {};
      var q = fb.query(fb.collection(fbDb, 'entries'), fb.where('personId', '==', pid));
      entriesUnsub = fb.onSnapshot(q, function (snap) {
        var m = {};
        snap.forEach(function (d) { m[d.id] = d.data(); });
        state.entries = m;
        render();
      }, function () { showToast('Could not load this calendar.'); });
    }
  }

  function ensureSelection() {
    var ids = Object.keys(state.people).sort(function (a, b) {
      return (state.people[a].name || '').localeCompare(state.people[b].name || '');
    });
    var saved = null;
    try { saved = (JSON.parse(localStorage.getItem(LS_UI) || '{}')).personId; } catch (e) { }
    if (state.personId && state.people[state.personId]) return;
    state.personId = (saved && state.people[saved]) ? saved : (ids[0] || null);
    state.view = null;
    if (state.personId) subscribeEntries(state.personId);
  }

  function selectPerson(id) {
    if (state.personId === id) return;
    state.personId = id;
    state.view = null;
    try { localStorage.setItem(LS_UI, JSON.stringify({ personId: id })); } catch (e) { }
    subscribeEntries(id);
    render();
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
  function setStorageNote(t) { document.getElementById('storageNote').textContent = t; }

  function render() {
    renderPeople();
    renderMain();
  }

  function renderPeople() {
    var row = document.getElementById('peopleRow');
    row.textContent = '';
    if (!state.loaded) {
      row.appendChild(el('span', 'storage-note', 'Loading…'));
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
    var add = el('button', 'chip add', '+ Add person');
    add.type = 'button';
    add.addEventListener('click', function () { openPersonModal(null); });
    row.appendChild(add);

    if (state.personId && state.people[state.personId]) {
      var p = state.people[state.personId];
      var meta = el('div', 'person-meta');
      var rng = el('span', 'range', shortDate(p.start) + ' – ' + shortDate(p.end));
      var edit = el('button', 'icon-btn', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', 'Edit ' + p.name);
      edit.addEventListener('click', function () { openPersonModal(p.id); });
      meta.appendChild(rng); meta.appendChild(edit);
      row.appendChild(meta);
    }
  }

  function renderMain() {
    var main = document.getElementById('mainArea');
    main.textContent = '';
    if (!state.loaded) return;

    if (!state.personId) {
      var es = el('div', 'empty-state');
      es.appendChild(el('div', 'big', 'No calendars yet'));
      es.appendChild(el('div', null, 'Add a person to start tracking hours.'));
      var b = el('button', 'btn primary', '+ Add person');
      b.type = 'button'; b.style.marginTop = '16px';
      b.addEventListener('click', function () { openPersonModal(null); });
      es.appendChild(b);
      main.appendChild(es);
      return;
    }

    var person = state.people[state.personId];
    if (!state.view) state.view = clampView(person);

    main.appendChild(renderSummary(person));
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
    box.appendChild(stat('Total counted', t.counted, 'h', 'weekend hours count ×2', true));
    box.appendChild(stat('Hours on the floor', t.base, 'h', 'actual time worked'));
    box.appendChild(stat('Weekend bonus', t.bonus, 'h', 'extra from Sat & Sun'));
    box.appendChild(stat('Days worked', t.days, t.days === 1 ? 'day' : 'days', shortDate(person.start) + ' – ' + shortDate(person.end)));
    return box;
  }

  function renderMonthbar(person) {
    var bar = el('div', 'monthbar');
    var s = parseDate(person.start), e = parseDate(person.end);
    var vi = monthIndex(state.view.y, state.view.m);
    var si = monthIndex(s.getFullYear(), s.getMonth());
    var ei = monthIndex(e.getFullYear(), e.getMonth());

    var prev = el('button', 'nav-btn', '‹'); prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous month');
    prev.disabled = vi <= si;
    prev.addEventListener('click', function () {
      var i = vi - 1; state.view = { y: Math.floor(i / 12), m: i % 12 }; render();
    });
    var next = el('button', 'nav-btn', '›'); next.type = 'button';
    next.setAttribute('aria-label', 'Next month');
    next.disabled = vi >= ei;
    next.addEventListener('click', function () {
      var i = vi + 1; state.view = { y: Math.floor(i / 12), m: i % 12 }; render();
    });

    bar.appendChild(prev);
    bar.appendChild(el('h2', null, MONTHS[state.view.m] + ' ' + state.view.y));
    bar.appendChild(next);

    var legend = el('div', 'legend');
    function key(cls, txt) {
      var k = el('span', 'key');
      k.appendChild(el('span', 'dot ' + cls, ''));
      k.appendChild(document.createTextNode(txt));
      return k;
    }
    legend.appendChild(key('worked', 'worked'));
    legend.appendChild(key('free', 'free'));
    legend.appendChild(key('x2', 'weekend ×2'));
    var mono = el('span', 'key', 'Mondays closed');
    legend.appendChild(mono);
    bar.appendChild(legend);
    return bar;
  }

  function renderCalendar(person) {
    var scroll = el('div', 'cal-scroll');
    var cal = el('div', 'cal');
    DAY_SHORT.forEach(function (d) { cal.appendChild(el('div', 'head', d)); });
    cal.appendChild(el('div', 'head weekcol', 'Week'));

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
      wcell.appendChild(el('div', 'hrs', fmtH(wt.counted) + ' h'));
      if (wt.bonus > 0) wcell.appendChild(el('div', 'bonus', 'incl. +' + fmtH(wt.bonus) + ' bonus'));
      wcell.title = 'Week of ' + shortDate(fmtDate(monday)) + ': ' + fmtH(wt.base) + ' h worked, counts as ' + fmtH(wt.counted) + ' h';
      cal.appendChild(wcell);
    }
    scroll.appendChild(cal);
    return scroll;
  }

  function renderCell(person, d, viewMonth, startStr, endStr, tStr) {
    var ds = fmtDate(d);
    var inRange = ds >= startStr && ds <= endStr;
    var closed = isMonday(d);
    var clickable = inRange && !closed;

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
    if (isWeekend(d) && inRange) {
      head.appendChild(el('span', 'badge-x2', '×2'));
    }
    cell.appendChild(head);

    if (closed && inRange) {
      cell.appendChild(el('div', 'closed-label', 'Closed'));
      return cell;
    }
    if (!inRange) return cell;

    var e = entryFor(person.id, ds);
    if (e) {
      if (e.status === 'worked') {
        var h = +e.hours || 0;
        var chip = el('span', 'entry-chip worked', fmtH(h) + ' h');
        if (isWeekend(d)) chip.title = 'Counts as ' + fmtH(h * 2) + ' h (weekend ×2)';
        cell.appendChild(chip);
        if (e.from && e.to) cell.appendChild(el('div', 'times', e.from + ' – ' + e.to));
      } else {
        cell.appendChild(el('span', 'entry-chip free', 'Free'));
      }
      if (e.note) {
        var nm = el('div', 'notemark', '✎ ' + e.note);
        nm.title = e.note;
        cell.appendChild(nm);
      }
    }
    return cell;
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
      sub.appendChild(el('span', 'x2note', 'weekend — hours count double'));
    } else {
      sub.appendChild(document.createTextNode('weekday — hours count once'));
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
    calcLine.appendChild(document.createTextNode('Counts as '));
    calcLine.appendChild(el('strong', null, fmtH(weekend ? h * 2 : h) + ' h'));
    if (weekend && h > 0) calcLine.appendChild(el('span', 'x2', '(×2 weekend)'));
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
    var entry = {
      personId: state.personId,
      date: editingDate,
      status: editStatus,
      from: editStatus === 'worked' ? (inFrom.value || '') : '',
      to: editStatus === 'worked' ? (inTo.value || '') : '',
      hours: editStatus === 'worked' ? Math.max(0, Math.min(24, +inHours.value || 0)) : 0,
      note: inNote.value.trim()
    };
    if (entry.status === 'worked' && entry.hours === 0 && !entry.note) {
      showToast('Add the times or the hours first.');
      return;
    }
    var key = entry.personId + '_' + entry.date;
    store.saveEntry(entry).then(function () {
      state.entries[key] = entry;
      closeDayModal(); render();
    }).catch(function () { showToast("Couldn't save — you may not have edit access."); });
  });
  document.getElementById('btnDeleteEntry').addEventListener('click', function () {
    if (!editingDate) return;
    var key = state.personId + '_' + editingDate;
    store.deleteEntry(key).then(function () {
      closeDayModal(); render();
    }).catch(function () { showToast("Couldn't clear this day."); });
  });

  /* ===================== person modal ===================== */
  var personOverlay = document.getElementById('personOverlay');
  var inName = document.getElementById('inName');
  var inStart = document.getElementById('inStart');
  var inEnd = document.getElementById('inEnd');

  function openPersonModal(id) {
    editingPersonId = id;
    var p = id ? state.people[id] : null;
    document.getElementById('personTitle').textContent = p ? 'Edit ' + p.name : 'Add person';
    inName.value = p ? p.name : '';
    inStart.value = p ? p.start : DEFAULT_START;
    inEnd.value = p ? p.end : DEFAULT_END;
    var del = document.getElementById('btnDeletePerson');
    del.classList.toggle('hidden', !p);
    del.textContent = 'Remove person';
    deleteArmed = false;
    personOverlay.classList.remove('hidden');
    inName.focus();
  }
  function closePersonModal() { personOverlay.classList.add('hidden'); editingPersonId = null; }

  document.getElementById('btnCancelPerson').addEventListener('click', closePersonModal);
  document.getElementById('btnSavePerson').addEventListener('click', function () {
    var name = inName.value.trim();
    if (!name) { showToast('Give this person a name.'); return; }
    if (!inStart.value || !inEnd.value) { showToast('Pick both dates.'); return; }
    if (inEnd.value < inStart.value) { showToast('The end date is before the start date.'); return; }
    var id = editingPersonId;
    if (!id) {
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'person';
      id += '-' + Math.random().toString(36).slice(2, 6);
    }
    var p = { id: id, name: name, start: inStart.value, end: inEnd.value };
    store.savePerson(p).then(function () {
      state.people[id] = p;
      closePersonModal();
      state.view = null;
      selectPerson(id);
      render();
    }).catch(function () { showToast("Couldn't save — you may not have edit access."); });
  });
  var deleteArmed = false;
  document.getElementById('btnDeletePerson').addEventListener('click', function () {
    if (!editingPersonId) return;
    if (!deleteArmed) {
      deleteArmed = true;
      this.textContent = 'Click again to remove for good';
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
    }).catch(function () { showToast("Couldn't remove this person."); });
  });

  /* ===================== shared UI ===================== */
  [dayOverlay, personOverlay].forEach(function (ov) {
    ov.addEventListener('mousedown', function (ev) {
      if (ev.target === ov) {
        if (ov === dayOverlay) closeDayModal(); else closePersonModal();
      }
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!dayOverlay.classList.contains('hidden')) closeDayModal();
      if (!personOverlay.classList.contains('hidden')) closePersonModal();
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

  /* ===================== boot ===================== */
  render();
  initStorage();
})();
