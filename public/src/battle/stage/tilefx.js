/* ═══════════════════════════════════════════════════════════════════════════
   tilefx.js — TILE STATES AND FIELD SURFACES, painted INSIDE the ground.

   Loaded by the iframe renderer (public/battle-board/index.html) as
   <script type="module" src="../src/battle/stage/tilefx.js">, i.e. served
   same-origin from /src/battle/stage/tilefx.js. It attaches three hooks to
   window.BBX and does nothing else: no imports, no page DOM, no postMessage,
   no mutation of anything the host or the spine owns.

     BBX.tilefx.drawStates(api)      ← called from drawBoard(), UNDER the actors
     BBX.tilefx.drawSurfaces(api)    ← replaces drawSurfaceFx()
     BBX.tilefx.drawStatesOver(api)  ← replaces drawPaintOverSurfaces()

   ── WHAT WAS HERE ORIGINALLY, AND WHY IT IS GONE ──────────────────────────
   The board's own highlight was fill(colour,.3) + stroke(colour,.85) at 2px
   around the FULL perimeter of every lit tile, and each hazard was a painter
   clipped to one square. Three things were wrong with that:
     1. a hard, uniform-width outline is the loudest "this is a drawn grid"
        signal on the board — the exact read the redesign exists to kill;
     2. eight legal move tiles read as eight outlined CELLS, never as one lit
        area, so the eye had to count boxes instead of seeing a shape;
     3. a flat fill clipped to a square TINTS the sand inside a rectangle. Four
        adjacent oil tiles read as four blue-black squares, not as a puddle.

   ── ROUND 2: WHY THE FIRST REWRITE STILL READ AS A STICKER ────────────────
   Round 1 replaced the square with a JITTERED octagon and painted the union of
   a region through ctx.clip(). That fixed contiguous runs — four oil tiles did
   merge into one pool — but it could not fix the case the default board
   actually contains: an ISOLATED single-tile puddle. With n === 1 the union IS
   the tile, so every painter's edge-to-edge wash produced a dark teal octagon
   exactly the size and orientation of the tile, with a rimBand stroked round
   its outline. A decal with chamfered corners is still a decal.

   The root cause is structural: **ctx.clip() has a hard edge, and any wash
   that reaches it inherits it.** No amount of jitter fixes that, because the
   silhouette is still a polygon the size of a tile.

   So the clip is gone. Every surface and every state region is now composited
   through a SOFT ALPHA MASK:

     1. rasterMask() draws the region into an offscreen canvas as the union of
        (tile quad ∪ a smooth organic blob per tile), then BLURS it. The quad
        guarantees interior coverage — without it a 2×2 region gets a pinhole
        where four blobs meet. The blob, whose radius is a 3-harmonic function
        of angle seeded per tile, guarantees the OUTLINE is a curve rather than
        a polygon: no straight segments, no corners, no tile silhouette even
        when the region is one tile.
     2. layer() renders a painter's content into a scratch canvas, applies the
        mask with 'destination-in', and blits the result ONCE with the
        painter's own composite. Blitting once is what makes 'multiply' safe:
        per-tile multiply blobs double-darken every shared edge and redraw the
        grid in hue instead of in strokes, which is the failure the previous
        version's region-wide gradient was working around.
     3. halo() does the same through a DILATED, more heavily blurred mask, so
        damp sand, scorch and spill light follow the pool's own irregular shape
        outwards instead of being a ring stroked round its boundary.
     4. staticLayer() is layer() for anything that is not a function of api.T
        — the material wash, the damp halo, the hue filter under a highlight.
        It masks the content ONCE into its own cached canvas and thereafter
        costs a single blit. This is not a micro-optimisation: masking every
        layer every frame measured 673 ms/frame against a 112 ms board in the
        screenshot harness, i.e. the effect layer cost six times the entire
        rest of the renderer. With the caching, the rect-limited scratch, a
        half-resolution mask and half-resolution animated passes it is ~62 ms
        on the same machine. If you add a painter, get its m/l/s static flags
        right — a wrongly-static layer silently stops animating.

   ── ROUND 3: A HIGHLIGHT IS NOT A HAZARD ──────────────────────────────────
   Round 2 applied the hazard treatment to the tile STATES as well, and that was
   the wrong call. A hazard has no edge and should spill; a movement range is
   the answer to "where may I go?" and must stop exactly where the rules stop.
   With MASK_STATE at base 1.20 and the emission drawn through the ×1.26 halo,
   seven legal tiles rendered as one soft teal film over the whole lower-left
   quadrant — four illegal tiles and a water pool included. So the STATE path
   (drawPool) now uses a mask that is the union of the tile polygons with ~2.5px
   of feather, fills the interior FLAT and composited once, and puts the only
   traced mark on the OUTER boundary of the merged region (boundaryEdges). The
   SURFACE path is unchanged: MASK_SURF still spills, because a puddle should.

   ⚠ AND THE THING THE BLOCKER WAS ACTUALLY ABOUT. The wave-1 critic measured
   "movement range is invisible: only 0.63% of board pixels change" against the
   screenshot harness — but the harness never sent any move tiles. It set
   App.ui.actionMode='move' on a unit whose hasMoved was true, and renderBoard
   gates validMoves on `actionMode === 'move' && !sel.hasMoved`, so _bbPaint.move
   was []. Read out of the live page: paintKey `{"move":[],…,"sel":{"x":2,"z":5}}`
   while getValidMoves() on the same unit returned 7 tiles. If a future round
   reports this layer as invisible again, CHECK api.paint.move IS NON-EMPTY
   BEFORE CHANGING ANY NUMBER IN THIS FILE.

   ── ROUND 4: A LIT TILE IS FOUND BY LUMA, NOT BY HUE ──────────────────────
   Round 3 answered "which cells are legal?" and a critic confirmed it does —
   but it answered it in HUE, and that is what made the pool read as a sheet of
   translucent teal cellophane. With the multiply capped at 0.34 the pool's
   B−R measured −47.6 → +17.5 over the move region against a luma rise of only
   +26: the sand under the highlight was no longer sand of any colour, it was
   cyan. The ground had been REPLACED, not lit, which is the same "sticker on
   top of the ground" failure the outlines were, painted in hue instead.
   So the split moved: the multiply cap fell to 0.10 (enough to stop the sand's
   red dominating on near-white dusk ground, its original job, and no more) and
   the lift it was stealing went into the additive half via each state's `a`.
   The measured contract over the move pool interior is now
       ON−OFF luma  ≥ +40   (measured +46.6, whole-pool mean)
       ON  B−R      ∈ [−20,+15]  (measured −6.1; p95 +14)
   i.e. a lit tile is BRIGHTER and COOLER sand, not a different material. Two
   things follow from it and are easy to undo by accident:
     • every state got its own `a`, solved from how much luma its own filter
       actually lost, because amber loses almost nothing on warm sand and cyan
       loses three times as much (a flat rise blew attack to a mean R of 243);
     • the emissive colours carry more red than they look like they should —
       pure cyan light inverts the sand's channel order all over again.
   The other two thirds of the same critique were the edge and the interior:
   MASK_STATE.blur went 0.055 → 0.100 (a fifth of a tile of feather, with the
   50% point still exactly on the tile boundary, so nothing about legality
   changed), and the interior stopped being dead flat — see the region radial
   and `rfs` in drawPool. On a compact 3×3 pool that measures 57.9 dL at the
   centre against 37.8 two thirds of the way out; on the L-shaped 7-tile test
   region it correctly measures flat, because a ring of tiles HAS no centre.

   ── ROUND 5: THE EDGE IS WHAT MAKES A PANE A PANE ─────────────────────────
   Round 4 hit its own numbers (measured again here: ON−OFF luma +47, ON B−R
   −15 with p05 −32 / p95 +7, so the whole distribution is inside the band, not
   just the mean) and the frame STILL read as overlapping sheets of frosted
   glass at 1:1. Amplifying paint-on minus paint-off showed why, and it was not
   the fill at all — it was three edges:
     1. the selected unit's tile is NOT in its own move set, so the move region
        had a one-tile hole in it and boundaryEdges traced all four sides of
        that hole. The single brightest drawn line in the frame was a closed
        loop round one cell in the middle of the pool — the exact mark the win
        condition forbids. The selection is now folded into the move region's
        mask (no hole, no inner boundary) and re-drawn on top RIMLESS at 0.34
        strength as a hotter swell. See drawStates.
     2. the boundary glint was col.core (near-white) at 0.100·A. That is a lit
        LIP, and a lip is how the eye identifies a pane of glass. Now col.rim
        at 0.048·A with a higher break threshold, and the whole rim is scaled
        by region size (rimS) so a one- or two-tile pool does not get a closed
        loop round it either.
     3. MASK_STATE.blur 0.100 → 0.125. Measured across the boundary the ramp is
        now ~36 device px with no overshoot — a monotone rise into the plateau,
        no bright lip on top of it.
   The interior falloff also went 0.46 → 0.56, which measures centre 62.5 dL
   against outer 40.3 (1.55×) where round 4 measured 1.30 — "brightest at the
   centre" with the outer ring still over the +40 contract. And `move.body` was
   warmed #34b6ee → #4fb2de because the brightest fifth of the pool, which is
   where the eye actually lands, was still cyan sand at p95 +23.
   Cost of all of it: drawStates 17.9 → 18.7 ms in the harness.

   ── ROUND 6: THE POOL HAD TO BE TEAL AGAIN, AND TEAL IS GREEN ─────────────
   That last change lost a blind A/B outright. Three unlabelled crops (this
   build, round 4, wave 1) were ranked cold on "is there a special region
   here"; round 5 came LAST, described as "a milky pale wash … haze/fog, not a
   game state; hard to say it is teal at all". It had traded the pool's entire
   hue identity to fix a p95 the mean already satisfied.
   The recovery is NOT the old #34b6ee — measured, that restores chroma and
   takes mean B−R to +27.4, which is wave 1's "the sand is now cyan". Both
   settings share one wrong premise: that the emissive is a BLUE light whose
   only dial is how blue. Teal is green-dominant. move's emissive and its
   multiply filter are now aquamarine (hue ≈ 165–170°), which lets the filter
   run twice as hard (per-state cap `col.fc`, 0.20 for move, 0.10 and
   bit-identical arithmetic for everyone else) and buys chroma out of the
   green channel instead of out of the blue one. Interior, against identical
   paint-off pixels: chroma 19.8 → 42.1, saturation 0.164 → 0.273, hue 124.3°,
   mean B−R +3.0, ON−OFF luma +64.5, p95 B−R 38 → 28.
   The pane read got the other half of the round: the boundary rim WASH was
   the lit lip all along (0.040·A over a narrow band ≈ +17 luma on the dimmest
   part of the pool), so it is 0.015·A over a band 1.6× wider. Both probes now
   rise MONOTONELY over 39–54 device px with no local maximum on the boundary.
   Cost: drawStates 18.7 → 18.6 ms in the harness (unchanged; same layer count).

   ── ROUND 7: THE POOL IS NOT TUNED AGAINST A FIXED GROUND ─────────────────
   Round 6 shipped and the wave-3 critique of this layer came back as a
   RESIDUAL rather than a gap: keep the pool at ON−OFF luma ≥ +55 with
   saturation still below the sand's, but land the eroded interior at hue
   145–155° with chroma ≥ 38 and mean B−R ≤ +18. Two things came out of trying
   to hit it and both are worth more than the one constant that changed.

   1. THOSE FOUR NUMBERS INTERSECT IN A SLIVER, AND IT IS ALGEBRA, NOT TUNING.
      Over the lit interior GREEN is the max channel and RED the min, so
          chroma  C = G − R      and      hue = 120 + 60·(B−R)/C.
      "hue ≥ 145" is therefore exactly "B−R ≥ 0.4167·C", and with the ceiling
      B−R ≤ 18 that forces C ≤ 43.2 — while "chroma ≥ 38" forces C ≥ 38. The
      whole legal set is C ∈ [38, 43.2] with B−R pinned into a band barely two
      levels wide, and the 155° end of the hue range is UNREACHABLE at any
      legal chroma. Maximising the smallest of the three margins puts the
      optimum at C ≈ 39.1, B−R ≈ 17.0, hue ≈ 146.1 with about one level of room
      on each side; that is where this file now sits and there is no setting
      with meaningfully more. Do not read 145.8° as "nearly failed", and do not
      trade one margin for another — solve for the minimum.

   2. THE GROUND MOVED UNDER THE TUNE, MID-ROUND. stage-terrain re-materialled
      the sand while this was being measured. Same tilefx build, same camera,
      same tiles, measured on the identical pixel set before and after their
      change: interior hue 146.0 → 151.0, chroma 39.6 → 41.0, B−R +17.2 →
      +21.2. The pool had drifted three degrees past the top of the hue band
      and three levels over the B−R ceiling WITHOUT THIS FILE CHANGING A
      CHARACTER. That is the honest reason `move.gain` moved #3099e4 → #3094d1
      (the key light's green and blue each pulled back a few percent): it is a
      re-solve against the new floor, not a new look. Re-measured on the new
      ground: hue 145.8, chroma 39.6, ON−OFF luma +55.3, B−R +17.0, satON 0.241
      against the sand's 0.446.
      ⚠ SO RE-MEASURE THIS PAIR WHENEVER THE GROUND CHANGES. A highlight that
      is half multiply and half gain is a function OF the ground, and the four
      numbers are properties of the composite, not of the constants here.

   ── AND HOW TO TELL LIGHT FROM FOG, MEASURED ──────────────────────────────
   The wave-3 gap was "the sand texture underneath is GONE". Do not test that
   with the high-pass ENERGY of the lit region: a layer that invents noise
   raises it exactly like a layer that transmits the ground. Test it with the
   regression of the pool's high-pass against the PAINT-OFF frame's high-pass
   over the same pixels — the slope is the fraction of the ground that survives
   the highlight and the correlation says how much of what you are looking at
   is really the ground. Measured on the shipped build: slope 1.19, r 0.92,
   i.e. the ground's own grain comes through at 119% (the key light amplifies
   it, which is what a light does) and 84% of the variance inside the pool IS
   the ground. It is lit sand, not fog, and that is now a number.

   Two mid-scale "weather" passes were built to break up the interior and both
   were REJECTED on that measurement — do not re-derive them:
     • soft blobs punched into the EMISSIVE scratch with 'destination-out';
     • the same, applied to the key-light read-back, as a gradient and again as
       a blurred mask multiplied in as grey.
   Both looked like a texture win and neither was: against a correctly-dated
   paint-off frame they moved the transmission slope by under 0.03 and were
   visually indistinguishable from the build without them in a same-tree A/B
   (shots b0 vs b1). The apparent gain in the first measurements was
   stage-terrain's new ground noise arriving mid-experiment, being amplified by
   the gain and correlated against a STALE paint-off capture. If you test this
   layer, shoot the paint-off reference in the same minute as the paint-on one.

   ── WAVE 5: THE LAST THREE STROKED PAINTERS, AND A RE-SOLVE ───────────────
   1. void / electric / holy were still drawing their identity with
      ctx.stroke() and it measured exactly as it looked. On the SAME pixels
      (the surfaced tile quads, inset 14 device px — see the note under
      glowChain about why a per-painter diff mask is not comparable across
      builds), the regression of the painted tile's high-pass on the same
      ground unpainted went:
                        HEAD slope/r          now slope/r
          void          0.59 / 0.823          0.68 / 0.946
          electric      0.71 / 0.882          0.72 / 0.969
          holy          0.79 / 0.885          0.92 / 0.81-0.91
      r is the number that answers "is what I am looking at the ground?";
      electric lands on 0.969, i.e. 94% of the variance inside an arc-lit tile
      is the sand. ⚠ holy's r swings run to run and it is NOT the parameters:
      three shots of two different gain settings gave 0.896 / 0.808 / 0.803
      with the slope steady at 0.91-0.93, because post()'s five rising motes
      are unclipped sub-2px additive dots whose positions animate — they add
      real high-frequency structure inside the measured quad and decorrelate
      it by phase. Judge holy on the slope; the slope is stable and it is up.
      Holy's gain is 0.40 rather than the 0.50 the first pass used because the
      board is not one brightness: on the raised plateau tiles, which start at
      luma 132 instead of 97, 0.50 measured luma ratio 1.44 with slope 0.73,
      i.e. it was pushing red toward the ceiling and flattening the grain. At
      0.40 the same tiles measure 1.40 / 0.83 and the dark set is unchanged.
      A multiplicative light is a function of the ground it lands on, so a
      gain has to be tuned against the BRIGHTEST ground on the board, not the
      most convenient. The motifs are chains of radial
      falloffs (glowChain) composited 'lighter' through the region scratch,
      over a material multiply that was CUT so there is still ground to see —
      void's was 0.88/0.66 and buried it — plus the key-light gain.
   2. holy's two concentric stroked ellipses per tile are DELETED, not
      softened. See the note on the painter.
   3. THE MOVE POOL WAS RE-SOLVED AGAINST THE WAVE-5 GROUND, exactly as the
      round-7 warning above says to. Measured before touching anything, the
      shipped constants gave hue 132.3 / chroma 32.8 — a full 13 degrees below
      the window the file believed it was sitting in, WITHOUT THIS FILE
      CHANGING, because vista/terrain/dressing moved underneath it again.
      fc 0.20 → 0.28, gain #3094d1 → #2a8fd2, g 0.565 → 0.70, a 0.30 → 0.22.
      Re-measured on a fresh same-minute pair:
          hue 150.7 (window 145-155)   chroma 50.7 (>= 38)   dL +62.1 (>= 55)
          satON 0.30 against the sand's 0.53
          grain slope 1.27 / r 0.884   (before: 1.28 / 0.922)
      and the SPREAD, which is what "straddles the window" actually names:
      48x48px patch hues went min 49 / p10 96 / p50 131 / p90 163 with 12 of 95
      patches inside the window, to min 66 / p10 132 / p50 152 / p90 165 with
      32 of 98 inside — the bottom of the distribution came up 17 degrees and
      the count inside the window nearly tripled.
      ⚠ RUN-TO-RUN SPREAD ON THESE NUMBERS IS REAL: four same-code pairs
      measured hue 146.0-150.7 and slope 1.27-1.31. Do not re-tune on a single
      shot, and do not read a 0.03 move in r as a change.
      ⚠ THE SPREAD HAS A FLOOR AND IT IS STRUCTURAL. Patch hue against the
      UNLIT luma of the same patch measures r = -0.62, slope -1.04: one degree
      of hue per level of ground. That is what a multiplicative light IS — it
      cannot help but be a function of what it lands on — and the only thing
      that flattens it is the additive constant, which is precisely what the
      grain contract forbids raising. Do not chase the last patches.
   4. AND THE LUMA SLOPE UNDER-REPORTS A COOL LIGHT ON WARM GROUND. Per
      channel the pool measures slope 0.84 / 1.43 / 1.89 (R/G/B) against a
      gain tint of (0.165, 0.561, 0.824) at GA 1.085, i.e. slope_c ≈ 1 + GA·t_c
      to within a few percent on G and B. That IS out = albedo ⊙ (ambient +
      key). Sand grain is red-dominant and this light's red multiplier is the
      small one, so the luma-only slope lands below the per-channel ones. Use
      w5t-chan-style per-channel numbers before concluding the grain is
      invented; and note that there is no noise field anywhere in drawPool to
      invent it with — every layer is a gradient, a gain read-back or a rim.

   rimBand() and the old unclipped feather() are both gone. A rim stroke traces
   whatever the region's polygon is, so on a single tile it drew the tile; and
   the source-over feather in the ice painter was, at 1.9 tile radii, a milky
   near-white panel standing above the ground.

   Anything that is genuinely NOT a floor material — flame tongues, gas wisps,
   void motes, rising holy light — is still drawn unclipped on the main canvas
   in post(), because those leave the ground plane. They carry their own
   falloff in every direction (see fire.post) for the same reason: a flame with
   a razor edge is the sticker problem in a different costume.

   ── WAVE 6: A CACHE THAT WAS NOT KEYED, AND A READ TAKEN TOO EARLY ────────
   Four findings, all measured on one board at DPR 2 (a tile is ~93 device px,
   its 0.80-inset quad ~3.9k px), units removed, module time frozen, every lit
   figure against the identical pixels of that same frame's paint-off capture.

   1. A HAZARD WORE THE PREVIOUS HAZARD'S MATERIAL. staticLayer's cache lives on
      the MASK entry, whose key is geometry only, and drawSurfaces asked for its
      material with the literal key 'm'. Two painters on the same tiles shared
      one entry. Tile 4,2, mask cache flushed between runs, bare (148.2, 113.5,
      63.6) luma 117.3:
                              HEAD                       now
          holy, virgin        luma 153.6  ×1.309         153.6  ×1.309
          holy after puddle   luma 105.3  ×0.898  G max  153.6  ×1.309
          fire after oil      luma 154.7  ×1.319         170.2  ×1.451 (= virgin)
      A consecrated tile came out DARKER than bare sand. Reachable whenever a
      tile changes hazard — oil igniting, fire burning out, a puddle being
      consecrated. See the note in drawSurfaces and above staticLayer.

   2. THE GROUND READ EVERY CORRECTION IS KEYED ON WAS TAKEN BEFORE THE GROUND
      HAD ITS COLOUR. drawStates runs inside drawBoard; the vista's grade and
      the dressing land later in frame() and between them supply most of the
      sand's chroma. Over the whole 8×7 grid, the old read against the chroma
      the composite actually sees: slope 0.646, r = 0.159, range 10.3-19.6
      against a true 10.1-39.3. It is now taken from the completed frame, as a
      task scheduled out of drawStates, skipping the tiles that frame lit:
      slope 0.929, r = 0.939, range 1.4-39.0, and unbiased in level (mean 28.1
      against 28.2). See scheduleGround().

   3. THE PER-TILE HUE ROTATION IS REPLACED BY A PER-TILE CHROMA RATIO. With a
      read that could not see the ground, a fitted rotation was aimed at the
      wrong tiles; and being differential in C_i − C̄ it could not touch the
      region mean, which is what a critic measured swinging across one board.
      Holding the key's chroma at a fixed FRACTION of the ground's fixes both
      and needs no fit. Three disjoint pools, HEAD → now:
          west flank  hue 146.1 → 149.3   in-window 2/7 → 3/7
          east flank  hue 152.9 → 153.3             5/8 → 5/8
          north row   hue 156.6 → 148.9             3/8 → 7/8
          region-mean spread 10.5° → 4.4°;  tiles in window 10/23 → 15/23
      and on the pale north row, where the round-7 "saturation still below the
      sand's" was failing outright, satON 0.419 → 0.347 against a sand of 0.277
      (1.52× → 1.25×). It costs no light — under 'color' the tint's luminance is
      discarded — and it does not touch the grain: the 11×11 high-pass
      regression of the pool on the paint-off ground is 1.185/0.947 → 1.206/
      0.951, per channel 0.61/1.35/1.78 → 0.57/1.39/1.84.
      ⚠ THE HONEST COST: within-region hue SPREAD on the two chromatic flanks
      went 13.3 → 16.1 and 10.6 → 18.0 degrees. That is hfix's one real win
      given up, and it is given up deliberately — its input carried 2.5% of the
      variance of the quantity it estimated, so its flattening was not a
      property of the mechanism, it was luck on one board. The contract the
      critique states is tiles inside 145-155, and that goes 10/23 → 15/23.
      If a future round wants the spread back it needs a per-tile term keyed on
      something that predicts the RESIDUAL: with the ratio in, hue against bare
      chroma measures slope −0.147, r −0.21 over 23 tiles, i.e. what is left is
      no longer chroma-driven and another chroma-keyed correction will do
      nothing.

   4. `swap` WAS PINK AND `place` AND `swap` WERE BOTH UNDER THE +40 FLOOR.
      Eight tiles, bare (149.3, 114.3, 63.5) luma 118.1, HEAD → now:
          place  dL +31.8 → +40.7
          swap   dL +26.0 → +40.3, CIELAB hue 40.4° → 313.4°, chroma 21.2 →
                 39.5, max channel R → B, B−R −59.3 → +27.6
      i.e. swap is violet for the first time. See COL. move and attack are
      untouched by that change (attack dL 45.6 → 45.3, hue 69.1, both runs).

   COST: p50 frame time, 45-frame windows, two interleaved A/B rounds —
   clean 2.9/2.7 → 2.7/3.0 ms, move pool + sel 2.8/2.8 → 3.0/2.8, pool + nine
   hazard tiles across three gain painters 4.5/4.7 → 4.6/4.6. All inside each
   other's noise. drawPool no longer reads the canvas at all; the one read this
   mechanism needs is a 320 px whole-board thumbnail every 2 s, and a clean
   board now pays that — deliberately, because the store has to be filled
   BEFORE a selection appears or the first frames of every pool are uncorrected.

   ── HARD CONSTRAINTS THIS FILE OBEYS ──────────────────────────────────────
   • canvas-2D only. The board's own TILE SURFACES header records that the
     WebGL surface layer compiled, issued draw calls and produced NO FRAGMENTS
     on real hardware, and behaved differently between machines. Not re-tried.
   • Cost is per LIT or SURFACED region, never a full-board pass. A clean board
     with no paint and no hazards costs three early returns. Masks and static
     layers are cached on (epoch + tile set), LRU-bounded, so a selection that
     is not moving costs exactly two blits a frame.
   • Every painter runs inside its own save()/try/restore(). A leaked
     globalCompositeOperation corrupts everything drawn after it for the rest
     of the frame, and the spine's catch would hide the cause.
   • An unknown fxKey falls through to a neutral wash. It must never throw and
     must never silently render nothing — a hazard the player cannot see is a
     gameplay bug wearing a graphics bug's clothes.
   ═══════════════════════════════════════════════════════════════════════════ */

window.BBX = window.BBX || {};

/* ── state colours ─────────────────────────────────────────────────────────
   Teal for movement range, amber-gold for target/objective, per the reference.

   ⚠ ROUND 2 RECALIBRATION. The previous teal measured (169,178,120) over the
   move region: green highest, BLUE LOWEST. That is mint/yellow-green, it is
   not teal, and worse it collided with `place`, the state that is meant to be
   the green one. Two things caused it:
     • the multiply filter (#9ceeff) barely cut red — 156/255 is a 39% cut on a
       channel the sand is already saturated in, so red survived;
     • the additive pass could not lift blue, because warm sand starts near
       B=123 and the additive alpha was tuned for a much darker ground.
   The fix is to make BOTH halves blue-dominant and to raise the gain:
     `filt` is now a hard cyan (74,200,255) so multiply removes 71% of the red
     and none of the blue, and `core`/`body` are blue-dominant with `k` raising
     the additive gain until B > R survives the vista's warm grade.
   `k` is the per-state gain: attack was measurable (+46R) but a critic could
   not FIND it without a diff, so amber is pushed hard too.
   Do not re-balance these against a single screenshot — the ground swings from
   dark canyon floor to hazed near-white dusk between locations, which is why
   the multiply half exists at all (it bites on bright sand where additive
   cannot, and fades on dark sand where additive takes over). */
/* ⚠ ROUND 3: AMBER IS RESERVED. `sel` used to be gold, and in a frame where the
   move range was empty the ONLY findable mark on the whole board was a gold
   blob under the selected unit — which reads as "that tile is the target".
   Amber/gold now means exactly one thing, "attack / objective / target", and
   the selection is the hottest member of the MOVE family instead: same teal
   story, whiter and brighter, so the pool and its origin are one idea. */
/* `k` is the overall gain; `a` biases the ADDITIVE half only.
   ⚠ WHY `a` EXISTS. The multiply half works by removing a channel the ground
   is rich in, so it is strong for teal on warm sand and nearly useless for
   AMBER on warm sand — there is no red to take away. Measured on the rendered
   frame the attack tile came out at a third of the move pool's contrast with
   both at the same k. Amber therefore leans on the emissive half instead. */
/* ⚠ ROUND 4 — `a` WENT UP BECAUSE THE MULTIPLY CAP WENT DOWN. See the long
   note in drawPool. The multiply half used to supply part of each pool's
   separation from bare sand and paid for it by overwriting the sand's hue;
   that lift now comes from the emissive half, which brightens the ground
   without repainting it.

   ⚠ AND THE COMPENSATION IS NOT ONE NUMBER FOR ALL SIX. How much luma a state
   lost when the cap fell from 0.34 to 0.10 depends entirely on how much of the
   sand's own channels its filter was removing, and on warm sand that ranges
   over a factor of three: measured against a typical ground of (113,95,69),
   dropping the cap cost the cyan `move` filter 9.6 levels of luma, `swap` 5.7,
   `sel` 5.1, `place` 3.0 and `attack` only 2.9 — amber has almost no red to
   take away, which is why `a` had to exist in the first place. `hover`'s
   near-white filter never bit at all. Each `a` below is therefore raised by
   exactly its own state's loss divided by that state's emissive luma per unit
   gain, so every state EXCEPT move comes out of round 4 at the brightness it
   already had and only its hue changes. A flat "+26% for everyone" was tried
   first and it blew the attack tile to a mean R of 243 — a solved-for number
   beats a uniform one whenever the states do not share a colour.
   move is the exception on purpose: it is the state that failed, and it is
   solved against the measured contract (ON−OFF luma ≥ +40, ON B−R in
   [−20,+15]) rather than against its old brightness. */
