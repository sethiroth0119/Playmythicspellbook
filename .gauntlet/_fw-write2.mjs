/* one read -> transform -> write of public/index.html (never sed -i on this file) */
import fs from 'node:fs';
const P = 'public/index.html';
const buf = fs.readFileSync(P);
let s = buf.toString('utf8');
const before = s.length;
const hits = [];
const sub = (name, from, to) => {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`${name}: expected exactly 1 match, found ${n}`);
  s = s.replace(from, to);
  hits.push(name);
};

/* ── 1. the 44rem measure cap becomes width-scoped ───────────────────────── */
sub('measure-cap',
`  /* …and the prose inside one still caps at a measure, because "two columns"
     is not a measure everywhere: wherever a .full row is wider than 44rem the
     line of text inside it is the thing that stops being readable. Measured at
     1080x1000, where the stacked editor gives a .full row the whole 935px:
     without this rule the longest run of prose is 935px and .fx-props is 238px
     SHORTER (17,274 against 17,512) — that is the trade, and 704px of 11.5px
     uppercase Cinzel is worth 238px of scroll. At 1600 span 2 already keeps a
     .full row at 560px, so the cap does not bind and changes nothing (13,826
     either way). */
  .fx-two .editor-field.full > label,
  .fx-two .editor-field.full > .small-text,
  .fx-two .editor-field.full > input,
  .fx-two .editor-field.full > select,
  .fx-two .editor-field.full > textarea { max-width: 44rem; }`,
`  /* …and the prose inside one still caps at a measure, because "two columns"
     is not a measure everywhere: wherever a .full row is wider than 44rem the
     line of text inside it is the thing that stops being readable.
     ⚠ ONLY WHILE THE .full BLOCK IS HALF A ROW, and that restriction was paid
       for by a critic who looked at a screenshot. Below 1081px a .full block
       is the WHOLE row (935px at 1080), and capping only its CHILDREN left the
       block's own dashed border running the full 935px around content that
       stopped at 704 — an empty right third inside a box, on 14 blocks at once
       ("🧬 Mutate", "✨ Inspire Effect", "⏱ Counter Unit", "👑 Ace Slam", …).
       Measured at 1080x1000: blocks whose text ends more than 80px short of
       their own border 19 -> 6, and .fx-props 17,825 -> 17,587 px. The cap was
       costing 238px of scroll to draw that band, so dropping it below the
       breakpoint is cheaper AND looks finished. Above it, span 2 already keeps
       a .full row near 560px and the cap barely binds. */
  @media (min-width: 1081px) {
    .fx-two .editor-field.full > label,
    .fx-two .editor-field.full > .small-text,
    .fx-two .editor-field.full > input,
    .fx-two .editor-field.full > select,
    .fx-two .editor-field.full > textarea { max-width: 44rem; }
  }`);

/* ── 2. the sub-grid legibility floor, right after the .fx-two grid rule ─── */
sub('sub-floor',
`  .fx-two .editor-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));`,
`  /* 📖 …EXCEPT THE SUB-GRIDS, WHICH GET 340px, because 260 is the floor that
     keeps a COLUMN legible and this is the floor that keeps a LABEL legible,
     and they are not the same number. Every sentence-long label in this editor
     lives in a .fx-sub grid (#fx-onplay and its siblings): "🩸 Sacrifice
     Nearby — how many units may be offered? (0 = every one in radius)" is 78
     characters, and measured with a ruler span in its own computed font it is
     683px of text on one line, so it needs 348px to fit in two. A 262px track
     gives it three. 340 is the smallest floor that clears every such label in
     the fixed open-set at all four widths.
     ⚠ THIS IS THE WHOLE PRICE OF THE 2-LINE CLAUSE, and it was measured, not
       guessed. Raising the floor for EVERY grid instead of just the sub-grids
       drops 1600 from 4 columns to 3 and .fx-props from 14,876 to 16,288 px —
       -32.7% turns into -26.3% and the density clause fails. Confining it to
       the sub-grids costs 137px at 1600 (14,739 -> 14,876) and takes labels
       past two lines from 6 to 0. At 720 the sub-grids become one 549px
       column, which is +1,025px of scroll (19,333 -> 20,374) and is the one
       number this piece makes worse — a 609px row cannot hold two 340px
       tracks, and two 298px ones put those labels back on three lines. */
  .fx-two .fx-sub > .editor-grid { grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }

  .fx-two .editor-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));`);

