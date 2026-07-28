# Repository guidance

## Primary product

The primary product is the local KPL video analyzer:

- backend and tracking: `local_app.py`
- browser UI: `local-ui/`
- Python dependencies: `requirements-local.txt`
- Windows launcher: `start-local.bat`

The `app/` and `worker/` directories contain a separate optional vinext web prototype. Do not assume it performs local OpenCV video analysis.

## Required checks

For changes to the local analyzer:

```text
python -m py_compile local_app.py
node --check local-ui/app.js
```

For changes under `app/`, `worker/`, build configuration, or package dependencies:

```text
npm run build
```

## Data safety

Never commit videos, files under `local-data/`, generated exports, virtual environments, tokens, or user-specific absolute paths. Test fixtures must be synthetic or redistributable.

## Semantics

- Coordinates are percentages with origin at the top-left.
- `t` is game time; `videoT` is source video time.
- Player IDs are only stable within one match.
- Samples below 0.5 confidence are not shown or aggregated by default.
- Region rules are documented in `docs/REGION_RULES.md`; update the docs whenever code semantics change.

## Contribution style

Prefer small, evidence-backed changes. Tracking modifications must report their effect on accuracy, identity swaps, source distribution, and runtime. Preserve explicit uncertainty instead of fabricating exact positions.