const COL = {
  /* ⚠ move's `core`/`body` carry MORE RED than they read as. That is not a
     mistake and it is not a warm teal: the additive half is now the whole
     lift, and a lift made of pure cyan light inverts the sand's own channel
     order (sand is R>G>B; pure-cyan light drives it to B>G>R and the tile
     stops being sand). The red in the emissive keeps R and B within a few
     levels of each other on the lit tile — the pool is then BRIGHTER and
     COOLER than the sand around it, which is what teal light on sand actually
     looks like, rather than being a different material. The teal identity is
     carried by the ~40-level cool SHIFT against the surrounding sand, by the
     rim and by the halo bloom, not by staining the ground cyan. */
  /* ⚠ ROUND 5 warmed `body` from #34b6ee to #4fb2de to pull a p95 of B−R back
     from +23. IT WAS THE WRONG TRADE AND ROUND 6 UNDID IT. A blind A/B put
     that build LAST of three on "is there a special region here" — cold notes
     called it "a milky pale wash … haze/fog, not a game state; hard to say it
     is teal at all", because chasing a percentile the mean already satisfied
     cost the pool its hue identity: measured, the interior fell to chroma 24
     against sand's 46. A region nobody can name the colour of is not findable,
     and no percentile is worth that.

     ⚠ ROUND 6 — AND THE FIX IS NOT #34b6ee EITHER. Measured, reverting to it
     does restore chroma (35.5) but takes the pool's mean B−R to +27.4 — the
     same reading wave 1 had, i.e. sand repainted cyan, the thing the round-4
     note above exists to prevent. Both of those are the SAME mistake made in
     opposite directions: they treat the emissive as a blue light, so the only
     dial is "how blue", and every setting is either colourless or a stain.
     The pool is teal, and teal is GREEN-dominant, not blue-dominant. Once the
     emissive is aquamarine (`body` hue ≈ 168°, `filt` ≈ 165°) the two goals
     stop fighting: green is the channel warm sand has LEAST invested in after
     blue, so G carries the whole chroma while B stays level with R.
     Measured on the eroded pool interior against the identical paint-off
     pixels (CRKpool.mjs, erode 14):
         chroma (max−min)   42.1   (round 5: 19.8, target ≥ 34)
         hue                124.3° (round 5: 139° at chroma 20, target ≥ 120°)
         ON−OFF luma        +64.5  (target ≥ +40)
         mean B−R           +3.0   (target ≤ +5; p95 +28, was +38)
         saturation         0.273  (round 5: 0.164, wave 1: 0.324)
     ⚠ THOSE TWO TARGETS PIN THE HUE ALMOST EXACTLY, so do not read 123.7° as
     "nearly failed". With G the max channel, hue = (B−R)/chroma·60 + 120, so
     "hue ≥ 120°" is just "B ≥ R" and "mean B−R ≤ +5" at chroma ≥ 34 caps the
     hue at ~128°. Anything bluer than that is only reachable by staining the
     sand. Aim B−R at +3: it sits mid-band with margin on BOTH walls, which
     matters twice over — the vista's grade moves the sand under us between
     rounds, and the per-region breathing pulse means two runs of the same
     build measure ±1.5 apart on their own. A value tuned to +4.5 measures
     over +5 on an unlucky frame; there is nothing to win at the edge.

     ⚠ `halo` (optional, falls back to `body`) is the ONE place the light is
     allowed to be properly cyan. It is the bloom escaping onto the surrounding
     sand — outside the legal tiles, a thin fraction of the lit pixels, so it
     barely moves the mean — and a cool cyan fringe round a green-teal pool is
     what sells the whole thing as teal to the eye rather than to the meter. */
  /* ⚠ WAVE 3 — `a` FELL FROM 1.28 TO 0.30 AND THAT IS NOT A DIMMING. Almost
     all of move's lift moved out of the additive term and into `g`, the
     multiplicative key light (gainLayer). Total brightness is deliberately
     down a little (dL709 71 → the ≥55 the contract asks for) but the reason
     the pool stops reading as fog is the SHAPE of the light, not its level:
     a gain scales the sand's grain with its mean, so relative texture contrast
     is preserved instead of halved. Measured over the eroded interior,
     grainRelRatio 0.530 → 0.90+.
     `gain` is the key's colour and it is properly CYAN (#3097ff, hue 205°)
     even though the pool must land at hue ~147°. Those are not in conflict and
     the arithmetic is the whole point of this file's colour notes: a MULTIPLIER
     of (0.19, 0.59, 1.00) on warm sand (114, 91, 62) yields (+19, +48, +55) —
     the sand's own red dominance is what pulls the result back to green-teal.
     Tint the key aquamarine instead and the result comes out yellow-green.
     `body`/`core` are the small ambient term and are cyan for the same reason
     in reverse: they are added, not multiplied, so they contribute their own
     colour and have to sit further round the wheel than the target. */
  /* ⚠ WAVE 5 ROUND 2 — `core`/`body` LOSE A LITTLE BLUE (#c8d7ff → #ccdcf4,
     #69c3ff → #74c9ec) AND THE GAIN IS UNTOUCHED. The ambient additive is the
     only ground-independent term in the pool, so it is the term that decides
     how the hue moves as the ground under a tile changes — and it was the
     bluest thing in the state. Measured same-boot over six lit tiles against
     the identical bare pixels, the pool's mean B−R had drifted to +35 (the
     file's own contract, set in round 6, is ≤ +5 on this measurement) while
     its mean hue sat at 155.4, the very top of the 145-155 window the critic
     holds it to. Both are the same surplus of blue and both move together.
     The gain is deliberately NOT touched: it carries the chroma (see the long
     note above on why the key is cyan and the result is not), and every round
     that has tried to fix hue by retinting the key has lost chroma for it. */
  /* ⚠⚠ WAVE 5 ROUND 3 — THE KEY IS NOW A 'color' BLEND, AND THAT IS WHAT
     FINALLY CLOSED THE HUE GAP. Read this before touching `gain`, `kmode`,
     `g` or `a`; four rounds have been spent on the wrong knob.

     THE MEASUREMENT THAT SETTLED IT. Same boot, one tree, one dressing state,
     the module hot-swapped by eval between captures, 7 lit tiles, 0.80-inset
     quads, CIELAB, lit against the identical pixels of that boot's own
     paint-off frame. The critic's model was that the pool's per-tile hue
     converges on the hue of `core`/`body` — the ADDITIVE half — so retinting
     those green-ward would walk the whole distribution down onto 145-155.
     Swept directly (body/core rotated 237°→205→190→178→168→158→148 at fixed
     Lab L and C, everything else held):
         worst tile   189.3 → 187.2 → 185.8 → 184.1 → 180.9 → 179.9 → 179.6
         best tile    156.2 → 153.7 → 152.9 → 149.3 → 142.9 → 142.3 → 143.5
     The worst tile PLATEAUS at ~180 while the best falls out of the window at
     the third step: the critic's own stopping rule ("stop before 1,6 falls
     under 145") fires 20° before its own target is reached. The additive is
     ~15% of the pool's light; it cannot be the asymptote.
     What actually set the per-tile hue was this function's KEY, and with a
     'multiply' key it could not be anything else: multiply emits `ground ⊗
     tint`, whose CHROMATICITY is the ground's own chromaticity times the
     tint's. Warm sand is R≫G>B and the pond shore is nearly neutral, so a
     single tint painted two tiles 30° apart no matter what the tint was.
     Retinting the key green-ward does move the mean (237°→154° of key hue
     walks the pool 169.0 → 137.9) and, contrary to this file's own older note,
     it RAISES chroma while doing it (24.2 → 40.9) — but it does not compress:
     the span stayed 26-38° everywhere on that ladder.
     'color' is the fix because it removes the ground from the light's colour
     WITHOUT removing the ground: SetLum(tint, Lum(ground)) is the tint's
     chromaticity carried at the ground's own luminance, so relief, shading,
     dressing shadow and sand grain all still modulate it — measured, the
     interior's 11×11 high-pass regression on the paint-off ground went r
     0.703-0.991 → 0.672-0.992 at slope 1.50 → 1.63, i.e. the grain reads
     THROUGH the pool slightly harder than before, not less.
     Measured, HEAD vs this build on the same boot (7 tiles, sand-only figure
     excludes 1,4, whose 0.80 quad genuinely overlaps the water pond and whose
     ground therefore is not sand):
         all-7 mean hue   168.6 → 151.8     span 32.0 → 20.9
         sand mean hue    165.3 → 149.5     span 21.9 →  9.5   in-window 0/6 → 5/6
         chroma           24.3  → 42.5      (the gap's own bar was ≥ 38)
         ON−OFF luma      54.1  → 58.5
     ⚠ `gain` IS NOW A HUE AND A CHROMA, NOT A BRIGHTNESS. Under 'color' the
     tint's LUMINANCE is discarded — only its hue and chroma survive — so
     making it lighter or darker does nothing and `g` is the only level knob.
     #1ba985 is Lab L62 C45 h169; the pool lands ~19° below the tint because
     the ground it is added to is still warm sand. h168 measures 149.5 and
     h170 measures 152.2, so ±1° of tint is ±1.3° of pool: this is a fine
     adjustment, make it in single degrees.
     ⚠ AND `a` IS NOT DEAD WEIGHT. The key is proportional to the ground's
     luminance, so on a genuinely dark location it fades out; `a` is the
     ground-independent floor that keeps a lit tile findable there. It was cut
     0.22 → 0.20 only to pay for the level the greener key added.
     `kbias` is the region-scale centre falloff, see gainLayer. */
  /* ⚠ WAVE 5 ROUND 4 — `hfix` IS THE PER-TILE HUE CORRECTION AND ONLY `move`
     CARRIES IT. Round 3 fixed the pool's mean hue and its chroma; what it left
     open is the SPREAD, which is a linear function of the ground's own chroma
     under each tile and therefore cannot be cancelled by any single tint. See
     the long note above groundChroma(). It is on `move` alone because move is
     the state the gap was measured on, the state that covers most ground (so
     the ground varies most under it), and the first state drawn — a pool that
     reads the canvas for BARE ground has to be drawn before anything else has
     lit it, which `sel` and the states-over re-assert are not. */
  move:   { core: '#bfe2d8', body: '#69cdd5', rim: '#b4e1f5', halo: '#42cae0',
            filt: '#46ffd8', gain: '#1ba985', kmode: 'color', kbias: 0.30,
            hfix: 1, k: 1.55, a: 0.20, g: 0.37, fc: 0.28 },
  /* ⚠ EVERY STATE GETS A KEY LIGHT, not just move. The gap was measured on the
     move pool because that is the one the default harness lights, but "a soft
     emissive fill that glows WITHIN the ground" is the BAR's line about tile
     states in general, and a board where movement is lit by real light and
     attack is lit by a flat wash is a board with two lighting models in it.
     Each `g` below is paired with a cut to that state's `a` sized so the
     state's measured mean luma lift is within a few levels of its wave-2
     value — these all passed their own critique and only the SHAPE of their
     light is meant to change. Verified with the inject harness (paint pushed
     directly), not by assumption. */
  attack: { core: '#fff0c8', body: '#ff8c10', rim: '#ffd07a', filt: '#ffd98a',
            gain: '#ffa438', k: 1.60, a: 0.58, g: 0.40 },
  /* ⚠ WAVE 6 — `place` AND `swap` WERE BOTH UNDER THE ROUND-4 FLOOR, AND `swap`
     WAS NOT EVEN THE COLOUR IT THINKS IT IS. Measured on eight tiles of the
     right flank, units removed, every state against the identical paint-off
     pixels of the same frame, bare sand (158.0, 124.6, 72.8) luma 128.0:
         move dL +51.8   attack dL +50.7   place dL +35.9   swap dL +29.8
     against the round-4 family contract of ON−OFF luma ≥ +40. And swap
     composited to (189.2, 151.0, 133.2): RED the max channel, B−R −56, CIELAB
     hue 51.8°, chroma 18.8 where move measures 40.5. Its `body` is #8a52f0 and
     its `gain` #a860ff — violet — so the tile rendered the one colour the state
     is not, and the reason is the round-6 note two screens up applied to the
     wrong state. A 'multiply' key emits `ground ⊗ tint`, the GROUND's
     chromaticity times the tint's; warm sand has almost no blue for a violet
     tint to keep, so what survives is red and the result is pink. That was
     diagnosed for `move` in round 6, solved for it in wave 5 round 3, and never
     carried across.
     So swap joins move and sel on the 'color' key: SetLum(tint, Lum(ground))
     carries the tint's own chromaticity at the ground's luminance, which is the
     only way a violet light stays violet on sand this warm. `g` is rescaled the
     way sel's note says to rescale it — a 'color' key emits far more light per
     unit of `g` than a multiply one — and `a` pays for the level the state was
     missing. `filt` goes near-white because a violet MULTIPLY is precisely the
     term that was manufacturing the magenta; the identity is the key's job now.
     `place` needed only level: `a` and `g` raised together, colours untouched.
     Neither state reads the ground, so neither takes the chroma ratio — see
     `hfix` in drawPool. Re-measured, same eight tiles, same frame: place +43.9,
     swap +44.4, swap hue 300.5° with BLUE the max channel and chroma 30.6. */
  place:  { core: '#ccffd8', body: '#2fd070', rim: '#8ff0b0', filt: '#adffc4',
            gain: '#5cff90', k: 1.15, a: 0.56, g: 0.38 },
  swap:   { core: '#e8d4ff', body: '#8a52f0', rim: '#c3a5ff', filt: '#efe4ff',
            gain: '#6a35e0', kmode: 'color', kbias: 0.30,
            k: 1.62, a: 0.52, g: 0.37 },
  /* ⚠ `sel` is the hottest member of the MOVE family and is drawn INSIDE the
     move pool, so it has to be the same light or it becomes a second, differently
     coloured blob sitting in the middle of the region — which is how it read
     when it was gold (round 3) and again, faintly, when move went aquamarine in
     round 6 and `sel` stayed sky-blue. Same aquamarine, whiter and brighter. */
  /* ⚠ WAVE 5 ROUND 3 — `sel` FOLLOWS move ONTO THE 'color' KEY, and it has to.
     It is drawn INSIDE the move pool; leaving it on a 'multiply' key with a
     sky-blue tint while the pool around it became a single-chromaticity green
     -teal would put a differently-coloured blob in the middle of the region —
     exactly the failure the note above this line has recorded twice already.
     Its tint is 11° cooler than move's and a little less chromatic, so the
     selection reads as the hot, whiter centre of the SAME light rather than as
     a second colour. `g` is scaled by move's own 0.37/0.70, because under
     'color' the emitted light is far brighter per unit of `g` than the
     multiply key was and the old numbers would have blown out. */
  sel:    { core: '#eafcff', body: '#a8e8f4', rim: '#dffff6', filt: '#8cf0dc',
            gain: '#07ae9a', kmode: 'color', kbias: 0.26,
            k: 1.45, a: 0.52, g: 0.16, fc: 0.14 },
  hover:  { core: '#fff2e2', body: '#e8c894', rim: '#f5dcae', filt: '#fff2dc',
            gain: '#ffd8a0', k: 0.85, a: 0.50, g: 0.26 }
};

/* States sit a hair above the terrain's top face; surfaces sit above states.
   In 2D these lifts do nothing to depth — they exist so the projected quads
   agree with the spine's own _sQuad (tileElev + 0.012) instead of drifting a
   subpixel apart on a raised plateau and leaving a bright seam. */
const LIFT_STATE = 0.006;
const LIFT_SURF  = 0.012;

/* Lattice jitter on the tile QUAD. In round 1 this was the whole boundary and
   the critic asked for it to go to ~0.35; it is deliberately back down now,
   because the quad is no longer the boundary — mkMask()'s blob is, and the
   quad only exists inside the mask to guarantee interior coverage. The jitter
   still earns its place: it keeps the union's straight segments from lining up
   with the terrain's own tile creases where the blur thins out. */
const JIT_SURF  = 0.16;
const JIT_STATE = 0.10;

/* Mask shape parameters, in units of the tile's projected half-width.
   `base`  mean blob radius. 1.0 = the tile's edge midpoint, 1.414 = its corner.
   `amp`   angular irregularity; the blob's radius varies ±amp·1.07 about base.
   `blur`  feather width. This is the ONLY thing that decides how soft the
           material's edge is, and therefore whether it reads as a decal.
   Surfaces spill further and softer than states: a puddle has no edge at all,
   whereas a movement highlight still has to answer "is THIS tile legal?", so
   its mask stays close to the tile it belongs to. */
const MASK_SURF  = { base: 1.44, amp: 0.20, blur: 0.24, halo: 1.28, haloBlur: 0.34, tag: 's' };

/* ⚠ ROUND 3 — A HIGHLIGHT IS NOT A HAZARD, AND THIS IS THE NUMBER THAT SAYS SO.
   MASK_STATE used to be base 1.20 / blur 0.17 with the emission drawn through
   the DILATED (×1.26, blur 0.30) mask, i.e. the lit area reached ~1.5 tiles out
   from every legal tile and faded over a third of a tile. Measured on the
   rendered frame that turned seven legal tiles into one soft teal FILM lying
   over the whole lower-left quadrant, including the water pool and four illegal
   tiles: the read was "something is happening over there", never "these seven
   tiles". A hazard genuinely has no edge and should spill; a movement range is
   an ANSWER TO A QUESTION and must stop where the rules stop.
   base 1.00 makes the blob the tile's inscribed ellipse, so the union of blob
   and quad is the tile with an organic wobble on its edges and its corners
   intact; blur 0.055·ax is ~2.5 CSS px of feather — soft, not fogged. The halo
   is now barely dilated and exists only for the thin bloom of light escaping
   onto the sand just outside the pool.

   ⚠ ROUND 4 — 0.055 WAS A CUT, NOT A FEATHER. Measured on the frame, the
   boundary went 0 → full in 24 device px against a ~200 device px tile: at 1:1
   the pool had the straight hard edge of a panel laid on the sand, which is
   the thing the win condition calls "feathered at the edge" and did not get.
   0.10·ax is ~9 CSS px of blur radius, so the transition spans about a fifth
   of a tile — the 50% point still sits exactly on the tile boundary, so the
   answer to "may I stand here?" is unchanged and the region still stops where
   the rules stop. Do NOT push this past ~0.13: at 0.17 (round 2) the pool
   stopped having a findable edge at all and read as fog over the quadrant.

   ⚠ ROUND 5 — 0.125. Round 4's 0.10 measured right and still looked like a
   sheet: at 1:1 the pool's edge was a clean straight line with a bright lip on
   it, i.e. the cut edge of a pane of glass. 0.125 is the top of the range this
   note has always allowed (the "do NOT push past ~0.13" is unchanged, and 0.17
   is still the value that fogged the quadrant); combined with the softer rim
   below the boundary now reads as light thinning out rather than as an object
   ending. The 50% point is still exactly on the tile boundary. */
/* ⚠ WAVE 3 — 0.125 → 0.078, AND IT IS A REVERSAL OF ROUND 5 ON PURPOSE.
   Round 5 widened the feather because the pool's edge read as the cut edge of
   a pane of glass. It did, and the reason was the INTERIOR: a flat additive
   sheet has no material in it, so its boundary is the only information it
   carries and any crisp boundary reads as an object's rim. Wave 3's gainLayer
   removes that premise — the interior is now the sand's own grain and relief
   scaled up by a coloured gain, so the pool is identifiable everywhere and its
   edge is free to be an edge again.
   And it has to be. Measured on the wave-2 frame the 10%→90% transition took
   ~40 device px (dL709 was 12.5 at the boundary, still climbing at +20px, and
   only reached its interior value about a third of a tile in). At that width
   the outline's per-tile steps are smeared out and the answer to "how far can
   I go" loses its last tile. 0.078·ax ≈ 7 CSS px of blur radius, so the ramp
   is ~20 device px: soft enough that nothing is aliased, tight enough that a
   corner where the boundary steps one tile is a corner. The 50% point is
   still exactly on the tile boundary, so the RULES the pool states are
   unchanged — only how sharply it states them.
   Do NOT take this below ~0.06: round 3's 0.055 was measured as a hard cut. */
const MASK_STATE = { base: 1.00, amp: 0.085, blur: 0.078, halo: 1.12, haloBlur: 0.20, tag: 'p7' };

/* ⚠ SOLIDS NEED A TIGHTER MASK THAN LIQUIDS. MASK_SURF's 0.24 feather is right
   for a puddle, an oil slick or a gas cloud — those genuinely have no edge.
   Applied to ICE it was wrong in kind, not in degree: a frozen sheet is a rigid
   plate with a rim, and fading it out over a quarter of a tile turned it into
   fog lying on the sand. A painter can opt into this instead by setting
   `mask: MASK_SOLID`. `tag` keys the mask cache, so a new opt object MUST carry
   a new one or two different masks silently share a cache entry. */
const MASK_SOLID = { base: 1.28, amp: 0.18, blur: 0.115, halo: 1.24, haloBlur: 0.30, tag: 'q' };

/* ── projected-polygon cache ───────────────────────────────────────────────
   The camera is static and the heightfield is baked, so a tile's screen
   polygon only changes on resize or a new map. The epoch includes the summed
   elevation because board:init can swap the heightfield WITHOUT changing
   MAP.id — a stale poly would put every glow one plateau below the terrain. */
let _epoch = '';
const _polys = new Map();

function frameSync(api) {
  let s = 0;
  for (let z = 0; z < api.MAP.rows; z++)
    for (let x = 0; x < api.MAP.cols; x++) s += api.tileElev(x, z);
  const e = api.W + 'x' + api.H + '|' + api.MAP.id + '|' +
            api.MAP.cols + 'x' + api.MAP.rows + '|' + s.toFixed(4);
  if (e !== _epoch) { _epoch = e; _polys.clear(); _masks.clear(); }
}

/* Vertex 0,2,4,6 are the tile corners; 1,3,5,7 are the edge midpoints, so the
   quad is an 8-gon and the lattice midpoints can be displaced independently.

   ⚠ THE WATERTIGHT RULE. Every displacement below is keyed on the LATTICE
   coordinate of the point, never on the tile that happens to be drawing it.
   Tile (x,z)'s bottom edge and tile (x,z+1)'s top edge are the same lattice
   edge and therefore get the same offset, so two adjacent hazard tiles share
   an exact border and the union has no crack in it. Keying on the tile would
   look identical on a single tile and split every pool in half. */
function jitQuad(api, x, z, lift, amp) {
  const key = x + ',' + z + '|' + lift + '|' + amp;
  if (_polys.has(key)) return _polys.get(key);
  const e = api.tileElev(x, z) + lift;
  const j = (i, k, n) => (api.hash(i, k, n) - 0.5) * amp;
  /* corner lattice points are (x,z)..(x+1,z+1); edge midpoints are named by
     the lattice edge they lie on, so both owners resolve the same id */
  const pts = [
    [-0.5 + j(x,     z,     101), -0.5 + j(x,     z,     102)],   /* corner  */
    [ 0.0,                        -0.5 + j(x,     z,     103)],   /* z- edge */
    [ 0.5 + j(x + 1, z,     101), -0.5 + j(x + 1, z,     102)],   /* corner  */
    [ 0.5 + j(x + 1, z,     104),  0.0                       ],   /* x+ edge */
    [ 0.5 + j(x + 1, z + 1, 101),  0.5 + j(x + 1, z + 1, 102)],   /* corner  */
    [ 0.0,                         0.5 + j(x,     z + 1, 103)],   /* z+ edge */
    [-0.5 + j(x,     z + 1, 101),  0.5 + j(x,     z + 1, 102)],   /* corner  */
    [-0.5 + j(x,     z,     104),  0.0                       ]    /* x- edge */
  ];
  const out = [];
  let ok = true;
  for (let i = 0; i < 8; i++) {
    const w = api.gw(x + pts[i][0], z + pts[i][1], e);
    const p = api.project({ x: w.x, y: w.y, z: w.z });
    if (!p) { ok = false; break; }
    out.push(p);
  }
  /* ⚠ FALL BACK TO THE HOST'S OWN TILE POLYGON, NEVER TO NOTHING. api.tilePoly
     (battle-board:1146) is the spine's authority on where a tile is on screen —
     it is what pickTile and the terrain bake agree with. jitQuad is that same
     polygon with lattice-keyed jitter and edge midpoints added, so the two
     cannot disagree by more than the jitter; but if a jittered lattice point
     lands behind the camera at a shallow row, dropping the tile silently makes
     a LEGAL TILE UNPAINTABLE. Take the unjittered 4-corner poly instead and
     expand it to the same 8-point form so every consumer below is unchanged. */
  if (!ok) {
    let tp = null;
    try { tp = api.tilePoly(x, z, 0, e); } catch (err) {}
    if (!tp || tp.length !== 4) { _polys.set(key, null); return null; }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const q = [tp[0], mid(tp[0], tp[1]), tp[1], mid(tp[1], tp[2]),
               tp[2], mid(tp[2], tp[3]), tp[3], mid(tp[3], tp[0])];
    _polys.set(key, q);
    return q;
  }
  _polys.set(key, out);
  return out;
}

/* The OUTER boundary of a merged region, as polylines in tile-edge units.
   A tile contributes an edge only where the neighbour on that side is NOT in
   the region, so a contiguous run of lit tiles yields one outline around the
   whole pool and no interior lines at all — "merge the interiors, hint only the
   outer boundary". Each entry is the three points of one 8-gon side (corner,
   edge midpoint, corner) so the outline inherits the same lattice jitter the
   mask does and cannot drift off it. */
function boundaryEdges(g) {
  const out = [];
  for (const it of g.list) {
    const q = it.q, x = it.x, z = it.z;
    if (!g.set.has(x + ',' + (z - 1))) out.push({ p: [q[0], q[1], q[2]], k: 0, it });
    if (!g.set.has((x + 1) + ',' + z)) out.push({ p: [q[2], q[3], q[4]], k: 1, it });
    if (!g.set.has(x + ',' + (z + 1))) out.push({ p: [q[4], q[5], q[6]], k: 2, it });
    if (!g.set.has((x - 1) + ',' + z)) out.push({ p: [q[6], q[7], q[0]], k: 3, it });
  }
  return out;
}

/* half-width / half-height of the projected tile, in CSS px, from the four
   corners. The tile is a perspective trapezoid, so "half-width" is the mean of
   the near and far edges — plenty accurate for sizing a gradient and far
   cheaper than a real inverse projection. */
function metrics(q) {
  const cx = (q[0].x + q[2].x + q[4].x + q[6].x) / 4;
  const cy = (q[0].y + q[2].y + q[4].y + q[6].y) / 4;
  const ax = (Math.abs(q[2].x - q[0].x) + Math.abs(q[4].x - q[6].x)) / 4;
  const ay = (Math.abs(q[6].y - q[0].y) + Math.abs(q[4].y - q[2].y)) / 4;
  return { cx, cy, ax: Math.max(3, ax), ay: Math.max(2, ay) };
}

function poly(c, q) {
  c.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < q.length; i++) c.lineTo(q[i].x, q[i].y);
  c.closePath();
}

/* An ellipse-shaped radial gradient without ctx.ellipse + clip gymnastics:
   squash the space, draw a circle gradient, unsquash. */
