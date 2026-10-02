/* ============================================================
   Wenine — languages (i18n = "internationalization")
   Every piece of text on the site lives here, once per language.
   To add a language: copy the whole "nl" block, rename it (e.g.
   "ku"), translate the values, and add an <option> to the
   language dropdown in index.html and schedule.html.
   ============================================================ */

window.WenineLang = (function () {
  'use strict';

  var LS_KEY = 'wenine-lang';

  var dict = {
    /* ---------------- English ---------------- */
    en: {
      monthsFull: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      dayNamesFull: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      dayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],

      navHours: 'Hour tracker', navSchedule: 'Schedule',
      subHours: 'stage hours', subSchedule: 'schedule',

      storageClaude: 'Shared storage — everyone sees the same data',
      storageCloud: 'Shared cloud storage — everyone sees the same data',
      storageLocal: 'Saved in this browser',
      loading: 'Loading…', connecting: 'Connecting…',

      statTotal: 'Total counted', statTotalSub: 'weekend hours count ×2',
      statFloor: 'Hours on the floor', statFloorSub: 'actual time worked',
      statBonus: 'Weekend bonus', statBonusSub: 'extra from Sat & Sun',
      statDays: 'Days worked', dayOne: 'day', dayMany: 'days',
      hourUnit: 'h',

      weekCol: 'Week', closed: 'Closed', today: 'today',
      prevMonth: 'Previous month', nextMonth: 'Next month',
      legWorked: 'worked', legFree: 'free', legX2: 'weekend ×2',
      legWorking: 'working', legMondays: 'Mondays closed',
      inclBonus: 'incl. +{x} bonus',
      weekTitle: 'Week of {d}: {b} h worked, counts as {c} h',
      countsAsTitle: 'Counts as {h} h (weekend ×2)',

      viewCal: 'Calendar', viewList: 'List',
      colDate: 'Date', colDay: 'Day', colExtra: '×2', monthTotal: 'Total:',

      viewPlan: 'Planner',
      planSettings: 'My plan',
      planTarget: 'Hours needed in total',
      planDays: 'Days I can work',
      planPerDay: 'Hours per day',
      planDeadline: 'Deadline',
      planDeadlineNote: 'This is your “until” date from your profile.',
      planHint: 'Weekends count ×2, Mondays are closed, and days you already filled in are not counted twice.',
      planRemaining: 'Still to go',
      planWeekly: 'Planned per week',
      planNeedWeekly: 'Needed per week',
      planFinish: 'Finished around',
      planSchedule: 'Month by month',
      planMonth: 'Month', planPlanned: 'Planned', planCum: 'Running total',
      planVerdictDone: 'Target reached — your {t} hours are in! 🎉',
      planVerdictOk: 'You make it: with this plan you reach {t} h around {d} — with {s} h to spare before {e}.',
      planVerdictShort: 'Not enough: by {e} you only get to {x} of {t} h — {y} h short. Add a day or plan longer shifts.',

      navAdmin: 'Admin', subAdmin: 'admin dashboard',
      confirmed: 'confirmed',
      confirmedLock: 'Confirmed by the admin — only the admin can change this.',
      byAdmin: 'changed by admin',
      confToggle: 'Confirmed — lock this day for everyone except the admin',
      confirmMonth: 'Confirm month',
      adminNeedLogin: 'Log in as admin to open the dashboard.',
      loginSubAdmin: 'Only admins can open this dashboard.',
      dashHint: 'Click a cell to check, change or confirm someone’s day.',
      toastMonthConfirmed: 'Month confirmed — those days are now locked.',
      toastNothingToConfirm: 'No filled days to confirm this month.',

      addPerson: '+ Add person', edit: 'Edit',
      emptyBig: 'No calendars yet', emptyText: 'Add a person to start tracking hours.',

      worked: 'Worked', free: 'Free',
      from: 'From', to: 'To', hours: 'Hours', note: 'Note',
      notePh: 'e.g. evening shift, event, school day…',
      clearDay: 'Clear day', cancel: 'Cancel', save: 'Save',
      subWeekend: 'weekend — hours count double',
      subWeekday: 'weekday — hours count once',
      countsAs: 'Counts as ', x2weekend: '(×2 weekend)',

      personTitleAdd: 'Add person', personTitleEdit: 'Edit {n}',
      personSub: 'Everyone gets their own calendar and totals.',
      name: 'Name', namePh: 'Name',
      canFrom: 'Can work from', until: 'Until',
      removePerson: 'Remove person', removeConfirm: 'Click again to remove for good',

      viewOnly: 'View only', adminOn: 'Admin — editing on',
      adminLogin: 'Admin login', logout: 'Log out',
      schedModalSub: 'Set each person to working or free. Leave on “—” to keep them off this day.',
      optWorking: 'Working', optFree: 'Free',
      timeTo: 'to',
      nobodyAvail: 'Nobody is available on this day — check each person’s work period on the hour tracker page.',
      loginTitle: 'Admin login',
      loginSub: 'Only admins can change the schedule. Everyone can view it.',
      loginSubPeople: 'Only admins can add or change people.',
      email: 'Email', password: 'Password', loginBtn: 'Log in',
      offlineNotice: 'The schedule needs an internet connection to the Wenine database. Open this page on the live website.',

      toastHoursFirst: 'Add the times or the hours first.',
      toastSaveFail: "Couldn't save — you may not have edit access.",
      toastClearFail: "Couldn't clear this day.",
      toastName: 'Give this person a name.',
      toastDates: 'Pick both dates.',
      toastEndBeforeStart: 'The end date is before the start date.',
      toastRemoveFail: "Couldn't remove this person.",
      toastStorageFull: 'Could not save — browser storage is full or blocked.',
      toastConnLost: 'Connection to shared storage lost.',
      toastCloudLost: 'Lost connection to cloud storage.',
      toastCalLoad: 'Could not load this calendar.',
      toastDbRules: 'No access to the database — check the Firestore rules.',
      toastSeedFail: "Couldn't write to the database — check the Firestore rules.",
      toastStaff: 'Could not load the staff list.',
      toastSchedRules: 'No access to the schedule — check the Firestore rules.',
      toastSchedSave: "Couldn't save — are you still logged in as admin?",
      toastFill: 'Fill in the email and password.',
      toastWrong: 'Wrong email or password.',
      toastTooMany: 'Too many attempts — wait a few minutes.',
      toastLoginFail: 'Login failed. Is this website on the authorized domains list?',
      toastLoggedIn: 'Logged in.',

      gateTitle: 'Log in',
      gateSub: 'Log in to see the Wenine hours. Students and admin each use their own account.',
      gateRegisterQ: 'First time here? Create your account',
      gateLoginQ: 'Already have an account? Log in',
      registerBtn: 'Create account',
      toastRegistered: 'Account created — you are logged in.',
      toastEmailInUse: 'There is already an account with this email.',
      toastWeakPw: 'The password must be at least 6 characters.',
      toastNotYours: 'You can only change your own calendar.',
      noPersonLinked: 'Your account ({e}) is not linked to a calendar yet — ask the admin to add your email to your profile.',
      personEmail: 'Student email (for their login)',

      reqTitle: 'Requests',
      reqNew: 'New request',
      reqTypeFree: 'Day off',
      reqTypeSick: 'Sick',
      reqSend: 'Send request',
      reqPending: 'pending',
      reqApproved: 'approved',
      reqRejected: 'rejected',
      reqApprove: 'Approve',
      reqReject: 'Reject',
      reqCancel: 'Withdraw',
      reqNone: 'No requests yet.',
      toastReqSent: 'Request sent — waiting for the admin.',
      toastReqApproved: 'Approved — the day is set to free on the schedule.'
    },

    /* ---------------- Nederlands ---------------- */
    nl: {
      monthsFull: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
      dayNamesFull: ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'],
      dayShort: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],

      navHours: 'Urenregistratie', navSchedule: 'Rooster',
      subHours: 'stage-uren', subSchedule: 'rooster',

      storageClaude: 'Gedeelde opslag — iedereen ziet dezelfde gegevens',
      storageCloud: 'Gedeelde cloudopslag — iedereen ziet dezelfde gegevens',
      storageLocal: 'Opgeslagen in deze browser',
      loading: 'Laden…', connecting: 'Verbinden…',

      statTotal: 'Totaal geteld', statTotalSub: 'weekenduren tellen ×2',
      statFloor: 'Werkelijke uren', statFloorSub: 'echt gewerkte tijd',
      statBonus: 'Weekendbonus', statBonusSub: 'extra van za & zo',
      statDays: 'Dagen gewerkt', dayOne: 'dag', dayMany: 'dagen',
      hourUnit: 'u',

      weekCol: 'Week', closed: 'Gesloten', today: 'vandaag',
      prevMonth: 'Vorige maand', nextMonth: 'Volgende maand',
      legWorked: 'gewerkt', legFree: 'vrij', legX2: 'weekend ×2',
      legWorking: 'werkt', legMondays: 'Maandag gesloten',
      inclBonus: 'incl. +{x} bonus',
      weekTitle: 'Week van {d}: {b} u gewerkt, telt als {c} u',
      countsAsTitle: 'Telt als {h} u (weekend ×2)',

      viewCal: 'Kalender', viewList: 'Lijst',
      colDate: 'Datum', colDay: 'Dag', colExtra: '×2', monthTotal: 'Totaal:',

      viewPlan: 'Planner',
      planSettings: 'Mijn plan',
      planTarget: 'Totaal benodigde uren',
      planDays: 'Dagen die ik kan werken',
      planPerDay: 'Uren per dag',
      planDeadline: 'Deadline',
      planDeadlineNote: 'Dit is je “tot en met”-datum uit je profiel.',
      planHint: 'Weekenden tellen ×2, maandag is gesloten, en al ingevulde dagen tellen niet dubbel mee.',
      planRemaining: 'Nog te gaan',
      planWeekly: 'Gepland per week',
      planNeedWeekly: 'Nodig per week',
      planFinish: 'Klaar rond',
      planSchedule: 'Maand voor maand',
      planMonth: 'Maand', planPlanned: 'Gepland', planCum: 'Lopend totaal',
      planVerdictDone: 'Doel gehaald — je {t} uur zijn binnen! 🎉',
      planVerdictOk: 'Je haalt het: met dit plan zit je rond {d} aan je {t} u — met {s} u speling vóór {e}.',
      planVerdictShort: 'Niet genoeg: op {e} kom je maar tot {x} van de {t} u — {y} u tekort. Plan een extra dag of langere diensten.',

      navAdmin: 'Admin', subAdmin: 'admin-dashboard',
      confirmed: 'bevestigd',
      confirmedLock: 'Bevestigd door de admin — alleen de admin kan dit nog wijzigen.',
      byAdmin: 'gewijzigd door admin',
      confToggle: 'Bevestigd — vergrendel deze dag voor iedereen behalve de admin',
      confirmMonth: 'Maand bevestigen',
      adminNeedLogin: 'Log in als admin om het dashboard te openen.',
      loginSubAdmin: 'Alleen admins kunnen dit dashboard openen.',
      dashHint: 'Klik op een cel om iemands dag te controleren, aan te passen of te bevestigen.',
      toastMonthConfirmed: 'Maand bevestigd — deze dagen zijn nu vergrendeld.',
      toastNothingToConfirm: 'Geen ingevulde dagen om te bevestigen deze maand.',

      addPerson: '+ Persoon toevoegen', edit: 'Bewerken',
      emptyBig: 'Nog geen kalenders', emptyText: 'Voeg een persoon toe om uren bij te houden.',

      worked: 'Gewerkt', free: 'Vrij',
      from: 'Van', to: 'Tot', hours: 'Uren', note: 'Notitie',
      notePh: 'bijv. avonddienst, evenement, schooldag…',
      clearDay: 'Dag wissen', cancel: 'Annuleren', save: 'Opslaan',
      subWeekend: 'weekend — uren tellen dubbel',
      subWeekday: 'doordeweeks — uren tellen één keer',
      countsAs: 'Telt als ', x2weekend: '(×2 weekend)',

      personTitleAdd: 'Persoon toevoegen', personTitleEdit: '{n} bewerken',
      personSub: 'Iedereen krijgt een eigen kalender en eigen totalen.',
      name: 'Naam', namePh: 'Naam',
      canFrom: 'Kan werken vanaf', until: 'Tot en met',
      removePerson: 'Persoon verwijderen', removeConfirm: 'Klik nogmaals om definitief te verwijderen',

      viewOnly: 'Alleen bekijken', adminOn: 'Admin — bewerken aan',
      adminLogin: 'Admin inloggen', logout: 'Uitloggen',
      schedModalSub: 'Zet iedereen op werken of vrij. Laat op “—” staan om iemand buiten deze dag te houden.',
      optWorking: 'Werken', optFree: 'Vrij',
      timeTo: 'tot',
      nobodyAvail: 'Niemand is beschikbaar op deze dag — controleer de werkperiode per persoon op de urenpagina.',
      loginTitle: 'Admin inloggen',
      loginSub: 'Alleen admins kunnen het rooster wijzigen. Iedereen kan het bekijken.',
      loginSubPeople: 'Alleen admins kunnen personen toevoegen of wijzigen.',
      email: 'E-mail', password: 'Wachtwoord', loginBtn: 'Inloggen',
      offlineNotice: 'Het rooster heeft een internetverbinding met de Wenine-database nodig. Open deze pagina op de live website.',

      toastHoursFirst: 'Vul eerst de tijden of de uren in.',
      toastSaveFail: 'Opslaan mislukt — mogelijk geen bewerkrechten.',
      toastClearFail: 'Kon deze dag niet wissen.',
      toastName: 'Geef deze persoon een naam.',
      toastDates: 'Kies beide datums.',
      toastEndBeforeStart: 'De einddatum ligt vóór de startdatum.',
      toastRemoveFail: 'Kon deze persoon niet verwijderen.',
      toastStorageFull: 'Opslaan mislukt — browseropslag is vol of geblokkeerd.',
      toastConnLost: 'Verbinding met gedeelde opslag verbroken.',
      toastCloudLost: 'Verbinding met cloudopslag verbroken.',
      toastCalLoad: 'Kon deze kalender niet laden.',
      toastDbRules: 'Geen toegang tot de database — controleer de Firestore-regels.',
      toastSeedFail: 'Kon niet naar de database schrijven — controleer de Firestore-regels.',
      toastStaff: 'Kon de personeelslijst niet laden.',
      toastSchedRules: 'Geen toegang tot het rooster — controleer de Firestore-regels.',
      toastSchedSave: 'Opslaan mislukt — ben je nog ingelogd als admin?',
      toastFill: 'Vul het e-mailadres en wachtwoord in.',
      toastWrong: 'Verkeerd e-mailadres of wachtwoord.',
      toastTooMany: 'Te veel pogingen — wacht een paar minuten.',
      toastLoginFail: 'Inloggen mislukt. Staat deze website in de lijst met toegestane domeinen?',
      toastLoggedIn: 'Ingelogd.',

      gateTitle: 'Inloggen',
      gateSub: 'Log in om de Wenine-uren te zien. Studenten en admin gebruiken elk hun eigen account.',
      gateRegisterQ: 'Eerste keer hier? Maak je account aan',
      gateLoginQ: 'Heb je al een account? Inloggen',
      registerBtn: 'Account aanmaken',
      toastRegistered: 'Account aangemaakt — je bent ingelogd.',
      toastEmailInUse: 'Er bestaat al een account met dit e-mailadres.',
      toastWeakPw: 'Het wachtwoord moet minstens 6 tekens zijn.',
      toastNotYours: 'Je kunt alleen je eigen kalender wijzigen.',
      noPersonLinked: 'Je account ({e}) is nog niet gekoppeld aan een kalender — vraag de admin om je e-mail aan je profiel toe te voegen.',
      personEmail: 'E-mail student (voor hun login)',

      reqTitle: 'Aanvragen',
      reqNew: 'Nieuwe aanvraag',
      reqTypeFree: 'Vrije dag',
      reqTypeSick: 'Ziek',
      reqSend: 'Aanvraag versturen',
      reqPending: 'in afwachting',
      reqApproved: 'goedgekeurd',
      reqRejected: 'afgewezen',
      reqApprove: 'Goedkeuren',
      reqReject: 'Afwijzen',
      reqCancel: 'Intrekken',
      reqNone: 'Nog geen aanvragen.',
      toastReqSent: 'Aanvraag verstuurd — wachten op de admin.',
      toastReqApproved: 'Goedgekeurd — de dag staat als vrij in het rooster.'
    }
  };

  var lang = 'en';
  try {
    lang = localStorage.getItem(LS_KEY) ||
      (((navigator.language || '').slice(0, 2) === 'nl') ? 'nl' : 'en');
  } catch (e) { }
  if (!dict[lang]) lang = 'en';

  var listeners = [];

  /* look up one text; {x}-style placeholders filled from vars */
  function t(key, vars) {
    var v = (dict[lang] && dict[lang][key] != null) ? dict[lang][key] : dict.en[key];
    if (v == null) v = key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        v = v.split('{' + k + '}').join(vars[k]);
      });
    }
    return v;
  }

  /* arrays (months, day names) */
  function arr(key) { return dict[lang][key] || dict.en[key]; }

  /* translate every element marked with data-i18n / data-i18n-ph */
  function applyStatic() {
    var els = document.querySelectorAll('[data-i18n]');
    Array.prototype.forEach.call(els, function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    var phs = document.querySelectorAll('[data-i18n-ph]');
    Array.prototype.forEach.call(phs, function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
  }

  function set(l) {
    if (!dict[l] || l === lang) return;
    lang = l;
    try { localStorage.setItem(LS_KEY, l); } catch (e) { }
    applyStatic();
    listeners.forEach(function (f) { f(); });
  }

  return {
    t: t,
    arr: arr,
    get: function () { return lang; },
    set: set,
    onChange: function (f) { listeners.push(f); },
    applyStatic: applyStatic
  };
})();
