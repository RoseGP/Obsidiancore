# Invoice calculations

All invoice math runs through one engine, `src/features/invoicing/domain/calc.ts`.
The browser uses it for the live preview and PDF; the server uses it again on
every save, send and payment, so client-supplied totals are never trusted.

## Number handling

- Inputs are kept as **decimal strings** (`"1250.50"`), never as floats.
- Money is converted to **integer minor units** (cents, pence, yen) as `BigInt`.
  The number of minor digits comes from the currency (USD 2, JPY 0).
- Quantities allow up to 3 decimal places; tax and discount rates up to 3
  (so 8.625% is exact).
- Input with more precision than allowed is rejected with a field error,
  not silently truncated.
- Every rounding step uses **round half up** (away from zero at .5), to the
  currency's minor unit.

## Order of operations

| Step | Value | Rule |
|---|---|---|
| 1 | Line subtotal | `quantity × unit price`, rounded once per line |
| 2 | Subtotal | Sum of line subtotals |
| 3 | Discount | Percent: `subtotal × rate`, rounded. Fixed: the amount. Capped at the subtotal. **Applied before tax.** |
| 4 | Discount share | The discount is allocated across lines in proportion to their subtotals (largest-remainder method, so shares sum exactly to the discount) |
| 5 | Line tax | `(line subtotal − discount share) × line tax rate`, rounded per line |
| 6 | Tax | Sum of line taxes; shown grouped by rate on the invoice |
| 7 | Fees | Sum of additional fees. Fees are **not** discounted or taxed |
| 8 | Grand total | `subtotal − discount + tax + fees` |
| 9 | Amount paid | Sum of **confirmed** payments only. Pending and failed payments are shown but don't count |
| 10 | Balance due | `grand total − amount paid`, never below zero. A save that would push the total below the amount already paid is rejected |

Split invoices divide the grand total across installments by percentage using
the same largest-remainder allocation, so installment amounts always add up to
the total to the cent. Shares must sum to exactly 100%.

### Worked example

Two lines: $100.00 at 10% tax, $50.00 at 0%. 10% discount, $5.00 shipping fee.

1. Subtotal: 100.00 + 50.00 = **150.00**
2. Discount: 10% of 150.00 = **15.00**, shared 10.00 / 5.00
3. Tax: (100.00 − 10.00) × 10% = **9.00**; second line 0.00
4. Total: 150.00 − 15.00 + 9.00 + 5.00 = **149.00**

This case is covered by `__tests__/calc.test.ts`.

## Statuses

Only `draft`, `sent`, `viewed` and `void` are stored. The rest are derived:

```
void → draft → paid → overdue → partially paid → viewed → sent
```

- **Paid**: total > 0 and balance due is 0.
- **Overdue**: due date is before today and a balance remains (applies to
  partially paid invoices too). Never applies to paid or void invoices.
- **Sending never marks an invoice paid.** A send only moves a draft to
  `sent` when the mail server accepted the message. If email isn't configured
  or fails, the attempt is logged and the invoice stays a draft. "Mark as sent"
  exists for invoices delivered outside the app.

## Currencies

Dashboard totals use the business's default currency. Invoices in other
currencies are excluded from those sums (and the count is shown) because no
exchange-rate conversion is assumed.