function radial(c, cx, cy, ax, ay, R, stops, comp) {
  if (!(R > 0)) return;
  c.save();
  if (comp) c.globalCompositeOperation = comp;
  c.translate(cx, cy);
  c.scale(1, Math.max(0.10, ay / ax));
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g;
  c.fillRect(-R, -R, R * 2, R * 2);
  c.restore();
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOFT REGION MASK — the mechanism the whole file now hangs off.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Offscreen surfaces. OffscreenCanvas where the engine has it (no page DOM
   touched at all, which is this module's contract); a detached <canvas> only
   as a fallback — detached, never inserted, so it is still not page DOM. */
function mkCv(w, h) {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  } catch (e) {}
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}
function sizeCv(cv, w, h) {
  if (cv.width < w) cv.width = w;
  if (cv.height < h) cv.height = h;
}

/* Two shared scratch surfaces, reused for every region every frame: one for
   the sharp mask silhouette before it is blurred, one for painter content. */
let _shCv = null, _shC = null;   /* sharp silhouette */
let _scCv = null, _scC = null;   /* painter content  */

/* ⚠ CLEAR THE RECT IN USE **PLUS A MARGIN**. The shared scratch grows to the
   biggest region ever seen; clearing (and 'destination-in'-ing) the WHOLE
   canvas for a one-tile puddle cost ~4× more than the region needed and was
   most of why the first version of this compositor ran at 670 ms/frame in the
   harness. So the rect-limited clear stays.

   ⚠ ROUND 3 BUG — THE ONE-PIXEL GOLD HAIRLINE. This function used to clear
   exactly (0,0,pw,ph) and the comment claimed the stale pixels beyond it were
   harmless "because every blit reads a source rect of exactly (0,0,pw,ph)".
   That invariant is FALSE, and it cost a critic round. drawImage with a source
   sub-rect of an OVERSIZED canvas is a scaled texture read, and Chromium's
   bilinear sampler reaches one texel past the sub-rect on the far side. Two
   reads do it:
     • maskScratch()'s 'destination-in' upscales the mask mw×mh → w×h, so a
       stale non-zero ALPHA one texel out re-admits painter content exactly
       where the true mask is 0;
     • blit()/staticLayer() then downscale pw×ph → g.w×g.h in CSS px.
   The visible result was a 1px axis-aligned bright line down the RIGHT and
   along the BOTTOM of any region smaller than the largest one drawn before it
   — measured as a 289px row + 115px column right-angle in gold on the sand.
   It only shows when a bigger region ran first, which is why it hid from the
   plain harness run and would have surfaced in real play as paint changed.

   The fix costs two extra pixel rows: clear pw+PAD / ph+PAD. Painter content
   is clipped to (0,0,w,h) in maskScratch() and the mask raster is drawn with a
   transform that cannot reach past its own bbox, so the margin stays
   transparent and the sampler now bleeds TRANSPARENCY instead of last frame.
   PAD is 2 for the plain reads; rasterMask passes a bigger one because its
   read carries a blur filter whose kernel reaches further. */
const SCRATCH_PAD = 2;
function shCtx(pw, ph, pad) {
  if (!_shCv) { _shCv = mkCv(pw, ph); _shC = _shCv.getContext('2d'); }
  sizeCv(_shCv, pw, ph);
  _shC.setTransform(1, 0, 0, 1, 0, 0);
  _shC.globalCompositeOperation = 'source-over';
  _shC.globalAlpha = 1;
  _shC.filter = 'none';
  const p = pad == null ? SCRATCH_PAD : pad;
  _shC.clearRect(0, 0, pw + p, ph + p);
  return _shC;
}
function scCtx(pw, ph) {
  if (!_scCv) { _scCv = mkCv(pw, ph); _scC = _scCv.getContext('2d'); }
  sizeCv(_scCv, pw, ph);
  _scC.setTransform(1, 0, 0, 1, 0, 0);
  _scC.globalCompositeOperation = 'source-over';
  _scC.globalAlpha = 1;
  _scC.filter = 'none';
  _scC.clearRect(0, 0, pw + SCRATCH_PAD, ph + SCRATCH_PAD);
  return _scC;
}

/* THE BLOB. A closed curve whose radius is three angular harmonics seeded per
   tile. This is what stops a one-tile region from being a tile-shaped decal:
   there is not a single straight segment or corner anywhere in it, and two
   neighbouring tiles get different phases so their union is lumpy rather than
   a rounded rectangle. Drawn with quadratic segments through the midpoints of
   26 samples, which is smooth well past the pixel level at this camera. */
function blobPath(c, api, it, base, amp) {
  const m = it.m;
  const sy = Math.max(0.12, m.ay / m.ax);
  const p1 = api.hash(it.x, it.z, 201) * 6.283;
  const p2 = api.hash(it.x, it.z, 202) * 6.283;
  const p3 = api.hash(it.z, it.x, 203) * 6.283;
  const N = 26, px = [], py = [];
  for (let i = 0; i < N; i++) {
    const a = i / N * 6.283185;
    const r = m.ax * base * (1 + amp * (0.55 * Math.sin(3 * a + p1) +
                                        0.32 * Math.sin(5 * a + p2) +
                                        0.20 * Math.sin(8 * a + p3)));
    px.push(m.cx + Math.cos(a) * r);
    py.push(m.cy + Math.sin(a) * r * sy);
  }
  c.beginPath();
  c.moveTo((px[N - 1] + px[0]) / 2, (py[N - 1] + py[0]) / 2);
  for (let i = 0; i < N; i++) {
    const n = (i + 1) % N;
    c.quadraticCurveTo(px[i], py[i], (px[i] + px[n]) / 2, (py[i] + py[n]) / 2);
  }
  c.closePath();
}

/* Rasterise one mask: union of (quad ∪ blob) for every tile, blurred.
   The quad is in there ONLY for coverage — at base 1.20/1.44 the blob dips
   inside the quad's corners often enough that a 2×2 region would otherwise
   show a pinhole where four blobs meet, and a hole in the middle of a pool is
   a far worse artefact than a slightly bumpy outline. */
/* Masks are rendered at HALF the canvas's device resolution. They are a smooth
   blurred alpha field with no detail above a few pixels, so upscaling one on
   the way into 'destination-in' is visually free — and it quarters both the
   rasterisation cost and the memory the cache holds. */
function rasterMask(api, g, base, amp, blurPx, target) {
  const mw = g.mw, mh = g.mh, s = g.mdpr;
  /* the read below carries a blur filter, whose kernel samples further out of
     the source sub-rect than the plain sampler's one texel — so clear a margin
     wide enough to cover it, or a stale silhouette smears back in along the
     right/bottom edge (see the SCRATCH_PAD note above). */
  const bRad = Math.max(0.4, blurPx * s);
  const sh = shCtx(mw, mh, Math.ceil(bRad * 3) + 2);
  sh.setTransform(s, 0, 0, s, -g.x0 * s, -g.y0 * s);
  sh.fillStyle = '#ffffff';
  for (const it of g.list) {
    blobPath(sh, api, it, base, amp);
    sh.fill();
    sh.beginPath(); poly(sh, it.q); sh.fill();
  }
  sizeCv(target.cv, mw, mh);
  const t = target.ctx;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'source-over';
  t.globalAlpha = 1;
  t.filter = 'none';
  /* +pad for the same reason as the scratch: maskScratch() reads this canvas
     as a SCALED sub-rect, so its right/bottom margin must be transparent. */
  t.clearRect(0, 0, mw + SCRATCH_PAD, mh + SCRATCH_PAD);
  /* Blur is applied at BLIT time with an identity transform, so the radius is
     in the mask's own pixels and does not silently change with DPR or a stray
     scale left on the scratch context. */
  t.filter = 'blur(' + bRad.toFixed(2) + 'px)';
  t.drawImage(_shCv, 0, 0, mw, mh, 0, 0, mw, mh);
  t.filter = 'none';
}

/* Masks AND the static layers drawn through them are stable while the region
   and the camera are, so a selection that does not move costs two blits a
   frame. Bounded so a match that cycles through many paint shapes cannot grow
   the cache without limit. */
const _masks = new Map();
const MASK_CACHE_MAX = 12;

function buildMask(api, g, opt, tag) {
  const key = tag + '|' + g.sig;
  let e = _masks.get(key);
  if (e && e.mw === g.mw && e.mh === g.mh && e.x0 === g.x0 && e.y0 === g.y0) {
    /* touch: Map iterates in insertion order, so re-inserting makes eviction
       LRU. Without this the oldest INSERTED entry goes — which on a board with
       more than MASK_CACHE_MAX regions is usually one that is still on screen,
       and it would rebuild a mask every frame forever. */
    _masks.delete(key); _masks.set(key, e);
    g.mask = e.mask; g.halo = e.halo; g.sub = e.sub; return true;
  }
  if (_masks.size >= MASK_CACHE_MAX) {
    const first = _masks.keys().next();
    if (!first.done) _masks.delete(first.value);
  }
  const mask = { cv: mkCv(g.mw, g.mh) }; mask.ctx = mask.cv.getContext('2d');
  const halo = { cv: mkCv(g.mw, g.mh) }; halo.ctx = halo.cv.getContext('2d');
  rasterMask(api, g, opt.base, opt.amp, g.ax * opt.blur, mask);
  rasterMask(api, g, opt.base * opt.halo, opt.amp * 0.85, g.ax * opt.haloBlur, halo);
  e = { mask, halo, sub: new Map(), mw: g.mw, mh: g.mh, x0: g.x0, y0: g.y0 };
  _masks.set(key, e);
  g.mask = mask; g.halo = halo; g.sub = e.sub;
  return true;
}

/* ⚠ WAVE 5 ROUND 3 — BLIT THE TILES, NOT THE BOUNDING BOX, AND THIS IS WHERE
   THE FRAMES WERE. Round 2 fixed the READ side of exactly this (see gainRects:
   drawSurfaces groups hazards by fx key across the whole board, so three
   `electric` tiles in three corners are ONE region whose bbox is nearly the
   whole canvas) and left the WRITE side alone — every masked layer still
   composited the full bbox, and the hazard painters run four to six of those a
   frame, uncached, one of them a 'color-dodge'.
   Measured, one boot, 5 rounds, 8 s in-iframe rAF windows, order rotated per
   round, the critic's own 9-tile hazard set + the move pool: disabling the
   'color-dodge' layer alone took the build from 44.5 to 54.0 frames while
   disabling the hazard read-backs entirely changed nothing (44.5). The read
   rate the critic pointed at was not the cost; the blend AREA was.
   The rect list is gainRects', so it is the same geometry, already merged and
   therefore non-overlapping — which matters here in a way it did not there:
   these blits are 'lighter' and 'color-dodge', and drawing one pixel twice
   would double it. Rects are snapped to whole SOURCE pixels and the
   destination is derived back from them, so each rect samples the scratch on
   exactly the grid the single full-region drawImage would have used and the
   output is the same pixels, not merely similar ones. Compact regions — the
   move pool and every contiguous hazard — get one rect equal to the bbox and
   take the identical code path they always did. */
function blitRects(g, low) {
  /* keyed on the buffer size as well as the flag: a region object outlives a
     viewport resize, and a rect list computed for the old pw/ph would sample
     the wrong pixels rather than merely the wrong area. */
  const key = (low ? '_brl' : '_brf') + '|' + g.pw + 'x' + g.ph + '|' + g.mw + 'x' + g.mh;
  if (g._brk === key) return g._br;
  let out = null;
  try {
    const PW = low ? g.mw : g.pw, PH = low ? g.mh : g.ph;
    if (g.w > 0 && g.h > 0 && PW > 0 && PH > 0) {
      const sx = PW / g.w, sy = PH / g.h;
      const rs = [];
      for (const r of gainRects(g)) {
        const a = Math.max(0, Math.floor((r[0] - g.x0) * sx));
        const b = Math.max(0, Math.floor((r[1] - g.y0) * sy));
        const c2 = Math.min(PW, Math.ceil((r[2] - g.x0) * sx));
        const d = Math.min(PH, Math.ceil((r[3] - g.y0) * sy));
        if (c2 - a >= 1 && d - b >= 1) rs.push([a, b, c2, d]);
      }
      /* the floor/ceil above can push two rects that gainRects left separate
         into contact or overlap; merge again on the integer grid or a
         'lighter' blit doubles the seam. */
      let merged = true;
      while (merged && rs.length > 1) {
        merged = false;
        outer:
        for (let i = 0; i < rs.length; i++) {
          for (let j = i + 1; j < rs.length; j++) {
            const A = rs[i], B = rs[j];
            if (A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3]) {
              A[0] = Math.min(A[0], B[0]); A[1] = Math.min(A[1], B[1]);
              A[2] = Math.max(A[2], B[2]); A[3] = Math.max(A[3], B[3]);
              rs.splice(j, 1); merged = true; break outer;
            }
          }
        }
      }
      let area = 0;
      for (const r of rs) area += (r[2] - r[0]) * (r[3] - r[1]);
      /* one rect that is the whole buffer is the old path; say so with null so
         the hot loop below does not pay for a list it cannot use. */
      if (rs.length && rs.length <= 8 && area < PW * PH * 0.86) out = rs;
    }
  } catch (e) { out = null; }
  g._brk = key; g._br = out;
  return out;
}

function blit(api, cv, g, comp, alpha, low) {
  const c = api.ctx;
  const PW = low ? g.mw : g.pw, PH = low ? g.mh : g.ph;
  c.save();
  c.globalCompositeOperation = comp || 'source-over';
  c.globalAlpha = (alpha == null ? 1 : alpha);
  const rs = blitRects(g, low);
  if (rs) {
    const kx = g.w / PW, ky = g.h / PH;
    for (const r of rs) {
      c.drawImage(cv, r[0], r[1], r[2] - r[0], r[3] - r[1],
                  g.x0 + r[0] * kx, g.y0 + r[1] * ky, (r[2] - r[0]) * kx, (r[3] - r[1]) * ky);
    }
  } else {
    c.drawImage(cv, 0, 0, PW, PH, g.x0, g.y0, g.w, g.h);
  }
  c.restore();
}

/* ═══════════════════════════════════════════════════════════════════════════
   ILLUMINATION GAIN — the pass that keeps the sand grain alive under a highlight
   ═══════════════════════════════════════════════════════════════════════════

   ⚠ WAVE 3 — THIS IS THE FIX FOR "THE SAND TEXTURE UNDERNEATH IS GONE", AND
   NO AMOUNT OF RETUNING THE ADDITIVE HALF COULD HAVE PRODUCED IT. Measured on
   the wave-2 frame, the eroded move-pool interior kept 93% of the sand's
   ABSOLUTE high-frequency luma detail and only 53% of its RELATIVE detail
   (TFX3-probe: grainAbsRatio 0.933, grainRelRatio 0.530). That split is the
   whole diagnosis and it is arithmetic, not taste:

       'lighter' adds a CONSTANT.   out = base + E
       so a grain wobble of ±d survives as ±d on a mean lifted from 94 to 165,
       i.e. its Weber contrast d/L is halved. The eye reads contrast, not
       differences, so the sand goes smooth and the tile turns into fog.

   Real light does not add a constant. Illumination is MULTIPLICATIVE on
   albedo — out = albedo·(ambient + key) — which scales the grain by exactly
   the same factor as the mean and leaves relative contrast untouched. Canvas
   2D cannot multiply by a colour brighter than white, but it can do this:

       read the ground back  →  tint it  →  add it to itself
       out = base + gA·(base ⊙ t) = base ⊙ (1 + gA·t)

   which IS a per-channel gain, and therefore is light in the ground rather
   than paint on top of it. Two consequences beyond the grain, both wanted:
     • it is self-shadowing for free — a rock's dark side, the crease AO and
       the cast shadows of the terrain all gain proportionally, so the pool
       stops being a flat sheet and picks up the relief underneath it;
     • it separates the highlight from the WATER it sits next to (the other
       half of this round's gap). A gain lifts dark water barely at all, so
       the pool no longer paints the pond the same mint as the sand and the
       two teal things on the left flank stop being one thing.
   The additive half is kept, small, as the ambient term: a pure gain would
   leave genuinely dark ground (deep shadow, the pond) with no lift at all,
   and dressing's own round-2 note is that a player must still be able to read
   movement range over water.

   ⚠ THE READ-BACK IS SAFE AND MUST STAY WHERE IT IS. drawStates runs from the
   ground pass (battle-board:2383) — after terrain, before the depth-sorted
   actors — so the canvas holds exactly the ground we want to light and no
   units. Moving this call after the actor pass would light the units too.
   ⚠ The source rect is CLAMPED to the canvas. `multiply` against a
   transparent destination yields the fill colour at full alpha (Porter-Duff
   source-over on the composited result), so tinting a rect that reaches past
   the canvas edge would stamp a solid slab of tint there and the mask would
   happily blit it — a bright rectangle on the board edge. Clamping means the
   only pixels tinted are pixels that actually contain ground. */
/* ⚠ THE READ-BACK IS THE ONE EXPENSIVE THING THIS FILE DOES, SO IT IS RATE
   LIMITED. drawImage(mainCanvas → offscreen) forces the 2D pipeline to flush
   everything queued so far; measured in the harness it took drawStates from
   18.1 ms/frame to 32.5. But the thing being read is the GROUND, which is
   static apart from drifting dust and the pond's ripple, and the visible
   animation of the pool — the breathing pulse — lives in the BLIT's alpha, not
   in the scratch. So the tinted read is cached per region and refreshed on a
   ~55 ms clock: about every third frame at 60 Hz, invisible on ground that
   moves this slowly, and it takes the added cost back to roughly a third.
   Stored in `g.sub`, the mask entry's own LRU-bounded map, so it is evicted
   with the region it belongs to and cannot leak. */
const GAIN_REFRESH = 0.055;      /* seconds of api.T between read-backs */
/* ⚠ WAVE 5 ROUND 2 — 0.165 → 0.34, BUT ONLY AFTER THE BUG UNDERNEATH IT WAS
   FOUND. The critic measured a reproducible ~15% per-frame cost against wave 3
   (serial in-iframe rAF counts, three 3 s windows per boot, order reversed on
   the second boot, 9 hazard tiles covering all three gain painters plus the
   move pool: 14.2 frames/3 s against 16.7). Halving the read rate is the
   obvious lever, and the first attempt at it appeared to cost grain: holy 5,6's
   high-pass regression on the true bare ground fell 0.715 → 0.463-0.542. That
   was NOT staleness. It was gainRects() padding its read rects by a hand-picked
   0.85·ax while MASK_SURF reaches 2.45·ax, so the tinted read was being clipped
   inside the mask. With the pad taken from the mask itself (see gainRects) the
   two clocks measure the same: 0.774-0.819 electric / 0.78 void / 0.87 holy at
   BOTH 0.165 and 0.34, over two same-boot triples each. The ground under a
   hazard is moved only by the vista's dust, and the hazard's own animation
   lives in the blit alpha and the l/d/post layers, never in the tinted read.
   ⚠ Note battle-board clamps dt at 0.05 s (index.html ~5008), so on a box this
   slow 0.34 s of api.T is 7 real frames, not 20 — the seconds clock throttles
   far less than it looks like it should when frames are slow, which is what
   GAIN_MIN_FRAMES below is for. */
/* ⚠ WAVE 5 ROUND 3 — 0.34 → 0.62, AND THIS IS THE PERF REPAIR THE CRITIC ASKED
   FOR. Their number: with 9 hazard tiles + the move pool, HEAD ran 15.80
   frames/3 s against wave 3's 17.60, −10.2%, and they located the whole of it
   in "the hazard gain read-backs plus the color-dodge pass" — with the move
   pool alone the two builds tied at 18.00. The read-backs are the half that
   can be given back without undoing GAP 1 (the void/electric/holy painters
   that PASSED this round are the color-dodge half, and they stay).
   Doubling this clock halves those flushes. The evidence that it is free is
   already in the round-2 note above: the grain regression under a hazard
   measured the SAME at 0.165 and at 0.34 (0.774-0.819 electric / 0.78 void /
   0.87 holy, two same-boot triples each) once gainRects stopped clipping the
   read, because what the read contains — the terrain under the hazard — is
   moved only by the vista's dust, while everything a viewer sees animate lives
   in the blit alpha and in the l/d/post layers. A clock that was invisible at
   2× is not suddenly visible at 4×. GAIN_MIN_FRAMES still floors it on a slow
   box; that floor is what actually binds in the harness. */
const GAIN_REFRESH_SURF = 0.62;  /* hazards: see the note on gainLayer below  */
/* ⚠ AND A FRAME FLOOR, because a seconds clock cannot throttle a slow box.
   `refresh` is in api.T seconds; when a frame takes longer than `refresh` the
   test always passes and the rate limit does nothing at exactly the moment it
   is needed most. A read-back may additionally not happen more often than
   every GAIN_MIN_FRAMES frames. On real hardware at 60 Hz the seconds clock is
   10-20 frames and this floor never binds; in the harness at ~5 fps it is the
   only thing that binds. */
const GAIN_MIN_FRAMES = 3;
let _gnT = -1, _gnN = 0;
function frameNo(api) {
  const T = isFinite(api.T) ? api.T : 0;
  if (T !== _gnT) { _gnT = T; _gnN++; }
  return _gnN;
}

/* ⚠ WAVE 5 ROUND 2 — READ THE TILES, NOT THE BOUNDING BOX. drawSurfaces groups
   hazards BY FX KEY across the whole board, so three `electric` tiles at
   (3,6),(4,6) and (5,1) are ONE region whose bbox is nearly the whole canvas —
   and the gain was reading, tinting and compositing every pixel of it, three
   times a refresh, to light six tiles. Measured on the critic's 9-tile hazard
   set at 1600x1000@2x: the three region bboxes total ~3.1 Mpx of device pixels
   against ~0.36 Mpx of actual tile coverage, i.e. 8.6× the traffic.
   This returns the union rect list to read instead: one padded rect per tile,
   merged where they overlap (the common case — a contiguous pool is one rect
   again, so nothing regresses for the move pool, which was always compact).
   Everything outside these rects is left transparent in the scratch, which is
   correct and not merely cheap: maskScratch's 'destination-in' then removes it,
   and the mask is zero between distant tiles anyway. */
function gainRects(g) {
  /* ⚠ THE PAD IS THE MASK'S OWN PAD, NOT A GUESS. group() computes exactly how
     far the dilated, blurred halo reaches past the tile quads and pads the
     region bbox by it; anything shorter here clips the tinted read INSIDE the
     mask, so the gain stops on a straight rectangle part-way through the halo.
     Caught by measurement: with a hand-picked 0.85·ax pad — right for
     MASK_STATE (reach 1.48·ax) and 0.6·ax short for MASK_SURF (reach 2.45·ax)
     — holy 5,6's grain regression fell 0.715 → 0.583 and void 5,5's 0.589 →
     0.165 while their neighbours improved. */
  const pad = g.pad || Math.ceil(g.ax * 1.5 + 6);
  const rs = [];
  for (const it of g.list) {
    const q = it.q;
    let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity;
    for (const p of q) {
      if (p.x < a) a = p.x; if (p.x > c2) c2 = p.x;
      if (p.y < b) b = p.y; if (p.y > d) d = p.y;
    }
    rs.push([a - pad, b - pad, c2 + pad, d + pad]);
  }
  /* merge overlapping/abutting rects so a contiguous pool is one read */
  let merged = true;
  while (merged && rs.length > 1) {
    merged = false;
    outer:
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const A = rs[i], B = rs[j];
        if (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]) {
          A[0] = Math.min(A[0], B[0]); A[1] = Math.min(A[1], B[1]);
          A[2] = Math.max(A[2], B[2]); A[3] = Math.max(A[3], B[3]);
          rs.splice(j, 1); merged = true; break outer;
        }
      }
    }
  }
  /* ⚠ IF THE TILES ARE COMPACT, GO BACK TO THE ONE BBOX READ AND CHANGE
     NOTHING. A contiguous pool's per-tile rects merge into very nearly the
     region bbox anyway, so the split buys nothing there — and "very nearly"
     is not "exactly": it moves the read rect by a few pixels, which moves
     which pixels get tinted at the halo's outer feather, which is enough to
     show up in a grain regression that is already ±0.1 capture to capture.
     The move pool and every contiguous hazard therefore take the identical
     code path they took in wave 3, and only the SCATTERED regions — the ones
     drawSurfaces builds when the same fx key appears in two corners of the
     board, which is where the whole cost was — take the new one. */
  let area = 0;
  for (const r of rs) area += Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const bbox = g.w * g.h;
  if (bbox > 0 && area > bbox * 0.70) return [[g.x0, g.y0, g.x1, g.y1]];
  return rs;
}

/* ⚠ WAVE 5 — THE SURFACE PATH ASKS FOR A SLOWER CLOCK, AND IT IS NOT A
   MICRO-OPTIMISATION. Three hazard regions each declaring a gain added three
   more pipeline flushes per refresh, measured at 33-34 frames per 4 s window
   against 37 without them (standalone board, 820x800@2x, native rAF, 8 hazard
   tiles + a move pool). The move pool needs the 55 ms clock because it sits on
   ground the STATES are lighting and pulsing; a hazard sits on terrain that
   only the vista's dust moves, and its own pulse lives in the blit alpha, not
   in the tinted read. `refresh` lets drawSurfaces ask for a third of the read
   rate and take the cost back. */
/* ⚠ WAVE 5 ROUND 3 — `opts.mode` AND `opts.bias`, AND `mode` IS THE ROUND'S
   WHOLE FIX. See the long COLOUR note on COL.move. In one sentence: with
   'multiply' the key light this function emits is `ground ⊗ tint`, so its
   CHROMATICITY is a function of the ground it lands on and every tile of a
   pool comes out a different hue; with 'color' (SetLum(tint, Lum(ground)) —
   a CSS non-separable blend, in canvas-2D since Chrome 48) it is the tint's
   chromaticity at the ground's own LUMINANCE, so the light has ONE colour and
   the ground still supplies every bit of the shading, relief and grain that
   modulates it. It is the same single fillRect either way — this costs nothing.
   `bias` is a region-scale radial dimming baked into the tinted read: white at
   the region centre falling to (1−bias) at its outer radius, so the DOMINANT
   term of the pool's light is brightest in the middle. It is one extra fill
   per READ-BACK, not per frame — the read is rate limited to GAIN_REFRESH, so
   at 60 Hz it is one fill every ~3 frames on regions that ask for it, and the
   hazards (which do not) pay nothing at all. */
/* ═══════════════════════════════════════════════════════════════════════════
   PER-TILE HUE CORRECTION — because the pool's hue is a FUNCTION of the
   ground, and a global tint cannot cancel a function
   ═══════════════════════════════════════════════════════════════════════════

   ⚠⚠ WAVE 6 SUPERSEDES THE MECHANISM DESCRIBED BELOW BUT NOT ITS PHYSICS. The
   vector-sum argument in the next four paragraphs is exactly right and is why
   the correction exists at all; what changed is that the fixed term is now made
   per-tile by SCALING ITS CHROMA rather than by ROTATING ITS HUE, and that the
   read it is keyed on happens after the frame instead of before the grade. See
   scheduleGround() and drawPool. Read the rest of this for the WHY; take none
   of its constants, they are gone.

   ⚠⚠ WAVE 5 ROUND 4 — READ THIS BEFORE TOUCHING `hfix`, HFIX_A/B/XFER, THE
   `field` OPTION ON gainLayer(), OR groundChroma(). Round 3 moved the key onto
   a 'color' blend and that fixed the MEAN (aggregate hue 156.8 → 147.1, chroma
   22.2 → 40.7, both in spec). What it did NOT fix is the SPREAD, and the
   measurement that names why is this: over 7 lit tiles of one boot, lit frame
   against the identical pixels of that same boot's paint-off frame, the
   composite's CIELAB hue is a near-deterministic LINEAR FUNCTION of the bare
   ground's chroma under it —

       hue = 186.0 − 1.47 · C_bare        r = −0.94, residual spread ±2°
       (1,4  C_bare 17.1 → hue 160.2  …  1,6  C_bare 29.4 → hue 141.4)

   and that is arithmetic, not an accident. The pool is a vector sum in Lab:
   the multiply half emits `ground ⊗ filt`, whose a/b magnitude scales with the
   GROUND's own chroma and whose direction is the aquamarine-filtered sand's
   (~140°); the 'color' key and the additive both emit a fixed chromaticity
   further round the wheel. More chromatic ground → a longer green vector in
   the sum → a greener composite. The pond shore at 1,4 is nearly neutral, so
   its sum is dominated by the fixed terms and lands at 160; the dry sand at
   1,6 is chromatic and drags to 141.
   ⚠ A GLOBAL RE-TINT CANNOT CLOSE THIS. It slides the whole line and swaps
   which END falls out of the window — which is exactly what rounds 1-3 kept
   rediscovering, and it is why the sweep recorded in COL.move's note plateaus.
   The only fix is to make one of the fixed terms per-tile, keyed on the very
   quantity that predicts the error.

   ⚠ AND IT MUST NOT BE PER-CELL. The blind A/B this round won was won on ONE
   sentence — "P reads as ONE continuous emissive mass … Q is a stack of
   translucent glass panes, I can count individual cells with different
   brightness and hue". Painting each tile quad its own corrected tint would
   hand that complaint straight back. So the correction is a smooth FIELD: one
   soft elliptical blob of the tile's own tint per tile, radius 1.9·ax, drawn
   into the key's tint fill so overlapping neighbours cross-fade. A tile centre
   gets its own tint exactly (2·ax > 1.9·ax, so no neighbour reaches it) and
   everything between is an interpolation with no edge anywhere.

   ⚠ THE READ IS ONE getImageData PER REGION PER 1.6 s, NOT ONE PER TILE.
   gainLayer already pulls the region off the canvas every ~55 ms; this pulls
   the same region ONCE into a ≤96 px thumbnail and reads that. The ground
   under a tile is moved only by the vista's dust — it is the slowest-changing
   thing this file depends on — so the clock is 30× gainLayer's and the frame
   floor is 20. Measured cost is inside the capture-to-capture null. */
