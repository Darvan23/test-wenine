/* ============================================================
   Wenine Schedule — behavior
   One shared calendar for everyone: each day shows who is
   working (green, with times) and who is free (crossed out).
   Everyone can view. Changing it requires an admin login
   (Firebase Authentication) — the database itself refuses
   writes from anyone who is not logged in.
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
  /* all visible text comes from i18n.js (window.WenineLang) */
  var L = window.WenineLang;
  var DAY_NAMES = L.arr('dayNamesFull');
  var DAY_SHORT = L.arr('dayShort');
  var MONTHS = L.arr('monthsFull');

  var state = {
    people: {},     // id -> {id,name,start,end}
    sched: {},      // "pid_date" -> {personId,date,status:'working'|'free',from,to}
    view: null,     // {y,m} month being shown
    admin: null,    // the logged-in Firebase user, or null
    ready: false
  };
  var fb = null;        // Firestore module
  var fbDb = null;      // database handle
  var authFns = null;   // Auth module
  var auth = null;      // auth handle
  var schedUnsub = null;
  var editingDate = null;

  /* ===================== date helpers ===================== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dowMon(d) { return (d.getDay() + 6) % 7; } // 0 = Monday
  function isMonday(d) { return d.getDay() === 1; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function todayStr() { return fmtDate(new Date()); }
  function niceDate(s) {
    var d = parseDate(s);
    return DAY_NAMES[dowMon(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function monthIndex(y, m) { return y * 12 + m; }

  /* the whole visible grid for a month: Monday before the 1st
     through Sunday after the last day */
  function gridRange(y, m) {
    var monthStart = new Date(y, m, 1);
    var monthEnd = new Date(y, m + 1, 0);
    return {
      start: addDays(monthStart, -dowMon(monthStart)),
      end: addDays(monthEnd, 6 - dowMon(monthEnd))
    };
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

      authFns.onAuthStateChanged(auth, function (user) {
        state.admin = user || null;
        renderAdminArea();
        render();
      });

      fb.onSnapshot(fb.collection(fbDb, 'people'), function (snap) {
        var m = {};
        snap.forEach(function (d) { m[d.id] = d.data(); });
        state.people = m;
        state.ready = true;
        render();
      }, function () { showToast(L.t('toastStaff')); });

      var now = new Date();
      state.view = { y: now.getFullYear(), m: now.getMonth() };
      subscribeMonth();
      renderAdminArea();
      render();
    }).catch(function () {
      var main = document.getElementById('mainArea');
      main.textContent = '';
      var n = document.createElement('div');
      n.className = 'notice';
      n.textContent = L.t('offlineNotice');
      main.appendChild(n);
    });
  }

  /* listen to this month's schedule; called again on month change */
  function subscribeMonth() {
    if (schedUnsub) { schedUnsub(); schedUnsub = null; }
    var r = gridRange(state.view.y, state.view.m);
    var q = fb.query(
      fb.collection(fbDb, 'schedule'),
      fb.where('date', '>=', fmtDate(r.start)),
      fb.where('date', '<=', fmtDate(r.end))
    );
    schedUnsub = fb.onSnapshot(q, function (snap) {
      var m = {};
      snap.forEach(function (d) { m[d.id] = d.data(); });
      state.sched = m;
      render();
    }, function () { showToast(L.t('toastSchedRules')); });
  }

  /* ===================== rendering ===================== */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderAdminArea() {
    var area = document.getElementById('adminArea');
    area.textContent = '';
    if (state.admin) {
      area.appendChild(el('span', 'admin-pill on', L.t('adminOn')));
      var out = el('button', 'icon-btn', L.t('logout'));
      out.type = 'button';
      out.addEventListener('click', function () { authFns.signOut(auth); });
      area.appendChild(out);
    } else {
      area.appendChild(el('span', 'admin-pill', L.t('viewOnly')));
      var btn = el('button', 'icon-btn', L.t('adminLogin'));
      btn.type = 'button';
      btn.addEventListener('click', openLogin);
      area.appendChild(btn);
    }
  }

  function render() {
    var main = document.getElementById('mainArea');
    main.textContent = '';
    if (!state.view) {
      main.appendChild(el('div', 'notice', L.t('connecting')));
      return;
    }
    main.appendChild(renderMonthbar());
    main.appendChild(renderCalendar());
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
    function key(cls, txt) {
      var k = el('span', 'key');
      k.appendChild(el('span', 'dot ' + cls, ''));
      k.appendChild(document.createTextNode(txt));
      return k;
    }
    legend.appendChild(key('worked', L.t('legWorking')));
    legend.appendChild(key('free', L.t('legFree')));
    legend.appendChild(el('span', 'key', L.t('legMondays')));
    bar.appendChild(legend);
    return bar;
  }

  function renderCalendar() {
    var scroll = el('div', 'cal-scroll');
    var cal = el('div', 'cal sched');
    DAY_SHORT.forEach(function (d) { cal.appendChild(el('div', 'head', d)); });

    var r = gridRange(state.view.y, state.view.m);
    var tStr = todayStr();
    var d = new Date(r.start);
    while (d <= r.end) {
      cal.appendChild(renderCell(new Date(d), tStr));
      d = addDays(d, 1);
    }
    scroll.appendChild(cal);
    return scroll;
  }

  function renderCell(d, tStr) {
    var ds = fmtDate(d);
    var closed = isMonday(d);
    var clickable = !!state.admin && !closed;

    var cell = el(clickable ? 'button' : 'div', 'cell');
    if (clickable) {
      cell.type = 'button';
      cell.addEventListener('click', function () { openDay(ds); });
      cell.setAttribute('aria-label', niceDate(ds));
    }
    if (d.getMonth() !== state.view.m) cell.classList.add('outmonth');
    if (closed) cell.classList.add('closed');
    if (ds === tStr) cell.classList.add('today');

    var head = el('div', 'daynum', String(d.getDate()));
    if (ds === tStr) head.setAttribute('data-today', L.t('today'));
    cell.appendChild(head);

    if (closed) {
      cell.appendChild(el('div', 'closed-label', L.t('closed')));
      return cell;
    }

    /* one chip per person who has a status this day */
    peopleSorted().forEach(function (p) {
      var e = state.sched[p.id + '_' + ds];
      if (!e) return;
      var chip = el('div', 'pchip ' + (e.status === 'working' ? 'working' : 'free'));
      chip.appendChild(el('span', 'pname', p.name));
      if (e.status === 'working' && e.from && e.to) {
        chip.appendChild(el('span', 'ptime', e.from + '–' + e.to));
      }
      chip.title = p.name + ': ' + (e.status === 'working'
        ? L.t('legWorking') + (e.from && e.to ? ' ' + e.from + '–' + e.to : '')
        : L.t('legFree'));
      cell.appendChild(chip);
    });
    return cell;
  }

  function peopleSorted() {
    return Object.keys(state.people).sort(function (a, b) {
      return (state.people[a].name || '').localeCompare(state.people[b].name || '');
    }).map(function (id) { return state.people[id]; });
  }

  /* availability window: a person only appears on days they CAN work */
  function availableOn(p, ds) {
    return (!p.start || ds >= p.start) && (!p.end || ds <= p.end);
  }

  /* ===================== day editor (admin) ===================== */
  var dayOverlay = document.getElementById('dayOverlay');
  var rowsArea = document.getElementById('rowsArea');

  function openDay(ds) {
    editingDate = ds;
    document.getElementById('dayTitle').textContent = niceDate(ds);
    rowsArea.textContent = '';

    var anyone = false;
    peopleSorted().forEach(function (p) {
      if (!availableOn(p, ds)) return;
      anyone = true;
      var e = state.sched[p.id + '_' + ds];

      var row = el('div', 'sched-row');
      row.dataset.pid = p.id;
      row.appendChild(el('span', 'rname', p.name));

      var sel = document.createElement('select');
      [['', '—'], ['working', L.t('optWorking')], ['free', L.t('optFree')]].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        sel.appendChild(opt);
      });
      sel.value = e ? e.status : '';
      row.appendChild(sel);

      var tw = el('span', 'times-wrap' + ((e && e.status === 'working') ? '' : ' hidden'));
      var from = document.createElement('input'); from.type = 'time'; from.value = e && e.from ? e.from : '';
      var to = document.createElement('input'); to.type = 'time'; to.value = e && e.to ? e.to : '';
      tw.appendChild(from);
      tw.appendChild(document.createTextNode(L.t('timeTo')));
      tw.appendChild(to);
      row.appendChild(tw);

      sel.addEventListener('change', function () {
        tw.classList.toggle('hidden', sel.value !== 'working');
      });

      row._read = function () {
        return { pid: p.id, status: sel.value, from: from.value || '', to: to.value || '' };
      };
      rowsArea.appendChild(row);
    });

    if (!anyone) {
      rowsArea.appendChild(el('div', 'modal-sub', L.t('nobodyAvail')));
    }
    dayOverlay.classList.remove('hidden');
  }
  function closeDay() { dayOverlay.classList.add('hidden'); editingDate = null; }

  document.getElementById('btnCancelDay').addEventListener('click', closeDay);
  document.getElementById('btnSaveDay').addEventListener('click', function () {
    if (!editingDate) return;
    var ds = editingDate;
    var writes = [];
    Array.prototype.forEach.call(rowsArea.querySelectorAll('.sched-row'), function (row) {
      var v = row._read();
      var key = v.pid + '_' + ds;
      var ref = fb.doc(fbDb, 'schedule', key);
      if (v.status === '') {
        if (state.sched[key]) writes.push(fb.deleteDoc(ref));
      } else {
        writes.push(fb.setDoc(ref, {
          personId: v.pid, date: ds, status: v.status,
          from: v.status === 'working' ? v.from : '',
          to: v.status === 'working' ? v.to : ''
        }));
      }
    });
    Promise.all(writes).then(function () {
      closeDay();
    }).catch(function () {
      showToast(L.t('toastSchedSave'));
    });
  });

  /* ===================== login ===================== */
  var loginOverlay = document.getElementById('loginOverlay');
  var inEmail = document.getElementById('inEmail');
  var inPassword = document.getElementById('inPassword');

  function openLogin() {
    inPassword.value = '';
    loginOverlay.classList.remove('hidden');
    inEmail.focus();
  }
  function closeLogin() { loginOverlay.classList.add('hidden'); }

  document.getElementById('btnCancelLogin').addEventListener('click', closeLogin);
  document.getElementById('btnDoLogin').addEventListener('click', doLogin);
  inPassword.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doLogin(); });

  function doLogin() {
    var email = inEmail.value.trim();
    var pw = inPassword.value;
    if (!email || !pw) { showToast(L.t('toastFill')); return; }
    authFns.signInWithEmailAndPassword(auth, email, pw).then(function () {
      closeLogin();
      showToast(L.t('toastLoggedIn'));
    }).catch(function (err) {
      var code = err && err.code ? err.code : '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        showToast(L.t('toastWrong'));
      } else if (code === 'auth/too-many-requests') {
        showToast(L.t('toastTooMany'));
      } else {
        showToast(L.t('toastLoginFail'));
      }
    });
  }

  /* ===================== shared UI ===================== */
  [dayOverlay, loginOverlay].forEach(function (ov) {
    ov.addEventListener('mousedown', function (ev) {
      if (ev.target === ov) { if (ov === dayOverlay) closeDay(); else closeLogin(); }
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (!dayOverlay.classList.contains('hidden')) closeDay();
      if (!loginOverlay.classList.contains('hidden')) closeLogin();
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
    renderAdminArea();
    render();
  });

  /* ===================== boot ===================== */
  L.applyStatic();
  render();
  init();
})();
