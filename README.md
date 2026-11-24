# Move-Out Charge List Form

Web form agents use after a move-out walk. It sends the charges to n8n, which prices them
from the **Refund Letter - Charge Reference** Google Sheet and adds them to the refund letter sheet.

## Files
| File | What it does |
|---|---|
| `index.html` | Page layout: unit details, charge sections, Other charges, thank-you screen |
| `styles.css` | Look and feel (change `--accent` for the company color) |
| `app.js` | Builds the charge rows, totals, validation, sends data to n8n |
| `sample-parts.js` | Copy of the Charge Reference sheet for demo mode. Delete once n8n serves the list |

## Connecting to n8n
At the top of `app.js`:
```js
const CONFIG = {
  PARTS_URL: "",   // n8n GET webhook that returns the parts list
  SUBMIT_URL: "",  // n8n POST webhook that receives submissions
};
```
Leave both blank for **demo mode** (sample parts, nothing sent; the thank-you screen shows the data instead).

## Data sent on submit
```json
{
  "property": "EVG", "customerName": "Jane Doe", "accountNumber": "12345",
  "unitNumber": "204", "unitWalkedDate": "2026-11-22",
  "items": [ { "id": 14.1, "qty": 1, "cost": 85, "note": "Kitchen, by sink" } ],
  "other": [ { "description": "Smoke detector", "qty": 1, "cost": 15, "note": "" } ]
}
```
`cost: null` means "use the sheet price". n8n is expected to reply `{ "ok": true }`,
or `{ "ok": false, "error": "message" }` to show an error on the page.

## Pricing rules
- Cleaning rows: Amount = Qty × Cost, or Qty × sheet price if Cost is blank. Cost is required when the sheet price is $0.
- Replacement rows: Amount = Qty × sheet price.
- Other rows: description and cost are required.