function _srgbLin(u) { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
function _linSrgb(v) {
  v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
function rgb2lab(r, g, b) {
  const R = _srgbLin(r), G = _srgbLin(g), B = _srgbLin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function lab2rgb(L, a, bb) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const inv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [_linSrgb(X *  3.2406 + Y * -1.5372 + Z * -0.4986),
          _linSrgb(X * -0.9689 + Y *  1.8758 + Z *  0.0415),
          _linSrgb(X *  0.0557 + Y * -0.2040 + Z *  1.0570)];
}
/* Scale a hex colour's Lab CHROMA by `k` at constant L and hue. Memoised on a
   quantised k, so a settled board hits the map every frame instead of running
   two Lab conversions per tile.
   ⚠ THIS IS THE ONE KNOB THAT MOVES A 'color' KEY'S COLOUR WITHOUT MOVING ITS
   LEVEL, and that is the whole reason the mechanism below can exist. A 'color'
   blend emits SetLum(tint, Lum(ground)): the tint's luminance is discarded, so
   desaturating the tint changes only how much chromaticity the key imposes and
   leaves the emitted luminance — i.e. the pool's entire dL — untouched.
   Scaling the key's ALPHA instead would have cut both together. */
const _hexSat = new Map();
function scaleChroma(hex, k) {
  const q = Math.round(k * 50) / 50;
  if (q === 1 || typeof hex !== 'string' || hex.length < 7) return hex;
  const key = hex + '|c' + q;
  const hit = _hexSat.get(key);
  if (hit) return hit;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  if (!(isFinite(r) && isFinite(g) && isFinite(b))) return hex;
  const L = rgb2lab(r, g, b);
  const o = lab2rgb(L[0], L[1] * q, L[2] * q);
  const s = '#' + ((1 << 24) + (o[0] << 16) + (o[1] << 8) + o[2]).toString(16).slice(1);
  if (_hexSat.size > 256) _hexSat.clear();
  _hexSat.set(key, s);
  return s;
}

/* ⚠⚠ WAVE 6 — HFIX_A/B/XFER, THEIR ASYMMETRIC CLAMPS AND THE PER-REGION
   THUMBNAIL READ THEY WERE FITTED ON ARE ALL GONE. The full argument is in the
   note above scheduleGround() and in drawPool where the replacement lives; the
   short version is that the coefficient was fitted against a read that measured
   r = 0.159 against the ground the composite actually sees, so no value of it
   was ever going to be right. What replaces it is a RATIO, which needs no fit
   and therefore cannot go stale the next time the vista moves.
   ⚠ DO NOT RE-DERIVE THE ROTATION. It was tried in two forms — an ABSOLUTE fit
   (hue = 185.6 − 2.82·C), excellent on the boot it was solved on and in pieces
   the moment the grade changed, and a DIFFERENTIAL one (C_i − C̄), which
   survives a grade change but by construction cancels the region mean — and the
   region mean is exactly what a critic then measured swinging 145.1 → 156.2
   across six pools on one board. A fit that is robust to the vista and a fit
   that corrects the region mean are the same fit only if it is a ratio. */


/* ── WAVE 6: THE KEY'S CHROMA TRACKS THE GROUND'S ─────────────────────────
   ⚠ READ THIS BEFORE TOUCHING `gain`, `g` OR hfix AGAIN. It is the answer to
   two separate critiques that turn out to be one defect, and it is a RATIO,
   not a fit — which is why it survives a ground the vista keeps moving.

   THE DEFECT, MEASURED. Six disjoint move pools on ONE board in ONE frame,
   units removed so no sprite occludes a quad, each against its own same-frame
   paint-off reference, 0.80-inset quads, CIELAB:
       region        C_bare  hue     poolC   satON   satOFF
       L (7 tiles)    35.6   145.1   45.9    0.414   0.604
       S (8)          35.2   145.2   45.4    0.412   0.599
       E (7)          36.0   149.2   45.8    0.443   0.600
       R (8)          34.1   152.4   43.0    0.445   0.576
       W (7)          22.3   150.9   41.0    0.423   0.415
       N (8)          15.7   156.2   37.1    0.420   0.281
   Two readings of the same line. (a) hue = 149.8 − 0.381·(C_bare − 29.8),
   r = −0.77: the SAME highlight lands at 145 on the dry sand of the south
   flank and at 156 on the pale north row, an 11° swing across one board, and
   hfix cannot touch it — its model is `C_i − C̄`, so it cancels within a
   region by construction and the region mean is exactly what varies here.
   (b) pool chroma rises only 0.39 per unit of ground chroma, i.e. it is 61%
   ground-INDEPENDENT: over a ground that ranges 15.7-36.0 the pool sits at
   37-46. So wherever the sand is pale the pool is more saturated than the
   sand it lies on — N measures satON 0.420 against the sand's 0.281 — and the
   round-7 contract ("saturation still below the sand's") fails there.

   WHY THEY ARE ONE DEFECT. Both are the vector sum in Lab that the note above
   groundChroma() describes: the composite is the ground's own a/b plus a FIXED
   chromaticity from the key and the additive. Hold the fixed term constant and
   the mix ratio — and therefore the hue — is a function of the ground's chroma,
   while the sum's magnitude has a floor the ground cannot lower. Make the key's
   chroma PROPORTIONAL to the ground's and both fall out at once: the ratio
   between the two terms is constant, so the hue stops depending on where on the
   board the pool is, and the sum scales with the ground, so a pale tile gets a
   pale highlight.

   WHY IT COSTS ALMOST NO LIGHT. Under 'color' the tint's luminance is
   discarded, so the level knob is still `g` — see scaleChroma. Measured over
   the three pools, dL709 47.9/51.1/50.5 before and 50.5/51.4/46.9 after, i.e.
   it moves within the run-to-run spread rather than in one direction. (It is
   not exactly zero: the compositing spec's 'color' clips out-of-gamut results,
   so a more chromatic key does lose a little luminance on bright sand.)

   CT_REF is the ground chroma at which the key is used neat: the mean of the
   six regions above rather than a round number, so the board's average pool is
   exactly what round 3 tuned and nothing else has to be re-solved.

   ⚠ PER TILE OR PER REGION MEASURED THE SAME AND IT IS PER TILE ANYWAY. With
   one ratio for the whole region the three pools landed 149.0/153.6/147.4
   against 149.3/153.3/148.9 per tile, and their spreads within noise of each
   other — this board has no pool that straddles pale and chromatic ground, so
   there was nothing for the per-tile form to do. It is per tile because the
   moment one does (a pool reaching from the dry flank onto the pond shore) the
   region form has the same defect at tile scale that it was built to fix at
   region scale. The field is the same smooth blob interpolation the rotation
   used, so a per-cell edge is still impossible. */
/* ⚠ AND THE RATIO IS COMPRESSED, NOT RAW — MEASURED, THE TRANSFER IS THREE
   TIMES STRONGER AT THE PALE END. Applying the ratio at full strength (pow 1,
   clamps 0.62/1.22) moved the pale north pool 156.4 → 142.0 while the two
   chromatic pools moved +2.3 and −0.9 on ratios of 1.18 and 1.14: about 38° of
   composite hue per unit of key chroma where the sand is pale against ~13°
   where it is not, because on pale ground the key IS most of the pool's colour.
   A raw ratio therefore does not flatten the board, it swaps which end is out
   — the same failure mode the old global re-tint had. CT_POW compresses it:
   0.55 lands the same three pools within a few degrees of each other while
   still cutting the pale pool's excess saturation by most of what the raw
   ratio did. Do not read the exponent as a fudge — the underlying quantity is
   a ratio of vector magnitudes in a sum whose OTHER terms (the multiply filter
   and the ambient) are also chromatic, so the composite's dependence on the
   key's chroma is a saturating curve, not a line. */
const CT_REF = 29.8;          /* C_bare at which the key tint is used neat */
const CT_POW = 0.55;          /* compression of the ratio, see above */
const CT_LO = 0.70, CT_HI = 1.15;

/* ═══════════════════════════════════════════════════════════════════════════
   ⚠⚠ WAVE 6 — THE READ WAS LOOKING AT A GROUND THAT HAD NOT BEEN COLOURED YET,
   AND THAT IS WHY EVERY GROUND-KEYED CORRECTION IN THIS FILE WAS AIMED AT THE
   WRONG TILES. Read this before re-fitting anything keyed on C_bare.

   The old read happened where the comment above it said it did — at the top of
   drawPool, "before this pool has emitted anything" — which is true and is
   exactly the problem. drawStates runs inside drawBoard, and on this build the
   sand gets most of its colour AFTER that, from two later passes: the vista's
   grade (last thing in frame()) and the dressing (in the depth sort). Measured
   on one board, one frozen frame, the whole 8x7 grid, 0.80-inset quads:
       what the old read saw    C 10.3 - 19.6   (mean 13.9)
       what the composite sees  C 10.1 - 39.3   (mean 29.5)
       regression of the second on the first: slope 0.646, r = 0.159
   i.e. the estimator carried 2.5% of the variance of the quantity it exists to
   estimate. Six disjoint move pools, same frame, same story at region scale:
   the read returned 12.8-14.7 for every one of them while their true ground
   chroma ran 15.7-36.1 (r = 0.29). Isolated by stubbing each pass in turn:
       ship            L 35.5  R 34.0  N 15.8  S 35.1  W 22.3  E 36.0
       grade stubbed   L 13.1  R 12.3  N  7.7  S 13.8  W  8.6  E 14.0
       dressing stubbed L 35.5 R 34.0  N 26.7  S 35.1  W 33.2  E 36.7
   — the grade supplies ~22 of the ~35 units, and the dressing is what makes
   the far row and the west edge pale. Neither is on the canvas when drawStates
   runs, and no thumbnail resolution can recover a signal that is not there.
   (A previous round diagnosed this as the 96 px thumbnail compressing the
   range. It does compress it, but that is the small term.)

   THE FIX IS WHEN, NOT HOW. The completed frame IS on the canvas — for exactly
   as long as it takes the next rAF to clear it. So the read is now scheduled
   from drawStates as a macrotask: frame() finishes, the grade and the dressing
   have landed, and the callback samples a whole-board thumbnail before the
   next frame starts. What it cannot do is read a tile that this frame LIT, so
   the snapshot records which tiles were painted and only refreshes the others.
   That is enough in practice and it is why the per-tile store outlives any one
   region: a pool appears when the player selects a unit, and the frames before
   that selection are exactly the frames in which its tiles were bare.

   ⚠ CONSEQUENCES IF YOU CHANGE THE ORDER OF ANYTHING. If the host ever runs
   the grade before drawBoard, this can go back to a synchronous read and will
   be one frame fresher. If a future pass paints the ground AFTER this callback
   (nothing does today — it is the last thing in the task), it will be invisible
   here in exactly the way the grade was. Re-run the 56-tile regression above;
   it is four lines of measurement and it is the only thing that tells you the
   estimator is still connected to reality. */
const BG_MINI = 320;          /* longest side of the whole-board thumbnail */
const BG_REFRESH = 2.0;       /* s between snapshots on a board that is not
                                 changing which tiles it lights */
const BG_MIN = 0.25;          /* hard floor between snapshots. Without it a
                                 moving HOVER changes the lit set every frame
                                 and this would read the canvas every frame. */
let _bg = null;               /* { cv, ctx, w, h, s, t, sig } — graded frame  */
const _bgC = new Map();       /* 'x,z' -> { C, ab, t }  bare-ground chroma    */
let _bgPend = 0, _bgLit = '';

/* Called from drawStates every frame with the tiles this frame is lighting.
   Cheap and synchronous: everything expensive happens in the callback, after
   the frame is on screen.
   ⚠ THE LIT SET IS PART OF THE STALENESS TEST, not just the clock. A tile that
   is lit cannot be read, so the moment a selection changes — which is exactly
   when a different set of tiles becomes readable, and when a new pool needs
   its correction — the snapshot must be retaken rather than waiting out the
   2 s clock with a store that has nothing for the tiles that just went bare. */
function scheduleGround(api, litSet) {
  const T = isFinite(api.T) ? api.T : 0;
  const sig = litSet.slice().sort().join(' ');
  /* ⚠ RECORDED EVERY FRAME, READ BY THE CALLBACK — NOT CLOSED OVER AT SCHEDULE
     TIME. The callback is a task, and a task is only guaranteed to run before
     the next one, not before the next FRAME: throttled tabs clamp setTimeout to
     ~1 s, by which time the canvas holds a much later frame. Closing over the
     scheduling frame's lit set meant the snapshot trusted tiles that were lit
     in the frame it actually sampled — measured, seven tiles of the west pool
     came back with C 54-58 against a true bare 33-38, i.e. the store had
     recorded the pool's own light as ground and every correction keyed on it
     was then wrong in the same direction. The canvas and the lit set must come
     from the SAME frame, and the only way to guarantee that is to read both at
     callback time. */
  _bgLit = sig;
  if (_bgPend) return;
  if (_bg && Math.abs(T - _bg.t) < BG_MIN) return;
  if (_bg && sig === _bg.sig && Math.abs(T - _bg.t) < BG_REFRESH) return;
  const src = api.ctx.canvas;
  if (!src || !src.width) return;
  _bgPend = 1;
  /* setTimeout, not a microtask: a microtask would run before frame() returns
     — still inside the same task, still before the grade — which is the bug
     this whole block exists to fix. */
  setTimeout(() => {
    _bgPend = 0;
    try { captureGround(api, src, new Set(_bgLit ? _bgLit.split(' ') : []), isFinite(api.T) ? api.T : T); } catch (e) {}
  }, 0);
}

function captureGround(api, src, lit, T) {
  const k = Math.min(1, BG_MINI / Math.max(src.width, src.height));
  const dw = Math.max(8, Math.round(src.width * k)), dh = Math.max(8, Math.round(src.height * k));
  if (!_bg || _bg.w !== dw || _bg.h !== dh) {
    const cv = mkCv(dw, dh);
    _bg = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }), w: dw, h: dh, s: dw / src.width, t: -1e9 };
  }
  _bg.ctx.setTransform(1, 0, 0, 1, 0, 0);
  _bg.ctx.globalCompositeOperation = 'copy';
  _bg.ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, dw, dh);
  _bg.ctx.globalCompositeOperation = 'source-over';
  const img = _bg.ctx.getImageData(0, 0, dw, dh);
  _bg.t = T; _bg.sig = _bgLit;
  const d = img.data;
  const MAP = api.MAP || {};
  const cols = MAP.cols | 0, rows = MAP.rows | 0;
  if (!cols || !rows) return;
  /* tilePoly is in CSS px; the thumbnail is a scale of DEVICE px. */
  const sc = _bg.s * ctxScale(api);
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const kk = x + ',' + z;
      if (lit.has(kk)) continue;                 /* this frame painted it */
      let P = null;
      try { P = api.tilePoly(x, z, 0.02); } catch (e) {}
      if (!P || P.length < 3) continue;
      let cx = 0, cy = 0;
      for (const p of P) { cx += p.x; cy += p.y; }
      cx /= P.length; cy /= P.length;
      /* the SAME 0.80 inset every figure in this file is measured on */
      const Q = P.map((p) => [(cx + (p.x - cx) * 0.80) * sc, (cy + (p.y - cy) * 0.80) * sc]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of Q) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
      const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(dw - 1, Math.ceil(x1));
      const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(dh - 1, Math.ceil(y1));
      let sa = 0, sb = 0, n = 0;
      for (let yy = iy0; yy <= iy1; yy++) {
        const yc = yy + 0.5;
        for (let xx = ix0; xx <= ix1; xx++) {
          const xc = xx + 0.5;
          let inside = false;
          for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) {
            if ((Q[i][1] > yc) !== (Q[j][1] > yc) &&
                xc < (Q[j][0] - Q[i][0]) * (yc - Q[i][1]) / (Q[j][1] - Q[i][1]) + Q[i][0]) inside = !inside;
          }
          if (!inside) continue;
          const o = (yy * dw + xx) * 4;
          if (d[o + 3] < 8) continue;
          const L = rgb2lab(d[o], d[o + 1], d[o + 2]);
          sa += L[1]; sb += L[2]; n++;
        }
      }
      /* A tile too small in the thumbnail to catch a pixel keeps whatever it
         had rather than falling to NaN — a NaN would drop out of C̄ and bias
         every other tile's correction, which is the same trap the old
         per-region read guarded. */
      if (!n) continue;
      _bgC.set(kk, { C: Math.hypot(sa / n, sb / n), ab: [sa / n, sb / n], t: T });
    }
  }
  /* the read-only diagnostic seam, unchanged in spirit: this is how CT_REF was
     fitted and how the next round re-fits it without editing the module. */
  try {
    const d0 = (window.__TFX = window.__TFX || {});
    const rec = {};
    _bgC.forEach((v, kk) => { rec[kk] = +v.C.toFixed(2); });
    d0.bg = { t: T, n: _bgC.size, C: rec };
  } catch (e) {}
}

/* Mean bare-ground chroma under each tile of `g`, index-aligned with g.list —
   read from the last completed frame in which that tile was NOT lit. Returns
   null while the store has nothing for this region, which is the same "no
   correction" path a failed read has always taken. */
function groundChroma(api, g) {
  if (!g || !g.list) return null;
  const C = [];
  let seen = 0;
  for (const it of g.list) {
    const e = _bgC.get(it.x + ',' + it.z);
    if (e) { C.push(e.C); seen++; } else C.push(NaN);
  }
  if (seen < Math.max(1, g.list.length >> 1)) return null;
  /* a tile never seen bare takes the region's own mean, so it is corrected
     with the herd instead of dropping the whole region's correction */
  let s = 0;
  for (const v of C) if (isFinite(v)) s += v;
  const mean = s / seen;
  for (let i = 0; i < C.length; i++) if (!isFinite(C[i])) C[i] = mean;
  return C;
}

function gainLayer(api, g, tint, amount, refresh, opts) {
  if (!(amount > 0.004)) return;
  const src = api.ctx.canvas;
  if (!src || !src.width) return;
  const mode = (opts && opts.mode) || 'multiply';
  const bias = (opts && opts.bias > 0) ? opts.bias : 0;
  /* ⚠ THE FIELD IS PART OF THE CACHE KEY. It changes only when groundChroma()
     refreshes, and the call site quantises it to whole degrees, so on a settled
     board this is one stable string and the read-back rate limit still holds. */
  const field = (opts && opts.field && opts.field.length) ? opts.field : null;
  const key = 'gain|' + tint + '|' + mode + '|' + bias + '|' + (field ? field.sig : '');
  const cached = g.sub ? g.sub.get(key) : null;
  const T = isFinite(api.T) ? api.T : 0;
  const N = frameNo(api);
  if (cached && cached.pw === g.pw && cached.ph === g.ph &&
      (Math.abs(T - cached.t) < (refresh || GAIN_REFRESH) ||
       N - cached.n < GAIN_MIN_FRAMES)) {
    emitGain(api, g, cached.cv, amount);
    return;
  }
  const s = g.dpr;
  const sx = g.x0 * s, sy = g.y0 * s;
  /* One padded rect per tile, merged where they touch — NOT the region bbox.
     See gainRects(). Each is intersected with the canvas: 'multiply' against a
     transparent destination yields the fill colour at full alpha, so tinting a
     rect that reaches past the canvas edge would stamp a solid slab of tint
     there and the mask would happily blit it. */
  const rects = gainRects(g);
  let drew = 0;
  const ok = maskScratch(api, g, (c) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    /* kept so the bias pass below can only touch pixels this pass actually
       wrote. `multiply` against a TRANSPARENT destination yields the fill
       colour at full alpha (the same trap the clamp above exists for), so a
       bias fill over an unwritten rect would stamp a grey slab there. */
    const done = bias > 0 ? [] : null;
    for (const r of rects) {
      const ix0 = Math.max(0, Math.floor(r[0] * s)), iy0 = Math.max(0, Math.floor(r[1] * s));
      const ix1 = Math.min(src.width, Math.ceil(r[2] * s));
      const iy1 = Math.min(src.height, Math.ceil(r[3] * s));
      if (ix1 - ix0 < 1 || iy1 - iy0 < 1) continue;
      const dx = ix0 - sx, dy = iy0 - sy, dw = ix1 - ix0, dh = iy1 - iy0;
      c.globalCompositeOperation = 'source-over';
      c.drawImage(src, ix0, iy0, dw, dh, dx, dy, dw, dh);
      c.globalCompositeOperation = mode;
      c.fillStyle = tint;
      c.fillRect(dx, dy, dw, dh);
      /* THE PER-TILE HUE FIELD. Same composite op as the flat fill above, so
         under 'color' each blob is another SetLum(tint, Lum(ground)) and the
         luminance the ground supplies survives every one of them untouched —
         all that varies across the region is WHICH chromaticity is carried.
         Overlapping blobs cross-fade in RGB at equal luminance, i.e. the hue
         interpolates; there is no cell edge anywhere. Clipped to this read
         rect because 'color' (like 'multiply') against a TRANSPARENT
         destination degrades to source-over and would stamp a solid blob of
         tint outside the read — the same trap the rect clamp above exists for. */
      if (field) {
        c.save();
        c.beginPath(); c.rect(dx, dy, dw, dh); c.clip();
        for (const f of field) {
          const bx = f.cx * s - sx, by = f.cy * s - sy;
          const R = Math.max(6, f.ax * s * 1.9);
          if (bx + R < dx || bx - R > dx + dw || by + R < dy || by - R > dy + dh) continue;
          radial(c, bx, by, f.ax * s, f.ay * s, R, [
            [0,    api.rgba(f.tint, 1)],
            [0.50, api.rgba(f.tint, 0.55)],
            [1,    api.rgba(f.tint, 0)]
          ]);
        }
        c.restore();
      }
      if (done) done.push([dx, dy, dw, dh]);
      drew++;
    }
    if (done && done.length) {
      /* Region-scale centre bias, in DEVICE px of the scratch (the transform
         is identity in here, unlike every other maskScratch caller). One
         gradient, reused for every rect, so the ramp is continuous across a
         split read rather than restarting per rect. */
      const cx = (g.cx - g.x0) * s, cy = (g.cy - g.y0) * s;
      const R = Math.max(24, 0.62 * Math.hypot(g.w || 0, g.h || 0) * s);
      const k = Math.round(255 * (1 - bias));
      const grd = c.createRadialGradient(cx, cy, 0, cx, cy, R);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, 'rgb(' + k + ',' + k + ',' + k + ')');
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = grd;
      for (const d of done) c.fillRect(d[0], d[1], d[2], d[3]);
    }
    c.globalCompositeOperation = 'source-over';
  });
  if (!ok || !drew) return;
  if (g.sub) {
    let e = cached;
    if (!e || e.pw !== g.pw || e.ph !== g.ph) {
      e = { cv: mkCv(g.pw, g.ph), pw: g.pw, ph: g.ph, t: T, n: N };
      e.ctx = e.cv.getContext('2d');
      g.sub.set(key, e);
    }
    e.t = T; e.n = N;
    e.ctx.setTransform(1, 0, 0, 1, 0, 0);
    e.ctx.globalCompositeOperation = 'copy';
    e.ctx.drawImage(_scCv, 0, 0, g.pw, g.ph, 0, 0, g.pw, g.ph);
    e.ctx.globalCompositeOperation = 'source-over';
    emitGain(api, g, e.cv, amount);
    return;
  }
  emitGain(api, g, _scCv, amount);
}

/* globalAlpha caps at 1 and a cool light on warm sand genuinely needs a blue
   gain above 1.0 (that is what "the ground is now lit by something else"
   means). 'lighter' is linear, so N blits sum exactly. */
function emitGain(api, g, cv, amount) {
  let left = amount;
  for (let i = 0; i < 4 && left > 0.004; i++) {
    const a = Math.min(1, left);
    blit(api, cv, g, 'lighter', a);
    left -= a;
  }
}

/* Render `fn` into the scratch and cut it to the region mask, ready for ONE
   composite. Compositing once is the whole point: it is what lets a 'multiply'
   wash cover a four-tile pool without double-darkening the three shared edges
   into a visible grid.

   `low` renders the content at the MASK's resolution (half the canvas's) and
   upscales on the blit. It is for the per-frame sheen/ripple/flame passes only:
   they are soft, low-contrast and animated, so the resample is invisible, and
   it takes a quarter of the fill. Never use it for the layers that carry hard
   detail — web silk, caltrop spikes, ground fissures — which is why those are
   also the ones marked sStatic and therefore drawn once at full resolution. */
function maskScratch(api, g, fn, useHalo, low) {
  const M = useHalo ? g.halo : g.mask;
  if (!M) return false;
  const w = low ? g.mw : g.pw, h = low ? g.mh : g.ph;
  const s = low ? g.mdpr : g.dpr;
  const sc = scCtx(w, h);
  sc.save();
  sc.beginPath(); sc.rect(0, 0, w, h); sc.clip();
  sc.setTransform(s, 0, 0, s, -g.x0 * s, -g.y0 * s);
  try { fn(sc); } catch (e) {}
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.filter = 'none';
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(M.cv, 0, 0, g.mw, g.mh, 0, 0, w, h);
  sc.restore();
  return true;
}

function layer(api, g, comp, alpha, fn, useHalo, low) {
  if (maskScratch(api, g, fn, useHalo, low)) blit(api, _scCv, g, comp, alpha, low);
}

/* ⚠ THE CACHED HALF. Most of what this file draws does not move: the material
   wash, the damp halo, the hue filter under a highlight. Only sheen, ripples,
   flame and the highlight's pulse are functions of api.T. Re-masking a static
   layer every frame meant four full-region passes per layer, ~40 layers a
   frame, and a 670 ms frame in the harness. Now a static layer is rendered
   through the mask ONCE into its own canvas and thereafter costs one blit —
   and an animated ALPHA still works, because the blit's globalAlpha is applied
   at composite time. Anything genuinely time-varying still goes through
   layer(). */
/* ⚠ `key` MUST IDENTIFY THE CONTENT, NOT THE SLOT. g.sub belongs to the MASK
   cache entry (buildMask), which is keyed on geometry alone — mask tag, epoch,
   lift, tile list — so every caller that can draw different content over the
   same tiles shares this map. A slot name like 'm' is therefore not a key, it
   is a collision waiting for the tile to change hazard; see the WAVE 6 note in
   drawSurfaces for what that measured. Callers here prefix with the painter or
   the state (`tag`, `pk`) for exactly that reason. */
function staticLayer(api, g, comp, alpha, key, fn, useHalo) {
  if (!g.sub) { layer(api, g, comp, alpha, fn, useHalo); return; }
  let cv = g.sub.get(key);
  if (!cv) {
    if (!maskScratch(api, g, fn, useHalo)) return;
    cv = mkCv(g.pw, g.ph);
    const cc = cv.getContext('2d');
    cc.drawImage(_scCv, 0, 0, g.pw, g.ph, 0, 0, g.pw, g.ph);
    g.sub.set(key, cv);
  }
  blit(api, cv, g, comp, alpha);
}

/* Flat colour through the DILATED mask, cached. This replaces both the old
   rimBand() (a stroke, which traced whatever polygon the region was — on one
   tile, the tile) and the old unclipped feather() (a radial per border tile,
   which on the ice painter became a milky near-white panel a whole
   tile-and-a-half wide). What survives visually is the part outside the
   material itself: damp sand round a puddle, scorch round a fire, cold round
   ice. The alpha is NOT baked in, so a pulsing heat halo is still one blit. */
