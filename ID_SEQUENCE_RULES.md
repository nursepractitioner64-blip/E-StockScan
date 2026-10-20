# E-StockScan ID Sequence Rules

Implemented in `server.js` for DISPENSE:

- `MOVEMENT_ID`: `VMIYYYYMM-#####`
  - Reads existing IDs from both `INVENTORY_MOVEMENT` and `VACCINE_MOVEMENT` before issuing a number.
  - Uses one shared yearly sequence across months; starts at `00001` when the year changes.
- Dispense `REF_NO`: `RCOUTYYYYMM-#####`
  - Reads existing `REF_NO` values from both `VACCINE_MOVEMENT` and `INVENTORY_DISPENSE` before issuing a number.
  - Uses a separate yearly sequence from `MOVEMENT_ID`; starts at `00001` when the year changes.
- The same Dispense `REF_NO` is written to `VACCINE_MOVEMENT` and `INVENTORY_DISPENSE`.
- Sequence generation uses Thailand time (`Asia/Bangkok`).
- Dispense requests are queued within the same Node.js process to reduce duplicate numbers during concurrent requests.

Configure credentials with environment variables from `.env.example`. Do not commit `.env` or service-account credentials.
