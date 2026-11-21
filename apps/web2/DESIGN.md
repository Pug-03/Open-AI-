---
name: Walk We
description: Walking routes drawn as an architect's shadow study, shadier by day and safer (based on available data) by night.
colors:
  navy-950: "#071528"
  navy-900: "#0b1f3a"
  navy-800: "#10294b"
  navy-700: "#17355e"
  blue-700: "#1e4fa8"
  blue-500: "#3b82f6"
  sky-300: "#7cc4f5"
  sky-100: "#d6e8fb"
  sky-50: "#eef6ff"
  white: "#ffffff"
  amber-500: "#f5a524"
  amber-700: "#8a5200"
  sun-line-day: "#d98200"
  sun-text-night: "#ffc861"
  red-500: "#e5484d"
  red-700: "#b4232a"
  surface-2-day: "#e2eefc"
  text-dim-day: "#3a4f72"
  text-dim-night: "#a9c1e4"
  plan-ground-day: "#e6f0fd"
  plan-ground-night: "#0d2442"
  plan-building-night: "#12305a"
  hairline-day: "rgb(11 31 58 / 0.24)"
  hairline-night: "rgb(214 232 251 / 0.26)"
  low-line-night: "rgb(214 232 251 / 0.75)"
typography:
  display:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2rem, 5.2vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.75rem, 3.2vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.012em"
  page-title:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.35
  subtitle:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'Sarabun', 'Bai Jamjuree', 'Noto Sans Thai', system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.65
  lettering:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.6
  label:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.55
  note:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.45
  tick:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
  figure:
    fontFamily: "'Bai Jamjuree', 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
rounded:
  corner: "16px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "48px"
  "12": "72px"
  tap: "48px"
  control: "56px"
components:
  button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.corner}"
    padding: "12px 24px"
    height: "56px"
  button-hover:
    backgroundColor: "{colors.surface-2-day}"
  button-primary:
    backgroundColor: "{colors.blue-700}"
    textColor: "{colors.white}"
    typography: "{typography.subtitle}"
    rounded: "{rounded.corner}"
    padding: "12px 24px"
    height: "56px"
  button-primary-night:
    backgroundColor: "{colors.sky-300}"
    textColor: "{colors.navy-950}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.corner}"
    padding: "12px 24px"
    height: "56px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.blue-700}"
    padding: "8px 16px"
    height: "48px"
  icon-button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.corner}"
    size: "48px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.navy-900}"
    padding: "0 16px"
    height: "48px"
  segmented-option-pressed:
    backgroundColor: "{colors.blue-700}"
    textColor: "{colors.white}"
  chip:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    typography: "{typography.label}"
    rounded: "{rounded.corner}"
    padding: "4px 12px"
    height: "40px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.corner}"
    padding: "8px 16px"
    height: "56px"
  route-option:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy-900}"
    rounded: "{rounded.corner}"
    padding: "12px 16px"
  toast:
    backgroundColor: "{colors.navy-900}"
    textColor: "{colors.sky-50}"
    rounded: "{rounded.corner}"
    padding: "12px 16px"
  sos-button:
    backgroundColor: "{colors.red-700}"
    textColor: "{colors.white}"
    rounded: "{rounded.corner}"
    size: "56px"
---

# Design System: Walk We

## Overview

**Creative North Star: "The Shadow Study Sheet"**

Walk We is drawn, not decorated. Every screen is a sheet from an architect's shadow study of Siam: real building footprints as white shapes with hairline ink outlines, the shadows the engine computes laid on the ground as flat navy tint, the route as a plotted line. Around the drawing sit the things a drawing set carries: a title block, schedules (tables), dimension rows with figures and units, a legend of line keys, a north arrow, a scale bar, a ruler of the day.