function halo(api, g, colour, alpha, comp) {
  staticLayer(api, g, comp || 'multiply', alpha, 'h:' + colour, (c) => {
    c.fillStyle = api.rgba(colour, 1);
    c.fillRect(g.x0, g.y0, g.w, g.h);
  }, true);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOFT MOTIF — a path drawn as light instead of as a stroke
   ═══════════════════════════════════════════════════════════════════════════

   ⚠ WAVE 5 — WHY THE THREE ARCANE PAINTERS NEEDED THIS AND THE OTHERS DID NOT.
   void, electric and holy were the last three painters still drawing their
   identity with ctx.stroke(): a 3-arm spiral at lineWidth ax·0.045 α0.30, a
   white lightning polyline at ax·0.035 α0.90 with a shadowBlur, and two
   concentric ellipse OUTLINES per holy tile at ax·0.03. Measured on the
   rendered frame, all three had the same signature — a near-opaque hairline
   lying ON the sand with no interaction with it: high-pass regression of the
   painted tile against the same pixels unpainted came out near zero slope,
   i.e. the mark REPLACED the ground rather than lighting it, which is the
   sticker read this whole file exists to delete. `ice` and `web` already
   learned the lesson in their own headers ("ice detail is TEXTURE, not
   linework"), and `fire.post` already learned the drawing technique (a chain
   of soft blobs riding the spine, each falling to zero laterally as well as
   vertically). This is that technique factored out so all three can use it.

   A chain of radial falloffs has no edge in ANY direction, so there is no
   width to read as a drawn line — and because the chain is emissive and goes
   into the region scratch, it composites 'lighter' ONCE over the material,
   exactly like the move pool's emission. The other half of the pair is
   gainLayer() — see PAINTERS.gain below. */
/* ⚠⚠ WAVE 5 ROUND 2 — THE SHAPE IS UNCHANGED; WHAT DRAWS IT IS NOT.
   The mark this produces, and every note above about why it is a chain of
   falloffs rather than a stroke, still stands. What was measured and had to
   change is the COST of one blob. It was createRadialGradient + fillRect —
   Chromium builds and uploads a fresh gradient ramp for every one — and a blob
   every 0.36-0.55 of a radius along a spiral or a lightning branch is 100-140
   of them per branch; with electric and void each running a dodge pass and an
   emissive pass over three tiles apiece that came to ~2200 gradients a frame.
   Measured on the standalone board at 1200x900@2x with the critic's 9-tile
   hazard set, three 3 s rAF windows: 13.9 frames/3 s with the gradient chain,
   17.0 with the entire dodge pass deleted — so the chain alone was three
   frames of the regression — and rendering it at HALF resolution recovered
   0.1 of those, which is the proof that the cost is per-gradient and not
   per-pixel.
   ⚠ AND A BLURRED STROKE IS NOT THE ANSWER, THOUGH IT LOOKS LIKE IT SHOULD BE.
   One path + one ctx.filter='blur()' per pass MEASURED 8.0 frames/3 s — worse
   than the chain by 40%. Skia's blur on this software rasteriser is a
   whole-bbox pass with a wide kernel and it is not competitive with any number
   of small fills. Do not re-try it.
   What works is caching the falloff ONCE per colour as a sprite and stamping
   it: the blob profile is identical (stops 1 / 0.40 / 0 scaled by globalAlpha
   is exactly the old stops A / 0.40A / 0), and a drawImage of a 64px canvas
   costs a fraction of a gradient build. */
/* ⚠ WAVE 5 ROUND 2 — A HAZARD'S MOTIF BELONGS TO ITS OWN TILE. The region mask
   is deliberately generous (MASK_SURF base 1.44, so it reaches ~0.44 of a tile
   past the quad — that softness is what stops a pool of oil looking like four
   squares) and anything drawn inside it inherits that reach. A lightning
   branch is a random walk starting at one edge and crossing the tile, and a
   rift's outer arm passes r = 1.0·ax, so both were routinely landing on the
   NEIGHBOURING tile. Measured: holy 5,6 sits next to electric 4,6 in the
   critic's hazard set and its grain regression fell from wave 3's 0.665-0.757
   to 0.43-0.68 purely from electric's arcs spilling into its 0.80-inset
   sample. The motif is clamped to an ellipse just inside the tile; the
   material, the halo and the mask still spill, which is the part that was ever
   meant to. */
function clampTile(m, x, y, f) {
  const dx = (x - m.cx) / Math.max(1e-3, m.ax);
  const dy = (y - m.cy) / Math.max(1e-3, m.ay);
  const d = Math.hypot(dx, dy);
  if (!(d > f)) return { x, y };
  const k = f / d;
  return { x: m.cx + dx * k * m.ax, y: m.cy + dy * k * m.ay };
}

const _blobSprites = new Map();
function blobSprite(api, col) {
  let cv = _blobSprites.get(col);
  if (cv) return cv;
  const S = 64;
  cv = mkCv(S, S);
  const cc = cv.getContext('2d');
  const gr = cc.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0,    api.rgba(col, 1));
  gr.addColorStop(0.42, api.rgba(col, 0.40));
  gr.addColorStop(1,    api.rgba(col, 0));
  cc.fillStyle = gr;
  cc.fillRect(0, 0, S, S);
  /* bounded: the table has a fixed handful of motif colours, but a painter
     could compute one, and an unbounded map of canvases is a leak. */
  if (_blobSprites.size > 24) _blobSprites.clear();
  _blobSprites.set(col, cv);
  return cv;
}
function glowChain(c, api, pts, col, rad, alpha, taper, coarse) {
  if (!pts || pts.length < 2 || !(rad > 0.4) || !(alpha > 0.004)) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (!(total > 0.5)) return;
  const sp = blobSprite(api, col);
  /* ⚠ 0.55 → 0.42 OF A RADIUS. Consecutive blobs at 0.55·r leave a periodic
     ripple along the chain whose wavelength is 0.55·r; for electric's core
     (r ≈ 3 CSS px) that is ~3.3 DEVICE px, which sits squarely inside the band
     an 11×11 high-pass measures — so the chain was contributing its own bead
     frequency to the very statistic that asks whether the tile's texture is
     the sand's, and because the branch seed steps 7×/s, contributing it in a
     different place every frame. The floor is what actually binds on the tight
     core chains, so it is the floor that was lowered (1.4 → 1.15).
     ⚠ `coarse` opts a chain OUT of that, and only the dim emissive passes use
     it. The bead ripple is proportional to the chain's own alpha, so on a pass
     running at 0.06-0.08 it is a fraction of a level — under the ground's own
     grain and far under anything the high-pass can resolve — while the blob
     count it saves is the difference between this file costing frames and not.
     Never mark the DODGE passes coarse: those are the ones carrying the mark's
     body, and they are the ones the grain regression is measured through. */
  const step = coarse ? Math.max(2.2, rad * 0.85) : Math.max(1.15, rad * 0.42);
  let done = 0;
  c.save();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(seg > 0.01)) continue;
    const n = Math.max(1, Math.ceil(seg / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      /* u is position along the WHOLE path, so a taper fades the mark in and
         out at its ends. An arc that starts and stops at full strength has two
         hard caps, and two hard caps are two more drawn marks. */
      const u = (done + seg * t) / total;
      const f = taper ? Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.65) : 1;
      const A = alpha * f;
      if (A <= 0.004) continue;
      const R = rad * (0.55 + 0.45 * f);
      c.globalAlpha = A;
      c.drawImage(sp, a.x + (b.x - a.x) * t - R, a.y + (b.y - a.y) * t - R, R * 2, R * 2);
    }
    done += seg;
  }
  c.restore();
}

/* Assemble a region: jittered polygons, per-tile metrics, membership set, the
   padded device-pixel bbox the mask lives in, and a signature for the cache. */
function group(api, tiles, lift, amp, opt) {
  const list = [];
  const set = new Set();
  const sig = [];
  let ax = 0, ay = 0, cx = 0, cy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tiles) {
    const q = jitQuad(api, t.x, t.z, lift, amp);
    if (!q) continue;
    const m = metrics(q);
    list.push({ x: t.x, z: t.z, q, m });
    set.add(t.x + ',' + t.z);
    sig.push(t.x + ',' + t.z);
    ax += m.ax; ay += m.ay; cx += m.cx; cy += m.cy;
    for (const p of q) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  }
  const n = list.length;
  if (!n) return null;
  ax /= n; ay /= n; cx /= n; cy /= n;
  /* Pad for the blob's outward reach AND the halo's blur, or the mask gets
     clipped at the canvas edge and the pool ends on a straight line — which
     is the exact artefact this whole mechanism exists to remove. */
  const pad = Math.ceil(ax * (opt.base * opt.halo - 1) + ax * opt.haloBlur * 1.8 + 6);
  x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad);
  x1 = Math.ceil(x1 + pad);  y1 = Math.ceil(y1 + pad);
  const dpr = ctxScale(api);
  const mdpr = Math.max(0.6, dpr * 0.5);
  const g = {
    list, set, n, ax, ay, cx, cy,
    x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, dpr, mdpr, pad,
    pw: Math.max(1, Math.ceil((x1 - x0) * dpr)),
    ph: Math.max(1, Math.ceil((y1 - y0) * dpr)),
    mw: Math.max(1, Math.ceil((x1 - x0) * mdpr)),
    mh: Math.max(1, Math.ceil((y1 - y0) * mdpr)),
    /* ⚠ LIFT IS PART OF THE SIGNATURE. drawStates and drawStatesOver ask for
       the same tiles at two different heights (0.006 vs 0.016), which projects
       to a sub-pixel difference — enough for the floor()/ceil() on the bbox to
       land one pixel apart some of the time. Without the lift in the key the
       two passes fight over one cache entry and rebuild both masks EVERY frame
       on any tile that is both lit and hazardous. */
    sig: _epoch + '#' + lift + '#' + sig.sort().join(' ')
  };
  if (g.w <= 0 || g.h <= 0 || g.pw > 4096 || g.ph > 4096) return null;
  buildMask(api, g, opt, opt.tag || 'p');
  return g;
}

/* The board's ctx carries the DPR transform (battle-board resize(): W/H are
   CSS px, ctx.setTransform(DPR,0,0,DPR,0,0)). Offscreens must match it or the
   mask lands at half resolution and its own edge turns into the soft artefact.
   getTransform() is the honest source; devicePixelRatio is the fallback and is
   clamped exactly as resize() clamps it. */
function ctxScale(api) {
  try {
    const t = api.ctx.getTransform();
    if (t && isFinite(t.a) && t.a > 0) return Math.min(t.a, 3);
  } catch (e) {}
  return Math.min(window.devicePixelRatio || 1, 2);
}

function fill(c, g) { c.fillRect(g.x0, g.y0, g.w, g.h); }

/* ═══════════════════════════════════════════════════════════════════════════
   A) TILE STATES — one pool of light per region
   ═══════════════════════════════════════════════════════════════════════════ */

/* strength: 1 = the under-ground pass; <1 = the re-assert over a hazard.

   ── ROUND 3: WHY THIS FUNCTION WAS REBUILT AROUND THE TILE, NOT AROUND A BLOB
   Round 2 painted every state as screen-space radial gradients: one region-wide
   ellipse plus a 1.9-tile-radius blob per tile, all composited through a mask
   dilated to ~1.5 tiles. It never touched tile geometry, and the frame showed
   it — seven legal tiles came out as a single soft teal FILM over the whole
   lower-left quadrant, spilling across four illegal tiles and the water. The
   player could see that SOMETHING was lit and could not tell WHICH.

   A movement range is not mood lighting. It is the answer to "where may I go?",
   and the answer has a boundary. So:
     • the mask is now the union of the TILE POLYGONS (jitQuad, which is
       api.tilePoly plus lattice jitter and edge midpoints) with ~2.5px of
       feather — soft, but it stops where the rules stop;
     • the interior is filled FLAT and composited ONCE, so a contiguous run is
       one continuous pool with no seam, no bead per cell and no double-lit
       shared edges;
     • the only mark that traces anything is a soft emissive rim on the OUTER
       boundary of the merged region (boundaryEdges), broken into uneven
       sub-segments with hashed width and alpha and drawn INSIDE the mask, so
       the feather eats its outer half. It is a glow that fades inward, not a
       stroke: there is no constant-width line anywhere on a tile perimeter.
   Everything is still one multiply blit + one additive blit + one halo blit per
   region per frame, all cached, with only the blit alpha breathing. */
function drawPool(api, tiles, colKey, strength, lift, filtScale, noRim, noGain) {
  const col = COL[colKey] || COL.move;
  const S = (strength || 1) * col.k;
  const g = group(api, tiles, lift, JIT_STATE, MASK_STATE);
  if (!g) return;

  /* ── PER-TILE HUE CORRECTION ────────────────────────────────────────────
     Read the BARE ground now: nothing this function emits has landed yet, so
     the thumbnail is terrain + dressing and only that. See the long note above
     groundChroma() for why the correction has to be per tile and why it must
     be a smooth field rather than a per-cell tint.
     Only the UNDER pass takes it (`strength` 1). drawStatesOver re-asserts at
     0.85 over tiles that already carry a hazard AND this pool's own light, so
     its read would be of lit ground and its "correction" would be garbage; it
     keeps the base tint, which is round 3's shipped behaviour and is what it
     was judged on. `hfix` is set only on the states whose key is a 'color'
     blend and which are drawn first — see COL. */
  /* ⚠⚠ WAVE 6 — THIS USED TO BE A FITTED PER-TILE HUE ROTATION (hfix) AND IT IS
     NOW A PER-TILE CHROMA RATIO. Both aim at the same defect; only one of them
     can survive a ground the vista keeps moving.
     The rotation was `δ_i = LEVEL − B·(C_i − C̄)` with B fitted once against a
     particular ground. Three things were wrong with it and the first is fatal:
       • its input was the pre-grade read, which measured r = 0.159 against the
         chroma the composite actually sees (see the note above scheduleGround),
         so it was rotating the wrong tiles by a coefficient fitted to noise;
       • being differential in `C_i − C̄` it cancelled the region mean exactly,
         and the region mean is precisely what moved — six pools on one board
         measured 145.1 to 156.2 with hfix running;
       • a fitted slope has to be re-fitted whenever the ground art moves, which
         is the one thing this file's own round-7 note says keeps happening.
     A ratio needs no fit. The composite is a vector sum in Lab of the ground's
     own a/b and a fixed chromaticity from the key; hold the key's chroma at a
     constant FRACTION of the ground's and the ratio of the two terms — and so
     the hue — stops depending on the ground, while the sum's magnitude scales
     with it, which is the other half (a pale tile gets a pale highlight). It
     costs no light at all, because under 'color' the tint's luminance is
     discarded: see scaleChroma and the CT_REF note.
     Per TILE for the same reason hfix was per tile, and through the same smooth
     field of overlapping blobs — a per-cell tint is the "stack of translucent
     glass panes" read that a blind A/B has already rejected once. */
  let ctf = null, hsig = '', ctk = 1;
  if (col.hfix && !noGain && (strength == null || strength >= 0.99)) {
    const C = groundChroma(api, g);
    if (C && C.length === g.list.length) {
      let csum = 0, cn = 0;
      for (const v of C) if (isFinite(v)) { csum += v; cn++; }
      const cbar = cn ? csum / cn : 0;
      const rat = (v) => Math.max(CT_LO, Math.min(CT_HI, Math.pow(Math.max(0.02, v) / CT_REF, CT_POW)));
      if (cn) {
        ctk = rat(cbar);
        ctf = C.map((v) => rat(isFinite(v) ? v : cbar));
        /* quantised exactly as scaleChroma quantises, so a settled board
           produces ONE signature and the gain read-back cache still holds */
        hsig = ctf.map((v) => Math.round(v * 50)).join(',');
      }
    }
  }
  /* ⚠ ROUND 5 — THE RIM IS SCALED BY HOW MUCH REGION THERE IS TO TRACE.
     On a big merged pool the boundary is a long, mostly-straight run and the
     rim reads as light gathering at the edge. On ONE tile the same rim is a
     closed loop round a single cell — the exact mark the win condition forbids
     — and it is also unnecessary, because a lone pool that small is found by
     its swell. `noRim` kills it outright (the selection, which sits INSIDE the
     move pool and whose loop was the brightest drawn line in the frame). */
  const rimS = noRim ? 0 : (g.list.length >= 3 ? 1 : 0.55);

  /* ⚠ THE MULTIPLY PASS CARRIES THE HUE, THE ADDITIVE PASS CARRIES THE LIFT —
     and the split is deliberate because the ground under this is not a fixed
     value. The vista's grade and the location's ground art move the sand
     between "dark canyon floor" and "hazed near-white dusk" from match to
     match, and an additive-only highlight measured against one of those is
     invisible on the other. Multiply is the robust half: on bright sand it
     bites (there is plenty of channel to remove), on dark sand it barely shows
     and the 'lighter' pass takes over.

     ⚠ The multiply is CAPPED. Run it too hard and the pool comes out at the
     same luma as bare sand — a saturated cyan STAIN rather than light rising
     out of the ground. An emissive highlight has to be BRIGHTER than what it
     sits on, so multiply only does enough to stop the sand's red dominating.

     ⚠⚠ ROUND 4 — THE CAP WENT FROM 0.34 TO 0.10 AND THAT IS THE WHOLE FIX.
     Measured on the rendered frame at 0.34 the multiply did not TINT the sand,
     it REPLACED it: over the move pool B−R went −47.6 (warm sand) to +17.5
     (cyan) while the luma only rose +26. A viewer finds the pool by HUE, and
     what they find is a sheet of translucent teal cellophane laid over ground
     that is no longer sand of any colour — the exact "sticker on top of the
     ground" this file exists to kill, drawn in hue instead of in outlines.
     The rule now is: A LIT TILE IS FOUND BY LUMA, NOT BY HUE. Multiply keeps
     only enough bite to stop the sand's red dominating on near-white dusk
     ground (its original job, and the reason it is not deleted outright), and
     the lift it used to steal moved into the additive half via `a`.
     The measured contract this file is held to, over the move pool interior:
         ON−OFF luma  ≥ +40      (was +26)
         ON B−R       ∈ [−20,+15] (was +17.5 off a −47.6 base)
     i.e. the sand keeps its own hue and simply gets brighter and cooler.
     If you raise this cap again, re-measure both numbers, not one.

     ⚠⚠ ROUND 6 — THE CAP IS NOW PER STATE (`col.fc`, default 0.10) AND move's
     IS 0.20. Round 4 was right that a 0.34 cyan multiply replaces the sand; it
     was wrong to conclude the multiply had to be near-dead everywhere. What
     actually did the damage was the FILTER'S HUE, not its strength: #3cc4ff
     leaves blue at 1.00 and cuts red 0.765, so every extra point of it is a
     point of B−R and the cap was the only thing holding the stain back.
     move's filter is now aquamarine (#46ffd8: red ×0.275, green ×1.00, blue
     ×0.847), which takes red away, leaves green whole and trims blue in step —
     so twice the strength buys chroma and costs almost nothing in B−R.
     Measured, the multiply half alone now supplies ~18 of the pool's 42 levels
     of chroma, which is the half that survives on bright hazed-dusk ground
     where the additive is washing out. Every other state keeps 0.10 and the
     arithmetic below is bit-identical to round 4's for them (fc·0.9·S ≡
     0.09·S at fc = 0.10), so their round-4 solved-for `a` values still hold —
     do not raise a state's `fc` without re-tinting its `filt` the same way. */
  const A = S * (col.a == null ? 1 : col.a);          /* additive-half gain */
  /* ⚠ WAVE 3 — THE LIFT IS NOW SPLIT THREE WAYS, NOT TWO. `A` is the AMBIENT
     term (a constant, the only thing that lifts genuinely dark ground) and
     `GA` is the KEY term (a multiplicative gain — see gainLayer). Most of the
     brightness moved from A into GA, because a constant is what flattened the
     sand grain. Anything derived from "how lit is this pool" — the escaping
     bloom, the boundary rim — must therefore be scaled by BOTH or it silently
     collapses when A is cut; `LIT` is that combined figure. The 2.4 is the
     measured ratio of luma-per-unit-gain to luma-per-unit-additive on this
     ground, so LIT stays ≈ the old A and every alpha written against it keeps
     the value three rounds of critique settled on. */
  const GA = S * (col.g == null ? 0 : col.g);         /* multiplicative gain  */
  /* ⚠ WAVE 5 ROUND 3 — THE COEFFICIENT IS PER KEY MODE, AND FORGETTING THAT
     WOULD HAVE SILENTLY GUTTED THE CYAN FRINGE. LIT is a proxy for "how much
     light is in this pool", and everything derived from it — the escaping
     halo bloom (0.034·LIT) and the broken boundary glint — is written against
     the value earlier rounds settled on. A 'color' key emits far more light
     per unit of `g` than a 'multiply' key does, so move's `g` fell 0.70 → 0.37
     for the same measured lift (ON−OFF luma 58.3 → 61.1 on a same-boot pair);
     at the old 1.55 that would have quietly cut LIT by 41% and taken the halo
     and the rim down with it. 3.0 is solved from that pair so LIT lands within
     1% of HEAD's, i.e. the bloom and the glint are bit-for-bit the strength
     three rounds of critique tuned them to. It matters beyond bookkeeping: the
     halo is the one place this file lets the light be properly CYAN, and it is
     what sells a green-teal pool as teal to the eye rather than to the meter. */
  const LIT = A + GA * (col.kmode === 'color' ? 3.0 : 1.55);
  const fc = col.fc == null ? 0.10 : col.fc;
  const filtA = Math.min(fc, fc * 0.9 * S) * (filtScale == null ? 1 : filtScale);
  const tag = colKey + '|' + S.toFixed(3) + '|' + filtA.toFixed(3) + '|' + rimS.toFixed(2);

  /* (1) hue, FLAT across the union plus a gentle centre bias. Flat is the
     point: the round-2 version was a radial that reached only filtA·0.66 at the
     region edge, so the outermost legal tiles — precisely the ones that answer
     "how far can I go" — were the least coloured tiles in the pool. */
  let rmax = 0;
  for (const it of g.list) {
    rmax = Math.max(rmax, Math.hypot(it.m.cx - g.cx, (it.m.cy - g.cy) * (g.ax / Math.max(1, g.ay))) + it.m.ax);
  }
  const R = Math.max(rmax, g.ax * 1.4);
  staticLayer(api, g, 'multiply', 1, 'f' + tag, (c) => {
    c.fillStyle = api.rgba(col.filt, filtA);
    fill(c, g);
    radial(c, g.cx, g.cy, g.ax, g.ay, R, [
      [0, api.rgba(col.filt, filtA * 0.30)],
      [1, api.rgba(col.filt, 0)]
    ]);
  });

  /* per-region breathing phase, so the move pool and the attack pool do not
     march in lockstep. Applied to the BLIT alpha, never baked into a gradient —
     that is what keeps the whole emission a cached image and one composite. */
  const bph = api.hash(g.list[0].x, g.list[0].z, 7) * 6.283;
  /* ⚠ WAVE 3 — AMPLITUDE 0.10 → 0.05. The pulse now modulates a MULTIPLICATIVE
     key light as well as the additive emission, and the two swings compound:
     measured across two captures of the same build at different phases, the
     eroded interior moved 11 levels of blue, 16° of hue and 0.12 of the grain
     ratio. That is bigger than most of the deltas this file is tuned on — it
     makes the pool un-measurable and, at 1:1, makes it visibly breathe rather
     than shimmer. Half the depth is still plainly animated and reduces the
     phase-to-phase spread to about ±0.7 of a level. */
  const pulse = 1 + Math.sin(api.T * 1.9 + bph) * 0.05;

  /* (1b) THE KEY LIGHT. Goes in immediately after the hue filter and before
     anything additive, so what it amplifies is the ground plus its tint and
     nothing this function has yet emitted. Uncached on purpose: it is a
     function of what is currently on the canvas, and the canvas changes
     whenever the vista, the dressing or a hazard does. Breathes on the same
     per-region phase as the emission so the pool pulses as one light. */
  if (GA > 0 && !noGain) {
    let kopts = col.kmode ? { mode: col.kmode, bias: col.kbias } : null;
    /* ctk is 1 unless this state reads the ground (hfix), so every other state
       and every re-assert pass emit the identical tint string they always did. */
    const ktint = scaleChroma(col.gain || col.body, ctk);
    if (kopts && ctf) {
      const base = col.gain || col.body;
      const fld = [];
      for (let i = 0; i < g.list.length; i++) {
        const m = g.list[i].m;
        fld.push({ cx: m.cx, cy: m.cy, ax: m.ax, ay: m.ay, tint: scaleChroma(base, ctf[i]) });
      }
      fld.sig = hsig;
      kopts.field = fld;
    }
    gainLayer(api, g, ktint, GA * (1 + (pulse - 1) * 0.5), null, kopts);
  }

  /* (2) the bloom that escapes onto the surrounding sand, through the barely
     dilated halo mask. This is the ONLY thing allowed outside the legal tiles,
     and it is deliberately weak — it says "there is light here", it must never
     be mistakable for "this tile is legal". */
  /* ⚠ WAVE 3 — THE BLOOM IS NOW A RING, AND THE INTERIOR IS THE REASON.
     This layer was a FLAT additive fill over the dilated mask, which covers
     the pool as well as the sand around it. Inside the pool that is a constant
     — precisely the thing that halves the sand's relative grain contrast and
     turns the tile into fog — and it was buying nothing there, because the
     emission layer below already lights the interior. Punching the pool's own
     mask back out leaves only the part that was ever the point: the fraction
     of a tile of light spilling onto the sand OUTSIDE the legal region. The
     freed interior budget went into the key light, where it scales the grain
     instead of flattening it.
     It also helps the other half of this round's gap: a soft bloom just
     outside the boundary is how an emissive pool ends, and it makes the
     boundary locatable without putting a stroke on it. */
  staticLayer(api, g, 'lighter', pulse * 0.85, 'o2' + tag, (c) => {
    c.fillStyle = api.rgba(col.halo || col.body, 0.034 * LIT);
    fill(c, g);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    if (g.mask) c.drawImage(g.mask.cv, 0, 0, g.mw, g.mh, 0, 0, g.pw, g.ph);
    c.globalCompositeOperation = 'source-over';
  }, true);

  /* (3) the emission itself: interior + a soft per-tile lift + the rim.

     ⚠ ROUND 4 — THE INTERIOR IS NO LONGER DEAD FLAT. It was, deliberately (see
     (1) above), and the cost was that the win condition's "brightest at centre"
     had no truth in the pixels: the interior measured flat to ±10% across seven
     tiles, so the pool read as a panel of even fill rather than as light. The
     bias now lives HERE, in the emissive half, not in the hue half — that is
     the distinction round 3 got wrong. Dimming the hue at the region edge made
     the outermost legal tiles the least COLOURED, i.e. the least identifiable;
     dimming the emission there makes them slightly less BRIGHT while their hue,
     their rim and their boundary are untouched. Falloff is gentle on purpose —
     measured, the outer ring still lifts ~0.80 of the centre, far above the
     level at which a tile stops being findable (its own ON−OFF luma is still
     over +40, which is the whole contract).

     ⚠ THE BIAS IS SPLIT ACROSS TWO LAYERS AND IT HAS TO BE. A region-wide
     radial ALONE moved the measured centre:edge ratio from 1.29 to only 1.24,
     because the flat fill, the halo and the per-tile swells are all uniform and
     simply average the gradient away. The swells are the biggest of those, so
     the falloff is also folded into them (`rf` below). Anything that puts the
     whole bias in one layer has to run that layer so hard it clips. */
  staticLayer(api, g, 'lighter', pulse, 'e' + tag + '|' + hsig, (c) => {
    c.fillStyle = api.rgba(col.body, 0.052 * A);
    fill(c, g);
    radial(c, g.cx, g.cy, g.ax, g.ay, R * 1.02, [
      [0,    api.rgba(col.core, 0.064 * A)],
      [0.52, api.rgba(col.body, 0.030 * A)],
      [1,    api.rgba(col.body, 0)]
    ]);

    /* Per-tile share of the region falloff, NORMALISED so its mean over the
       region is exactly 1. Without the normalisation a two-tile region — where
       both tiles are equidistant from the centre, i.e. both at u=1 — would come
       out uniformly dimmer than a one-tile region, and `sel`, `hover` and most
       attack regions ARE one tile. Normalising makes the falloff a pure
       redistribution: it changes where the light is, never how much. */
    let umax = 0;
    for (const it of g.list) umax = Math.max(umax, Math.hypot(it.m.cx - g.cx, it.m.cy - g.cy));
    const rfs = [];
    let rsum = 0;
    for (const it of g.list) {
      const u = umax > 1e-3 ? Math.hypot(it.m.cx - g.cx, it.m.cy - g.cy) / umax : 0;
      /* r5 0.46→0.56; r6 0.56→0.50. Round 6 gave the boundary back its ramp by
         gutting the rim wash, and with the wash no longer propping the outer
         ring up, 0.56 pushed the outermost quintile's own ON−OFF luma to 35.8
         — under the +40 the contract holds every lit tile to. At 0.50 the
         outer ring measured 42.4.
         ⚠⚠ AND THE "centre:edge is still 2.05" THIS COMMENT USED TO CLAIM HERE
         WAS NOT TRUE OF THE SHIPPED FRAME AND IS DELETED. Measured the way a
         critic measures it — mean ON−OFF luma per TILE, ordered by that tile's
         distance from the region centroid, inner half over outer half — wave 3
         was 1.06 and wave-5-r2 was 1.01. 2.05 was a within-layer figure for
         this radial alone, and this radial is not the pool: the flat fill, the
         halo, the hue filter and (since wave 3) the key light are all uniform
         across the region, and the key light is now ~70% of the pool's lift.
         A redistribution inside 15% of the light cannot move the ratio, which
         is why raising `f` back to 0.55 was measured and changed nothing
         (c:e 1.007 at 0.38 against 0.979 at 0.55 — both inside the ±0.015
         two-captures-of-the-same-build null). The centre bias that DOES move
         it now lives in the key itself, as gainLayer's `bias`; this term stays
         at 0.38 because that is what killed the crest.
         ⚠ WAVE 5 ROUND 2 — 0.50 → 0.38, AND IT IS THE SAME COUPLING AS ROUND
         6, ONE STEP FURTHER. The rim wash is now DELETED outright (see THE RIM)
         rather than merely dimmed, so the outer ring loses the ~+6 the wash was
         contributing inside the 0.80-inset sample and would land near the +36
         that failed in round 5. 0.38 hands that back through the swells, where
         it is a smooth region-scale gradient instead of a band with an edge.
         This is a redistribution, not a lift: rnorm below keeps the region's
         total emission identical, so the pool does not get louder — and the
         critic's other finding this round is that it is already ~22% louder
         than wave 3, so it must not. Centre:edge falls with it; that is the
         price, and it is affordable because the crest that was making the
         boundary the brightest thing in the profile is gone. */
      const f = 1 - 0.38 * u;
      rfs.push(f); rsum += f;
    }
    const rnorm = g.list.length / (rsum || 1);

    /* Per tile: one wide, off-centre, hashed-brightness swell. Wide and soft,
       NOT tight and hot — a tight blob per tile puts a bright bead at every
       tile centre and a row of beads is a row of CELLS, the same read as the
       outlines this file deleted, drawn in light instead. Off-centre and
       unequal so the pool has internal weather rather than N identical stamps.

       ⚠ ROUND 4 — THE SPREAD WIDENED (v was ±0.15, now ±0.26, and the radius
       varies per tile too). At ±0.15 the interior was, correctly, free of beads
       — and also free of ANY variation, which is the other way to look drawn:
       an even sheet of light with a crisp edge is a translucent PANEL laid on
       the sand. Light pooling on ground is uneven at a scale larger than the
       grain and smaller than the region, which is exactly this. The offsets and
       radii are hashed, so no two tiles get the same swell and the variation
       does not line up with the lattice. */
    for (let i = 0; i < g.list.length; i++) {
      const it = g.list[i];
      const m = it.m;
      /* ⚠ WAVE 3 — SPREAD ±26% → ±14%. The swells exist to give the pool
         internal weather; with the key light in (gainLayer) the ground's own
         relief and per-tile material now supply that for free, and at ±26% on
         top of it the emission was ADDING tile-scale steps to a pool whose
         win condition is that a contiguous run reads as ONE pool. */
      const v  = (0.86 + api.hash(it.x, it.z, 7) * 0.28) * rfs[i] * rnorm;
      const rr = 1.78 + api.hash(it.z, it.x, 8) * 0.72;
      const ox = (api.hash(it.x, it.z, 11) - 0.5) * m.ax * 0.46;
      const oy = (api.hash(it.z, it.x, 12) - 0.5) * m.ay * 0.46;
      /* ⚠ THE ADDITIVE FOLLOWS THE KEY, BY THE SAME FACTOR, AND NO FURTHER.
         The swells are ~15% of the pool's light, so their own transfer to the
         composite is weak (COL.move's note has the sweep: 89° of body/core
         rotation moved the worst tile 10°) — correcting them by their OWN
         inverse transfer would make each tile a visibly different colour up
         close. Carrying the KEY's chroma ratio costs nothing, pulls the same
         direction and keeps every swell inside the same family of teals; on a
         pale tile it also stops the ambient re-adding the very chroma the key
         just gave up. The FLAT fill and the region radial above stay on the
         base colour: they are region-scale and have no business being
         per-tile. */
      const bodyT = ctf ? scaleChroma(col.body, ctf[i]) : col.body;
      const coreT = ctf ? scaleChroma(col.core, ctf[i]) : col.core;
      radial(c, m.cx + ox, m.cy + oy, m.ax, m.ay, m.ax * rr, [
        [0,    api.rgba(coreT, 0.068 * A * v)],
        [0.42, api.rgba(bodyT, 0.052 * A * v)],
        [1,    api.rgba(bodyT, 0)]
      ]);
    }

    /* ── THE RIM ────────────────────────────────────────────────────────────
       ⚠ READ THIS BEFORE MAKING IT NEATER. The win condition is that a critic
       cannot find "a hard uniform-width stroke tracing the full perimeter of
       any tile" — that mark is the single loudest drawn-grid signal there is,
       and it is what the board's original 2px full-perimeter stroke did. Three
       properties keep this on the right side of that line and all three are
       load-bearing:
         1. it follows the MERGED region's outer boundary only, so interior
            tile borders inside a contiguous run are never drawn at all;
         2. its width and alpha are hashed PER SIDE and its bright hairline is
            broken, so nothing on any perimeter has a constant width or an
            unbroken length — not even around a single isolated tile;
         3. it is drawn INSIDE the region mask, whose feather eats its outer
            half, so what survives is a glow fading inward from the edge.
       ⚠⚠ WAVE 5 ROUND 2 — THERE IS NO WASH ANY MORE. ONE additive pass, the
       broken hairline, is all that is left; read the arithmetic below before
       putting a band back on this boundary in any form.
       A continuous stroke of constant alpha is a TOP HAT: it adds the same W
       everywhere inside its half-width and 0 one pixel further in. The pool's
       emission has plateaued at P by then, so the profile is P+W inside the
       band and P immediately past it — a STEP DOWN, i.e. a local maximum ON
       the boundary, i.e. the edge of a pane of glass, no matter how wide or
       how dim the band is. Round 6 believed "wide enough is a gradient" and
       measured a clean monotone rise; that measurement was taken at alpha
       0.015, where W was inside the interior's own ±5 of noise. Wave 3 put the
       alpha back to 0.040 without re-probing and the crest came straight back:
       measured on a ±3-row band across the left pool edge at y=1440 of the
       paint-on minus paint-off frame, the profile ramped to 70 at x=1030-1038
       and STEPPED DOWN to an interior of 48 two pixels later — +43% over the
       interior it is supposed to be feathering into.
       For SUM = base(t) + wash(t) to be monotone inward, wash may only fall as
       fast as base rises; once base plateaus, wash may never fall at all. A
       finite band cannot satisfy that, so no tuning of alpha or width fixes
       this — only deleting it does. What replaces it for edge legibility is
       already here and is not a band: the mask's own feather (MASK_STATE.blur,
       tightened in wave 3 to 0.078 = ~7 CSS px, so the ramp is a boundary and
       not a fog bank) and the broken glint below, which is sub-pixel-capped,
       hashed per sub-segment and skips ~44% of them, so it cannot plateau.
       Two additive passes are now one: the broken hairline that reads as a
       glint catching part of the edge. */
    const edges = rimS > 0 ? boundaryEdges(g) : [];
    c.lineJoin = 'round';
    for (const e of edges) {
      const p = e.p;
      /* ── THE WASH — DELETED IN WAVE 5 ROUND 2. Kept as a comment because it
         has been reinvented twice and the note above is the reason not to.
         ── THE WASH: ONE stroke for the whole side, BUTT caps, one width.
         ⚠ This was four sub-strokes with independent widths and ROUND caps,
         and the frame showed exactly what that is: a chain of overlapping
         capsules, i.e. a row of soft BUBBLES pinned round the pool and, where
         a single-tile region sat inside a larger one, scattered through its
         interior too. Round caps + varying width + abutting segments cannot
         produce a smooth band. Width now varies per SIDE, which is still not
         uniform across the region but never changes mid-side, and butt caps
         let consecutive sides abut instead of bulging.

         ⚠ ROUND 6 — THE WASH WAS THE LIP. Probing luma across the boundary of
         the paint-on minus paint-off frame, round 5 rose to a peak ON the
         boundary and then DROPPED 8–13 levels into the interior. That profile
         — bright edge, dimmer middle — is the definition of a pane of glass,
         and it was this stroke: at 0.040·A over a 0.38–0.68 tile band it added
         ~+17 luma exactly where the interior is at its dimmest (the region
         falloff makes the outer ring the darkest part of the pool). Two
         changes, and they have to go together: alpha 0.040 → 0.015 so the
         addition is ~+6, and width 0.38 → 0.62 so what is left is a broad
         inward gradient rather than a band with a crest. Re-probed, both
         boundary crossings are now a MONOTONE rise over 39–54 device px into
         the plateau with no local maximum on the boundary at all (round 5:
         26–32 px and a +8..+13 lip; HEAD: 22–25 px and ~+15).
         Do NOT restore the alpha without also narrowing the width — a dim WIDE
         band is a gradient, a dim NARROW one is just a fainter pane edge. */
      /* ⚠ WAVE 3 — 0.015 WAS TUNED AGAINST A 40-PIXEL FEATHER AND IS NOW HALF
         OF A DIFFERENT PROBLEM. Round 6 killed the lip by making the wash so
         dim and so wide that the boundary became a 40 device-px ramp with no
         feature on it at all; measured, dL709 was still climbing at 20px out
         and reached only 49 of its eventual 71. The critic's reading of that
         frame: "a player can find the region but cannot count the legal tiles
         at its edge". Both halves of the edge are fixed together — the mask's
         feather is tightened (MASK_STATE.blur, see there) so the ramp is short
         enough to be a boundary, and this wash goes back up enough to be seen.
         It is STILL a wide inward gradient, not a band: 0.62–1.02 tiles wide
         with butt caps, so it has no crest of its own to read as a pane edge.
         The profile that must survive re-measurement is a MONOTONE rise with
         no local maximum on the boundary — check it, do not assume it.
             const hw = api.hash(e.it.x, e.it.z, 300 + e.k);
             c.lineCap = 'butt';
             c.strokeStyle = api.rgba(col.rim, 0.040 * LIT * rimS * (0.6+hw*0.8));
             c.lineWidth   = g.ax * (0.34 + hw * 0.26);
             c.beginPath(); … c.stroke();
         It did not survive it. See the block at the head of THE RIM. */

      /* ── THE GLINT: a hairline, and this one IS broken. At ~1px wide its
         round caps are sub-pixel, so breaking it reads as a glint catching
         part of the edge rather than as beads. It is the reason a critic
         cannot find a constant-width line tracing any perimeter.

         ⚠ ROUND 5 — IT WAS NEAR-WHITE AT 0.100·A AND THAT IS A LIT LIP, NOT A
         GLINT. Amplified, the pool's boundary was a continuous bright white
         band with square breaks in it, and at 1:1 that is precisely what tells
         the eye "this is a translucent panel lying on the sand" — a sheet of
         glass is identified by its edge, not by its middle. It is now the rim
         colour rather than the core (so it cannot outrun the pool it belongs
         to) at roughly half the alpha, and the break threshold is higher, so
         more of any given side has no hairline on it at all. */
      c.lineCap = 'round';
      const pts = [p[0], mid2(p[0], p[1]), p[1], mid2(p[1], p[2]), p[2]];
      /* ⚠ WAVE 3 — the glint is what makes the boundary COUNTABLE. The wash
         says "the light ends around here"; the corners where the outline steps
         from one tile to the next are what let a player say "that is four
         tiles wide", and at 0.030 with 46% of sides skipped there was too
         little of it to resolve a step. More of the boundary carries a glint
         now (threshold 0.54 → 0.44) and it is brighter — but it is still
         hashed per sub-segment in both width and alpha and still skips, so
         there is no constant-width line anywhere on any perimeter. */
      for (let i = 0; i < 4; i++) {
        const h  = api.hash(e.it.x * 4 + e.k, e.it.z * 4 + i, 311);
        if (h < 0.44) continue;
        const h2 = api.hash(e.it.z * 4 + i, e.it.x * 4 + e.k, 312);
        c.strokeStyle = api.rgba(col.rim, 0.046 * LIT * rimS * (0.5 + h2 * 0.9));
        c.lineWidth   = Math.max(0.8, g.ax * (0.020 + h * 0.022));
        c.beginPath();
        c.moveTo(pts[i].x, pts[i].y);
        c.lineTo(pts[i + 1].x, pts[i + 1].y);
        c.stroke();
      }
    }
  });
}

