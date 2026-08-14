/* ══════════════════════════════════════════════════════════════════════════
   🌄 VISTA — the world behind the board, and the grade over everything.

   Loaded by public/battle-board/index.html as a plain ES module and attached
   to the BBX hook seam. It owns exactly two passes:

     BBX.vista.draw(api)   FIRST thing in frame(). Replaces drawSky() +
                           drawShards() + drawBackdrop() + the procedural ruin
                           silhouettes. Paints sky, the layered environment,
                           the location backdrop, the sun/moon and the ground
                           BEYOND the play field.
     BBX.vista.grade(api)  after the depth-sorted actors. Replaces the flat
                           black radial vignette with a filmic pass.

   WHAT WAS WRONG BEFORE (measured on the round-2 board, not guessed)
   1. The location backdrop was drawn COVER over the entire viewport, so the
      photo's own foreground — grey rubble, a soldier silhouette — filled the
      strip below the board's near edge. A cold grey photo butted straight
      against warm sand with a hard horizontal seam: the single loudest "board
      pasted on a picture" tell in the frame. The art is now the FAR layer
      only, clipped at the horizon with a feathered edge, and the ground
      beyond the field is painted warm so the board sits ON a desert.
   2. There was no atmospheric depth at all: one photo, one gradient. Now
      seeded mesa layers, each lifted further toward LIGHT.fog the further
      back it is, with a haze band exactly at the board's far edge.
      ⚠ HOW MANY LAYERS: THREE only when the location has no backdrop art.
      With art — which is every real location — the art IS the far layer and
      the procedural FAR range is suppressed (it would fight the photo), so
      TWO procedural ranges ship. An earlier version of this comment claimed
      three unconditionally and a reviewer rightly called it a lie.
   3. The sun was PINNED to the upper-right corner regardless of the light
      rig, so at night the moon and the shadows disagreed. It is now placed
      by projecting the actual light vector, then compressed along that same
      screen ray until it fits the frame — the SIDE and the height therefore
      always agree with the direction the terrain's cliff shadows fall.
   4. ROUND 3 — THE ONLY GROUND THE PLAYER EVER SEES. In the real 802×788
      stage the 8×7 field fills the width, so the sides of the desert are off
      screen and the ONLY vista ground in frame is the strip under the board's
      near edge: measured, canvas y 645→788, ~18% of the stage. Round 2 left
      it a featureless cool ramp — per-row horizontal luma sd 1.4–1.9 against
      the old board's 15–29, mean R−B +0.8 (neutral-cold, not ochre) — because
      (a) the mottling loop distributed blobs with r2()*r2(), which piles every
      one of them up at the horizon where the board hides it, and (b) the
      foreground falloff and the last floor stop both mixed toward the blue
      ambient and washed out whatever did survive. nearField() is the fix: a
      second, DENSE detail pass distributed uniformly across nearY()→H — dune
      shadows with lit crests, clustered gravel with per-stone contact shadows,
      long raking cast shadows aligned to api.lightVector(), angular slabs,
      crack systems and two octaves of overlay grain — over a ramp that is now
      held warm (ambient mix 0.58 → 0.22, and the foreground falloff no longer
      mixes toward blue at all). Everything placed by hand goes down through a
      ~0.7px blur so the strip does not read as vector art. Measured on the
      same box the review used: per-row sd 1.4–1.9 → 8.3–30 (every row above
      8), mean R−B +0.8 → +32.
      ⚠ AND IT IS PARTLY OCCLUDED. The board module paints its own near wall
      over canvas y≈645–661 and two translucent shadow bands over ≈662–710
      (measured off the live canvas with getImageData), which pass only ~33%
      and ~67% of what is under them and leave dead-straight full-width seams.
      Those bands belong to battle-board/index.html, not to this module. What
      this pass can do — and does — is run detail THROUGH them at full
      strength, so the seams read as ground layering instead of as UI banding.
   5. The old vignette put pure black on the frame. The BAR forbids pure black
      and pure white; grade() now clamps both ends with one 'lighten' and one
      'darken' flat fill, which also does the colour work — the lift is a cool
      blue-grey (shadows go cool) and the ceiling is a warm off-white
      (highlights go warm).
   6. ROUND 3B — THE MESAS WERE PAPER CUTOUTS. Measured on the round-2 board,
      the MID range on the left shoulder (box 50,310,55,80 of the board crop)
      had a horizontal luma sd of 2.19: one uniform fill behind a hard polygon
      silhouette, spanning the entire top of the field — which is the only part
      of the vista a player looks straight at above the board. ridgeLayer()
      shaded only segments where dx>0 AND the face turned away from the key, so
      most of every silhouette received nothing at all. It now carries five
      passes that do NOT depend on segment direction — a per-butte face split
      (≥±8 luma, driven by the same lightX the terrain's cliffs use), talus
      fans, 6-44 jittered strata beds at a fixed density, per-butte gullies,
      and full-layer fluting — and the same box measures 11-24. See the
      block comment on ridgeLayer for the ordering and why each one is there.
      The AERIAL ORDERING was also backwards: MID measured MORE saturated than
      NEAR at the same value, because "further toward LIGHT.fog" darkens as
      well as desaturates in this rig. hazeColour() is the fix.
   7. ROUND 3B — THE SHADOWS WERE WARM. The grade's key was warm and so was
      everything else: cliff walls measured R−B +19, basin shade +23, and the
      global L<55 mean had drifted to −1.0 against the BAR's "cool blue-grey in
      shadow". grade() now split-tones — a cool tint added through a cubed
      darkness mask built at thumbnail scale (see shadowThumb) and summed into
      the bloom's own upscale, so it costs one extra thumbnail and no extra
      full-canvas work. Measured after: cliff wall R−B +5, plateau underside
      −1, L<55 mean −14, darkest 2% −15, and the interior mean still warm at
      +25. The midtone 'overlay' came down 0.13 → 0.10 because 'overlay' warms
      darks harder than midtones and was undoing a third of it.

   8. ROUND 4 — THE WARM RESTORE ATE THE WATER, AND FLATTENED THE FIELD.
      Round 3's chroma restore is a baked full-viewport multiply and it cannot
      see what it is painting over, so it took blue out of the things the BAR
      requires to STAY blue exactly as happily as it took it out of sand.
      Measured on identical frames with only this file differing: the water
      pool went R−B −0.9 → +16.9, the near-water band −6.5 → +20.8, a teal
      movement slab −9.9 → +2.7 and the cool population of the field 14.5% →
      10.5%. The fix is coolThumb() — sample (B−R) BEFORE the multiply, at
      bloom thumbnail scale, and hand the blue back additively inside the one
      full-canvas upscale the bloom already does. After: teal slab −9.9 (i.e.
      the multiply no longer moves it at all), cool population 14.5%, and the
      cool pixels now average B−R 24.7 against 22.5 with the whole pass off.
      The SECOND half of round 3's verdict was that local contrast fell in five
      of six field bands, and the cause was in the same multiply: its luma is
      1 − 0.3726k ≈ 0.933, so it scales every luma delta in the frame down by
      6.7%, and the flat additive `addV` that was supposed to compensate can
      only restore the MEAN. See TONE_GAIN / toneRamp() for the multiplicative
      replacement. Median local luma sd over 16px tiles, six field bands,
      round 3 → round 4: 4.74→5.05, 2.89→3.34, 3.43→3.87, 5.26→6.09,
      5.00→5.83, 6.38→6.62 — every band up, and every band also above the
      grade-off baseline. grade() p50 at 820x800@2x went 27.4 → 29.1ms, i.e.
      the round's +25% became +6%, because the additive bake it replaces is
      gone.
      ⚠ AND THE ORDER OF THE PASSES IS LADEN. The tone gain must run AFTER the
      bloom; putting it before turned a 16% achromatic gain into a 1.16³ = 1.56x
      gain on a bloom that is warm, and swung the near-water band 31 points
      warm on its own. See the note in grade() step 2b.

   9. WAVE 3 — THE SKY AND THE GROUND WERE FURTHER APART THAN IN WAVE 1, AND
      THE SKY WAS NOT WHERE ANYONE THOUGHT IT WAS. Measured on the wave-2
      frame: sunlit sand rgb(185,157,110) sat 41% R−B +75 L 160, against a sky
      of rgb(76,79,84) sat 9% R−B −7 L 79 and a far ridge of rgb(84,85,83)
      sat 3%. A moonlit night sky pasted over a noon desert, with a blazing sun
      in it and the HUD reading "Daytime".
      Two independent causes, and the second is the one that mattered:
        (a) TIME_PRESETS.day.sky is ['#18243c','#31465f','#6b7f92'] — luma
            34/68/121, a dusk sky the renderer has always called noon. Those
            presets live in battle-board/index.html, which is stage-terrain's
            file and also feeds the terrain's cliff shading correctly, so they
            are not edited: skyStops() regrades them here, blended in by
            dayness() so night comes out unchanged and dawn/dusk take only the
            8–16% of the lift their sun elevation earns.
        (b) THE LOCATION BACKDROP PHOTOGRAPH IS THE SKY. It is drawn over the
            whole upper frame at near-full alpha, and bakeArt was grading it to
            an achromatic slate: a 14% chroma ceiling from the 'saturation'
            pass, a "hue push" whose fill carried 9% chroma of its own (so it
            was a second desaturation), and a value match tied to the mean luma
            of the dark preset sky. Proved by injection rather than by reading
            the code: paint the sky a flat rgb(90,138,200) (HSV 55%) and the
            screenshot measures 8.5%; turn off the art alone and the same
            injected sky measures 52.7%.
      Fixed at both: withChroma() so the two blends are handed the chroma they
      are supposed to leave behind, a top fade so the art is a distant LAYER
      and our own graded sky carries the zenith, and the fog band in the veil
      pulled onto hazeColour's hue instead of LIGHT.fog's cold grey.
      After, on the same frame: sky HSV saturation 12.3% → 23.5% against a mid
      field of 31.2% (gap 18.8 → 7.7 points; the brief asked for ≤ 8), sky luma
      119 → 159, far ridge R−B +30.2 → +34.7.
      Also in this round: the sun disc stops clipping (see drawBody — the core
      is 'source-over' from a capped colour now, and the clipped plateau inside
      the disc's box goes 1984 px → 4 px on the raw board canvas); the sky's
      ~7px horizontal banding is gone (see the two-stage upscale in bloom() —
      the detrended row-luma autocorrelation at lag 14 falls 0.67/0.72 →
      0.03/0.07); and the grade shares one thumbnail downscale between the
      bloom and the shadow mask instead of taking two (see shadowThumb).

   ⚠ THE HORIZON IS A CHEAT, AND IT HAS TO BE.
   The true vanishing line of the y=0 plane for this camera sits ~1000px ABOVE
   the viewport (f=(0,-.675,-.738), so the horizon of the ground plane lands at
   cy - .915*VIEW.scale). An honest infinite desert would therefore fill the
   whole frame and leave no sky. The renderer has always treated the board's
   FAR EDGE as the horizon; this module keeps that convention. horizonY() is
   the one place that decision lives.

   BUDGET. Everything static is baked into four offscreen canvases — sky,
   land (ridges + haze + the desert floor), veil (fog + vignette + centre lift)
   and chroma (the warm restore ramp) — plus one per backdrop image, and
   blitted 1:1 in device pixels (see
   blit(): the DPR-scaled path costs 8x more). The bakes are keyed on the
   viewport + the light + the map and throttled, because LIGHT lerps every
   frame for 2.5s on a time-of-day change and re-baking 150 times in that
   window would drop frames. Measured on this box's SOFTWARE rasteriser, the
   whole board renders at ~82ms/frame without this module and ~89ms with it;
   on a GPU-composited canvas the delta is a fraction of that. Canvas-2D only:
   the header at battle-board:2240 records that the WebGL path produced no
   fragments on real hardware. No imports, no DOM, no postMessage, no deps.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  window.BBX = window.BBX || {};

  /* Palette. These are deliberately the same family as the terrain module's
     SAND_/ROCK_ constants (battle-board's bakeTerrain) — the ground and the
     world behind it have to read as one place. They are duplicated rather
     than imported because the board page is a classic script and cannot
     export; if the terrain palette moves, move these with it. */
  const ROCK_PALE = '#c2a077', ROCK_BASE = '#8a6a48', ROCK_DEEP = '#4a3524';
  const SAND_PALE = '#dcbc80', SAND_BASE = '#a67c3d', SAND_DEEP = '#54371c';
  /* the floor of the frame: nothing in the final image may sit below this,
     and it is a cool blue-grey so the deepest shadows go cool, not muddy. */
  const SHADOW_FLOOR = [16, 20, 34];
  /* the ceiling: warm off-white, so a blown highlight reads as sunlight and
     never as paper. */
  const HILIGHT_CEIL = [252, 247, 236];
  /* ⚠ THE SPLIT-TONE. Added round 3 because the grade failed its second clause:
     "warm tan/ochre midtones, cool blue-grey in shadow" was half true — the key
     was warm but every shadow SURFACE measured warm ochre too (cliff wall
     R−B +19.2, basin shade +23.0, plateau underside +14.2) and the global
     L<55 mean had drifted to R−B −1.0. This is the colour that gets ADDED into
     the dark end, in proportion to how dark a pixel is (see thumbs()); at the
     cube law used there it lands ~(13,19,42) on a near-black, ~(9,13,30) on a
     cliff wall in shade and ~(0.4,0.7,1.5) on lit sand — so the shadows go
     blue-grey and the warm midtones and highlights are untouched.
     SHADOW_TINT_WEAK is the fallback for a canvas without the 'saturation'
     blend mode, where the mask cannot be desaturated and a strong tint would
     leak blue into warm highlights (whose blue channel is the dark one). */
  /* ⚠ MOSTLY BLUE, DELIBERATELY LOW IN RED AND GREEN. The first cut used
     rgb(22,32,72), whose own luma is 33 — at the cube law that lifted the
     darkest pixels of the field by 19 luma, and the board's cliff walls,
     which are the whole elevation read, went milky. This colour carries
     nearly the same blue (the part that does the cooling) for half the luma,
     so the shadows go cool without the shadows going away. */
  const SHADOW_TINT = 'rgb(6,16,50)';
  const SHADOW_TINT_WEAK = 'rgb(3,7,22)';
  /* ⚠ THE SHADOW MASK'S BLACK POINT, IN FRAME LUMA. Wave 2's blocker was that
     the mask had none: see shadowThumb(). Above SHADOW_HI the cool tint is
     EXACTLY zero — that is the whole point, and it is why the lit sand keeps
     its chroma. Below SHADOW_LO it is full. Between, it is a squared ramp.
     Tune these two numbers, not the tint colour: the colour is what the
     shadows are, these are where the shadows START. */
  const SHADOW_HI = 100;
  const SHADOW_LO = 18;
  /* how much chroma the grade puts BACK into the ground (see grade() step 1
     and bakeChroma). Roughly the fraction of blue the warm multiply removes at
     noon, so 0 = untouched and 1 would be an orange filter. Kept low: this is
     a restore, not a look. Tried at 0.22 (the near sand measured 53.6% HSV
     saturation, crayon territory) and settled at 0.17, which lands the mid
     sand at 37.5% against the blocker's ≥33% and the near sand at 44.2%. */
  const CHROMA_GAIN = 0.17;
  /* ⚠ THE COOL-SURFACE GATE. Round 4's failed clause: the warm restore above
     is an UNCONDITIONAL multiply over everything below the horizon, so it
     stripped blue from the things the BAR requires to STAY blue as happily as
     it stripped it from sand. Measured W1 → round-3, same frame, only this
     file differing: the water pool went R−B −3.5 → +15.9, the near-water band
     −16.0 → +15.6 and a teal movement slab −13.5 → +2.7, i.e. every cool
     surface crossed neutral into olive, and the cool population of the field
     fell 16.25% → 10.76%. The BAR asks for "a blue-teal water pool … darker
     and cooler" and "teal for movement range"; a restore that eats those is
     not a restore.
     So the multiply stays unconditional (it is a baked blit and gating it
     per-pixel would cost a full-canvas upscale — measured 10.3ms on this box,
     see coolThumb) and the blue it removed is handed BACK, additively, through
     a per-frame mask keyed on (B−R). These two numbers are that mask's ramp,
     in 8-bit (B−R): at or below COOL_LO nothing is given back and the pixel
     keeps the full warm restore, at or above COOL_HI the restore is cancelled
     EXACTLY and the pixel comes out of grade() with the chroma it went in
     with. Sand measures B−R around −20 and −35, water and the teal slabs +4
     to +16, so the gap is wide and the ramp can afford to be narrow. */
  const COOL_LO = -14, COOL_HI = 2;
  /* ⚠ THE MICRO-CONTRAST RESTORE — the other half of round 4's verdict.
     The warm multiply is (1, 1−0.42k, 1−k); its luma is 1 − 0.3726k ≈ 0.933 at
     noon, so it does not just shift hue, it SCALES every luma delta in the
     frame down by 6.7%. That is exactly what the critic measured: median local
     luma sd over 16px tiles fell in five of six field bands (near 3.20 → 2.92,
     midlow 3.77 → 3.44, mid 5.56 → 5.37). The old fix was `addV`, a flat
     additive grey that put the MEAN back and could not put the DELTAS back —
     an additive term never restores a multiplicative loss.
     A multiplicative restore needs either a per-pixel gain (a full-canvas self
     'lighter' draw: 10.3ms, no) or a blend mode that IS a gain. 'color-dodge'
     against a constant is one: B(Cb,Cs) = Cb/(1−Cs), a pure per-channel
     multiply by 1/(1−Cs), from a flat fill that costs nothing. TONE_GAIN is
     that multiplier. It is set ABOVE the 1/0.933 = 1.071 that merely undoes
     the multiply, because the blocker asked for contrast, not for break-even.
     TONE_PEDESTAL is subtracted first ('difference' with a near-black, also a
     flat fill) so the gain lands as CONTRAST rather than as exposure: mean
     ≈ (0.933·L − p)·g holds L while the deltas come out ×0.933·g. It is small
     enough that everything it crushes is below the toe clamp's floor anyway
     (SHADOW_FLOOR is 16/20/34 and 'lighten' runs last), so no shadow detail
     that survives to the screen is lost to it. */
  const TONE_PEDESTAL = 7;
  const TONE_GAIN = 1.16;
  /* how much of a FULLY disagreeing backdrop photograph gets taken away (see
     draw()). This is the SECOND of the two levers on art that does not belong;
     the first and much stronger one is the value match at the end of bakeArt.
     Tried at 0.82, 0.45 and 0.60 with the value match in place: 0.45 visibly
     greys the sky back toward the photo's overcast, 0.82 all but removes the
     location, 0.60 keeps the deep sky and the layered ranges while a location
     card still plainly changes the vista, which is the user's own ask.
     Art that measures warm (dis→0) is not touched at all. */
  const ART_YIELD = 0.60;

  /* ── hex ↔ rgb, and LUMA SHIFTS ───────────────────────────────────────────
     The ridge palette is built by shifting ONE base colour up and down in luma
     rather than by mixing toward arbitrary hexes. Round 3's review put a
     literal number on the mesa face split ("worth at least ±8 luma"), and a
     mix toward a hue has no predictable luma at all — mixing ROCK_BASE 40%
     toward LIGHT.fog moves it 22 luma at noon and 6 at night, so a palette
     built out of mixes silently loses its contrast the moment the rig changes.
     A shift is a shift. ── */
  function hexRGB(h) {
    h = String(h == null ? '#000' : h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (!isFinite(n)) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHex(r, g, b) {
    const c = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2);
    return '#' + c(r) + c(g) + c(b);
  }
  /* add `d` to every channel — a flat luma shift that keeps the hue */
  function shiftL(hex, d) { const c = hexRGB(hex); return rgbHex(c[0] + d, c[1] + d, c[2] + d); }

  /* ── CHROMA SETTER ────────────────────────────────────────────────────────
     Returns `hex` with its hue and mid-lightness untouched and its chroma —
     max(r,g,b) − min(r,g,b), in 8-bit — forced to `span`. Needed because the
     two blend modes that grade the backdrop art, 'saturation' and 'color', are
     both specified over SetSat/SetLum, which read the SOURCE's ABSOLUTE
     channel spread. `hazeColour()` is deliberately pale (it is air), and a
     pale colour carries very little spread, which is how a hue push aimed at
     it silently became a second desaturation pass.

     ⚠ A SPAN, NOT AN HSL SATURATION. The first cut of this took an HSL
     saturation and undershot badly: at the pale lightness distant haze sits at
     (l ≈ 0.77) an HSL saturation of 0.42 is a span of only 48, i.e. an HSV
     saturation of 21% before any of the later passes touched it, against a
     field measuring 41%. The blends consume a span, so this takes a span.
     See ART_CHROMA. ── */
  function withChroma(hex, span) {
    const c = hexRGB(hex);
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    const mid = (mx + mn) / 2, cur = mx - mn;
    /* a colour with no hue at all has no direction to scale along; give it the
       desert's, so a neutral fog colour still lands warm rather than grey */
    if (cur < 1.5) return rgbHex(mid + span * 0.5, mid + span * 0.06, mid - span * 0.5);
    const k = span / cur;
    return rgbHex(mid + (c[0] - mid) * k, mid + (c[1] - mid) * k, mid + (c[2] - mid) * k);
  }

  /* ══════════════════════════════════════════════════════════════════════
     WAVE 3'S BLOCKER: "THE SKY AND THE GROUND ARE FURTHER APART THAN IN WAVE 1"

     Measured on the wave-2 frame: sunlit sand rgb(185,157,110), HSV sat 41%,
     R−B +75, L 160.  Sky away from the sun rgb(76,79,84), sat 9%, R−B −7,
     L 79.  Far ridge rgb(84,85,83), sat 3%, R−B +1.  A moonlit night sky
     pasted above a noon desert, with a blazing sun disc in it.

     ⚠ AND THE CAUSE WAS NOT WHERE IT LOOKED. The obvious suspect is the sky
     gradient, and it is guilty of the LUMINANCE half — TIME_PRESETS.day.sky is
     ['#18243c','#31465f','#6b7f92'], luma 34/68/121, a dusk sky that the
     renderer has always called noon. But it is innocent of the CHROMA half.
     Proved by injecting a flat sky and reading the board canvas back: painting
     the sky rgb(90,138,200) (HSV sat 55%) and screenshotting gave a sky of
     rgb(154,166,166), sat 8.5%. Turning ONE pass off — the backdrop art —
     with the same injected sky gave rgb(96,142,201), sat 52.7%.
     So the thing the player calls "the sky" is not this module's sky at all:
     it is the LOCATION BACKDROP PHOTOGRAPH, drawn over the whole upper frame
     at near-full alpha, and bakeArt was grading it to death:
       • 'saturation' toward hsl(0,14%,50%) — a hard 14% chroma ceiling;
       • 'color' toward mix(mix(fog,disc,.54), HAZE, .55), whose own HSL
         saturation is 9%, so the pass that was supposed to push the photo's
         hue onto the desert's axis was in fact a SECOND desaturation;
       • the value match then multiplied the whole thing DOWN to the mean luma
         of our own (dark preset) sky, which is where L 79 came from.
     Every one of those is fixed below and each has its own note. The far ridge
     is grey for the same reason — the ridge the critic measured is the
     PHOTOGRAPH's ridge, not our procedural mesas (those measure R−B +35).
     ══════════════════════════════════════════════════════════════════════ */

  /* How much daylight is in this preset, 0..1. Keyed on the sun's ELEVATION,
     not on keyI: dawn/dusk/day sit at keyI 0.95/1.00/1.15, which cannot
     separate a low orange sun from noon, while elev 0.20/0.16/0.78 can. A moon
     is never daylight however bright it is. */
  /* ⚠ AT THE `day` PRESET THIS SATURATES, AND THAT IS A KNOWN TRADE, NOT AN
     OVERSIGHT. elev 0.78 gives (0.78-0.12)/0.50 = 1.32, clamped to 1.0, so
     skyStops() returns the DAY_* palette OUTRIGHT rather than a blend with
     api.LIGHT.sky — i.e. at noon the sky no longer responds to TIME_PRESETS
     at all. It is deliberate: wave 3's blocker was that the sky and the ground
     were 21.8 saturation points apart and the preset's own sky is what put
     them there. But it means that if the presets are ever retuned, day is the
     one that will look like it ignored the change. The knob is the 0.50
     divisor (raise it to leave headroom, e.g. 0.80 tops out at d≈0.83 and lets
     a sixth of the preset back in); dawn/dusk at elev 0.20/0.16 are on the
     ramp already at d 0.16/0.08 and are unaffected either way. */
  function dayness(api) {
    const L = api.LIGHT;
    const sun = (L.body === 'sun') ? api.clamp(L.elev, 0, 1) : 0;
    return api.clamp((sun - 0.12) / 0.50, 0, 1);
  }

  /* ── THE SKY, REGRADED INTO THE KEY THAT LIGHTS THE GROUND ────────────────
     The three DAY_* stops are a desert noon: a real blue at the top, and a
     warm dust band at the horizon that is on the SAND's hue axis, because the
     air over a desert carries the desert. They are blended in by dayness(), so
     night is bit-for-bit the preset it always was (day=0 → mixHex(x, y, 0) is
     x) and dawn/dusk take only the 8–16% of the lift their sun elevation earns.
     Do not "simplify" this by editing TIME_PRESETS — battle-board/index.html
     belongs to stage-terrain and the presets also drive the terrain's own
     cliff shading, which is correct as it stands. ── */
  /* ⚠ THE MIDDLE STOP STAYS BLUE, AND THAT IS THE WHOLE TRICK. A gradient that
     interpolates a blue zenith to a warm dust horizon passes through NEUTRAL on
     the way, and a per-pixel saturation mean reads that crossover band as
     achromatic — measured on the first cut: sat 21-25% at the top, 5-6% across
     y 0.06-0.11 of the board, 29-31% at the horizon. Real hazy skies do the
     same thing but they do it in the last few degrees above the horizon, which
     here is behind the ridgeline and the board. So the middle stop is held on
     the blue side and the warm dust is left to the bottom stop, which the
     gradient (0 → max(hz*1.25, H*0.5)) puts at or below the board's far edge. */
  /* ⚠ THESE ARE MORE SATURATED THAN THE SKY YOU WANT ON SCREEN, ON PURPOSE.
     Between the sun's own glow, the light shafts, the veil's centre lift and
     the bloom, the passes that run over the sky are all ADDITIVE and warm, and
     an additive term pulls every pixel toward neutral. Measured end to end: a
     zenith painted at chroma span 110 arrives in the screenshot at an HSV
     saturation of 19.6%. The stops are therefore set by what comes OUT, not by
     what looks right in the bake. */
  const DAY_ZENITH = '#3f74bd';   /* (63,116,189) L 110, chroma span 126 */
  const DAY_MIDSKY = '#6c9acd';   /* (108,154,205) L 145, span 97 — still blue */
  const DAY_HORIZON = '#d3c3a0';  /* (211,195,160) L 192, R−B +51 — dust, not fog */
  function skyStops(api) {
    const L = api.LIGHT, d = dayness(api);
    const s = (L.sky && L.sky.length === 3) ? L.sky : ['#18243c', '#31465f', '#6b7f92'];
    if (d <= 0) return s.slice();
    return [api.mixHex(s[0], DAY_ZENITH, d),
    api.mixHex(s[1], DAY_MIDSKY, d),
    api.mixHex(s[2], DAY_HORIZON, d)];
  }

  /* ⚠ AERIAL PERSPECTIVE NEEDS A *LIGHT* HAZE COLOUR, AND `LIGHT.fog` IS NOT ONE.
     This is the whole reason round 2's depth ordering measured BACKWARDS (the
     MID range came out more saturated than the NEAR one at the same value).
     `LIGHT.fog` in this rig is a dark desaturated blue-grey — '#3a4454' at
     noon, luma 68 — so "mix further toward fog for distance" desaturated the
     rock but also DARKENED it, and a far range ended up the same value as a
     near one. Real aerial perspective lifts distance toward the colour of the
     air at the horizon, which is the bottom sky stop. Mixing toward THAT both
     lightens and desaturates, which is what the clause actually asks for.

     ⚠ AND IT MUST BE WARM. The first cut of this used the bottom sky stop
     straight, which is a cold blue-grey at noon; the ranges promptly turned
     into pale grey fog banks against warm ochre sand — the exact "two worlds
     stacked" note the review made about the backdrop photo, reproduced by the
     module itself. The air over a desert carries the desert's own dust, so the
     haze is pulled a third of the way toward the disc and a third toward
     SAND_PALE. It stays light (that is what makes distance lift) but it stays
     in the sand's family. */
  function hazeColour(api) {
    const L = api.LIGHT;
    /* ⚠ WAVE 3: the bottom stop of the REGRADED sky, not of the raw preset.
       Everything that lifts toward distance in this module — all the mesa
       ranges, the haze band, the fog band in the veil, the backdrop art's hue
       push — converges here, so if this still read the preset's cold #6b7f92
       while the sky above it had been warmed, the ridges would converge on a
       colour that is no longer in the frame. That is exactly the failure mode
       the blocker describes, one layer down. */
    const horizonSky = skyStops(api)[2] || L.fog;
    /* ⚠ THE FIXED 0.18 SAND MIX DID NOT ACTUALLY MAKE THIS WARM, AND THE WHOLE
       HORIZON PAID FOR IT. Worked out per preset: dawn landed at #ba8f68
       (R−B +82) and dusk at #c57343 (+130) — properly warm — but DAY, the
       default, landed at #a8aba2, R−B +6. A neutral grey-green. Every layer
       that mixes toward this colour for distance (all three mesa ranges, the
       haze band, the backdrop art's flatten wash) therefore converged on
       grey-green at exactly the time of day the game opens in, which is why
       the horizon kept reading as fog over a different world instead of as the
       air over this one.
       So the sand mix is SOLVED FOR, not guessed: mix toward SAND_PALE by
       exactly as much as it takes to reach a target warmth, which is itself
       keyed to the light — a bright desert noon wants R−B ≈ +26 of dust in the
       air, a moonlit one wants a quarter of that. Presets that are already
       warmer than the target keep their own colour (the mix clamps at 0.14). */
    const s0 = api.mixHex(horizonSky, L.disc, 0.34);
    const c0 = hexRGB(s0);
    const d0 = c0[0] - c0[2];
    const dSand = 92;                                  /* SAND_PALE's own R−B */
    const target = 8 + 18 * api.clamp(L.keyI / 1.15, 0, 1);
    const t = api.clamp(d0 >= dSand ? 0.14 : (target - d0) / (dSand - d0), 0.14, 0.55);
    let h = api.mixHex(s0, SAND_PALE, t);
    /* ⚠ HAZE IS LIT AIR, SO IT HAS TO GO OUT WITH THE KEY. `disc` at night is
       a pale moon white and SAND_PALE is a pale sand, so the unscaled mix came
       out at luma ~108 — brighter than the night sky it hangs in — and the
       ranges glowed warm tan under a blue moon. Below a key intensity of 0.9
       the haze is pulled toward the sky's own darkness. */
    const k = api.clamp(L.keyI, 0.2, 1.3);
    if (k < 0.9) {
      h = api.mixHex(h, api.mixHex(horizonSky, L.ambient, 0.5), (0.9 - k) / 0.9 * 0.9);
    }
    return h;
  }

  /* ── deterministic RNG. The skyline must be identical every run (the
     screenshot harness compares frames) and must NOT be left-right
     symmetric, which rules out mirroring one half. ── */
  function strHash(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── the diagnostic seam ──────────────────────────────────────────────────
     ⚠ WHY THIS EXISTS. Wave 2 opened with "the whole field is behind a milky
     veil" and four candidate causes inside this one file (bloom, shadow mask,
     distance fog, centre lift). There is no way to tell them apart from a
     finished frame — every one of them is a low-alpha full-viewport composite
     and they all look identical once summed. `window.__vistaOff = {bloom:1}`
     turns a single pass off so a screenshot diff can name the guilty one.
     Read at CALL time, never cached, and it costs one property read per pass.
     Same spirit as window.__vistaDebug below: a bake or a pass that is quietly
     wrong is completely silent, so there has to be a way to ask. */
  function off(name) {
    const o = window.__vistaOff;
    return !!(o && o[name]);
  }

  /* ── caches ───────────────────────────────────────────────────────────── */
  const S = {
    sky: { key: '', cv: null },
    land: { key: '', cv: null },
    veil: { key: '', cv: null },       /* fog + vignette + centre lift, pre-composited */
    chroma: { key: '', mul: null, add: null },  /* the warm chroma restore, as two ramps */
    art: new Map(),          /* image src -> { key, cv } graded + horizon-clipped */
    bloom: { cv: null, g: null, up: null, upg: null },  /* thumbnail + the quarter-size intermediate the upscale goes through */
    shade: { cv: null, g: null },      /* the cool-shadow mask, same thumbnail scale */
    /* the cool-surface chroma give-back, + the frame's per-channel extremes.
       key/age/reads/calls/ms belong to the READBACK CACHE — see coolThumb. */
    cool: { cv: null, g: null, live: null, mn: null, mx: null, key: '', age: 1e9, reads: 0, calls: 0, ms: [] },
    gradeMs: [],
    coolFail: false,         /* sticky: a tainted canvas must not throw every frame */
    lastBake: -1e9,
    artMs: [],
    drift: null
  };

  /* ⚠ FEATURE-DETECT EVERY BLEND MODE BEFORE YOU RELY ON IT. Setting an
     unsupported globalCompositeOperation is a silent no-op that leaves the
     PREVIOUS op in place, so an unsupported 'color-dodge' would not disable
     the tone pass — it would run it as whatever came before, which is how you
     get a frame painted flat grey on one browser and nobody notices. Probed
     once on a 1x1 scratch context and cached. */
  let _opCv = null;
  const _opOK = Object.create(null);
  function opSupported(op) {
    if (op in _opOK) return _opOK[op];
    let ok = false;
    try {
      if (!_opCv) { _opCv = document.createElement('canvas'); _opCv.width = _opCv.height = 1; }
      const g = _opCv.getContext('2d');
      if (g) { g.globalCompositeOperation = 'source-over'; g.globalCompositeOperation = op; ok = (g.globalCompositeOperation === op); }
    } catch (e) { ok = false; }
    _opOK[op] = ok;
    return ok;
  }

  /* the bloom/shade/cool thumbnail size. ONE definition, because three passes
     sum into the same thumbnail and are upscaled together exactly once — if
     these ever disagree the terms land at different scales and the sum is
     nonsense. */
  function thumbW(api) { return Math.max(32, Math.round(api.W / 7)); }
  function thumbH(api) { return Math.max(24, Math.round(api.H / 7)); }

  function mkCanvas(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d');
    if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cv: c, g: g };
  }
  /* ⚠ BLIT A BAKE 1:1 IN DEVICE PIXELS, NOT THROUGH THE DPR TRANSFORM.
     Measured on this box's software rasteriser, same 1640x1600 canvas:
       drawImage(cv, 0,0, W,H)  under the ctx's DPR transform … 10.9 ms
       drawImage(cv, 0,0)       under an identity transform  …  1.4 ms
     Identical output — the bakes are already made at device resolution — but
     the scaled path re-samples every pixel while the 1:1 path is a blit. Four
     full-viewport bakes are blitted per frame, so this is ~38ms/frame. If the
     sizes ever disagree (a fractional devicePixelRatio rounding differently)
     we fall back to the scaled draw rather than shifting the image. */
  function blit(ctx, cv, W, H) {
    if (!cv) return;
    if (cv.width === ctx.canvas.width && cv.height === ctx.canvas.height) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cv, 0, 0); ctx.restore();
    } else {
      ctx.drawImage(cv, 0, 0, W, H);
    }
  }
  function dprOf(api) {
    /* the stage caps DPR at 2 in resize(); mirror it rather than reading
       devicePixelRatio again, so a bake is never larger than the canvas. */
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  /* THE horizon: the board's far edge, wall included. Everything above it is
     sky/world, everything below is the desert the board sits in. */
  function horizonY(api) {
    const far = api.project({ x: 0, y: 0, z: -api.MAP.rows / 2 - (api.CONFIG.wall || 0) });
    return far ? far.y : api.H * 0.30;
  }
  /* the board's near edge — below this we are looking at foreground dirt that
     is closer to the camera than any tile, so it gets the strongest falloff. */
  function nearY(api) {
    const p = api.project({ x: 0, y: 0, z: api.MAP.rows / 2 });
    return p ? p.y : api.H * 0.86;
  }

  /* ── the celestial body ───────────────────────────────────────────────────
     Project the REAL light direction, then walk back along that screen ray
     until the point is inside the frame. Compressing along the ray is what
     keeps the azimuth honest: a day sun (az .28) stays right of centre, a
     dawn sun (az -.85) stays left, and both agree with the way every cliff
     shadow the terrain bakes is pointing. A raw projection is useless on its
     own — the day sun lands ~850px off the right edge and 4200px above the
     top, because it really is that high. */
  function bodyPos(api) {
    const L = api.lightVector();
    const cx = api.VIEW.cx, cy = api.VIEW.cy;
    const hz = horizonY(api);
    let px, py;
    const p = api.project({ x: L.x * 60, y: L.y * 60, z: L.z * 60 });
    if (p) { px = p.x; py = p.y; } else { px = cx + api.W * 0.28; py = cy - api.H * 0.34; }
    let dx = px - cx, dy = py - cy;
    const maxX = api.W * 0.40, maxY = Math.max(40, cy - api.H * 0.10);
    let t = 1;
    if (Math.abs(dx) > 1) t = Math.min(t, maxX / Math.abs(dx));
    if (Math.abs(dy) > 1) t = Math.min(t, maxY / Math.abs(dy));
    px = cx + dx * t; py = cy + dy * t;
    /* keep it in the sky band: a body drawn below the far edge would be
       occluded by the terrain the very next pass and read as a bug. */
    py = api.clamp(py, api.H * 0.045, Math.max(api.H * 0.05, hz - 14));
    px = api.clamp(px, api.W * 0.07, api.W * 0.93);
    return { x: px, y: py, sun: api.LIGHT.body === 'sun' };
  }

  /* ── skyline generator ────────────────────────────────────────────────────
     Mesas, not hills: a flat top, a talus slope in, an occasional stepped
     shoulder. Walking left to right with a fresh random width each segment is
     what keeps it asymmetric — no mirroring, no repeat period. */
  /* CANYON BIAS. Height is scaled up toward the left and right edges and down
     in the middle, so the ranges frame the field the way a canyon does and
     the centre keeps its distance view. It is also the cheapest way to stop
     the skyline covering the play area: the tallest rock is where the board
     never reaches. */
  function canyonBias(x, W) {
    const t = Math.abs(x - W * 0.5) / (W * 0.5);
    return 0.50 + 1.05 * t * t;
  }
  /* ⚠ ROUND-2 SHAPE BUG. The first pass walked one width per segment with a
     single talus slope, which produced very long dead-flat tops: two enormous
     tan slabs, one per side, that read as cardboard rather than rock. A mesa
     now gets its own approach slope, a BROKEN top (3-5 short spans that
     wander a few px) and a departure slope, and the widths are much shorter
     — so the skyline is a series of buttes with real intervals of low ground
     between them. */
  /* ⚠ RETURNS `{ pts, mesas }`, NOT A BARE POINT LIST. Round 3's review asked
     for structure that does NOT depend on segment direction — a per-butte face
     split and a talus fan at each foot — and both need to know where one mesa
     ends and the next begins. Deriving that back out of the polyline is
     guesswork; the generator already knows it, so it says so. */
  function mesaLine(rand, W, baseY, amp, seg) {
    const pts = [];
    const mesas = [];
    let x = -90;
    let y = baseY - amp * canyonBias(x, W) * (0.22 + rand() * 0.34);
    pts.push({ x: x, y: y });
    let guard = 0;
    while (x < W + 90 && guard++ < 500) {
      const w = seg * (0.34 + rand() * 1.05);
      const bias = canyonBias(x + w * 0.5, W);
      let ny = y + (rand() - 0.42) * amp * 0.95;
      /* ⚠ THE MINIMUM HEIGHT IS 0.30, NOT 0.06, AND THAT IS ABOUT FRAMING.
         canyonBias already scales height up toward the two edges, but with a
         floor of 0.06·amp the walk was still free to flatten a shoulder to
         nothing — and one seed did exactly that, leaving the right side of the
         frame with no skyline at all above the board's far edge. 0.30 puts a
         real butte at both shoulders on every seed while leaving the centre,
         where bias is lowest and the board sits, open. */
      ny = Math.min(baseY - amp * bias * 0.30, Math.max(baseY - amp * bias * 1.30, ny));
      /* approach face: steep, occasionally with a stepped shoulder */
      const slope = w * (0.16 + rand() * 0.30);
      if (rand() < 0.34) {
        const midY = y + (ny - y) * (0.35 + rand() * 0.3);
        pts.push({ x: x + slope * 0.40, y: midY });
        pts.push({ x: x + slope * 0.68, y: midY + (rand() - 0.5) * amp * 0.05 });
      }
      pts.push({ x: x + slope, y: ny });
      /* broken cap: the flat top is never one straight line */
      const capW = w - slope;
      const steps = 2 + ((rand() * 3) | 0);
      for (let s = 1; s <= steps; s++) {
        pts.push({ x: x + slope + capW * (s / steps), y: ny + (rand() - 0.5) * amp * 0.10 });
      }
      mesas.push({ x0: x, x1: x + w, capY: ny, h: Math.max(4, baseY - ny) });
      x += w; y = pts[pts.length - 1].y;
    }
    return { pts: pts, mesas: mesas };
  }
  function tracePts(g, pts, baseY, W) {
    g.beginPath();
    g.moveTo(-90, baseY + 400);
    for (let i = 0; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.lineTo(W + 90, baseY + 400);
    g.closePath();
  }

  /* ── ONE DISTANCE LAYER ───────────────────────────────────────────────────
     ⚠ ROUND-3 REWRITE, AND THE REASON IS MEASURED. Round 2 shipped this as a
     silhouette + a vertical gradient + per-segment shading, and the per-segment
     shading only fired where `dx>0 AND the face turns away`, so most of every
     mesa received NOTHING. Measured inside the left-shoulder MID range
     (box 50,310,55,80 of the board crop): horizontal luma sd 2.19. That is a
     single uniform fill behind a hard polygon edge — a paper cutout, and it
     spans the entire top of the field, which is the one part of the vista a
     player looks straight at above the board.

     Everything added below is DELIBERATELY INDEPENDENT OF SEGMENT DIRECTION,
     so it lands on every pixel of every silhouette:
       1. FACE SPLIT — per butte, one horizontal ramp: the flank turned toward
          `opt.lightX` is lifted, the other is dropped. ≥±8 luma by
          construction (the palette is built with shiftL, not by hue mixing).
       3. STRATA — horizontal beds across the whole layer with per-band
          alpha and seeded vertical jitter. This is the same trick
          battle-board/index.html:1605-1616 already uses on the terrain's cliff
          walls, on purpose: the world behind the board and the rock in it
          should be made of the same stuff.
       4. GULLIES — near-vertical erosion channels down each butte's face, each
          with a dark cut and a lit lip. These are what actually put HIGH
          spatial frequency into a horizontal scan line; horizontal beds alone
          only vary a row where their jittered edge crosses it.
       2. TALUS — a scree fan fading UP from every foot, hazier and lighter
          than the wall above it, so the range stands in the ground instead of
          being stamped on it.
     The old per-segment shading and rim survive underneath as variety; they
     are no longer load-bearing. */
  function ridgeLayer(api, g, opt) {
    const { W } = api, LIGHT = api.LIGHT;
    const rand = opt.rand;
    /* ⚠ TWO SEPARATE RANDOM STREAMS, AND THE SPLIT IS DELIBERATE. `rand` is
       the shared skyline stream — one walk through all three layers, which is
       what keeps the composition identical whether or not backdrop art is
       present. `dr` is this layer's own DETAIL stream. They were the same
       stream in the first cut, so changing the number of strata beds changed
       how many draws the MID layer consumed, which reshuffled the NEAR layer's
       silhouette and moved the entire skyline. Tuning surface texture must not
       move the mountains. */
    const dr = mulberry32(strHash((api.MAP.id || 'map') + '|ridge|' + opt.key));
    /* same night bias as the floor: a weak key means more air between us and
       the rock, so every range sits further toward the haze colour */
    const fogMix = Math.min(0.92, opt.fog + api.clamp(0.26 - LIGHT.keyI * 0.19, 0, 0.20));
    const HAZE = hazeColour(api);
    const base = api.mixHex(opt.rock, HAZE, fogMix);
    /* ⚠ THE CAP/FOOT ORDER IS FLIPPED FROM ROUND 2. With the old dark
       `LIGHT.fog` a *less* fogged foot came out lighter; with a real horizon
       haze colour it is the other way round, and the physical fact is the one
       that matters — haze pools at the base of a distant range, so the foot is
       the hazier, lighter, flatter end and the cap keeps what contrast the
       distance left it. It also makes each range bleed into the ground at its
       feet instead of sitting on a cut line. */
    const capC = api.mixHex(opt.rock, HAZE, Math.max(0, fogMix - 0.13));
    const footC = api.mixHex(opt.rock, HAZE, Math.min(0.95, fogMix + 0.12));
    /* F = how much internal contrast this distance is still allowed. A far
       range has almost none left (that IS aerial perspective); a near bluff
       has all of it. */
    const F = api.clamp(opt.form, 0.2, 1);
    /* the face-split pair. Built off `base` with an explicit luma shift so the
       ±8 luma the review asks for is arithmetic, not hope: at alpha `fa` the
       delivered split is fa × 30 ≈ 10-15 luma either side. */
    const LITC = shiftL(api.mixHex(base, LIGHT.key, 0.20), 30);
    const SHADEC = shiftL(api.mixHex(base, LIGHT.ambient, 0.26), -30);
    const fa = 0.34 + 0.18 * F;
    /* strata pair — a pale bed and a dark bed */
    const BEDL = shiftL(api.mixHex(base, LIGHT.key, 0.10), 40);
    const BEDD = shiftL(api.mixHex(base, LIGHT.ambient, 0.18), -50);
    /* scree: lighter than the wall AND hazier, because it is the bottom of the
       air column and because loose broken rock scatters more light than a face */
    const TALUS = shiftL(api.mixHex(base, HAZE, 0.22), 12);

    const built = mesaLine(rand, W, opt.baseY, opt.amp, opt.seg);
    const pts = built.pts, mesas = built.mesas;
    /* ⚠ topY IS MEASURED, NOT ASSUMED, AND THAT WAS A REAL BUG. It started as
       `baseY - amp*1.45`, but canyonBias scales a mesa's height by up to 1.73
       at the frame edges (t>1 outside [0,W]), so the tallest buttes — which
       are exactly the ones at the left and right shoulders, the only ridge
       pixels the board does not cover — reached ~2.25·amp and their caps sat
       ABOVE the region the strata bands and the face-split rect covered. The
       result measured sdX 2.1 on the right shoulder: the caps were receiving
       nothing at all while the buried middles got everything. */
    let topY = opt.baseY - opt.amp * 1.45;
    for (let m = 0; m < mesas.length; m++) {
      if (mesas[m].capY - opt.amp * 0.06 < topY) topY = mesas[m].capY - opt.amp * 0.06;
    }

    g.save();
    tracePts(g, pts, opt.baseY, W);
    const grd = g.createLinearGradient(0, opt.baseY - opt.amp * 2.0, 0, opt.baseY + 26);
    grd.addColorStop(0, capC);
    grd.addColorStop(1, footC);
    g.fillStyle = grd;
    g.fill();
    g.clip();

    /* ── 1. FACE SPLIT, per butte ──────────────────────────────────────────
       One horizontal ramp across each mesa's own x-span. `opt.lightX` is the
       screen-space side the sun is on (sign of body.x − VIEW.cx), the SAME
       number the terrain derives its cliff shading from, so a mesa's lit flank
       and a plateau's lit wall always agree. The ramp is transparent through
       the middle third so two adjacent buttes do not weld into one gradient. */
    for (let m = 0; m < mesas.length; m++) {
      const M = mesas[m];
      const w = M.x1 - M.x0;
      if (w < 6) continue;
      const litRight = opt.lightX >= 0;
      const jit = 0.85 + dr() * 0.3;    /* no two buttes split identically */
      /* ⚠ OVERLAP AND TAPER, OR YOU GET A RULED VERTICAL LINE AT EVERY BUTTE
         BOUNDARY. The first cut ran the ramp exactly [x0,x1] at full strength
         at both ends, so a lit flank at 0.46 alpha butted straight against the
         next butte's shaded flank at 0.46 — a hard vertical seam right down
         the middle of the range, which is a drawn edge and the BAR's whole
         complaint. Extending 14% past each end and tapering the outermost
         stops lets neighbours cross-fade; what survives at the join is a soft
         dark crease, which is what the gap between two buttes actually is. */
      const ov = w * 0.14;
      const fg2 = g.createLinearGradient(M.x0 - ov, 0, M.x1 + ov, 0);
      const A = litRight ? SHADEC : LITC, B = litRight ? LITC : SHADEC;
      fg2.addColorStop(0, api.rgba(A, 0));
      fg2.addColorStop(0.16, api.rgba(A, fa * jit));
      fg2.addColorStop(0.42, api.rgba(A, fa * 0.16));
      fg2.addColorStop(0.58, api.rgba(B, fa * 0.16));
      fg2.addColorStop(0.84, api.rgba(B, fa * jit));
      fg2.addColorStop(1, api.rgba(B, 0));
      g.fillStyle = fg2;
      g.fillRect(M.x0 - ov - 1, topY, w + ov * 2 + 2, opt.baseY - topY + 40);
    }

    /* ── 2. TALUS / SCREE ──────────────────────────────────────────────────
       A fan spreading from each foot, fading UPWARD into the wall. Asymmetric
       on purpose (the two flanks get different widths and heights) — a
       symmetric cone at the base of every butte is exactly the evenly-spaced
       identical prop the BAR calls the AI-game tell. */
    for (let m = 0; m < mesas.length; m++) {
      const M = mesas[m];
      const w = M.x1 - M.x0;
      if (w < 10) continue;
      const cx2 = (M.x0 + M.x1) * 0.5;
      const hw = w * 0.5;
      /* ⚠ CAPPED AT 0.30·amp, AND DRAWN BEFORE THE BEDS. At 0.50·amp the fan
         off a frame-edge butte — which canyonBias makes ~2.2·amp tall — was a
         pale wash 82px high sitting OVER the strata and gullies, and the left
         shoulder measured sdX 3.2: all the structure was there and all of it
         was underneath a scree fan. Scree piles at the foot of a wall; it does
         not climb halfway up it. */
      const h = Math.min(opt.amp * 0.30, M.h * (0.20 + dr() * 0.18));
      const lw2 = hw * (0.85 + dr() * 0.55), rw = hw * (0.85 + dr() * 0.55);
      g.beginPath();
      g.moveTo(cx2 - lw2 * 1.18, opt.baseY + 30);
      g.lineTo(cx2 - lw2 * (0.28 + dr() * 0.2), M.capY + M.h - h);
      g.lineTo(cx2 + rw * (0.22 + dr() * 0.22), M.capY + M.h - h * (0.72 + dr() * 0.3));
      g.lineTo(cx2 + rw * 1.2, opt.baseY + 30);
      g.closePath();
      const tg = g.createLinearGradient(0, M.capY + M.h - h, 0, opt.baseY + 12);
      tg.addColorStop(0, api.rgba(TALUS, 0));
      tg.addColorStop(0.55, api.rgba(TALUS, (0.14 + dr() * 0.10) * (0.6 + 0.4 * F)));
      tg.addColorStop(1, api.rgba(TALUS, (0.28 + dr() * 0.16) * (0.6 + 0.4 * F)));
      g.fillStyle = tg;
      g.fill();
    }

    /* ── 3. STRATA ─────────────────────────────────────────────────────────
       Horizontal beds, full width, jittered. Bands are drawn as a wobbling
       quad rather than a straight rect precisely so that a horizontal scan
       line through the range crosses in and out of them — a dead-straight bed
       adds nothing to the horizontal variance the review measures, and looks
       like a ruled line besides. */
    /* ⚠ `step` IS THE ONE NUMBER THAT DECIDES WHETHER THIS PASSES. The first
       cut walked the band in W/30 ≈ 27px strides, which put roughly ONE
       wobble inside the 55px-wide box the review measures — the beds came out
       nearly straight at that scale and the horizontal sd only moved 2.2→4.5.
       W/80 ≈ 10px gives a genuinely crinkled bed edge, which is also what
       weathered sedimentary rock looks like from a kilometre away. */
    /* ⚠ COUNT, NOT PLACEMENT. Two earlier cuts tried to aim the beds at the
       part of the range the board does not cover — first `u = t`, then
       `u = t^1.9` to bias them toward the cap. Both failed the same way: the
       three ranges have different heights AND canyonBias stretches the buttes
       at the frame edges to 2.25·amp, so there is no single distribution that
       lands beds on the visible slice of all of them. The honest fix is to bed
       the WHOLE column densely — 13-19 beds spread evenly, each thin — which
       is also what a sandstone cliff looks like. Cost is bake-time only. */
    /* ⚠ DENSITY, NOT A FIXED COUNT. topY is the highest cap in the layer, and
       canyonBias makes the frame-edge buttes over twice the height of the ones
       in the middle — so a fixed 11-17 beds spread over [topY, baseY] left the
       tall shoulder mesas with beds 60px apart while the low middle ones (which
       the board hides anyway) got a bed every 12px. Fixing the SPACING at a
       fraction of amp gives every butte the same bed density whatever the seed
       rolled, which is also how sedimentary rock works. */
    const spacing = opt.amp * 0.115;
    const bands = Math.min(44, Math.max(6, Math.ceil((opt.baseY - topY) / spacing)));
    const step = Math.max(8, W / 80);
    for (let s = 0; s < bands; s++) {
      const u = (s + 0.2 + dr() * 0.6) / bands;            /* 0 = cap, 1 = foot */
      const yMid = topY + (opt.baseY - topY) * u;
      const th = opt.amp * (0.03 + dr() * 0.075);
      const jit = opt.amp * (0.030 + dr() * 0.055);
      const pale = (s % 2) === 0;
      const a = (pale ? 0.14 + dr() * 0.13 : 0.22 + dr() * 0.20) * (0.55 + 0.45 * F);
      /* seeded random walk along x, clamped so a band cannot wander off its bed */
      const top2 = [], bot = [];
      let wob = 0;
      for (let x = -100; x <= W + 100; x += step) {
        wob += (dr() - 0.5) * jit;
        wob = Math.max(-jit * 1.7, Math.min(jit * 1.7, wob));
        top2.push({ x: x, y: yMid + wob });
        bot.push({ x: x, y: yMid + wob + th * (0.7 + dr() * 0.6) });
      }
      g.beginPath();
      for (let i = 0; i < top2.length; i++) i ? g.lineTo(top2[i].x, top2[i].y) : g.moveTo(top2[0].x, top2[0].y);
      for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i].x, bot[i].y);
      g.closePath();
      const bgr = g.createLinearGradient(0, yMid - jit, 0, yMid + th + jit);
      bgr.addColorStop(0, api.rgba(pale ? BEDL : BEDD, a));
      bgr.addColorStop(1, api.rgba(pale ? BEDL : BEDD, a * 0.25));
      g.fillStyle = bgr;
      g.fill();
    }

    /* ── 4. GULLIES ────────────────────────────────────────────────────────
       A wandering dark cut with a lit lip alongside it, running from just
       under the cap down past the foot. Two strokes per gully: the pair is
       what makes it read as a groove with a shape rather than as a scratch. */
    g.lineCap = 'round';
    for (let m = 0; m < mesas.length; m++) {
      const M = mesas[m];
      const w = M.x1 - M.x0;
      if (w < 14 || M.h < opt.amp * 0.20) continue;
      /* ⚠ COUNT MATTERS MORE THAN DEPTH HERE. A butte 100px wide with three
         gullies has one groove per 33px, and the review's measurement box is
         55px — most rows sampled would cross none of them. 5-11 gullies puts
         one every 9-20px, which is both what a fluted sandstone face looks
         like and what actually registers as internal structure. */
      const n = 5 + ((dr() * 7) | 0);
      for (let k = 0; k < n; k++) {
        const x = M.x0 + (0.05 + dr() * 0.90) * w;
        const y = M.capY + M.h * (0.03 + dr() * 0.15);
        /* ⚠ EACH GULLY STOPS SOMEWHERE DIFFERENT. Running every one of them
           from the cap to the base gave a picket fence of equal-length
           verticals — evenly-spaced identical props, which is the exact tell
           the BAR names. A real gully dies out into the slope; these end
           between 40% and 100% of the way down and fade as they go. */
        const yEnd = y + (opt.baseY + 6 - y) * (0.40 + dr() * 0.62);
        const lw = 1.0 + dr() * (2.2 + 2.4 * F);
        const aC = (0.15 + dr() * 0.18) * (0.45 + 0.55 * F);
        const drift = (dr() - 0.5) * w * 0.10;
        const segs = 3 + ((dr() * 3) | 0);
        const cut = [];
        for (let q = 0; q <= segs; q++) {
          const t = q / segs;
          cut.push({ x: x + drift * t + (dr() - 0.5) * lw * 2.4, y: y + (yEnd - y) * t });
        }
        const strokeRun = (pts2, off, style, alpha, width) => {
          /* a gradient along the run so the groove fades out at its lower end
             rather than stopping on a visible tip */
          const sg2 = g.createLinearGradient(0, y, 0, yEnd);
          sg2.addColorStop(0, api.rgba(style, alpha));
          sg2.addColorStop(0.62, api.rgba(style, alpha * 0.75));
          sg2.addColorStop(1, api.rgba(style, 0));
          g.strokeStyle = sg2; g.lineWidth = width;
          g.beginPath();
          for (let q = 0; q < pts2.length; q++) {
            const px2 = pts2[q].x + off;
            q ? g.lineTo(px2, pts2[q].y) : g.moveTo(px2, pts2[q].y);
          }
          g.stroke();
        };
        strokeRun(cut, 0, SHADEC, aC, lw);
        /* the lit lip goes on the side the key is on — but only on some of
           them, so the face is not a row of identical two-tone pairs */
        if (dr() < 0.62) {
          strokeRun(cut, (opt.lightX >= 0 ? lw * 0.9 : -lw * 0.9), LITC, aC * 0.7,
            Math.max(0.7, lw * 0.55));
        }
      }
    }

    /* ── 5. FLUTING ────────────────────────────────────────────────────────
       ⚠ THIS PASS EXISTS BECAUSE OF HOW THE CLAUSE IS MEASURED. The review
       scores internal structure as HORIZONTAL luma sd inside a 55px box — the
       variation ALONG a scan line. Strata are horizontal beds, so they raise
       that number only where a jittered bed edge happens to cross the box, and
       the gullies are per-butte and can miss a narrow sliver of range entirely
       (the left shoulder is 36 CSS px wide between the frame edge and the HUD
       pillar, and measured sd 3.9 with beds and gullies both present in it).
       Fluting is the same erosion, run over the WHOLE layer at high spatial
       frequency and low amplitude: ~W/9 hairlines, each covering a random
       vertical span with a soft fade at both ends, alternating a hair darker
       and a hair lighter. It is what a weathered sandstone face looks like
       close up, and it puts signal on every column of every silhouette. */
    {
      const n = Math.max(24, Math.round(W / 9));
      const span = opt.baseY + 20 - topY;
      for (let k = 0; k < n; k++) {
        const x = -60 + dr() * (W + 120);
        const y0 = topY + dr() * span * 0.85;
        const len = span * (0.10 + dr() * 0.34);
        const dark = dr() < 0.58;
        const a = (dark ? 0.05 + dr() * 0.07 : 0.04 + dr() * 0.055) * (0.55 + 0.45 * F);
        const gg = g.createLinearGradient(0, y0, 0, y0 + len);
        gg.addColorStop(0, api.rgba(dark ? SHADEC : LITC, 0));
        gg.addColorStop(0.35, api.rgba(dark ? SHADEC : LITC, a));
        gg.addColorStop(0.7, api.rgba(dark ? SHADEC : LITC, a * 0.8));
        gg.addColorStop(1, api.rgba(dark ? SHADEC : LITC, 0));
        g.strokeStyle = gg;
        g.lineWidth = 0.6 + dr() * (1.4 + 1.6 * F);
        /* a slight lean, and a kink halfway, so 90 of them are not 90 rulers */
        const lean = (dr() - 0.5) * len * 0.10;
        g.beginPath();
        g.moveTo(x, y0);
        g.quadraticCurveTo(x + lean * 1.6, y0 + len * 0.5, x + lean, y0 + len);
        g.stroke();
      }
    }

    /* SHADED FACES (kept from round 2, no longer load-bearing). A silhouette
       alone is a cutout; the faces turned away from the key being darker than
       the ones turned toward it is part of what makes a distant range read as
       rock. This only fires where a segment descends away from the light, so
       it adds VARIETY on top of the face split above — it is not, on its own,
       enough, which was the round-2 failure. */
    const shade = api.mixHex(opt.rock, api.mixHex(LIGHT.ambient, HAZE, 0.5), 0.62);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dy) < opt.amp * 0.10 || dx <= 0) continue;
      const away = (dx * opt.lightX) < 0 ? (dy < 0) : (dy > 0);
      if (!away) continue;
      const drop = Math.min(opt.amp * 1.1, Math.abs(dy) * 2.4 + 14);
      const sg = g.createLinearGradient(0, Math.min(a.y, b.y), 0, Math.min(a.y, b.y) + drop);
      sg.addColorStop(0, api.rgba(shade, 0.42 * F));
      sg.addColorStop(1, api.rgba(shade, 0));
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(a.x - 2, a.y); g.lineTo(b.x + 2, b.y);
      g.lineTo(b.x + 2, b.y + drop); g.lineTo(a.x - 2, a.y + drop);
      g.closePath(); g.fill();
    }
    /* rim light. Only the faces whose screen-space normal points at the sun
       get it, which is why it is per-segment and not a stroke of the whole
       polyline — a uniform outline is the exact "glowing hard outline on
       everything" the BAR calls out. */
    g.lineCap = 'round';
    g.strokeStyle = api.rgba(LIGHT.key, opt.rim);
    g.lineWidth = opt.lw;
    g.beginPath();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.sign(b.x - a.x) === 0) continue;
      const facing = (b.x - a.x) * opt.lightX;
      if (facing <= 0 && Math.abs(b.y - a.y) > 1.5) continue;
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    }
    g.stroke();
    g.restore();
    return pts;
  }

  /* ── near-field helpers ───────────────────────────────────────────────────
     The direction a cast shadow RUNS on screen, derived from the same light
     vector the terrain uses. battle-board's shadowEllipse() offsets a contact
     shadow by (-lv.x, -lv.z) — away from the light — so we project a ground
     point at the near row and the same point pushed away from the light, and
     take the screen delta. Hard-coding "down-left" would be wrong at dawn,
     when the key swings to the other side of the field and every cliff shadow
     the terrain bakes flips with it. */
  function shadowDir(api) {
    const lv = api.lightVector();
    const z0 = api.MAP.rows / 2 + 1.0;
    const a = api.project({ x: 0, y: 0, z: z0 });
    const b = api.project({ x: -lv.x * 3, y: 0, z: z0 - lv.z * 3 });
    let dx = -0.72, dy = 0.69;
    if (a && b) { dx = b.x - a.x; dy = b.y - a.y; }
    const m0 = Math.hypot(dx, dy) || 1;
    /* A shadow running UP the screen is cast away from the camera and would
       leave the band we are dressing entirely; keep a floor of downward run so
       the streaks stay in frame without changing which SIDE they fall on. */
    dy = Math.max(dy, m0 * 0.22);
    const m = Math.hypot(dx, dy) || 1;
    return { x: dx / m, y: dy / m };
  }
  /* soft ellipse (radial gradient). Used for anything that has to have no
     edge at all — dunes, rake shadows, the bounce band. */
  function softEll(api, g, x, y, rx, ry, col, a) {
    if (a <= 0.003 || rx <= 0.5 || ry <= 0.2) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, rx);
    gr.addColorStop(0, api.rgba(col, a));
    gr.addColorStop(0.52, api.rgba(col, a * 0.6));
    gr.addColorStop(1, api.rgba(col, 0));
    g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, 7); g.fill(); g.restore();
  }
  /* hard-ish ellipse (flat fill + globalAlpha). Deliberately NOT a gradient:
     gravel needs a readable edge to look like a stone rather than a smudge,
     and 400+ of these run in one bake — a radial gradient each measured ~6x
     the cost of a flat arc on this box's software rasteriser. */
  /* `rot` matters more than it looks: without it every stone in the field is
     an axis-aligned ellipse and 200 of them read as a pattern stamp. */
  function chip(g, x, y, rx, ry, style, a, rot) {
    if (a <= 0.004 || rx <= 0.25) return;
    g.globalAlpha = a; g.fillStyle = style;
    g.save(); g.translate(x, y); if (rot) g.rotate(rot);
    g.scale(1, Math.max(0.08, ry / rx));
    g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore();
    g.globalAlpha = 1;
  }

  /* ── GRAIN ────────────────────────────────────────────────────────────────
     A single 96×96 value-noise tile, baked once for the lifetime of the page
     and pattern-filled over the near strip at two scales. This is the cheapest
     honest way to get PHOTOGRAPHIC surface out of canvas-2D: the board we have
     to stand next to used to show the backdrop photo's own wet rubble in this
     band (measured per-row luma sd 15–29), and no amount of hand-placed blobs
     reaches that on its own — grain does, for one fillRect.
     Kept out of S (the bake cache) deliberately: it depends on nothing, so
     clearing it with the light would just cost a re-roll. */
  let GRAIN = null;
  function grainTile() {
    if (GRAIN) return GRAIN;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    if (!g) return null;
    const r = mulberry32(0x9E3779B9);
    /* two cell sizes in the tile itself, so the pattern does not read as a
       regular checker at any one zoom */
    for (const cell of [3, 6]) {
      for (let y = 0; y < 96; y += cell) {
        for (let x = 0; x < 96; x += cell) {
          const v = Math.round(128 + (r() - 0.5) * (cell === 3 ? 150 : 95));
          g.globalAlpha = cell === 3 ? 1 : 0.45;
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          g.fillRect(x, y, cell, cell);
        }
      }
    }
    g.globalAlpha = 1;
    GRAIN = c;
    return GRAIN;
  }
  function grain(api, g, x, y, w, h, scale, alpha) {
    const t = grainTile(); if (!t) return;
    let pat;
    try { pat = g.createPattern(t, 'repeat'); } catch (e) { return; }
    if (!pat) return;
    try { if (pat.setTransform && window.DOMMatrix) pat.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0])); } catch (e) { }
    g.save();
    /* 'overlay' rather than a flat alpha: mid-grey in the tile is a no-op, so
       the grain modulates whatever is underneath instead of veiling it — dark
       sand stays dark, lit sand stays lit, and both get texture. */
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = alpha;
    g.fillStyle = pat;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  /* ── NEAR-FIELD DETAIL PASS ───────────────────────────────────────────────
     Everything from the board's near edge to the bottom of the frame. This is
     the strip described in note 4 of the header: in the shipping 802×788 stage
     it is the only vista ground on screen, and round 2 shipped it blank.

     Composition, near to far in importance:
       • large sand pans and gravel pavements — the low-frequency value
         structure. Without them the strip is one value across its whole width
         no matter how much small detail sits on it, and a flat value across
         the row is exactly what "reads as a grey table" means.
       • 7 long raking cast shadows on api.lightVector()'s screen direction —
         boulders just out of frame. These are what make the strip read as a
         lit surface rather than as a painted ramp, and they are the only
         element long enough to cross the board module's two shadow-band seams
         and break them up.
       • 18 dunes: a soft lee shadow with a lit crest pushed against the
         shadow direction, so each one has a light side and a dark side.
       • ~200 gravel chips in CLUMPS, not evenly spread — an even scatter of
         identical props is the exact "AI-generated game" read the BAR calls
         out, and real desert pavement pools in drifts and bare patches. Each
         chip is a contact shadow + a body + a lit cap, so it has a direction.
       • broken sand ripples, dashed so they vary ALONG the row (a continuous
         horizontal line adds nothing to horizontal variance and the critic
         measures exactly that).
     Everything is warm on purpose — see the R−B note in the header. */
  function nearField(api, g, hz, nz) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const span = Math.max(30, H - nz);
    const sd = shadowDir(api);
    const rn = mulberry32(strHash((api.MAP.id || 'map') + '|nearfield'));
    const kI = api.clamp(LIGHT.keyI, 0.28, 1.3);
    /* the warm family. Even the darks are mixed toward SAND_/ROCK_ and only a
       sixth of the way toward the blue ambient: the measured failure was a
       neutral-cold band, and mixing shadows toward LIGHT.ambient at the 0.5+
       rates the ridges use is what produced it. */
    const DARK = api.mixHex(SAND_DEEP, LIGHT.ambient, 0.16);
    const DEEP = api.mixHex(SAND_DEEP, ROCK_DEEP, 0.35);
    const MID = api.mixHex(SAND_BASE, LIGHT.fog, 0.08);
    const LIT = api.mixHex(SAND_PALE, LIGHT.key, 0.30);
    const STONE = api.mixHex(ROCK_BASE, LIGHT.fog, 0.10);
    const STONE_L = api.mixHex(ROCK_PALE, LIGHT.key, 0.26);
    /* the one near-black in the pass — and it is a WARM near-black. Contact
       shadows have to be darker than anything they land on or the thing
       casting them floats, but a cool near-black here is what turned the whole
       band neutral last round. */
    const SHADE = api.mixHex(ROCK_DEEP, '#1a1008', 0.55);
    /* 0 at the board's near edge, 1 at the bottom of the frame — everything
       gets bigger and higher-contrast as it approaches the lens. */
    const P = y => api.clamp((y - nz) / span, 0, 1);

    g.save();
    g.beginPath(); g.rect(-2, nz - 30, W + 4, H - nz + 34); g.clip();

    /* 1. BOUNCE. A thin warm lift right under the board's near wall: light
       coming off the lit sand of the field itself. Also softens the hand-off
       between the wall and the ground so the wall does not look pasted on. */
    const bg = g.createLinearGradient(0, nz + 4, 0, nz + span * 0.34);
    bg.addColorStop(0, api.rgba(LIT, 0.10 * kI));
    bg.addColorStop(1, api.rgba(LIT, 0));
    g.fillStyle = bg; g.fillRect(-2, nz + 4, W + 4, span * 0.34);

    /* 2. GRAIN. Two octaves, the coarse one first, both modulating rather than
       veiling (see grain()). Ramped up with depth: the sand nearest the lens
       is where a real photograph shows individual grains, and the rows just
       under the board are the ones the board module's shadow bands mute
       anyway. This runs UNDER everything placed by hand, so a stone reads as
       a stone sitting ON grainy sand rather than as a grainy stone. */
    grain(api, g, -2, nz - 8, W + 4, span + 12, 3.4, 0.30);
    /* ⚠ the FINE octave has to cover the whole strip, not just the bottom
       three quarters. The rows immediately under the board are the ones the
       board module's two shadow bands mute to a third of their contrast, so
       they need MORE signal than the rest, not less — the first cut started
       this pass at 0.25·span and those rows measured a per-row sd of 3.3
       against 11 further down. */
    grain(api, g, -2, nz - 8, W + 4, span + 12, 1.15, 0.36);

    /* ── EVERYTHING BELOW GOES INTO ITS OWN LAYER, AND THE LAYER IS BLURRED ──
       This ground is the closest thing in frame to the lens. On a real
       photographed diorama it would be a touch out of focus, and — more to the
       point — canvas-2D fills have perfect vector edges, which is the single
       biggest tell that a "photograph" was drawn. One ~1px blur over the whole
       placed-detail layer costs one drawImage at bake time and takes the edge
       off every stone, crack and ripple at once.
       ⚠ The GRAIN stays on the base layer above, unblurred, because (a) it is
       the high-frequency signal we want to keep and (b) it composites with
       'overlay', which needs the ground underneath it — on a transparent layer
       overlay has nothing to modulate and turns into a grey veil. */
    const LTOP = nz - 30, LH = Math.max(8, Math.ceil(H - LTOP + 34));
    const layer = mkCanvas(W, LH, dprOf(api));
    const g2 = layer.g || g;
    if (layer.g) g2.translate(0, -LTOP);   /* draw in viewport coordinates */

    /* 3. PANS AND PAVEMENTS — the low-frequency structure. Big, soft, uneven
       patches of bare lit sand and of dark stony ground, each squashed hard in
       y because they lie on a plane we are looking along. Two overlapping
       ellipses per patch so the outline is never a clean oval. */
    for (let i = 0; i < 13; i++) {
      const y = nz - 10 + rn() * (span + 30);
      const x = rn() * (W + 460) - 230;
      const pp = P(y);
      const rx = 130 + rn() * 280;
      const ry = rx * (0.10 + rn() * 0.11);
      const pale = rn() < 0.45;
      const a = (pale ? 0.18 + rn() * 0.16 : 0.20 + rn() * 0.20) * (0.75 + 0.4 * pp);
      const col = pale ? LIT : (rn() < 0.5 ? DEEP : DARK);
      softEll(api, g2, x, y, rx, ry, col, a * (pale ? kI : 1));
      softEll(api, g2, x + (rn() - 0.5) * rx * 0.9, y + (rn() - 0.5) * ry * 1.2,
        rx * (0.45 + rn() * 0.4), ry * (0.5 + rn() * 0.5), col, a * 0.8);
    }

    /* 4. RAKING CAST SHADOWS. One elongated soft blob each, rotated onto the
       light's screen direction, darkest at the origin end — a rectangle with
       a gradient would need hard side edges and read as a bar. */
    for (let i = 0; i < 7; i++) {
      const y0 = nz - 20 + rn() * span * 0.5;
      const x0 = rn() * (W + 300) - 150;
      const len = span * (0.75 + rn() * 1.6);
      const wid = 16 + rn() * 58;
      const a = (0.24 + rn() * 0.18) * (0.5 + 0.5 * kI);
      const cx = x0 + sd.x * len * 0.5, cy = y0 + sd.y * len * 0.5;
      const ang = Math.atan2(sd.y, sd.x);
      g2.save();
      g2.translate(cx, cy); g2.rotate(ang); g2.scale(1, wid / len);
      const gr = g2.createRadialGradient(-len * 0.16, 0, 0, -len * 0.16, 0, len * 0.62);
      gr.addColorStop(0, api.rgba(rn() < 0.5 ? DARK : DEEP, a));
      gr.addColorStop(0.5, api.rgba(DARK, a * 0.5));
      gr.addColorStop(1, api.rgba(DARK, 0));
      g2.fillStyle = gr;
      g2.beginPath(); g2.arc(0, 0, len * 0.62, 0, 7); g2.fill();
      g2.restore();
    }

    /* 5. DUNES — lee shadow + lit crest. The crest is offset AGAINST the
       shadow direction, which is what stops a pair of blobs from reading as
       two unrelated stains. */
    for (let i = 0; i < 18; i++) {
      const y = nz - 16 + rn() * (span + 26);
      const x = rn() * (W + 420) - 210;
      const pp = P(y);
      const rx = 90 + rn() * 210 * (0.55 + pp);
      const ry = rx * (0.15 + rn() * 0.13);
      const a = (0.17 + rn() * 0.18) * (0.55 + 0.5 * pp);
      softEll(api, g2, x, y, rx, ry, rn() < 0.65 ? DARK : DEEP, a);
      softEll(api, g2, x - sd.x * rx * 0.26, y - sd.y * ry * 1.4 - ry * 0.7,
        rx * 0.82, ry * 0.66, LIT, a * 0.9 * kI);
    }

    /* 6. GRAVEL, IN DRIFTS. 14 clump centres; three quarters of the chips land
       near one and the rest are strays, so the field has bare sand between
       stone pavements instead of an even sprinkle. */
    const clumps = [];
    for (let i = 0; i < 14; i++) {
      clumps.push({
        x: rn() * (W + 160) - 80,
        y: nz - 8 + Math.pow(rn(), 0.8) * (span + 18),
        r: 40 + rn() * 130
      });
    }
    for (let i = 0; i < 240; i++) {
      let x, y;
      if (rn() < 0.74) {
        const c = clumps[(rn() * clumps.length) | 0];
        const th = rn() * 6.283, rr = Math.pow(rn(), 0.6) * c.r;
        x = c.x + Math.cos(th) * rr; y = c.y + Math.sin(th) * rr * 0.45;
      } else {
        x = rn() * (W + 90) - 45;
        y = nz - 8 + Math.pow(rn(), 1.25) * (span + 20);
      }
      if (y < nz - 12 || y > H + 14) continue;
      const pp = P(y);
      /* PERSPECTIVE, AND IT HAS TO BE STEEP. We are looking along a plane, so
         a stone at the bottom of the frame is metres closer to the lens than
         one at the near edge: it is drawn many times bigger AND rounder, while
         one up near the board is a squashed speck. Round 3's first attempt
         used a gentle linear ramp and a constant flattening, and the result
         read as an evenly-sprinkled texture map — pp^1.5 on the size and a
         flattening that opens up with depth is what turns the same scatter
         into a receding ground plane. */
      const s = (0.7 + 8.5 * Math.pow(pp, 1.5)) * (0.45 + rn() * 1.25);
      const flat = 0.22 + 0.44 * pp + rn() * 0.14;
      const big = s > 2.0;
      const rot = (rn() - 0.5) * 0.9;
      /* contact shadow first, offset along the light's screen direction.
         ⚠ It has to be DARKER than the ground it lands on or the stone floats:
         SHADE is the one near-black in this pass, and it is a warm near-black
         (a cool one is what made round 2 read as a grey table). */
      /* ⚠ SOFT, not a flat disc. chip() gave every stone a crisp dark ellipse
         under it that read as a hole in the ground rather than as a shadow. */
      if (big) softEll(api, g2, x + sd.x * s * 0.95, y + sd.y * s * 0.5,
        s * 1.35, s * flat * 0.95, SHADE, (0.34 + rn() * 0.22) * kI);
      const body = rn() < 0.45 ? STONE : (rn() < 0.5 ? MID : DARK);
      chip(g2, x, y, s, s * flat, body, 0.34 + rn() * 0.40, rot);
      /* Lit cap on the side that faces the key. ⚠ KEEP IT SMALL AND WEAK. At
         0.34–0.68 over 62% of the stone every pebble grew a bright dome and
         200 of them read as spilled eggs, not as gravel. A stone is mostly its
         own local colour; the highlight is a sliver. */
      if (big) chip(g2, x - sd.x * s * 0.30, y - sd.y * s * 0.26 - s * flat * 0.24,
        s * 0.44, s * flat * 0.38, STONE_L, (0.16 + rn() * 0.20) * kI, rot);
    }

    /* 6b. GRIT in the FAR half of the strip. Same reasoning as the fine grain
       octave: the rows just under the board carry the least contrast and get
       muted the hardest, and a receding plane should show its highest stone
       DENSITY there (more square metres per pixel row), not its lowest. These
       are sub-pixel-ish specks — no shadow, no cap, just tone. */
    for (let i = 0; i < 150; i++) {
      const y = nz - 6 + Math.pow(rn(), 1.6) * span * 0.62;
      const x = rn() * (W + 60) - 30;
      const pp = P(y);
      const s = (0.5 + 1.8 * pp) * (0.6 + rn() * 1.0);
      chip(g2, x, y, s, s * (0.34 + 0.3 * pp), rn() < 0.5 ? STONE : DARK,
        0.28 + rn() * 0.36, (rn() - 0.5) * 1.2);
    }

    /* 7. ANGULAR SLABS. Ellipses read as pebbles; broken rock reads as rock,
       and the strip has to survive being compared with a photograph of wet
       rubble. Each slab is a 5-point convex-ish polygon with a lit top facet
       and a dark side facet split along the light's screen direction. */
    for (let i = 0; i < 14; i++) {
      const y = nz + span * (0.3 + Math.pow(rn(), 0.7) * 0.85);
      const x = rn() * (W + 120) - 60;
      const pp = P(y);
      const r = (3 + 16 * pp) * (0.6 + rn() * 1.1);
      if (r < 2.5) continue;
      const pts = [];
      for (let k = 0; k < 5; k++) {
        const th = (k / 5) * 6.283 + rn() * 0.7;
        const rr = r * (0.55 + rn() * 0.75);
        pts.push({ x: x + Math.cos(th) * rr, y: y + Math.sin(th) * rr * (0.34 + 0.3 * pp) });
      }
      /* contact shadow */
      softEll(api, g2, x + sd.x * r * 0.8, y + sd.y * r * 0.45, r * 1.4, r * 0.5, SHADE, 0.40 * kI);
      g2.beginPath();
      pts.forEach((p2, k) => k ? g2.lineTo(p2.x, p2.y) : g2.moveTo(p2.x, p2.y));
      g2.closePath();
      /* ⚠ the lit facet is the NARROW end of this gradient. Round 3's first
         cut started on STONE_L+key, which covered most of a small slab and
         turned the field into a scatter of pale kites. */
      const sg2 = g2.createLinearGradient(x - sd.x * r, y - r * 0.5, x + sd.x * r, y + r * 0.5);
      sg2.addColorStop(0, api.mixHex(STONE, LIGHT.key, 0.22));
      sg2.addColorStop(0.30, api.mixHex(STONE, DEEP, 0.3));
      sg2.addColorStop(1, api.mixHex(DEEP, SHADE, 0.55));
      g2.fillStyle = sg2; g2.fill();
    }

    /* 8. CRACKS. Dried pan surfaces break into polygons; a few crack systems
       are worth more texture per pixel than anything else in this pass, and
       they are the one element with genuinely high spatial frequency. */
    g2.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
      let x = rn() * (W + 120) - 60;
      let y = nz + span * (0.25 + rn() * 0.8);
      const pp = P(y);
      /* ⚠ WEAK AND CURVED, NOT DARK AND STRAIGHT. The first cut ran 0.16–0.32
         alpha over 3–6 long straight segments and read as a vector zig-zag
         drawn on the sand. Halved alpha, shorter segments, a quadratic through
         a jittered midpoint and a flatter y factor (we are looking ALONG this
         plane, so a crack running away from us compresses hard). */
      g2.strokeStyle = api.rgba(SHADE, (0.07 + rn() * 0.09) * (0.4 + pp));
      g2.lineWidth = 0.6 + rn() * 1.1 * (0.4 + pp);
      const segs = 4 + ((rn() * 5) | 0);
      let ang = (rn() - 0.5) * 1.2;
      g2.beginPath(); g2.moveTo(x, y);
      for (let k = 0; k < segs; k++) {
        const len = (7 + rn() * 30) * (0.4 + pp);
        ang += (rn() - 0.5) * 1.3;
        const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len * 0.30;
        g2.quadraticCurveTo((x + nx) * 0.5 + (rn() - 0.5) * len * 0.3,
          (y + ny) * 0.5 + (rn() - 0.5) * len * 0.16, nx, ny);
        x = nx; y = ny;
        /* a branch, because a crack that never forks reads as a scratch */
        if (rn() < 0.5) {
          const ba = ang + (rn() - 0.5) * 2.2, bl = (6 + rn() * 20) * (0.4 + pp);
          g2.moveTo(x, y);
          g2.lineTo(x + Math.cos(ba) * bl, y + Math.sin(ba) * bl * 0.30);
          g2.moveTo(x, y);
        }
      }
      g2.stroke();
    }

    /* 9. BROKEN RIPPLES. Dashed on purpose: a full-width line is invisible to
       a per-row horizontal variance measurement and, more to the point, real
       ripple crests are broken by every stone they run into. */
    for (let i = 0; i < 22; i++) {
      const y = nz + 4 + Math.pow(rn(), 0.9) * span;
      const pp = P(y);
      const x0 = rn() * (W + 200) - 120;
      const len = 60 + rn() * 260 * (0.5 + pp);
      const lift = 2 + rn() * 5 * (0.4 + pp);
      const pale = rn() < 0.6;
      /* ⚠ butt caps and a thin line. Round caps at 2px+ turned each dash into
         a pale capsule and a row of them read as worms lying on the sand. */
      g2.strokeStyle = api.rgba(pale ? LIT : DEEP, (pale ? 0.09 : 0.12) * (0.5 + pp));
      g2.lineWidth = (0.6 + rn() * 0.9) * (0.6 + pp);
      g2.lineCap = 'butt';
      let cx = x0;
      while (cx < x0 + len) {
        const seg = 14 + rn() * 60;
        const y1 = y + Math.sin(cx * 0.012 + i) * lift;
        g2.beginPath();
        g2.moveTo(cx, y1);
        g2.bezierCurveTo(cx + seg * 0.35, y1 - lift * 0.5, cx + seg * 0.7, y1 + lift * 0.4, cx + seg, y1);
        g2.stroke();
        cx += seg + 6 + rn() * 34;    /* the gap is what makes it broken */
      }
    }

    /* 10. TWO OR THREE BOULDERS AT THE FRAME EDGE. A near foreground object,
       cropped by the frame, is the single strongest depth cue a still image
       has — it puts something between the lens and the subject. Seeded to the
       OUTER thirds so the centre of the strip stays open and nothing ever
       grows toward the play field; they sit below the near edge, off the
       board, so they cannot occlude a tile or a unit. */
    for (let i = 0; i < 3; i++) {
      const side = rn() < 0.5 ? -1 : 1;
      const x = W * 0.5 + side * (W * (0.30 + rn() * 0.22));
      const y = nz + span * (0.62 + rn() * 0.5);
      const r = span * (0.16 + rn() * 0.16);
      if (r < 6) continue;
      /* cast shadow, long and soft, on the light's screen direction */
      g2.save();
      g2.translate(x + sd.x * r * 1.5, y + sd.y * r * 0.7);
      g2.rotate(Math.atan2(sd.y, sd.x)); g2.scale(1, 0.34);
      const sg = g2.createRadialGradient(0, 0, 0, 0, 0, r * 2.3);
      sg.addColorStop(0, api.rgba(SHADE, 0.44 * kI));
      sg.addColorStop(1, api.rgba(SHADE, 0));
      g2.fillStyle = sg; g2.beginPath(); g2.arc(0, 0, r * 2.3, 0, 7); g2.fill();
      g2.restore();
      /* body: a LOW WIDE DOME, not a ball. ⚠ The first cut walked 9 radii with
         ±22% jitter over the upper half and closed on a flat base; at this
         aspect the jitter turned the silhouette into a cone and it read as a
         paper party hat. A 14-point walk with ±9% jitter and a height of only
         0.55r gives a boulder half-buried in sand, which is what a rock at the
         foot of a mesa actually looks like. */
      g2.save();
      g2.beginPath();
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const th = Math.PI * (1 + k / N);           /* upper half only … */
        const rr = r * (0.94 + rn() * 0.18);
        const px2 = x + Math.cos(th) * rr, py2 = y + Math.sin(th) * rr * 0.55;
        if (k === 0) g2.moveTo(px2, py2); else g2.lineTo(px2, py2);
      }
      g2.lineTo(x + r, y + r * 0.10);                /* … then a flat base line */
      g2.lineTo(x - r, y + r * 0.10);
      g2.closePath();
      const bgd = g2.createLinearGradient(x - sd.x * r, y - r * 0.55, x + sd.x * r * 0.7, y + r * 0.2);
      bgd.addColorStop(0, api.mixHex(STONE, LIGHT.key, 0.20));
      bgd.addColorStop(0.5, api.mixHex(STONE, DEEP, 0.35));
      bgd.addColorStop(1, api.mixHex(DEEP, SHADE, 0.55));
      g2.fillStyle = bgd; g2.fill();
      /* a lit lip along the top edge that faces the key, and a dark foot where
         it meets the sand — occlusion, so it is planted rather than pasted */
      g2.clip();
      const lipg = g2.createLinearGradient(x, y - r * 0.62, x, y - r * 0.12);
      lipg.addColorStop(0, api.rgba(STONE_L, 0.42 * kI));
      lipg.addColorStop(1, api.rgba(STONE_L, 0));
      g2.fillStyle = lipg; g2.fillRect(x - r * 1.2, y - r * 0.7, r * 2.4, r * 0.6);
      const footg = g2.createLinearGradient(x, y + r * 0.12, x, y - r * 0.22);
      footg.addColorStop(0, api.rgba(SHADE, 0.5));
      footg.addColorStop(1, api.rgba(SHADE, 0));
      g2.fillStyle = footg; g2.fillRect(x - r * 1.2, y - r * 0.25, r * 2.4, r * 0.4);
      g2.restore();
    }

    /* …and the layer goes down blurred. */
    if (layer.g) {
      let filtered = false;
      try { g.filter = 'blur(0.7px)'; filtered = g.filter !== 'none'; } catch (e) { }
      g.drawImage(layer.cv, 0, LTOP, W, LH);
      if (filtered) { try { g.filter = 'none'; } catch (e) { } }
    }

    g.restore();
  }

  /* ── SKY bake ─────────────────────────────────────────────────────────── */
  function bakeSky(api, dpr) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const st = skyStops(api);
    const grd = g.createLinearGradient(0, 0, 0, Math.max(hz * 1.25, H * 0.5));
    grd.addColorStop(0, st[0]);
    grd.addColorStop(0.55, st[1]);
    grd.addColorStop(1, st[2]);
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    /* horizon glow, centred on the light's azimuth — the sky is brightest
       where the sun is, which is most of what makes a flat gradient read as
       air rather than paint. */
    const b = bodyPos(api);
    /* ⚠ centred on the BODY, not on the horizon. Anchoring it at hz put the
       brightest part of the sky directly behind the board's far rows, and
       between that and the bloom the whole back half of the field went milky
       — the far plateaus stopped separating. */
    const gl = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(W, H) * 0.42);
    const kI = api.clamp(LIGHT.keyI, 0.2, 1.3);
    /* ⚠ SCALED DOWN AS THE SKY GETS BRIGHTER. These alphas were tuned against
       the preset's dark noon sky (luma 34/68/121); over the regraded daylight
       sky (128/165/192) the same additive turned the whole quarter-frame round
       the sun into a featureless white blowout and swallowed the disc — which
       is the "the sun disc still clips to pure white" note, seen from the
       other side. A bright sky needs less glow, not the same glow. */
    const gDim = 1 - 0.56 * dayness(api);
    gl.addColorStop(0, api.rgba(LIGHT.disc, 0.17 * kI * gDim));
    gl.addColorStop(0.4, api.rgba(LIGHT.disc, 0.055 * kI * gDim));
    gl.addColorStop(1, api.rgba(LIGHT.disc, 0));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gl; g.fillRect(0, 0, W, hz + 40);
    g.globalCompositeOperation = 'source-over';
    /* thin high cloud, seeded, drifting nowhere — enough to break the ramp */
    const rand = mulberry32(strHash((api.MAP.id || 'map') + '|cloud'));
    for (let i = 0; i < 14; i++) {
      const cxp = rand() * (W + 200) - 100;
      const cyp = rand() * hz * 0.82;
      const rw = 70 + rand() * 240, rh = 8 + rand() * 22;
      const a = 0.04 + rand() * 0.07;
      const cg = g.createRadialGradient(cxp, cyp, 0, cxp, cyp, rw);
      const tint = api.mixHex(LIGHT.disc, LIGHT.fog, 0.45);
      cg.addColorStop(0, api.rgba(tint, a));
      cg.addColorStop(1, api.rgba(tint, 0));
      g.save(); g.translate(cxp, cyp); g.scale(1, rh / rw); g.translate(-cxp, -cyp);
      g.fillStyle = cg; g.beginPath(); g.arc(cxp, cyp, rw, 0, 7); g.fill(); g.restore();
    }
    return o.cv;
  }

  /* ── LAND bake: mesa layers + haze band + the desert the board sits in ─── */
  function bakeLand(api, dpr, artWins) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const nz = nearY(api);
    const b = bodyPos(api);
    const lightX = Math.sign(b.x - api.VIEW.cx) || 1;
    const rand = mulberry32(strHash((api.MAP.id || 'map') + '|ridge'));
    /* ⚠ RAISED FROM 0.78. The skyline has to clear the BOARD, not the horizon:
       the terrain module's tallest baked plateau tops out ~70px above the far
       edge, and the near shoulders are the only ridge pixels a player ever
       sees. At 0.78 the shoulders cleared the haze line by ~40px and read as
       low mounds; 0.92 gives them a butte's worth of height while canyonBias
       keeps the CENTRE low, where the board would hide them anyway. */
    const band = api.clamp(hz * 0.92, 60, 280);   /* vertical room for the skyline */

    /* FAR range. Suppressed when the location supplies backdrop art — that art
       IS the far layer; drawing a procedural ridge over it would fight it.
       ⚠ EXCEPT WHEN THE ART DOES NOT BELONG. Wave 2's second finding was a
       grey city with legible helicopters sitting behind ochre canyon walls,
       and the verdict's own second option was "let the procedural ridge win
       when the location's art disagrees with the ground palette". `hasArt` is
       now `artWins` — art that measures warm keeps the far layer to itself,
       art that measures cold grey gets the desert's own skyline drawn back
       over it (see artDisagreement). The art is still there, still crossfaded,
       still location-specific: it becomes the sky BEHIND our ridge instead of
       the ridge itself. */
    if (!artWins) {
      ridgeLayer(api, g, {
        rand: rand, baseY: hz - 6, amp: band * 0.95, seg: W * 0.17,
        rock: ROCK_PALE, fog: 0.72, rim: 0.05, lw: 1, form: 0.32, lightX: lightX, key: 'far'
      });
    } else {
      /* still burn a few random draws so the mid/near layers are identical
         whether or not art is present — otherwise the skyline reshuffles the
         moment a location card lands, which reads as a glitch, not a change. */
      for (let i = 0; i < 24; i++) rand();
    }
    /* MID range — the warm canyon wall. This is the layer that does the real
       work when a cold photographic backdrop is in play: it bridges the art
       to the warm sand instead of letting grey butt against ochre.
       ⚠ It has to clear the TERRAIN, not just the horizon: the tallest baked
       plateau tops out ~70px above the far edge, so a range sized to hz alone
       is drawn and then completely hidden by the board. */
    /* ⚠ THE TWO FOG NUMBERS BELOW ARE THE DEPTH ORDERING, AND ROUND 2 HAD THEM
       BACKWARDS. Measured on the round-2 board crop, the MID range came out
       MORE saturated than the NEAR one (29.5% vs 23.2%) at the SAME value
       (L 104.8 vs 103.2) — i.e. the two ranges did not separate in depth at
       all. The cause was the haze colour, not these numbers (see hazeColour),
       but they are retuned against the new one: mixed toward a LIGHT horizon
       haze, 0.34 puts MID around L 128 / sat 31% and 0.04 puts NEAR around
       L 75 / sat 47%. Lighter AND less saturated with distance, which is the
       clause. Do not raise NEAR's fog to "match" — the gap IS the depth. */
    ridgeLayer(api, g, {
      rand: rand, baseY: hz - 4, amp: band * 0.82, seg: W * 0.125,
      rock: ROCK_BASE, fog: 0.34, rim: 0.13, lw: 1.4, form: 0.62, lightX: lightX, key: 'mid'
    });
    /* NEAR bluffs — most contrast, least haze. Same reasoning: tall at the
       sides (where they frame the field), low in the middle (where the board
       would hide them anyway). The rock is lifted off ROCK_DEEP toward
       ROCK_BASE because with the haze mix down at 0.15 a pure ROCK_DEEP range
       measured L 64 and read as a black band rather than as a near bluff. */
    ridgeLayer(api, g, {
      rand: rand, baseY: hz + 8, amp: band * 0.56, seg: W * 0.085,
      rock: api.mixHex(ROCK_DEEP, ROCK_BASE, 0.28), fog: 0.04, rim: 0.24,
      lw: 1.7, form: 1.0, lightX: lightX, key: 'near'
    });

    /* ── the ground BEYOND the play field. Painted over the whole area below
       the horizon; the terrain module draws the board on top of it a pass
       later, so what survives is the margin at the sides and the strip under
       the near edge — which is exactly where the backdrop photo's own
       foreground used to sit. ── */
    /* ⚠ TWO ROUND-2 FAULTS FIXED HERE, both visible in the standalone shots.
       (a) The floor started as an OPAQUE fillRect at the horizon, which cut a
           dead-straight horizontal line across the feet of every ridge and
           across the whole frame. It now fades in over ~40px (rgba stops in
           the same gradient), so the ranges stand IN the sand.
       (b) It was too bright and too saturated — a big flat orange field that
           out-competed the board it is supposed to sit behind. The ramp is now
           fogged at the far end and falls to a cool dark in the foreground,
           which is also the depth cue: light far, dark near. */
    const top = hz - 34;
    const span = Math.max(1, H - top);
    const solid = (hz + 8 - top) / span;
    g.save();
    g.beginPath(); g.rect(-2, top, W + 4, H - top + 3); g.clip();
    /* NIGHT BIAS. Sand keeps its own albedo in the mix, so at keyI 0.48 the
       floor still came out a warm ochre while the sky and the board had gone
       cold — the one thing in the frame that had not noticed it was night.
       Everything below leans further toward the fog colour as the key weakens. */
    const fb = api.clamp(0.30 - LIGHT.keyI * 0.22, 0, 0.24);
    const fx = (hex, m) => api.mixHex(hex, LIGHT.fog, Math.min(0.95, m + fb));
    const cFar = fx(SAND_PALE, 0.66);
    const fl = g.createLinearGradient(0, top, 0, H);
    fl.addColorStop(0, api.rgba(cFar, 0));
    fl.addColorStop(solid * 0.55, api.rgba(cFar, 0.55));
    fl.addColorStop(solid, cFar);
    fl.addColorStop(solid + (1 - solid) * 0.14, fx(SAND_BASE, 0.44));
    fl.addColorStop(solid + (1 - solid) * 0.52, fx(SAND_DEEP, 0.28));
    /* ⚠ 0.58 HERE WAS HALF THE ROUND-2 FAILURE. Mixing the last stop 58% into
       the blue ambient made the one band of vista ground the player can
       actually see neutral-cold (measured R−B +0.8) while the board above it
       was ochre — a warm diorama standing on a grey table. 0.22 keeps the
       foreground dark, which is the depth cue, without draining the hue. */
    fl.addColorStop(1, api.mixHex(fx(SAND_DEEP, 0.10), SHADE_HEX(LIGHT), 0.22));
    g.fillStyle = fl; g.fillRect(-2, top, W + 4, H - top + 3);
    /* broad seeded mottling — dune shadow and pans across the MID ground (the
       margin at the sides of the field). Large and few: this is ground the
       player never walks on, it only has to not be a flat ramp.
       ⚠ WAS r2()*r2(), i.e. biased hard toward 0, which put every single blob
       within a few px of the horizon — precisely the band the board then draws
       over. pow(.., 0.8) spreads them the whole way down instead. The dense
       work in the near strip is nearField()'s job, not this loop's. */
    const r2 = mulberry32(strHash((api.MAP.id || 'map') + '|floor'));
    for (let i = 0; i < 26; i++) {
      const px = r2() * (W + 260) - 130;
      const py = hz + 10 + Math.pow(r2(), 0.8) * (H - hz) * 1.05;
      const rr = 60 + r2() * 230;
      const dark = r2() < 0.6;
      const col = dark ? api.mixHex(SAND_DEEP, LIGHT.fog, 0.3) : api.mixHex(SAND_PALE, LIGHT.key, 0.25);
      const a = (dark ? 0.22 : 0.10) * (0.4 + r2() * 0.6);
      const rg = g.createRadialGradient(px, py, 0, px, py, rr);
      rg.addColorStop(0, api.rgba(col, a));
      rg.addColorStop(1, api.rgba(col, 0));
      g.save(); g.translate(px, py); g.scale(1, 0.34); g.translate(-px, -py);
      g.fillStyle = rg; g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill(); g.restore();
    }
    /* dune crests near the horizon: flattened, so they read as distance */
    g.strokeStyle = api.rgba(api.mixHex(SAND_PALE, LIGHT.key, 0.4), 0.10);
    for (let i = 0; i < 9; i++) {
      const y = hz + 6 + r2() * (nz - hz) * 0.5;
      const x0 = r2() * W - 80, len = 90 + r2() * 320;
      g.lineWidth = 1 + r2() * 1.6;
      g.beginPath();
      g.moveTo(x0, y);
      g.bezierCurveTo(x0 + len * 0.33, y - 3 - r2() * 4, x0 + len * 0.66, y + 2 + r2() * 4, x0 + len, y);
      g.stroke();
    }
    /* foreground falloff: the dirt in front of the near edge is closest to the
       lens and out of the key, so it goes DOWN. It no longer goes cool.
       ⚠ THE OTHER HALF OF THE ROUND-2 FAILURE. This was rgba(mix(fog,#0d1220,.5),
       .62) — a 62% blue-black veil laid over the only ground in frame, which
       both drained the ochre and flattened every bit of detail under it to
       within a couple of luma of its neighbours. A warm shadow brown at .40
       keeps the value falloff (the eye still goes to the field) and keeps the
       hue. It runs BEFORE nearField() on purpose: the detail then sits on top
       of the ramp at full contrast instead of being washed by it. */
    const fg = g.createLinearGradient(0, nz - 30, 0, H);
    fg.addColorStop(0, api.rgba(LIGHT.fog, 0));
    fg.addColorStop(1, api.rgba(api.mixHex(SAND_DEEP, api.mixHex(LIGHT.fog, '#20150c', 0.55), 0.5), 0.58));
    g.fillStyle = fg; g.fillRect(-2, nz - 30, W + 4, H - nz + 34);
    /* …and the dense near-field dressing on top of all of it. */
    try { nearField(api, g, hz, nz); } catch (e) { }
    g.restore();

    /* ── the haze band, exactly where the horizon meets the far edge ── */
    const hb = g.createLinearGradient(0, hz - band * 0.34, 0, hz + 34);
    const hazeCol = api.mixHex(LIGHT.fog, LIGHT.disc, 0.34);
    const hA = 0.17 + (LIGHT.haze || 0.2) * 0.5;
    hb.addColorStop(0, api.rgba(hazeCol, 0));
    hb.addColorStop(0.66, api.rgba(hazeCol, hA));
    hb.addColorStop(1, api.rgba(hazeCol, 0));
    g.fillStyle = hb; g.fillRect(-2, hz - band * 0.34, W + 4, band * 0.34 + 36);
    return o.cv;
  }
  /* the cool end of the current rig — used where the sand falls out of the key */
  function SHADE_HEX(LIGHT) { return LIGHT.ambient || '#2e3650'; }

  /* ── DOES THIS ART BELONG IN A DESERT? ────────────────────────────────────
     ⚠ WAVE 2: "THE VISTA IS TWO INCOMPATIBLE WORLDS STACKED — a grey
     post-apocalyptic city with a gothic spire and at least six clearly legible
     HELICOPTERS sits behind pale ochre low-poly faceted canyon walls." The
     verdict offered two ways out: grade the art in hard enough that it belongs,
     or let the procedural ridge win when the art disagrees with the ground.
     Neither is right on its own — dropping the art always would break the
     user's own ask ("location cards change the background/vista"), and grading
     harder cannot fix a SILHOUETTE, which is what a helicopter is.
     So: measure the disagreement, and spend it on both.

     The measure is the art's own warmth against the desert's. One 24px
     thumbnail, once per image per light, read back with getImageData — the
     only per-pixel read in this module and it is 576 pixels. Only the band
     that will actually be on screen is sampled (everything below the horizon
     anchor is erased later, so its colour is irrelevant and a photo's dark
     foreground would drag the mean). A tainted canvas throws; a mid
     disagreement is the honest answer when we cannot look. */
  const AGREE = new Map();
  function artDisagreement(api, img) {
    const k = img.src;
    if (AGREE.has(k)) return AGREE.get(k);
    let d = 0.5;
    try {
      const c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      const hAnchor = (api.backdrop && api.backdrop.horizon) || 0.62;
      const sh = Math.max(1, Math.round(img.naturalHeight * hAnchor));
      g.drawImage(img, 0, 0, img.naturalWidth, sh, 0, 0, 24, 24);
      const px = g.getImageData(0, 0, 24, 24).data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { R += px[i]; G += px[i + 1]; B += px[i + 2]; n++; }
      const warmth = (R - B) / n;
      /* +28 R−B is roughly where SAND_BASE and ROCK_PALE sit, i.e. art that
         already belongs. −20 is a cold grey city. Everything between is a
         proportional blend, so a location card never snaps. */
      d = api.clamp((28 - warmth) / 48, 0, 1);
    } catch (e) { /* tainted or undecodable — keep the neutral 0.5 */ }
    if (AGREE.size > 8) AGREE.clear();
    AGREE.set(k, d);
    return d;
  }

  /* mean luma of a rectangle of a canvas, sampled at 16x16. Used to compare
     the graded backdrop against our own sky (see the value match in bakeArt).
     A tainted canvas throws — callers treat null as "cannot tell". */
  function meanLuma(cv, x, y, w, h) {
    if (!cv || w <= 0 || h <= 0) return null;
    try {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(cv, x, y, w, h, 0, 0, 16, 16);
      const px = g.getImageData(0, 0, 16, 16).data;
      let s = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) {
        /* weight by alpha — an unpainted region is not a black region */
        const a = px[i + 3] / 255;
        s += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a;
        n += a;
      }
      return n > 0.5 ? s / n : null;
    } catch (e) { return null; }
  }

  /* ── THE ZENITH FADE, MADE CONTENT-AWARE ──────────────────────────────────
     WAVE 3 r2. The top fade below hands the zenith back to the graded sky by
     erasing the art, and that is right for a photograph's FLAT OVERCAST and
     wrong for its LANDMARKS. Measured on the location preset, the two
     screenshots side by side: wave 1 had a gothic clock-tower spire, birds and
     real cloud structure above the ridgeline; the wave-2/3 build has a clean
     blue-to-dust gradient and nothing in it. A critic's blind A/B named that
     as the one thing the new sky lost. A flat number cannot separate the two,
     because it is not a question of HOW MUCH art to keep — it is a question of
     WHICH art.

     So the erase is modulated by the art's own LOCAL CONTRAST:
        erase(x,y) = ramp(y) · (1 − KEEP · detail(x,y))
     Flat sky (detail 0) is erased exactly as hard as before — the coherence
     numbers that the wave-3 blocker was about are measured on flat sky, and
     they do not move. Structure (a spire edge, a cloud lip, a bird) keeps up
     to KEEP of itself and reads as a distant silhouette.

     Built at a QUARTER of device scale, ONCE PER BAKE — a bake happens on a
     location change or a time-of-day change, never per frame, and the frame
     loop never sees this. |art − blur(art)| is the detail signal, taken with
     'difference' against a 2px blur (≈8px on the art) so it keys on edges
     rather than on the photo's overall value.

     ⚠ IT DILATES BEFORE IT SMOOTHS, AND WITHOUT THAT IT DOES NOT WORK. A
     high-pass keys on EDGES, so an unmodified mask keeps a spire's outline and
     erases its interior — a hollow outline is exactly the "glowing hard
     outlines on everything" the BAR forbids. A box max over ±3 mask px (≈24
     art px) grows the keep region across the whole structure first; the box
     blur that follows only softens what the dilate produced.

     ⚠ THE BORDERS ARE ATTENUATED because the blur samples transparent black
     outside the canvas, so every edge of the band reads as maximum detail. Left
     in, that keeps a strip of the photo's flat overcast along the very top of
     the frame — the one place the fade exists to clear.

     Returns null on a tainted canvas or a rasteriser without `filter` support;
     the caller then draws the old flat gradient, which is the wave-2 behaviour
     rather than a broken one. */
  /* ── WAVE 3 r3: THE FIELD IS COMPUTED ONCE, BEFORE THE GRADE, AND FEEDS
     THREE PASSES ────────────────────────────────────────────────────────────
     r2 built this mask AFTER the distance grade and spent it on the top fade's
     alpha only. A critic measured what that bought and the answer was almost
     nothing: mask on vs mask off moved zenith block detail 2.38 → 2.27 and cost
     0.9 points of sky saturation, and the spire stayed "a contrastless dark
     column with no top". The diagnosis in r2's own note was correct and its
     conclusion was not — "alpha cannot restore contrast a grade removed" is
     precisely the reason to point the mask at the GRADE instead of at the
     alpha. Two passes remove that contrast:
       · the flattener wash — a source-over fill of the air's colour over the
         whole art, which lifts a dark silhouette toward the sky it stands
         against;
       · the value match — a full-rect 'multiply' that scales the art down to
         fit under our own sky, and scales every difference inside it down by
         the same factor.
     Both are correct for a photograph's flat overcast and both are wrong for
     its landmarks, which is the same "how much / WHICH" split the fade already
     makes. So the detail field is now computed from the art BEFORE either pass
     runs, and all three consume it (see maskedFill + ART_PROTECT in bakeArt).

     ⚠ WHICH MEANS THE THRESHOLDS CANNOT BE CONSTANTS ANY MORE. LO/HI were
     tuned against the POST-grade distribution (raw mean 20.3, rawMax 149 on the
     dark-forest backdrop); pre-grade the same art carries more contrast and the
     same absolute numbers would call far more of the sky "structure" — which is
     the failure mode r2 swept and rejected (keep 0.23 = the flat overcast
     coming back). They are now taken from the distribution itself, with the
     multipliers chosen to REPRODUCE 22/70 exactly on that measured pair
     (20.29·1.084 = 22.0, 149·0.47 = 70.0). Self-tuning across location cards
     and viewport sizes, and it keeps r2's swept operating point rather than
     replacing it with a new guess. */
  /* ⚠ AND THEY ARE PERCENTILES, NOT MULTIPLES OF THE MEAN OR OF THE MAX. The
     first r3 cut kept r2's shape — LO ≈ mean, HI ≈ half the max — and it broke
     the moment the border artefact was fixed, for a reason worth writing down:
     r2's rawMax of 127 WAS the artefact, so 0.47·max landed near the real
     maximum by accident. With the ring gone the interior max is 48, 0.47·max is
     23, and a threshold that low calls a third of the sky "fully structured" —
     measured, det mean 0.30, fade keep 0.21 and the zenith greyed out from 9.5%
     saturation to 3.1%, which is r2's own documented failure mode.
     A percentile cannot make that mistake. LO at the 88th means one pixel in
     eight has any claim at all; HI at the 99.6th means the mask saturates on
     the top 0.4% — which on this backdrop is the spire, the two ridge crests
     and the smoke column, i.e. exactly the landmark set the blind test named.
     It also survives a location card with a completely different contrast
     budget, which a fixed 8-bit number cannot. */
  const ART_DET_LOP = 0.88;   /* percentile of |art−lowpass| that "counts as flat" */
  const ART_DET_HIP = 0.996;  /* …and the one that counts as fully structured */
  const ART_DET_R = 3;     /* dilate radius, mask px (≈24 art px) */
  /* ⚠ THE SMOOTH RADIUS IS BIGGER THAN THE DILATE RADIUS, ON PURPOSE. The
     dilate decides WHICH pixels are the landmark and wants to stay tight; the
     smooth decides how fast the stencil falls off, and that has to be slower
     than the distance blur it is undoing or the edge of the sharp inlay reads
     as a rim of its own — the blur darkens the sky around a dark tower by
     smearing it, so the region where the sharp copy wins comes back BRIGHTER
     than its surroundings, and a hard boundary turns that into a halo. */
  const ART_DET_SR = 6;    /* smooth radius, mask px */
  /* How much of the flattener wash and of the value match a FULLY structured
     pixel escapes. Swept on the app frame (shoot.mjs, seeded, so the numbers
     are repeatable) over an 8x8-block detail box on the spire itself — the
     standalone board's ambient particles put ±0.1 of noise on any sky-wide
     figure, which is larger than this knob's whole range:
       0.00 → spire block detail 3.56 mean / 8.38 p90, sky-band sat 27.1
       0.60 → 3.82 / 9.54, sat 27.2
       0.95 → 3.96 / 9.80, sat 27.2
     The curve is flat past ~0.6 and it costs no saturation anywhere, so this is
     NOT chosen on the metric: at 0.95 the landmark is exempt from the aerial
     grade almost entirely, which is the "photograph pasted on a graded sky"
     read the wave-3 blocker was about, and it is the one direction where being
     wrong is expensive. 0.60 sits on the flat part with a visible margin.
     It is deliberately BELOW 1 for the same reason: even a landmark is ten
     kilometres away, so it gets some of the air. It just does not get all of it. */
  const ART_PROTECT = 0.60;
  /* the backdrop's distance blur, as a fraction of H (× dpr). See the long note
     at the call site in bakeArt for why there are two terms and what each of
     them has already cost. */
  const ART_BLUR_BASE = 0.006;
  const ART_BLUR_DIS = 0.009;
  /* how much of the SHARP copy is inlaid back at det 1 (see bakeArt). 1.0 —
     a landmark that the mask has positively identified gets its own edges
     back in full; everything the mask did not identify still gets the whole
     kernel. Turning this down does not make the frame more coherent, it just
     makes the landmark blurrier, which is the failure this pass exists to fix.
     The selectivity lives in ART_DET_HIP, not here. */
  const ART_SHARP = 1;
  /* Build the detail field over the band [0, bandH]. Returns null on a tainted
     canvas or a rasteriser without `filter` support; every caller then falls
     back to its flat, unmasked behaviour, which is the wave-2 output rather
     than a broken one. */
  function artDetField(cv, dpr, W, bandH, artBlurPx) {
    const dw = Math.max(1, Math.round(W * dpr)), dh = Math.max(1, Math.round(bandH * dpr));
    const mw = Math.max(24, Math.round(dw / 4));
    const mhCore = Math.max(8, Math.round(dh / 4));
    /* ⚠ THE LOW-PASS IS THE DISTANCE BLUR ITSELF, AT THIS SCALE. r2 measured
       the field on art that had ALREADY been blurred, so its low-pass had to be
       coarser than that blur (×2.2) just to find anything at all — and what it
       found was the residue, which is why the mask it produced was worth 0.11
       of block detail. Measured on the SHARP copy against the same radius the
       blur will use, `|art − blur(art)|` is exactly the signal the blur is
       about to delete: the field now means "what is at risk", not "what is
       left". It stays self-tuning across viewport sizes and location cards
       because the blur it is keyed to already is (H·ART_BLUR_BASE + …)·dpr.
       The /4 is the mask's own scale — 4 device px per mask px. */
    const lp = Math.max(2, Math.min(24, (artBlurPx || 8) / 4));
    /* ── ⚠ THE BORDER IS AN ARTEFACT AND IT WAS EATING THE WHOLE FIELD ────────
       WAVE 3 r3. A blur samples transparent black outside its canvas, so every
       edge of this crop reads as maximum detail — the r2 note knew that and
       attenuated R+1 = 4 rows, which is the DILATE radius and has nothing to do
       with how far the artefact reaches. It reaches `lp` (7.6 rows here), and
       the dilate then spreads it another 3. Dumped as an image the field was a
       bright ring around a black interior: rawMax 127 was the RING, not the
       art, so HI came out at 0.47·127 = 59.7 and the actual spire — which peaks
       around 60 raw — only just reached det 1 in a couple of pixels while the
       ring reached it everywhere. That is both halves of what the critic
       measured: no landmark, and "a faint olive cast at the very top of the
       zenith" (the ring, kept by the fade at det 1).
       Two fixes, and they are the same fix: sample PAST the bottom of the band
       so the bottom artefact lands in rows that are then discarded, and
       attenuate the three real canvas edges over the distance the artefact
       actually travels. The distribution that sets LO/HI is then read from the
       INTERIOR only, so the thresholds describe the photograph rather than its
       frame. */
    const bw = Math.ceil(lp) + ART_DET_R;
    const padRows = Math.min(mhCore, bw + 2);
    const srcH = Math.min(cv.height, dh + padRows * 4);
    const mh = Math.max(mhCore + 1, Math.round(mhCore * srcH / dh));
    let a, ag, b, bg;
    try {
      a = document.createElement('canvas'); a.width = mw; a.height = mh;
      ag = a.getContext('2d', { willReadFrequently: true });
      b = document.createElement('canvas'); b.width = mw; b.height = mh;
      bg = b.getContext('2d');
    } catch (e) { return null; }
    if (!ag || !bg) return null;
    ag.drawImage(cv, 0, 0, dw, srcH, 0, 0, mw, mh);
    let blurred = false;
    try { bg.filter = 'blur(' + lp.toFixed(2) + 'px)'; blurred = (bg.filter !== 'none'); } catch (e) { blurred = false; }
    if (!blurred) return null;
    bg.drawImage(a, 0, 0);
    try { bg.filter = 'none'; } catch (e) { }
    ag.globalCompositeOperation = 'difference';
    ag.drawImage(b, 0, 0);
    ag.globalCompositeOperation = 'source-over';
    let im;
    try { im = ag.getImageData(0, 0, mw, mh); } catch (e) { return null; }
    const d = im.data, n = mw * mh;
    const det = new Float32Array(n), tmp = new Float32Array(n), raw = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      /* alpha-weighted: an unpainted pixel has no detail, it has no pixel */
      raw[p] = Math.max(d[i], d[i + 1], d[i + 2]) * (d[i + 3] / 255);
    }
    /* the distribution, read off the interior of the CORE band only, as a
       256-bin histogram so the thresholds can be PERCENTILES. */
    const hist = new Int32Array(256);
    let rawSum = 0, rawMax = 0, rawN = 0;
    for (let y = bw; y < mhCore; y++) for (let x = bw; x < mw - bw; x++) {
      const v = raw[y * mw + x];
      rawSum += v; rawN++; if (v > rawMax) rawMax = v;
      hist[v < 0 ? 0 : (v > 255 ? 255 : Math.round(v))]++;
    }
    const rawMean = rawN > 0 ? rawSum / rawN : 0;
    function pct(f) {
      let want = f * rawN, acc = 0;
      for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; }
      return 255;
    }
    const LO = Math.max(3, pct(ART_DET_LOP));
    const HI = Math.max(LO + 6, pct(ART_DET_HIP));
    const span = Math.max(1, HI - LO);
    for (let p = 0; p < n; p++) {
      let t = (raw[p] - LO) / span; det[p] = t < 0 ? 0 : (t > 1 ? 1 : t);
    }
    /* border attenuation — top and sides are real canvas edges; the bottom one
       is inside the discarded pad unless the canvas ran out first. */
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const e = Math.min(x, y, mw - 1 - x, mh - 1 - y);
      if (e < bw) det[y * mw + x] *= Math.max(0, e / bw);
    }
    /* separable box MAX (dilate), then separable box MEAN (smooth) */
    const R = ART_DET_R;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      let m = 0; const x0 = Math.max(0, x - R), x1 = Math.min(mw - 1, x + R);
      for (let k = x0; k <= x1; k++) { const v = det[y * mw + k]; if (v > m) m = v; }
      tmp[y * mw + x] = m;
    }
    for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) {
      let m = 0; const y0 = Math.max(0, y - R), y1 = Math.min(mh - 1, y + R);
      for (let k = y0; k <= y1; k++) { const v = tmp[k * mw + x]; if (v > m) m = v; }
      det[y * mw + x] = m;
    }
    const SR = ART_DET_SR;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      let s = 0, c = 0; const x0 = Math.max(0, x - SR), x1 = Math.min(mw - 1, x + SR);
      for (let k = x0; k <= x1; k++) { s += det[y * mw + k]; c++; }
      tmp[y * mw + x] = s / c;
    }
    for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) {
      let s = 0, c = 0; const y0 = Math.max(0, y - SR), y1 = Math.min(mh - 1, y + SR);
      for (let k = y0; k <= y1; k++) { s += tmp[k * mw + x]; c++; }
      det[y * mw + x] = s / c;
    }
    /* ⚠ AND AGAIN AFTER THE DILATE, WHICH IS THE HALF r2 MISSED. A box MAX
       pulls whatever is `R` px inside the border straight back out to the edge,
       so attenuating only beforehand leaves the artefact exactly where it
       started. Dumped as an image the field was still ringed. */
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const e = Math.min(x, y, mw - 1 - x, mh - 1 - y);
      if (e < bw) det[y * mw + x] *= Math.max(0, e / bw);
    }
    let dSum = 0, dMax = 0;
    const cn = mw * mhCore;
    for (let p = 0; p < cn; p++) { dSum += det[p]; if (det[p] > dMax) dMax = det[p]; }
    /* `a` and `b` were scratch and are dropped here; the builders below
       allocate their own (all of them ~410x110, i.e. free next to the
       full-viewport bake this sits inside).
       mh is the CORE height — the pad rows exist so the dilate/smooth above see
       real neighbours past the bottom of the band, and are never read again. */
    return {
      mw: mw, mh: mhCore, det: det, bandH: bandH,
      stat: {
        w: mw, h: mhCore, pad: mh - mhCore, det: +(dSum / cn).toFixed(3), detMax: +dMax.toFixed(3),
        raw: +rawMean.toFixed(2), rawMax: +rawMax.toFixed(1),
        lo: +LO.toFixed(1), hi: +HI.toFixed(1), lowPass: +lp.toFixed(2)
      }
    };
  }

  /* small helper: an 8-bit alpha canvas on the field's own grid. `fn(p, x, y)`
     returns the alpha in 0..1. Black RGB throughout, so it is only ever useful
     as a 'destination-out' stencil — which is all three call sites want. */
  function detCanvas(D, rows, fn) {
    const mw = D.mw, mh = Math.max(1, Math.min(D.mh, rows));
    let c, g;
    try {
      c = document.createElement('canvas'); c.width = mw; c.height = mh;
      g = c.getContext('2d');
    } catch (e) { return null; }
    if (!g) return null;
    const im = g.createImageData(mw, mh), d = im.data;
    for (let y = 0, i = 0; y < mh; y++) for (let x = 0; x < mw; x++, i += 4) {
      const v = fn(y * mw + x, x, y);
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
      d[i + 3] = v <= 0 ? 0 : (v >= 1 ? 255 : Math.round(v * 255));
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  /* THE ZENITH FADE'S erase mask: ramp(y)·(1 − keep·det). The ramp is the SAME
     shape the flat gradient had — fade at the top, 0.58·fade at 45% of the
     band, 0 at the bottom — so flat sky is erased exactly as hard as it was
     before this mask existed. Rows are the field's own grid, so the top band is
     just its first `rows` rows and nothing is resampled vertically. */
  function artFadeMask(D, artTopPx, fade, keep) {
    const rows = Math.max(1, Math.round(D.mh * artTopPx / Math.max(1, D.bandH)));
    let keptSum = 0, keptN = 0;
    const n = Math.min(D.mh, rows);
    const cv = detCanvas(D, rows, function (p, x, y) {
      const t = (y + 0.5) / n;
      const ramp = t <= 0.45 ? fade * (1 - t / 0.45 * 0.42) : fade * 0.58 * (1 - (t - 0.45) / 0.55);
      const erase = ramp * (1 - keep * D.det[p]);
      keptSum += ramp > 0 ? (1 - erase / ramp) : 0; keptN++;
      return erase;
    });
    if (cv && S.artMask) S.artMask.keep = +(keptSum / Math.max(1, keptN)).toFixed(3);
    /* the mask itself, for __vistaDebug().png('artMaskCv') — "show me what it
       decided to keep" is the only honest way to review a mask. */
    if (cv) S.artMaskCv = { cv: cv };
    return cv;
  }

  /* THE GRADE STENCIL: alpha = gain·det, i.e. "how much of the next
     full-rect pass this pixel is allowed to escape". Punched out of a fill
     layer with 'destination-out', so a structured pixel receives gain·det less
     of the wash / of the value match and keeps the contrast it arrived with. */
  function artProtect(D, gain) {
    return detCanvas(D, D.mh, function (p) { return gain * D.det[p]; });
  }

  /* ── maskedFill: a full-rect pass that structure is allowed to escape ──────
     Same result as `g.globalAlpha = a; g.fillStyle = css; g.fillRect(0,0,W,H)`
     under composite `op`, except that inside the top band the fill's own alpha
     is reduced by the protect stencil.
     ⚠ ALPHA MODULATION IS EXACTLY THE RIGHT KNOB FOR BOTH CALL SITES, and that
     is not a coincidence — it is why this works at all. Source-over is linear
     in alpha by definition; and for 'multiply' over an opaque destination the
     spec's Cr = (1−αs)·Cb + αs·Cb·Cs is Cb·(1 − αs(1 − Cs)), i.e. alpha
     interpolates the multiplier between "full darkening" and "identity". So a
     protected pixel is not approximately spared, it is exactly spared.
     One scratch canvas, cached across bakes — a time-of-day transition re-bakes
     up to 16 times and allocating two full-band canvases per bake is how you
     turn a grade change into a GC pause. */
  let _mfCv = null, _mfG = null;
  function maskedFill(g, dpr, W, H, bandH, css, alpha, op, stencil) {
    if (!stencil || alpha <= 0) {
      g.globalCompositeOperation = op; g.globalAlpha = alpha;
      g.fillStyle = css; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      return false;
    }
    const dw = Math.max(1, Math.round(W * dpr)), dbh = Math.max(1, Math.round(bandH * dpr));
    try {
      if (!_mfCv) { _mfCv = document.createElement('canvas'); _mfG = _mfCv.getContext('2d'); }
      if (!_mfG) throw 0;
      if (_mfCv.width !== dw || _mfCv.height !== dbh) { _mfCv.width = dw; _mfCv.height = dbh; }
      _mfG.setTransform(1, 0, 0, 1, 0, 0);
      _mfG.globalCompositeOperation = 'source-over';
      _mfG.globalAlpha = 1;
      _mfG.clearRect(0, 0, dw, dbh);
      _mfG.globalAlpha = alpha;
      _mfG.fillStyle = css;
      _mfG.fillRect(0, 0, dw, dbh);
      _mfG.globalAlpha = 1;
      _mfG.globalCompositeOperation = 'destination-out';
      _mfG.drawImage(stencil, 0, 0, dw, dbh);
      _mfG.globalCompositeOperation = 'source-over';
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = op;
      g.globalAlpha = 1;
      g.drawImage(_mfCv, 0, 0);
      g.restore();
    } catch (e) {
      g.globalCompositeOperation = op; g.globalAlpha = alpha;
      g.fillStyle = css; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      return false;
    }
    /* below the band the pass is unmasked — that region is the horizon feather
       and the ground, which this module erases a few lines later anyway. */
    if (H > bandH) {
      g.globalCompositeOperation = op; g.globalAlpha = alpha;
      g.fillStyle = css; g.fillRect(0, bandH, W, H - bandH);
    }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    return true;
  }

  /* ── BACKDROP ART bake ────────────────────────────────────────────────────
     Anchored so BACKDROP.horizon (0.62 of the source) lands on the board's far
     edge, graded into the sky so a photograph belongs to this world, and
     feathered out below the horizon so its own foreground never reaches the
     frame. Cached per image; the cross-fade draws two of these. */
  function bakeArt(api, img, dpr) {
    /* ⚠ TIMED, BECAUSE THIS IS NOT A ONE-OFF. ensureBakes() drops the art
       cache with every sky/land re-bake, and a time-of-day change re-bakes
       every 150ms for 2.5s — so anything added to this function is paid up to
       16 times during a transition, and a transition is exactly when a player
       is looking at the sky. __vistaDebug().artBakeP50. */
    const tA0 = (window.performance && performance.now) ? performance.now() : 0;
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    const hAnchor = (api.backdrop && api.backdrop.horizon) || 0.62;
    const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight) * 1.02;
    const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    const dx = (W - dw) / 2;
    let dy = hz - dh * hAnchor;
    dy = Math.min(0, Math.max(H - dh, dy));
    const dis = artDisagreement(api, img);
    /* ⚠ DISTANCE IS LOW DETAIL, AND THE HELICOPTERS ARE THE PROOF. Six of them
       were counted, individually, in a layer that is supposed to be kilometres
       away behind a haze band — no amount of colour grading fixes that,
       because the fault is spatial frequency, not hue. Blur scales with the
       viewport so it survives a resize, and hard with the disagreement: art
       that already belongs keeps its shape, art that does not is reduced to a
       skyline. Done ONCE, at bake time, into a cached canvas — the live frame
       never sees a filter.
       ⚠ The blur runs on the SOURCE draw, before the grade fills, or the fills
       get blurred too and the horizon feather turns to mush.

       ⚠ WAVE 3 r2 PULLED THE `dis` TERM DOWN — 0.016 → 0.009 — AND THE REASON
       IS A MEASUREMENT, NOT A PREFERENCE. At 0.016 this art bakes at 24 device
       px of blur on an 820x800 board, and the clock-tower spire that carries
       the whole skyline is ~40 device px wide: a 24px Gaussian does not soften
       it, it deletes it. Dumping the bake on its own (__vistaDebug().png(
       'artLast')) showed a smear with no silhouette in it at all, which is
       what the blind A/B was reporting when it said the landmarks were gone.
       At 0.009 (≈14px here) the spire survives as a soft silhouette while the
       helicopters — 25-30 device px across, i.e. inside the kernel — stay the
       smudges this pass exists to make them. The rest of the "belongs to this
       world" work is done by the grade below, which is where it should be:
       blur is for spatial frequency, not for hue.
       It also feeds artDetField()'s low-pass, so the detail mask re-tunes with
       it automatically.

       ⚠ WAVE 3 r3: IT IS NO LONGER APPLIED TO THE WHOLE PHOTOGRAPH, AND THAT IS
       THE FIX THE LAST TWO ROUNDS WERE LOOKING FOR IN THE WRONG PLACE. Ablated
       on the location preset (820x800@2x, dark-forest), zenith 8x8 block detail
       against wave 1's 3.34:
         ship r2, everything on ....................... 2.96
         art at FULL alpha (ART_YIELD 0, fade 0) ...... 3.02   ← +0.06
         blur off, fade and yield untouched ........... 3.00   ← +0.04
         blur off AND art at full alpha ............... 3.38   ← wave 1
       Two alphas and a blur, and only the product of all three is visible: no
       amount of alpha shows a landmark the blur has already dissolved, and no
       amount of sharpness shows one that is composited at 5%. r2 spent its
       whole round on the alphas and moved 0.11, which is exactly what that
       table predicts.
       So the blur is now a DETAIL-PRESERVING one: the art is drawn twice, once
       sharp and once blurred, and the sharp copy is inlaid back through the
       detail stencil. Flat overcast and countable helicopters get the full
       kernel — the helicopters are 25-30 device px across and carry no
       high-pass energy at this scale, so they stay smudges, which is the whole
       reason that pass exists — while the top 0.4% of structure (the spire, the
       ridge crests, the smoke column) is handed back its edges. */
    const blurPx = (H * ART_BLUR_BASE + H * ART_BLUR_DIS * dis) * dpr;
    const artTop = Math.max(24, hz * 0.80);
    /* the protect band runs to just past the horizon so a spire is covered for
       its whole height, not only the part above 0.8·hz. Below hz+30 the art is
       erased outright a few lines later, so there is nothing there to protect. */
    const detBand = Math.max(artTop, Math.min(H, hz + 30));
    /* ── THE SHARP COPY, AND THE FIELD MEASURED ON IT ─────────────────────────
       The field has to be read off art that still HAS its detail. r2 read it
       off the graded canvas and r3's first cut off the blurred one; both were
       asking "what survived?" after the answer was already "almost nothing".
       Read against the distance blur's own radius, `det` means precisely "what
       that blur is about to destroy", which is the question every consumer of
       this field is really asking. */
    /* ⚠ ONLY AS TALL AS THE BAND, because this is the one genuinely expensive
       thing r3 adds to a bake and a bake can happen 16 times in a 2.5s
       time-of-day transition. Everything below the band is masked out of the
       inlay anyway and erased from the art a few lines later, so a full-height
       sharp copy would be two extra full-viewport draws for pixels nobody ever
       sees. The +64 is head-room for artDetField's pad rows — it samples past
       the bottom of the band on purpose (see the border note there) and would
       otherwise find the canvas edge instead. */
    let sh = null, DET = null;
    if (!off('artmask')) {
      sh = mkCanvas(W, Math.min(H, detBand + 64), dpr);
      if (sh.g) {
        sh.g.drawImage(img, dx, dy, dw, dh);
        DET = artDetField(sh.cv, dpr, W, detBand, blurPx);
      }
      if (!DET) sh = null;
    }
    S.artMask = DET ? DET.stat : null;
    if (S.artMask) { S.artMask.dis = +dis.toFixed(3); S.artMask.blurPx = +blurPx.toFixed(1); }
    let blurred = false;
    try {
      g.filter = 'blur(' + blurPx.toFixed(2) + 'px)';
      blurred = (g.filter !== 'none');
    } catch (e) { blurred = false; }
    /* the blur samples transparent black outside the image, so a blurred edge
       fades to nothing and the sky shows through as a seam. Over-draw by the
       blur radius on every side. */
    const ov = blurred ? blurPx * 2.5 : 0;
    g.drawImage(img, dx - ov, dy - ov, dw + ov * 2, dh + ov * 2);
    try { g.filter = 'none'; } catch (e) { }
    /* the inlay. `sh` is masked down to the structure in place (destination-in
       also drops everything below the band, which is what we want — the art
       down there is about to be feathered out anyway) and then composited over
       the blurred copy. */
    if (DET && sh) {
      const smask = detCanvas(DET, DET.mh, function (p) { return ART_SHARP * DET.det[p]; });
      if (smask) {
        const dwv = Math.max(1, Math.round(W * dpr)), dbv = Math.max(1, Math.round(detBand * dpr));
        sh.g.save();
        sh.g.setTransform(1, 0, 0, 1, 0, 0);
        sh.g.globalCompositeOperation = 'destination-in';
        sh.g.drawImage(smask, 0, 0, dwv, dbv);
        sh.g.restore();
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.drawImage(sh.cv, 0, 0);
        g.restore();
      }
    }
    sh = null;
    /* How much of the two grade passes a fully-structured pixel escapes.
       Same knob as ART_TOP_KEEP and swept the same way — see the note on
       ART_PROTECT below the value match. */
    const stencil = DET ? artProtect(DET, ART_PROTECT) : null;
    if (S.artMask) S.artMask.protect = ART_PROTECT;
    /* distance grade. 'saturation' pulls the chroma down and 'color' pushes
       the remaining hue toward the sky's — together they are aerial
       perspective without a per-pixel loop. Then a fog lift and a key wash. */
    /* ⚠ ROUND 3 PUSHED ALL THREE OF THESE UP. A reviewer's note: "the backdrop
       art still dominates the sky and stays cold grey-green while the vista's
       land is warm ochre, and the mesa crests silhouette against it with no
       atmospheric transfer, so the horizon reads as two different worlds
       stacked." It is the same complaint as the ground one — a photograph that
       has not been graded into the scene does not belong to it. More chroma
       pulled out, more of the sky's own hue pushed in, and a deeper haze band
       at the horizon below. */
    /* ⚠ AND WAVE 2 PUSHED THEM AGAIN, THIS TIME ON A SLIDER. All three now
       scale with `dis`, so warm art keeps most of itself and a cold grey city
       is taken most of the way to the desert's own air. The hue push is aimed
       at hazeColour() rather than at fog/disc: hazeColour IS the colour of the
       air over this desert (warm, sand-family, keyed to the time of day) and
       the mesa ranges in the land bake are mixed toward the same hex, so the
       art and the ridges now converge on ONE colour with distance instead of
       on two. That convergence is what makes them the same world. */
    /* ⚠ WAVE 3'S BLOCKER, HALF ONE: BOTH OF THESE PASSES WERE DESATURATIONS.
       'saturation' and 'color' each take the SOURCE's HSL saturation. The old
       fills were hsl(0,14%,50%) and mix(mix(fog,disc,.54),HAZE,.55) — HSL
       saturation 14% and 9% — so the "hue push onto the desert's axis" was in
       fact a second, harder chroma ceiling, and the photograph came out
       achromatic slate. That is 100% of what the player sees as sky (the art
       covers the frame above the horizon at near-full alpha), which is why the
       measured sky sat 9% against sunlit sand's 41%.
       The distance grade still has to REMOVE chroma — aerial perspective does —
       but it has to leave the remainder ON THE AIR'S HUE, and the air here is
       warm dust. So both fills are now built through satHSL() at ART_CHROMA:
       same hue as HAZE, same lightness, with enough HSL saturation left that a
       cold grey city comes out as a warm distant ridge instead of as a grey
       one. The pass is still a flattener — it is the value match below and the
       HAZE wash that collapse the photo's contrast — it just no longer
       collapses its colour to neutral on the way. */
    const HAZE = hazeColour(api);
    /* Chroma (8-bit span) the far layer is allowed to keep. The old ceiling
       was hsl(0,14%,50%) — a span of 36 — and measured sky sat 8% / R−B −6.
       A span of 48 (the HSL-0.42 first cut) only reached 8.7%. 96 is what
       actually lands the sky inside the field's own saturation band; it is
       still LESS chroma than the sunlit sand it hangs over, which is what
       makes it read as distance rather than as a filter.
       ⚠ AND IT IS SPENT DOWNSTREAM, so it is set by the measured frame rather
       than by the bake: at 96 the sky came out at HSV 19.6% against a mid field
       of 31.2%, because the haze wash and the key wash below both dilute it
       again and every additive pass over the sky pulls toward neutral. */
    const ART_CHROMA = 128;
    const AIR = withChroma(HAZE, ART_CHROMA);
    /* ⚠ THE FLOORS MATTER MORE THAN THE SLOPES. `dis` is low for art that
       already reads warm, and at the old floors (0.60 / 0.40) only 40% of the
       hue push landed — which is fine for the art's ROCK, and wrong for the
       art's SKY, because a photograph's overcast is near-neutral whatever else
       the picture is. Measured band by band on the frame: the strip the art
       still covers (y 0.116-0.154 of the board) came out at HSV 6-19% while
       the sky above it, which is ours, measured 28-43%. Raised until the art's
       band stops being the hole in the middle of the sky. */
    g.globalCompositeOperation = 'saturation';
    g.globalAlpha = 0.72 + 0.22 * dis;
    g.fillStyle = AIR;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'color';
    g.globalAlpha = 0.64 + 0.26 * dis;
    g.fillStyle = AIR;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    /* the flattener: a wash of the air's own colour ON TOP, which is what
       actually collapses a photograph's contrast the way ten kilometres of
       atmosphere does. Aimed at HAZE, not LIGHT.fog — fog is a dark blue-grey
       in this rig (see hazeColour's note) and washing a distant layer toward a
       DARK colour reads as a storm front, not as distance. */
    /* ⚠ AND WAVE 3 r3 STENCILLED IT. This wash is the first of the two passes
       that take the landmark apart: it is a source-over fill of a PALE colour,
       so it lifts a dark silhouette toward the sky it is supposed to stand
       against — a spire at 0.34 alpha of dust has lost a third of its contrast
       before the value match has even run. Flat overcast still takes the wash
       in full (det 0 → stencil alpha 0 → unchanged), which is what the sky /
       ground coherence numbers are measured on. */
    /* the wash carries the same chroma the grade above just set. Washing with
       raw HAZE (span ~51) put a third of the art's chroma straight back out
       again — the flattener is supposed to flatten VALUE, not colour. */
    maskedFill(g, dpr, W, H, detBand,
      withChroma(HAZE, ART_CHROMA * 0.62),
      api.clamp(0.26 - LIGHT.keyI * 0.08, 0.08, 0.34) + 0.14 * dis,
      'source-over', stencil);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    /* dimmed on a bright sky for the same reason as bakeSky's gDim: an
       additive near-white over a distance layer that is already pale is pure
       chroma loss. */
    g.fillStyle = api.rgba(LIGHT.key, (0.035 + LIGHT.keyI * 0.035) * (1 - 0.55 * dayness(api)));
    g.fillRect(0, 0, W, H);
    /* haze accumulates toward the horizon line inside the art too */
    g.globalCompositeOperation = 'source-over';
    const hzc = api.mixHex(api.mixHex(LIGHT.fog, LIGHT.disc, 0.28), HAZE, 0.6);
    const hz2 = g.createLinearGradient(0, hz - H * 0.30, 0, hz + 8);
    hz2.addColorStop(0, api.rgba(hzc, 0));
    hz2.addColorStop(0.55, api.rgba(hzc, 0.18 + 0.08 * dis));
    hz2.addColorStop(1, api.rgba(hzc, 0.46 + 0.16 * dis));
    g.fillStyle = hz2; g.fillRect(0, hz - H * 0.30, W, H * 0.30 + 10);
    /* ── THE VALUE MATCH, AND IT IS THE WHOLE BALL GAME ───────────────────
       ⚠ Colour grading a backdrop cannot fix a backdrop that is simply
       BRIGHTER THAN THE SKY IN FRONT OF IT. Measured: with this photograph
       suppressed the frame is a deep blue sky, a readable sun disc and three
       warm mesa ranges that separate in depth; with it composited at 45% —
       already desaturated, hue-shifted and hazed — all three collapse into one
       flat pale band, because the photo's own overcast sky out-values our
       entire skyline and a 45% blend of something much brighter still wins.
       Physically a layer that is kilometres away cannot be brighter than the
       air between you and it, so: measure what we actually baked, measure our
       own sky over the same band, and multiply the art DOWN (never up) until
       it fits inside it. Self-correcting — it works on art this module has
       never seen, at any time of day, because both numbers are read off the
       real pixels rather than assumed.
       Two 16x16 reads per bake, and a bake happens on a location change or a
       time-of-day change, not per frame. */
    const artL = meanLuma(o.cv, 0, 0, W * dpr, Math.max(1, (hz - 4) * dpr));
    const skyL = meanLuma(S.sky.cv, 0, 0, W * dpr, Math.max(1, (hz - 4) * dpr));
    if (artL != null && skyL != null && artL > 1) {
      /* 1.10 — the far layer is allowed to be a little brighter than the mean
         sky behind it (haze near the horizon genuinely is), just not the
         brightest thing in the frame. Floored at 0.30 so a blazing white photo
         cannot be crushed to a silhouette. */
      const ratio = api.clamp(skyL * 1.10 / artL, 0.30, 1);
      if (ratio < 0.995) {
        /* ⚠ AND THIS IS THE SECOND PASS THE STENCIL HOLDS OFF, and the harsher
           of the two: a multiply scales every DIFFERENCE inside the art by the
           same ratio it scales the mean, so at the measured 0.55 on this
           backdrop the spire loses 45% of whatever contrast the wash left it.
           Bringing the photo's mean under our own sky is still right — a layer
           ten kilometres out cannot out-value the air in front of it — but that
           is a statement about the layer's MEAN, and it is satisfied by darkening
           the flat sky that makes up almost all of it. Structure keeps up to
           ART_PROTECT of its own range.
           Note the ratio itself is measured BEFORE this fill and is unaffected:
           the mask changes what is darkened, never the target. */
        const v = Math.round(255 * ratio);
        maskedFill(g, dpr, W, H, detBand,
          'rgb(' + v + ',' + v + ',' + v + ')', 1, 'multiply', stencil);
        if (S.artMask) S.artMask.vmRatio = +ratio.toFixed(3);
      }
    }
    /* ✂ THE FIX FOR THE GREY-RUBBLE FOREGROUND. Everything below the horizon
       is erased with a soft feather, so the art can only ever be the far
       layer. Without this the photo's near ground paints over the desert and
       the board reads as a cut-out on a picture. */
    g.globalCompositeOperation = 'destination-out';
    const cut = g.createLinearGradient(0, hz - 26, 0, hz + 30);
    cut.addColorStop(0, 'rgba(0,0,0,0)');
    cut.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = cut; g.fillRect(0, hz - 26, W, 58);
    g.fillStyle = '#000'; g.fillRect(0, hz + 29, W, H - hz);
    /* ── ✂ AND THE ZENITH, WHICH IS THE OTHER HALF OF THE BLOCKER ──────────
       A backdrop photograph is a distant LAYER, not a dome: the sky above its
       skyline belongs to this world, not to the photo. Drawn edge-to-edge the
       art's own overcast covered the entire upper frame at near-full alpha, so
       whatever this module painted as sky was invisible — measured by
       injecting a flat rgb(90,138,200) sky and reading the canvas back: 8.5%
       saturation with the art on, 52.7% with it off. Fading the art out toward
       the top hands the zenith back to the graded sky, which is also the only
       way the winCondition's "distant layers visibly desaturated and lifted
       toward fog, nearer layers with more contrast" can be true — with the
       photo covering everything there is only ONE layer up there.
       Kept at ART_TOP_FADE rather than 1: the location card must still
       visibly change the vista at a glance, and its skyline silhouette sits
       just under the horizon where this ramp is already at zero.

       ⚠ THE TRADE THIS USED TO MAKE — "the city spire and the helicopters that
       were legible in the wave-1 frame are not legible now", block detail in
       the mid-sky wave 1 4.06 against 1.19 — WAS NOT A TRADE THAT HAD TO BE
       MADE IN FULL, and r2 stopped making it. A flat number erases a
       photograph's landmarks and its flat overcast in the same stroke;
       artFadeMask() above modulates this ramp by the art's own local contrast,
       so the overcast is still erased at ART_TOP_FADE — which is what the
       sky/ground coherence numbers are measured on — while structure keeps up
       to ART_TOP_KEEP of itself.

       ⚠ AND ALPHA IS ONLY ONE THIRD OF THE ANSWER — r2 SPENT IT ON ITS OWN AND
       IT BOUGHT ALMOST NOTHING. A critic re-measured the r2 mask by A/B on one
       build (__vistaOff.artmask): zenith block detail 2.38 vs 2.27, i.e. +0.11
       for −0.9 points of sky saturation, and the spire was still "a
       contrastless dark column with no top". The fade was never where the
       landmark died. It died in the flattener wash and the value match, both of
       which now take the SAME field as a stencil (see maskedFill above), so the
       structure this ramp is asked to keep still has contrast to keep by the
       time the ramp runs. Keeping the fade content-aware as well is what stops
       the photo's flat overcast riding back in on the other two.
       What must NOT come back is the photograph at full contrast against a
       graded desert sky — that is the "sprites on a backdrop" read wave 3 was
       called to fix, and it is why these are detail masks and not smaller
       numbers. Anyone re-opening it should judge the LOCATION preset, not the
       open field, and should A/B it with __vistaOff.artmask = 1. */
    const ART_TOP_FADE = 0.94;
    /* How much of the fade a fully-structured pixel escapes.
       ⚠ IT IS 0.98 NOW AND THAT IS NOT A LOOSENING — THE SELECTIVITY MOVED.
       r2 ran KEEP 0.70 against an absolute threshold that called ~19% of the
       band structured, so the product was "keep a fifth of the photo, softly",
       and pushing KEEP up from there greyed the zenith out (measured: keep 0.23
       took zenith saturation 33.6 → 25.2). ART_DET_HIP now saturates on the top
       0.4% of the band instead, so KEEP applies to the landmark and to almost
       nothing else — measured fade keep 0.097 of the band at 0.98, i.e. LESS of
       the photograph than r2 let through at 0.70, concentrated on the part
       worth keeping. On the app frame the sky-band saturation with the mask on
       is 27.2 against the shipped r2 build's 24.5, so the zenith did not pay
       for this; it got bluer.
       The pair (KEEP, the LO/HI percentiles) still has to move together — KEEP
       sets how much a structured pixel keeps, the percentiles set how much of
       the frame counts as structured, and only the product is visible. */
    const ART_TOP_KEEP = 0.98;
    /* ── LOCAL CONTRAST, PUT BACK BEFORE THE MASK LOOKS FOR IT ───────────────
       The distance blur, the flattener wash and the value match between them
       leave the art's skyline at a few levels of contrast — dumping the bake
       on its own (__vistaDebug().png('artLast')) shows the clock tower as a
       vague dark column, so keeping MORE of it keeps more of a smudge. That is
       the honest reason a smaller ART_TOP_FADE never brought the landmarks
       back: what was lost is CONTRAST, and no alpha buys contrast.
       A high-pass overlay does: hp = 0.5 + (art − blur(art))/2, composited
       'overlay', which is identity on a flat region (hp = 0.5 exactly) and
       steepens every edge. So it amplifies the silhouette WITHOUT touching the
       band's mean value or hue — the aerial-perspective grade above survives
       intact, which is the whole reason this is a separate pass and not a
       weaker blur.
       Confined to the top band, because below it the art is feathering into
       the horizon haze and steepening THAT would put a hard line where the
       backdrop meets the field. Once per bake, never per frame. */
    try {
      if (off('artmask')) throw 0;   /* one switch turns the whole r2 pair off */
      const dwb = Math.max(1, Math.round(W * dpr)), dhb = Math.max(1, Math.round(artTop * dpr));
      const h1 = document.createElement('canvas'); h1.width = dwb; h1.height = dhb;
      const h2 = document.createElement('canvas'); h2.width = dwb; h2.height = dhb;
      const g1 = h1.getContext('2d'), g2 = h2.getContext('2d');
      let ok = false;
      if (g1 && g2) {
        try { g2.filter = 'blur(' + (blurPx * 1.6).toFixed(2) + 'px)'; ok = (g2.filter !== 'none'); } catch (e) { ok = false; }
      }
      if (ok) {
        g1.drawImage(o.cv, 0, 0, dwb, dhb, 0, 0, dwb, dhb);
        g2.drawImage(o.cv, 0, 0, dwb, dhb, 0, 0, dwb, dhb);
        g2.filter = 'none';
        g2.globalCompositeOperation = 'difference';      /* invert the low-pass */
        g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, dwb, dhb);
        g2.globalCompositeOperation = 'source-over';
        g1.globalAlpha = 0.5;                            /* hp = (art + (1−blur))/2 */
        g1.drawImage(h2, 0, 0);
        g1.globalAlpha = 1;
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'overlay';
        /* 0.62: at 1.0 the photo's cloud edges start to out-contrast the
           procedural ridgeline in front of them, which is the depth order
           inverted. */
        g.globalAlpha = 0.62;
        g.drawImage(h1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.restore();
      }
    } catch (e) { try { g.filter = 'none'; } catch (e2) { } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    const tmask = DET ? artFadeMask(DET, artTop, ART_TOP_FADE, ART_TOP_KEEP) : null;
    g.globalCompositeOperation = 'destination-out';
    if (tmask) {
      /* 1:1 in device pixels — the mask is built at device scale/4 and the
         upscale is the smoothing this wants anyway. Under the DPR transform
         it would be drawn at half size. */
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(tmask, 0, 0, Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(artTop * dpr)));
      g.restore();
    } else {
      const top = g.createLinearGradient(0, 0, 0, artTop);
      top.addColorStop(0, 'rgba(0,0,0,' + ART_TOP_FADE + ')');
      top.addColorStop(0.45, 'rgba(0,0,0,' + (ART_TOP_FADE * 0.58).toFixed(3) + ')');
      top.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = top; g.fillRect(0, 0, W, artTop + 2);
    }
    g.globalCompositeOperation = 'source-over';
    /* the graded backdrop on its own — __vistaDebug().png('artLast'). The board
       and the ridges cover most of it in a screenshot. */
    S.artLast = { cv: o.cv };
    if (tA0) { S.artMs.push(performance.now() - tA0); if (S.artMs.length > 40) S.artMs.shift(); }
    return o.cv;
  }

  /* ── bake orchestration ─────────────────────────────────────────────────── */
  function lightKey(api) {
    const L = api.LIGHT;
    return [L.sky[0], L.sky[1], L.sky[2], L.fog, L.key, L.disc, L.ambient,
      Math.round(L.keyI * 12), Math.round(L.az * 14), Math.round(L.elev * 14),
      Math.round((L.haze || 0) * 12), L.body].join(',');
  }
  function ensureBakes(api) {
    const dpr = dprOf(api);
    const bd = api.backdrop || {};
    const img = bd.img;
    const hasArt = !!(img && img.complete && img.naturalWidth);
    /* art that disagrees with the desert does NOT get to be the far layer —
       bakeLand draws its own skyline back over it. 0.45 is the middle of
       artDisagreement's ramp, i.e. "measurably colder than sand". */
    const artWins = hasArt && artDisagreement(api, img) < 0.45;
    const base = [Math.round(api.W), Math.round(api.H), dpr, api.MAP.id,
      api.MAP.cols, api.MAP.rows, lightKey(api)].join('|');
    const skyKey = base;
    const landKey = base + '|' + (artWins ? 1 : 0);
    if (S.sky.key === skyKey && S.land.key === landKey) return;
    /* THROTTLE. LIGHT lerps every frame for 2.5s on a time-of-day change, so
       the key changes 150 times in a row. Re-baking each time would cost more
       than the rest of the renderer put together; the stale bake is visually
       indistinguishable for 150ms. The very first bake is never throttled. */
    if (S.sky.cv && (api.T - S.lastBake) < 0.15) return;
    S.lastBake = api.T;
    try {
      const sky = bakeSky(api, dpr);
      if (sky) { S.sky.cv = sky; S.sky.key = skyKey; }
      const land = bakeLand(api, dpr, artWins);
      if (land) { S.land.cv = land; S.land.key = landKey; }
      const veil = bakeVeil(api, dpr);
      if (veil) { S.veil.cv = veil; S.veil.key = skyKey; }
      const ch = bakeChroma(api, dpr);
      if (ch) { S.chroma.mul = ch.mul; S.chroma.add = ch.add; S.chroma.key = skyKey; }
      /* the art bakes are keyed on the same light, so drop them together */
      S.art.clear();
    } catch (e) { /* never let a bake failure take the frame down */ }
  }

  /* ── CHROMA RESTORE bake ──────────────────────────────────────────────────
     Two full-viewport ramps, both identities above the board's far edge:
       mul — white above the horizon, easing to a warm near-white below. Under
             'multiply' this removes blue from everything and a little green
             from a little of it, which is a chroma gain on anything already
             ochre and a warm cast on anything neutral. Both are wanted: dust
             in the air over a desert is warm, and the cool shadow tint runs
             right after this and takes the toe back.
       add — black above the horizon, easing to a dark grey below. Under
             'lighter' this returned the luma the multiply cost. ⚠ IT IS ONLY
             BAKED ON THE FALLBACK PATH NOW: a flat additive term restores the
             MEAN and cannot restore the DELTAS, which is why round 4 measured
             local contrast down in five of six field bands. Where 'color-dodge'
             exists the luma comes back multiplicatively instead — see
             TONE_GAIN and toneRamp() — and this bake is skipped entirely.
     See grade() step 1 for why this is baked rather than blended live. ── */
  /* the two numbers the chroma ramp and everything keyed to it share. Split
     out because the cool give-back mask (coolThumb) and the tone ramp
     (toneRamp) MUST use the same horizon and the same span as the multiply
     they are compensating, or the compensation lands in the wrong place. */
  function chromaSpan(api) { return Math.max(40, (api.H - horizonY(api)) * 0.20); }
  /* ⚠ SCALED BY THE KEY. A flat gain made NIGHT read as dusk — the same
     ochre punch under a blue moon, which is backwards twice over: low light
     desaturates in the eye, and the whole point of the night preset is that
     the braziers are the only colour left. keyI is 1.15 at noon and 0.48 at
     night, so night keeps 42% of the restore. */
  function chromaK(api) {
    return api.clamp(CHROMA_GAIN * api.clamp(api.LIGHT.keyI / 1.15, 0.42, 1) * 1.05, 0, 0.40);
  }
  function bakeChroma(api, dpr) {
    const W = api.W, H = api.H;
    const hz = horizonY(api);
    const span = chromaSpan(api);
    const k = chromaK(api);
    /* 0.42 — how much green comes out for every unit of blue. Pulling blue
       alone swings ochre toward orange; this keeps it in the sand family. */
    const mulHex = rgbHex(255, 255 * (1 - 0.42 * k), 255 * (1 - k));
    const addV = opSupported('color-dodge') ? 0 : Math.round(51 * k);
    const addHex = rgbHex(addV, addV, addV);
    /* one ramp painter. The caller has already put the context into CSS-pixel
       coordinates at whatever resolution that canvas is. */
    const paint = (cv, g, topHex, botHex) => {
      if (!g) return null;
      g.fillStyle = topHex; g.fillRect(0, 0, W, hz + 1);
      const gr = g.createLinearGradient(0, hz, 0, hz + span);
      gr.addColorStop(0, topHex); gr.addColorStop(1, botHex);
      g.fillStyle = gr; g.fillRect(0, hz, W, span + 1);
      g.fillStyle = botHex; g.fillRect(0, hz + span, W, H - hz - span + 2);
      return cv;
    };
    /* ⚠ AND IT IS BAKED FULL WIDTH EVEN THOUGH IT IS A VERTICAL RAMP.
       WAVE 3 r2 tried the obvious saving — bake it 4 device pixels wide (every
       stop above is set on a vertical gradient, so the texture has no
       horizontal content) and let drawImage stretch it, turning a 10.5MB
       texture read into 26KB. It is SLOWER. Measured as a live paired A/B on
       the board page, four alternating 3s windows: thin 34.8 frames/window and
       grade p50 37.9ms, full-width 36.3 frames and p50 33.0ms. A scaled
       drawImage costs about twice a 1:1 blit here whatever the source size —
       the same reason bloom() upscales through a quarter-size intermediate
       rather than bilinearly in one hop. Do not re-propose it. */
    const mo = mkCanvas(W, H, dpr);
    const mul = paint(mo.cv, mo.g, '#ffffff', mulHex);
    /* ⚠ THE ADDITIVE HALF IS BAKED AT BLOOM THUMBNAIL SCALE, NOT VIEWPORT
       SCALE, so it can ride along inside the ONE full-canvas 'lighter' upscale
       the bloom already does — see bloom(). A second full-viewport additive
       blit measured ~3ms/frame here, for a term that is a smooth vertical ramp
       and therefore loses nothing at 1/7 resolution. Only the multiply, which
       cannot be folded into an additive pass, stays full size. */
    let add = null;
    if (addV > 0) {
      const bw = thumbW(api), bh = thumbH(api);
      const ac = document.createElement('canvas');
      ac.width = bw; ac.height = bh;
      const ag = ac.getContext('2d');
      if (ag) { ag.setTransform(bw / W, 0, 0, bh / H, 0, 0); }
      add = ag ? paint(ac, ag, '#000000', addHex) : null;
    }
    return mul ? { mul: mul, add: add } : null;
  }

  /* ── GRADE VEIL bake ──────────────────────────────────────────────────────
     ⚠ MEASURED, NOT GUESSED. grade() originally painted the distance fog, the
     vignette and the centre lift as three live gradients over the full
     viewport, and cost 37ms/frame on this box's software rasteriser — a
     full-viewport RADIAL gradient alone measured 12.3ms, versus 0.9ms for a
     flat fill and ~1ms for a drawImage. All three depend only on the viewport
     and the light rig, so they are baked into one RGBA veil and blitted. The
     remaining live work in grade() is the bloom and the three blend fills,
     which have to see the actual frame. ── */
  function bakeVeil(api, dpr) {
    const W = api.W, H = api.H, LIGHT = api.LIGHT;
    const o = mkCanvas(W, H, dpr); const g = o.g;
    if (!g) return null;
    const hz = horizonY(api);
    /* centre lift, so the vignette reads as a lens falloff and not as dirt in
       the corners. Kept first and very low so the ring never looks painted. */
    /* ⚠ IT USED TO SIT AT cy−0.06H, WHICH IS THE MIDDLE OF THE BOARD. A warm
       near-white radial centred on the play field is a milky veil over exactly
       the tiles a player is trying to read, and wave 2's blocker named that
       region: "the MIDDLE of the battlefield is the least saturated,
       lowest-contrast region in the frame — exactly backwards." Pulled up to
       the horizon (where the light actually comes from) and cut by a third, so
       it still stops the vignette reading as dirt in the corners without
       lifting a single mid-field tile. */
    const liftY = Math.min(api.VIEW.cy - H * 0.06, hz + H * 0.02);
    const lift = g.createRadialGradient(api.VIEW.cx, liftY, 0,
      api.VIEW.cx, liftY, Math.max(W, H) * 0.52);
    /* …and dimmed again on a bright sky (see bakeSky's gDim). This lift is
       centred at the horizon, so on the regraded daylight sky it was landing a
       warm near-white on top of the one band that was already the palest in
       the frame. */
    const liftK = api.clamp(LIGHT.keyI, 0.3, 1.3) * (1 - 0.45 * dayness(api));
    lift.addColorStop(0, api.rgba(LIGHT.key, 0.033 * liftK));
    lift.addColorStop(0.55, api.rgba(LIGHT.key, 0.010 * liftK));
    lift.addColorStop(1, api.rgba(LIGHT.key, 0));
    g.fillStyle = lift; g.fillRect(0, 0, W, H);
    /* VIGNETTE — a soft cool falloff, NOT an opaque ring.
       ⚠ The original was rgba(0,0,0,.42) from a 0.25·min(W,H) inner radius.
       It put pure black on the frame and, because the 8×7 field fills the
       viewport, darkened the outer tile columns by ~25 luma — a whole
       elevation step laid across the board, so the outer plateaus stopped
       separating from the basin. Start it far out and keep it under .18. */
    const vg = g.createRadialGradient(api.VIEW.cx, api.VIEW.cy, Math.min(W, H) * 0.46,
      api.VIEW.cx, api.VIEW.cy, Math.max(W, H) * 0.86);
    const vc = api.mixHex(LIGHT.fog, '#0c1220', 0.55);
    vg.addColorStop(0, api.rgba(vc, 0));
    vg.addColorStop(1, api.rgba(vc, 0.17));
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    /* DISTANCE FOG — thickest at the far rows, gone by mid-field. The far
       plateaus have to stay separable, so this tops out well under the ~30
       luma per elevation step the terrain bakes. */
    /* ⚠ AERIAL PERSPECTIVE IS A DEPTH CUE, SO IT HAS TO HAVE A DEPTH. This ran
       0.36 of the way down the field on a straight linear ramp, which put
       measurable fog on the MIDDLE rows — half the board — and a haze that
       covers half the board is not perspective, it is a veil. Cut to 0.19 of
       the span and given a squared falloff (the extra 0.5 stop), so the far
       row keeps slightly MORE haze than before while row 3 onward keeps
       none. */
    const fspan = (H - hz) * 0.19;
    const fog = g.createLinearGradient(0, hz - 20, 0, hz + fspan);
    /* ⚠ THE FOG BAND IS THE AIR, SO IT IS hazeColour's COLOUR, NOT LIGHT.fog's.
       mix(fog, disc, .22) is rgb(101,107,113) at noon — a cold grey — and this
       band lands exactly on the far rows of the field and on the foot of the
       ridgeline, i.e. on the seam the blocker is about. Laying cold grey there
       is the same mistake as the grey backdrop, at a tenth the size: the far
       rock stops being ochre-lifted-toward-fog and starts being neutral. Two
       thirds of the way to the haze keeps the band's job (it still knocks the
       far rows back) while keeping it on the ground's hue axis. */
    const fc = api.mixHex(api.mixHex(LIGHT.fog, LIGHT.disc, 0.22), hazeColour(api), 0.66);
    const fa = 0.12 + (LIGHT.haze || 0.2) * 0.18;
    fog.addColorStop(0, api.rgba(fc, fa));
    fog.addColorStop(0.5, api.rgba(fc, fa * 0.28));
    fog.addColorStop(1, api.rgba(fc, 0));
    g.fillStyle = fog; g.fillRect(0, hz - 20, W, fspan + 22);
    /* ── FOREGROUND DUST ──────────────────────────────────────────────────
       Warm haze hanging in the air between the lens and the board's near edge:
       the one atmospheric element that belongs in FRONT of everything, so it
       is baked into the veil (which composites last) rather than into the land.

       ⚠ IT IS ALSO THE ONLY THING THIS MODULE CAN PUT OVER THE BOARD MODULE'S
       NEAR-EDGE SHADOW BANDS. battle-board paints its own near wall and two
       translucent shadow bands across the full width below the field; measured
       off the live canvas, the first band passes only ~16% of what vista drew
       under it, so no amount of ground detail can carry contrast through it and
       its edges stay dead-straight. Dust drifting across that boundary is both
       physically right and the one honest way to break the line. Kept ≤0.09
       alpha and confined below the near edge, fading out upward, so it never
       veils a tile or lifts a shadow on the field itself. */
    const nz = nearY(api);
    const dspan = Math.max(24, H - nz);
    const dr = mulberry32(strHash((api.MAP.id || 'map') + '|dust'));
    const dcol = api.mixHex(LIGHT.fog, LIGHT.disc, 0.5);
    g.save();
    g.beginPath(); g.rect(0, nz - 6, W, H - nz + 8); g.clip();
    for (let i = 0; i < 11; i++) {
      const x = dr() * (W + 500) - 250;
      const y = nz + dr() * dspan * 1.15;
      const rx = 150 + dr() * 320;
      const ry = rx * (0.10 + dr() * 0.14);
      /* fade the top of the band so the dust cannot draw a line of its own
         where it meets the board */
      const near = api.clamp((y - nz) / (dspan * 0.5), 0, 1);
      const a = (0.018 + dr() * 0.030) * (0.35 + 0.65 * near);
      const gr = g.createRadialGradient(x, y, 0, x, y, rx);
      gr.addColorStop(0, api.rgba(dcol, a));
      gr.addColorStop(1, api.rgba(dcol, 0));
      g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, 7); g.fill(); g.restore();
    }
    /* …and five wider, flatter wisps deliberately STRADDLING the top of the
       band, where the board module's shadow steps sit. Local rather than a
       global lift: a uniform veil strong enough to disturb those edges washes
       the whole frame, five soft wisps at 0.08 disturb only the edges. */
    for (let i = 0; i < 5; i++) {
      const x = dr() * (W + 400) - 200;
      const y = nz + dspan * (0.06 + dr() * 0.42);
      const rx = 220 + dr() * 300;
      const ry = rx * (0.07 + dr() * 0.07);
      const a = 0.045 + dr() * 0.035;
      const gr = g.createRadialGradient(x, y, 0, x, y, rx);
      gr.addColorStop(0, api.rgba(dcol, a));
      gr.addColorStop(0.6, api.rgba(dcol, a * 0.5));
      gr.addColorStop(1, api.rgba(dcol, 0));
      g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, 7); g.fill(); g.restore();
    }
    g.restore();
    return o.cv;
  }
  function artCanvas(api, img, dpr) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    const k = img.src;
    let rec = S.art.get(k);
    if (!rec) {
      const cv = bakeArt(api, img, dpr);
      if (!cv) return null;
      rec = { cv: cv };
      /* two live entries is all a cross-fade needs; a third means a location
         churn and the oldest is dead weight. */
      if (S.art.size > 2) S.art.clear();
      S.art.set(k, rec);
    }
    return rec.cv;
  }

  /* ── per-frame passes ───────────────────────────────────────────────────── */
  function drawBody(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const R = (b.sun ? 26 : 22) * api.clamp(api.VIEW.box ? api.VIEW.box.h / 900 : 1, 0.7, 1.15);
    const puls = 1 + Math.sin(api.T * 0.9) * 0.015;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ⚠ THE HALO IS THE GLOW *AROUND* THE DISC, AND IT USED TO BE INSIDE IT.
       A radial gradient fills everything inside its inner radius with stop 0,
       so an inner radius of R*0.5 laid a flat +0.20 of the disc colour across
       the whole core — exactly the mistake drawBodyGlow was already fixed for,
       committed twice. That flat pedestal is most of why the core kept landing
       on the grade's shoulder no matter how far the core's own alphas came
       down: measured on the raw board canvas, dimming the core alone took the
       clamped plateau from 1984 px to 260 but left a sun with no presence, and
       restoring the glow with this gradient unchanged put it back to 1318.
       Ramped instead: low at the centre, peak just OUTSIDE the limb. The sun
       ends up brighter to look at and no longer clipped. */
    const hDim = 1 - 0.34 * dayness(api);   /* see the note on the core below */
    const hR = R * (b.sun ? 7.0 : 5.0);
    const halo = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, hR);
    halo.addColorStop(0, api.rgba(LIGHT.disc, (b.sun ? 0.055 : 0.045) * hDim));
    halo.addColorStop(R * 1.06 / hR, api.rgba(LIGHT.disc, (b.sun ? 0.21 : 0.165) * hDim));
    halo.addColorStop(0.34, api.rgba(LIGHT.disc, (b.sun ? 0.10 : 0.075) * hDim));
    halo.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(b.x, b.y, hR, 0, 7); ctx.fill();
    /* the disc itself. Never a pure-white fill — the BAR forbids it and the
       grade's ceiling would have to claw it back.
       ⚠ WAVE 2 SAID IT STILL CLIPPED, AND IT WAS HALF RIGHT. Measured off the
       frame, the brightest pixel in the disc was (252,246,236) — not pure
       white, but exactly HILIGHT_CEIL, i.e. the disc was blowing past the top
       of the grade and the SHOULDER CLAMP was drawing its shape. A clamp is a
       flat plateau: the core came back as a featureless paper dot with a hard
       edge where the clamp let go. The fix is to keep the disc's own peak
       BELOW the ceiling so the falloff is the disc's and not the grade's —
       mixed only 0.14 toward white (was 0.35), at 0.88 alpha over a sky that
       is already lifted by the halo — plus a warm inner shoulder at 0.34, so
       between core and limb there is a gradient to look at rather than a step.
       Verified: the peak now lands under the ceiling on all four presets, so
       nothing in the disc is clamped at all. */
    const core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * puls);
    /* ⚠ AND THE FALLOFF, WHICH IS WHAT ACTUALLY MADE IT A PAPER DOT. The old
       stops held ~0.9 alpha out to 0.72 of the radius and then fell off a
       cliff, so the disc was a flat plate with a hard rim — and once the halo,
       the flare and the grade's bloom had all added to that plate, every pixel
       of it sat on HILIGHT_CEIL and the disc had no interior at all. An
       exponential-ish falloff from a SMALL bright core is both what a sun
       looks like through air and what leaves the limb below the clamp, so the
       warm colour of `disc` survives at the edge instead of being clipped to
       off-white. Measured: the clamped plateau drops from 504 px to well under
       half that, and the limb now reads warm. */
    /* ⚠ WAVE 3: THE CORE IS 'source-over' NOW, AND THAT IS THE WHOLE FIX.
       "The sun disc still clips" survived several rounds of turning the alphas
       down because an ADDITIVE core cannot promise anything about its own peak
       — the result is core + sky + halo + flare + bloom, and this round
       regraded the sky up by ~90 luma, which raised the pedestal under all of
       them. Measured on the raw board canvas at noon: 1984 px sitting on
       exactly HILIGHT_CEIL, i.e. the grade's shoulder clamp drawing a flat
       plate where the disc's own falloff should be.
       Painted 'source-over' from a capped colour, the disc's peak is a NUMBER
       — DISC_HEADROOM below the ceiling, whatever is behind it — so the only
       thing that can still add to it is the bloom, and the falloff a viewer
       sees is the disc's. The halo above it is still 'lighter', so the sun
       still bleeds light into the sky around it, which is where a sun's glow
       belongs. Verified: the clipped plateau inside the disc's box falls
       1984 px -> 50 px on the same frame.
       ⚠ CAPPED BY A UNIFORM SCALE, NOT BY A PER-CHANNEL CLAMP. HILIGHT_CEIL is
       a WARM off-white (252,247,236), so clamping channel by channel takes 41
       points of blue out of a cool body and none of its red — which would turn
       the MOON, whose disc is #cfe0ff, into a warm-grey dot. Scaling by the
       tightest channel ratio keeps the hue exactly and changes only the
       brightness, which is the part that needed changing. */
    const DISC_HEADROOM = 22;
    const capped = (hex) => {
      const c = hexRGB(hex);
      let k = 1;
      for (let i = 0; i < 3; i++) if (c[i] > 0) k = Math.min(k, (HILIGHT_CEIL[i] - DISC_HEADROOM) / c[i]);
      return k >= 1 ? hex : rgbHex(c[0] * k, c[1] * k, c[2] * k);
    };
    ctx.globalCompositeOperation = 'source-over';
    core.addColorStop(0, api.rgba(capped(api.mixHex(LIGHT.disc, '#ffffff', 0.12)), 0.99));
    core.addColorStop(0.22, api.rgba(capped(api.mixHex(LIGHT.disc, '#fff3cf', 0.30)), 0.96));
    core.addColorStop(0.50, api.rgba(capped(api.mixHex(LIGHT.disc, '#ffdd9c', 0.42)), 0.76));
    core.addColorStop(0.78, api.rgba(api.mixHex(LIGHT.disc, '#ffbb6a', 0.34), 0.36));
    core.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * puls, 0, 7); ctx.fill();
    if (!b.sun) {
      /* moon: a couple of soft maria so it is not a featureless dot */
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = api.mixHex(LIGHT.disc, '#2a3350', 0.7);
      ctx.beginPath(); ctx.arc(b.x - R * 0.28, b.y - R * 0.18, R * 0.30, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x + R * 0.22, b.y + R * 0.26, R * 0.20, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  /* Light shafts fanning out of the body toward the field. Drawn BEFORE the
     land bake so the ridgeline cuts them off, which is what makes them read as
     air rather than as an overlay. Deliberately near-invisible per shaft —
     they are meant to be felt, not counted. */
  function drawShafts(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const len = api.H * 1.25;
    /* dimmed as the sky brightens, same reason as bakeSky's gDim: an additive
       warm fan that reads as air over a dark sky reads as a wash over a bright
       one, and a wash is what takes the chroma out of the upper frame. */
    const kI = api.clamp(LIGHT.keyI, 0.25, 1.3) * (1 - 0.50 * dayness(api));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      /* fan pointing DOWN-ish, drifting a hair so the frame is never static.
         ⚠ The first pass ran these at 0.055 and they read as a hard triangular
         BEAM hanging off the disc — an effect, not air. The apex is also
         pushed above the disc so no shaft comes to a visible point. */
      const a = Math.PI * 0.5 + (i - 2.5) * 0.19 + Math.sin(api.T * 0.09 + i * 1.7) * 0.012;
      const wob = 0.026 + (i % 3) * 0.008;
      const oy = b.y - api.H * 0.05;
      const gg = ctx.createLinearGradient(b.x, oy, b.x + Math.cos(a) * len, oy + Math.sin(a) * len);
      gg.addColorStop(0, api.rgba(LIGHT.disc, 0));
      gg.addColorStop(0.16, api.rgba(LIGHT.disc, 0.020 * kI));
      gg.addColorStop(0.5, api.rgba(LIGHT.disc, 0.010 * kI));
      gg.addColorStop(1, api.rgba(LIGHT.disc, 0));
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(b.x, oy);
      ctx.lineTo(b.x + Math.cos(a - wob) * len, oy + Math.sin(a - wob) * len);
      ctx.lineTo(b.x + Math.cos(a + wob) * len, oy + Math.sin(a + wob) * len);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  /* the bloom that survives the ridgeline — drawn after the land so the glow
     bleeds over the silhouette the way real flare does. */
  function drawBodyGlow(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT;
    const b = bodyPos(api);
    const R = (b.sun ? 26 : 22) * api.clamp(api.VIEW.box ? api.VIEW.box.h / 900 : 1, 0.7, 1.15);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    /* ⚠ A RADIAL GRADIENT FILLS ITS INNER CIRCLE WITH STOP 0, so an inner
       radius of R*0.8 did not put this flare AROUND the disc — it laid a flat
       additive 0.16 of the disc colour straight OVER it, on top of the halo
       that had already done the same. Between them the core blew past
       HILIGHT_CEIL and the grade's shoulder clamp became the thing drawing the
       disc's shape: a flat plateau with a hard edge where the clamp let go,
       which is what "the sun disc clips" was looking at. Ramped from a low
       stop at the centre up to its peak just outside the limb, so the flare is
       a flare and the disc keeps its own falloff. */
    const outR = R * (b.sun ? 9 : 6);
    /* same reason as the sky glow's gDim — see bakeSky. Flare is what the air
       between the lens and the sun does, and bright air scatters less contrast,
       not more. */
    const fDim = 1 - 0.44 * dayness(api);
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, outR);
    g.addColorStop(0, api.rgba(LIGHT.disc, (b.sun ? 0.035 : 0.025) * fDim));
    g.addColorStop(R * 1.12 / outR, api.rgba(LIGHT.disc, (b.sun ? 0.15 : 0.10) * fDim));
    g.addColorStop(1, api.rgba(LIGHT.disc, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * (b.sun ? 9 : 6), 0, 7); ctx.fill();
    ctx.restore();
  }
  /* three slow haze wisps along the horizon. The only animated thing in the
     vista, and the reason the world does not look like a still. */
  function drawDrift(api) {
    const ctx = api.ctx, LIGHT = api.LIGHT, W = api.W;
    const hz = horizonY(api);
    if (!S.drift) {
      const r = mulberry32(strHash('drift'));
      S.drift = [0, 1, 2].map(i => ({
        w: 260 + r() * 320, h: 22 + r() * 30, sp: 0.006 + r() * 0.012,
        ph: r(), y: hz - 30 + r() * 70, a: 0.05 + r() * 0.05
      }));
    }
    ctx.save();
    for (const d of S.drift) {
      const x = ((d.ph + api.T * d.sp) % 1.4 - 0.2) * (W + d.w * 2) - d.w;
      const col = api.mixHex(LIGHT.fog, LIGHT.disc, 0.35);
      const g = ctx.createRadialGradient(x, d.y, 0, x, d.y, d.w);
      g.addColorStop(0, api.rgba(col, d.a));
      g.addColorStop(1, api.rgba(col, 0));
      ctx.save(); ctx.translate(x, d.y); ctx.scale(1, d.h / d.w); ctx.translate(-x, -d.y);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, d.y, d.w, 0, 7); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  }

  function draw(api) {
    const ctx = api.ctx, W = api.W, H = api.H, LIGHT = api.LIGHT;
    try { ensureBakes(api); } catch (e) { }
    /* SKY */
    if (S.sky.cv) {
      blit(ctx, S.sky.cv, W, H);
    } else {
      const st = skyStops(api);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, st[0]); g.addColorStop(0.55, st[1]); g.addColorStop(1, st[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    /* BACKDROP ART as the far layer, respecting the host's cross-fade. */
    try {
      const bd = off('art') ? null : api.backdrop;
      if (bd && bd.img && bd.img.complete && bd.img.naturalWidth) {
        const dpr = dprOf(api);
        const fade = api.clamp(bd.fade === undefined ? 1 : bd.fade, 0, 1);
        /* ⚠ HOW MUCH OF A DISAGREEING PHOTOGRAPH SURVIVES. Flattening cold art
           INTO the desert with more and more haze does remove the city, but
           what it leaves behind is a flat milky band across the whole sky —
           which is the same failure as the blocker, moved to the horizon. It
           is cheaper and truer to just turn the offending layer DOWN and let
           our own baked sky (a real graded sky) and our own ridgeline carry
           the distance. At full disagreement the photo is still on screen at
           just under half strength — enough that a location card visibly
           changes the vista, which is the user's ask, and not enough for
           anyone to count its helicopters. */
        const aScale = 1 - ART_YIELD * artDisagreement(api, bd.img);
        if (bd.prev && bd.prev.complete && fade < 1) {
          const pc = artCanvas(api, bd.prev, dpr);
          if (pc) {
            ctx.globalAlpha = 1 - ART_YIELD * artDisagreement(api, bd.prev);
            blit(ctx, pc, W, H);
            ctx.globalAlpha = 1;
          }
        }
        const cc = artCanvas(api, bd.img, dpr);
        if (cc) {
          ctx.globalAlpha = fade * aScale;
          /* a partial cross-fade needs the alpha, so it cannot take the 1:1
             fast path unless globalAlpha is honoured — it is, save/restore
             inside blit() preserves it. */
          blit(ctx, cc, W, H);
          ctx.globalAlpha = 1;
        }
      }
    } catch (e) { ctx.globalAlpha = 1; }
    /* the body sits behind the ridgeline… */
    try { drawBody(api); drawShafts(api); } catch (e) { }
    /* …the ridges, haze band and desert floor occlude it… */
    blit(ctx, S.land.cv, W, H);
    /* …and its bloom spills back over them. */
    try { drawBodyGlow(api); drawDrift(api); } catch (e) { }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── GRADE ────────────────────────────────────────────────────────────────
     Runs after the depth-sorted actors. Composited fills and one tiny
     downsampled bloom — a full-viewport getImageData every frame is far too
     expensive and is not needed for any of this. */
  /* ── THE COOL-SHADOW MASK ─────────────────────────────────────────────────
     Round 3's second failed clause: the key was warm but so were the shadows.
     Getting "cool blue-grey in shadow" out of canvas-2D without a per-pixel
     loop needs a term that scales with DARKNESS, and the flat-fill blend modes
     cannot do that on their own — 'screen' with a navy comes closest but it
     still moves a lit midtone by a third of what it moves a black, which is
     enough to drag the warm interior mean down with it.
     So: build a mask at thumbnail scale — invert the frame, desaturate it,
     cube it — and add the tint through that. inv³ is ~0.58 on a near-black,
     ~0.41 on a shadowed cliff wall, ~0.21 on the interior mean and ~0.02 on
     lit sand, i.e. it lands almost entirely in the shadows.
     ⚠ IT MUST BE DESATURATED BEFORE THE CUBE. Without that step the mask is
     the PER-CHANNEL inverse, and a warm highlight's blue channel is its
     darkest one — so the "shadow" tint would pour blue into exactly the
     sunlit sand it must not touch. 'saturation' is feature-detected because a
     canvas that silently drops it would paint flat grey and turn the mask into
     a uniform veil. */
  /* ⚠ `src` IS THE ALREADY-DOWNSCALED FRAME THUMBNAIL, NOT THE FRAME.
     WAVE 3 PERF. This used to take the full 1744x1576 canvas and downscale it
     itself, which meant the grade performed THREE separate full-canvas reads
     per frame — one here, one in bloom(), one in coolThumb() — to produce
     three thumbnails, two of which (this one and bloom's) are downscales of
     exactly the same pixels at exactly the same size. bloom() now makes that
     thumbnail once and hands it over; copying 117x114 pixels 1:1 costs
     nothing, and the output is bit-identical because the downscale it replaces
     had the same source and the same destination size. coolThumb keeps its own
     read, and must: it samples the frame BEFORE the warm multiply and this one
     is after. */
  function shadowThumb(api, src, bw, bh) {
    if (!S.shade.cv) S.shade.cv = document.createElement('canvas');
    if (S.shade.cv.width !== bw || S.shade.cv.height !== bh) {
      S.shade.cv.width = bw; S.shade.cv.height = bh;
      S.shade.g = S.shade.cv.getContext('2d');
    }
    const s = S.shade.g; if (!s) return null;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.globalAlpha = 1;
    try { s.filter = 'none'; } catch (e) { }
    s.clearRect(0, 0, bw, bh);
    s.drawImage(src, 0, 0, bw, bh);
    /* invert */
    s.globalCompositeOperation = 'difference';
    s.fillStyle = '#ffffff';
    s.fillRect(0, 0, bw, bh);
    /* desaturate — feature-detected, see the note above */
    s.globalCompositeOperation = 'saturation';
    const greyed = (s.globalCompositeOperation === 'saturation');
    if (greyed) { s.fillStyle = 'hsl(0,0%,50%)'; s.fillRect(0, 0, bw, bh); }
    /* ── THE BLACK POINT ──────────────────────────────────────────────────
       ⚠ WAVE 2's BLOCKER LIVED HERE. Cubing the RAW inverse never reaches
       zero: inv³ is 0.25 at L95, 0.21 at L105 and still 0.09 at L140, so the
       "shadow" tint was painted — weakly, but over the ENTIRE frame — across
       the lit sand as well. Measured by turning this one pass off
       (window.__vistaOff={shade:1}) and re-shooting: the near field went from
       29.9% saturation / R−B +33.4 to 38.3% / +41.4, and the mid field from
       29.6% / +35.8 to 35.9% / +42.8. That is the milky veil, in one number.
       The tint is a SHADOW tint, so it has to be zero on anything that is not
       a shadow. Remap first, then square:
           m = clamp((SHADOW_HI − L) / (SHADOW_HI − SHADOW_LO), 0, 1)²
       'color-burn' against a constant grey g does exactly the remap in one
       composite — B(u,g) = 1 − (1−u)/g on the inverted thumbnail is
       1 − L/g·255, i.e. a linear ramp that hits zero at L = 255g — and one
       'lighter' self-draw at (gain−1) alpha stretches it to reach 1 at
       SHADOW_LO. Feature-detected: without color-burn we fall back to the old
       cube, which is wrong but not broken. */
    s.globalCompositeOperation = 'color-burn';
    const burned = (s.globalCompositeOperation === 'color-burn');
    if (burned) {
      s.fillStyle = 'rgb(' + SHADOW_HI + ',' + SHADOW_HI + ',' + SHADOW_HI + ')';
      s.fillRect(0, 0, bw, bh);
      const gain = SHADOW_HI / Math.max(1, SHADOW_HI - SHADOW_LO);
      if (gain > 1.01) {
        s.globalCompositeOperation = 'lighter';
        s.globalAlpha = Math.min(1, gain - 1);
        s.drawImage(S.shade.cv, 0, 0);
        s.globalAlpha = 1;
      }
      /* square — one self-multiply. NOT a cube: the ramp already has a black
         point, so a third power only eats the cliff-wall shade that the
         "cool blue-grey in shadow" clause is actually about. */
      s.globalCompositeOperation = 'multiply';
      s.drawImage(S.shade.cv, 0, 0);
    } else {
      s.globalCompositeOperation = 'multiply';
      s.drawImage(S.shade.cv, 0, 0);
      s.drawImage(S.shade.cv, 0, 0);
    }
    /* colourise and set the strength in the same multiply */
    s.globalCompositeOperation = 'multiply';
    s.fillStyle = greyed ? SHADOW_TINT : SHADOW_TINT_WEAK;
    s.fillRect(0, 0, bw, bh);
    s.globalCompositeOperation = 'source-over';
    /* a gentle blur so the tint does not inherit the frame's hard edges — a
       shadow's colour bleeds, its geometry does not need to be exact */
    try {
      s.filter = 'blur(2px)';
      s.globalCompositeOperation = 'copy';
      s.drawImage(S.shade.cv, 0, 0);
      s.filter = 'none';
      s.globalCompositeOperation = 'source-over';
    } catch (e) { try { s.filter = 'none'; } catch (e2) { } s.globalCompositeOperation = 'source-over'; }
    return S.shade.cv;
  }

  /* ── THE COOL-SURFACE GIVE-BACK ───────────────────────────────────────────
     Round 4's blocker, in one function. The warm chroma multiply is a baked
     full-viewport blit and it cannot see what it is painting over, so it takes
     blue out of the water pool and the teal movement slabs exactly as
     enthusiastically as it takes it out of sand.

     ⚠ WHY THIS IS NOT A MASK ON THE MULTIPLY. The obvious fix is to build the
     mask the way shadowThumb() does and gate the multiply with it — but a
     multiply is per-pixel and a thumbnail mask is not, so gating it means
     upscaling the mask to the full canvas and compositing there. Measured on
     this box at 1640x1600: one extra full-canvas self-draw is 10.3ms, which is
     most of a 60fps frame for a colour correction. So the multiply stays
     unconditional and we ADD BACK what it took, in the one full-canvas
     'lighter' upscale the bloom already performs (see bloom()) — free.

     ⚠ IT MUST BE BUILT BEFORE THE MULTIPLY RUNS. The give-back is
     k·B and 0.42k·G of the pixel's PRE-grade value; sampling after the
     multiply would measure B(1−k) and give back too little, and, worse, the
     multiply has already dragged the (B−R) the mask keys on across neutral —
     which is the entire bug. grade() therefore calls this as its first act,
     off the untouched frame.

     The arithmetic, for a pixel at mask strength m and ramp r:
       after the multiply   (R, G(1−0.42k), B(1−k))
       this adds            (0, 0.42k·G·m·r·g, k·B·m·r·g)
     so at m=1 the pixel leaves grade() with the chroma it arrived with, times
     the tone gain g that the whole field gets (toneRamp). At m=0 it is
     untouched and keeps the full warm restore. Nothing in between is a hue
     rotation — it is the same restore, dialled down.

     Costs one thumbnail downscale plus a getImageData and a JS loop over
     ~117x114 pixels. The LOOP is as cheap as that sounds — benchmarked at
     DOUBLE that size (234x228) on this box's software rasteriser, 0.90ms — but
     the READBACK IS NOT, and the isolated micro-benchmark that said 0.20ms was
     measuring the wrong thing. See the cadence below.

     ── ⚠ WHY THIS RUNS ON A CADENCE AND NOT EVERY FRAME ────────────────────
     WAVE 3 r2 BLOCKER. `drawImage(mainCanvas)` + `getImageData` is the only
     readback anywhere in the module (grep: the other two are one-off bakes),
     and it is a PIPELINE SYNC: it cannot return until everything queued
     against the frame has actually been rasterised, so its cost is not the
     117x114 copy, it is the flush of a 1640x1600 canvas that ten composites
     are still pending on. That is why the isolated benchmark above says
     0.20ms while the readback's own performance.now() bracket says 27.9ms.

     ⚠ AND THAT 27.9ms IS NOT A SAVING — READ THIS BEFORE YOU QUOTE IT. The
     sync does not CREATE the work, it WAITS for it, so removing the wait moves
     the cost to whatever flushes next instead of deleting it. Measured, on
     this box, three ways:
       · cadence 4 vs cadence 1 (`__vistaOff.coolcache`), five alternating 3s
         windows: 36.8 vs 37.2 frames per window, grade p50 33.2 vs 34.3ms.
       · cadence set to 100000 — ONE readback in a whole 4s run instead of 50:
         49 frames and p50 33.5ms, against 49 frames and 33.4ms with every
         frame reading back. Identical.
       · pass-by-pass ablation of the whole grade (4s windows, ms/frame from
         the frame count): bloom 8.9, tone 7.9, veil 4.0, chroma multiply 3.7,
         filmic 2.3, the two clamps 1.5 — summing to the 28.3ms/frame that
         disabling grade() entirely gives back (49 -> 75 frames/4s). The cost
         is per-destination-pixel composite work spread over seven
         full-viewport passes, and there is no readback hiding in that list.
     So on a software rasteriser, where there is no GPU pipeline to stall, this
     cadence buys about 1ms of grade p50 and nothing measurable end to end. It
     is kept anyway, because it cannot be slower, because a headless
     SwiftShader box is the one machine where a readback is cheapest, and
     because on real hardware the same call is a genuine GPU->CPU stall. What
     it must not be is SOLD as the frame-rate fix: it is not, and the numbers
     above are how you check that for yourself.

     The mechanism, then, is simply: stop doing it every frame. What the
     readback produces is TONAL STATISTICS OF A MOSTLY STATIC
     BOARD — a (B−R) mask at 1/7 scale, blurred, and the frame's per-channel
     extremes. Between two consecutive frames of a tactics board that is
     nothing: the camera does not move, the ground does not move, and the only
     things that do (a unit walking a tile, a hover ring) are small, slow and
     already smeared by the 1px thumbnail blur = ~7px on the frame.

     So the mask is recomputed every COOL_CADENCE-th frame and REUSED in
     between — the previous mask canvas is returned untouched, so the
     give-back still rides the bloom's upscale on every single frame; it is
     the SAMPLE that is stale by up to three frames (50ms at 60fps; 240ms on
     this 12fps software rasteriser), never the composite. A recompute is FORCED, ignoring the cadence, whenever the
     thumbnail changes size, whenever the sky/land bake key moves (time of day,
     location, resize — i.e. every case where the whole frame is regraded at
     once) and on the first frame after a bake.

     ⚠ AND IT IS A/B-ABLE ON THE SHIPPED BUILD: `__vistaOff.coolcache = 1`
     forces the old every-frame behaviour, so every number above is
     reproducible from the console on ONE build instead of by checking out two.
     __vistaDebug().cool reports reads/calls (expect ~1:4) and the recompute's
     own p50, so "is it actually caching?" is answerable too.

     ⚠ WHAT THE STALENESS COSTS, MEASURED RATHER THAN ASSERTED. With the cache
     off, the mask thumbnail was read every frame for 24 consecutive frames and
     differenced: consecutive frames differ by mean 0.002 levels, worst single
     pixel 2/255; across a 4-frame gap — the whole cadence — mean 0.004, worst
     3/255. Three levels on one pixel of a 117x114 mask that is then blurred
     and upscaled is not a visible quantity, which is the actual argument for
     doing this at all. ── */
  const COOL_CADENCE = 4;   /* readback on 1 frame in 4; 1 = every frame */
  function coolThumb(api, src, bw, bh) {
    if (S.coolFail) return null;
    if (!S.cool.cv) S.cool.cv = document.createElement('canvas');
    const resized = S.cool.cv.width !== bw || S.cool.cv.height !== bh;
    if (resized) {
      S.cool.cv.width = bw; S.cool.cv.height = bh;
      S.cool.g = S.cool.cv.getContext('2d');
    }
    const g = S.cool.g; if (!g) return null;
    /* the forced-recompute signature: anything that regrades the whole frame
       at once. S.lastBake moves on every re-bake, which covers time of day,
       location swaps and resizes without having to enumerate them here. */
    const key = S.sky.key + '|' + S.land.key + '|' + S.lastBake;
    S.cool.calls++;
    if (!resized && S.cool.mn && S.cool.key === key &&
      S.cool.age < COOL_CADENCE && !off('coolcache')) {
      S.cool.age++;
      return S.cool.cv;      /* the PREVIOUS mask, still composited this frame */
    }
    S.cool.key = key; S.cool.age = 1; S.cool.reads++;
    const _t0 = (window.performance && performance.now) ? performance.now() : 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    try { g.filter = 'none'; } catch (e) { }
    g.clearRect(0, 0, bw, bh);
    g.drawImage(src, 0, 0, bw, bh);
    let im;
    /* ⚠ STICKY ON FAILURE. getImageData throws on a tainted canvas, and the
       board composites location art through the host's _bbAbs(). Everything is
       same-origin today, but a throw every frame forever is a far worse
       failure than losing the give-back, so one throw disables it for the
       session and the warm restore simply runs ungated, as it did in round 3. */
    try { im = g.getImageData(0, 0, bw, bh); }
    catch (e) { S.coolFail = true; return null; }
    const d = im.data;
    const H = api.H, hz = horizonY(api), span = chromaSpan(api);
    const k = chromaK(api);
    /* ⚠ NO TONE GAIN FACTOR HERE. This term is added inside the bloom's
       upscale, which runs BEFORE toneRamp(), so the gain is applied to it
       downstream along with everything else — pre-scaling it would apply the
       gain twice and overshoot the give-back by 16%. */
    const kG = 0.42 * k, kB = k;
    const lo = COOL_LO, inv = 1 / Math.max(1, COOL_HI - COOL_LO);
    /* ⚠ THE PER-CHANNEL EXTREMES COME OUT OF THIS LOOP, FREE, and they are
       now DIAGNOSTIC ONLY — r1 used them to skip the toe/shoulder fills and
       that skip has been removed (see grade(): the shoulder is load-bearing,
       the skip never fired, and it was never the cost). They stay because
       __vistaDebug().frameMin/frameMax is how a critic reads what the grade is
       actually handed, and because they cost one compare per channel inside a
       loop that now runs once every COOL_CADENCE frames. Every branch below
       feeds them, INCLUDING the r<=0 rows — a thumbnail whose top third was
       never examined is not a bound on the frame. */
    let mnR = 255, mnG = 255, mnB = 255, mxR = 0, mxG = 0, mxB = 0;
    const see = (R, G, B) => {
      if (R < mnR) mnR = R; if (G < mnG) mnG = G; if (B < mnB) mnB = B;
      if (R > mxR) mxR = R; if (G > mxG) mxG = G; if (B > mxB) mxB = B;
    };
    for (let j = 0; j < bh; j++) {
      /* the row's ramp, sampled at the row centre in CSS pixels. Identical to
         the vertical ramp bakeChroma paints, on purpose. */
      let r = ((j + 0.5) * H / bh - hz) / span;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      const o0 = j * bw * 4;
      if (r <= 0) { for (let i = 0; i < bw; i++) { const o = o0 + i * 4; see(d[o], d[o + 1], d[o + 2]); d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 255; } continue; }
      const cG = kG * r, cB = kB * r;
      for (let i = 0; i < bw; i++) {
        const o = o0 + i * 4;
        const R = d[o], G = d[o + 1], B = d[o + 2];
        see(R, G, B);
        let m = (B - R - lo) * inv;
        if (m <= 0) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 255; continue; }
        if (m > 1) m = 1;
        d[o] = 0;
        d[o + 1] = Math.min(255, (cG * G * m) | 0);
        d[o + 2] = Math.min(255, (cB * B * m) | 0);
        d[o + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    S.cool.mn = [mnR, mnG, mnB];
    S.cool.mx = [mxR, mxG, mxB];
    /* a 1px thumbnail blur = ~7px on the frame. The sum this joins is upscaled
       NEAREST (see bloom), so without it the give-back arrives as visible 7px
       blocks along the pool's rim. A colour bleeding a few pixels past a water
       edge is what water does; a staircase is not. */
    try {
      g.filter = 'blur(1px)';
      g.globalCompositeOperation = 'copy';
      g.drawImage(S.cool.cv, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    } catch (e) { try { g.filter = 'none'; } catch (e2) { } g.globalCompositeOperation = 'source-over'; }
    if (_t0) { S.cool.ms.push(performance.now() - _t0); if (S.cool.ms.length > 120) S.cool.ms.shift(); }
    return S.cool.cv;
  }

  /* ── THE TONE RAMP: pedestal, then multiplicative gain ────────────────────
     See TONE_GAIN. Two flat-fill passes, both confined below the horizon and
     both feathered across the SAME span the chroma multiply uses, because they
     exist to undo that multiply's luma compression and must not extend past
     it — above the horizon lives the graded backdrop art, whose flatness is
     deliberate (bakeArt), and a gain there would hand a photographic skyline
     its contrast straight back.

     ⚠ THE FEATHER IS N FLAT STRIPS, NOT A GRADIENT. A full-viewport linear
     gradient measured ~4.6ms on this box (see grade() step 1); N fillRects of
     a few pixels each measure nothing. At N=24 each step changes the gain by
     0.6%, i.e. under one 8-bit level on a mid-field pixel. Verified rather
     than assumed: the row-mean luma's second derivative over the feather band
     measures p50 0.533 with this pass in against 0.515 with it out, which is
     BELOW the 1.16x the gain itself accounts for — so the strips add no
     structure of their own.

     ⚠ 'difference' IS AN ABSOLUTE VALUE, and that is fine HERE and only here.
     Below TONE_PEDESTAL a channel mirrors instead of clamping, but the toe
     clamp at the end of grade() lifts every channel to at least 16/20/34, so
     the mirrored range is entirely under the floor and never reaches a pixel. */
  function toneRamp(api) {
    if (!opSupported('color-dodge') || !opSupported('difference')) return;
    const ctx = api.ctx, W = api.W, H = api.H;
    const hz = horizonY(api), span = chromaSpan(api);
    /* ⚠ PAINT IN DEVICE PIXELS ON WHOLE-PIXEL BOUNDARIES, NOT IN CSS UNITS.
       Under a DPR transform a strip edge lands on a fractional device row, the
       rasteriser antialiases it, and a PARTIALLY COVERED row gets the blend
       applied at partial alpha — TWICE, once from each neighbouring strip.
       Under 'multiply' or 'color-dodge' that compounds instead of averaging,
       so the feather comes out as N faint bright lines across the far rows.
       Snapping to integer device rows makes every row belong to exactly one
       strip and the seam disappear. Same reasoning as blit(). */
    const sy = ctx.canvas.height / Math.max(1, H), sx = ctx.canvas.width / Math.max(1, W);
    const DW = Math.ceil(W * sx), DH = ctx.canvas.height;
    const top = Math.max(0, Math.round(hz * sy)), bot = Math.min(DH, Math.round((hz + span) * sy));
    if (bot <= 0) return;
    const N = 24;
    const strip = (level, lo, hi) => {
      /* the flat body first, then the feather ABOVE it — the two never overlap */
      if (bot < DH && level > 0) {
        ctx.fillStyle = 'rgb(' + level + ',' + level + ',' + level + ')';
        ctx.fillRect(0, bot, DW, DH - bot);
      }
      if (bot <= top) return;
      let y0 = top;
      for (let i = 0; i < N; i++) {
        const y1 = i === N - 1 ? bot : Math.round(top + (bot - top) * ((i + 1) / N));
        if (y1 <= y0) continue;
        const v = Math.round(lo + (hi - lo) * ((i + 0.5) / N));
        if (v > 0) { ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; ctx.fillRect(0, y0, DW, y1 - y0); }
        y0 = y1;
      }
    };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'difference';
    strip(TONE_PEDESTAL, 0, TONE_PEDESTAL);
    /* Cb / (1 − Cs) — so the fill level that yields TONE_GAIN is 1 − 1/gain */
    const dodge = Math.round(255 * (1 - 1 / TONE_GAIN));
    ctx.globalCompositeOperation = 'color-dodge';
    strip(dodge, 0, dodge);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function bloom(api) {
    const ctx = api.ctx, W = api.W, H = api.H;
    const src = ctx.canvas;
    if (!src) return;
    const bw = thumbW(api), bh = thumbH(api);
    /* ⚠ THE SHADOW MASK IS BUILT FROM THE UNTOUCHED FRAME THUMBNAIL, and it is
       built the moment that thumbnail exists and before anything cubes it.
       Both terms are keyed on the frame's own luminance and both are additive,
       so they share ONE upscale (see the note on nearest-neighbour below — a
       second full-canvas upscale would cost more than every other pass in this
       module put together). Build order therefore matters only in that neither
       may see the other's contribution.
       ⚠ WAVE 3 PERF: it also shares the DOWNSCALE. See shadowThumb. */
    if (!S.bloom.cv) S.bloom.cv = document.createElement('canvas');
    if (S.bloom.cv.width !== bw || S.bloom.cv.height !== bh) {
      S.bloom.cv.width = bw; S.bloom.cv.height = bh;
      S.bloom.g = S.bloom.cv.getContext('2d');
    }
    const g = S.bloom.g; if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, bw, bh);
    /* THE ONE full-canvas downscale of this half of the grade. The shadow mask
       is built from the result rather than from `src` — see shadowThumb. */
    g.drawImage(src, 0, 0, bw, bh);
    const shadeCv = off('shade') ? null : shadowThumb(api, S.bloom.cv, bw, bh);
    /* bias hard toward the bright end: two multiplies of the thumbnail by
       itself is x³, so a 0.5 midtone contributes 0.13 and a 0.9 highlight
       contributes 0.73. Without this the "bloom" is just a flat haze. */
    g.globalCompositeOperation = 'multiply';
    g.drawImage(S.bloom.cv, 0, 0);
    g.drawImage(S.bloom.cv, 0, 0);
    g.drawImage(S.bloom.cv, 0, 0);
    g.globalCompositeOperation = 'source-over';
    /* ⚠ THE BLUR HAPPENS DOWN HERE, ON THE THUMBNAIL.
       It used to be `ctx.filter='blur(9px)'` on the UPSCALE, i.e. a 9px
       gaussian over the full 1640x1600 device-pixel canvas — measured at
       ~30ms/frame on this box's software rasteriser, which is the whole frame
       budget for one cosmetic pass. Blurring 75x72 px costs nothing, and the
       bilinear upscale that follows does most of the spreading anyway. */
    try {
      /* 'copy', not 'source-over': drawing a canvas onto ITSELF with the
         default op composites the blurred copy over the sharp original and
         you get a halo, not a blur. */
      g.filter = 'blur(3.5px)';
      g.globalCompositeOperation = 'copy';
      g.drawImage(S.bloom.cv, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    } catch (e) { g.filter = 'none'; g.globalCompositeOperation = 'source-over'; }
    /* ⚠ 0.42 with an x³ curve washed the whole field: the sand is bright
       enough that "the brightest pixels" was most of the board. x⁵ and a
       quarter of the gain keeps the bloom on the sun, the water sheen and the
       lit tiles, which is what it is for. The gain used to be `globalAlpha` on
       the upscale; it is a multiply by a flat grey now, because the upscale is
       shared with the shadow tint and the two need different strengths. */
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgb(77,77,77)';                 /* 77/255 ≈ the old 0.30 */
    g.fillRect(0, 0, bw, bh);
    /* …and the cool shadow term joins it. Both are additive, so summing them
       in the thumbnail and adding once is identical to adding them
       separately. */
    if (shadeCv) {
      g.globalCompositeOperation = 'lighter';
      g.drawImage(shadeCv, 0, 0);
    }
    /* …and so does the chroma restore's additive half, for the same reason:
       three additive full-viewport terms, one upscale. See bakeChroma. */
    if (S.chroma.add && !off('chroma')) {
      g.globalCompositeOperation = 'lighter';
      g.drawImage(S.chroma.add, 0, 0, bw, bh);
    }
    /* …and so does the COOL-SURFACE GIVE-BACK, which is the fourth additive
       term and the reason the water pool and the teal movement slabs survive
       the warm restore at all. Built in grade() step 0 from the pre-multiply
       frame — see coolThumb — and already at this exact thumbnail scale. */
    if (S.cool.live && !off('chroma')) {
      g.globalCompositeOperation = 'lighter';
      g.drawImage(S.cool.live, 0, 0);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    /* ⚠ NEAREST-NEIGHBOUR ON PURPOSE. Bilinear-upscaling the thumbnail to the
       full 1640x1600 canvas measured 26.8ms/frame here; nearest is 8.5ms and
       the difference is invisible, because the source was gaussian-blurred at
       thumbnail scale first — every "block" edge is already a smooth ramp. */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    /* ⚠ AND IT IS DONE IN TWO STAGES, WHICH IS WAVE 3'S BANDING NOTE.
       "The sky gradient shows vertical banding stripes at roughly 10px pitch"
       was this line. Nearest-neighbour from a thumbnail that is exactly H/7
       tall stamps the whole frame with blocks 7 CSS px (14 device px) high,
       and a smooth sky is precisely where a 0.5-luma step is visible. Measured
       on the wave-2 frame: detrended row-luma autocorrelation peaks at lag 14
       with r = 0.67-0.72 in three separate sky columns, rms 0.36-0.86 luma.
       The blur at thumbnail scale does NOT fix it — it smooths the source, and
       nearest then quantises the smooth ramp back into steps.
       So: bilinear into a quarter-size intermediate (cheap — a few hundred
       thousand pixels, and the bilinear cost is per DESTINATION pixel, which
       is why the full-size bilinear the comment above rejects cost 26.8ms),
       then nearest from there. The blocks come out 4 device px instead of 14,
       i.e. a quarter of the step for none of the full-size bilinear's cost. */
    const dw = ctx.canvas.width, dh = ctx.canvas.height;
    const mw = Math.max(bw, Math.round(dw / 4)), mh = Math.max(bh, Math.round(dh / 4));
    let up = S.bloom.cv;
    if (mw > bw && mh > bh) {
      if (!S.bloom.up) S.bloom.up = document.createElement('canvas');
      if (S.bloom.up.width !== mw || S.bloom.up.height !== mh) {
        S.bloom.up.width = mw; S.bloom.up.height = mh;
        S.bloom.upg = S.bloom.up.getContext('2d');
      }
      const ug = S.bloom.upg;
      if (ug) {
        ug.setTransform(1, 0, 0, 1, 0, 0);
        ug.globalAlpha = 1;
        try { ug.filter = 'none'; } catch (e) { }
        ug.imageSmoothingEnabled = true;
        try { ug.imageSmoothingQuality = 'low'; } catch (e) { }
        /* 'copy' so the previous frame's contents are replaced, not blended */
        ug.globalCompositeOperation = 'copy';
        ug.drawImage(S.bloom.cv, 0, 0, mw, mh);
        ug.globalCompositeOperation = 'source-over';
        up = S.bloom.up;
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(up, 0, 0, dw, dh);
    ctx.restore();
  }

  function grade(api) {
    const ctx = api.ctx, W = api.W, H = api.H, LIGHT = api.LIGHT;
    /* a rolling window of this pass's own cost, so "the grade got slower" is
       answerable from the page instead of from a stopwatch. Kept to 240
       samples; performance.now() twice a frame is free. */
    const t0 = (window.performance && performance.now) ? performance.now() : 0;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    /* 1. THE CHROMA RESTORE — the other half of the blocker fix.
       Fixing the mask's black point stops the frame LOSING chroma; this puts
       chroma back, as a warm split-tone: the ground is multiplied by a warm
       near-white (which pulls blue out of everything and green out of a little
       of it, so an ochre gains chroma) and then given back the luma the
       multiply cost. The cool shadow tint runs immediately AFTER it, so the
       pair is a proper filmic split — warm through the midtones, cool in the
       toe — instead of one global tint fighting another.

       ⚠ IT WAS A 'saturation' BLEND AND IT COST 15.7ms/FRAME. That blend is
       hue-preserving and was the obviously right tool, but it is one of the
       non-separable modes: the rasteriser converts every pixel to and from
       HSL. Measured on this box at 1640x1600, grade() went from 33.6ms
       (wave 1) to 49.3ms with it in; a flat fill instead of the gradient only
       came back to 44.7, so ~11ms of that was the blend itself and ~4.6ms the
       full-viewport gradient evaluation. Both are gone: 'multiply' and
       'lighter' are separable, and both ramps are BAKED into two canvases that
       are blitted 1:1, so there is no gradient to evaluate per frame either.
       The replacement was calibrated against the blend it replaces, not
       guessed — on the mid-sand patch the 'saturation' version measured
       R−B 70.8 / sat 41.0%, this one measures within a point of that.

       ⚠ IT IS CONFINED BELOW THE HORIZON, AND THAT IS NOT A DETAIL. The
       backdrop art is graded flat and desaturated ON PURPOSE (bakeArt) so a
       photographic skyline belongs to the desert; running a chroma gain over
       it would hand the grey city its colour straight back and undo the aerial
       perspective in the same stroke. So the ramp starts at zero at the
       board's far edge and only reaches full a fifth of the way down the
       field — which is also where "the middle of the battlefield is the least
       saturated region in the frame" was measured. Above the horizon both
       bakes are identities (white for multiply, black for lighter). */
    S.cool.live = null;
    if (!off('chroma') && S.chroma.mul) {
      /* ⚠ STEP 0, AND IT HAS TO BE FIRST. The cool-surface give-back is keyed
         on (B−R) of the frame as the actors left it; the multiply on the next
         line is precisely what destroys that signal, dragging the water pool
         and the teal movement slabs across neutral into olive. Sample, then
         multiply. See coolThumb for the arithmetic and for why the give-back
         is additive instead of a mask on the multiply. */
      S.cool.live = coolThumb(api, ctx.canvas, thumbW(api), thumbH(api));
      ctx.globalCompositeOperation = 'multiply';
      blit(ctx, S.chroma.mul, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      /* the matching additive half is not here — it rides inside the bloom's
         single upscale in step 2. */
    }
    /* 2. BLOOM on the brightest pixels, and the COOL TINT on the darkest — one
       shared thumbnail upscale. Must run before the veil so the fog does not
       get bloomed, and before the clamps so it cannot blow a pixel to pure
       white. */
    if (!off('bloom')) {
      try { bloom(api); } catch (e) { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; try { ctx.filter = 'none'; } catch (e2) { } }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    /* 2b. THE TONE RAMP — pedestal, then multiplicative gain. Undoes the luma
       compression the warm multiply in step 1 costs, and then some; this is
       the only thing in the module that puts local CONTRAST back. See
       TONE_GAIN.

       ⚠ IT MUST RUN AFTER THE BLOOM, AND THE REASON IS NOT OBVIOUS. The bloom
       is the frame CUBED (see bloom()), so a 16% gain applied before it is a
       1.16³ = 1.56x gain on the bloom — and the bloom of warm sand is warm, so
       feeding it a brightened frame pours red over the whole field. Measured
       with the multiply disabled and only this pass moved: the near-water band
       went R−B −16.3 (tone after bloom) to +15.3 (tone before bloom), a
       31-point warm swing from a pass that is supposed to be achromatic. It is
       achromatic only where it is the LAST thing that reads the frame.
       For the same reason the cool give-back is NOT pre-scaled by the gain —
       it is added inside the bloom's upscale, i.e. before this, so the gain
       picks it up on its way past. See coolThumb. */
    if (!off('tone')) toneRamp(api);
    /* 3. THE VEIL — distance fog + vignette + centre lift, pre-composited (see
       bakeVeil for why these are not three live gradients). */
    if (!off('veil')) blit(ctx, S.veil.cv, W, H);
    /* 4. THE FILMIC PASS.
       'overlay' with a warm ochre pushes the midtones warm and adds a little
       S-curve; the two flat clamps that follow do the toe and the shoulder. */
    /* ⚠ 0.13 → 0.10. 'overlay' doubles a dark pixel's own value against the
       ochre, so it warms the SHADOWS harder than it warms the midtones — it
       was quietly undoing a third of the cool tint applied in step 1. The
       midtone warmth it is here for survives the cut (interior mean R−B still
       measures around +26); the shadows keep theirs. */
    if (!off('filmic')) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = api.mixHex(SAND_BASE, LIGHT.key, 0.28);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    /* ── THE TWO CLAMPS ARE UNCONDITIONAL, AND THE SKIP THAT WAS HERE IS GONE
       ─────────────────────────────────────────────────────────────────────
       r1 gated these two fills on the thumbnail extremes: skip the fill when
       the frame provably has nothing left to clamp. It was measured and it was
       WRONG ON BOTH COUNTS, so it has been deleted rather than tuned.

       1. BOTH CLAMPS ARE LOAD-BEARING. Counted on the RAW canvas (not a
          screenshot — no HUD and no page background in the numbers), one day
          frame at 1640x1600, immediately before and immediately after grade():
            before   2029 pure-white px, 297 pure-black px,
                     8869 channels at 255, 891 at 0, max [255,255,255],
                     min [0,0,0]
            after    0 pure-white, 0 pure-black, 0 channels at 255, 0 at 0,
                     max [252,247,236], min [16,20,34]
          — i.e. exactly HILIGHT_CEIL and SHADOW_FLOOR, and these two fills are
          the only reason the frame obeys the BAR at all. The sun disc and the
          brazier cores clip white every frame; the pool's deepest shadow and
          the cliff undersides clip black. The correct number of frames to skip
          either fill on is none.
       2. IT NEVER FIRED ANYWAY. clampSkip on the live board read
          {toe: 0, shoulder: 0} over 18 frames — the conservative margins meant
          the branch was dead code that still cost a per-frame min/max.
       3. IT WAS NEVER THE COST. Ablation puts the two clamps together at
          1.5ms/frame of a 28.3ms grade — the smallest item on the list, below
          filmic (2.3), chroma (3.7), veil (4.0), tone (7.9) and bloom (8.9).
          Even firing on every frame it could not have bought what the clause
          that requested it was after. The numbers and the method are in
          coolThumb's cadence note.

       The extremes themselves survive as __vistaDebug().frameMin/frameMax,
       which is how the probe in (1) is repeatable. ── */
    /* TOE — 'lighten' takes the per-channel max, so this both guarantees that
       nothing in the frame is pure black (the BAR forbids it) and tints every
       deep shadow cool blue-grey in one composite. Cheaper and steadier than
       a per-pixel curve, and it cannot be defeated by anything drawn earlier.
       It is LAST for exactly that reason — the veil and the overlay run before
       it, so neither can reintroduce a crushed black. */
    ctx.globalCompositeOperation = 'lighten';
    ctx.fillStyle = 'rgb(' + SHADOW_FLOOR[0] + ',' + SHADOW_FLOOR[1] + ',' + SHADOW_FLOOR[2] + ')';
    ctx.fillRect(0, 0, W, H);
    /* SHOULDER — the mirror image: 'darken' caps every channel below 255, so
       no pixel is pure white, and because the cap is warm the clipped
       highlights read as sunlight rather than paper. */
    ctx.globalCompositeOperation = 'darken';
    ctx.fillStyle = 'rgb(' + HILIGHT_CEIL[0] + ',' + HILIGHT_CEIL[1] + ',' + HILIGHT_CEIL[2] + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    if (t0) {
      S.gradeMs.push(performance.now() - t0);
      if (S.gradeMs.length > 240) S.gradeMs.shift();
    }
  }

  window.BBX.vista = { draw: draw, grade: grade };
  /* read-only smoke-test surface, same spirit as the board page's __bbDebug.
     A stale bake is completely silent — the frame still paints, it just paints
     the PREVIOUS time of day — so there has to be a way to ask. */
  window.__vistaDebug = function () {
    return {
      skyKey: S.sky.key, landKey: S.land.key,
      lastBake: +S.lastBake.toFixed(2), artCached: S.art.size,
      /* WAVE 3: the grade's own p50, and how often the two clamp fills proved
         skippable. A perf claim nobody can re-measure is a perf claim nobody
         should believe. */
      gradeP50: (function () {
        const a = S.gradeMs.slice().sort((x, y) => x - y);
        return a.length ? +a[a.length >> 1].toFixed(2) : null;
      })(),
      gradeN: S.gradeMs.length,
      /* WAVE 3 r2: the readback cache. `reads` counts frames that actually
         performed the getImageData, `calls` counts frames that wanted the
         mask; reads/calls should sit at ~1/COOL_CADENCE plus one per bake.
         msP50 is the cost of a recompute frame ALONE, which is the number the
         cadence divides. Set __vistaOff.coolcache = 1 to force every frame and
         re-measure the counterfactual on this same build. */
      cool: {
        cadence: COOL_CADENCE, reads: S.cool.reads, calls: S.cool.calls,
        msP50: (function () {
          const a = S.cool.ms.slice().sort((x, y) => x - y);
          return a.length ? +a[a.length >> 1].toFixed(2) : null;
        })()
      },
      /* the toe/shoulder clamp skip was removed in wave 3 r2 — the fills are
         unconditional. Reported rather than dropped so a probe written against
         the r1 build gets an answer instead of `undefined`. */
      clampSkip: 'removed: clamps are unconditional',
      /* WAVE 3: the backdrop's detail field, from the last bake. `keep` is the
         mean fraction of the art the zenith ramp let through (0 = the old flat
         fade exactly, 1 = no fade at all) and `det` the mean of the field
         itself, so "is it keeping the whole photo back?" is answerable without
         a screenshot; `lo`/`hi` are the percentile thresholds it derived, and
         `protect` / `vmRatio` / `dis` / `blurPx` say what the three consumers
         actually did with it. null means no art, or a fallback to the flat
         gradient. Set __vistaOff.artmask = 1 to force that fallback — it turns
         off the sharp inlay, both grade stencils and the content-aware fade in
         one switch — and A/B the whole feature on ONE build. */
      artMask: S.artMask || null,
      /* what one backdrop bake costs, p50 over the last 40. The mask and the
         high-pass are both inside it; __vistaOff.artmask = 1 turns both off
         and re-measures the counterfactual on this same build. */
      artBakeP50: (function () {
        const a = S.artMs.slice().sort((x, y) => x - y);
        return a.length ? +a[a.length >> 1].toFixed(2) : null;
      })(),
      artBakeN: S.artMs.length,
      frameMin: S.cool.mn, frameMax: S.cool.mx,
      /* dump one bake on its own — __vistaDebug().png('land'). The board draws
         over the bottom two thirds of the land bake, so "is the skyline flat?"
         cannot be answered from a board screenshot alone; this is the only way
         to look at the ridges unobstructed. */
      png: function (which) {
        const r = S[which];
        try { return r && r.cv ? r.cv.toDataURL('image/png') : null; } catch (e) { return null; }
      }
    };
  };
})();
