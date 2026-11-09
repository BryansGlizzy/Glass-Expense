# Test-only oracle: automotive-pdf

`model.js` and `pdf.js` here are **verbatim copies** of `automotive-pdf/src/model.js` and `automotive-pdf/src/pdf.js`
(the user's standalone invoice app). They are the executable specification for GlassExpense's native port
(`src/invoice/`, see [docs/INVOICING_PLAN.md §5.3](../../../docs/INVOICING_PLAN.md)).

**Never import these files from application code.** They exist so tests can prove the port produces the same
totals and the same PDF bytes. They keep upstream's defaults and hard-coded strings on purpose (decision D4 discards those in
the app, not in the oracle).

| File | SHA-256 |
|---|---|
| `model.js` | `0a858dfbadb79603a3cc9f9e0b954bbd46987ad00e471357e03398925126ecb4` |
| `pdf.js`   | `70696f979f7fb4d7d73e4a4a857919b2df6ede7bbc54a25d887c049dc3af27fe` |

- Captured: 2026-11-09 from the working tree of `automotive-pdf/` (HEAD `cf398fb`, **with uncommitted changes** in `README.md`,
  `index.html`, `src/app.js`, `src/model.js`, `src/pdf.js`, `src/storage.js`, `tests/invoice.test.mjs`).
  The upstream repo was not modified; the hashes above pin exactly what was captured.
- `tests/invoice.core.test.ts` verifies these hashes, so an accidental edit fails the suite.
- Refreshing the oracle (only if the upstream design intentionally changes): copy the new files, update the hashes here,
  run `node scripts/gen-invoice-goldens.mjs`, and review the changed golden hashes before accepting them.

## Fixtures

`tests/fixtures/invoice/` holds the reference invoices (explicit values only, never upstream defaults) and `goldens.json`
with the oracle's PDF SHA-256 for each. Regenerate with `node scripts/gen-invoice-goldens.mjs`.

## Labels

Upstream hard-codes some strings (the footer brand, the signature sentence, fee-row names, etc.). The port takes them as
`PdfLabels`. `labels.ts` in this folder is the upstream wording, used **only** by the parity tests so the port can be
compared byte for byte.
