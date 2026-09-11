/* 🧍 EVERYONE ELSE IN THE HUB WAS A BLUE CAPSULE.

   Asked for: "Add to the Athena Engine to where I can set a map to be the
   player hub where players can come into it and talk with each other with a
   model character that I set for the moment; also allow me to add multiple
   models that the players can pick from ... and make it where I can choose the
   camera angle — top down, over the shoulder or first person."

   THREE OF THOSE FOUR ALREADY SHIPPED. The hub, its typed chat and its
   proximity voice exist (mapforge.session.js); so do the three camera views
   (avatar.js VIEWS, map.player.view). What did NOT exist is the reason the
   fourth was asked for:

   🔴 `map.player.model` DRESSED ONLY THE LOCAL PLAYER. Every OTHER person in
      the hub was built by makeFigure() as a hardcoded cylinder with a sphere
      on top. So an author could set a character, walk into their own hub, and
      find the room full of capsules — and because a hub mounts in first person,
      where your own model is deliberately not drawn, an `fps` hub was capsules
      and nothing else. The character was real; nobody could see anyone in it.

   WHAT THIS SUITE PINS:
     1. a map carries a CAST of characters, normalized, de-duplicated, capped;
     2. a choice is ACCOUNT-WIDE and reconciled PER MAP — an id a map does not
        offer falls back to that author's default, never to nothing;
     3. a peer is drawn as the character they chose, and the capsule survives
        as the fallback, because a player you can hear and walk into but cannot
        see is worse than a plain shape;
     4. the character is disposed with the figure — it is a second group in the
        scene with its own AnimationMixer;
     5. the choice rides the position packet that already exists.

   Run: node _athenacast_smoke.mjs */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const D = './public/src/mapforge/';
const SESSION = readFileSync(D + 'mapforge.session.js', 'utf8');
const ENGINE = readFileSync(D + 'mapforge.engine.js', 'utf8');
const EDITOR = readFileSync(D + 'mapforge.editor.js', 'utf8');
const IDX = readFileSync('./public/index.html', 'utf8');

const fmt = await import(pathToFileURL(D + 'mapforge.format.js').href);
const av = await import(pathToFileURL(D + 'mapforge.avatar.js').href);

/* ── 1. THE MAP CARRIES A CAST ───────────────────────────────────────────── */
{
  const p = fmt.normalizePlayer(null);
  ok(Array.isArray(p.cast) && p.cast.length === 0,
    'a map with no roster normalizes to an empty cast — every existing map keeps working unchanged');
  ok(p.view === 'fps' && p.model === null, 'and the fields that were already there are untouched');

  const n = fmt.normalizePlayer({
    model: { a: 'hero' },
    cast: [
      { a: 'hero', label: 'The Warden', scale: 2, faces: 'z' },
      { a: 'hero', label: 'duplicate' },
      { a: 'rogue', scale: -4 },
      { a: 'ghost', scale: 'nonsense' },
      { a: { nope: 1 } },
      null,
    ],
  });
  ok(n.cast.length === 3, 'garbage and duplicates are dropped', JSON.stringify(n.cast.map(c => c.a)));
  ok(n.cast[0].label === 'The Warden' && n.cast[0].scale === 2 && n.cast[0].faces === 'z', 'a good row survives intact');
  /* clampNum's own convention, shared with model.scale: a finite number out of
     range is CLAMPED to the bound; only a non-finite one falls back to the
     default. Asserted both ways round so this row records which is which. */
  ok(n.cast[1].scale === 0.01 && n.cast[1].faces === '-z', 'a negative scale clamps to the floor and faces defaults', JSON.stringify(n.cast[1]));
  ok(n.cast[2].scale === 1, 'and a scale that is not a number at all falls back to 1', JSON.stringify(n.cast[2]));

  const big = fmt.normalizePlayer({ cast: Array.from({ length: 40 }, (_, i) => ({ a: 'm' + i })) });
  ok(big.cast.length === fmt.PLAYER_CAST_MAX, 'the roster is capped', big.cast.length + ' of 40');
  ok(fmt.PLAYER_CAST_MAX > 1, 'and the cap leaves room for a real choice', String(fmt.PLAYER_CAST_MAX));
}

/* ── 2. ACCOUNT-WIDE CHOICE, RECONCILED PER MAP ──────────────────────────── */
{
  const map = fmt.normalizePlayer({ model: { a: 'default', scale: 1.5 }, cast: [{ a: 'rogue', scale: 2, faces: 'z' }] });
  ok(av.resolveCharacter(map, 'rogue').a === 'rogue', 'a choice this map offers is worn');
  ok(av.resolveCharacter(map, 'rogue').scale === 2, 'with the MAP author\'s numbers, not the player\'s', JSON.stringify(av.resolveCharacter(map, 'rogue')));
  /* The whole point of an account-wide pick: it visits maps that never heard of it. */
  ok(av.resolveCharacter(map, 'someoneElsesCharacter').a === 'default',
    'a choice this map does NOT offer falls back to the author\'s default — an id from a map they visited last week is harmless');
  ok(av.resolveCharacter(map, '').a === 'default', 'and so does no choice at all');
  ok(av.resolveCharacter({ cast: [], model: null }, 'x') === null,
    'a map with no character at all answers null rather than throwing — the caller draws the placeholder');
  ok(av.resolveCharacter(null, null) === null, 'and garbage in is null out, not a crash');

  const cast = av.castOf(map);
  ok(cast.length === 2 && cast[0].isDefault && cast[0].a === 'default',
    'castOf() puts the author\'s default first, so a picker never has to know the two fields apart',
    JSON.stringify(cast.map(c => c.a)));
  ok(av.castOf({ model: { a: 'solo' }, cast: [] }).length === 1, 'a map with only a default offers exactly one');
  ok(av.castOf({ model: { a: 'dup' }, cast: [{ a: 'dup' }] }).length === 1,
    'and a default that is also in the cast is not listed twice');
}