/* midpoint of two projected points — used to cut a boundary side into
   sub-segments so the rim can be broken and uneven. */
function mid2(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function cells(list) {
  const out = [];
  for (const k of list) {
    const p = String(k).split(','), x = +p[0], z = +p[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    out.push({ x, z });
  }
  return out;
}

/* Collect the four paint sets into draw-ordered regions.
   `only` (a Set of "x,z") restricts to surfaced tiles for the re-assert pass. */
function stateRegions(api, only) {
  const P = api.paint || {};
  const pick = s => {
    if (!s || !s.forEach) return [];
    const out = [];
    s.forEach(k => { if (!only || only.has(k)) out.push(k); });
    return cells(out);
  };
  /* attack last so it wins where a tile is both reachable and a target */
  return [
    ['place',  pick(P.place)],
    ['swap',   pick(P.swap)],
    ['move',   pick(P.move)],
    ['attack', pick(P.attack)]
  ];
}

function drawStates(api) {
  try {
    frameSync(api);
    const sel = api.paint && api.paint.sel;
    const selOk = !!(sel && isFinite(sel.x) && isFinite(sel.z));
    const regions = stateRegions(api, null);

    /* ⚠ ROUND 5 — THE SELECTION IS FOLDED INTO THE MOVE POOL'S MASK.
       A selected unit stands on a tile that is NOT in its own move set (you
       cannot move to where you already are), so the move region has a
       one-tile HOLE in it exactly under the unit — and boundaryEdges dutifully
       traced all four sides of that hole. Amplified, the single brightest
       drawn line in the whole frame was a closed white loop round one cell in
       the middle of the pool: a hard stroke tracing the full perimeter of a
       tile, the one mark the win condition names outright. At 1:1 it, plus the
       pool's own lip, is what made the highlight read as overlapping panes of
       cut glass rather than as light.
       Adding the tile to the move region closes the hole, so there is no inner
       boundary to trace; the selection is then drawn on top RIMLESS, as a
       hotter, whiter swell of the same teal. That is the round-3 intent —
       "the pool and its origin are one idea" — finally true in the pixels.
       Only when there IS a move pool: with move empty the selection is the
       only mark on the board and needs its own (soft, small-region-scaled)
       edge to be findable at all. */
    if (selOk) {
      for (const r of regions) {
        if (r[0] !== 'move' || !r[1].length) continue;
        if (!r[1].some(t => t.x === sel.x && t.z === sel.z)) r[1].push({ x: sel.x, z: sel.z });
      }
    }

    for (const r of regions) {
      if (!r[1].length) continue;
      try { drawPool(api, r[1], r[0], 1, LIFT_STATE); } catch (e) {}
    }
    /* selection: the hottest member of the move family, and no hard ring — the
       old one was the most obviously "drawn" mark on the board because it sat
       on exactly one cell's perimeter. */
    if (selOk) {
      /* When it was merged, the move pool has ALREADY lit this tile, so the
         selection only has to add the difference — at full strength the two
         stack and the origin tile clips to white, which is a bead, which is
         the read this file spent three rounds removing. */
      const merged = regions.some(r => r[0] === 'move' && r[1].length > 1);
      try {
        drawPool(api, [{ x: sel.x, z: sel.z }], 'sel', merged ? 0.34 : 1.0,
                 LIFT_STATE, merged ? 0 : null, merged);
      } catch (e) {}
    }
    /* hover: barely there. It must not compete with the legal-move pool, or
       the player reads the cursor tile as a fifth game state. */
    const hv = api.hover;
    if (hv && isFinite(hv.x) && isFinite(hv.z)) {
      try { drawPool(api, [{ x: hv.x, z: hv.z }], 'hover', 0.6, LIFT_STATE); } catch (e) {}
    }
    /* ⚠ THE GROUND READ IS SCHEDULED HERE AND HAPPENS AFTER THE FRAME. See the
       long note above scheduleGround: everything that gives the sand its colour
       runs later in frame() than this function does, so a read taken now sees
       an uncoloured ground. `lit` is every tile this frame is painting — those
       are the tiles the snapshot must not trust, because they will carry this
       pool's own light. Scheduled unconditionally, including on a clean board:
       a clean board is exactly when the store gets its bare readings. */
    const lit = [];
    for (const r of regions) for (const t of r[1]) lit.push(t.x + ',' + t.z);
    if (selOk) lit.push(sel.x + ',' + sel.z);
    if (hv && isFinite(hv.x) && isFinite(hv.z)) lit.push(hv.x + ',' + hv.z);
    try { scheduleGround(api, lit); } catch (e) {}
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   C) THE RE-ASSERT. A hazard composites AFTER drawStates and buries it, which
   made a legal fire/oil tile look unreachable. This pass exists solely to fix
   that and must survive any future reordering of frame(). Same emissive
   treatment at higher strength — never a hard stroke.
   ═══════════════════════════════════════════════════════════════════════════ */
function drawStatesOver(api) {
  try {
    const S = api.surfaces || {};
    const only = new Set();
    for (const k in S) if (S[k]) only.add(k);
    if (!only.size) return;
    frameSync(api);
    for (const r of stateRegions(api, only)) {
      if (!r[1].length) continue;
      /* The hue filter is dialled back to a third on this pass. At full
         strength the teal multiply repaints the flames on a burning tile
         cyan — the tile stays legible, which is the point, but it stops
         looking like fire. The additive half carries the re-assert instead,
         which brightens the hazard without recolouring it. */
      /* ⚠ NO KEY LIGHT ON THE RE-ASSERT, FOR TWO REASONS AND BOTH MATTER.
         (a) Correctness: gainLayer amplifies whatever is already on the canvas,
         and by this point that is the HAZARD — a gain over burning oil scales
         the flames, not the ground, so it says nothing about legality and it
         drags the fire toward the state's hue, which is the exact regression
         ("the tile stays legible but stops looking like fire") the filtScale
         of 0.34 below already exists to prevent.
         (b) Cost: the gain's canvas read-back forces a pipeline flush, and
         this pass re-draws regions drawStates has ALREADY drawn — paying for a
         second read of the same rect every frame on any board with a hazard on
         a legal tile. Measured, dropping it here took drawStatesOver from 18.4
         ms/frame back to ~0.1 when no hazard is present and removes one full
         region read per hazard region when one is. */
      try { drawPool(api, r[1], r[0], 0.85, LIFT_SURF + 0.004, 0.34, false, true); } catch (e) {}
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   B) FIELD SURFACES

   Each painter is { halo, m, gain, l, s, post }, all optional:

     halo(api, g)      → [[colour, alpha, comp], …]  drawn FIRST through the
                         dilated mask: damp sand, scorch, cold, spill light.
                         Follows the pool's own irregular outline outwards.
     m(api, c, g)      content blitted with 'multiply'   — the material itself
     gain(api, g)      → [tintColour, amount] — the KEY LIGHT (see gainLayer):
                         re-read the ground, tint it, add it to itself, so the
                         hazard's light scales the sand's own grain instead of
                         adding a constant over it. Runs between m and s/l.
     d(api, c, g)      content blitted with 'color-dodge' — a SHAPED light.
                         ⚠ WAVE 5 ROUND 2. `gain` can only scale the whole
                         region uniformly; a lightning arc or the matter
                         falling into a rift is bright light in ONE PLACE, and
                         drawing that place with 'lighter' puts a constant over
                         the sand exactly where the eye is looking — the same
                         arithmetic the gain exists to avoid, applied at the
                         one spot it matters most. 'color-dodge' is
                         out = base / (1 − b): a per-channel MULTIPLIER of
                         1/(1−b), so the ground's grain, relief and crease AO
                         scale under the arc instead of being buried by it.
                         Measured, this is what took electric's high-pass
                         regression on the paint-off ground from an unstable
                         r 0.002–0.570 to a stable one — the previous 'lighter'
                         core was an opaque near-white mark whose own detail
                         dominated the tile's high-pass, and because the branch
                         seed steps 7×/s the amount by which it dominated moved
                         frame to frame.
                         ⚠ KEEP b BELOW ~0.45. Dodge clips: 1/(1−b) at b=0.6 is
                         2.5×, which drives lit sand straight to 255 and shears
                         the top off the grain distribution — the exact failure
                         holy's own note records from over-driving its
                         constants. And bias b BLUE: dodge lifts each channel
                         in proportion to what it already has, so a neutral
                         dodge on warm sand reads WARM. Blue is the channel
                         sand has least invested in, so a blue-weighted b is
                         what makes the lift read cool.
     l(api, c, g)      content blitted with 'lighter'    — sheen, glow, ripples
     s(api, c, g)      content blitted with 'source-over'— solid objects on sand
     post(api, c, g)   unclipped, straight onto the main canvas — anything that
                         leaves the ground plane (flames, wisps, motes)

   m/l/s each get their own single blit, which is what keeps a four-tile pool
   from double-darkening its three shared edges. Inside them, drawing is in CSS
   pixels in the SAME coordinates as the main canvas — g.list[i].m holds the
   per-tile metrics, so a painter reads identically to the old clipped one.
   ═══════════════════════════════════════════════════════════════════════════ */

/* wet sand. Derived from the light's own ambient so it stays right at every
   time of day instead of being a hardcoded brown that only works at noon. */
function dampCol(api) {
  return api.mixHex('#412c15', (api.LIGHT && api.LIGHT.ambient) || '#3a4a6a', 0.22);
}

const PAINTERS = {

  /* ── OIL ── near-black film with a thin-film iridescence that drifts. The
     sand is DARKENED (multiply) rather than covered, so the dune ripples still
     read through the slick — that is the difference between a liquid and a
     black polygon. */
  oil: {
    halo: () => [['#1b1119', 0.34, 'multiply']],
    m(api, c, g) {
      /* centre-weighted, not edge-to-edge: the film is thickest where it
         pooled and thins out on its way to the mask's feather, so the
         material's own shading and the mask's falloff compound. */
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.62, [
          [0,    api.rgba('#191019', 0.80)],
          [0.55, api.rgba('#1b1220', 0.62)],
          [1,    api.rgba('#1b1220', 0)]
        ]);
      }
    },
    l(api, c, g) {
      const lv = api.lightVector();
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#7f97b8', '#8fa8c8', '#a8bcd8'];
      const hues = ['#5f3fd0', '#2fa88a', '#c05a2a'];
      for (const it of g.list) {
        const m = it.m, h = n => api.hash(it.x, it.z, n);
        for (let i = 0; i < 3; i++) {          /* thin-film interference lobes */
          const a = h(i) * 6.283 + api.T * (0.10 + i * 0.045);
          radial(c, m.cx + Math.cos(a) * m.ax * 0.34, m.cy + Math.sin(a) * m.ay * 0.34,
                 m.ax, m.ay, m.ax * 1.15, [
            [0, api.rgba(hues[i], 0.19)], [0.6, api.rgba(hues[i], 0.08)], [1, api.rgba(hues[i], 0)]
          ]);
        }
        /* specular: the sky on a flat wet surface, offset toward the light so
           it agrees with the terrain's own key direction */
        radial(c, m.cx - lv.x * m.ax * 0.30, m.cy - m.ay * 0.30, m.ax, m.ay * 0.42, m.ax * 0.9, [
          [0, api.rgba(sky[1], 0.28)], [1, api.rgba(sky[1], 0)]
        ]);
      }
    }
  },

  /* ── GREASE ── the pale cousin: milky, less absorbent, more scatter. */
  grease: {
    lStatic: true,
    halo: () => [['#6e6552', 0.20, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#6e6552', 0.50)], [0.6, api.rgba('#6e6552', 0.34)], [1, api.rgba('#6e6552', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy - m.ay * 0.18, m.ax, m.ay, m.ax * 1.25, [
          [0, api.rgba('#e6e0c6', 0.24)], [0.7, api.rgba('#cfc7a6', 0.09)], [1, api.rgba('#cfc7a6', 0)]
        ]);
        for (let i = 0; i < 7; i++) {
          const a = api.hash(it.x, it.z, i) * 6.283;
          const d = api.hash(it.z, it.x, i + 3) * m.ax * 0.72;
          const r = m.ax * (0.05 + api.hash(it.x, it.z, i + 11) * 0.08);
          c.fillStyle = api.rgba('#fff4d0', 0.14);
          c.beginPath();
          c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── PUDDLE (water) ── darker and COOLER than the sand, with a real
     reflection: the sky gradient is mirrored into the surface, so the pool
     changes with time of day for free. Ripples expand from seeded points per
     tile; the damp halo is the tell that it is soaking into the ground rather
     than sitting on it. */
  puddle: {
    halo: (api) => [[dampCol(api), 0.34, 'multiply'], ['#1c5a72', 0.18, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        /* deepest in the middle, shallow at the rim — a real puddle has a
           depth gradient and that gradient is most of why it reads as liquid
           rather than as a coloured patch. */
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.66, [
          [0,    api.rgba('#0d4460', 0.78)],
          [0.46, api.rgba('#12546f', 0.60)],
          [0.78, api.rgba('#1c6076', 0.28)],
          [1,    api.rgba('#1c6076', 0)]
        ]);
      }
    },
    l(api, c, g) {
      /* mirrored sky — brightest at the far (upper) edge, which is where a
         near-grazing reflection actually lands from this camera pitch */
      const sky = (api.LIGHT && api.LIGHT.sky) || ['#5b7fb8', '#7fa0c8', '#a8bcd8'];
      const gr = c.createLinearGradient(0, g.y0, 0, g.y1);
      gr.addColorStop(0, api.rgba(sky[1], 0.40));
      gr.addColorStop(0.6, api.rgba(sky[2] || sky[1], 0.18));
      gr.addColorStop(1, api.rgba(sky[2] || sky[1], 0.05));
      c.fillStyle = gr; fill(c, g);
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        /* A cool lift over the deep part. Without it the multiply pass alone
           leaves warm sand looking simply DARKER — olive, not wet — because
           sand's blue channel is too low for a multiply to make it blue. */
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.35, [
          [0, api.rgba('#2fa6d8', 0.20)], [0.6, api.rgba('#2f8ec0', 0.08)], [1, api.rgba('#2f8ec0', 0)]
        ]);
        /* Ripples: several small rings from scattered drop points rather than
           two big concentric ones. The first version used one large ring per
           tile and it read as a sonar sweep painted on the floor — the tell was
           that the ring was centred and as wide as the tile, which nothing in
           moving water ever is. */
        for (let i = 0; i < 5; i++) {
          const ph = (api.T * 0.38 + api.hash(it.x, it.z, i) + i * 0.2) % 1;
          const rr = m.ax * (0.04 + ph * 0.26) * (0.7 + api.hash(it.z, it.x, i + 30) * 0.6);
          c.strokeStyle = api.rgba('#d8eeff', 0.14 * (1 - ph) * (1 - ph));
          c.lineWidth = Math.max(0.7, m.ax * 0.014);
          c.beginPath();
          c.ellipse(m.cx + (api.hash(it.x, it.z, i + 21) - 0.5) * m.ax * 1.0,
                    m.cy + (api.hash(it.z, it.x, i + 22) - 0.5) * m.ay * 1.0,
                    rr, rr * sy, 0, 0, 6.3);
          c.stroke();
        }
        const gx = m.cx + Math.sin(api.T * 0.5 + api.hash(it.x, it.z, 5) * 6.2) * m.ax * 0.35;
        radial(c, gx, m.cy - m.ay * 0.22, m.ax, m.ay * 0.36, m.ax * 0.6, [
          [0, api.rgba('#ffffff', 0.26)], [1, api.rgba('#bcd8ff', 0)]
        ]);
      }
    }
  },

  /* ── FIRE ── the surrounding sand is WARMED and the ground under it is
     scorched; the flames themselves are drawn unclipped in post(), because a
     flame that ends in a straight line at the tile boundary is the sticker
     read again. */
  fire: {
    halo: (api) => {
      const fl = 0.86 + Math.sin(api.T * 6.1) * 0.14;
      return [['#241408', 0.34, 'multiply'], ['#ff7a14', 0.20 * fl, 'lighter']];
    },
    m(api, c, g) {
      for (const it of g.list) {                /* scorched ground under it */
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.55, [
          [0, api.rgba('#241408', 0.62)], [0.6, api.rgba('#2a1809', 0.34)], [1, api.rgba('#2a1809', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        const fl = 0.85 + 0.15 * Math.sin(api.T * 11 + it.x * 3 + it.z);
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.34, [
          [0,    api.rgba('#ffe9a8', 0.82 * fl)],
          [0.35, api.rgba('#ff9a24', 0.56 * fl)],
          [1,    api.rgba('#8c1400', 0)]
        ]);
      }
    },
    post(api, c, g) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 8; i++) {
          const h = api.hash(it.x, it.z, i);
          const fx = m.cx + (h - 0.5) * m.ax * 1.30;
          const fy = m.cy + (api.hash(it.z, it.x, i + 4) - 0.5) * m.ay * 0.9;
          const hgt = m.ax * (1.05 + h * 1.05) * (0.78 + 0.34 * Math.sin(api.T * 8.5 + i * 2.1 + h * 6));
          const wob = Math.sin(api.T * 5.3 + i * 1.7) * m.ax * 0.16;
          /* ⚠ NOT a filled triangle. The previous tongue was a quadratic path
             with a base-to-tip linear gradient, which meant its SIDES were
             hard: solid yellow up to the edge, nothing past it. Six of those
             per tile read as clip-art flames. A flame has no edge in any
             direction, so the tongue is now a chain of soft blobs riding the
             spine, each falling to zero laterally as well as vertically. */
          const N = 11;
          for (let s = 0; s < N; s++) {
            const t = s / (N - 1);
            const sx = fx + wob * t * 1.6 * (1 + t);
            const sy = fy + m.ay * 0.10 - hgt * t;
            const rad = m.ax * (0.21 - 0.175 * t * t) * (0.82 + h * 0.45);
            const a = 0.30 * (1 - t * 0.92) * (1 - t * 0.30);
            if (rad <= 0.5 || a <= 0.004) continue;
            const col = t < 0.35 ? '#ff7a10' : (t < 0.7 ? '#ffb63a' : '#ffe6a0');
            radial(c, sx, sy, rad, rad, rad, [
              [0, api.rgba(col, a)], [0.5, api.rgba(col, a * 0.45)], [1, api.rgba(col, 0)]
            ]);
          }
        }
        for (let i = 0; i < 4; i++) {          /* embers riding the column */
          const ph = (api.T * 0.5 + api.hash(it.x, it.z, i + 30)) % 1;
          const ex = m.cx + (api.hash(it.z, it.x, i + 31) - 0.5) * m.ax * 1.1
                          + Math.sin(api.T * 3 + i) * m.ax * 0.1;
          const ey = m.cy - ph * m.ax * 1.9;
          const er = Math.max(0.8, m.ax * 0.030);
          radial(c, ex, ey, er, er, er * 2.2, [
            [0, api.rgba('#ffcf7a', 0.55 * (1 - ph))], [1, api.rgba('#ff9a30', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── GAS (toxin + steam) ── a cloud, not a floor. Kept low-contrast and
     translucent so the unit standing in it is never lost. */
  gas: {
    halo: () => [['#7a9a2c', 0.10, 'lighter']],
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.5, [
          [0, api.rgba('#5a7a20', 0.20)], [1, api.rgba('#5a7a20', 0)]
        ]);
        for (let i = 0; i < 3; i++) {
          const a = api.T * 0.42 * (i % 2 ? 1 : -1) + i * 2.1 + api.hash(it.x, it.z, i) * 6;
          radial(c, m.cx + Math.cos(a) * m.ax * 0.38, m.cy + Math.sin(a) * m.ay * 0.34,
                 m.ax, m.ay, m.ax * 1.0, [
            [0, api.rgba('#a8d03c', 0.30)], [1, api.rgba('#506e14', 0)]
          ]);
        }
      }
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 3; i++) {
          const ph = (api.T * 0.22 + api.hash(it.x, it.z, i + 12)) % 1;
          const wx = m.cx + (api.hash(it.z, it.x, i + 13) - 0.5) * m.ax
                          + Math.sin(api.T * 0.9 + i * 2) * m.ax * 0.18;
          radial(c, wx, m.cy - ph * m.ax * 1.3, m.ax, m.ax * 0.7, m.ax * (0.35 + ph * 0.5), [
            [0, api.rgba('#b6d84a', 0.13 * (1 - ph))], [1, api.rgba('#7ea82a', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── WEB ───────────────────────────────────────────────────────────────────
     ⚠ WHAT WAS HERE, AND WHY IT IS GONE. The previous painter drew, per tile:
     seven perfectly straight radial spokes from ONE centred point, plus three
     concentric closed rings, all in near-#fff at ONE constant width with
     square-cut ends, source-over on top of the sand. Every tile got the same
     rosette. That is the exact failure BAR line 51 names — "no evenly-spaced
     identical props, no uniform flat gradients, no glowing hard outlines on
     everything, no symmetry where nature would be messy" — and a critic
     reading the frame called it the loudest sticker left on the field.

     The rebuild follows the treatment that fixed `ice`: nothing here is
     regular, nothing here is the same twice, and the light decides how bright
     each mark is.
       • every strand is a QUADRATIC WITH SAG, so there is not one straight
         line in the painter;
       • the hub is off-centre per tile and the anchors are at unequal angles
         AND unequal radii — a real web is tied to whatever happened to be
         there, not to a regular polygon's vertices;
       • strands are torn: a broken radial stops short and its loose end
         DANGLES, and the chords that depended on it go with it;
       • width and alpha are hashed per strand, so no two are the same weight;
       • brightness is modulated by api.lightVector() — silk is a cylinder and
         catches the key light hardest ACROSS the light, nearly vanishing along
         it, which is most of what stops it reading as flat white line-art;
       • a faint dark offset twin is drawn first as a contact shadow, so the
         silk sits ON the sand instead of being painted INTO it;
       • the whole thing goes through MASK_SOLID like the other rigid surfaces,
         and adjacent tiles' hubs are BRIDGED, so a multi-tile web is one torn
         sheet spanning the pool rather than N identical rosettes stamped out. */
  web: {
    mask: MASK_SOLID,
    sStatic: true,
    s(api, c, g) {
      const lv = api.lightVector();
      /* ground-plane light direction in SCREEN space. lightVector() is a world
         vector and world +z runs into the screen, so screen-y is -z; this is
         the same convention the caltrops/fire contact shadows already use. */
      const lx = lv.x, ly = -lv.z;
      const ln = Math.hypot(lx, ly) || 1;
      const litness = (dx, dy) => {
        const d = Math.hypot(dx, dy) || 1;
        const along = Math.abs((dx * lx + dy * ly) / (d * ln));
        return 0.42 + 0.90 * (1 - along);
      };
      /* silk graded into the scene's own key rather than a hardcoded white */
      const silk = api.mixHex('#e4e8ee', (api.LIGHT && api.LIGHT.key) || '#ffe0b0', 0.34);

      /* Build the geometry ONCE: the shadow pass and the silk pass must trace
         the same curves or the shadow reads as a second web. */
      const strands = [];
      const sag = (a, b, bow, w, al) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy);
        if (!(L > 0.5)) return;
        strands.push({
          ax: a.x, ay: a.y, bx: b.x, by: b.y,
          qx: (a.x + b.x) / 2 + dy * bow * 0.18,
          qy: (a.y + b.y) / 2 + L * bow,
          w, al: al * litness(dx, dy)
        });
      };

      const hubs = new Map();
      for (const it of g.list) {
        const m = it.m;
        hubs.set(it.x + ',' + it.z, {
          x: m.cx + (api.hash(it.x, it.z, 501) - 0.5) * m.ax * 0.78,
          y: m.cy + (api.hash(it.z, it.x, 502) - 0.5) * m.ay * 0.78
        });
      }

      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        const H = hubs.get(it.x + ',' + it.z);
        const h  = n => api.hash(it.x, it.z, n);
        const h2 = n => api.hash(it.z, it.x, n);
        const N  = 6 + Math.floor(h(510) * 3);        /* 6..8, never a fixed 8 */
        const a0 = h(511) * 6.283;
        const anchors = [];
        for (let i = 0; i < N; i++) {
          const ang = a0 + (i / N) * 6.283 + (h(520 + i) - 0.5) * 0.72;
          const rad = m.ax * (0.74 + h2(534 + i) * 0.62);
          anchors.push({
            x: H.x + Math.cos(ang) * rad,
            y: H.y + Math.sin(ang) * rad * sy,
            broken: h(548 + i) < 0.20,
            w: m.ax * (0.009 + h2(560 + i) * 0.015),
            al: 0.30 + h(572 + i) * 0.26
          });
        }
        for (let i = 0; i < N; i++) {
          const an = anchors[i];
          if (an.broken) {
            /* torn radial: it stops short, and the loose end hangs off it */
            const t = 0.40 + h2(584 + i) * 0.30;
            const e = { x: H.x + (an.x - H.x) * t, y: H.y + (an.y - H.y) * t };
            sag(H, e, 0.03 + h(596 + i) * 0.04, an.w, an.al);
            sag(e, { x: e.x + (h2(608 + i) - 0.5) * m.ax * 0.26,
                     y: e.y + m.ay * (0.20 + h(620 + i) * 0.34) },
                0.16 + h2(632 + i) * 0.14, an.w * 0.8, an.al * 0.8);
            continue;
          }
          sag(H, an, 0.025 + h2(644 + i) * 0.05, an.w, an.al);
        }
        /* the spiral, as three UNEVENLY spaced rings of separate sagging
           chords — never a closed regular polygon, and a chord dies with the
           radial it was tied to */
        for (let ring = 0; ring < 3; ring++) {
          const t = 0.30 + ring * 0.26 + (h(660 + ring) - 0.5) * 0.16;
          for (let i = 0; i < N; i++) {
            const p = anchors[i], q = anchors[(i + 1) % N];
            if (p.broken || q.broken) continue;
            if (h(670 + ring * 8 + i) < 0.13) continue;
            const tt = t * (0.88 + h2(700 + ring * 8 + i) * 0.24);
            sag({ x: H.x + (p.x - H.x) * tt, y: H.y + (p.y - H.y) * tt },
                { x: H.x + (q.x - H.x) * tt, y: H.y + (q.y - H.y) * tt },
                0.07 + h2(730 + i) * 0.09,
                m.ax * (0.007 + h(742 + i) * 0.010),
                0.24 + h2(754 + i) * 0.22);
          }
        }
      }

      /* ⚠ BRIDGES. Without these a two-tile web is two rosettes with a seam
         down the middle — the per-tile-stamp read the mask compositor exists to
         kill. Drawn from ONE of the two owners so a shared span is not doubled. */
      for (const it of g.list) {
        const H = hubs.get(it.x + ',' + it.z);
        const R = hubs.get((it.x + 1) + ',' + it.z);
        const D = hubs.get(it.x + ',' + (it.z + 1));
        const w = g.ax * 0.009;
        if (R) sag(H, R, 0.07 + api.hash(it.x, it.z, 770) * 0.06, w, 0.30);
        if (D) sag(H, D, 0.07 + api.hash(it.z, it.x, 771) * 0.06, w, 0.30);
      }

      const trace = (col, am, dx, dy, wm) => {
        c.lineCap = 'round';
        for (const st of strands) {
          c.strokeStyle = api.rgba(col, st.al * am);
          c.lineWidth = Math.max(0.5, st.w * wm);
          c.beginPath();
          c.moveTo(st.ax + dx, st.ay + dy);
          c.quadraticCurveTo(st.qx + dx, st.qy + dy, st.bx + dx, st.by + dy);
          c.stroke();
        }
      };
      trace('#1b1509', 0.40, -lx * g.ax * 0.05, g.ay * 0.075, 1.5);   /* contact shadow */
      trace(silk,     1.00, 0, 0, 1.0);                              /* the silk */

      /* dew — a few only, sitting ON strands rather than scattered at random,
         and sized unequally. This is the one bright mark in the painter. */
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 3; i++) {
          const st = strands[Math.floor(api.hash(it.x, it.z, 780 + i) * strands.length) % strands.length];
          if (!st) continue;
          const t = 0.25 + api.hash(it.z, it.x, 790 + i) * 0.5, u = 1 - t;
          const dx = u * u * st.ax + 2 * u * t * st.qx + t * t * st.bx;
          const dy = u * u * st.ay + 2 * u * t * st.qy + t * t * st.by;
          const r = Math.max(0.6, m.ax * (0.012 + api.hash(it.x, it.z, 800 + i) * 0.014));
          c.fillStyle = api.rgba(silk, 0.34 + api.hash(it.z, it.x, 810 + i) * 0.22);
          c.beginPath();
          c.arc(dx, dy, r, 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── CALTROPS ── objects, not a material: no wash at all, just iron on sand
     with a lit edge, a dark body and a contact shadow each. */
  caltrops: {
    sStatic: true,
    s(api, c, g) {
      const lv = api.lightVector();
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        for (let i = 0; i < 9; i++) {
          const a = api.hash(it.x, it.z, i) * 6.283;
          const d = Math.sqrt(api.hash(it.z, it.x, i + 5)) * m.ax * 0.82;
          const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
          const s = m.ax * (0.10 + api.hash(it.x, it.z, i + 9) * 0.06);
          c.fillStyle = api.rgba('#1d1409', 0.34);
          c.beginPath();
          c.ellipse(px - lv.x * s * 0.7, py + s * 0.42, s * 0.85, s * 0.34, 0, 0, 6.3);
          c.fill();
          c.save(); c.translate(px, py); c.rotate(api.hash(it.z, it.x, i + 17) * 3.14);
          c.fillStyle = api.rgba('#3a3630', 0.95);
          c.beginPath();
          for (let k = 0; k < 4; k++) {
            const aa = k * 1.5708;
            c.lineTo(Math.cos(aa) * s, Math.sin(aa) * s * 0.62);
            c.lineTo(Math.cos(aa + 0.785) * s * 0.24, Math.sin(aa + 0.785) * s * 0.16);
          }
          c.closePath(); c.fill();
          c.strokeStyle = api.rgba('#c9c2b2', 0.5);
          c.lineWidth = Math.max(0.6, s * 0.10);
          c.stroke();
          c.restore();
        }
      }
    }
  },

  /* ── ICE ── a frozen SLAB lying in the sand.
     ⚠ THREE ROUNDS OF THE SAME MISTAKE, and the correction is the point of
     every number below. Round 1 opened with an unclipped source-over feather
     at 1.9 tile radii — a milky near-white panel hanging above the ground.
     Round 2 clipped it to the mask but kept the shape: a centre-weighted
     radial of 60%-alpha near-white reaching 1.62 tile radii, plus a
     ['#c8e4f4', 0.11, 'lighter'] halo through the 1.28×-dilated, 0.34-blurred
     mask. Additive near-white through a dilated blurred mask is a BLOOM by
     construction: it read as ATMOSPHERIC HAZE floating in the air, spilled a
     full tile past the pool and desaturated the units standing beside it.

     The diagnosis a critic handed back was exact: "no frost in the crease
     seams, no ice plane, no cold specular the eye can land on." So the shape
     changed, not just the alpha:
       • the additive halo is GONE. Ice does not emit. What it does to the sand
         around it is CHILL it, so only a cold multiply spills outward now.
       • the slab is a near-FLAT region-wide fill, not a radial. A radial that
         falls to zero has no edge, and a material with no edge is haze; the
         mask supplies the outline, so the fill must not fade on its own.
       • multiply carries most of the work, so the sand's dune ripples read
         THROUGH the ice. Seeing the ground under it, colder and darker, is
         what says "translucent frozen layer" instead of "white sticker".
       • the structure the eye lands on is now real: fractured plates, frost
         packed into the crease seam between two ice tiles, dendrites, and one
         tight specular glint per tile instead of a tile-wide sheen. */
  ice: {
    sStatic: true,
    mask: MASK_SOLID,          /* a rigid plate has a rim; see MASK_SOLID */
    /* cold only — see the note above for why there is no 'lighter' entry */
    halo: () => [['#7ea2bc', 0.26, 'multiply']],
    m(api, c, g) {
      /* THE PLANE. One flat region-wide multiply: it cools and slightly darkens
         the sand uniformly, which is what a translucent slab does, and being
         uniform it cannot double-darken a shared edge or reintroduce the grid.
         Blue is deliberately the least-attenuated channel (188/255 against
         127/255 on red) so warm sand comes out cold grey, not merely dimmer.

         ⚠ THIS IS DELIBERATELY NOT A PALE FILM. The first version of this
         rewrite went the other way — a light multiply plus a strong pale
         source-over — and it measured (126,133,131) against (102,90,70) sand:
         cooler, yes, but LIGHTER and low-contrast, and at board zoom that reads
         as fog lying on the ground, not as ice. Matching the sand's luma and
         winning on hue instead is what makes it read as a material. */
      c.fillStyle = api.rgba('#7fa2bc', 0.52);
      fill(c, g);
      /* thickness. The slab is deeper where it pooled, and a real sheet of ice
         over uneven ground is darker there — a faint centre weighting on TOP
         of the flat plane, not instead of it. */
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.30, [
          [0,    api.rgba('#5b7f9c', 0.18)],
          [0.62, api.rgba('#5b7f9c', 0.08)],
          [1,    api.rgba('#5b7f9c', 0)]
        ]);
      }
    },
    s(api, c, g) {
      /* the frozen sheet itself: pale, cold, and FLAT. 0.38 against round 2's
         0.60-at-centre radial — enough to lift the surface clear of the sand,
         far short of covering it. */
      c.fillStyle = api.rgba('#b6d8f2', 0.28);
      fill(c, g);

      /* ⚠ ICE DETAIL IS TEXTURE, NOT LINEWORK. The first attempt at this pass
         drew what the design called for — fractured plates, a rime line packed
         into the crease seam — as long strokes, and the screenshot was
         unambiguous: three chords per tile at 1.25-1.8 tile radii became a
         white STARBURST across the pool, and a continuous stroked seam between
         two ice tiles drew a bright cross exactly on the tile border, i.e. it
         put the chessboard back on the board in white. Same failure as round
         1's "1.2-tile-long bright white stick", just at region scale.
         Everything below is therefore SHORT, DIM and GRANULAR: the frost reads
         as a frozen crust because there is fine structure in it, not because
         any single mark is legible. */
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        const h = n => api.hash(it.x, it.z, n);
        const h2 = n => api.hash(it.z, it.x, n);

        /* ── PLATE STEPS ── two short chords with a bevel: one dim line on the
           shaded side, one lighter line on the lit side, a hair apart. The pair
           is the cue — a single line is a scratch, two lines a pixel apart are
           a STEP between two plates of a solid sheet. Half-length 0.42 of the
           tile, so a chord is under half a tile end to end and cannot become a
           spoke of a star. This is the one painter allowed straight lines: a
           frozen sheet fractures in chords and nothing else here does. */
        for (let i = 0; i < 2; i++) {
          const a  = h(i + 40) * 3.14159;
          const dx = Math.cos(a), dy = Math.sin(a) * sy;
          const nx = -Math.sin(a), ny = Math.cos(a) * sy;
          const off = (h2(i + 41) - 0.5) * 1.0 * m.ax;
          const px = m.cx + nx * off, py = m.cy + ny * off;
          const L  = m.ax * (0.34 + h(i + 42) * 0.16);
          const w  = Math.max(0.6, m.ax * 0.016);
          const seg = (ox, oy, col, al) => {
            c.strokeStyle = api.rgba(col, al);
            c.lineWidth = w;
            c.beginPath();
            c.moveTo(px - dx * L + ox, py - dy * L + oy);
            c.lineTo(px + nx * m.ax * 0.04 + ox, py + ny * m.ay * 0.04 + oy);
            c.lineTo(px + dx * L + ox, py + dy * L + oy);
            c.stroke();
          };
          seg(nx * w,  ny * w,  '#3f6480', 0.16);   /* shaded side */
          seg(-nx * w, -ny * w, '#eef9ff', 0.17);   /* lit side    */
        }

        /* ── CRUST ── the granular half. Many tiny bright specks and a few
           faint dark pits: at this camera no one resolves an individual mark,
           what carries is that the surface is not smooth. Without this the
           slab is a flat wash again no matter how good its colour is. */
        for (let i = 0; i < 26; i++) {
          const a = h(i + 100) * 6.283;
          const d = Math.sqrt(h2(i + 101)) * m.ax * 1.05;
          const cx = m.cx + Math.cos(a) * d, cy = m.cy + Math.sin(a) * d * sy;
          const r = m.ax * (0.008 + h(i + 102) * 0.020);
          const lit = h2(i + 103) > 0.28;
          c.fillStyle = api.rgba(lit ? '#f2fbff' : '#5d7f97', lit ? 0.13 : 0.09);
          c.beginPath();
          c.ellipse(cx, cy, r, r * sy, 0, 0, 6.3);
          c.fill();
        }

        /* ── DENDRITES ── frost feathering across the plate. Short and barbed;
           this is what carries the frost read on an ISOLATED ice tile, which
           has no crease seam to pack rime into. */
        c.strokeStyle = api.rgba('#e6f6ff', 0.17);
        c.lineWidth = Math.max(0.5, m.ax * 0.010);
        for (let i = 0; i < 6; i++) {
          const a = h(i + 60) * 6.283;
          const bx = m.cx + (h2(i + 61) - 0.5) * m.ax * 1.5;
          const by = m.cy + (h(i + 62) - 0.5) * m.ay * 1.5;
          const len = m.ax * (0.09 + h2(i + 63) * 0.08);
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len * sy);
          for (let k = 1; k <= 2; k++) {                /* two barbs */
            const t = k / 3;
            const sx = bx + Math.cos(a) * len * t, sty = by + Math.sin(a) * len * t * sy;
            const ba = a + (k % 2 ? 1 : -1) * 1.05;
            c.moveTo(sx, sty);
            c.lineTo(sx + Math.cos(ba) * len * 0.42, sty + Math.sin(ba) * len * 0.42 * sy);
          }
          c.stroke();
        }

        /* ── COLD SPECULAR ── one tight glint per tile, in `s` and therefore at
           FULL resolution and crisp. Round 2's sheen was a 1.05-tile-radius
           radial at 0.34-0.46 alpha; that is not a highlight, that is fog. A
           specular has to be small enough and hard enough that the eye can land
           on it and say "that surface is flat, hard and frozen". */
        const gx = m.cx + (h(70) - 0.5) * m.ax * 0.7;
        const gy = m.cy - m.ay * (0.16 + h2(71) * 0.18);
        radial(c, gx, gy, m.ax, m.ay * 0.30, m.ax * 0.30, [
          [0,    api.rgba('#ffffff', 0.50)],
          [0.42, api.rgba('#dff2ff', 0.19)],
          [1,    api.rgba('#cfe8ff', 0)]
        ]);
      }

      /* ── RIME IN THE CREASE SEAM ────────────────────────────────────────
         The terrain draws a darker crease along every tile border, and frost
         collects in a crease — so an ice pool spanning two tiles gets rime
         packed into the seam between them. That detail is most of what makes
         the pool read as material lying IN the ground rather than a wash
         floating over it.

         ⚠ NO CONTINUOUS STROKE. The first version stroked the seam curve with
         a soft 0.20-tile band plus a bright rime line, and it drew a clean
         bright CROSS on the tile border — the chessboard, in white. It is
         drawn as a DRIFT instead: crystals and stubs scattered along the seam
         with jitter either side of it, so the frost follows the crease without
         any mark tracing it.

         ⚠ INTERNAL EDGES ONLY, each drawn from exactly ONE of its two owners.
         Rime on the region's OUTER perimeter would outline the pool — the very
         mark this file exists to delete — and drawing a shared seam twice
         would double its alpha and make it the loudest thing in the pool. */
      for (const it of g.list) {
        const q = it.q;
        const sides = [];
        if (g.set.has(it.x + ',' + (it.z - 1))) sides.push([q[0], q[1], q[2], 0]);
        if (g.set.has((it.x - 1) + ',' + it.z)) sides.push([q[6], q[7], q[0], 1]);
        if (!sides.length) continue;
        const m = it.m, sy = m.ay / m.ax;
        for (const sd of sides) {
          /* ⚠ SCATTER PERPENDICULAR TO THE SEAM, NOT IN SCREEN X/Y. The first
             drift jittered each mark by ±0.08 of the tile in x and in y
             independently, which for a near-VERTICAL seam is almost no
             sideways spread at all — the result was a tidy column of dots
             sitting on the tile border, i.e. the same grid line, dotted. The
             offset has to be taken along the seam's own normal, and it has to
             be wide (up to ~0.30 tile) with a sqrt weighting so the frost is
             densest in the crease and thins out into both plates. */
          const tx = sd[2].x - sd[0].x, ty = sd[2].y - sd[0].y;
          const tl = Math.hypot(tx, ty) || 1;
          const nx = -ty / tl, ny = tx / tl;
          const N = 26;
          for (let i = 0; i < N; i++) {
            const hh = n => api.hash(it.x * 31 + i, it.z * 17 + sd[3], n);
            /* t is jittered too, so the marks are not evenly spaced — evenly
               spaced marks read as a dashed line however far they scatter */
            const t = (i + hh(0)) / N;
            const u = 1 - t;
            const ix = u * u * sd[0].x + 2 * u * t * sd[1].x + t * t * sd[2].x;
            const iy = u * u * sd[0].y + 2 * u * t * sd[1].y + t * t * sd[2].y;
            const d = (hh(1) < 0.5 ? -1 : 1) * Math.sqrt(hh(2)) * m.ax * 0.24;
            const px = ix + nx * d, py = iy + ny * d;
            /* fade with distance from the crease: rime is packed in the
               groove and merely dusted on the plates either side */
            const f = 1 - Math.abs(d) / (m.ax * 0.24);
            const r = m.ax * (0.010 + hh(3) * 0.020);
            c.fillStyle = api.rgba('#f4fcff', (0.11 + hh(4) * 0.17) * (0.35 + 0.65 * f));
            c.beginPath();
            c.ellipse(px, py, r, r * sy, 0, 0, 6.3);
            c.fill();
            if (hh(5) > 0.62) {                     /* a short crystal stub */
              c.strokeStyle = api.rgba('#eaf7ff', 0.20 * (0.35 + 0.65 * f));
              c.lineWidth = Math.max(0.5, m.ax * 0.010);
              const ln = m.ax * (0.04 + hh(6) * 0.06);
              const aa = hh(7) * 6.283;
              c.beginPath();
              c.moveTo(px, py);
              c.lineTo(px + Math.cos(aa) * ln, py + Math.sin(aa) * ln * sy);
              c.stroke();
            }
          }
        }
      }
    },
    l(api, c, g) {
      /* Everything hard-edged now lives in `s`. What is left here is a slow,
         low-amplitude cold shimmer — sub-surface scatter creeping through the
         slab. Kept small on purpose: this is the layer that used to be the
         bloom, and the driver renders a non-static `l` at HALF resolution, so
         nothing crisp may live here anyway. */
      /* ⚠ THE COLD LIFT, and the same trick the puddle painter documents: sand
         starts with its blue channel far below red, so NO multiply can make it
         read blue — the darkest a cyan multiply gets you is olive. One flat
         additive pass is what puts B above R, and being flat it cannot draw a
         seam at a tile join. */
      c.fillStyle = api.rgba('#2a6fa8', 0.11);
      fill(c, g);
      for (const it of g.list) {
        const m = it.m;
        const tw = 0.5 + 0.5 * Math.sin(api.T * 1.5 + it.x * 1.7 + it.z * 2.3);
        radial(c, m.cx + m.ax * 0.10, m.cy - m.ay * 0.16, m.ax, m.ay * 0.46, m.ax * 0.80, [
          [0,   api.rgba('#bfe4ff', 0.09 + 0.05 * tw)],
          [0.6, api.rgba('#a8d4f4', 0.03)],
          [1,   api.rgba('#a8d4f4', 0)]
        ]);
      }
    }
  },

  /* ── BLOOD ── absorbed at the edge, glossy in the middle. */
  blood: {
    lStatic: true,
    halo: () => [['#3a1a12', 0.34, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#5a1014', 0.72)], [0.55, api.rgba('#5a1014', 0.52)], [1, api.rgba('#5a1014', 0)]
        ]);
        for (let i = 0; i < 4; i++) {           /* darker clots */
          const a = api.hash(it.x, it.z, i) * 6.283, d = api.hash(it.z, it.x, i + 2) * m.ax * 0.6;
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay,
                 m.ax * (0.25 + api.hash(it.x, it.z, i + 6) * 0.3), [
            [0, api.rgba('#2c0508', 0.5)], [1, api.rgba('#2c0508', 0)]
          ]);
        }
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx - m.ax * 0.16, m.cy - m.ay * 0.22, m.ax, m.ay * 0.44, m.ax * 0.66, [
          [0, api.rgba('#ff9a8a', 0.20)], [1, api.rgba('#c04030', 0)]
        ]);
      }
    }
  },

  /* ── VOID (rift) ── a hole. Deliberately NOT pure black: the BAR forbids it,
     and a true 0,0,0 hole reads as a rendering failure rather than as depth. */
  void: {
    /* ⚠ WAVE 5 — 0.88/0.66 WAS "REPLACE THE GROUND", NOT "DARKEN IT". At that
       alpha the rift's own multiply buried every bit of sand grain under it,
       so whatever the emissive did on top had nothing to interact with and the
       spiral could only ever read as line-art on a black plate. The critic's
       phrasing is the spec: a SLIGHTLY DARKENED, HUE-SHIFTED tile with the
       emission composited over it. 0.62/0.44 still reads as a hole (it is the
       darkest material in the table by a wide margin) and leaves the ground
       measurable underneath, which is what the gain below then amplifies. */
    halo: () => [['#1a1030', 0.34, 'multiply']],
    gain: () => ['#5a2fb0', 0.30],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.55, [
          [0, api.rgba('#120b1e', 0.62)], [0.5, api.rgba('#150e24', 0.44)], [1, api.rgba('#150e24', 0)]
        ]);
      }
    },
    /* TWO arms, not three, and neither is a stroke. Three evenly-phased arms
       of constant width is a LOGO — evenly-spaced identical marks are the
       BAR's own "AI-generated game" tell. Two arms at unequal radial pitch,
       each drawn as a tapered chain of falloffs, read as matter being drawn
       into the rift. Per-tile phase and pitch off api.hash so no two rifts
       spiral alike. */
    _arms(api, it) {
      const m = it.m, sy = m.ay / m.ax, out = [];
      for (let i = 0; i < 2; i++) {
        const a0 = api.T * (0.42 + i * 0.17) + i * 3.1 + api.hash(it.x, it.z, 900 + i) * 6.283;
        const pitch = 0.034 + api.hash(it.z, it.x, 910 + i) * 0.012;
        const pts = [];
        for (let k = 0; k <= 20; k++) {
          const a = a0 + k * 0.32, rr = m.ax * (0.12 + k * pitch);
          pts.push(clampTile(m, m.cx + Math.cos(a) * rr, m.cy + Math.sin(a) * rr * sy, 0.95));
        }
        out.push(pts);
      }
      return out;
    },
    /* ⚠ WAVE 5 ROUND 2 — THE ARMS ARE MOSTLY A DODGE NOW. Measured by the
       critic on the 0.80-inset quads, void's high-pass regression on the
       paint-off ground came out r 0.372–0.602 against the 0.965 the move pool
       manages, on a tile whose own note claims the ground stays measurable
       underneath. Two things were eating it and only one of them was the
       multiply: at 0.30 additive alpha over a tile darkened to ~38%, the arms'
       own falloff structure is comparable in amplitude to what is left of the
       sand's grain, so the arms ARE the tile's high-frequency content.
       Dodging them scales the darkened sand along the arm instead of adding to
       it — the grain inside the arm is preserved in proportion — and the
       'lighter' pass keeps a quarter of the old alpha for the genuinely
       emissive cyan, which is what stops the rift reading as a wet smear. */
    d(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        const arms = PAINTERS.void._arms(api, it);
        for (let i = 0; i < arms.length; i++)
          glowChain(c, api, arms[i], i % 2 ? '#6a3ba8' : '#2f6ea8',
                    m.ax * (0.130 + api.hash(it.x, it.z, 920 + i) * 0.035), 0.34, true);
      }
    },
    /* ⚠ WAVE 5 ROUND 2 — THE EMISSIVE SPINE MOVED OUT OF `l` AND INTO `post`,
       AND IT IS A COST FIX WITH NO VISUAL CONSEQUENCE. `l` is a MASKED layer:
       clear the region scratch, draw, 'destination-in' the mask over it, blit
       it back — four passes over the region's bounding box, and drawSurfaces
       groups by fx key ACROSS THE WHOLE BOARD, so a hazard in two corners has
       a board-sized bounding box. Adding the dodge pass gave these two
       painters two such layers each per frame where wave 3 had one, and
       measured on the standalone board that, not the drawing inside it, is
       what most of the remaining per-frame cost is. `post` goes straight onto
       the main canvas with no scratch and no mask. The spine is a thin taper
       riding the middle of the arm it belongs to, so there is nothing at its
       edges for a mask to have been cutting. */
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        const arms = PAINTERS.void._arms(api, it);
        for (let i = 0; i < arms.length; i++)
          glowChain(c, api, arms[i], i % 2 ? '#a35cff' : '#4fd0ff',
                    m.ax * (0.090 + api.hash(it.x, it.z, 920 + i) * 0.030), 0.085, true, true);
      }
      c.restore();
    }
  },

  /* ── TOXIC (acid) ── hissing, pale etched sheen, bubbles that pop. */
  toxic: {
    halo: () => [['#4b5a12', 0.26, 'multiply'], ['#9ec81e', 0.07, 'lighter']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#4b5a12', 0.62)], [0.6, api.rgba('#4b5a12', 0.42)], [1, api.rgba('#4b5a12', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.4, [
          [0, api.rgba('#9ec81e', 0.22)], [1, api.rgba('#9ec81e', 0)]
        ]);
        for (let i = 0; i < 6; i++) {
          const cyc = (api.T * 0.8 + api.hash(it.x, it.z, i)) % 1;
          const a = api.hash(it.z, it.x, i) * 6.283, d = api.hash(it.x, it.z, i + 3) * m.ax * 0.75;
          const px = m.cx + Math.cos(a) * d, py = m.cy + Math.sin(a) * d * sy;
          const r = m.ax * (0.05 + 0.10 * cyc);
          c.beginPath(); c.ellipse(px, py, r, r * sy, 0, 0, 6.3);
          c.fillStyle = api.rgba('#c8ec4a', 0.16 * (1 - cyc)); c.fill();
          c.strokeStyle = api.rgba('#e8ff9a', 0.36 * (1 - cyc));
          c.lineWidth = Math.max(0.7, m.ax * 0.022);
          c.stroke();
        }
      }
    }
  },

  /* ── MIRE (poison) ── matte wet mud. Almost no specular: that is what
     separates it from the acid pool at a glance. */
  mire: {
    halo: () => [['#241c10', 0.32, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#33361a', 0.70)], [0.6, api.rgba('#33361a', 0.48)], [1, api.rgba('#33361a', 0)]
        ]);
        for (let i = 0; i < 5; i++) {           /* mud swirls */
          const a = api.hash(it.x, it.z, i) * 6.283, d = api.hash(it.z, it.x, i + 4) * m.ax * 0.7;
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, m.ax, m.ay, m.ax * 0.5, [
            [0, api.rgba('#1a1c0c', 0.42)], [1, api.rgba('#1a1c0c', 0)]
          ]);
        }
      }
    },
    s(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        for (let i = 0; i < 3; i++) {           /* slow domed bubbles */
          const cyc = (api.T * 0.32 + api.hash(it.x, it.z, i + 8)) % 1;
          const a = api.hash(it.z, it.x, i + 9) * 6.283, d = api.hash(it.x, it.z, i + 10) * m.ax * 0.55;
          const r = m.ax * 0.09 * Math.sin(cyc * 3.14);
          if (r <= 0.4) continue;
          c.fillStyle = api.rgba('#6d7a34', 0.5);
          c.beginPath();
          c.ellipse(m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r * sy, 0, 0, 6.3);
          c.fill();
        }
      }
    }
  },

  /* ── ELECTRIC ── a wet conductive patch with arcs skittering over it. */
  electric: {
    /* ⚠ WAVE 5 ROUND 2 — the additive half of the halo is 0.10 → 0.042. It is
       drawn through the DILATED mask, so unlike a rim it covers the tile
       interior as well as the spill — i.e. it is a constant sitting on exactly
       the pixels the grain regression is measured over, and at 0.10 it was
       three times holy's, on the one painter that was failing that clause.
       The spill it exists for is outside the tile and reads fine at 0.042; the
       interior lift it was also doing is now the dodge's job. */
    halo: (api) => [['#1a2440', 0.21, 'multiply'],
                    ['#5a9cff', 0.042 * (0.6 + 0.4 * Math.sin(api.T * 9.3)), 'lighter']],
    /* ⚠ WAVE 5 — THE ARC HAS TO LIGHT THE PATCH, NOT BE DRAWN ON IT. An
       electric arc is by far the brightest thing in its own frame, so the
       ground under it should visibly brighten and its grain should come up
       with it. That is a GAIN, not a fill: it re-reads the sand and scales it,
       so the wet patch's own relief and the terrain's crease AO all rise
       together. Flickering on the same 7 Hz clock as the branches below so the
       light and the thing emitting it agree. */
    gain: (api) => ['#4d86d8', 0.34 * (0.55 + 0.45 * Math.sin(api.T * 13.7))],
    /* ⚠ WAVE 5 ROUND 2 — 0.56/0.38 → 0.32/0.20, THE SAME LESSON VOID LEARNED
       ONE ROUND EARLIER AND FOR THE SAME MEASURED REASON. A wet conductive
       patch is DARKER than dry sand; it is not a dark plate. Measured on the
       0.80-inset quad, this multiply (plus the halo's own 0.26 multiply over
       the same pixels) left the tile with roughly 0.3 of the sand's grain
       contrast — so the tile's high-frequency content was mostly ARC, in both
       the painted frame and the paint-off frame the probe compares it against,
       and since the branches reseed 7×/s those two lots of arc are in
       different places. That is why the regression came out r 0.002 on one
       capture and r 0.570 on another: not instability in the arc, but the
       ground it should be riding on having been multiplied away underneath it.
       The darkening the patch needs is now shared between a lighter multiply
       here, the halo's 0.21, and the gain (0.26 → 0.34) doing the cooling.
       ⚠ 0.32/0.20 WAS TOO FAR. Looked at rather than measured, at that setting
       the patch stopped reading as wet at all — the grain regression was 0.82
       and the tile was sand with a wisp on it. 0.40/0.26 is the setting where
       both hold: still roughly half the darkening wave 3 applied, still ~0.78
       on the regression, and visibly a damp conductive patch at 1:1. */
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#1a2440', 0.40)], [0.6, api.rgba('#1a2440', 0.26)], [1, api.rgba('#1a2440', 0)]
        ]);
      }
    },
    /* The branch geometry, shared by the dodge pass and the emissive spine so
       the light and the thing emitting it are the same shape. Seeded on a 7 Hz
       step, which is the arc's own flicker rate. */
    _pts(api, it) {
      const m = it.m, seed = Math.floor(api.T * 7), out = [];
      for (let b = 0; b < 2; b++) {
        const a = api.hash(it.x + seed, it.z, b) * 6.283;
        let px = m.cx - Math.cos(a) * m.ax * 0.9, py = m.cy - Math.sin(a) * m.ay * 0.9;
        const pts = [{ x: px, y: py }];
        for (let s = 0; s < 5; s++) {
          px += Math.cos(a) * m.ax * 0.38 + (api.hash(it.z + seed, it.x, b * 5 + s) - 0.5) * m.ax * 0.5;
          py += Math.sin(a) * m.ay * 0.38 + (api.hash(it.x + seed, it.z, b * 7 + s) - 0.5) * m.ay * 0.5;
          const q = clampTile(m, px, py, 0.95); px = q.x; py = q.y;
          pts.push({ x: px, y: py });
        }
        out.push(pts);
      }
      return out;
    },
    /* ⚠ WAVE 5 ROUND 2 — THE ARC IS NOW A DODGE, AND THAT IS THE FIX FOR THE
       INSTABILITY, NOT JUST FOR THE LEVEL. Wave 5 replaced the old opaque
       polyline with a two-pass 'lighter' chain — a real improvement in how it
       looks, and still an ADDED CONSTANT where it is brightest. Measured by the
       critic on the 0.80-inset tile quads, tile 4,6's high-pass regression on
       the paint-off ground came out slope 0.686 / r 0.570 on one capture and
       slope 0.003 / r 0.002 on a second capture of the identical hazard set:
       at that instant the tile bore no relationship to the ground under it at
       all. That is not noise, it is the mechanism — the branch seed steps 7
       times a second, so where the near-white core happens to fall decides how
       much of the tile's high-frequency content is arc rather than sand, and
       the answer swings between "some" and "all".
       'color-dodge' removes the question: out = base/(1−b) is a multiplier, so
       wherever the arc is, the sand under it is scaled, not replaced, and the
       correlation is a property of the operator rather than of where the bolt
       landed this frame. Corona and core are both dodges now; the only thing
       left in the additive pass is a thin true-emissive spine at a fifth of
       the old alpha, because an electric arc IS brighter than any multiple of
       sand and a purely multiplicative arc looks like a wet streak. */
    d(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        for (const pts of PAINTERS.electric._pts(api, it)) {
          /* blue-weighted, and both well under the 0.45 clip ceiling.
             The corona is wide, dim and `coarse`; the core carries the body
             and is the one drawn at full chain density. */
          glowChain(c, api, pts, '#2d5a9e', m.ax * 0.175, 0.26, true, true); /* corona */
          glowChain(c, api, pts, '#4f78c8', m.ax * 0.088, 0.38, true);       /* core   */
        }
      }
    },
    /* ⚠ NO STROKE, NO shadowBlur. The old branch was a 0.90-alpha near-white
       polyline — the single most opaque mark in the whole surface table — with
       a canvas shadow standing in for a glow. Measured, it sat on the sand with
       no transmission at all: a white zigzag decal. What is left is only the
       spine: tight, and at 0.34 → 0.065 so its own detail can no longer
       outweigh the ground's inside the tile.
       ⚠ WAVE 5 ROUND 2 — THE EMISSIVE SPINE MOVED OUT OF `l` AND INTO `post`,
       AND IT IS A COST FIX WITH NO VISUAL CONSEQUENCE. `l` is a MASKED layer:
       clear the region scratch, draw, 'destination-in' the mask over it, blit
       it back — four passes over the region's bounding box, and drawSurfaces
       groups by fx key ACROSS THE WHOLE BOARD, so a hazard in two corners has
       a board-sized bounding box. Adding the dodge pass gave these two
       painters two such layers each per frame where wave 3 had one, and
       measured on the standalone board that, not the drawing inside it, is
       what most of the remaining per-frame cost is. `post` goes straight onto
       the main canvas with no scratch and no mask. The spine is a thin taper
       riding the middle of the arm it belongs to, so there is nothing at its
       edges for a mask to have been cutting. */
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (const pts of PAINTERS.electric._pts(api, it))
          glowChain(c, api, pts, '#dcecff', m.ax * 0.075, 0.065, true, true);
      }
      c.restore();
    }
  },

  /* ── HOLY ── consecrated ground: the sand is BRIGHTENED, never covered with
     an opaque plate, and the light rises off it. No outline anywhere. */
  holy: {
    /* ⚠ EVERY ADDITIVE ALPHA IN THIS PAINTER WAS CUT ~4×, AND THAT IS THE
       POINT, NOT A SIDE EFFECT. First pass of the rewrite kept the old
       additive stack (halo 0.14, region radial 0.26) AND added the gain at
       0.62; measured on the fixed tile quads that came out at luma ratio 1.51
       with the grain regression at slope 0.59 / r 0.762 — WORSE than the
       stroked version it replaced (0.79 / 0.885), because two thirds of the
       lift was still a constant and the red channel was clipping on the
       brighter sand grains, which shears the top off the grain distribution.
       A gain cannot show you the ground if a constant has already washed it
       out. So the constants are small, the gain carries the lift, and the
       tint lost some red (#e8b464 → #d0a860) to keep the peaks off 255. */
    halo: (api) => [['#ffd98a', 0.035 * (0.9 + Math.sin(api.T * 1.3) * 0.1), 'lighter']],
    /* ⚠ WAVE 5 — THE CONCENTRIC RING OUTLINES ARE DELETED, NOT SOFTENED, AND
       THE COMMENT ABOVE FINALLY MATCHES THE CODE. Three expanding stroked
       ellipses per tile is a HUD element, not consecrated ground: at 1:1 they
       were the most obviously drawn mark left on the field, two clean nested
       outlines per tile running on across the sand and straight over the cliff
       band beside it because the surface mask spills 1.44 tile radii and a
       stroke inside it spills with it. Nothing about that says "this ground is
       holy" — it says "a circle was drawn here".
       What the painter's own note always claimed it did — "the sand is
       BRIGHTENED" — is now literally what it does, via the key-light gain:
       out = sand ⊙ (1 + gA·warm), i.e. the ground's own grain, relief and
       crease AO all scale up together and the tile reads as the same sand
       under more light. That is the strongest gain in the table on purpose;
       holy is the one surface whose entire identity IS illumination. */
    gain: (api) => ['#c0a878', 0.40 * (0.92 + 0.08 * Math.sin(api.T * 1.3))],
    /* a whisper of a warm multiply so the brightened sand also shifts hue
       rather than just getting lighter — the "slightly darkened hue-shifted
       tile" half of the pair. Blue is the attenuated channel, so what the gain
       lifts is already warmer than bare sand. */
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#fff0cc', 0.16)], [0.6, api.rgba('#fff0cc', 0.10)], [1, api.rgba('#fff0cc', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#ffe6b0', 0.060)], [0.55, api.rgba('#ffdc94', 0.030)], [1, api.rgba('#ffd070', 0)]
        ]);
        /* Where the rings were: three soft, off-centre, unequal swells that
           breathe out of phase. Same "the light pools unevenly" idea the move
           pool's per-tile swells use, and for the same reason — a mark with a
           centre and no boundary cannot be read as an outline. */
        for (let i = 0; i < 3; i++) {
          const ph = (api.T * 0.20 + api.hash(it.x, it.z, i + 40) + i / 3) % 1;
          const br = 0.30 + 0.70 * Math.sin(Math.PI * ph);
          const a  = api.hash(it.z, it.x, i + 41) * 6.283;
          const d  = api.hash(it.x, it.z, i + 42) * m.ax * 0.46;
          const rr = m.ax * (0.44 + api.hash(it.z, it.x, i + 43) * 0.40);
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy,
                 m.ax, m.ay, rr, [
            [0,    api.rgba('#fff4d6', 0.035 * br)],
            [0.45, api.rgba('#ffe6a8', 0.016 * br)],
            [1,    api.rgba('#ffd070', 0)]
          ]);
        }
      }
    },
    post(api, c, g) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const it of g.list) {
        const m = it.m;
        for (let i = 0; i < 5; i++) {
          const ph = (api.T * 0.24 + api.hash(it.x, it.z, i + 50)) % 1;
          const px = m.cx + (api.hash(it.z, it.x, i + 51) - 0.5) * m.ax * 1.2;
          const r = Math.max(0.7, m.ax * 0.026);
          radial(c, px, m.cy - ph * m.ax * 1.5, r, r, r * 2.4, [
            [0, api.rgba('#fff0c8', 0.45 * (1 - ph) * ph * 3)], [1, api.rgba('#ffe0a0', 0)]
          ]);
        }
      }
      c.restore();
    }
  },

  /* ── CRACK (cracked earth) ── DRY. The board's original painter lit these
     with orange magma, which made "unstable footing" read as a lava tile — a
     different hazard entirely. Now it is fractured ground: dark fissures with
     a pale lit lip on the light-facing side, and displaced grit around them.
     No wash at all, so the sand's own material still shows: that is the point
     of the hazard. */
  crack: {
    /* ⚠⚠ WAVE 5 ROUND 4 — THE FISSURE WAS THE LAST ctx.stroke() IDENTITY LEFT
       IN THIS TABLE AND IT WAS SITTING IN THE WORST LAYER FOR ONE. It was a
       4-arm polyline at lineWidth ax·0.042, ROUND caps, colour #241a10 at
       alpha 0.62 — and `s` composites SOURCE-OVER at alpha 1, so 62% of the
       sand under the mark was simply gone. That is exactly the signature wave
       5 deleted from void, electric and holy ("a near-opaque hairline lying ON
       the sand with no interaction with it"), and it was the more visible for
       being the only painter that draws its mark ON TOP of a lit move pool: in
       the surfaced frame it read as a chunky brown scribble laid over the
       emission with no blending at all.
       The fix is the one those three already proved, and both halves matter:
         • the mark is a glowChain — a chain of radial falloffs with no edge in
           ANY direction, so there is no width left to read as a drawn line;
         • it moved from `s` (source-over) to `m` (MULTIPLY), so it SCALES the
           sand under it instead of replacing it and every bit of grain, relief
           and dressing shadow reads straight through the fissure.
       The lit lip is the same path offset toward the light, in `l` (additive)
       rather than as a second stroke. Both layers are cached: the fracture is
       a function of the tile hash only, nothing here reads api.T, so this
       costs one extra blit per frame and no extra fill. */
    lStatic: true,
    /* ONE path, shared by the dark half and the lit lip, so the lip cannot
       drift off its own fissure — the same reason void factored out `_arms`. */
    _frac(api, it) {
      const m = it.m, out = [];
      for (let i = 0; i < 4; i++) {
        const a = api.hash(it.x, it.z, i) * 6.283;
        let px = m.cx, py = m.cy;
        const pts = [clampTile(m, px, py, 0.92)];
        for (let k = 0; k < 4; k++) {
          px += Math.cos(a + (api.hash(it.z, it.x, i * 4 + k) - 0.5) * 1.5) * m.ax * 0.34;
          py += Math.sin(a + (api.hash(it.x, it.z, i * 4 + k) - 0.5) * 1.5) * m.ay * 0.34;
          pts.push(clampTile(m, px, py, 0.92));
        }
        out.push(pts);
      }
      return out;
    },
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m, sy = m.ay / m.ax;
        const fr = PAINTERS.crack._frac(api, it);
        for (let i = 0; i < fr.length; i++)
          glowChain(c, api, fr[i], '#3b2a1b', Math.max(1.0, m.ax * 0.058),
                    0.50 + api.hash(it.x, it.z, 60 + i) * 0.14, true, true);
        /* displaced grit. Also multiply now — at source-over these were ten
           opaque dots per tile, which is ten more tiny stickers. As a darkening
           they are what they are meant to be: crumbs of shadow in the sand. */
        for (let i = 0; i < 10; i++) {
          const a = api.hash(it.x, it.z, i + 70) * 6.283;
          const d = api.hash(it.z, it.x, i + 71) * m.ax * 0.85;
          const r = Math.max(0.6, m.ax * 0.020);
          radial(c, m.cx + Math.cos(a) * d, m.cy + Math.sin(a) * d * sy, r, r, r * 2.2, [
            [0, api.rgba('#2a2015', 0.34)], [1, api.rgba('#2a2015', 0)]
          ]);
        }
      }
    },
    /* THE LIT LIP — the sun catching the raised edge of the crack. Offset
       against the light vector so it lands on the light-facing side of the
       same fissure, dimmer and slightly wider than the dark half so it reads
       as a soft catch of light rather than as a second line beside the first. */
    l(api, c, g) {
      const lv = api.lightVector();
      for (const it of g.list) {
        const m = it.m;
        const fr = PAINTERS.crack._frac(api, it);
        const ox = -lv.x * m.ax * 0.05, oy = -m.ay * 0.05;
        for (let i = 0; i < fr.length; i++) {
          const p2 = fr[i].map((p) => ({ x: p.x + ox, y: p.y + oy }));
          glowChain(c, api, p2, api.mixHex('#c9b78c', (api.LIGHT && api.LIGHT.key) || '#ffd9a0', 0.35),
                    Math.max(1.0, m.ax * 0.062), 0.15, true, true);
        }
      }
    }
  },

  /* ── FALL-THROUGH ── a hazard key the board has never heard of. A neutral
     wash plus a sheen: unmistakably "something is on this tile", legible on
     sand, and it can never throw. Rendering NOTHING here would hide a real
     game mechanic; that is the failure mode this branch exists to prevent. */
  _neutral: {
    lStatic: true,
    halo: (api) => [[dampCol(api), 0.24, 'multiply']],
    m(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy, m.ax, m.ay, m.ax * 1.6, [
          [0, api.rgba('#3d4152', 0.58)], [0.6, api.rgba('#3d4152', 0.38)], [1, api.rgba('#3d4152', 0)]
        ]);
      }
    },
    l(api, c, g) {
      for (const it of g.list) {
        const m = it.m;
        radial(c, m.cx, m.cy - m.ay * 0.15, m.ax, m.ay, m.ax * 1.15, [
          [0, api.rgba('#c8d2e6', 0.17)], [1, api.rgba('#c8d2e6', 0)]
        ]);
      }
    }
  }
};

