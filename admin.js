/* ============================================================
   Wenine Admin — behavior
   Admin-only dashboard: one table per month with every person's
   logged hours side by side. The admin can open any day to check
   it, correct it (marked ✎ "changed by admin" for the person to
   see), and confirm it (✓ — locked for everyone but the admin).
   Requires the admin login; viewers who are not logged in only
   see a login prompt.
   ============================================================ */

(function () {
  'use strict';

  /* ===================== constants & state ===================== */
  var FIREBASE_VERSION = '12.19.0';
  var FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDqMggtkv--K-_IekSMpYBywyQ5LCDqvTM',
    authDomain: 'weninehourtracker.firebaseapp.com',
    projectId: 'weninehourtracker',
    storageBucket: 'weninehourtracker.firebasestorage.app',
    messagingSenderId: '57113093874',
    appId: '1:57113093874:web:c108078d8141c6db10d26b'
  };

  var L = window.WenineLang;
  var DAY_NAMES = L.arr('dayNamesFull');
  var DAY_SHORT = L.arr('dayShort');
  var MONTHS = L.arr('monthsFull');

  var state = {
    people: {},     // id -> {id,name,start,end}
    entries: {},    // "pid_date" -> entry (only the viewed month)
    view: null,     // {y,m}
    user: null,
    admin: null,
    accounts: {},   // registered accounts with their sign-up details
    ready: false
  };
  var fb = null, fbDb = null, authFns = null, auth = null;
  var entriesUnsub = null;
  var peopleUnsub = null;
  var accountsUnsub = null;
  var editingDate = null;
  var editingPerson = null;
  var editStatus = 'worked';

  /* ===================== date helpers ===================== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dowMon(d) { return (d.getDay() + 6) % 7; }
  function isMonday(d) { return d.getDay() === 1; }
  function isWeekend(d) { var g = d.getDay(); return g === 0 || g === 6; }
  function todayStr() { return fmtDate(new Date()); }
  function niceDate(s) {
    var d = parseDate(s);
    return DAY_NAMES[dowMon(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function monthIndex(y, m) { return y * 12 + m; }
  function calcHours(from, to) {
    if (!from || !to) return null;
    var f = from.split(':'), t = to.split(':');
    var mins = (+t[0] * 60 + +t[1]) - (+f[0] * 60 + +f[1]);
    if (mins <= 0) mins += 24 * 60;
    return Math.round(mins / 60 * 100) / 100;
  }
  function fmtH(n) {
    var r = Math.round(n * 100) / 100;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(2).replace(/0$/, ''));
  }

  /* ===================== firebase ===================== */
  function init() {
    var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-auth.js')
    ]).then(function (mods) {
      var app = mods[0].initializeApp(FIREBASE_CONFIG);
      fb = mods[1];
      fbDb = fb.getFirestore(app);
      authFns = mods[2];
      auth = authFns.getAuth(app);

      var now = new Date();
      state.view = { y: now.getFullYear(), m: now.getMonth() };

      authFns.onAuthStateChanged(auth, function (user) {
        state.user = user || null;
        state.admin = null;
        if (!user) {
          if (peopleUnsub) { peopleUnsub(); peopleUnsub = null; }
          if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
          if (accountsUnsub) { accountsUnsub(); accountsUnsub = null; }
          state.people = {}; state.entries = {}; state.accounts = {}; state.ready = false;
          renderAdminArea();
          render();
          return;
        }
        recordAccount(user);
        fb.getDoc(fb.doc(fbDb, 'admins', (user.email || '').toLowerCase())).then(function (s) {
          state.admin = s.exists() ? user : null;
          if (state.admin) {
            if (!peopleUnsub) {
              peopleUnsub = fb.onSnapshot(fb.collection(fbDb, 'people'), function (snap) {
                var m = {};
                snap.forEach(function (d) { m[d.id] = d.data(); });
                state.people = m;
                state.ready = true;
                render();
              }, function () { showToast(L.t('toastStaff')); });
            }
            subscribeMonth();
            if (!accountsUnsub) {
              accountsUnsub = fb.onSnapshot(fb.collection(fbDb, 'accounts'), function (snap) {
                var m = {};
                snap.forEach(function (d) { m[d.id] = d.data(); });
                state.accounts = m;
                render();
              }, function () { });
            }
          }
          renderAdminArea();
          render();
        }).catch(function () { renderAdminArea(); render(); });
        renderAdminArea();
        render();
      });
      renderAdminArea();
      render();
    }).catch(function () {
      var main = document.getElementById('mainArea');
      main.textContent = '';
      main.appendChild(el('div', 'notice', L.t('offlineNotice')));
    });
  }

  /* record this account's email once, for the admin's link-picker */
  function recordAccount(user) {
    if (!user || !user.email) return;
    var em = user.email.toLowerCase();
    var ref = fb.doc(fbDb, 'accounts', em);
    fb.getDoc(ref).then(function (s) {
      if (!s.exists()) return fb.setDoc(ref, { email: em });
    }).catch(function () { });
  }

  /* all entries of the viewed month, for every person */
  function subscribeMonth() {
    if (!fb || !state.admin) return;
    if (entriesUnsub) { entriesUnsub(); entriesUnsub = null; }
    var first = fmtDate(new Date(state.view.y, state.view.m, 1));
    var last = fmtDate(new Date(state.view.y, state.view.m + 1, 0));
    var q = fb.query(
      fb.collection(fbDb, 'entries'),
      fb.where('date', '>=', first),
      fb.where('date', '<=', last)
    );
    entriesUnsub = fb.onSnapshot(q, function (snap) {
      var m = {};
      snap.forEach(function (d) { m[d.id] = d.data(); });
      state.entries = m;
      render();
    }, function () { showToast(L.t('toastCalLoad')); });
  }

  /* ===================== rendering ===================== */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function peopleSorted() {
    return Object.keys(state.people).sort(function (a, b) {
      return (state.people[a].name || '').localeCompare(state.people[b].name || '');
    }).map(function (id) { return state.people[id]; });
  }

  function renderAdminArea() {
    var area = document.getElementById('adminArea');
    area.textContent = '';
    if (!state.user) return;
    if (state.admin) area.appendChild(el('span', 'admin-pill on', L.t('adminOn')));
    var out = el('button', 'icon-btn', L.t('logout'));
    out.type = 'button';
    out.title = state.user.email || '';
    out.addEventListener('click', function () { authFns.signOut(auth); });
    area.appendChild(out);
  }

  function render() {
    var main = document.getElementById('mainArea');
    main.textContent = '';
    if (!state.view) {
      main.appendChild(el('div', 'notice', L.t('connecting')));
      return;
    }
    if (!state.user) { renderGate(main); return; }
    if (!state.admin) {
      main.appendChild(el('div', 'notice', L.t('loginSubAdmin')));
      return;
    }
    main.appendChild(renderMonthbar());
    main.appendChild(el('div', 'dash-hint', L.t('dashHint')));
    main.appendChild(renderDashboard());
    main.appendChild(renderStudents());
  }

  /* every registered account with the details filled in at sign-up */
  function renderStudents() {
    var box = el('div', 'plan-card req-box');
    box.appendChild(el('h3', null, L.t('studentsTitle')));
    var ids = Object.keys(state.accounts).sort();
    if (!ids.length) {
      box.appendChild(el('div', 'modal-sub', '—'));
      return box;
    }
    var wrap = el('div', 'tbl-wrap');
    var tbl = el('table', 'mtab');
    var th = el('thead');
    var hr = el('tr');
    [L.t('name'), L.t('email'), L.t('birthDate'), L.t('phone'), L.t('school'), L.t('program'), L.t('schoolYear'), L.t('linkedTo')]
      .forEach(function (h) { hr.appendChild(el('th', null, h)); });
    th.appendChild(hr);
    tbl.appendChild(th);
    var tb = el('tbody');
    ids.forEach(function (id) {
      var a = state.accounts[id] || {};
      var em = (a.email || id).toLowerCase();
      var linked = null;
      Object.keys(state.people).forEach(function (pid) {
        if ((state.people[pid].email || '').toLowerCase() === em) linked = state.people[pid].name;
      });
      var tr = el('tr');
      tr.appendChild(el('td', null, ((a.firstName || '') + ' ' + (a.lastName || '')).trim() || '—'));
      tr.appendChild(el('td', null, em));
      tr.appendChild(el('td', null, a.birthDate || ''));
      tr.appendChild(el('td', null, a.phone || ''));
      tr.appendChild(el('td', null, a.school || ''));
      tr.appendChild(el('td', null, a.program || ''));
      tr.appendChild(el('td', null, a.schoolYear || ''));
      tr.appendChild(el('td', linked ? 'u-worked' : null, linked || '—'));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    box.appendChild(wrap);
    return box;
  }

  function renderMonthbar() {
    var bar = el('div', 'monthbar');
    var vi = monthIndex(state.view.y, state.view.m);
    function navBtn(label, delta, aria) {
      var b = el('button', 'nav-btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', function () {
        var i = vi + delta;
        state.view = { y: Math.floor(i / 12), m: ((i % 12) + 12) % 12 };
        subscribeMonth();
        render();
      });
      return b;
    }
    bar.appendChild(navBtn('‹', -1, L.t('prevMonth')));
    bar.appendChild(el('h2', null, MONTHS[state.view.m] + ' ' + state.view.y));
    bar.appendChild(navBtn('›', 1, L.t('nextMonth')));

    var legend = el('div', 'legend');
    legend.appendChild(el('span', 'key', '✓ ' + L.t('confirmed')));
    legend.appendChild(el('span', 'key', '✎ ' + L.t('byAdmin')));
    legend.appendChild(el('span', 'key', L.t('legMondays')));
    bar.appendChild(legend);
    return bar;
  }

  function renderDashboard() {
    var people = peopleSorted();
    var scroll = el('div', 'cal-scroll');
    var table = el('table', 'adash');
    var y = state.view.y, m = state.view.m;
    var tStr = todayStr();

    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, L.t('colDate')));
    hr.appendChild(el('th', null, L.t('colDay')));
    people.forEach(function (p) { hr.appendChild(el('th', 'pcol', p.name)); });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    var lastDay = new Date(y, m + 1, 0).getDate();
    for (var day = 1; day <= lastDay; day++) {
      var d = new Date(y, m, day);
      if (isMonday(d)) continue;
      var ds = fmtDate(d);
      var tr = el('tr');
      if (ds === tStr) tr.classList.add('today-row');
      tr.appendChild(el('td', 'c-date', pad(day) + '-' + pad(m + 1)));
      tr.appendChild(el('td', isWeekend(d) ? 'wkd' : null, DAY_SHORT[dowMon(d)]));
      people.forEach(function (p) {
        tr.appendChild(cellFor(p, ds));
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    /* totals + confirm-month per person */
    var tfoot = el('tfoot');
    var fr = el('tr');
    var lab = el('td', null, L.t('monthTotal'));
    lab.colSpan = 2;
    fr.appendChild(lab);
    people.forEach(function (p) {
      var base = 0, counted = 0;
      for (var dd = 1; dd <= lastDay; dd++) {
        var dx = new Date(y, m, dd);
        if (isMonday(dx)) continue;
        var ex = state.entries[p.id + '_' + fmtDate(dx)];
        if (ex && ex.status === 'worked') {
          var h = +ex.hours || 0;
          base += h;
          counted += isWeekend(dx) ? h * 2 : h;
        }
      }
      var td = el('td');
      td.appendChild(el('div', 'u-worked', fmtH(base) + L.t('hourUnit')));
      if (counted !== base) td.appendChild(el('div', 'c-extra', '×2 → ' + fmtH(counted) + L.t('hourUnit')));
      fr.appendChild(td);
    });
    tfoot.appendChild(fr);

    var cr = el('tr');
    var pad2 = el('td', null, '');
    pad2.colSpan = 2;
    cr.appendChild(pad2);
    people.forEach(function (p) {
      var td = el('td');
      var b = el('button', 'btn small', L.t('confirmMonth'));
      b.type = 'button';
      b.addEventListener('click', function () { confirmMonth(p); });
      td.appendChild(b);
      cr.appendChild(td);
    });
    tfoot.appendChild(cr);
    table.appendChild(tfoot);

    scroll.appendChild(table);
    return scroll;
  }

  function cellFor(p, ds) {
    var td = el('td', 'acell');
    if ((p.start && ds < p.start) || (p.end && ds > p.end)) {
      td.className = 'acell offr';
      return td;
    }
    var e = state.entries[p.id + '_' + ds];
    if (e) {
      if (e.status === 'worked') {
        td.appendChild(el('div', 'h', fmtH(+e.hours || 0) + L.t('hourUnit')));
        if (e.from && e.to) td.appendChild(el('div', 't', e.from + '–' + e.to));
      } else {
        td.appendChild(el('div', 'fr', e.label || L.t('free')));
      }
      var bd = el('div', 'bds');
      if (e.confirmed) {
        td.classList.add('conf');
        var b1 = el('span', 'b-conf', '✓');
        b1.title = L.t('confirmedLock');
        bd.appendChild(b1);
      }
      if (e.editedByAdmin) {
        var b2 = el('span', 'b-admin', '✎');
        b2.title = L.t('byAdmin');
        bd.appendChild(b2);
      }
      if (e.note) {
        var b3 = el('span', 'b-note', '•');
        b3.title = e.note;
        bd.appendChild(b3);
      }
      if (bd.childNodes.length) td.appendChild(bd);
    }
    td.addEventListener('click', function () { openEditor(p, ds); });
    return td;
  }

  /* confirm every filled, unconfirmed day of this month for one person */
  function confirmMonth(p) {
    var y = state.view.y, m = state.view.m;
    var lastDay = new Date(y, m + 1, 0).getDate();
    var writes = [];
    for (var day = 1; day <= lastDay; day++) {
      var d = new Date(y, m, day);
      if (isMonday(d)) continue;
      var ds = fmtDate(d);
      var e = state.entries[p.id + '_' + ds];
      if (!e || e.confirmed) continue;
      var en = {};
      Object.keys(e).forEach(function (k) { en[k] = e[k]; });
      en.confirmed = true;
      writes.push(fb.setDoc(fb.doc(fbDb, 'entries', p.id + '_' + ds), en));
    }
    if (!writes.length) { showToast(L.t('toastNothingToConfirm')); return; }
    Promise.all(writes).then(function () {
      showToast(L.t('toastMonthConfirmed'));
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  }

  /* ===================== day editor ===================== */
  var dayOverlay = document.getElementById('dayOverlay');
  var inFrom = document.getElementById('inFrom');
  var inTo = document.getElementById('inTo');
  var inHours = document.getElementById('inHours');
  var inNote = document.getElementById('inNote');
  var chkConf = document.getElementById('chkConf');
  var hoursBlock = document.getElementById('hoursBlock');

  function openEditor(p, ds) {
    editingPerson = p;
    editingDate = ds;
    var e = state.entries[p.id + '_' + ds];
    document.getElementById('dayTitle').textContent = p.name + ' · ' + niceDate(ds);
    var sub = document.getElementById('daySub');
    sub.textContent = isWeekend(parseDate(ds)) ? L.t('subWeekend') : L.t('subWeekday');
    editStatus = e ? e.status : 'worked';
    inFrom.value = e && e.from ? e.from : '';
    inTo.value = e && e.to ? e.to : '';
    inHours.value = e && e.hours ? e.hours : '';
    inNote.value = e && e.note ? e.note : '';
    chkConf.checked = !!(e && e.confirmed);
    document.getElementById('btnDeleteEntry').style.visibility = e ? 'visible' : 'hidden';
    syncStatusUI();
    dayOverlay.classList.remove('hidden');
  }
  function closeEditor() { dayOverlay.classList.add('hidden'); editingDate = null; editingPerson = null; }

  function syncStatusUI() {
    var w = document.getElementById('segWorked'), f = document.getElementById('segFree');
    w.classList.toggle('on', editStatus === 'worked');
    f.classList.toggle('on', editStatus === 'free');
    hoursBlock.classList.toggle('disabled-block', editStatus !== 'worked');
  }
  document.getElementById('segWorked').addEventListener('click', function () { editStatus = 'worked'; syncStatusUI(); });
  document.getElementById('segFree').addEventListener('click', function () { editStatus = 'free'; syncStatusUI(); });

  function onTimes() {
    var auto = calcHours(inFrom.value, inTo.value);
    if (auto != null) inHours.value = auto;
  }
  inFrom.addEventListener('input', onTimes);
  inTo.addEventListener('input', onTimes);

  document.getElementById('btnCancelDay').addEventListener('click', closeEditor);
  document.getElementById('btnSaveDay').addEventListener('click', function () {
    if (!editingDate || !editingPerson) return;
    var key = editingPerson.id + '_' + editingDate;
    var existing = state.entries[key];
    var en = {
      personId: editingPerson.id,
      date: editingDate,
      status: editStatus,
      from: editStatus === 'worked' ? (inFrom.value || '') : '',
      to: editStatus === 'worked' ? (inTo.value || '') : '',
      hours: editStatus === 'worked' ? Math.max(0, Math.min(24, +inHours.value || 0)) : 0,
      note: inNote.value.trim(),
      label: ''
    };
    var changed = !existing ||
      existing.status !== en.status || (+existing.hours || 0) !== en.hours ||
      (existing.from || '') !== en.from || (existing.to || '') !== en.to ||
      (existing.note || '') !== en.note;
    en.label = changed ? '' : (existing && existing.label) || '';
    /* fixes by the admin are marked, so the person can see them */
    en.editedByAdmin = changed ? true : !!(existing && existing.editedByAdmin);
    en.confirmed = chkConf.checked;

    fb.setDoc(fb.doc(fbDb, 'entries', key), en).then(function () {
      closeEditor();
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  });
  document.getElementById('btnDeleteEntry').addEventListener('click', function () {
    if (!editingDate || !editingPerson) return;
    fb.deleteDoc(fb.doc(fbDb, 'entries', editingPerson.id + '_' + editingDate)).then(function () {
      closeEditor();
    }).catch(function () { showToast(L.t('toastClearFail')); });
  });

  /* ============== login gate (login comes first) ============== */
  var gateMode = 'login';
  function renderGate(main) {
    var card = el('div', 'gate-card');
    card.appendChild(el('h3', null, L.t(gateMode === 'login' ? 'gateTitle' : 'registerBtn')));
    card.appendChild(el('div', 'modal-sub', L.t('gateSub')));
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
      var pr = gateMode === 'login'
        ? authFns.signInWithEmailAndPassword(auth, em, pw)
        : authFns.createUserWithEmailAndPassword(auth, em, pw);
      pr.then(function () {
        showToast(L.t(gateMode === 'login' ? 'toastLoggedIn' : 'toastRegistered'));
      }).catch(function (err) { showToast(authErrText(err)); });
    }
    var go = el('button', 'btn primary', L.t(gateMode === 'login' ? 'loginBtn' : 'registerBtn'));
    go.type = 'button';
    go.addEventListener('click', submit);
    iP.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    card.appendChild(go);
    /* registration (with the full student form) lives on the tracker page */
    var sw = el('button', 'btn ghost gate-switch', L.t('gateRegisterQ'));
    sw.type = 'button';
    sw.addEventListener('click', function () { location.href = 'index.html'; });
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

  /* ===================== shared UI ===================== */
  dayOverlay.addEventListener('mousedown', function (ev) {
    if (ev.target === dayOverlay) closeEditor();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !dayOverlay.classList.contains('hidden')) closeEditor();
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
    renderAdminArea();
    render();
  });

  /* ===================== boot ===================== */
  L.applyStatic();
  render();
  init();
})();
