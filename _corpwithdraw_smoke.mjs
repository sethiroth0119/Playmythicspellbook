/* 🏦 A FOUNDER CAN EMPTY THE TREASURY INTO THEIR WALLET (bug-mu17gpcz).

   Asked for: "a Withdraw Cinder button for players closing down a
   Corporation". corp_dissolve (sql/130) refuses while the treasury holds
   Cinder, and the roster hides Pay on the founder's own row, so there was no
   way out. The server path already existed: corp_pay_member_from_treasury
   (sql/107) has no not-to-self rule, re-checks the officer and membership, and
   debits corp_treasury with an append-only negative row. This pins the wiring:
   the button is founder-only, reuses that RPC, the payee id comes from the
   signed-in account (never the iframe), and the local mirror moves by qty
   without a second server credit.

   Run: node _corpwithdraw_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');
const JSX = readFileSync('./public/corp/app.jsx', 'utf8');

ok(/String\(corp\.role \|\| ''\)\.toLowerCase\(\) === 'founder' && \(Number\(econ && econ\.corpTreasury\) \|\| 0\) >= 1/.test(JSX), 'the withdraw button shows for the founder only, and only with Cinder in the treasury');
ok(/setPayTarget\(\{ userId: null, name: 'Your wallet', self: true \}\)/.test(JSX), 'it opens the existing Pay modal with no user id of its own');
ok(/toSelf: !!payTarget\.self,/.test(JSX), 'the pay action carries toSelf');
ok(/fromTreasury: !!\(econ && econ\.amOwner && econ\.corp\) \}\);/.test(JSX), 'and still chooses the treasury RPC the same way as wages');

const i = IDX.indexOf("a.kind === 'corpSend'");
const blk = IDX.slice(i, i + 12000);
ok(/const toId = \(a\.toSelf \? \(\(a\.fromTreasury && Profile\.cloud\.userId\) \|\| ''\) : \(a\.toId \|\| ''\)\)\.toString\(\);/.test(blk), 'the payee for toSelf is the signed-in id, and only on the treasury path');
ok(/_fromTreasury \? 'corp_pay_member_from_treasury' : 'corp_pay_member'/.test(blk), 'it goes through corp_pay_member_from_treasury (sql/107)');
ok(/if \(a\.toSelf\) \{[\s\S]{0,900}_gemsTaxExempt\(\(\) => \{ Profile\.gems = \(Profile\.gems \| 0\) \+ qty; \}\)/.test(blk), 'the mirror moves by qty, tax-exempt');
const selfBlk = blk.slice(blk.indexOf('if (a.toSelf) {'), blk.indexOf('if (a.toSelf) {') + 1200);
ok(!/addGems\(/.test(selfBlk.replace(/NOT through addGems/, '')), 'and never through addGems (that would credit the server twice)');

const sql = readFileSync('./sql/107_corp_pay_from_treasury.sql', 'utf8');
ok(/insert into corp_treasury \(corp_id, user_id, amount, kind, note\)\s*values \(p_corp_id, p_to_id, -v_qty, 'wage'/.test(sql), 'the treasury leg is an append-only negative row, never an UPDATE');
ok(!/p_to_id\s*=\s*v_uid|v_uid\s*=\s*p_to_id/.test(sql), 'the RPC has no not-to-self rule, so the founder can be the payee');

console.log(fails ? `\n✗ ${fails} failed` : '\n✓ all passed');
process.exit(fails ? 1 : 0);