The sheet has two states and the sun picks between them. By day it is pale blue drafting paper with navy ink, built to read in direct sunlight. After sunset the same sheet turns to navy with pale ink so it does not blind. The theme is one attribute (`data-theme="day" | "night"`) set on the root from sun time (with a manual override) and it can also be set on any subtree: the welcome page's stage flips itself as the time bar crosses sunset, the night section and the sponsor band are always night, and a navigation step plan follows the walk's mode. Components use semantic names only (`--bg`, `--surface`, `--ink`, `--paper`, `--rule`, `--accent`, `--shade-line`, `--low-line`), so every rule holds on both sheets.

Surfaces are flat and square. Structure comes from rules, not boxes with shadows: 1 px hairlines divide, 2 px frame rules close a title row or frame the block that matters. Motion is plotted: things are drawn along their length or wiped in along the reading direction, never floated or bounced.

**Key Characteristics:**
- Two sheets, one system: pale blue paper with navy ink by day, navy with pale ink by night, switched by the sun and scopeable to a subtree.
- Ruled, not carded: lists and tables are separated by hairlines; frames are reserved for the title block, the selected route and the panel floating on the map.
- Colour is a legend: blue is shade and the action, amber is the sun, red is SOS, everything else is ink on paper.
- Line style carries meaning as well as colour: solid for the good stretch, dashed for the other, a square for the destination and a dot for the start.
- Square corners (2 px), 48 px minimum targets, 56 px primary controls, figures in tabular numerals with their unit.
- Motion is plotted: clip-path wipes, rules drawn from the left, bars rising from the axis, routes drawn along their length.

## Colors

A navy-and-sky drafting palette with two signal colours that each mean exactly one thing.