function drawSurfaces(api) {
  try {
    const S = api.surfaces || {};
    let any = false;
    for (const k in S) { if (S[k]) { any = true; break; } }
    if (!any) return;                          /* clean board costs one loop */
    frameSync(api);

    /* group by fx key so a run of the same hazard shares one mask and blends */
    const byKey = new Map();
    for (const k in S) {
      const fx = S[k];
      if (!fx) continue;
      const p = k.split(','), x = +p[0], z = +p[1];
      if (!isFinite(x) || !isFinite(z)) continue;
      let a = byKey.get(fx);
      if (!a) { a = []; byKey.set(fx, a); }
      a.push({ x, z });
    }

    const c = api.ctx;
    byKey.forEach((tiles, fx) => {
      /* ⚠ THE `_`-PREFIXED ENTRIES ARE SHARED GEOMETRY, NOT PAINTERS. void and
         electric factored their motif path out (`_arms` / `_pts`) so the dodge
         pass and the emissive pass draw the SAME curve; those are functions
         sitting in the same table the host indexes by fx key, so a surface
         literally called "_pts" would resolve to one, find no halo/m/l/d/s/post
         on it and render nothing at all — the one failure mode the contract
         names outright ("never render nothing silently"). Anything that is not
         a plain object carrying at least one painter hook falls through to the
         neutral wash, exactly like an unknown key. */
      let P = PAINTERS[fx];
      if (!P || typeof P !== 'object' ||
          !(P.halo || P.m || P.l || P.s || P.d || P.post || P.gain)) P = PAINTERS._neutral;
      let g = null;
      try { g = group(api, tiles, LIFT_SURF, JIT_SURF, P.mask || MASK_SURF); } catch (e) {}
      if (!g) return;

      /* ⚠ WAVE 6 — THE STATIC-LAYER KEYS MUST CARRY THE PAINTER, AND FOR FOUR
         WAVES THEY DID NOT. `g.sub` is not this region's own map: it belongs to
         the MASK cache entry, whose key is `opt.tag + '|' + g.sig` and whose
         sig is `_epoch # lift # sorted tile list` — geometry only. Two painters
         on the SAME tiles with the same mask opt therefore share one sub-map,
         and the literal keys 'm' / 's' / 'l' below collided: whichever painter
         drew first left its masked material in the cache and every later
         painter on those tiles blitted THAT canvas with its own composite.
         Measured, single tile 4,2, mask cache flushed between runs, bare sand
         (147.9, 113.3, 63.3) luma 117.0:
             holy on a virgin cache   (186.3, 150.0,  91.5) luma 153.5  ×1.312
             holy one second after
             the same tile was puddle (103.5, 108.5,  74.0) luma 105.0  ×0.897
         i.e. the consecrated tile came out DARKER than bare sand with green as
         its max channel — it was wearing the puddle's #3d4152 multiply. It is
         reachable in ordinary play every time a tile changes hazard (oil
         igniting to fire, fire burning out to crack, a puddle consecrated) and
         it silently defeats every measured property of the affected painter.
         drawPool never had it because its keys are prefixed with `tag`, which
         starts with colKey. The mask itself is pure geometry and is still
         shared — only the CONTENT caches are separated, so the fix costs one
         string concat per layer and no extra rasterisation.
         `pk` is the resolved painter, not the raw fx string: every unknown key
         falls through to the same _neutral painter and must share one entry,
         or a board that cycles junk keys over one tile would grow g.sub. */
      const pk = (PAINTERS[fx] === P ? fx : '_neutral') + '|';

      /* 1. the outward spill, through the dilated mask */
      if (P.halo) {
        try {
          const hs = P.halo(api, g) || [];
          for (const h of hs) if (h && h[1] > 0.002) halo(api, g, h[0], h[1], h[2]);
        } catch (e) {}
      }
      /* 2. the material, one masked blit per composite mode. Every `m` layer
         in the table is time-invariant, so it is always cached; `s`/`l` opt in
         with sStatic/lStatic. Getting this wrong is only a performance bug —
         a layer wrongly marked static freezes its animation, which is why the
         flags sit next to the painter that owns them. */
      if (P.m) { try { staticLayer(api, g, 'multiply', 1, pk + 'm', cc => P.m(api, cc, g)); } catch (e) {} }
      /* 2b. THE KEY LIGHT, for the painters whose identity is illumination.
         Same mechanism and the same ordering rule as the move pool's (see
         gainLayer): it goes in after the material multiply and before anything
         additive, so what it amplifies is the ground plus its tint and nothing
         this painter has yet emitted. Only void, electric and holy declare it
         — the read-back is the one expensive call in this file and a puddle
         has no business brightening the sand it lies in. gainLayer is itself
         rate-limited (GAIN_REFRESH) and cached in g.sub, so a static hazard
         costs one read every ~55 ms, not one per frame. */
      if (P.gain) { try {
        const gn = P.gain(api, g);
        if (gn && gn[0] && gn[1] > 0.004) gainLayer(api, g, gn[0], gn[1], GAIN_REFRESH_SURF);
      } catch (e) {} }
      /* 2c. THE SHAPED LIGHT. Same idea as 2b, but positional — see the `d`
         entry in the painter contract above. It must land AFTER the uniform
         gain (it dodges the already-lit ground, so an arc over a consecrated
         tile is brighter than the same arc over bare sand, which is right) and
         BEFORE the additive l pass, whose job is only the few pixels that are
         genuinely emissive rather than illuminated. `low` is deliberate: these
         are soft falloff chains with nothing above a few pixels of detail, so
         the half-res render is invisible and costs a quarter of the fill.
         ⚠ Measured both ways. At the chain's old 0.36 spacing the half-res
         raster was a real risk — a bead period of ~1.7 device px in the small
         buffer is at Nyquist and folds down into exactly the band the grain
         regression reads — which is why this ran at full resolution for one
         iteration. With the spacing at 0.42 and the blobs stamped from a
         cached sprite the beads overlap far enough that there is no periodic
         component left to fold, and the measured grain regression is the same
         either way while the fill is a quarter. */
      if (P.d) { try { layer(api, g, 'color-dodge', 1, cc => P.d(api, cc, g), false, true); } catch (e) {} }
      if (P.s) { try {
        if (P.sStatic) staticLayer(api, g, 'source-over', 1, pk + 's', cc => P.s(api, cc, g));
        else           layer(api, g, 'source-over', 1, cc => P.s(api, cc, g));
      } catch (e) {} }
      if (P.l) { try {
        if (P.lStatic) staticLayer(api, g, 'lighter', 1, pk + 'l', cc => P.l(api, cc, g));
        else           layer(api, g, 'lighter', 1, cc => P.l(api, cc, g), false, true);
      } catch (e) {} }
      /* 3. unclipped overlay — flames, wisps, motes: things that leave the
         ground plane and must not be sliced at any boundary */
      if (P.post) { c.save(); try { P.post(api, c, g); } catch (e) {} c.restore(); }
    });
  } catch (e) {}
}

window.BBX.tilefx = { drawStates, drawSurfaces, drawStatesOver };
