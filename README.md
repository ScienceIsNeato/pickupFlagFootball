# pickup flag football (MIME-FF)

massive interests matching engine, for flag football.

say you're interested. when enough people near you do too, the app helps the group
settle on a spot and time. no organizer, free on the web.

## site/

the concept site. copy is a skin - all text lives in `content/<activity>.json`,
rendered into static html by `build.mjs` (zero deps). a different sport is a new
json, not a rewrite.

```
cd site
node build.mjs
cd dist && python3 -m http.server 8080
```

## db/

`schema.sql` - the canonical postgres schema. activity-agnostic core (flag football
is one row in `activity_types`), an h3 hex grid for matching plus zip/city for
display, and no street addresses. covers interest signals, the formation state
machine (suggestion + availability windows, soft promises), games, and the
anti-spam ledger.

## not built yet

the backend/api, auth, and the matching engine itself. this is the concept site
and the data model.
