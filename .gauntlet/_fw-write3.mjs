import fs from 'node:fs';
const P = 'public/index.html';
let s = fs.readFileSync(P).toString('utf8');
const from = `  @media (min-width: 1081px) {
    .fx-two .editor-field.full > label,
    .fx-two .editor-field.full > .small-text,
    .fx-two .editor-field.full > input,
    .fx-two .editor-field.full > select,
    .fx-two .editor-field.full > textarea { max-width: 44rem; }
  }`;
const to = `  .fx-two .editor-field.full > label,
  .fx-two .editor-field.full > .small-text,
  .fx-two .editor-field.full > input,
  .fx-two .editor-field.full > select,
  .fx-two .editor-field.full > textarea { max-width: 44rem; }
  /* ⚠ AND IT IS RELEASED TO \`none\`, NOT SIMPLY LEFT OUT, BELOW THE BREAKPOINT.
       Deleting the rule for narrow widths does not uncap these elements — it
       hands them to .card-editor label:has(> input[type="checkbox"]) (34449),
       whose max-width is 340px, which is a HARDER cap than the one being
       removed. Measured at 1080x1000 the first attempt did exactly that and
       put 7 chip labels back on three and four lines ("⚔ Assault Card —
       activates automatically when the player attacks" at 340px) while
       reporting the change as free, because the probe that priced it had
       injected \`max-width: none\` and the file had not. */
  @media (max-width: 1080px) {
    .fx-two .editor-field.full > label,
    .fx-two .editor-field.full > .small-text,
    .fx-two .editor-field.full > input,
    .fx-two .editor-field.full > select,
    .fx-two .editor-field.full > textarea { max-width: none; }
  }`;
if (s.split(from).length - 1 !== 1) throw new Error('anchor not unique');
s = s.replace(from, to);
fs.writeFileSync(P, Buffer.from(s, 'utf8'));
console.log('ok');
