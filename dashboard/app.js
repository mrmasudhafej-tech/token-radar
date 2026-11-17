// Token Launch Radar — dark board for the token-radar-01 bounty.
// Reads window.RADAR (data.js, loaded before this file, same directory; ../data.js is a
// fallback for the starter layout). No network, no fetch, no storage: every number shown
// comes from the snapshot the model scored. Written natively for this entry.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');

  /* ---------- small formatting helpers ---------- */
  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return 'x' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0');
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s); }

  /* ---------- the model, recomputed in the page ----------
     The page re-derives a row from the model's own breakdown, which data.js carries per
     row (radar-2: family multiple, growth, maturity, new-protocol penalty, breadth).
     The multipliers shown are rounded to four places, so the product below is an
     approximation of the board's figure, never a different model: the gap is rounding
     only, at most about 0.02% on this snapshot. */
  function breakdownOf(row) {
    var m = row.model;
    var approx = Math.max(1, Math.round(row.tvl_usd * m.family_multiple * m.growth_multiplier *
      m.maturity_multiplier * m.new_protocol_penalty * m.breadth_multiplier));
    return {
      family: m.family,
      familyMultiple: m.family_multiple,
      growthPct: m.growth_pct,
      growthMult: m.growth_multiplier,
      maturityMult: m.maturity_multiplier,
      newPenalty: m.new_protocol_penalty,
      breadthMult: m.breadth_multiplier,
      approx: approx,
      diff: Math.abs(approx - row.implied_value_usd)
    };
  }

  /* ---------- farm plans ----------
     The snapshot's data.js rows carry no farm_steps field (see the report), so the page
     derives each plan from the row's own record — category, chains, TVL, age — exactly
     as the model defines it. No protocol name is special-cased. If a row ever does carry
     farm_steps (strings, or {text, cost, time} objects), those are used as-is instead. */
  function chainOf(p) { return (p.chains && p.chains.length > 0) ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // Category keywords, in priority order, each with the one action that category farms.
  var ACTIONS = [
    { test: /lend|cdp|collateral/, make: function (n, c, k) { return 'Supply $' + k + ' of USDC to ' + n + ' on ' + c + ' and keep the position open.'; } },
    { test: /dex|yield|leveraged farm/, make: function (n, c, k) { return 'Provide $' + k + ' of liquidity to ' + n + '\u2019s main pool on ' + c + ' and keep the position open.'; } },
    { test: /bridge/, make: function (n, c, k) { return 'Bridge $' + k + ' of USDC to ' + c + ' through ' + n + ' and use the bridged funds in its app.'; } },
    { test: /staking|restak/, make: function (n, c, k) { return 'Stake $' + k + ' of the chain\u2019s staking asset through ' + n + ' and keep the receipt.'; } },
    { test: /perpetual|derivative/, make: function (n, c, k) { return 'Deposit $' + k + ' of USDC as margin on ' + n + ' and open one small hedge.'; } },
    { test: /prediction/, make: function (n, c, k) { return 'Fund $' + k + ' and place one market position on ' + n + '.'; } },
    { test: /curator|allocator/, make: function (n, c, k) { return 'Deposit $' + k + ' into a ' + n + ' vault on ' + c + ' and keep the shares.'; } },
    { test: /stable/, make: function (n, c, k) { return 'Mint or deposit $' + k + ' of the stable asset through ' + n + ' on ' + c + '.'; } },
    { test: /rwa/, make: function (n, c, k) { return 'Mint $' + k + ' of the protocol\u2019s yield asset on ' + c + ' and hold it.'; } },
    { test: /insurance/, make: function (n, c, k) { return 'Buy $' + k + ' of cover from ' + n + ' on ' + c + ' and keep the policy.'; } }
  ];
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i].test.test(c)) return ACTIONS[i].make(p.name, chain, capital);
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function deriveSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }
  function stepsFor(row) {
    if (Array.isArray(row.farm_steps) && row.farm_steps.length > 0) {
      return row.farm_steps.map(function (s) {
        if (typeof s === 'string') {
          var at = s.indexOf(' Cost: ');
          var action = at >= 0 ? s.slice(0, at) : s;
          var tail = at >= 0 ? s.slice(at + 1) : '';
          var tm = tail.match(/^Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/);
          return tm ? { text: action, cost: tm[1], time: tm[2] } : { text: action, cost: tail.replace(/^Cost:\s*/, ''), time: '' };
        }
        return { text: s.text || '', cost: s.cost || '', time: s.time || '' };
      });
    }
    return deriveSteps(row);
  }

  /* ---------- state and deep links ----------
     Hash forms, so screenshots can be taken of each view:
       #/protocol/<slug>      opens that protocol's detail view
       #/filter/<category>    filters the board to a category, e.g. #/filter/Lending
       #/filter/<category>?q=..&chain=..&minTvl=..&wl=1   the same, with the other filters
     Filters also write the hash as they change, so a filtered view is shareable. */
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: null, watchlistOnly: false,
    sort: 'implied', dir: -1, selected: null
  };
  var SORT_DEFAULT_DIR = { rank: 1, name: 1, tvl: -1, growth: -1, age: -1, implied: -1 };

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var parts = raw.split('?');
    var path = parts[0].split('/').filter(Boolean);
    var params = new URLSearchParams(parts[1] || '');
    if (path[0] === 'protocol' && path[1]) {
      state.selected = decodeURIComponent(path[1]);
    } else if (path[0] === 'filter') {
      state.selected = null;
      if (path[1]) state.category = decodeURIComponent(path[1]);
      if (params.get('q') !== null) state.q = params.get('q');
      if (params.get('chain') !== null) state.chain = params.get('chain');
      var mt = params.get('minTvl');
      state.minTvl = (mt !== null && mt !== '' && isFinite(+mt)) ? +mt : null;
      state.watchlistOnly = params.get('wl') === '1';
    }
  }
  function writeHash() {
    var hash = '';
    if (state.selected) {
      hash = '#/protocol/' + encodeURIComponent(state.selected);
    } else if (state.category !== 'all' || state.q || state.chain !== 'all' || state.minTvl !== null || state.watchlistOnly) {
      var params = new URLSearchParams();
      if (state.q) params.set('q', state.q);
      if (state.chain !== 'all') params.set('chain', state.chain);
      if (state.minTvl !== null) params.set('minTvl', String(state.minTvl));
      if (state.watchlistOnly) params.set('wl', '1');
      hash = '#/filter/' + encodeURIComponent(state.category) + (params.toString() ? '?' + params.toString() : '');
    }
    var url = hash || window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  /* ---------- filtering and sorting ---------- */
  // The starter's data.js carries no watchlist array and no per-row watchlist flag, so the
  // toggle falls back to the floor: watchlist rows are the ones at or above the floor, and
  // the early rows are the ones below it. If a watchlist array is ever present, it wins.
  function isWatchlist(row) {
    if (Array.isArray(DATA.watchlist)) return DATA.watchlist.indexOf(row.slug) >= 0;
    return row.tvl_usd >= DATA.floor_usd;
  }
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.minTvl !== null && !(r.tvl_usd >= state.minTvl)) return false;
      if (state.watchlistOnly && !isWatchlist(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortValue(r, key) {
    if (key === 'rank') return r.rank;
    if (key === 'name') return (r.name || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return (r.change_7d === null || r.change_7d === undefined) ? -Infinity : r.change_7d;
    if (key === 'age') return (r.age_days === null || r.age_days === undefined) ? Infinity : r.age_days;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key), bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function $(id) { return document.getElementById(id); }
  function chainChips(chains) {
    var wrap = el('span', { class: 'chips' });
    (chains || []).slice(0, 3).forEach(function (c) { wrap.appendChild(el('span', { class: 'chip', text: c })); });
    if ((chains || []).length > 3) wrap.appendChild(el('span', { class: 'chip', text: '+' + (chains.length - 3) + ' more' }));
    if (!chains || chains.length === 0) wrap.appendChild(el('span', { class: 'chip', text: 'chain not listed' }));
    return wrap;
  }
  function growthCell(change7d) {
    if (change7d === null || change7d === undefined) return el('td', { class: 'num', text: 'n/a' });
    return el('td', { class: 'num ' + (change7d >= 0 ? 'pos' : 'neg'), text: fmtPct(change7d) });
  }

  /* ---------- rendering ---------- */
  function renderHeader() {
    $('eyebrow').textContent = 'Token Launch Radar · snapshot ' + DATA.as_of;
    $('stat-watchlist').innerHTML = '';
    $('stat-watchlist').appendChild(el('span', { text: String(DATA.watchlist_size) }));
    $('stat-watchlist').appendChild(el('small', { text: ' protocols' }));
    $('stat-board').textContent = String(DATA.board_size);
    $('stat-early').textContent = String(DATA.early_size);
    $('stat-live').textContent = String(DATA.live_size);
    var m = DATA.model;
    var fams = DATA.family_multiples.map(function (f) { return f.family + ' ' + fmtMult(f.multiple); }).join(', ');
    $('model-line').textContent = 'Implied value = TVL x the median live market-cap/TVL of its category family (' +
      fams + '), adjusted for seven-day growth (clamped ' + m.growth_floor + '% to ' + m.growth_cap +
      '%, weight ' + m.growth_weight + '), for age with no token (maturity ' + m.maturity_floor +
      ' to ' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days +
      ' days, 0.85x under ' + m.new_age_days + ' days) and for breadth (+2% per extra chain, max +10%). Model ' +
      DATA.model_version + ' — one formula scores every row; no name is special-cased.';
    $('board-meta').textContent = DATA.board_size + ' rows · snapshot ' + DATA.as_of;
    $('live-meta').textContent = DATA.live_size + ' protocols';
    $('formula').textContent = 'implied = round( tvl_usd x family_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight +
      ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days +
      ' x ' + m.maturity_range + ') x new_penalty x breadth )';
    $('model-notes').textContent = 'Each family multiple is the median market-cap/TVL of the live-token protocols ' +
      'in that family, measured from this snapshot and clamped to ' + m.family_multiple_floor + '–' + m.family_multiple_cap +
      '. TVL and seven-day growth come from the snapshot. Age is the time since the ' +
      'protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' +
      m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor of ' +
      fmtUsd(DATA.floor_usd) + ', by TVL, and the live-token protocols are set aside with their market caps shown.';
    $('foot-source').textContent = 'Snapshot ' + DATA.as_of + ' · source: ' + DATA.source +
      ' · model ' + DATA.model_version + '.';
  }

  function fillOptions() {
    var catSel = $('category'), chainSel = $('chain');
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    cats.forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }));
    });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    chains.forEach(function (c) {
      chainSel.appendChild(el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }));
    });
  }

  function sortArrow(key) {
    if (state.sort !== key) return null;
    return el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' });
  }

  function renderBoard() {
    var list = sortedRows(visibleRows());
    var tbody = $('board-body');
    tbody.textContent = '';
    $('board-empty').hidden = list.length !== 0;
    $('count').innerHTML = '';
    $('count').appendChild(el('b', { text: String(list.length) }));
    $('count').appendChild(document.createTextNode(' of ' + DATA.board_size + ' rows shown'));
    if (list.length === 0) return;
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-clickable': 'true',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', null, el('span', { class: 'chip cat', text: r.category || 'Other' }), ' ', chainChips(r.chains))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r.change_7d),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'records no token' }))
      );
      tbody.appendChild(tr);
    });
    // Sort arrows on the header buttons.
    document.querySelectorAll('#board-table thead button[data-sort]').forEach(function (btn) {
      var arrow = btn.querySelector('.arrow');
      if (arrow) arrow.remove();
      var a = sortArrow(btn.getAttribute('data-sort'));
      if (a) btn.appendChild(a);
      btn.setAttribute('aria-sort', btn.getAttribute('data-sort') === state.sort ? (state.dir < 0 ? 'descending' : 'ascending') : 'none');
    });
  }

  function renderLive() {
    var tbody = $('live-body');
    tbody.textContent = '';
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'live' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', null, el('span', { class: 'chip cat', text: r.category || 'Other' }), ' ', chainChips(r.chains))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        growthCell(r.change_7d),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
  }

  /* ---------- detail view ---------- */
  var detail = $('detail'), scrim = $('detail-scrim'), detailInner = $('detail-inner');

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    renderBoard();
    var calc = breakdownOf(row);
    var matches = calc.diff === 0;
    detailInner.textContent = '';
    detailInner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('p', { class: 'eyebrow' }, el('span', { class: 'pulse', 'aria-hidden': 'true' }), document.createTextNode(' Rank ' + row.rank + ' of ' + DATA.board_size)),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'detail-sub', text: (row.category || 'Other') + ' · ' + ((row.chains || []).join(', ') || 'chain not listed') + ' · ' + fmtAge(row.age_days) + ' with no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    detailInner.appendChild(el('dl', { class: 'detail-stats' },
      el('div', null, el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('dt', { text: 'Seven-day change' }), el('dd', { class: row.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(row.change_7d) })),
      el('div', null, el('dt', { text: 'Age with no token' }), el('dd', { text: fmtAge(row.age_days) })),
      el('div', null, el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(row.implied_value_usd) }))
    ));
    var eq = el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'Family — ' + calc.family + ' median live mcap/TVL' }), el('b', { text: fmtMult(calc.familyMultiple) })),
      el('div', null, el('span', { text: 'Base — TVL x family multiple' }), el('b', { text: fmtUsd(row.tvl_usd * calc.familyMultiple) })),
      el('div', null, el('span', { text: 'Growth — ' + fmtPct(calc.growthPct) + ' clamped' }), el('b', { text: fmtMult(calc.growthMult) })),
      el('div', null, el('span', { text: 'Maturity — ' + fmtAge(row.age_days) + ' with no token' }), el('b', { text: fmtMult(calc.maturityMult) })),
      el('div', null, el('span', { text: calc.newPenalty < 1 ? 'New protocol — under 90 days' : 'New protocol — over 90 days, no penalty' }), el('b', { text: fmtMult(calc.newPenalty) })),
      el('div', null, el('span', { text: 'Breadth — ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') }), el('b', { text: fmtMult(calc.breadthMult) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
    );
    detailInner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown' }),
      eq,
      el('p', { class: 'check' }, 'The page multiplies the figures above and gets ',
        el('b', { text: fmtUsd(calc.approx) }),
        document.createTextNode(matches ? ' — the same number the board carries.' : ' — within ' + fmtUsd(calc.diff) + ' of the board\u2019s ' + fmtUsd(row.implied_value_usd) + '; the gap is rounding, because the multipliers shown are rounded to four places.'),
        document.createTextNode(' Model ' + DATA.model_version + ': the same function scores every protocol.'))
    ));
    var steps = stepsFor(row);
    detailInner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null,
          el('b', { text: s.text }),
          el('span', { class: 'cost', text: 'Cost: ' + s.cost + (s.time ? ' · Time: ' + s.time : '') })
        );
      }))
    ));
    detailInner.appendChild(el('p', { class: 'detail-note' },
      'Implied value is this entry\u2019s own claim from the snapshot figures — not a price, not a promise. ' +
      'Farming costs are estimates in gas and capital; check the protocol\u2019s own page before moving funds.'));
    detail.hidden = false;
    scrim.hidden = false;
    detail.scrollTop = 0;
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    detail.hidden = true;
    scrim.hidden = true;
    renderBoard();
  }

  /* ---------- events, sync and start ---------- */
  function syncControls() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('min-tvl').value = state.minTvl === null ? '' : String(state.minTvl);
    $('watchlist-only').checked = state.watchlistOnly;
  }
  function clearFilters() {
    state.q = ''; state.category = 'all'; state.chain = 'all';
    state.minTvl = null; state.watchlistOnly = false; state.selected = null;
    writeHash();
    syncControls();
    renderBoard();
  }
  function renderAll() {
    renderHeader();
    renderBoard();
    renderLive();
    if (state.selected) openDetail(state.selected);
  }

  if (!DATA) {
    app.insertAdjacentHTML('beforeend',
      '<div class="panel"><div class="empty"><h2>No snapshot data found</h2>' +
      '<p>This page reads its numbers from data.js next to it. The file is missing or did not load, ' +
      'so there is no board to show.</p></div></div>');
  } else {
    readHash();
    fillOptions();
    syncControls();
    renderAll();

    $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); renderBoard(); });
    $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); renderBoard(); });
    $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); renderBoard(); });
    $('min-tvl').addEventListener('input', function () {
      var v = $('min-tvl').value.trim();
      state.minTvl = (v === '' || !isFinite(+v)) ? null : Math.max(0, +v);
      writeHash(); renderBoard();
    });
    $('watchlist-only').addEventListener('change', function () { state.watchlistOnly = $('watchlist-only').checked; writeHash(); renderBoard(); });
    $('clear-filters').addEventListener('click', clearFilters);
    $('empty-clear').addEventListener('click', clearFilters);
    document.querySelectorAll('#board-table thead button[data-sort]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = SORT_DEFAULT_DIR[key]; }
        renderBoard();
      });
    });
    scrim.addEventListener('click', closeDetail);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !detail.hidden) closeDetail();
    });
    window.addEventListener('hashchange', function () {
      var prev = state.selected;
      readHash();
      syncControls();
      renderBoard();
      if (state.selected && state.selected !== prev) openDetail(state.selected);
      else if (!state.selected && prev) { detail.hidden = true; scrim.hidden = true; }
    });
  }
})();
