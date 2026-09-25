# WARPATH — pool context at the moment of the pick

**Status: proposal. Nothing here is built.** The measurements are real and the instrument that
produced them is committed (`tools/warpath-deck/probe-draft.mjs`); the interaction design below
is waiting on a decision.

---

## 1. The case, in numbers

The pick-1-of-3 encounter is the product. It fires a median of **26 times** in a 60-turn run, and
it is the one decision the client asks a player to make with no sight of the pile the card is
joining — the Pool tab is behind the modal veil while the pick is open.

300 full runs through the real draft against the real offer tables:

| | |
|---|---|
| offers made | 23,103 across 7,701 encounters |
| offers of a card the player **already holds** | 58.5% — **1.75 of every 3** |
| offers already at the **3-copy limit** the deck builder enforces | **13.9%** |
| picks that took a card already held | 62.4% |

The coordinator's "1.33 of every 3" was against the 24-card loaner deck alone; measured the same
way I get **1.27 of every 3**, which agrees. But the loaner deck is not what the player holds —
by mid-run they hold the loaner deck *plus everything they have drafted*, and against that the
figure is **1.75 of every 3**.

**The 13.9% is the number that matters.** Those offers cannot change a battle deck at all:
`warpathPadDeck` caps at `MAX_COPIES_PER_CARD = 3`, so a fourth copy is unplayable, and nothing
on screen says so.

### What the blindness actually costs

`draft.mjs` already contains the perfect experiment, and I did not have to invent it.
`PICK_POLICIES.value` and `PICK_POLICIES.greedy` share one value function and differ in **exactly
one thing**: `value` knows how many copies it already holds, `greedy` does not. `greedy` is what
the shipped modal permits.

Same seeds, same walk, same offers:

| | drafter that can see its pool | drafter that cannot |
|---|---|---|
| picks of a **dead** card (≥3 held) | **0.9%** | **29.4%** |
| picks of a card already held | 62.4% | 74.1% |
| distinct cards in the pool | 29.7 | 26.7 |
| cards drafted per run | 26.7 | 26.7 |

**Nearly a third of a blind player's picks cannot change their battle deck.** Same number of
cards, same map, same offers — the only difference is knowing what you already carry.

This is also the player-facing half of the flat reward curve. I fixed the deck-fill maths so a
bigger pool *can* make a better deck; this is why a player still cannot *aim* at one.

---

## 2. What the modal shows — **a per-card copy badge**

**Recommendation: a per-card "you carry N" mark, folded into the type line the card face already
draws. Not a curve strip, not a pool peek.**

The card face currently renders `UNIT · cost 2`. It becomes `UNIT · cost 2 · you carry 2`, with a
third, visually distinct state when the count is at the limit — the modal already has a `.pc.bad`
style for exactly this kind of refusal.

Three states, and the silence matters as much as the text:

| copies held | shown | why |
|---|---|---|
| 0 | **nothing** | Most of the interesting picks are new cards. Adding "you carry 0" to 41.5% of offers is noise, and noise is how this becomes a spreadsheet. |
| 1–2 | `you carry 2` | The real decision: a third Wolf is a legitimate choice, and it should be a *choice* rather than an accident. |
| 3+ | `your deck is already full of these` | **13.9% of all offers.** This is the broken one. It should read as a refusal, not a statistic. |

**Why the badge over the alternatives:**

- **Over a curve/type strip.** A strip answers "what shape is my deck", which is a weaker signal —
  the measured 29-point swing is attributable to copy awareness alone, not to shape. It also costs
  a full row of vertical space the phone does not have (§4), and it is the closest thing on the
  list to the booster-opening spreadsheet the brief warns against.
- **Over a pool peek.** A peek needs a second surface over a modal that already scrolls at
  360×640. It also asks the player to leave the decision to go and study, which is the opposite of
  an encounter. The badge answers the question *in the place the question is asked*.
- **The badge is the smallest thing that moves the number.** That is the whole argument.

---

## 3. The veil — **the modal carries the context; the Pool tab stays behind it**

The veil is not the problem to solve. The problem is that the pick needs one fact, and the fact
should travel to the pick rather than the player travelling to the fact.

Two things already work and should be stated rather than rebuilt:

- **Dismissing an encounter no longer loses it.** The server keeps it with `picked:null`, the
  action button re-opens it, and a page reload re-opens it. A player who wants to study their pool
  properly can close the modal, read the Pool tab, and come back. That was a bug fix in an earlier
  round; it is also the escape hatch that makes the badge sufficient.
- **The offers are stable.** They are rolled from the tile hash and stored, so leaving and
  returning cannot re-roll them. Studying costs nothing but time.

