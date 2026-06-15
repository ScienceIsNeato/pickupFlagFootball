# pickupflagfootball.com (concept site)

static site. the copy is a skin: all text lives in `content/<activity>.json`.
`build.mjs` renders `src/index.template.html` with it into `dist/`.

## build

```
node build.mjs               # uses content/flag-football.json
node build.mjs flag-football  # same, explicit
```

then open `dist/index.html`, or serve `dist/` with any static server:

```
cd dist && python3 -m http.server 8080
```

## another sport

drop a new `content/<sport>.json` next to `flag-football.json`, run
`node build.mjs <sport>`. no code changes.
