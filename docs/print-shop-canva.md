# Print shop: Canva

Operators who design in Canva can bring a finished design into the Print shop
(**Import from Canva**) and print it as a poster, flyer or any product that may
go without a QR code. The other way round, a template print can be opened in
Canva as a new Canva design (**Send to Canva**) to change it freely there.

Each member connects their own Canva account (Canva Connect, OAuth with PKCE).
The App reads only the designs that member picks; nothing is synced in the
background.

## Turning it on

| Flag / variable                            | Effect                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| `print_shop.canva` (org flag, default off) | Import from Canva and Send to Canva (needs the master) |
| `CANVA_CLIENT_ID` / `CANVA_CLIENT_SECRET`  | The Canva Connect integration. Empty: the buttons hide |
| `CANVA_MOCK=true` (local only)             | A Canva emulator with three sample designs, no keys    |
| `INTEGRATION_ENCRYPTION_KEY` (already set) | Encrypts the stored Canva tokens                       |

The Canva pages need the campaign write permission (`update:campaign:any`), like
creating a print. Members who can only read prints do not see the buttons and
get a 403 from the routes.

`CANVA_MOCK` is ignored unless `BASE_URL` is a local host (`localhost`,
`127.0.0.1`, `*.test`, `*.localhost`), so a stray value in production does
nothing. Playwright sets it.

## Setting up the Canva integration

1. In the [Canva developer portal](https://www.canva.com/developers/), create a
   **Connect API** integration (public, so members of any Canva team can
   connect).
2. Scopes: `design:meta:read`, `design:content:read`, `design:content:write`,
   `profile:read`. Nothing else is asked for.
3. Authentication, redirect URL: `<BASE_URL>/resources/print/canva/callback`
   (one per environment: staging and production each have their own integration
   or their own redirect URL).
4. Copy the client ID and generate a client secret; set `CANVA_CLIENT_ID` and
   `CANVA_CLIENT_SECRET` on the App (the secret is sensitive).
5. Submit the integration for Canva's review before turning the flag on for
   customers. Until it is approved, only the developer's own Canva team can use
   it.

## How it works

```text
Connect     /:org/marketing/print/canva/connect  (PKCE + signed state cookie)
              └─▶ Canva consent ─▶ /resources/print/canva/callback
                    checks: same browser (cookie), same signed-in user, state,
                    then print write access and the flag; code ─▶ tokens
Import      /:org/marketing/print/canva  (pick a design, product, size, name)
              ├─ GET /designs/{id}              title, pages
              ├─ POST /exports pdf (pro, page 1) ─▶ poll ─▶ download (≤ 40 MB)
              │    a design with paid elements the plan cannot export falls
              │    back to regular quality
              ├─ POST /exports png (page 1)     proof preview
              ├─ page size check (below)
              └─ platform bucket print/<org>/artwork/<hash>/print.pdf|preview.png
                    ─▶ PrintDesign (source 'artwork', artwork JSON, draft)
Update      the same Canva design again ─▶ new file, back to draft
Edit        a fresh edit link (Canva's links last 30 days) in a new tab
Send        the template print's PDF (3 mm bleed) ─▶ POST /imports ─▶ new Canva
            design owned by the member ─▶ its edit link in a new tab
```

An imported print (an **artwork** print) is a finished file. The proof shows the
exported page, and downloads, approval and shipped orders use the stored PDF as
it is: there is no template, no QR code and no per-language copy. Only its name
changes in the editor. Approve it like any print before downloading or ordering
it.

### Page size

The first page of the Canva design must be the print's size, give or take 2 mm,
with or without an even bleed of up to 6 mm on every side (Canva: File,
Settings, Show print bleed, then export with bleed). A square social post
imported as an A3 poster is refused with a message that says what to change. The
size is read from the PDF's `MediaBox`; when a PDF keeps it in a compressed
object stream, the design's thumbnail ratio must match the print instead.

Only page 1 prints. A design with more pages imports with a note saying so.
Without bleed the editor notes that a colour running to the edge can show a thin
white line after cutting. Shipped prints send the file as it is: Prodigi fills
the print area from it (`fillPrintArea`), so a bleed other than the vendor's is
trimmed or scaled. Place a sandbox order of an artwork print per vendor before
launch.

### Codes that are capabilities

A vertical's QR codes can be capabilities (its `canView` rule). A print that
carries such codes is never sent to Canva: the codes would leave the App and
live on in the member's Canva account. Sending is refused with a message.

## Tokens and privacy

- Tokens live in `PrintCanvaConnection` (one row per organization and member),
  encrypted with `INTEGRATION_ENCRYPTION_KEY`, and never reach the browser.
- Canva refresh tokens are single use. A refresh writes the new pair only if the
  stored refresh token is still the one used, so two requests refreshing at once
  keep the winner's tokens. A refused refresh token (revoked in Canva, or
  expired) deletes the connection and the member is asked to connect again.
- **Disconnect Canva** deletes the row and revokes the grant at Canva (best
  effort). Prints already imported stay.
- The connection is per organization: a member of two organizations connects in
  each. Deleting the user or the organization deletes it; a member who leaves
  the organization keeps an unused row until then, and the Print shop routes
  refuse them anyway.
- Canva thumbnails are fetched by the App server and inlined in the picker (the
  App's CSP loads no third-party images). Download links from Canva are https
  only, time-limited and size-capped.
- Imported files hold whatever the operator designed in Canva. They are the
  organization's marketing material, kept in the platform bucket next to the
  rendered PDFs.

## Limits

- Canva rate limits: exports 20 requests per minute per user, design reads 100
  per minute. A limit shows as "Canva asked us to slow down".
- Export and import jobs are polled for up to 90 seconds.
- Imported PDFs: 40 MB at most. Titles sent to Canva: 50 characters.
- Autofill (filling a Canva brand template with the organization's data) needs a
  paid Canva plan on the member's side and is not used: table cards and other
  prints with codes stay on the templates.

## Testing

- Unit: `apps/app/app/utils/print/canva/*.test.ts` (OAuth, polling, errors,
  downloads, PDF size, token rotation) and
  `apps/app/app/utils/print/artwork.server.test.ts` (import, size check, update,
  send, private codes).
- E2E: `apps/app/tests/e2e/print-shop-canva.test.ts` against the emulator.
- Locally: set `CANVA_MOCK=true` in `apps/app/.env`, turn on
  `print_shop.enabled` and `print_shop.canva` for the organization in Admin,
  then Marketing, Print shop, Import from Canva.
