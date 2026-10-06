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
    people: {},     // id -> {id,name,start,end,email}
    sched: {},      // "pid_date" -> {personId,date,status:'working'|'free',from,to}
    requests: {},   // "pid_date" -> {personId,date,type,note,status}
    view: null,     // {y,m} month being shown
    user: null,     // any logged-in user
    admin: null,    // the user again, when they are an admin
    ready: false
  };
  var fb = null;        // Firestore module
  var fbDb = null;      // database handle
  var authFns = null;   // Auth module
  var auth = null;      // auth handle
  var schedUnsub = null;
  var peopleUnsub = null;
  var reqUnsub = null;
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

      var now = new Date();
      state.view = { y: now.getFullYear(), m: now.getMonth() };

      /* everything is behind the login — data loads only once signed in */
      authFns.onAuthStateChanged(auth, function (user) {
        state.user = user || null;
        state.admin = null;
        if (!user) {
          if (peopleUnsub) { peopleUnsub(); peopleUnsub = null; }
          if (schedUnsub) { schedUnsub(); schedUnsub = null; }
          if (reqUnsub) { reqUnsub(); reqUnsub = null; }
          state.people = {}; state.sched = {}; state.requests = {}; state.ready = false;
          renderAdminArea();
          render();
          return;
        }
        recordAccount(user);
        fb.getDoc(fb.doc(fbDb, 'admins', (user.email || '').toLowerCase())).then(function (s) {
          state.admin = s.exists() ? user : null;
          renderAdminArea();
          render();
        }).catch(function () { });
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
        if (!reqUnsub) {
          reqUnsub = fb.onSnapshot(fb.collection(fbDb, 'requests'), function (snap) {
            var m = {};
            snap.forEach(function (d) { m[d.id] = d.data(); });
            state.requests = m;
            render();
          }, function () { });
        }
        renderAdminArea();
        render();
      });
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

  /* record this account's email once, for the admin's link-picker */
  function recordAccount(user) {
    if (!user || !user.email) return;
    var em = user.email.toLowerCase();
    var ref = fb.doc(fbDb, 'accounts', em);
    fb.getDoc(ref).then(function (s) {
      if (!s.exists()) return fb.setDoc(ref, { email: em });
    }).catch(function () { });
  }

  /* listen to this month's schedule; called again on month change */
  function subscribeMonth() {
    if (!fb || !state.user) return;
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
    if (!state.user) return;
    if (state.admin) area.appendChild(el('span', 'admin-pill on', L.t('adminOn')));
    else area.appendChild(el('span', 'admin-pill', L.t('viewOnly')));
    var out = el('button', 'icon-btn', L.t('logout'));
    out.type = 'button';
    out.title = state.user.email || '';
    out.addEventListener('click', function () { authFns.signOut(auth); });
    area.appendChild(out);
  }

  /* which calendar belongs to the logged-in student? */
  function myPersonId() {
    if (!state.user || !state.user.email) return null;
    var em = state.user.email.toLowerCase();
    var hit = null;
    Object.keys(state.people).forEach(function (id) {
      if ((state.people[id].email || '').toLowerCase() === em) hit = id;
    });
    return hit;
  }

  function render() {
    var main = document.getElementById('mainArea');
    main.textContent = '';
    if (!state.view) {
      main.appendChild(el('div', 'notice', L.t('connecting')));
      return;
    }
    if (fb && !state.user) { renderGate(main); return; }
    main.appendChild(renderMonthbar());
    main.appendChild(renderCalendar());
    main.appendChild(renderRequests());
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

  /* ============== requests: ask for a day off / call in sick ============== */
  function reqTypeLabel(t) { return t === 'sick' ? L.t('reqTypeSick') : L.t('reqTypeFree'); }

  function renderRequests() {
    var box = el('div', 'plan-card req-box');
    box.appendChild(el('h3', null, L.t('reqTitle')));
    var mine = myPersonId();

    /* students get a small form; the admin answers instead of asking */
    if (mine && !state.admin) {
      var form = el('div', 'req-form');
      function field(labelKey, input) {
        var f = el('div', 'field');
        f.appendChild(el('label', null, L.t(labelKey)));
        f.appendChild(input);
        return f;
      }
      var iDate = document.createElement('input');
      iDate.type = 'date';
      iDate.min = todayStr();
      var iType = document.createElement('select');
      [['free', 'reqTypeFree'], ['sick', 'reqTypeSick']].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = L.t(o[1]);
        iType.appendChild(opt);
      });
      var iNote = document.createElement('input');
      iNote.type = 'text';
      iNote.maxLength = 120;
      var send = el('button', 'btn primary', L.t('reqSend'));
      send.type = 'button';
      send.addEventListener('click', function () {
        var ds = iDate.value;
        if (!ds) { showToast(L.t('toastDates')); return; }
        if (isMonday(parseDate(ds))) { showToast(L.t('legMondays')); return; }
        var r = {
          personId: mine, date: ds, type: iType.value,
          note: iNote.value.trim(), status: 'pending'
        };
        fb.setDoc(fb.doc(fbDb, 'requests', mine + '_' + ds), r).then(function () {
          showToast(L.t('toastReqSent'));
        }).catch(function () { showToast(L.t('toastSaveFail')); });
      });
      form.appendChild(field('colDate', iDate));
      form.appendChild(field('reqNew', iType));
      form.appendChild(field('note', iNote));
      form.appendChild(send);
      box.appendChild(form);
    }

    var list = Object.keys(state.requests).map(function (k) { return state.requests[k]; })
      .filter(function (r) { return state.admin ? true : r.personId === mine; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    if (!list.length) {
      box.appendChild(el('div', 'modal-sub', L.t('reqNone')));
      return box;
    }
    list.forEach(function (r) {
      var row = el('div', 'req-row');
      row.appendChild(el('span', 'rdate', niceDate(r.date)));
      if (state.admin) {
        var p = state.people[r.personId];
        row.appendChild(el('span', 'rtype', (p ? p.name : r.personId) + ' · ' + reqTypeLabel(r.type)));
      } else {
        row.appendChild(el('span', 'rtype', reqTypeLabel(r.type)));
      }
      if (r.note) row.appendChild(el('span', 'rnote', r.note));
      row.appendChild(el('span', 'badge-st ' + r.status, L.t('req' + r.status.charAt(0).toUpperCase() + r.status.slice(1))));
      if (state.admin && r.status === 'pending') {
        var ok = el('button', 'btn small', L.t('reqApprove'));
        ok.type = 'button';
        ok.addEventListener('click', function () { decideRequest(r, true); });
        var no = el('button', 'btn small danger', L.t('reqReject'));
        no.type = 'button';
        no.addEventListener('click', function () { decideRequest(r, false); });
        row.appendChild(ok); row.appendChild(no);
      }
      if (!state.admin && r.status === 'pending') {
        var cx = el('button', 'btn small ghost', L.t('reqCancel'));
        cx.type = 'button';
        cx.addEventListener('click', function () {
          fb.deleteDoc(fb.doc(fbDb, 'requests', r.personId + '_' + r.date))
            .catch(function () { showToast(L.t('toastSaveFail')); });
        });
        row.appendChild(cx);
      }
      box.appendChild(row);
    });
    return box;
  }

  /* admin decides: approving also puts the day as "free" on the schedule */
  function decideRequest(r, approved) {
    var upd = {};
    Object.keys(r).forEach(function (k) { upd[k] = r[k]; });
    upd.status = approved ? 'approved' : 'rejected';
    var p = fb.setDoc(fb.doc(fbDb, 'requests', r.personId + '_' + r.date), upd);
    if (approved) {
      p = p.then(function () {
        return fb.setDoc(fb.doc(fbDb, 'schedule', r.personId + '_' + r.date), {
          personId: r.personId, date: r.date, status: 'free', from: '', to: ''
        });
      });
    }
    p.then(function () {
      if (approved) showToast(L.t('toastReqApproved'));
    }).catch(function () { showToast(L.t('toastSaveFail')); });
  }

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
    if (ev.target === dayOverlay) closeDay();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !dayOverlay.classList.contains('hidden')) closeDay();
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