/* ── 3. THE HUB DRAWS THE CHARACTER, AND KEEPS THE FALLBACK ──────────────── */
{
  ok(/function makeFigure\(name, pickId\)/.test(SESSION), 'a figure is built for a specific chosen character');
  ok(/createAvatar\(THREE, \{ world: S\.g\.world, scene: S\.g\.scene,/.test(SESSION),
    'a peer\'s model loads through the WORLD asset cache — two people in the same character share one template');
  ok(/resolveCharacter\(pl, pickId\)/.test(SESSION), 'through the same resolver the local player uses');
  ok(/new THREE\.CylinderGeometry\(0\.3, 0\.32, 1\.1, 10\)/.test(SESSION),
    'the capsule is still built — a peer whose model is loading, missing or 404 must still be visible');
  ok(/function figureSkin\(f\)/.test(SESSION) && /f\.body\.visible = !on/.test(SESSION),
    'and it is hidden only once the real character is actually ready, not merely requested');
  ok(/if \(f\.av\) \{ try \{ f\.av\.dispose\(\); \} catch \(e\) \{\} \}/.test(SESSION),
    'the character is disposed with the figure — it is a second scene group with its own mixer');
  const teardown = /hub\.figures\.forEach\(f => \{[^\n]*\}\);/.exec(SESSION);
  ok(!!teardown && /f\.av\.dispose/.test(teardown[0]), 'including when the whole hub is torn down', teardown && teardown[0].slice(0, 90));
  ok(/if \(f && \(f\.pick \|\| ''\) !== \(p\.m \|\| ''\)\)/.test(SESSION),
    'a peer who changes character mid-session is rebuilt rather than left in the old one');
}

/* ── 4. THE CHOICE TRAVELS ON A PACKET THAT ALREADY EXISTED ──────────────── */
{
  ok(/m: hub\.pick \|\| ''/.test(SESSION),
    'the chosen character rides the position broadcast — a short id on an existing packet, not a second channel');
  ok(/pick: avatarPick\(\) \|\| ''/.test(SESSION), 'and is read from the account when the hub opens');
  ok(/s\.hub\.lastKey = null;/.test(SESSION),
    'changing it forces the next packet, so the room sees the change without the player having to walk');
}

/* ── 5. THE PICKER APPEARS ONLY WHEN THERE IS A CHOICE ───────────────────── */
{
  ok(/function buildCastPicker\(s\)/.test(SESSION), 'the hub has a character picker');
  ok(/if \(!cast \|\| cast\.length < 2\) return;/.test(SESSION),
    'which is not drawn for a map that offers one character — a button opening a list of one is noise');
  ok(/setAvatarPick\(id\)/.test(SESSION), 'and the choice is written to the account');
  ok(/Your own view updates next time you enter/.test(SESSION),
    'the panel is honest about when the player\'s OWN view changes rather than leaving them wondering');
}

/* ── 6. THE LOCAL CHARACTER USES THE SAME CHOICE ─────────────────────────── */
{
  ok(/const myModel = resolveCharacter\(pv, avatarPick\(\)\);/.test(ENGINE),
    'the engine dresses the local player in their chosen character too');
  ok(!/if \(mode === 'fps' && pv\.model && pv\.model\.a\)/.test(ENGINE),
    'not in the map default regardless of what they picked');
}

/* ── 7. THE AUTHOR CAN BUILD THE ROSTER, AND THE ACCOUNT CAN HOLD IT ─────── */
{
  ok(/Characters players can pick/.test(EDITOR), 'the editor has a roster section');
  ok(/id="mf-cast-add"/.test(EDITOR), 'with a control to add a model to it');
  ok(/data-cast-del=/.test(EDITOR) && /data-cast-label=/.test(EDITOR), 'and to remove or name one');
  ok(/PLAYER_CAST_MAX/.test(EDITOR), 'and it respects the cap rather than inventing its own');

  ok(/avatarPick: \(\) => \{ try \{ return String\(Profile\.athenaAvatar \|\| ''\); \}/.test(IDX),
    'index.html stores the choice on the PROFILE — account-wide, as asked');
  ok(/setAvatarPick: \(id\) => \{/.test(IDX), 'and can set it');
  ok(/if \(\/\[<>"'\]\/\.test\(v\)\) return false;/.test(IDX),
    'refusing anything that could not be an asset id — it is rendered into the picker\'s markup');
  ok(/Profile\.athenaAvatar = v;/.test(IDX) && /saveProfile\(\)/.test(IDX.slice(IDX.indexOf('setAvatarPick'), IDX.indexOf('setAvatarPick') + 600)),
    'and it rides the ordinary profile save — a cosmetic preference, not currency');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
