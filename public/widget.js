/*!
 * Obsidian Calendar widget: embeddable, dependency-free Web Component.
 *
 *   <obsidian-calendar data-api-key="pk_…"></obsidian-calendar>
 *   <script src="https://YOUR-CRM/widget.js" defer></script>
 *
 * Attributes (all optional except a credential):
 *   data-api-key     publishable key (pk_…): read-only, or "request a time" if the key allows writes
 *   data-token       embed token (et_…) minted by your server for signed-in staff: full editing
 *   data-token-url   URL on YOUR site that returns { token, expiresAt } (called with your cookies); refreshed automatically
 *   data-endpoint    CRM base URL (default: where widget.js was loaded from)
 *   data-theme       light | dark | auto (default auto)
 *   data-view        month | week (default month)
 *   data-locale      e.g. en-GB (default: the visitor's browser)
 *   data-channels    comma-separated channel names offered in the form, e.g. "LinkedIn,Instagram,X"
 *   data-live        "false" turns off real-time updates
 *
 * Security: all event text is rendered with textContent (never as HTML). Styles live in a Shadow DOM, so the
 * host page's CSS can't change the widget and the widget's CSS can't leak out. No cookies are sent to the CRM.
 */
(function () {
  'use strict';
  if (window.customElements && customElements.get('obsidian-calendar')) return;

  var SCRIPT = document.currentScript;
  var SCRIPT_ORIGIN = (function () { try { return new URL(SCRIPT && SCRIPT.src ? SCRIPT.src : location.href).origin; } catch (e) { return location.origin; } })();
  var DAY = 86400000;
  var uid = 0;

  // ---------------------------------------------------------------------------
  // Styles (scoped to the shadow root)
  // ---------------------------------------------------------------------------
  var CSS = [
    ':host{all:initial;display:block;contain:content;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    '--bg:#fff;--fg:#1c1d21;--muted:#6b6f78;--line:#e4e4e7;--soft:#f6f6f7;--accent:#4f46e5;--accent-fg:#fff;--today:#eef2ff;',
    '--ok:#047857;--pending:#b45309;--danger:#b91c1c;--radius:12px;color:var(--fg)}',
    ':host([data-resolved-theme="dark"]){--bg:#17181c;--fg:#ececee;--muted:#a1a1aa;--line:#2c2e35;--soft:#202228;--accent:#818cf8;--accent-fg:#0b0b10;--today:#23264a;--ok:#34d399;--pending:#fbbf24;--danger:#f87171}',
    '*{box-sizing:border-box}',
    // Inherited properties (color, font…) would still flow in from the host element, even with !important
    // rules on the host page, so the widget's root resets them itself instead of relying on :host.
    '.cal{all:initial;display:block;box-sizing:border-box;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);',
    'text-align:left;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;white-space:normal;direction:ltr;',
    'background:var(--bg);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;position:relative}',
    '.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}',
    '.title{font-weight:650;font-size:15px;margin:0 6px 0 2px;min-width:9ch}',
    '.sp{flex:1}',
    'button{font:inherit;color:inherit;background:none;border:1px solid transparent;border-radius:8px;padding:6px 10px;cursor:pointer;min-height:36px}',
    'button:hover{background:var(--soft)}',
    'button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.icon{width:36px;padding:0;display:inline-flex;align-items:center;justify-content:center}',
    '.seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;padding:2px}',
    '.seg button{min-height:30px;padding:4px 10px;border-radius:7px}',
    '.seg button[aria-pressed="true"]{background:var(--soft);font-weight:600}',
    '.primary{background:var(--accent);color:var(--accent-fg);font-weight:600}',
    '.primary:hover{background:var(--accent);filter:brightness(1.08)}',
    '.danger{color:var(--danger);border-color:var(--line)}',
    '.dow,.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}',
    '.dow div{padding:6px 8px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}',
    '.cell{min-height:96px;border-top:1px solid var(--line);border-left:1px solid var(--line);padding:4px;display:flex;flex-direction:column;gap:3px;min-width:0;cursor:pointer;position:relative}',
    '.grid .cell:nth-child(7n+1){border-left:none}',
    '.cell.out{background:var(--soft)}',
    '.cell.out .num{color:var(--muted)}',
    '.cell.today .num{background:var(--accent);color:var(--accent-fg)}',
    '.cell.drop{background:var(--today);box-shadow:inset 0 0 0 2px var(--accent)}',
    '.num{align-self:flex-start;font-size:12px;font-weight:600;border-radius:999px;min-width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0 6px}',
    '.badge{display:flex;align-items:center;gap:5px;width:100%;text-align:left;font-size:12px;line-height:1.25;padding:3px 6px;min-height:22px;border-radius:6px;',
    'background:color-mix(in srgb,var(--accent) 14%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.badge .t{overflow:hidden;text-overflow:ellipsis}',
    '.badge .tm{color:var(--muted);flex:none;font-variant-numeric:tabular-nums}',
    '.badge.pending{background:color-mix(in srgb,var(--pending) 14%,transparent);border-style:dashed;border-color:var(--pending)}',
    '.badge.draft{opacity:.75;border-style:dashed}',
    '.badge.saving{opacity:.6}',
    '.badge[draggable="true"]{cursor:grab}',
    '.more{font-size:11px;color:var(--muted);text-align:left;padding:2px 6px;min-height:22px}',
    '.week .cell{min-height:300px}',
    '.week .head{font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center}',
    '.empty{padding:28px;text-align:center;color:var(--muted)}',
    '.status{padding:8px 12px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);display:flex;gap:8px;align-items:center;min-height:34px}',
    '.err{color:var(--danger)}',
    '.toast{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);background:var(--fg);color:var(--bg);padding:8px 12px;border-radius:9px;font-size:13px;max-width:90%;box-shadow:0 6px 20px rgba(0,0,0,.2)}',
    '.overlay{position:absolute;inset:0;background:rgba(10,10,15,.45);display:flex;align-items:center;justify-content:center;padding:12px;z-index:5}',
    '.modal{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;width:min(440px,100%);max-height:100%;overflow:auto;padding:16px;box-shadow:0 16px 40px rgba(0,0,0,.3)}',
    '.modal h2{font-size:16px;margin:0 0 12px}',
    'label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:10px 0 4px}',
    'input,select,textarea{width:100%;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-height:38px}',
    'textarea{min-height:80px;resize:vertical}',
    '.row{display:flex;gap:8px}.row>*{flex:1}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.chips label{display:inline-flex;align-items:center;gap:6px;margin:0;font-weight:500;color:var(--fg);border:1px solid var(--line);border-radius:999px;padding:4px 10px;cursor:pointer}',
    '.chips input{width:auto;min-height:0}',
    '.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}',
    '.actions .left{margin-right:auto}',
    '.ferr{color:var(--danger);font-size:12px;margin-top:4px}',
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:560px){.week .dow{display:none}.cell{min-height:64px}.badge .tm{display:none}.title{flex-basis:100%;order:-1}.week .grid{grid-template-columns:1fr}.week .cell{min-height:0;border-left:none}}',
    '@media (prefers-reduced-motion:no-preference){.toast{animation:in .15s ease-out}@keyframes in{from{opacity:0;transform:translate(-50%,6px)}}}'
  ].join('');

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  class ObsidianCalendar extends HTMLElement {
    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._events = new Map();       // id → event (server shape, plus _saving / _temp)
      this._loadedRange = null;
      this._cursor = startOfDay(new Date());
      this._view = 'month';
      this._perm = { write: false, manage: false };
      this._token = null; this._tokenExp = 0;
      this._dragId = null;
    }

    // -------------------------------------------------------------- lifecycle
    connectedCallback() {
      if (this._started) return;
      this._started = true;
      this._cfg = {
        apiKey: this.dataset.apiKey || '',
        token: this.dataset.token || '',
        tokenUrl: this.dataset.tokenUrl || '',
        endpoint: (this.dataset.endpoint || SCRIPT_ORIGIN).replace(/\/+$/, ''),
        theme: this.dataset.theme || 'auto',
        locale: this.dataset.locale || undefined,
        channels: (this.dataset.channels || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12),
        live: this.dataset.live !== 'false'
      };
      this._view = this.dataset.view === 'week' ? 'week' : 'month';
      this._applyTheme();
      if (this._cfg.theme === 'auto' && window.matchMedia) {
        this._mq = window.matchMedia('(prefers-color-scheme: dark)');
        this._mqListener = this._applyTheme.bind(this);
        this._mq.addEventListener ? this._mq.addEventListener('change', this._mqListener) : this._mq.addListener(this._mqListener);
      }
      this._fmt = {
        month: new Intl.DateTimeFormat(this._cfg.locale, { month: 'long', year: 'numeric' }),
        dow: new Intl.DateTimeFormat(this._cfg.locale, { weekday: 'short' }),
        time: new Intl.DateTimeFormat(this._cfg.locale, { hour: 'numeric', minute: '2-digit' }),
        long: new Intl.DateTimeFormat(this._cfg.locale, { weekday: 'long', month: 'long', day: 'numeric' }),
        full: new Intl.DateTimeFormat(this._cfg.locale, { dateStyle: 'medium', timeStyle: 'short' })
      };
      this._root.appendChild(el('style', { text: CSS }));
      this._shell = el('div', { class: 'cal', part: 'calendar' });
      this._root.appendChild(this._shell);
      this._live = el('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
      this._root.appendChild(this._live);
      if (!this._cfg.apiKey && !this._cfg.token && !this._cfg.tokenUrl) {
        this._shell.appendChild(el('div', { class: 'empty', text: 'Calendar not configured: add data-api-key (or data-token / data-token-url).' }));
        return;
      }
      this._render();
      this._load(true);
    }

    disconnectedCallback() {
      this._stopStream();
      if (this._mq) this._mq.removeEventListener ? this._mq.removeEventListener('change', this._mqListener) : this._mq.removeListener(this._mqListener);
      clearInterval(this._poll);
    }

    _applyTheme() {
      var t = this._cfg.theme;
      var dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      this.setAttribute('data-resolved-theme', dark ? 'dark' : 'light');
    }

    // -------------------------------------------------------------- networking
    async _credential() {
      var c = this._cfg;
      if (c.tokenUrl) {
        if (!this._token || Date.now() > this._tokenExp - 60000) {
          var r = await fetch(c.tokenUrl, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
          if (!r.ok) throw new Error('Couldn’t get a session for the calendar (' + r.status + ').');
          var j = await r.json();
          this._token = j.token; this._tokenExp = Date.parse(j.expiresAt) || Date.now() + 600000;
        }
        return this._token;
      }
      return c.token || c.apiKey;
    }

    async _api(method, path, body, extraHeaders) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 15000);
      try {
        var headers = Object.assign({ Authorization: 'Bearer ' + (await this._credential()), Accept: 'application/json' }, extraHeaders || {});
        if (body) headers['Content-Type'] = 'application/json';
        // credentials:'omit': the CRM never sees the host site's or visitor's cookies.
        var res = await fetch(this._cfg.endpoint + '/api/v1/events' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', signal: ctrl.signal, mode: 'cors' });
        var data = null; try { data = await res.json(); } catch (e) { /* empty */ }
        if (!res.ok) { var err = new Error((data && data.error) || ('Request failed (' + res.status + ').')); err.status = res.status; err.data = data; throw err; }
        return data;
      } catch (e) {
        if (e.name === 'AbortError') { var t = new Error('The calendar server didn’t respond. Try again.'); t.status = 0; throw t; }
        if (e instanceof TypeError) { var n = new Error('Can’t reach the calendar. Check your connection, or this site may not be allowed to use this key.'); n.status = 0; throw n; }
        throw e;
      } finally { clearTimeout(timer); }
    }

    _range() {
      var first = this._view === 'month' ? new Date(this._cursor.getFullYear(), this._cursor.getMonth(), 1) : this._cursor;
      var start = this._view === 'month' ? addDays(first, -first.getDay()) : addDays(startOfDay(this._cursor), -this._cursor.getDay());
      var end = addDays(start, this._view === 'month' ? 42 : 7);
      return { start: start, end: end };
    }

    async _load(first) {
      var r = this._range();
      this._setStatus('Loading…');
      try {
        var q = '?startDate=' + encodeURIComponent(r.start.toISOString()) + '&endDate=' + encodeURIComponent(r.end.toISOString());
        var data = await this._api('GET', q);
        // Keep in-flight optimistic items; replace everything else in range.
        var keep = new Map();
        this._events.forEach(function (e, id) { if (e._saving) keep.set(id, e); });
        this._events = keep;
        (data.events || []).forEach(function (e) { if (!keep.has(e.id)) this._events.set(e.id, e); }, this);
        this._perm = data.permissions || this._perm;
        this._loadedRange = r;
        this._setStatus('');
        this._render();
        if (first && this._cfg.live) this._startStream();
      } catch (e) {
        this._setStatus(e.message, true);
        this._render();
      }
    }

    // Real-time: SSE read through fetch so the credential travels in a header, never in the URL.
    async _startStream() {
      this._stopStream();
      var self = this, ctrl = new AbortController();
      this._streamCtrl = ctrl;
      try {
        var res = await fetch(this._cfg.endpoint + '/api/v1/events/stream', { headers: { Authorization: 'Bearer ' + (await this._credential()), Accept: 'text/event-stream' }, credentials: 'omit', signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error('stream ' + res.status);
        this._backoff = 1000;
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        for (;;) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split('\n\n'); buf = parts.pop();
          parts.forEach(function (p) {
            var line = p.split('\n').filter(function (l) { return l.indexOf('data: ') === 0; }).map(function (l) { return l.slice(6); }).join('');
            if (line) { try { self._applyRemote(JSON.parse(line)); } catch (e) { /* ignore malformed */ } }
          });
        }
      } catch (e) { if (ctrl.signal.aborted) return; }
      if (ctrl.signal.aborted || !this.isConnected) return;
      // Reconnect with backoff; poll meanwhile so the calendar stays current.
      this._backoff = Math.min((this._backoff || 1000) * 2, 60000);
      clearInterval(this._poll);
      this._poll = setInterval(function () { self._load(false); }, 60000);
      setTimeout(function () { if (self.isConnected) { clearInterval(self._poll); self._startStream(); } }, this._backoff);
    }
    _stopStream() { if (this._streamCtrl) this._streamCtrl.abort(); this._streamCtrl = null; }

    _applyRemote(msg) {
      if (!msg || !msg.type || !msg.event) return;
      var cur = this._events.get(msg.event.id);
      if (msg.type === 'deleted') { if (cur && !cur._saving) { this._events.delete(msg.event.id); this._render(); } return; }
      if (cur && cur._saving) return; // our own optimistic change wins until the server confirms it
      if (cur && cur.version >= msg.event.version) return;
      this._events.set(msg.event.id, msg.event);
      this._render();
    }

    // -------------------------------------------------------------- mutations (optimistic)
    async _create(input) {
      var tempId = 'tmp_' + (++uid);
      var optimistic = Object.assign({ id: tempId, status: this._perm.manage ? 'scheduled' : 'pending', version: 0, _saving: true, _temp: true }, input);
      this._events.set(tempId, optimistic); this._render();
      try {
        var data = await this._api('POST', '', input);
        this._events.delete(tempId); this._events.set(data.event.id, data.event); this._render();
        this._toast(data.event.status === 'pending' ? 'Request sent. It’ll appear once it’s confirmed.' : 'Event scheduled.');
      } catch (e) {
        this._events.delete(tempId); this._render();
        this._toast('Not saved: ' + e.message);
        throw e;
      }
    }

    async _update(id, changes, message) {
      var before = this._events.get(id);
      if (!before) return;
      var optimistic = Object.assign({}, before, changes, { _saving: true });
      this._events.set(id, optimistic); this._render();
      try {
        var data = await this._api('PATCH', '/' + encodeURIComponent(id), Object.assign({}, changes, { version: before.version }));
        this._events.set(id, data.event); this._render();
        if (message) this._toast(message);
      } catch (e) {
        if (e.status === 409 && e.data && e.data.event) { this._events.set(id, e.data.event); this._toast('Someone else changed this event; showing the latest version.'); }
        else if (e.status === 404) { this._events.delete(id); this._toast('That event was deleted.'); }
        else { this._events.set(id, before); this._toast('Not saved: ' + e.message); }
        this._render();
        throw e;
      }
    }

    async _delete(id) {
      var before = this._events.get(id);
      this._events.delete(id); this._render();
      try { await this._api('DELETE', '/' + encodeURIComponent(id)); this._toast('Event deleted.'); }
      catch (e) { if (e.status !== 404) { this._events.set(id, before); this._render(); this._toast('Not deleted: ' + e.message); throw e; } }
    }

    // -------------------------------------------------------------- rendering
    _eventsOn(day) {
      var list = [];
      this._events.forEach(function (e) {
        var s = new Date(e.scheduledAt), en = e.endAt ? new Date(e.endAt) : s;
        if (startOfDay(s) <= day && startOfDay(en) >= day) list.push(e);
      });
      return list.sort(function (a, b) { return a.scheduledAt < b.scheduledAt ? -1 : 1; });
    }

    _render() {
      var self = this, sh = this._shell;
      var restoreFocus = this._root.activeElement && this._root.activeElement.dataset ? this._root.activeElement.dataset.focusKey : null;
      sh.textContent = '';
      var r = this._range();
      var label = this._view === 'month' ? this._fmt.month.format(this._cursor) : this._fmt.long.format(r.start) + ' – ' + this._fmt.long.format(addDays(r.end, -1));
      var nav = function (dir) { return function () {
        self._cursor = self._view === 'month' ? new Date(self._cursor.getFullYear(), self._cursor.getMonth() + dir, 1) : addDays(self._cursor, 7 * dir);
        self._render(); self._load(false);
      }; };
      var canCreate = this._perm.write;
      sh.appendChild(el('div', { class: 'bar' }, [
        el('button', { class: 'icon', 'aria-label': this._view === 'month' ? 'Previous month' : 'Previous week', 'data-focus-key': 'prev', onclick: nav(-1), text: '‹' }),
        el('button', { class: 'icon', 'aria-label': this._view === 'month' ? 'Next month' : 'Next week', 'data-focus-key': 'next', onclick: nav(1), text: '›' }),
        el('h2', { class: 'title', 'aria-live': 'polite', text: label }),
        el('button', { 'data-focus-key': 'today', onclick: function () { self._cursor = startOfDay(new Date()); self._render(); self._load(false); }, text: 'Today' }),
        el('span', { class: 'sp' }),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, ['month', 'week'].map(function (v) {
          return el('button', { 'aria-pressed': String(self._view === v), 'data-focus-key': 'view-' + v, onclick: function () { self._view = v; self._render(); self._load(false); }, text: v === 'month' ? 'Month' : 'Week' });
        })),
        canCreate ? el('button', { class: 'primary', 'data-focus-key': 'new', onclick: function () { self._openForm(null, startOfDay(new Date())); }, text: this._perm.manage ? '+ New event' : 'Request a time' }) : null
      ]));

      var wrap = el('div', { class: this._view === 'week' ? 'week' : 'month' });
      wrap.appendChild(el('div', { class: 'dow', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map(function (i) { return el('div', { text: self._fmt.dow.format(addDays(r.start, i)) }); })));
      var grid = el('div', { class: 'grid', role: 'grid', 'aria-label': label });
      var today = startOfDay(new Date());
      var days = this._view === 'month' ? 42 : 7;
      var row;
      for (var i = 0; i < days; i++) {
        if (i % 7 === 0) { row = el('div', { role: 'row', style: 'display:contents' }); grid.appendChild(row); }
        row.appendChild(this._cell(addDays(r.start, i), today));
      }
      wrap.appendChild(grid);
      sh.appendChild(wrap);
      if (!this._events.size && this._loadedRange) sh.appendChild(el('div', { class: 'empty', text: canCreate ? 'Nothing scheduled here yet. Click a day to add something.' : 'Nothing scheduled in this period.' }));
      sh.appendChild(this._statusEl = el('div', { class: 'status' + (this._statusErr ? ' err' : ''), role: this._statusErr ? 'alert' : null }, [this._statusText || (this._perm.manage ? 'Drag an event to another day to reschedule it.' : '')]));
      if (this._statusErr) this._statusEl.appendChild(el('button', { onclick: function () { self._load(!self._streamCtrl); }, text: 'Retry' }));
      if (this._toastText) sh.appendChild(el('div', { class: 'toast', role: 'status', text: this._toastText }));
      if (restoreFocus) { var f = this._shell.querySelector('[data-focus-key="' + restoreFocus + '"]'); if (f) f.focus(); }
    }

    _cell(day, today) {
      var self = this;
      var inMonth = this._view === 'week' || day.getMonth() === this._cursor.getMonth();
      var key = 'day-' + day.toISOString().slice(0, 10);
      var list = this._eventsOn(day);
      var cell = el('div', {
        class: 'cell' + (inMonth ? '' : ' out') + (sameDay(day, today) ? ' today' : ''), role: 'gridcell', tabindex: '0', 'data-focus-key': key,
        'aria-label': this._fmt.long.format(day) + (list.length ? ', ' + list.length + (list.length === 1 ? ' event' : ' events') : '') + (this._perm.write ? '. Press Enter to add.' : ''),
        onclick: function (e) { if (e.target === cell || e.target.classList.contains('num') || e.target.classList.contains('head')) { if (self._perm.write) self._openForm(null, day); } },
        onkeydown: function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === cell && self._perm.write) { e.preventDefault(); self._openForm(null, day); } }
      });
      cell.appendChild(el('span', { class: 'num', 'aria-hidden': 'true', text: this._view === 'week' ? this._fmt.dow.format(day) + ' ' + day.getDate() : String(day.getDate()) }));
      if (this._perm.manage) {
        cell.addEventListener('dragover', function (e) { if (self._dragId) { e.preventDefault(); cell.classList.add('drop'); } });
        cell.addEventListener('dragleave', function () { cell.classList.remove('drop'); });
        cell.addEventListener('drop', function (e) {
          e.preventDefault(); cell.classList.remove('drop');
          var id = self._dragId; self._dragId = null;
          var ev = id && self._events.get(id);
          if (!ev) return;
          var from = new Date(ev.scheduledAt);
          var to = new Date(day); to.setHours(from.getHours(), from.getMinutes(), 0, 0);
          if (sameDay(from, to)) return;
          var changes = { scheduledAt: to.toISOString() };
          if (ev.endAt) changes.endAt = new Date(Date.parse(ev.endAt) + (to - from)).toISOString();
          self._update(id, changes, 'Moved to ' + self._fmt.full.format(to) + '.').catch(function () {});
        });
      }
      var max = this._view === 'week' ? 50 : 3;
      list.slice(0, max).forEach(function (e) { cell.appendChild(self._badge(e)); });
      if (list.length > max) cell.appendChild(el('button', { class: 'more', onclick: function (ev) { ev.stopPropagation(); self._view = 'week'; self._cursor = day; self._render(); self._load(false); }, text: '+' + (list.length - max) + ' more' }));
      return cell;
    }

    _badge(e) {
      var self = this;
      var b = el('button', {
        class: 'badge ' + (e.status || '') + (e._saving ? ' saving' : ''), type: 'button', 'data-focus-key': 'evt-' + e.id,
        draggable: this._perm.manage && !e._saving ? 'true' : null,
        title: e.title,
        'aria-label': e.title + ', ' + (e.allDay ? 'all day' : this._fmt.time.format(new Date(e.scheduledAt))) + (e.status === 'pending' ? ', pending confirmation' : '') + (e._saving ? ', saving' : ''),
        onclick: function (ev) { ev.stopPropagation(); if (!e._temp) self._openForm(e); },
        ondragstart: function (ev) { self._dragId = e.id; ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', e.id); } catch (x) { /* IE */ } },
        ondragend: function () { self._dragId = null; }
      }, [
        e.allDay ? null : el('span', { class: 'tm', text: this._fmt.time.format(new Date(e.scheduledAt)) }),
        el('span', { class: 't', text: e.title })
      ]);
      return b;
    }

    // -------------------------------------------------------------- modal
    _openForm(event, day) {
      var self = this;
      var editing = !!event;
      var readOnly = editing && !this._perm.manage;
      var opener = this._root.activeElement;
      var start = editing ? new Date(event.scheduledAt) : (function () { var d = new Date(day); d.setHours(9, 0, 0, 0); return d; })();
      var ids = { t: 'f' + (++uid), d: 'f' + (++uid), e: 'f' + (++uid), c: 'f' + (++uid), h: 'h' + uid };

      var title = el('input', { id: ids.t, maxlength: '200', required: true, value: editing ? event.title : '', readonly: readOnly });
      var when = el('input', { id: ids.d, type: 'datetime-local', required: true, value: toLocalInput(start), readonly: readOnly });
      var end = el('input', { id: ids.e, type: 'datetime-local', value: editing && event.endAt ? toLocalInput(new Date(event.endAt)) : '', readonly: readOnly });
      var content = el('textarea', { id: ids.c, maxlength: '5000', readonly: readOnly });
      content.value = editing ? (event.content || '') : '';
      var chosen = new Set(editing ? event.channels || [] : []);
      var channelNames = this._cfg.channels.slice();
      chosen.forEach(function (c) { if (channelNames.indexOf(c) < 0) channelNames.push(c); });
      var errBox = el('div', { class: 'ferr', role: 'alert' });
      var saveBtn;

      var fields = [
        el('label', { for: ids.t, text: 'Title' }), title,
        el('div', { class: 'row' }, [
          el('div', {}, [el('label', { for: ids.d, text: 'Starts' }), when]),
          el('div', {}, [el('label', { for: ids.e, text: 'Ends (optional)' }), end])
        ]),
        channelNames.length ? el('label', { text: 'Channels' }) : null,
        channelNames.length ? el('div', { class: 'chips' }, channelNames.map(function (c) {
          var box = el('input', { type: 'checkbox', checked: chosen.has(c), disabled: readOnly, onchange: function () { box.checked ? chosen.add(c) : chosen.delete(c); } });
          return el('label', {}, [box, c]);
        })) : null,
        el('label', { for: ids.c, text: 'Details' }), content,
        editing && event.status === 'pending' ? el('p', { class: 'ferr', style: 'color:var(--pending)', text: 'Requested time: waiting for confirmation.' }) : null,
        errBox
      ];

      async function submit(ev) {
        if (ev) ev.preventDefault();
        if (readOnly) return close();
        errBox.textContent = '';
        var t = title.value.trim();
        if (!t) { errBox.textContent = 'Add a title.'; title.focus(); return; }
        if (!when.value) { errBox.textContent = 'Choose a start date and time.'; when.focus(); return; }
        var s = new Date(when.value), en = end.value ? new Date(end.value) : null;
        if (en && en < s) { errBox.textContent = 'The end must be after the start.'; end.focus(); return; }
        var payload = { title: t, scheduledAt: s.toISOString(), content: content.value };
        if (en) payload.endAt = en.toISOString(); else if (editing && event.endAt) payload.endAt = null;
        payload.channels = Array.from(chosen);
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        try {
          close(); // optimistic: the calendar shows the change right away
          if (editing) await self._update(event.id, payload, 'Saved.'); else await self._create(payload);
        } catch (e) { /* toast already shown and change rolled back */ }
      }

      var actions = [];
      if (editing && this._perm.manage) {
        actions.push(el('button', { type: 'button', class: 'danger left', onclick: function () {
          if (!confirm('Delete “' + event.title + '”? This can’t be undone.')) return;
          close(); self._delete(event.id).catch(function () {});
        }, text: 'Delete' }));
        if (event.status === 'pending') actions.push(el('button', { type: 'button', onclick: function () { close(); self._update(event.id, { status: 'scheduled' }, 'Confirmed.').catch(function () {}); }, text: 'Confirm request' }));
      }
      actions.push(el('button', { type: 'button', onclick: function () { close(); }, text: readOnly ? 'Close' : 'Cancel' }));
      if (!readOnly) actions.push(saveBtn = el('button', { type: 'submit', class: 'primary', text: editing ? 'Save changes' : (this._perm.manage ? 'Schedule' : 'Send request') }));

      var dialog = el('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': ids.h, novalidate: true, onsubmit: submit }, [
        el('h2', { id: ids.h, text: readOnly ? 'Event details' : editing ? 'Edit event' : (this._perm.manage ? 'New event' : 'Request a time') })
      ].concat(fields).concat([el('div', { class: 'actions' }, actions)]));
      var overlay = el('div', { class: 'overlay', onmousedown: function (e) { if (e.target === overlay) close(); } }, [dialog]);

      function close() {
        overlay.remove(); self._modalOpen = false;
        if (opener && opener.isConnected) opener.focus(); else self._shell.querySelector('[data-focus-key]') && self._shell.querySelector('[data-focus-key]').focus();
      }
      dialog.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        var f = Array.prototype.filter.call(dialog.querySelectorAll('button,input,textarea,select'), function (x) { return !x.disabled; });
        var first = f[0], last = f[f.length - 1], active = self._root.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      });
      this._shell.appendChild(overlay);
      this._modalOpen = true;
      (readOnly ? dialog.querySelector('button') : title).focus();
    }

    // -------------------------------------------------------------- feedback
    _setStatus(text, isErr) { this._statusText = text; this._statusErr = !!isErr; if (this._statusEl) { this._statusEl.textContent = text; this._statusEl.className = 'status' + (isErr ? ' err' : ''); } }
    _toast(text) {
      var self = this;
      this._toastText = text; this._live.textContent = text;
      clearTimeout(this._toastTimer);
      if (!this._modalOpen) this._render();
      this._toastTimer = setTimeout(function () { self._toastText = ''; if (!self._modalOpen) self._render(); }, 3500);
    }
  }

  customElements.define('obsidian-calendar', ObsidianCalendar);

  // Script-tag-only embed: <script src=".../widget.js" data-api-key="pk_…" data-target="#calendar"></script>
  if (SCRIPT && (SCRIPT.dataset.apiKey || SCRIPT.dataset.token || SCRIPT.dataset.tokenUrl)) {
    var mount = function () {
      var target = SCRIPT.dataset.target ? document.querySelector(SCRIPT.dataset.target) : null;
      var node = document.createElement('obsidian-calendar');
      ['apiKey', 'token', 'tokenUrl', 'endpoint', 'theme', 'view', 'locale', 'channels', 'live'].forEach(function (k) { if (SCRIPT.dataset[k]) node.dataset[k] = SCRIPT.dataset[k]; });
      if (target) target.appendChild(node); else SCRIPT.parentNode.insertBefore(node, SCRIPT.nextSibling);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  }
})();
