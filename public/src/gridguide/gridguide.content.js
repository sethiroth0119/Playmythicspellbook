/* ═══════════════════════════════════════════════════════════════════════════
   gridguide.content.js — the guide as it ships, before any admin edits it.

   This is what a player sees when sql/132 has not been applied, when they are
   offline, or before the first admin save. Once an admin saves, the newest row
   in grid_guide_versions replaces it wholesale.

   ⚠ Written TO THE PLAYER. The marketing copy it came from also had sales
     scripts, a say/don't-say table and a launch checklist; those are for staff
     and stay out of the game.
   ⚠ Every claim here is a system that exists: the Mayor Hall split
     (sql/121), the capital multiplier (NODE_EMPIRE_HANDOFF), node sales in
     escrow (sql/118), the audited economy (ECONOMY.md), the Vault rate and
     the Aza tag (sql/017). Change the game, change this.
   🔴 No "investment", "safe", "guaranteed", "passive income" or "make your
     money back". Cinder cashes out for real money, so selling a return on a
     node run by someone else is how a game gets treated as a security. Sell
     the play and the ownership, never the return.
   ═══════════════════════════════════════════════════════════════════════════ */

export const DOC_VERSION = 1;

export const DEFAULT_DOC = {
  v: DOC_VERSION,
  hero: {
    eyebrow: 'City Nodes · Player guide',
    t1: 'Own a node.',
    t2: 'Build a city.',
    t3: 'Hire a Grid Manager.',
    lede: 'Every node on this map can become a working city with citizens, businesses and trade routes. Build it yourself, or hire a Grid Manager to build it for you. Here is how it works and every way the game lets you earn.',
    meta: ['Grid Managers are hired in Mayor Hall', 'Currency: 🔥 Cinder', 'Vault rate: 5,000 🔥 = $1.00'],
    photo: null,
  },
  sections: [
    {
      id: 'doors', kind: 'doors',
      eyebrow: 'Pick your path', title: 'Three ways to play the map',
      intro: 'You can do one of these or all three. Most players start as a player and pick up a node later.',
      items: [
        { who: 'Play', title: 'Battle and trade', hook: 'A card game where your time and skill earn Cinder.', bullets: ['Battle, duel and enter stadium events', 'Trade cards on the player market', 'Farm, fish, craft, haul and trade', 'Earned Cinder can be cashed out through the Vault'] },
        { who: 'Own', title: 'Claim a node', hook: 'Turn a node into your own working city.', bullets: ['Claim a node with Cinder and resources', 'Build it yourself, or hire a Grid Manager', 'Your city\'s economy pays you in Cinder', 'Your capital\'s Cinder is multiplied by how many nodes you hold'] },
        { who: 'Manage', title: 'Become a Grid Manager', hook: 'Good at city building? Run other players\' cities for a share of what they earn.', bullets: ['Take contracts in Mayor Hall', 'Agree the split, the hours and who keeps cards and resources', 'Your share is paid automatically on every payout', 'Your phone shows what each client city is earning you'] },
      ],
      extras: [],
    },
    {
      id: 'flow', kind: 'flow',
      eyebrow: 'How a city pays', title: 'From empty node to Cinder',
      intro: 'Every step below is a real system in the game.',
      items: [
        { title: 'Claim a node', body: 'Pay Cinder and resources to claim a node on this map, or buy one from another player. Hidn Studios holds the payment in escrow until ownership transfers.' },
        { title: 'Hire a Grid Manager', body: 'Post or accept a contract in Mayor Hall. It sets the revenue split (for example 30% manager, 70% owner) and the hours per month. Or skip this and build it yourself.' },
        { title: 'The city gets built', body: 'Zone land, build housing, businesses, power, roads and trade links. Citizens move in, take jobs, pay rent and shop.' },
        { title: 'The treasury earns', body: 'Rent, shopping and exports to other cities feed the treasury. The economy is audited every tick, so a city can only pay out Cinder it actually earned.' },
        { title: 'Payout is split', body: 'The server splits each payout by your contract: the manager takes their share and the owner gets the rest. Earned Cinder can be cashed out through the Vault.' },
      ],
      extras: [],
    },
    {
      id: 'calc', kind: 'calc',
      eyebrow: 'Try it', title: 'How a revenue split works',
      intro: 'Type in any payout and move the slider to see how a Mayor Hall contract divides it. This is an example, not a forecast. What a real city earns depends on how well it is built and run, and it can be nothing.',
      note: 'The manager\'s share is rounded down and the owner receives the exact remainder, so the two always add up to the payout. Only earnings are split. When the city spends, it comes out of the owner\'s stores. Cards and resources follow the contract\'s own terms, not the percentage. USD shown at the Vault rate of 5,000 🔥 = $1.00.',
      extras: [],
    },
    {
      id: 'map', kind: 'map',
      eyebrow: 'The earning map', title: 'Every way to earn Cinder',
      intro: 'Blue routes are ways to play. Orange routes come from owning something. If one part of the game isn\'t for you, there are plenty of others.',
      items: [
        { name: 'Arena', sub: 'PLAY', routes: [
          { k: 'play', t: 'Battles & duels', b: 'Win card battles against players and the game.' },
          { k: 'play', t: 'Stadium events', b: 'Scheduled competitive events.' },
          { k: 'play', t: 'Missions & campaigns', b: 'Co-op mission maps and node campaigns.' },
          { k: 'play', t: 'Leaderboards', b: 'Rank up across seasons.' } ] },
        { name: 'Market', sub: 'TRADE', routes: [
          { k: 'play', t: 'Card market', b: 'List and sell cards to other players. Real sales set the price chart.' },
          { k: 'play', t: 'Trading lots', b: 'Buy low, sell high on resources.' },
          { k: 'play', t: 'Luni market & farm auction', b: 'Sell what you grow and make.' } ] },
        { name: 'Fields & Forge', sub: 'MAKE', routes: [
          { k: 'play', t: 'Farm, ranch & fishing', b: 'Grow, raise and catch goods to sell.' },
          { k: 'play', t: 'Kitchen & refinery', b: 'Turn raw goods into higher-value products.' },
          { k: 'play', t: 'Weaponsmith', b: 'Forge blades for the board.' } ] },
        { name: 'Freight Yard', sub: 'MOVE', routes: [
          { k: 'play', t: 'Haul requests & convoys', b: 'Move goods between cities for pay.' },
          { k: 'play', t: 'Transport companies', b: 'Run a fleet other players hire.' },
          { k: 'own', t: 'Warehouse bays & depots', b: 'Rent storage to other players and collect depot earnings.' } ] },
        { name: 'Labour Hall', sub: 'WORK', routes: [
          { k: 'play', t: 'Grid Manager contracts', b: 'Build and run other players\' cities for a share.' },
          { k: 'play', t: 'Cross-city labour', b: 'Take jobs in cities that are hiring.' },
          { k: 'play', t: 'Mercenary board', b: 'Take on contracts other players post.' },
          { k: 'play', t: 'Corporation pay', b: 'Get paid from your corp\'s treasury.' } ] },
        { name: 'City Hall', sub: 'OWN', routes: [
          { k: 'own', t: 'City payouts', b: 'Your city\'s treasury pays its owner.' },
          { k: 'own', t: 'Node multiplier', b: 'Your capital\'s Cinder is multiplied by the number of nodes you own.' },
          { k: 'own', t: 'Node sales', b: 'Sell a node, with or without its city, through escrow.' },
          { k: 'play', t: 'Referrals', b: 'Invite friends who join.' } ] },
      ],
      extras: [],
    },
    {
      id: 'faq', kind: 'faq',
      eyebrow: 'Questions', title: 'What players ask',
      intro: '',
      items: [
        { q: 'Can I lose Cinder?', a: 'Yes. Anything you spend can be spent without earning it back, and a city that is built badly can earn little or nothing. The upside is that there are many ways to earn, so you are never stuck with just one.' },
        { q: 'Is Cinder real money?', a: 'Cinder is the in-game currency. Earned Cinder can be cashed out through the Vault at 5,000 🔥 = $1.00 after you connect a Stripe account and complete Stripe\'s identity check. Aza, the currency you buy with a card, cannot be cashed out, and neither can Cinder converted from Aza.' },
        { q: 'Where does a city\'s Cinder come from?', a: 'Citizens earn wages, pay rent and shop at the city\'s businesses, and the city trades with other cities. The game audits the whole loop every tick. If the numbers don\'t balance, the city stops paying out until they do.' },
        { q: 'What does a Grid Manager do?', a: 'They build and run your city: zoning, housing, businesses, power, roads and trade. The Mayor Hall contract sets their share, the hours a month they commit, and who keeps cards and resources. A manager with their own Construction Co. can bring it into your city.' },
        { q: 'Can I own more than one node?', a: 'Yes. Build a city on each one and hire a different Grid Manager for each if you like. Your first node is your capital, and its Cinder output is multiplied by the number of nodes you own.' },
        { q: 'What if I want to sell?', a: 'List the node at a price you choose, with or without its city. Hidn Studios holds the buyer\'s payment in escrow until ownership has transferred, and the sale ends the current manager contract.' },
      ],
      extras: [],
    },
    {
      id: 'fine', kind: 'check',
      eyebrow: 'Before you start', title: 'The fine print',
      intro: '',
      items: [
        'Earnings are not guaranteed. A city earns only what its economy actually makes.',
        'Nodes, cities and in-game purchases are part of a game. They are not investments.',
        'Cashing out requires a connected Stripe account and Stripe\'s identity check.',
        'Aza, and Cinder converted from Aza, cannot be cashed out.',
      ],
      extras: [],
    },
  ],
};
