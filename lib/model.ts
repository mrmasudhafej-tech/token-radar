// The token radar's value model for token-radar-01: one snapshot in, one ranked board out.
//
// The board ranks every protocol in the snapshot's watchlist plus the strongest pre-token protocols
// below the watchlist floor, by an implied value that follows only from the snapshot's own figures:
// TVL, 7-day TVL change, how long the protocol has run with no token recorded, its DefiLlama
// category and the chains it runs on. No protocol name is ever special-cased: the same function
// scores every row, and a protocol's name appears only in display text and farm steps.
//
// THE FORMULA (all constants live in MODEL below and are exposed to the dashboard):
//
//   familyMultiple = median live mcap/TVL in the protocol's category family,
//                    computed from THIS snapshot's own live-token protocols,
//                    clamped to [FAMILY_FLOOR, FAMILY_CAP]; families with fewer
//                    than FAMILY_MIN_OBS live protocols fall back to the global
//                    median across all live protocols in the snapshot.
//   growthPct      = clamp(change_7d ?? 0, GROWTH_FLOOR, GROWTH_CAP)   // % points
//   growthMult     = 1 + (growthPct / 100) * GROWTH_WEIGHT
//   maturityMult   = MATURITY_FLOOR + MATURITY_RANGE
//                      * min(age_days ?? UNKNOWN_AGE_DAYS, MATURITY_DAYS) / MATURITY_DAYS
//   newPenalty     = age_days !== null && age_days < NEW_AGE_DAYS ? NEW_PENALTY : 1
//   breadthMult    = 1 + BREADTH_PER_CHAIN * min(max(chains.length - 1, 0), BREADTH_MAX_CHAINS)
//   implied        = clamp(round(tvl_usd * familyMultiple * growthMult
//                      * maturityMult * newPenalty * breadthMult), 1, 1e14)
//
// WHY EACH TERM, and what the snapshot said on 2026-11-14 (758 protocols, 416 live, 342 pre-token):
// - Family multiple. A token's market cap relative to its protocol's TVL is the market's own
//   answer to "what is a protocol like this worth", so the base multiple is the median
//   mcap_usd/tvl_usd of the live-token protocols in the same family, measured on this snapshot:
//   trading 1.0568 (n=22), bridge 0.6776 (n=18), rwa 0.2398 (n=10), other 0.1751 (n=26),
//   lending 0.1687 (n=20), yield 0.1691 (n=17), staking 0.0324 (n=15); global median 0.2138.
//   One live record carries a nonsense market cap (autofinance, mcap_usd -1) and fifteen carry
//   mcap_usd 0; the model drops every mcap_usd <= 0 before measuring, so neither skews a median.
//   The clamp [0.05, 0.60] keeps the two extremes honest: trading venues and bridges trade
//   near or above 1x TVL, but a protocol with no token recorded has no liquid market yet, so
//   no family is credited above 0.60x; and staking TVL is mostly the staked asset itself, so
//   its raw 0.03x is floored at 0.05x rather than priced at nearly nothing. The medians are
//   computed at run time from the snapshot, never typed in per protocol.
// - Growth. A week's TVL change is the freshest signal in the file. It is clamped to [-50, +100]:
//   the snapshot's pre-token changes run from -72.7% to +4448.5% (one protocol, shift-defi, at
//   +4448%), so an uncapped term would let a single week's spike buy the top of the board. At
//   weight 0.6 a -50% week costs 30% of implied value and a +100% week adds 60%; negative
//   growth is penalised through this same term, never ignored.
// - Maturity. A protocol that has run for years with no token recorded has more pent-up value
//   than one listed last month: the term rises linearly from 0.70 at listing to 1.00 at 3 years
//   (1095 days), then stays flat. The snapshot's pre-token median age is 513 days.
// - New-protocol penalty. A protocol listed under 90 days ago has barely been observed, so it
//   is scored at 0.85x until it has a track record. Unknown age is read as 365 days.
// - Breadth. A protocol live on more chains reaches more users: +2% per extra chain, capped
//   at +10% (5 extra chains). The median pre-token protocol runs on 1 chain.
//
// The board keeps live-token protocols apart: they are listed separately by their market cap,
// never mixed into the ranked board, because the board's question is what a protocol with no
// token recorded would be worth. A protocol is pre-token when its record carries no market cap,
// no CoinGecko id and no symbol.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One of the seven category families the base multiple is measured for. */
export type CategoryFamily = 'trading' | 'lending' | 'yield' | 'staking' | 'bridge' | 'rwa' | 'other';

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  family_multiple_floor: number;
  family_multiple_cap: number;
  family_min_observations: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  new_age_days: number;
  new_penalty: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  family_multiple_floor: 0.05,
  family_multiple_cap: 0.6,
  family_min_observations: 3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  new_age_days: 90,
  new_penalty: 0.85,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 220;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The largest implied value the gate accepts, in whole dollars. */
