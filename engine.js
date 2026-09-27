/* Motore Texas Hold'em No-Limit.
   Gira solo sul telefono di chi ospita: gli altri ricevono una vista
   in cui compaiono soltanto le proprie carte. */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc'; // picche, cuori, quadri, fiori

  const rv = (c) => RANKS.indexOf(c[0]) + 2;

  function randInt(n) {
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (!c) return Math.floor(Math.random() * n);
    const lim = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do { c.getRandomValues(buf); x = buf[0]; } while (x >= lim);
    return x % n;
  }

  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    for (let i = d.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  }

  /* ---------- Valutazione delle mani ---------- */

  function eval5(cs) {
    const vals = cs.map(rv).sort((a, b) => b - a);
    const flush = cs.every((c) => c[1] === cs[0][1]);
    const counts = {};
    vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const groups = Object.keys(counts)
      .map((v) => [Number(v), counts[v]])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const uniq = [...new Set(vals)];
    let high = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) high = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) high = 5;
    }
    const rest = groups.slice(1).map((g) => g[0]);
    if (high && flush) return [high === 14 ? 9 : 8, high];
    if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
    if (flush) return [5, ...vals];
    if (high) return [4, high];
    if (groups[0][1] === 3) return [3, groups[0][0], ...rest];
    if (groups[0][1] === 2 && groups[1][1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
    if (groups[0][1] === 2) return [1, groups[0][0], ...rest];
    return [0, ...vals];
  }

  function cmp(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  const ONE = { 14: 'Asso', 13: 'Re', 12: 'Donna', 11: 'Jack' };
  const MANY = { 14: 'Assi', 13: 'Re', 12: 'Donne', 11: 'Jack' };
  const AL = { 14: "all'Asso", 13: 'al Re', 12: 'alla Donna', 11: 'al Jack', 8: "all'8" };
  const one = (v) => ONE[v] || String(v);
  const many = (v) => MANY[v] || String(v);
  const al = (v) => AL[v] || 'al ' + v;

  function label(s) {
    switch (s[0]) {
      case 9: return 'Scala reale';
      case 8: return 'Scala colore ' + al(s[1]);
      case 7: return 'Poker di ' + many(s[1]);
      case 6: return 'Full di ' + many(s[1]) + ' e ' + many(s[2]);
      case 5: return 'Colore ' + al(s[1]);
      case 4: return 'Scala ' + al(s[1]);
      case 3: return 'Tris di ' + many(s[1]);
      case 2: return 'Doppia coppia, ' + many(s[1]) + ' e ' + many(s[2]);
      case 1: return 'Coppia di ' + many(s[1]);
      default: return 'Carta alta, ' + one(s[1]);
    }
  }

  function best(cards) {
    const n = cards.length;
    if (n < 5) return null;
    let bs = null, bset = null;
    for (let a = 0; a < n - 4; a++)
      for (let b = a + 1; b < n - 3; b++)
        for (let c = b + 1; c < n - 2; c++)
          for (let d = c + 1; d < n - 1; d++)
            for (let e = d + 1; e < n; e++) {
              const set = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              const s = eval5(set);
              if (!bs || cmp(s, bs) > 0) { bs = s; bset = set; }
            }
    return { score: bs, cards: bset, label: label(bs) };
  }

  /* ---------- Tavolo ---------- */

  class Table {
    constructor(opts) {
      opts = opts || {};
      this.startChips = opts.startChips || 1000;
      this.sb0 = opts.sb || 10;
      this.bb0 = opts.bb || this.sb0 * 2;
      this.sb = this.sb0;
      this.bb = this.bb0;
      this.blindEvery = opts.blindEvery || 0;
      this.autoRunout = !!opts.autoRunout;
      this.maxPlayers = opts.maxPlayers || 8;
      this.players = [];
      this.phase = 'lobby'; // lobby | playing | handover | paused
      this.handNo = 0;
      this.dealer = -1;
      this.toAct = -1;
      this.board = [];
      this.deck = [];
      this.street = null;
      this.currentBet = 0;
      this.minRaise = this.bb;
      this.results = null;
      this.runout = false;
      this.notice = null;
      this.champion = null;
      this.seq = 0;
    }

    get pot() { return this.players.reduce((s, p) => s + p.total, 0); }

    canAct(p) { return p.inHand && !p.folded && !p.allIn; }

    dealable() { return this.players.filter((p) => p.connected && p.chips > 0); }

    nextIdx(from, pred) {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (((from + k) % n) + n) % n;
        if (pred(this.players[i], i)) return i;
      }
      return -1;
    }

    addPlayer(id, name) {
      const p = {
        id, name, chips: this.startChips, connected: true, rebuys: 0,
        inHand: false, folded: true, allIn: false, acted: false,
        bet: 0, total: 0, cards: [], lastAction: null, revealed: false, hand: null, won: 0,
      };
      this.players.push(p);
      this.seq++;
      return p;
    }

    removePlayer(id) {
      const i = this.players.findIndex((p) => p.id === id);
      if (i < 0) return;
      if (this.phase === 'playing' && this.players[i].inHand) return;
      this.players.splice(i, 1);
      if (this.dealer >= i) this.dealer--;
      this.seq++;
    }

    newGame() {
      this.sb = this.sb0;
      this.bb = this.bb0;
      this.handNo = 0;
      this.dealer = -1;
      this.champion = null;
      for (const p of this.players) { p.chips = this.startChips; p.rebuys = 0; }
      return this.startHand();
    }

    rebuy(id) {
      const p = this.players.find((q) => q.id === id);
      if (!p) return 'Giocatore non trovato';
      if (p.chips > 0) return 'Hai ancora fiches';
      if (this.phase === 'playing' && p.inHand) return 'Aspetta la fine della mano';
      p.chips = this.startChips;
      p.rebuys++;
      this.champion = null;
      this.seq++;
      return null;
    }

    put(p, amt) {
      amt = Math.max(0, Math.min(amt, p.chips));
      p.chips -= amt;
      p.bet += amt;
      p.total += amt;
      if (p.chips === 0) p.allIn = true;
    }

    startHand() {
      this.results = null;
      this.runout = false;
      this.board = [];
      this.street = null;
      this.toAct = -1;
      this.notice = null;
      for (const p of this.players) {
        Object.assign(p, {
          inHand: false, folded: true, allIn: false, acted: false,
          bet: 0, total: 0, cards: [], lastAction: null, revealed: false, hand: null, won: 0,
        });
      }
      const dealt = this.dealable();
      if (dealt.length < 2) {
        this.phase = 'paused';
        const withChips = this.players.filter((p) => p.chips > 0);
        this.champion = withChips.length === 1 ? withChips[0].id : null;
        this.seq++;
        return false;
      }
      this.champion = null;
      this.handNo++;
      if (this.blindEvery && this.handNo > 1 && (this.handNo - 1) % this.blindEvery === 0) {
        this.sb *= 2;
        this.bb *= 2;
        this.notice = 'I bui salgono a ' + this.sb + '/' + this.bb;
      }
      dealt.forEach((p) => { p.inHand = true; p.folded = false; });

      if (this.dealer < 0 || this.dealer >= this.players.length) {
        this.dealer = this.players.indexOf(dealt[randInt(dealt.length)]);
      } else {
        this.dealer = this.nextIdx(this.dealer, (p) => p.inHand);
      }
      const heads = dealt.length === 2;
      const sbI = heads ? this.dealer : this.nextIdx(this.dealer, (p) => p.inHand);
      const bbI = this.nextIdx(sbI, (p) => p.inHand);

      this.deck = newDeck();
      this.phase = 'playing';
      this.street = 'preflop';
      this.post(sbI, this.sb, 'Piccolo buio');
      this.post(bbI, this.bb, 'Grande buio');
      this.currentBet = this.bb;
      this.minRaise = this.bb;

      for (let r = 0; r < 2; r++) {
        let i = this.dealer;
        for (let k = 0; k < dealt.length; k++) {
          i = this.nextIdx(i, (p) => p.inHand);
          this.players[i].cards.push(this.deck.pop());
        }
      }
      this.seq++;
      this.progress(bbI);
      return true;
    }

    post(i, amt, tag) {
      const p = this.players[i];
      this.put(p, amt);
      p.lastAction = tag;
    }

    act(id, a, amount) {
      if (this.phase !== 'playing' || this.runout) return 'La mano non è in corso';
      const i = this.players.findIndex((p) => p.id === id);
      if (i < 0 || i !== this.toAct) return 'Non è il tuo turno';
      const p = this.players[i];
      const toCall = Math.max(0, this.currentBet - p.bet);

      if (a === 'allin') {
        if (p.bet + p.chips > this.currentBet) { a = 'raise'; amount = p.bet + p.chips; } else a = 'call';
      }
      if (a === 'call' && toCall === 0) a = 'check';

      if (a === 'fold') {
        p.folded = true;
        p.lastAction = 'Passa';
      } else if (a === 'check') {
        if (toCall > 0) return 'Devi chiamare o passare';
        p.acted = true;
        p.lastAction = 'Check';
      } else if (a === 'call') {
        const amt = Math.min(toCall, p.chips);
        this.put(p, amt);
        p.acted = true;
        p.lastAction = p.allIn ? 'All-in' : 'Chiama';
      } else if (a === 'raise') {
        const maxTo = p.bet + p.chips;
        if (maxTo <= this.currentBet) return 'Fiches insufficienti per rilanciare';
        let to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) return 'Importo non valido';
        const minTo = this.currentBet + this.minRaise;
        if (to > maxTo) to = maxTo;
        if (to < minTo && to < maxTo) return 'Il minimo è ' + minTo;
        const wasBet = this.currentBet === 0;
        const by = to - this.currentBet;
        this.put(p, to - p.bet);
        if (by >= this.minRaise) this.minRaise = by;
        this.currentBet = to;
        for (const q of this.players) if (q !== p && this.canAct(q)) q.acted = false;
        p.acted = true;
        p.lastAction = p.allIn ? 'All-in' : (wasBet ? 'Punta' : 'Rilancia');
      } else {
        return 'Azione non valida';
      }
      this.seq++;
      this.progress(i);
      return null;
    }

    progress(lastIdx) {
      const live = this.players.filter((p) => p.inHand && !p.folded);
      if (live.length === 1) return this.winUncontested(live[0]);
      const actors = this.players.filter((p) => this.canAct(p));
      const pending = actors.filter((p) => !p.acted || p.bet < this.currentBet);
      let done = pending.length === 0;
      if (!done && actors.length === 1 && actors[0].bet >= this.currentBet) done = true;
      if (done) return this.endStreet();
      this.toAct = this.nextIdx(lastIdx, (p) => pending.includes(p));
      this.seq++;
    }

    endStreet() {
      for (const p of this.players) {
        p.bet = 0;
        p.acted = false;
        if (p.inHand && !p.folded && !p.allIn) p.lastAction = null;
      }
      this.currentBet = 0;
      this.minRaise = this.bb;
      this.toAct = -1;
      if (this.street === 'river') return this.showdown();
      const actors = this.players.filter((p) => this.canAct(p));
      if (actors.length <= 1) {
        // Nessuno può più puntare: si scoprono le carte e si gira il resto del tavolo.
        this.runout = true;
        this.players.forEach((p) => { if (p.inHand && !p.folded) p.revealed = true; });
        this.seq++;
        if (this.autoRunout) while (this.runout) this.runoutStep();
        return;
      }
      this.dealStreet();
      this.toAct = this.nextIdx(this.dealer, (p) => this.canAct(p));
      this.seq++;
    }

    dealStreet() {
      this.deck.pop(); // carta bruciata
      if (this.street === 'preflop') {
        this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
        this.street = 'flop';
      } else if (this.street === 'flop') {
        this.board.push(this.deck.pop());
        this.street = 'turn';
      } else if (this.street === 'turn') {
        this.board.push(this.deck.pop());
        this.street = 'river';
      }
    }

    runoutStep() {
      if (!this.runout) return;
      if (this.street === 'river') {
        this.runout = false;
        this.showdown();
      } else {
        this.dealStreet();
      }
      this.seq++;
    }

    winUncontested(p) {
      const pot = this.pot;
      p.chips += pot;
      p.won = pot;
      this.results = { showdown: false, lines: [{ id: p.id, name: p.name, amount: pot, hand: null, best: [] }] };
      this.endHand();
    }

    showdown() {
      this.street = 'showdown';
      this.toAct = -1;
      const live = this.players.filter((p) => p.inHand && !p.folded);
      for (const p of live) { p.hand = best(p.cards.concat(this.board)); p.revealed = true; }

      const levels = [...new Set(live.map((p) => p.total))].sort((a, b) => a - b);
      const pots = [];
      let prev = 0;
      for (const L of levels) {
        let amt = 0;
        for (const p of this.players) amt += Math.max(0, Math.min(p.total, L) - Math.min(p.total, prev));
        if (amt > 0) pots.push({ amount: amt, elig: live.filter((p) => p.total >= L) });
        prev = L;
      }
      const leftover = this.pot - pots.reduce((s, x) => s + x.amount, 0);
      if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;

      const n = this.players.length;
      const order = (p) => (this.players.indexOf(p) - this.dealer - 1 + 2 * n) % n;

      for (const pot of pots) {
        if (pot.elig.length === 1) { pot.elig[0].chips += pot.amount; continue; } // puntata non chiamata: torna indietro
        let bs = null;
        let winners = [];
        for (const p of pot.elig) {
          const c = bs ? cmp(p.hand.score, bs) : 1;
          if (c > 0) { bs = p.hand.score; winners = [p]; } else if (c === 0) winners.push(p);
        }
        winners.sort((a, b) => order(a) - order(b));
        const share = Math.floor(pot.amount / winners.length);
        let rem = pot.amount - share * winners.length;
        for (const w of winners) {
          const got = share + (rem > 0 ? 1 : 0);
          if (rem > 0) rem--;
          w.chips += got;
          w.won += got;
        }
      }
      const lines = live
        .filter((p) => p.won > 0)
        .sort((a, b) => b.won - a.won)
        .map((p) => ({ id: p.id, name: p.name, amount: p.won, hand: p.hand.label, best: p.hand.cards }));
      this.results = { showdown: true, lines };
      this.endHand();
    }

    endHand() {
      this.phase = 'handover';
      this.toAct = -1;
      this.runout = false;
      const withChips = this.players.filter((p) => p.chips > 0);
      this.champion = withChips.length === 1 ? withChips[0].id : null;
      this.seq++;
    }

    viewFor(pid) {
      const meIdx = this.players.findIndex((p) => p.id === pid);
      const reveal = this.street === 'showdown' || this.runout;
      const v = {
        phase: this.phase,
        handNo: this.handNo,
        street: this.street,
        board: this.board.slice(),
        pot: this.phase === 'playing' ? this.pot : 0,
        sb: this.sb,
        bb: this.bb,
        startChips: this.startChips,
        blindEvery: this.blindEvery,
        currentBet: this.currentBet,
        runout: this.runout,
        results: this.results,
        notice: this.notice,
        champion: this.champion,
        me: meIdx,
        toAct: this.toAct,
        maxPlayers: this.maxPlayers,
        players: this.players.map((p, i) => {
          const showCards = p.inHand && !p.folded && (i === meIdx || (p.revealed && reveal));
          return {
            id: p.id,
            name: p.name,
            chips: p.chips,
            bet: p.bet,
            folded: p.folded,
            allIn: p.allIn,
            inHand: p.inHand,
            connected: p.connected,
            rebuys: p.rebuys,
            lastAction: p.lastAction,
            won: p.won,
            dealer: i === this.dealer && this.phase !== 'lobby',
            cards: showCards ? p.cards.slice() : (i === meIdx && p.inHand ? p.cards.slice() : null),
            hasCards: p.inHand && !p.folded,
            hand: p.revealed && p.hand && this.street === 'showdown' ? p.hand.label : null,
          };
        }),
        actions: null,
      };
      if (meIdx >= 0 && meIdx === this.toAct && this.phase === 'playing' && !this.runout) {
        const p = this.players[meIdx];
        const toCall = Math.max(0, this.currentBet - p.bet);
        const maxTo = p.bet + p.chips;
        v.actions = {
          toCall,
          callAmount: Math.min(toCall, p.chips),
          canRaise: maxTo > this.currentBet,
          minTo: Math.min(this.currentBet + this.minRaise, maxTo),
          maxTo,
          isBet: this.currentBet === 0,
        };
      }
      return v;
    }
  }

  const api = { Table, best, eval5, cmp, label, newDeck, RANKS, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);
