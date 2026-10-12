# Training — user manual content

Each chapter of the in-app user manual (Training → User manuals) is one Markdown file here.
`manualCatalog.tsx` lists the chapters (title, icon, colour), links each topic to its screen and defines the learning paths.

- A topic is a `### Heading`. Its slug (lower case, words joined by `-`) is used in links, learning paths and
  the topic → screen map (`routes` in `manualCatalog.tsx`). Renaming a heading changes its slug.
- Screenshots: `![Caption](file.webp)` on a line of its own. The file goes in `public/training/manual/`
  (WebP, about 1440 px wide) and its `[width, height]` in `images.json`, so the page can reserve its space.
- Supported Markdown: headings, paragraphs, `-` / `1.` lists (nested by 3 spaces), tables, `**bold**`,
  `*italic*`, `` `code` ``, links, and callouts `> 💡 …`, `> ⚠️ …`, `> 🔒 …`.

Only `NN-name.md` files are loaded; this README is not part of the manual.