export const IMPLIED_MAX = 100_000_000_000_000;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    family: CategoryFamily;
    family_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    new_protocol_penalty: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it from data.js: the rank, the figures, the model breakdown and the farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    family: CategoryFamily;
    family_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    new_protocol_penalty: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One family's measured multiple: the raw median, the clamped multiple the model used, and how many live protocols it came from. */
export interface FamilyMultiple {
  family: CategoryFamily;
  multiple: number;
  raw_median: number;
  observations: number;
  fallback: boolean;
}

/** Everything the dashboard needs: the board, the live set, the watchlist and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  family_multiples: FamilyMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category family a DefiLlama category belongs to. Substring rules only, applied in this
 * order, so a category lands in exactly one family: trading venues first (a "dex" prefix, so
 * Indexes is not mistaken for a DEX), then lending, yield, staking, bridges, real-world assets,
 * and everything else. No protocol name is read here.
 */
export function familyOf(category: string | null): CategoryFamily {
  const c = (category ?? '').toLowerCase();
  if (
    c.startsWith('dex') ||
    c.includes('derivative') ||
    c.includes('basis trad') ||
    c.includes('prediction') ||
    c.includes('option') ||
    c.includes('perpetual') ||
    c.includes('synthetic')
  ) {
    return 'trading';
  }
  if (
    c.includes('lend') ||
    c.includes('cdp') ||
    c.includes('collateral') ||
    c.includes('leveraged farm') ||
    c.includes('interest rate')
  ) {
    return 'lending';
  }
  if (
    c.includes('yield') ||
    c.includes('farm') ||
    c.includes('liquidity manager') ||
    c.includes('curator') ||
    c.includes('allocator') ||
    c.includes('vault')
  ) {
    return 'yield';
  }
  if (c.includes('stak') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) {
    return 'staking';
  }
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('rwa') || c.includes('stablecoin') || c.includes('algo-stable') || c.includes('reserve currency')) {
    return 'rwa';
  }
  return 'other';
}

/** The median of a list of numbers, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The base multiple per family, measured from this snapshot's own live-token protocols: the
 * median market-cap-to-TVL ratio in the family, clamped to the model's band, falling back to
 * the global median when a family has too few live protocols to measure. Deterministic: the
 * same snapshot bytes always give the same table.
 */
export function computeFamilyMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): FamilyMultiple[] {
  const byFamily = new Map<CategoryFamily, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio)) continue;
    all.push(ratio);
    const family = familyOf(p.category);
    const list = byFamily.get(family) ?? [];
    list.push(ratio);
    byFamily.set(family, list);
  }
  const globalMedian = median(all) ?? model.family_multiple_floor;
  const families: CategoryFamily[] = ['trading', 'lending', 'yield', 'staking', 'bridge', 'rwa', 'other'];
  return families.map((family) => {
    const ratios = byFamily.get(family) ?? [];
    const raw = median(ratios);
    const fallback = raw === null || ratios.length < model.family_min_observations;
    const base = fallback ? globalMedian : raw!;
    const multiple = Math.min(model.family_multiple_cap, Math.max(model.family_multiple_floor, base));
    return {
      family,
      multiple: round4(multiple),
      raw_median: round4(base),
      observations: ratios.length,
      fallback,
    };
  });
}

