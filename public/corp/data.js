// data.js — Just Business has NO mock economy data. Real player identity,
// balances, corp, resources, vault, corporations directory, tax, etc. are
// all bridged in from the game (window.__JB.econ). The collections below
// are intentionally empty; screens render honest empty states until the
// matching real systems land. RARITY + DISTRICTS are structural enums
// (styling / world regions), not mock content.

window.ECON = (function () {
  // Neutral defaults only — overridden by the game bridge.
  const PLAYER = {
    id: '', handle: 'Survivor', title: '', aza: 0, corp: '',
    corpRole: '', rep: 0, repTrades: 0, repScams: 0, avatar: '#c64a2a',
  };

  const RARITY = {
    common:    { label: 'Common',    color: '#7d7973', glow: 'none' },
    rare:      { label: 'Rare',      color: '#5fa3d1', glow: '0 0 18px rgba(95,163,209,.18)' },
    epic:      { label: 'Epic',      color: '#a978d8', glow: '0 0 18px rgba(169,120,216,.22)' },
    legendary: { label: 'Legendary', color: '#d9a14a', glow: '0 0 18px rgba(217,161,74,.28)' },
    mythic:    { label: 'Mythic',    color: '#d05a3d', glow: '0 0 22px rgba(208,90,61,.30)' },
    anomaly:   { label: 'Anomaly',   color: '#c75dd4', glow: '0 0 22px rgba(199,93,212,.34)' },
    unique:    { label: 'Unique',    color: '#e8d089', glow: '0 0 26px rgba(232,208,137,.36)' },
  };

  // World regions (structural — used by the Real Estate map chrome). No
  // listings ship with the game; properties are player-driven, later.
  const DISTRICTS = {
    foundry:  { id:'foundry',  name:'Foundry Belt',     tone:'rust',  blurb:'Heavy industry, smoke, output' },
    verge:    { id:'verge',    name:'Outer Verge',      tone:'void',  blurb:'Edge of known map, anomalies' },
    lower:    { id:'lower',    name:'Lower Wards',      tone:'flat',  blurb:'Dense housing, low tax, high turnover' },
    drowned:  { id:'drowned',  name:'Drowned Quarter',  tone:'danger',blurb:'Flooded ruin, occult sites' },
    ai:       { id:'ai',       name:'AI Districts',     tone:'rare',  blurb:'Pre-Collapse compute, walled' },
    anomaly:  { id:'anomaly',  name:'Anomaly Strip',    tone:'void',  blurb:'Forbidden by treaty. Buy fast.' },
  };

  // ── No mock content ──────────────────────────────────────────────────
  const ASSETS       = [];
  const HISTORY      = {};
  const LISTINGS     = [];
  const BLACK_MARKET = [];
  const MAIL         = [];
  const CONVOYS      = [];
  const EVENTS       = [];
  const FEED         = [];
  const PLAYERS      = [];
  const PROPERTIES   = [];
  const REVIEWS      = {};

  return { PLAYER, RARITY, ASSETS, HISTORY, LISTINGS, BLACK_MARKET, MAIL, CONVOYS, EVENTS, FEED, PLAYERS, DISTRICTS, PROPERTIES, REVIEWS };
})();