So: no change to the veil, and the "peek" idea is explicitly declined.

---

## 4. What a pick is worth — **one line about extraction, and demote the deck ladder**

`Extractable now 0 / 6` is the number that decides the run and it is three taps deep. The loudest
progress affordance is the deck ladder to **FULL DECK**, which my own harness showed buys nothing:
past roughly a 46-card pool the battle deck stops changing at all — `distinct` sticks at 26 and
`avgCost` at 1.93 — so the last two `DECK_MILESTONES` rungs cannot pay in deck power however the
bridge is written.

**Proposal:** the encounter footer carries one line, in the run's own terms:

> *Nothing you take is yours until it is secured at camp and carried out. **4 of 6 extraction
> slots spoken for.***

Not a ladder, not a percentage. It states the consequence that is actually true of this pick, and
it puts the run's real limit next to the decision that fills it.

**Separately, and smaller: demote the FULL DECK ladder.** It is the loudest progress signal in the
HUD and it points at a milestone that does not pay. I would rather not delete a deliberate piece
of design in the same change as this one — flagging it as its own decision, with the harness
evidence attached.

---

## 5. What I am deliberately NOT showing

This is the judgement the brief cares most about. The mode is an expedition, not a deck builder.

- **No curve histogram, no type counts, no mana curve.** See §2.
- **No power/win-rate score on the offers.** The engine could rank these; it must not. A number
  that says which card is better deletes the decision, and the decision *is* the product.
- **No "recommended" highlight, no auto-pick, no sorting the three.** Same reason, more so.
- **No inline pool list.** That is the Pool tab, and it is one tap away.
- **No copy badge when the count is zero.** Silence is the default; the badge should feel like
  recognition of something you are carrying, not a readout attached to every card.

The test I applied: *does this fact change which card I take?* Copies-held does, measurably.
Everything on the list above either does not, or changes it by making the choice for the player.

---

## 6. Phone fit

Measured on the layout as it stands, with three real card faces in the modal:

| viewport | modal height | viewport | spare | pick card |
|---|---|---|---|---|
| 360×640 | 589 | 640 | **51px** | 236 |
| 390×844 | 776 | 844 | 68px | 236 |
| 844×390 | 359 | 390 | 31px | 254 |

`.sheet` is `max-height:92vh; overflow-y:auto`, so **at 360×640 the three offers already scroll** —
a player on a small phone cannot see all three at once today. That is a readability finding in its
own right and it is the binding constraint here.

- The **copy badge costs zero new rows** — it extends a line the card already draws. This is a
  large part of why it is the recommendation.
- The **extraction line** adds roughly one 18px row inside 51px of spare. It fits, but it is the
  only thing in this proposal with a vertical cost, and it is the first thing to cut if it does
  not.
- `public/warpath/_layoutcheck.js` stays green as an acceptance gate: the ≥120px map-band floor at
  all six viewports, plus the tap-theft and scroll assertions.

---

## 7. How we would know it worked

**What the harness can answer, honestly:**

| measure | now (blind) | ceiling (perfect copy-counter) | target |
|---|---|---|---|
| picks of a dead card | 29.4% | 0.9% | **under 5%** |
| picks of a card already held | 74.1% | 62.4% | falls toward 62% |
| distinct cards in the pool | 26.7 | 29.7 | rises toward 29 |
| pairwise overlap of extracted cards between runs | 21.9% | — | falls |

`probe-draft.mjs` produces all of these today and is the pre-change baseline.

**The honest caveat about those numbers.** The 0.9% column is a *machine* that counts copies
perfectly and never misreads a badge. A real player with a badge lands somewhere between 29.4% and
0.9%, and **nothing in this repo can tell us where.** Quoting the ceiling as the expected result
would be exactly the mistake I made reporting `viewH()` as an observed band.

**What the harness cannot answer at all, and needs players:**

- Whether the choice *feels* interesting, or whether the badge turns an encounter into an audit.
- Whether players read the ≥3 state as a refusal or resent it as the game saying no.
- Whether anyone notices the badge in the two seconds they spend on a pick.
- Whether the extraction line reads as stakes or as clutter.

I would want the first two answered by watching four people play one run each before this is
called done. That is not something I can substitute a probe for, and I would rather say so than
produce a number that sounds like it settles it.

---

## 8. What is already built

Only the instrument:

- `tools/warpath-deck/probe-draft.mjs` — every measurement above, re-runnable.
- `tools/warpath-deck/draft.mjs` records `offersLog`: every offer and how many copies the player
  held when it was made.

Both are cheap, independently testable, and useful whatever is decided about the interaction —
including "do nothing", for which they are the evidence. **The interaction design is not built and
will not be until it is agreed.**