/** The family multiples as a lookup keyed by family. */
export function familyMultipleMap(table: FamilyMultiple[]): Map<CategoryFamily, number> {
  return new Map(table.map((row) => [row.family, row.multiple]));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: Map<CategoryFamily, number>,
): {
  implied: number;
  family: CategoryFamily;
  familyMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  newPenalty: number;
  breadthMult: number;
  age: number | null;
} {
  const family = familyOf(protocol.category);
  const familyMultiple = multiples.get(family) ?? model.family_multiple_floor;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const newPenalty = age !== null && age < model.new_age_days ? model.new_penalty : 1;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const raw = protocol.tvl_usd * familyMultiple * growthMult * maturityMult * newPenalty * breadthMult;
  const implied = Math.min(IMPLIED_MAX, Math.max(1, Math.round(raw)));
  return { implied, family, familyMultiple, growthPct, growthMult, maturityMult, newPenalty, breadthMult, age };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The family's core action: what a farmer actually does with the capital, in the words a
 * reader can follow. Chosen by the protocol's category family only, never by its name.
 */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { text: string; cost: string; time: string } {
  const name = p.name;
  switch (familyOf(p.category)) {
    case 'trading':
      return {
        text: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, paired half in USDC and half in the chain's native asset, and keep the position open so it earns trading fees.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '20 minutes to set up',
      };
    case 'lending':
      return {
        text: `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it earns the lending rate every block.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '15 minutes to set up',
      };
    case 'yield':
      return {
        text: `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the vault shares so the position compounds.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '15 minutes to set up',
      };
    case 'staking':
      return {
        text: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '15 minutes to set up',
      };
    case 'bridge':
      return {
        text: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in an app on the destination chain the same day.`,
        cost: `$${capital} of capital and about $2-5 of bridge and gas fees`,
        time: '10-30 minutes for the bridge to land',
      };
    case 'rwa':
      return {
        text: `Mint $${capital} of the yield-bearing asset through ${name} on ${chain} and hold it so the yield accrues to the wallet.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '15 minutes to set up',
      };
    default:
      return {
        text: `Deposit $${capital} of USDC into ${name}'s main product on ${chain} and keep the position open.`,
        cost: `$${capital} of capital and about $3-8 of gas`,
        time: '15 minutes to set up',
      };
  }
}

/** The family's repeat action: the weekly habit that keeps the wallet active. */
function repeatAction(p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (familyOf(p.category)) {
    case 'trading':
      return `Route one swap of $25-50 through ${name} on ${chain} each week so the wallet shows repeat trading volume.`;
    case 'lending':
      return `Borrow about a third of the supplied USDC against the position on ${name} once, then repay it within the week, so the wallet shows both sides of the market.`;
    case 'yield':
      return `Harvest or claim the vault's yield on ${name} once a week and re-deposit it so the position keeps compounding.`;
    case 'staking':
      return `Restake the staking rewards from ${name} once a month instead of selling them, so the staked balance keeps growing.`;
    case 'bridge':
      return `Bridge a small amount ($25) back through ${name} the following week so the wallet shows two-way bridge volume.`;
    case 'rwa':
      return `Check the yield accrual for the ${name} position on the protocol's own page once a week and keep the position through at least one payout cycle.`;
    default:
      return `Repeat ${name}'s core action on ${chain} once a week, such as a deposit, a swap or a vote, so the wallet shows steady use.`;
  }
}

/**
 * A protocol's farm plan: seven steps, eight when it runs on more than one chain. Every step
 * is an action with a cost and a time, built from the protocol's own record (category family,
 * chains, TVL, age) and its name for display only. Nothing here claims a token exists or a
 * launch date: the snapshot records no token for these protocols, and the plan says so.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const core = coreAction(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper and store it offline.`,
      cost: 'no fee to create the wallet',
      time: '5 minutes',
    },
    core,
    {
      text: repeatAction(p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a week, open ${p.name}'s own points or rewards page from its official site or docs and check what it records. The snapshot records no token for ${p.name}, so farm the usage itself, not a promised launch.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Before any approval, check the contract address on ${chain}'s block explorer and on DefiLlama, and revoke the approval after you finish if you stop using the protocol.`,
      cost: 'about $1 of gas to revoke',
      time: '10 minutes',
    },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  if (p.chains.length > 1) {
    steps.splice(3, 0, {
      text: `Repeat the deposit with $25 on ${p.chains[1]} as well, so the wallet is active on a second chain ${p.name} supports.`,
      cost: '$25 of capital and about $2-4 of gas',
      time: '15 minutes',
    });
  }
  return steps;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = familyMultipleMap(computeFamilyMultiples(snapshot, model));
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      family: s.family,
      family_multiple: s.familyMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      new_protocol_penalty: s.newPenalty,
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the rank, the figures, the model breakdown and the farm plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    model: {
      family: row.model.family,
      family_multiple: row.model.family_multiple,
      growth_pct: row.model.growth_pct,
      growth_multiplier: row.model.growth_multiplier,
      maturity_multiplier: row.model.maturity_multiplier,
      new_protocol_penalty: row.model.new_protocol_penalty,
      breadth_multiplier: row.model.breadth_multiplier,
    },
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    family_multiples: computeFamilyMultiples(snapshot, model),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, one shared implied value, pre-token purity, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows: the gate takes 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.mcap_usd !== null || r.gecko_id !== null || r.symbol !== null) return `${r.slug} records a token and does not belong on the ranked board`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_MAX) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
