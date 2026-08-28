# Patch-notes builder

Turns a patch-notes markdown file into the standalone HTML page we publish.

    node tools/patchnotes/render.mjs   docs/<notes>.md  /tmp/article.html /tmp/toc.json
    node tools/patchnotes/assemble.mjs /tmp/article.html /tmp/toc.json docs/<notes>.md docs/<notes>.html

The markdown is the single source of truth. `render.mjs` is a small, deliberate
markdown subset — headings, lists, tables, bold/italic/code/links — and nothing more,
so there is no dependency to install and no CDN to be blocked at load time.

⚠ WHY THIS IS NOT A LIBRARY. The obvious build is `marked` from a CDN, rendering in
the browser. That was tried and rejected: the whole page is then blank if the CDN is
unreachable, which is exactly what happens behind a restrictive egress policy. The
page ships pre-rendered, so it reads with JavaScript off.

## Conventions the renderer relies on

- `# H1` and the `## Builds …` line are dropped — the page's masthead carries both,
  and so is everything before the first real `##` section (the standfirst).
- Each `##` becomes a `<section>` with a slug id, and an entry in the contents rail.
  The leading emoji stays in the heading and is stripped from the rail label.
- A bullet or paragraph starting with 🐛 is tagged **Fixed**; one starting with 🔴 is
  tagged **Critical fix** and gets an ember rule down its left edge. The tag encodes
  the kind of change, so do not use those glyphs decoratively.
- `---` rules are dropped: section headings carry their own rule and the two doubled up.

The markdown rides along inside the page in a `text/plain` script tag so the
Copy-as-Markdown button hands back the exact source. That breaks if the notes ever
contain a literal `</script`; assemble.mjs throws rather than shipping it.
