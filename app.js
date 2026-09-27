/* Poker tra amici — interfaccia e rete.
   Chi crea il tavolo fa da banco: tiene il mazzo e manda a ogni telefono
   solo quello che quel giocatore può vedere. */
(() => {
  'use strict';

  const PREFIX = 'pta-poker-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_NAME = 14;
  const HANDOVER_MS = 6500;
  const RUNOUT_MS = 1300;
  const AUTO_MS = 1500;
  const PING_MS = 5000;
  const STALE_MS = 12000;
  const JOIN_WINDOW_MS = 120000;
  const VERSION = '1.2';
  const FATAL = new Set(['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable', 'unavailable-id']);

  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('it-IT');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('pta:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pta:' + k, JSON.stringify(v)); } catch (e) { /* ignora */ } },
  };
  function rid(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => (b % 36).toString(36)).join('');
  }
  const cid = window.__PTA_CID || store.get('cid') || (() => { const c = rid(16); store.set('cid', c); return c; })();

  const params = new URLSearchParams(location.search);
  const S = {
    screen: 'home',
    name: store.get('name', ''),
    joinCode: (params.get('t') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
    settings: Object.assign({ chips: 1000, sb: 10, every: 0 }, store.get('settings', {})),
    error: '',
    busy: false,
    role: null,
    code: null,
    myId: null,
    joined: false,
    joinNote: '',
    view: null,
    status: 'ok',
    raiseOpen: false,
    raiseTo: 0,
    anim: null,
  };

  const H = { peer: null, table: null, conns: new Map(), byCid: new Map(), timers: {}, ping: null };
  const C = { peer: null, conn: null, tries: 0, closing: false, seen: 0, ping: null };

  /* ---------- Registro tecnico (per capire dove si blocca un collegamento) ---------- */
  const LOG = [];
  function log(msg) {
    const d = new Date();
    const hh = (n) => String(n).padStart(2, '0');
    LOG.push(hh(d.getHours()) + ':' + hh(d.getMinutes()) + ':' + hh(d.getSeconds()) + '  ' + msg);
    if (LOG.length > 60) LOG.shift();
  }
  function device() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : 'Computer';
    const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'altro browser';
    const pwa = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? ', app installata' : '';
    return os + ', ' + br + pwa;
  }
  log('Versione ' + VERSION + ' su ' + device());
  function diagHTML() {
    if (!LOG.length) return '';
    return `<details class="diag"><summary>Dettagli tecnici</summary><pre>${esc(LOG.join('\n'))}</pre></details>`;
  }

  /* ---------- Carte ---------- */
  const SUIT = {
    s: 'M12 2C9.6 5.4 3.5 9 3.5 13.4c0 2.7 2.1 4.6 4.5 4.6 1.4 0 2.6-.6 3.4-1.6-.3 2-1.2 3.6-2.7 5.1h7.6c-1.5-1.5-2.4-3.1-2.7-5.1.8 1 2 1.6 3.4 1.6 2.4 0 4.5-1.9 4.5-4.6C20.5 9 14.4 5.4 12 2z',
    h: 'M12 21.2C6.2 16.6 2.5 13.2 2.5 8.9c0-3 2.3-5.3 5.1-5.3 1.8 0 3.4.9 4.4 2.4 1-1.5 2.6-2.4 4.4-2.4 2.8 0 5.1 2.3 5.1 5.3 0 4.3-3.7 7.7-9.5 12.3z',
    d: 'M12 1.8l7.8 10.2L12 22.2 4.2 12z',
    c: 'M12 2.2a4.3 4.3 0 0 0-4 5.9 4.3 4.3 0 1 0 2.6 7.3c-.3 2-1.1 3.7-2.6 5.4h8c-1.5-1.7-2.3-3.4-2.6-5.4a4.3 4.3 0 1 0 2.6-7.3 4.3 4.3 0 0 0-4-5.9z',
  };
  const SUIT_NAME = { s: 'picche', h: 'cuori', d: 'quadri', c: 'fiori' };
  const RANK_NAME = { A: 'Asso', K: 'Re', Q: 'Donna', J: 'Jack', T: '10' };
  const rankTxt = (r) => (r === 'T' ? '10' : r);

  function cardHTML(c, cls, i) {
    const red = c[1] === 'h' || c[1] === 'd';
    const label = (RANK_NAME[c[0]] || c[0]) + ' di ' + SUIT_NAME[c[1]];
    const style = i != null ? ` style="--i:${i}"` : '';
    return `<div class="card${red ? ' red' : ''}${cls ? ' ' + cls : ''}"${style} role="img" aria-label="${label}"><b>${rankTxt(c[0])}</b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SUIT[c[1]]}"/></svg></div>`;
  }
  const backHTML = (cls, i) => `<div class="card back${cls ? ' ' + cls : ''}"${i != null ? ` style="--i:${i}"` : ''} aria-hidden="true"></div>`;

  /* ---------- Utilità ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function genCode() {
    const a = new Uint8Array(5);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }
  function cleanName(n) {
    return String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Giocatore';
  }
  function PeerCtor() {
    return window.Peer || (window.peerjs && (window.peerjs.Peer || window.peerjs.default)) || null;
  }
  function peerError(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return 'Nessun tavolo con questo codice. Controlla le lettere e riprova.';
    if (t === 'browser-incompatible') return 'Questo browser non supporta il gioco online. Prova con Chrome.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed')
      return 'Il servizio di collegamento non risponde. Controlla internet e riprova.';
    return 'Collegamento non riuscito' + (t ? ' (' + t + ')' : '') + '. Riprova.';
  }
  function send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { /* ignora */ }
  }
  function shareUrl() {
    return location.origin + location.pathname + '?t=' + S.code;
  }
  async function share() {
    const url = shareUrl();
    const text = 'Vieni a giocare a poker con me! Codice del tavolo: ' + S.code;
    if (navigator.share) {
      try { await navigator.share({ title: 'Poker tra amici', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text + '\n' + url); toast('Link copiato'); } catch (e) { toast('Codice: ' + S.code); }
  }

  let wake = null;
  async function acquireWake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      }
    } catch (e) { /* non supportato */ }
  }
  function releaseWake() { try { wake && wake.release(); } catch (e) { /* ignora */ } wake = null; }

  /* ---------- Banco (host) ---------- */
  function hostCreate() {
    const P = PeerCtor();
    if (!P) { S.error = 'Non riesco a caricare il collegamento. Controlla internet e ricarica la pagina.'; return render(); }
    S.busy = true;
    S.error = '';
    render();
    const st = S.settings;
    const table = new Engine.Table({ startChips: st.chips, sb: st.sb, bb: st.sb * 2, blindEvery: st.every });
    let attempt = 0;
    const tryOpen = () => {
      const code = genCode();
      const peer = new P(PREFIX + code, { debug: 1 });
      let opened = false;
      peer.on('open', () => {
        // PeerJS ripete l'evento "open" ogni volta che si ricollega al servizio:
        // il tavolo va preparato solo la prima volta.
        if (opened) { log('Tavolo di nuovo raggiungibile'); return; }
        opened = true;
        log('Tavolo ' + code + ' aperto');
        H.peer = peer;
        H.table = table;
        S.code = code;
        S.role = 'host';
        S.myId = 'p' + rid(10);
        S.joined = true;
        S.busy = false;
        table.addPlayer(S.myId, cleanName(S.name));
        H.byCid.set(cid, S.myId);
        H.ping = setInterval(hostPing, PING_MS);
        history.replaceState(null, '', location.pathname);
        history.pushState({ table: 1 }, '');
        acquireWake();
        hostTick();
      });
      peer.on('connection', (conn) => { log('Qualcuno sta entrando'); hostOnConn(conn); });
      peer.on('disconnected', () => {
        if (H.peer === peer && !peer.destroyed) log('Tavolo non raggiungibile: mi ricollego');
        if (!peer.destroyed && H.peer === peer) setTimeout(() => { try { if (peer.disconnected && !peer.destroyed) peer.reconnect(); } catch (e) { /* riprova dopo */ } }, 1500);
      });
      peer.on('error', (err) => {
        log('Errore del banco: ' + (err && err.type));
        if (!opened) {
          try { peer.destroy(); } catch (e) { /* ignora */ }
          if (err && err.type === 'unavailable-id' && attempt++ < 5) return tryOpen();
          S.busy = false;
          S.error = peerError(err);
          render();
        }
      });
    };
    tryOpen();
  }

  function hostOnConn(conn) {
    conn.on('open', () => hostConnOpened(conn));
    conn.on('data', (msg) => hostOnMsg(conn, msg));
    conn.on('close', () => hostOnClose(conn));
    // Un errore sul canale non vuol dire che il giocatore se n'è andato:
    // lo decidono la chiusura vera o il controllo periodico (hostPing).
    conn.on('error', (err) => { try { console.warn('Collegamento con un giocatore:', err && err.type); } catch (e) { /* ignora */ } });
  }

  // Il messaggio di benvenuto parte solo quando il canale è davvero aperto
  // anche dal lato del banco; prima andrebbe perso in silenzio.
  function hostConnOpened(conn) {
    const info = H.conns.get(conn);
    if (!info || info.welcomed || !conn.open) return;
    const p = H.table && H.table.players.find((x) => x.id === info.pid);
    log((p ? p.name : 'Un giocatore') + ' è al tavolo');
    info.welcomed = true;
    send(conn, { t: 'welcome', pid: info.pid, code: S.code });
    hostTick();
  }

  function lastSeen(pid) {
    let t = 0;
    for (const i of H.conns.values()) if (i.pid === pid) t = Math.max(t, i.seen);
    return t;
  }

  // Riconosce chi rientra: prima dal codice del dispositivo, poi dal nome.
  // Il nome serve quando lo stesso telefono apre l'app da un posto diverso
  // (Safari, app installata, browser interno di WhatsApp): ognuno ha la sua memoria.
  function findReturning(key, name) {
    const t = H.table;
    const pid = H.byCid.get(key);
    const byId = pid && t.players.find((x) => x.id === pid);
    if (byId) return byId;
    const lower = name.toLowerCase();
    const now = Date.now();
    return t.players.find((x) => x.id !== S.myId && x.name.toLowerCase() === lower &&
      (!x.connected || now - lastSeen(x.id) > STALE_MS)) || null;
  }

  function uniqueName(name) {
    const taken = new Set(H.table.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let k = 2; k < 20; k++) {
      const n = name.slice(0, MAX_NAME - 2) + ' ' + k;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name + ' ' + rid(2);
  }

  function hostOnMsg(conn, msg) {
    if (!msg || typeof msg !== 'object' || !H.table) return;
    const t = H.table;
    const info = H.conns.get(conn);
    if (info) info.seen = Date.now();

    if (msg.t === 'hello') {
      const key = String(msg.cid || '').slice(0, 40);
      const name = cleanName(msg.name);
      let p = findReturning(key, name);
      let pid = p ? p.id : null;
      if (p) H.byCid.set(key, pid);
      if (!p) {
        if (t.players.length >= t.maxPlayers) {
          send(conn, { t: 'deny', reason: 'Il tavolo è pieno: massimo ' + t.maxPlayers + ' giocatori.' });
          setTimeout(() => { try { conn.close(); } catch (e) { /* ignora */ } }, 500);
          return;
        }
        pid = 'p' + rid(10);
        p = t.addPlayer(pid, uniqueName(name));
        H.byCid.set(key, pid);
      }
      for (const [c, i] of H.conns) {
        if (i.pid === pid && c !== conn) { H.conns.delete(c); try { c.close(); } catch (e) { /* ignora */ } }
      }
      H.conns.set(conn, { pid, seen: Date.now(), welcomed: false });
      p.connected = true;
      t.seq++;
      if (conn.open) hostConnOpened(conn);
      else hostTick();
      return;
    }
    if (!info) return;
    if (msg.t === 'act') {
      const err = t.act(info.pid, String(msg.a), msg.amount);
      if (err) send(conn, { t: 'err', msg: err });
      hostTick();
    } else if (msg.t === 'rebuy') {
      const err = t.rebuy(info.pid);
      if (err) send(conn, { t: 'err', msg: err });
      hostTick();
    } else if (msg.t === 'leave') {
      hostOnClose(conn);
    }
  }

  function hostOnClose(conn) {
    const info = H.conns.get(conn);
    if (!info || !H.table) return;
    H.conns.delete(conn);
    const gone = H.table.players.find((x) => x.id === info.pid);
    log((gone ? gone.name : 'Un giocatore') + ' si è scollegato');
    try { conn.close(); } catch (e) { /* ignora */ }
    const t = H.table;
    const p = t.players.find((x) => x.id === info.pid);
    if (!p) return;
    if ([...H.conns.values()].some((i) => i.pid === p.id)) return;
    if (t.phase === 'lobby') {
      t.removePlayer(p.id);
      for (const [k, v] of H.byCid) if (v === p.id) H.byCid.delete(k);
    } else {
      p.connected = false;
      t.seq++;
    }
    hostTick();
  }

  function hostPing() {
    const now = Date.now();
    for (const [conn, info] of [...H.conns]) {
      if (now - info.seen > 20000) hostOnClose(conn);
      else send(conn, { t: 'ping' });
    }
    if (H.peer && H.peer.disconnected && !H.peer.destroyed) { try { H.peer.reconnect(); } catch (e) { /* riprova */ } }
  }

  function clearHostTimers() {
    for (const k of Object.keys(H.timers)) { clearTimeout(H.timers[k]); delete H.timers[k]; }
  }

  function hostTick() {
    const t = H.table;
    if (!t) return;
    if (t.phase === 'handover' && !H.timers.next) {
      H.timers.next = setTimeout(() => {
        delete H.timers.next;
        if (H.table && H.table.phase === 'handover') { H.table.startHand(); hostTick(); }
      }, HANDOVER_MS);
    }
    if (t.phase === 'paused' && !t.champion && t.dealable().length >= 2 && !H.timers.next) {
      H.timers.next = setTimeout(() => {
        delete H.timers.next;
        if (H.table && H.table.phase === 'paused') { H.table.startHand(); hostTick(); }
      }, 2000);
    }
    if (t.runout && !H.timers.run) {
      H.timers.run = setTimeout(() => {
        delete H.timers.run;
        if (H.table && H.table.runout) { H.table.runoutStep(); hostTick(); }
      }, RUNOUT_MS);
    }
    if (t.phase === 'playing' && !t.runout && t.toAct >= 0 && !t.players[t.toAct].connected && !H.timers.auto) {
      H.timers.auto = setTimeout(() => { delete H.timers.auto; hostAutoAct(false); }, AUTO_MS);
    }
    for (const [conn, info] of H.conns) if (info.welcomed) send(conn, { t: 'view', v: t.viewFor(info.pid) });
    onView(t.viewFor(S.myId));
  }

  function hostRemove(pid) {
    const t = H.table;
    if (!t) return;
    const p = t.players.find((x) => x.id === pid);
    if (!p || p.id === S.myId || (t.phase === 'playing' && p.inHand)) return;
    for (const [c, i] of [...H.conns]) if (i.pid === pid) { H.conns.delete(c); send(c, { t: 'closed' }); try { c.close(); } catch (e) { /* ignora */ } }
    for (const [k, v] of [...H.byCid]) if (v === pid) H.byCid.delete(k);
    t.removePlayer(pid);
    hostTick();
  }

  function hostAutoAct(force) {
    const t = H.table;
    if (!t || t.phase !== 'playing' || t.runout || t.toAct < 0) return;
    const p = t.players[t.toAct];
    if (p.connected && !force) return;
    t.act(p.id, t.currentBet > p.bet ? 'fold' : 'check');
    hostTick();
  }

  /* ---------- Giocatore (client) ---------- */
  function clientJoin() {
    const P = PeerCtor();
    if (!P) { log('Libreria di collegamento non caricata'); S.error = 'Non riesco a caricare il collegamento. Controlla internet e ricarica la pagina.'; return render(); }
    S.busy = true;
    S.error = '';
    S.joinNote = '';
    S.code = S.joinCode;
    S.role = 'guest';
    C.closing = false;
    C.tries = 0;
    C.attempts = 0;
    C.lastErr = null;
    C.joinStart = Date.now();
    log('Cerco il tavolo ' + S.code);
    render();
    const peer = new P({ debug: 1 });
    C.peer = peer;
    let opened = false;
    peer.on('open', () => {
      // Anche qui "open" si ripete dopo ogni ricollegamento: si parte una volta sola.
      if (opened) { log('Di nuovo collegato al servizio'); return; }
      opened = true;
      log('Collegato al servizio');
      clientConnect();
    });
    peer.on('error', (err) => {
      if (C.peer !== peer || C.closing) return;
      const type = err && err.type;
      C.lastErr = type;
      log('Errore: ' + type);
      if (S.joined) return; // a partita iniziata ci pensa il ricollegamento automatico
      if (!opened || FATAL.has(type)) return joinFailed(peerError(err));
      if (C.conn && !C.conn.open) joinAttemptFailed(C.conn);
    });
    peer.on('disconnected', () => {
      if (!C.closing && C.peer === peer) log('Collegamento al servizio perso');
      if (!C.closing && C.peer === peer) setTimeout(() => { try { if (peer.disconnected && !peer.destroyed) peer.reconnect(); } catch (e) { /* riprova */ } }, 1500);
    });
  }

  function joinFailed(msg) {
    clientTeardown();
    S.busy = false;
    S.joinNote = '';
    S.error = msg;
    render();
  }

  // Se il tavolo non risponde (di solito perché chi l'ha creato è uscito dall'app
  // per mandare il link), si continua a provare per un paio di minuti.
  function joinAttemptFailed(conn) {
    if (S.joined || C.closing || conn !== C.conn || conn._failed) return;
    conn._failed = true;
    try { conn.close(); } catch (e) { /* ignora */ }
    if (Date.now() - C.joinStart > JOIN_WINDOW_MS) {
      log('Rinuncio dopo ' + (C.attempts + 1) + ' tentativi');
      return joinFailed('Il tavolo ' + S.code + ' non risponde. Controlla il codice e chiedi a chi l\'ha creato di tenere l\'app aperta sullo schermo.');
    }
    C.attempts++;
    S.joinNote = 'Il tavolo non risponde ancora. Se chi l\'ha creato è uscito dall\'app, chiedigli di riaprirla: intanto continuo a provare.';
    render();
    setTimeout(() => {
      if (C.closing || S.joined || !C.peer) return;
      try { if (C.peer.disconnected && !C.peer.destroyed) C.peer.reconnect(); } catch (e) { /* ignora */ }
      clientConnect();
    }, 3000);
  }

  function clientConnect() {
    if (C.closing || !C.peer) return;
    const conn = C.peer.connect(PREFIX + S.code, { reliable: true, serialization: 'json' });
    C.conn = conn;
    if (!S.joined) log('Tentativo ' + (C.attempts + 1) + ': busso al tavolo');
    let dead = false;
    const lost = () => {
      if (dead || C.conn !== conn) return;
      if (!S.joined) return joinAttemptFailed(conn);
      dead = true;
      onClientLost();
    };
    // Tempo massimo per aprire il canale e ricevere il benvenuto.
    const timer = setTimeout(() => { if (!S.joined || !conn.open) { log('Nessuna risposta dal tavolo'); lost(); } }, 10000);
    conn.on('open', () => {
      log('Canale aperto, mi presento');
      C.seen = Date.now();
      send(conn, { t: 'hello', name: cleanName(S.name), cid });
    });
    conn.on('data', (msg) => {
      C.seen = Date.now();
      if (msg && msg.t === 'welcome') { clearTimeout(timer); log('Entrato al tavolo'); }
      clientOnMsg(msg);
    });
    conn.on('close', () => { clearTimeout(timer); if (C.conn === conn && !conn._failed) log('Canale chiuso'); lost(); });
    conn.on('error', () => { if (!conn.open) { clearTimeout(timer); lost(); } });
  }

  function onClientLost() {
    if (C.closing) return;
    if (C.tries >= 6) { S.status = 'lost'; return render(); }
    S.status = 'reconnecting';
    render();
    C.tries++;
    setTimeout(() => {
      if (C.closing || !C.peer) return;
      try { if (C.peer.disconnected && !C.peer.destroyed) C.peer.reconnect(); } catch (e) { /* ignora */ }
      clientConnect();
    }, 2000);
  }

  function clientOnMsg(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      S.myId = msg.pid;
      if (!S.joined) {
        S.joined = true;
        history.replaceState(null, '', location.pathname);
        history.pushState({ table: 1 }, '');
        C.ping = setInterval(clientPing, PING_MS);
      }
      S.busy = false;
      S.joinNote = '';
      S.status = 'ok';
      C.tries = 0;
      acquireWake();
    } else if (msg.t === 'view') {
      if (S.status !== 'ok') S.status = 'ok';
      onView(msg.v);
    } else if (msg.t === 'deny') {
      clientTeardown();
      S.busy = false;
      S.error = String(msg.reason || 'Non puoi entrare in questo tavolo.');
      render();
    } else if (msg.t === 'err') {
      toast(String(msg.msg || 'Azione non valida'));
    } else if (msg.t === 'closed') {
      teardown('Il banco ha chiuso il tavolo.');
    }
  }

  function clientPing() {
    if (!S.joined || C.closing) return;
    send(C.conn, { t: 'ping' });
    if (S.status === 'ok' && Date.now() - C.seen > 16000 && C.conn) {
      const c = C.conn;
      try { c.close(); } catch (e) { /* ignora */ }
      if (C.conn === c) onClientLost();
    }
  }

  function clientRetry() {
    C.tries = 0;
    S.status = 'reconnecting';
    render();
    if (!C.peer || C.peer.destroyed) {
      const P = PeerCtor();
      C.peer = new P({ debug: 1 });
      C.peer.on('open', () => clientConnect());
      return;
    }
    clientConnect();
  }

  function clientTeardown() {
    C.closing = true;
    clearInterval(C.ping);
    try { C.conn && C.conn.close(); } catch (e) { /* ignora */ }
    try { C.peer && C.peer.destroy(); } catch (e) { /* ignora */ }
    C.peer = null;
    C.conn = null;
  }

  /* ---------- Uscita ---------- */
  function teardown(msg) {
    clearHostTimers();
    clearInterval(H.ping);
    if (H.peer) { try { H.peer.destroy(); } catch (e) { /* ignora */ } }
    H.peer = null; H.table = null; H.conns = new Map(); H.byCid = new Map();
    clientTeardown();
    releaseWake();
    Object.assign(S, { screen: 'home', role: null, code: null, myId: null, joined: false, view: null, status: 'ok', busy: false, raiseOpen: false, error: msg || '' });
    render();
  }

  function leave() {
    if (S.role === 'host') {
      if (!confirm('Se chiudi il tavolo, la partita finisce per tutti. Vuoi chiuderlo?')) return;
      for (const [c] of H.conns) send(c, { t: 'closed' });
      setTimeout(() => teardown(), 300);
    } else if (S.role === 'guest') {
      if (S.status === 'ok' && !confirm('Vuoi lasciare il tavolo?')) return;
      send(C.conn, { t: 'leave' });
      setTimeout(() => teardown(), 200);
    } else {
      teardown();
    }
  }

  /* ---------- Azioni di gioco ---------- */
  function sendAction(a, amount) {
    if (S.role === 'host') {
      const err = H.table.act(S.myId, a, amount);
      if (err) toast(err);
      S.raiseOpen = false;
      hostTick();
    } else {
      send(C.conn, { t: 'act', a, amount });
      S.raiseOpen = false;
      if (S.view) S.view.actions = null;
      render();
    }
  }

  function quickRaise(kind) {
    const v = S.view;
    const a = v && v.actions;
    if (!a) return;
    const potAfterCall = v.pot + a.toCall;
    let x = a.minTo;
    if (kind === 'half') x = v.currentBet + Math.round(potAfterCall / 2);
    else if (kind === 'pot') x = v.currentBet + potAfterCall;
    else if (kind === 'max') x = a.maxTo;
    S.raiseTo = Math.max(a.minTo, Math.min(a.maxTo, x));
    syncRaise();
  }

  function raiseLabel() {
    const a = S.view.actions;
    if (S.raiseTo >= a.maxTo) return 'All-in ' + fmt(a.maxTo);
    return (a.isBet ? 'Punta ' : 'Rilancia a ') + fmt(S.raiseTo);
  }

  function syncRaise() {
    const r = $('#raiseRange');
    if (r) r.value = String(S.raiseTo);
    const val = $('#raiseVal');
    if (val) val.textContent = fmt(S.raiseTo);
    const go = $('#raiseGo');
    if (go) go.textContent = raiseLabel();
  }

  /* ---------- Vista ---------- */
  function onView(v) {
    const prev = S.view;
    const sameHand = prev && prev.handNo === v.handNo && prev.phase !== 'lobby';
    const mine = (x) => (x && x.players[x.me] && x.players[x.me].cards ? x.players[x.me].cards.join() : '');
    S.anim = {
      boardFrom: sameHand ? prev.board.length : 0,
      hole: mine(v) !== '' && mine(v) !== mine(prev),
    };
    const wasTurn = !!(prev && prev.actions);
    const isTurn = !!v.actions;
    if (isTurn && !wasTurn) {
      S.raiseOpen = false;
      try { navigator.vibrate && navigator.vibrate(90); } catch (e) { /* ignora */ }
    }
    if (!isTurn) S.raiseOpen = false;
    S.view = v;
    S.screen = v.phase === 'lobby' ? 'lobby' : 'table';
    render();
    if (isTurn && !wasTurn) {
      const meEl = $('.me');
      if (meEl) meEl.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  function render() {
    if (S.screen === 'create') app.innerHTML = renderCreate();
    else if (S.screen === 'lobby' && S.view) app.innerHTML = renderLobby();
    else if (S.screen === 'table' && S.view) app.innerHTML = renderTable();
    else app.innerHTML = renderHome();
    S.anim = null;
  }

  function renderHome() {
    const fan = [cardHTML('As'), cardHTML('Kh'), cardHTML('Qd')].join('');
    const joinBtn = `<button class="btn primary" data-act="join" ${S.busy ? 'disabled' : ''}>${S.busy && S.role === 'guest' ? '<span class="spin"></span>Mi collego al tavolo' : 'Entra al tavolo'}</button>`;
    return `<main class="page">
      <div class="fan" aria-hidden="true">${fan}</div>
      <h1>Poker tra amici</h1>
      <p class="lead">Texas Hold'em con fiches finte. Un telefono fa da banco, gli altri entrano con il codice del tavolo.</p>
      <label class="field"><span>Il tuo nome al tavolo</span>
        <input id="name" maxlength="${MAX_NAME}" autocomplete="nickname" enterkeyhint="next" value="${esc(S.name)}" placeholder="Come ti chiamano gli amici"></label>
      <label class="field"><span>Codice del tavolo</span>
        <input id="code" class="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" value="${esc(S.joinCode)}" placeholder="5 lettere o numeri"></label>
      ${joinBtn}
      ${S.busy && S.role === 'guest' ? `<p class="muted small">${esc(S.joinNote || 'Busso al tavolo…')}</p><button class="btn ghost" data-act="cancel-join">Annulla</button>` : ''}
      <p class="err" role="alert">${esc(S.error)}</p>
      ${S.error ? diagHTML() : ''}
      <div class="divider">oppure</div>
      <button class="btn ghost" data-act="go-create" ${S.busy ? 'disabled' : ''}>Crea un nuovo tavolo</button>
      <p class="version">Versione ${VERSION}</p>
      ${!S.error ? diagHTML().replace('class="diag"', 'class="diag quiet"') : ''}
    </main>`;
  }

  function seg(key, options) {
    return `<div class="seg${options.length === 3 ? ' three' : ''}">${options.map(([val, label]) =>
      `<button data-act="set" data-k="${key}" data-v="${val}" aria-pressed="${S.settings[key] === val}">${label}</button>`).join('')}</div>`;
  }

  function renderCreate() {
    return `<main class="page">
      <h2>Nuovo tavolo</h2>
      <p class="muted">Le fiches si azzerano a ogni partita. Potrai invitare fino a 7 amici.</p>
      <div class="opt"><span>Fiches iniziali per ognuno</span>${seg('chips', [[500, '500'], [1000, '1.000'], [2000, '2.000'], [5000, '5.000']])}</div>
      <div class="opt"><span>Bui (piccolo e grande)</span>${seg('sb', [[5, '5/10'], [10, '10/20'], [25, '25/50'], [50, '50/100']])}</div>
      <div class="opt"><span>I bui raddoppiano</span>${seg('every', [[0, 'Mai'], [10, 'Ogni 10 mani'], [20, 'Ogni 20 mani']])}</div>
      <button class="btn primary" data-act="open-table" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spin"></span>Apro il tavolo' : 'Apri il tavolo'}</button>
      <p class="err" role="alert">${esc(S.error)}</p>
      <button class="btn ghost" data-act="back" ${S.busy ? 'disabled' : ''}>Indietro</button>
    </main>`;
  }

  function renderLobby() {
    const v = S.view;
    const host = S.role === 'host';
    const n = v.players.length;
    const hostName = v.players[0] ? v.players[0].name : 'il banco';
    const list = v.players.map((p, i) => `<li><span class="dot${p.connected ? ' on' : ''}"></span><span>${esc(p.name)}${p.id === S.myId ? ' <small>(tu)</small>' : ''}${i === 0 ? ' <small>fa da banco</small>' : ''}</span></li>`).join('');
    const rules = `${fmt(v.startChips)} fiches a testa, bui ${fmt(v.sb)}/${fmt(v.bb)}${v.blindEvery ? `, raddoppiano ogni ${v.blindEvery} mani` : ''}.`;
    const codeCards = String(S.code || '').split('').map((ch) => `<span>${esc(ch)}</span>`).join('');
    return `<main class="page">
      <h2>${host ? 'Il tavolo è aperto' : 'Sei al tavolo'}</h2>
      <p class="muted">${host ? 'Gli amici entrano con questo codice o con il link. Dopo averlo mandato torna subito qui: mentre l\'app è chiusa, il tavolo non risponde.' : 'Codice del tavolo'}</p>
      <div class="codecards" aria-label="Codice ${esc(S.code)}">${codeCards}</div>
      <button class="btn ${host && n < 2 ? 'primary' : 'ghost'}" data-act="share">Invita gli amici</button>
      <h3>Al tavolo, ${n} su ${v.maxPlayers}</h3>
      <ul class="plist">${list}</ul>
      <p class="muted small">${rules}</p>
      ${host
        ? `<button class="btn primary" data-act="start" ${n < 2 ? 'disabled' : ''}>${n < 2 ? 'Aspetta almeno un amico' : 'Inizia la partita'}</button>
           <p class="note">Tieni l'app aperta durante la partita: il tuo telefono fa da banco.</p>`
        : `<p class="msg">Aspetta che <strong>${esc(hostName)}</strong> inizi la partita.</p>`}
      <button class="btn ghost" data-act="leave">${host ? 'Chiudi il tavolo' : 'Esci dal tavolo'}</button>
      ${diagHTML()}
    </main>`;
  }

  function lcFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }

  function renderTable() {
    const v = S.view;
    const host = S.role === 'host';
    const me = v.me >= 0 ? v.players[v.me] : null;
    const n = v.players.length;
    const order = [];
    for (let k = 1; k <= n; k++) {
      const i = v.me >= 0 ? (v.me + k) % n : k - 1;
      if (i !== v.me) order.push(i);
    }
    const winners = new Set(v.phase === 'handover' && v.results ? v.results.lines.map((l) => l.id) : []);
    const bestCards = new Set(v.phase === 'handover' && v.results && v.results.showdown ? v.results.lines.flatMap((l) => l.best) : []);
    const anim = S.anim || { boardFrom: 99, hole: false };

    const seats = order.map((i) => seatHTML(v.players[i], i, v, winners)).join('');

    let k = 0;
    const board = [0, 1, 2, 3, 4].map((i) => {
      const c = v.board[i];
      if (!c) return '<div class="slot"></div>';
      const isNew = i >= anim.boardFrom;
      const cls = [isNew ? 'deal' : '', bestCards.has(c) ? 'hl' : ''].filter(Boolean).join(' ');
      return cardHTML(c, cls, isNew ? k++ : null);
    }).join('');

    let middle = '';
    if (v.phase === 'playing') {
      middle = `<p class="pot">Piatto <b>${fmt(v.pot)}</b></p>${v.notice ? `<p class="notice">${esc(v.notice)}</p>` : ''}`;
    } else if (v.phase === 'handover' && v.results) {
      const r = v.results;
      middle = `<div class="result">${r.lines.map((l) => `<div><b>${esc(l.name)}</b> vince <span class="amt">${fmt(l.amount)}</span>${l.hand ? ` con ${esc(lcFirst(l.hand))}` : ''}</div>`).join('')}${!r.showdown ? '<div class="muted small">Gli altri hanno passato.</div>' : ''}</div>`;
    } else if (v.phase === 'paused') {
      const champ = v.champion && v.players.find((p) => p.id === v.champion);
      middle = champ
        ? `<div class="result"><div><b>${esc(champ.name)}</b> ha vinto tutte le fiches!</div></div>`
        : '<div class="result"><div class="muted">Servono almeno due giocatori collegati con delle fiches.</div></div>';
    }

    return `<div class="table">
      <header class="topbar">
        <button class="codebtn" data-act="share" aria-label="Invita al tavolo ${esc(S.code)}">Tavolo<span>${esc(S.code)}</span></button>
        <span class="meta">${v.handNo ? 'Mano ' + v.handNo + ', ' : ''}bui ${fmt(v.sb)}/${fmt(v.bb)}</span>
        <button class="linkbtn" data-act="leave">Esci</button>
      </header>
      ${statusBanner()}
      <section class="seats" aria-label="Avversari">${seats}</section>
      <section class="felt" aria-label="Tavolo">
        <div class="board">${board}</div>
        ${middle}
      </section>
      ${me ? meHTML(me, v, anim, bestCards) : ''}
    </div>
    <nav class="bar"><div class="inner">${barHTML(v, me, host)}</div></nav>`;
  }

  function statusBanner() {
    if (S.role !== 'guest' || S.status === 'ok') return '';
    if (S.status === 'reconnecting') return '<div class="banner" role="alert"><span class="grow"><span class="spin"></span>Connessione persa, mi ricollego…</span></div>';
    return `<div class="banner" role="alert"><span class="grow">Il tavolo non risponde. Il banco potrebbe aver chiuso l'app.</span><button data-act="retry">Riprova</button></div>`;
  }

  function seatHTML(p, i, v, winners) {
    const turn = v.toAct === i && v.phase === 'playing';
    const cls = ['seat'];
    if (turn) cls.push('turn');
    if (p.inHand && p.folded) cls.push('folded');
    if (!p.inHand && v.phase === 'playing') cls.push('out');
    if (!p.connected) cls.push('offline');
    if (winners.has(p.id)) cls.push('winner');
    let st = '';
    if (!p.connected) st = 'Non collegato';
    else if (winners.has(p.id)) st = '+' + fmt(p.won) + (p.hand ? ', ' + lcFirst(p.hand) : '');
    else if (p.hand) st = p.hand;
    else if (turn) st = 'Sta pensando…';
    else if (p.lastAction) st = p.lastAction;
    else if (!p.inHand && v.phase === 'playing') st = p.chips > 0 ? 'Prossima mano' : 'Senza fiches';
    let minis = '';
    if (p.cards) minis = p.cards.map((c) => cardHTML(c, 'sm')).join('');
    else if (p.hasCards) minis = backHTML('sm') + backHTML('sm');
    return `<div class="${cls.join(' ')}">
      <div class="r1"><span class="nm">${p.dealer ? '<span class="dealer" title="Mazziere">D</span>' : ''}${esc(p.name)}</span><span class="minis">${minis}</span></div>
      <div class="r2"><span class="chips">${fmt(p.chips)}</span>${p.bet ? `<span class="bet">${fmt(p.bet)}</span>` : ''}${S.role === 'host' && !p.connected && !(v.phase === 'playing' && p.inHand) ? `<button class="kick" data-act="kick" data-id="${esc(p.id)}">Togli</button>` : ''}</div>
      <div class="st">${esc(st)}</div>
    </div>`;
  }

  function meHTML(me, v, anim, bestCards) {
    const turn = !!v.actions;
    let hole = '';
    let hs = '';
    if (me.cards && me.inHand) {
      const dim = me.folded ? 'dim' : '';
      hole = me.cards.map((c, i) => cardHTML(c, [anim.hole ? 'deal' : '', dim, !me.folded && bestCards.has(c) ? 'hl' : ''].filter(Boolean).join(' '), anim.hole ? i : null)).join('');
      if (me.folded) hs = 'Hai passato';
      else if (me.hand) hs = me.hand;
      else if (v.board.length >= 3) hs = Engine.best(me.cards.concat(v.board)).label;
      else if (me.cards[0][0] === me.cards[1][0]) hs = Engine.label([1, Engine.RANKS.indexOf(me.cards[0][0]) + 2]);
    } else {
      hole = `<div class="empty">${me.chips > 0 ? (v.phase === 'playing' ? 'Entri dalla prossima mano.' : '') : 'Hai finito le fiches.'}</div>`;
    }
    if (winners(v).has(me.id)) hs = 'Vinci ' + fmt(me.won) + (me.hand ? ', ' + lcFirst(me.hand) : '');
    return `<section class="me${turn ? ' turn' : ''}" aria-label="Le tue carte">
      <div class="hole">${hole}</div>
      <div class="info">
        <div class="nm">${me.dealer ? '<span class="dealer" title="Mazziere">D</span>' : ''}${esc(me.name)} <small>(tu)</small></div>
        <div class="chips">${fmt(me.chips)}<small>fiches</small></div>
        <div class="hs">${esc(hs)}</div>
      </div>
      ${me.bet ? `<span class="bet">${fmt(me.bet)}</span>` : ''}
    </section>`;
  }

  function winners(v) {
    return new Set(v.phase === 'handover' && v.results ? v.results.lines.map((l) => l.id) : []);
  }

  function barHTML(v, me, host) {
    const a = v.actions;
    if (a && S.raiseOpen) {
      return `<div class="raise" role="group" aria-label="Scegli quanto puntare">
        <div class="rv"><span>${a.isBet ? 'Punta' : 'Rilancia a'}</span><b id="raiseVal">${fmt(S.raiseTo)}</b></div>
        <input type="range" id="raiseRange" min="${a.minTo}" max="${a.maxTo}" step="${v.sb}" value="${S.raiseTo}" aria-label="Importo">
        <div class="quick">
          <button data-act="raise-q" data-v="min">Minimo</button>
          <button data-act="raise-q" data-v="half">Metà</button>
          <button data-act="raise-q" data-v="pot">Piatto</button>
          <button data-act="raise-q" data-v="max">All-in</button>
        </div>
        <div class="acts"><button class="btn ghost" data-act="raise-cancel">Annulla</button><button class="btn primary" id="raiseGo" data-act="raise-go">${raiseLabel()}</button></div>
      </div>`;
    }
    if (a) {
      const btns = [];
      if (a.toCall > 0) btns.push('<button class="btn ghost" data-act="fold">Passa</button>');
      if (a.toCall === 0) btns.push('<button class="btn light" data-act="check">Check</button>');
      else if (a.callAmount >= me.chips) btns.push(`<button class="btn light" data-act="call">All-in<small>${fmt(a.callAmount)}</small></button>`);
      else btns.push(`<button class="btn light" data-act="call">Chiama<small>${fmt(a.callAmount)}</small></button>`);
      if (a.canRaise) {
        if (a.minTo >= a.maxTo) btns.push(`<button class="btn primary" data-act="allin">All-in<small>${fmt(a.maxTo)}</small></button>`);
        else btns.push(`<button class="btn primary" data-act="raise-open">${a.isBet ? 'Punta' : 'Rilancia'}</button>`);
      }
      return `<div class="acts">${btns.join('')}</div>`;
    }

    const parts = [];
    const turnP = v.toAct >= 0 ? v.players[v.toAct] : null;
    if (v.phase === 'playing') {
      if (v.runout) parts.push('<p class="msg">Si scoprono le carte…</p>');
      else if (turnP) {
        parts.push(`<p class="msg">Tocca a <strong>${esc(turnP.name)}</strong></p>`);
        if (host && turnP.id !== S.myId) parts.push(`<button class="textlink" data-act="force">${esc(turnP.name)} non risponde? Fallo passare</button>`);
      }
    } else if (v.phase === 'handover') {
      parts.push(`<p class="msg">${v.champion ? 'Partita finita.' : 'Prossima mano tra pochi secondi…'}</p>`);
    } else if (v.phase === 'paused') {
      if (v.champion) parts.push(`<p class="msg">${host ? 'Puoi iniziare una nuova partita.' : 'Aspetta che il banco inizi una nuova partita.'}</p>`);
      else parts.push('<p class="msg">In attesa di giocatori…</p>');
    }
    if (me && me.chips === 0 && !(v.phase === 'playing' && me.inHand)) {
      parts.push(`<button class="btn light" data-act="rebuy">Rientra con ${fmt(v.startChips)} fiches</button>`);
    }
    if (host && (v.phase === 'paused' || (v.phase === 'handover' && v.champion))) {
      parts.push('<button class="btn primary" data-act="newgame">Nuova partita</button>');
    }
    return parts.join('');
  }

  /* ---------- Eventi ---------- */
  const actions = {
    'go-create'() {
      if (!validName()) return;
      S.error = '';
      S.screen = 'create';
      render();
    },
    join() {
      if (!validName()) return;
      if (S.joinCode.length !== 5) { S.error = 'Il codice del tavolo ha 5 caratteri.'; render(); $('#code') && $('#code').focus(); return; }
      clientJoin();
    },
    back() { S.screen = 'home'; S.error = ''; render(); },
    set(b) {
      S.settings[b.dataset.k] = Number(b.dataset.v);
      store.set('settings', S.settings);
      render();
    },
    'open-table'() { hostCreate(); },
    share() { share(); },
    start() { if (H.table) { clearHostTimers(); H.table.newGame(); hostTick(); } },
    newgame() {
      if (!H.table) return;
      if (!confirm('Si riparte con le fiches iniziali per tutti. Vuoi continuare?')) return;
      clearHostTimers();
      H.table.newGame();
      hostTick();
    },
    leave() { leave(); },
    fold() { sendAction('fold'); },
    check() { sendAction('check'); },
    call() { sendAction('call'); },
    allin() { sendAction('allin'); },
    'raise-open'() {
      const a = S.view && S.view.actions;
      if (!a) return;
      S.raiseTo = a.minTo;
      S.raiseOpen = true;
      render();
    },
    'raise-cancel'() { S.raiseOpen = false; render(); },
    'raise-q'(b) { quickRaise(b.dataset.v); },
    'raise-go'() {
      const a = S.view && S.view.actions;
      if (!a) return;
      if (S.raiseTo >= a.maxTo) sendAction('allin');
      else sendAction('raise', S.raiseTo);
    },
    rebuy() {
      if (S.role === 'host') {
        const err = H.table.rebuy(S.myId);
        if (err) toast(err);
        hostTick();
      } else {
        send(C.conn, { t: 'rebuy' });
      }
    },
    force() {
      const t = H.table;
      if (!t || t.toAct < 0) return;
      const p = t.players[t.toAct];
      if (!confirm('Far passare ' + p.name + ' in questa mano?')) return;
      hostAutoAct(true);
    },
    retry() { clientRetry(); },
    'cancel-join'() { log('Ingresso annullato'); joinFailed(''); },
    kick(b) {
      const p = H.table && H.table.players.find((x) => x.id === b.dataset.id);
      if (!p) return;
      if (!confirm('Togliere ' + p.name + ' dal tavolo? Se rientra, riparte con le fiches iniziali.')) return;
      hostRemove(p.id);
    },
  };

  function validName() {
    S.name = cleanName($('#name') ? $('#name').value : S.name);
    if (!$('#name') || $('#name').value.trim()) {
      store.set('name', S.name);
      return true;
    }
    S.error = 'Scrivi il nome con cui vuoi comparire al tavolo.';
    render();
    $('#name') && $('#name').focus();
    return false;
  }

  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.act];
    if (fn) fn(b, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'name') {
      S.name = el.value;
    } else if (el.id === 'code') {
      const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (v !== el.value) el.value = v;
      S.joinCode = v;
    } else if (el.id === 'raiseRange') {
      const a = S.view && S.view.actions;
      if (!a) return;
      let x = Number(el.value);
      if (x + S.view.sb > a.maxTo) x = a.maxTo;
      S.raiseTo = Math.max(a.minTo, Math.min(a.maxTo, x));
      const val = $('#raiseVal');
      if (val) val.textContent = fmt(S.raiseTo);
      const go = $('#raiseGo');
      if (go) go.textContent = raiseLabel();
    }
  });

  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'name') { e.preventDefault(); const c = $('#code'); if (c) c.focus(); }
    else if (e.target.id === 'code') { e.preventDefault(); actions.join(); }
  });

  window.addEventListener('popstate', () => {
    if (S.joined) {
      history.pushState({ table: 1 }, '');
      leave();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (S.role === 'host' && H.table && H.table.phase !== 'lobby') { e.preventDefault(); e.returnValue = ''; }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.joined) acquireWake();
    if (S.role === 'host') log('App del banco di nuovo in primo piano');
    if (S.role === 'host' && H.peer && H.peer.disconnected && !H.peer.destroyed) { try { H.peer.reconnect(); } catch (e) { /* ignora */ } }
    if (S.role === 'guest' && S.joined && S.status === 'ok' && C.conn && !C.conn.open) onClientLost();
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* l'app funziona anche senza */ });
  }

  render();
  if (S.joinCode && S.name) { const b = $('[data-act="join"]'); if (b) b.focus(); }
  else if (S.joinCode) { const n = $('#name'); if (n) n.focus(); }
})();