/* ── 3. control floor + chip rows, after the faction-picker rule ─────────── */
sub('chips',
`  .fx-two .faction-picker { grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); }
`,
`  .fx-two .faction-picker { grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); }

  /* ☑ THE 28px CONTROL FLOOR. 38 of this editor's inputs computed 15px tall —
     every one a bare checkbox, sized by .card-editor input[type="checkbox"]
     (34448) — which is below the 28px this piece is held to and below WCAG
     2.2's 24px target minimum. An owner who authors cards all day clicks these
     more than anything else on the screen.
     ⚠ 29, NOT 28, and that one pixel is not taste. At 1280 the app's own
       _uiAutoScale puts zoom:0.8 on <html>, and getComputedStyle then reports
       a 28px box as 27.99px — a rounding artifact that reads as a failure of
       the very floor this sets. 29 lands at 28.98 and clears it.
     ⚠ !important, WHICH IS OTHERWISE NOT THE HOUSE STYLE. Seven of these
       checkboxes carry an inline style="width:18px;height:18px" in the markup
       (146116, 146175, 146183, 146191, …) and an inline declaration cannot be
       beaten by a selector, only by importance. Without it the floor holds for
       31 of 38 and the clause still fails.
     ⚠ AND THE CHIP PADDING COMES DOWN WITH IT. .card-editor label:has(> input
       [type="checkbox"]) (34449) is a 36px-min-height chip with 7px of
       vertical padding; 29 + 14 overflows that and every chip in the editor
       grows. 4px keeps the chip at its designed height, and the whole control
       floor then costs nothing: measured 1600x1000, .fx-props 14,739px with
       15px boxes and 14,739px with 29px ones. */
  .card-editor.fx-two input[type="checkbox"],
  .card-editor.fx-two input[type="radio"] { width: 29px !important; height: 29px !important; }
  .card-editor.fx-two label:has(> input[type="checkbox"]),
  .card-editor.fx-two label:has(> input[type="radio"]) { padding: 4px 9px; }

  /* 🎚 A WRAPPING CHIP ROW KEEPS THE WHOLE ROW — it is the one kind of .full
     block that half a row actively breaks. The counter-trigger row (148765)
     is a flex-wrap strip of chips, and .card-editor's chip rule gives each one
     flex: 1 1 200px, so in a 560px half-row they shrink to ~262px and their
     labels ("🪞 Counter — opponent activates a counter card (builds a chain)",
     63 chars, 621px of text) fall to three and four lines. Measured at
     1080x1000 that was 7 of the 10 labels still past two lines.
     Giving the row all four tracks and the chips a 21rem basis is not merely
     free, it is CHEAPER than the squeezed version — 1600x1000 .fx-props
     13,826 -> 13,461px — because a full-width strip packs more chips per line
     than two half-width ones do.
     ⚠ Matched by :has() on a checkbox INSIDE a wrapper div, which is exactly
       the chip-strip shape (label > input) and not the plain "one checkbox is
       this field" shape (.full > label > input), whose blocks are ordinary
       fields and are happy in half a row. */
  .fx-two .editor-grid > .editor-field.full:has(> div > label > input[type="checkbox"]) { grid-column: 1 / -1; }
  .fx-two .editor-field.full > div > label:has(> input[type="checkbox"]) {
    flex: 1 1 21rem; min-width: min(100%, 21rem); max-width: 26rem;
  }
`);

/* ── 4. the one field whose LABEL is a sentence gets the wide slot ────────── */
sub('treatas',
`        <div class="editor-field"><label>🪞 Treated As (optional — this card COUNTS AS this NAME for every card condition)</label><input id="ed-treatas"`,
`        <!-- 📏 .full because the LABEL is a sentence, not because the input is
             wide. 81 characters, 691px of text measured in its own computed
             font, so it needs 348px to fit two lines and the 268px track it
             sat in gave it three — the last label in the fixed open-set still
             past two lines at every width. The wide slot costs 137px of the
             13,000 this column now is. -->
        <div class="editor-field full"><label>🪞 Treated As (optional — this card COUNTS AS this NAME for every card condition)</label><input id="ed-treatas"`);

fs.writeFileSync(P, Buffer.from(s, 'utf8'));
console.log('wrote', hits.join(', '), '| bytes', before, '->', s.length);