### Primary
- **Shade Blue** (`blue-700`, #1e4fa8): on the day sheet, the shadier route line, primary buttons, pressed segments, links, the selected route's title and the best bar in the chart (`--primary-bg`, `--accent`, `--shade-line`).
- **Night Sky Blue** (`sky-300`, #7cc4f5): takes every Shade Blue role on the night sheet, with Deepest Navy (`navy-950`) text on it. Also the second stroke of the logo and the CCTV point key.
- **Focus Blue** (`blue-500`, #3b82f6): the 3 px focus outline on the day sheet only (night focus is Night Sky Blue).

### Secondary
- **Sun Amber** (`amber-500`, #f5a524): the sun itself: the logo's sun point, the sun disc beside the north arrow, the diagram's sun, lamps on the night plan, and sunlit route stretches on the night-blended canvas.
- **Sunlit Line** (`sun-line-day`, #d98200): the darker amber that sunlit route stretches and sun rays take on pale paper, where Sun Amber would be too faint.
- **Amber Ink** (`amber-700`, #8a5200 by day; `sun-text-night`, #ffc861 by night): amber when it has to be read as text or an icon, e.g. the sun icon in the day chip and the walker standing in the sun.

### Tertiary
- **SOS Red** (`red-500`, #e5484d): the brand's SOS colour.
- **SOS Ground** (`red-700`, #b4232a): the red that actually carries white text (white on `red-500` is 3.9:1): the SOS button, its hint and the full-screen SOS overlay.

### Neutral
- **Drafting Paper** (`sky-50`, #eef6ff): day background and paper; night ink, headings and rules.
- **Sheet White** (`white`, #ffffff): day surfaces (panels, fields, tables) and building footprints.
- **Tinted Paper** (`surface-2-day`, #e2eefc): day hover and pressed fills, skeleton rows, notices.
- **Plan Ground** (`plan-ground-day`, #e6f0fd; `plan-ground-night`, #0d2442): the ground of the plan drawing and the map, a step off the page background so footprints sit on it.
- **Navy Ink** (`navy-900`, #0b1f3a): day text, headings, rules and shadow tint; night background.
- **Night Surface** (`navy-800`, #10294b) and **Night Raised** (`navy-700`, #17355e): night panels and their hover fill. Night footprints use `plan-building-night` (#12305a). Both themes use the same Walk We mark from `public/icon.svg`.
- **Deepest Navy** (`navy-950`, #071528): text on Night Sky Blue, the night half of the time ruler, the route casing on the night map.
- **Dim Ink** (`text-dim-day`, #3a4f72; `text-dim-night`, #a9c1e4): secondary text, column heads, axis ticks.
- **Hairline** (`hairline-day`, `hairline-night`): the translucent ink of 1 px dividers and quiet borders. Frame rules and strong borders use full ink instead.
- **Pale Dash** (`low-line-night`): the dashed stretch of a night route that scores lower.

### Named Rules
**The Sun Owns Amber Rule.** Amber means the sun, a sunlit stretch, or a lamp. It is never a warning, a highlight or a brand accent. On a night route the lower-scoring stretch is dashed ink (`--low-line`: dim navy on the day sheet, pale on the night sheet), not amber, because nothing is sunlit at night. The colour follows the route's mode, not the page theme.

**The Red Is SOS Rule.** Red appears on the SOS button, its hint and the SOS overlay, and nowhere else. Form errors are heavy ink with a 3 px ink border on the field; cautions are a framed ink notice.

**The Two Keys Rule.** Anything colour distinguishes, shape or line style distinguishes too: good stretch solid and the other dashed, shortest route a thin dashed ink line, start a dot and destination a square, stairs a dashed tag.

**The Sunlight Contrast Rule.** Key text (body, headings, primary buttons) is at least 7:1 and secondary text at least 4.5:1 on both sheets; `tokens.test.ts` checks every pair, so a new semantic colour is added there too.

## Typography

**Display Font:** Bai Jamjuree (with Noto Sans Thai, system-ui)
**Body Font:** Sarabun (with Bai Jamjuree, Noto Sans Thai, system-ui)
**Label/Mono Font:** Bai Jamjuree; no monospace. Figures use its tabular numerals.

**Character:** Bai Jamjuree is the lettering on the drawing: squared, technical, at home in Thai and Latin, used for titles, labels, controls and every figure. Sarabun is the specification text beside the drawing: a calm reading face for sentences. Faces loaded are Bai Jamjuree 500/600/700 and Sarabun 400/600, so unweighted lettering renders at 500.

### Hierarchy
- **Display** (700, clamp(2rem, 5.2vw, 4rem), 1.15, -0.02em): the welcome page's closing line. One per page.
- **Headline** (700, clamp(1.75rem, 3.2vw, 2.75rem), 1.2, -0.012em): welcome section headings, each closed by a 2 px rule that draws from the left. The title block's heading is the same voice at clamp(1.5rem, 6.4vw, 2.5rem), 1.22.
- **Page title** (700, 1.875rem, 1.3, -0.01em): the one heading of a setup or form page; the planner's "where to?" title is 1.625rem.
- **Title** (700, 1.375rem, 1.35) and **Subtitle** (600, 1.0625rem, 1.5): page-head titles and headings inside a panel; Subtitle is also the button label size.
- **Body** (Sarabun 400, 1.0625rem, 1.6 to 1.7; 1.125rem at 1.75 in welcome paragraphs): running sentences, capped at 56 to 62ch.
- **Lettering** (Bai Jamjuree 500, 1rem, 1.6): the default for interface text, list rows and values.
- **Label** (600, 0.875rem): group headings in the planner, chips, legends, table cells; **Note** (0.8125rem) for hints and column heads; **Tick** (600, 0.75rem) for axis ticks and ruler hours only.
- **Figure** (700, tabular numerals, -0.01em; 1.5rem on a route, 2rem to 3rem for the stage clock): a number with its unit set after it at 0.6em and weight 600, as written on a drawing: 12 นาที, 900 ม.

### Named Rules
**The Lettering and Text Rule.** Bai Jamjuree letters the drawing (titles, labels, controls, figures). Sarabun is for sentences only, and never below 1.0625rem: if a line is too small for that, it is a label and belongs to Bai Jamjuree.

**The Rem Rule.** Type is sized in rem on a 100% root so system text scaling grows the interface; the "larger text" setting is a single step on the root (118.75%). Inputs never go below 16 px.

**The Plain Case Rule.** No uppercase styling and no tracked-out labels. Tracking is only ever slightly negative on large headings and figures; the one positive value is the three letters on the SOS button (0.04em).

## Layout

Phone first, one hand. The app is a full-bleed plan (map or canvas) with a bottom sheet rising from the thumb zone; information and SOS sit at the top, actions at the bottom, and the main action is pinned to the sheet's foot. Form and reading pages are a single 560 px column under a title row closed by a frame rule.

From 960 px the sheet becomes a 440 px framed panel on the left of the map, 24 px in from the edges, with the mode label and SOS sharing its top line; info pages hold their title block in a left column while content runs on the right. From 600 px dialogs centre and take a full frame, and form groups become framed panels.

The welcome page is laid out like a drawing set. Its first screen is one held drawing (a sticky full-viewport stage in a 430vh scene) with the title block bottom-left, the route schedule top-right, the north arrow and sun bearing top-left, a scale bar, and the time ruler along the bottom edge. Below it, sections sit in a 1240 px measure as a text column beside a figure column (5fr / 7fr), separated by hairlines, with the text column held in view while its figure scrolls.

Spacing is a 4 px scale (4, 8, 12, 16, 20, 24, 32, 48, 72): 12 to 16 inside controls, 20 for sheet and page gutters, 24 to 32 between groups, 72 (128 on desktop) for welcome section padding. Touch targets are at least 48 px and primary controls 56 px tall; safe-area insets are added to every edge gutter.

### Named Rules
**The Thumb Zone Rule.** Primary actions live at the bottom of the screen and stay on screen (sticky dock, bottom-anchored dialogs). The top edge is for reading and for SOS.

## Elevation & Depth

Flat by default. Depth on a sheet is drawn with rules and tonal steps (paper, plan ground, white surface, tinted paper), not shadows. A soft shadow appears only where a surface physically floats over the live plan, so it can be told from the drawing beneath it.

### Shadow Vocabulary
- **Sheet lift** (`--shadow-sheet`; day `0 -8px 28px -12px rgb(11 31 58 / 0.3)`, night `0 -8px 28px -12px rgb(0 0 0 / 0.7)`): the bottom sheet over the map.
- **Floating panel** (`--shadow-2`; day `0 10px 28px -12px rgb(11 31 58 / 0.35)`, night `0 10px 28px -12px rgb(0 0 0 / 0.7)`): the desktop side panel, the toast and the SOS button.
- **Selection inset** (`inset 0 0 0 1px` in rule ink): doubles the border of the selected route to a 2 px frame without moving the layout.

### Named Rules
**The Floating Only Rule.** A shadow means "this is above the map". Anything that sits on the page (panels, tables, fields, the title block) is flat with a hairline or a frame rule.

## Shapes

A drawing has corners. Every radius is 2 px, just enough to take the edge off on screen; inner cells of a compound control (segments, table rows, the from/to rows) are fully square inside their shared frame. There are no pills and no circles as containers.

Lines come in two weights: a 1 px hairline (`--hair`) for dividers, quiet borders and table rows, and a 2 px frame rule (`--frame`) for the edge that matters: the top of the sheet and of dialogs, the rule under a page title, the title block, the chart's axis, the walk summary. Strong controls take a 1 px border in full ink; quiet ones take the translucent hairline. A dashed border means "not there yet" or "the other kind": an empty slot to add, a route with stairs, a development note.

Round shapes are reserved for points on the plan: the start dot, the sun, lamps, the walker's position. The destination is a square. The logo is a W in two mitred 6-unit strokes on a 2 px-cornered navy tile, one stroke ink and one shade blue, with the amber sun point above.

## Components

### Buttons
Solid, square and tall; a button is a labelled cell, not a pill.
- **Shape:** 2 px corners, 56 px minimum height, full width by default, 1 px ink border, Subtitle lettering (600, 1.0625rem), padding 12px 24px.
- **Primary:** Shade Blue ground with white text by day, Night Sky Blue with Deepest Navy text by night; border in the same colour. Hover mixes 14% ink into the ground.
- **Default and Ghost:** surface ground (or transparent for ghost) with ink text and ink border; hover fills with tinted paper or the soft accent wash.
- **Text button:** underlined accent text, 48 px tall, no border.
- **Add:** dashed dim-ink border on a transparent ground for an optional slot.
- **States:** press moves the button down 1 px; disabled is 45% opacity; focus is a 3 px focus-blue outline offset 2 px. A forward action carries a drawn arrow that slides 4 px along its line on hover.
- **Icon button:** 48 px square, hairline border, surface ground; a bare variant drops border and ground for back and close.

### Segmented control
One ink frame with square cells divided by ink hairlines; the pressed cell is the primary ground. Used for time, mode and theme, and as the TH / EN switch on the welcome strip (pressed cell in ink on paper).

### Chips
- **Style:** a label lettered on the drawing: surface ground, 1 px ink border, 2 px corners, 40 px tall, Label type with a 16 to 18 px line icon. Used for the mode, offline state and distance to the step.
- **Tags:** the accessibility tag on a route is an outlined accent tag; with stairs it turns to dashed ink.

### Cards / Containers
- **Rows, not cards:** lists are ruled lines (56 px rows separated by hairlines). Do not wrap list items in cards.
- **Route option:** the one card-like object: hairline border, surface ground, padding 12px 16px; kind as a small bold title, then time, distance and score on a dimension row with a 4 px meter beneath that plots from the left. Selected: ink border doubled by the selection inset, title in accent.
- **Title block / schedule:** a 2 px ink frame around rows divided by hairlines, each row a dim label over a bold value. Used for the welcome title block and footer, the route readout table, the walk summary.
- **Bottom sheet:** surface ground, 2 px ink rule on top, sheet lift shadow, a 40 by 3 px grip inside a 48 px handle. Dialogs are the same object anchored to the bottom, centred and fully framed from 600 px.
- **Notice:** tinted paper with a 1 px ink border and an ink icon; this is how cautions and the "safer is not a guarantee" note are shown.
- **Toast:** inverted, ink ground with paper text, floating panel shadow.

### Inputs / Fields
- **Style:** 56 px tall, surface ground, 1 px ink border, 2 px corners, text at least 16 px; the search field carries its icon inside on the left and a 48 px clear or voice button on the right.
- **Focus:** 3 px focus outline with no offset.
- **Error:** the border thickens to 3 px ink and the message is bold ink. Never red, never amber.
- **Switch:** a 48 by 28 px square frame with a 20 px square block that slides right and turns the frame primary when on.

### Navigation
The welcome page has a fixed 64 px top strip on the page ground with a hairline beneath: mark and wordmark, section links from 960 px (dim, 600 weight, a 2 px rule drawing in from the left on hover and focus), the TH / EN switch and a compact primary Start. The strip takes the night sheet while the stage beneath it is in night. App pages have no global navigation: a title row with a bare back button, the title and the language toggle, closed by a frame rule. Page changes slide 16 px along the reading line with a cross-fade (220 ms), forward to the left and back to the right.

### Legend keys
Small swatches that say what a line on the drawing means, used in legends, readouts and captions: a solid 18 by 5 px bar for the shaded or safer stretch, an amber bar for the sunlit stretch, a 3 px dashed pale line for the night lower-scoring stretch, a 2 px dashed ink line for the shortest route, a 2 px ink tick, a 7 px square for a camera. Every drawing that uses a line style shows its key.

### Plan drawing
The signature surface (canvas on the welcome page and in step plans, the repainted MapLibre map in the planner). Ground in plan-ground, footprints in white (night: `plan-building-night`) with hairline ink outlines, shadows as flat ink tint, roads and decks as faint ink and blue washes. The chosen route is a 5 px line with a paper halo, solid shade blue where it is shaded or safer and dashed where it is not; the shortest route is a thin dashed ink line. Labels are ink with a paper halo. The canvas blends its day and night colour tables continuously as the time is dragged, and routes are plotted along their length.

### Best time chart
Thirteen hourly bars on a 2 px ink axis with a hairline at half height: bars in a 42% accent wash, the best hour in full accent with its hour label in bold ink, the shortest route's value as a 2 px ink tick across the column, hours without a value hatched at 135 degrees. Bars rise from the axis as each hour is computed.

### SOS
A 56 px square in SOS Ground with a 2 px white border and floating shadow, fixed top-right above everything but its own overlay. Holding it draws a white wash across the button from the left; the countdown is a flat red full screen with a white ring draining around a very large figure (clamp(7rem, 34vw, 10.5rem)) and a white Cancel at least 76 px tall at the foot.

### Motion
- **Plotted in:** content wipes in with `clip-path` along the reading direction (500 to 800 ms welcome, 600 ms summary rows), staggered 60 to 120 ms per row. Rules and meters draw with `scaleX` from the left (300 ms in the app, 900 ms on the welcome page); chart bars rise with `scaleY` from the axis (600 ms). Easing is `--ease-plot` (cubic-bezier(0.65, 0, 0.2, 1)).
- **Scroll-driven drawing:** on the welcome page the scroll (or a drag on the time ruler) is the clock. Shadows, routes and the day-to-night blend are redrawn per animation frame and eased toward the target rather than jumping.
- **State changes:** 120 ms for press and hover, 220 ms for toggles and page transitions, 300 ms for theme colour changes, on `--ease-out` (cubic-bezier(0.16, 1, 0.3, 1)). App screens stay at or under 300 ms apart from the arrival summary's plotted rows and meter and the slow opacity pulse of loading skeletons.
- **Reduced motion:** wipes, rules and bars appear in their final state, entrances and view transitions are removed, and remaining transitions collapse to 1 ms.

## Do's and Don'ts

### Do:
- **Do** build with the semantic tokens (`--bg`, `--surface`, `--text`, `--ink`, `--paper`, `--rule`, `--border`, `--accent`, `--primary-bg`, `--shade-line`, `--low-line`) so a surface works on both sheets and inside a scoped `data-theme` subtree.
- **Do** keep every corner at 2 px, dividers at 1 px and the frames that matter at 2 px.
- **Do** separate list rows and table rows with hairlines, and close a page title with a frame rule.
- **Do** set figures in Bai Jamjuree 700 with tabular numerals and the unit after them at 0.6em.
- **Do** pair every colour distinction with a second key (solid or dashed, dot or square) and show the legend key next to the drawing.
- **Do** keep targets at least 48 px, primary controls 56 px, and the main action at the bottom of the screen.
- **Do** bring content in by plotting it: a wipe along the reading direction, a rule from the left, a bar from the axis, each with a reduced-motion final state.
- **Do** mirror any change to the plan colours in all three places that draw them: the `--plan-*` tokens, the canvas colour tables and the map repaint.

### Don't:
- **Don't** use amber for warnings, emphasis or night route stretches. Amber is the sun, a sunlit stretch or a lamp.
- **Don't** use red for errors, deletions or alerts. Red is SOS only.
- **Don't** round corners beyond 2 px or make pill buttons, pill chips or circular containers. Round is for points on the plan.
- **Don't** put shadows on anything that does not float above the map.
- **Don't** wrap list items in cards. A list is ruled lines.
- **Don't** set Sarabun below 1.0625rem, or use it for labels, buttons or figures.
- **Don't** use uppercase or letter-spaced label styling.
- **Don't** bounce or spring anything: no overshoot easing, no elastic settle.
- **Don't** hard-code a day or night colour in a component. If a value is missing, add a semantic token to both sheets and to the contrast test.
