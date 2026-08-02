# Snowball Analytics — Reverse-Engineered API & Data Model (1:1 Blueprint)

*Captured from a live authenticated session by reading the app's own network calls and response shapes. Field names are verbatim from Snowball's API; no personal values are recorded here. Your own portfolio UUID is shown as `{portfolioId}`.*

## Architecture (confirmed)

- **Frontend:** Next.js/React calls a REST backend at base path **`/extapi/api/`** — this is separate from the app-shell routes at `/api/` (which only handle account, notifications, admin, support, social).
- **Auth:** **Bearer JWT**. The token lives in `localStorage` under the redux-persist key `persist:snowball-auth` and is sent as an `Authorization: Bearer <jwt>` header on every `/extapi/api` call. (Cookies alone return 401.)
- **Backend:** ASP.NET Core / C# — confirmed by PascalCase controller names (`MyPortfolio`, `DashboardStats`) and Russian-domain field names (`nkd` = накопленный купонный доход / accrued coupon income).

## Endpoint inventory (observed live)

| Method | Path | Purpose |
|---|---|---|
| GET | `/extapi/api/MyPortfolio?includeHidden=true` | List all portfolios (configs) |
| GET | `/extapi/api/MyPortfolio/{portfolioId}` | Single portfolio |
| GET | `/extapi/api/holdings?page=&pageSize=&sortBy=&sortDirection=&filter=&portfolioId=&showSoldHoldings=&type=asset&currency=` | Paginated holdings list |
| GET | `/extapi/api/holdings/edit?portfolioId={id}` | Holdings in edit form |
| POST | `/extapi/api/holdings/totals?portfolioId=&showSoldHoldings=&currency=` | Portfolio aggregate totals |
| GET | `/extapi/api/cash-list` | Cash / watchlist-style asset list |
| POST | `/extapi/api/DashboardStats/portfolio-list` | Dashboard summary per portfolio |
| GET | `/extapi/api/corporateActions?page=&pageSize=&sortBy=date&sortDirection=&filter=&portfolioId=` | Corporate actions (splits, etc.), paginated |
| GET | `/extapi/api/corporateActions/CheckCorporateActions?portfolioId=` | Pending corporate-action check |
| POST | `/extapi/api/main-stats` | **All portfolio analytics** (see below) |
| GET | `/extapi/api/notifications/unread-count` | (app-shell `/api/`) notifications |

**Standard paginated envelope** (used by `holdings`, `corporateActions`, and likely all list endpoints):
`{ data: [ …rows ], totalCount, page, pageSize, sortBy, sortDirection }`

Query params reveal the core UX contract: server-side **pagination** (`page`, `pageSize`), **sorting** (`sortBy`, `sortDirection`), **filtering** (`filter`), **sold-position toggle** (`showSoldHoldings`), **asset type** (`type=asset`), and **display currency** (`currency`) — everything converts server-side into the requested currency.

---

## Entity: Portfolio (38 fields)

`id, name, note, type, order, hidden, isDemo, isValid, validationErrors, broker, brokerCommission, defaultCurrency` —
**Goals:** `goalType, goalValue, goalCurrency` —
**Tax/return config:** `applyTaxesOnPaidDividends, doNotAdjustXIRR, doNotAdjustCashDividendsGoesThroughWithdrawals, dividendTaxPercent, automaticallyAddDividend, dividendGoToAnotherAccount` —
**Composite portfolios:** `isComposite, childPortfolios[]` —
**Cash:** `trackCash, trackCashType, removeCashAssets` —
**Sync (broker):** `isAutoSyncEnabled, syncProvider, syncParam, hasOnboardingSyncProblems, setupRequired` —
**Sharing:** `shareIsPublic, sharePublicKey` —
**Display:** `viewType, useCategories, hasHoldings, showPositionsOnlyAlert, portfolioNotificationSettings[]`

## Entity: Holding / Position (117 fields — the core model)

**Identity & reference:** `assetInfoId, externalId, isin, ticker, tickerWithExchange, exchange, description, anotherName, sector, industry, countryISO, marketCapMln, marketCapName, logoURL, primaryLogoURL, type, portfolioId, pieId, parentPieId`

**Quantity & cost basis:** `amount, price, priceBuyAllTime, priceSellAllTime, buyValue, buyValueOfSoldItems, totalPrice, reinvestedCost, commissionPaid, otherAssetExpensesPaid`

**Live valuation:** `currentPrice, originalCurrentPrice, originalCurrency, currency, currentTotalPrice, invariantTotalPrice, pricePercent, currentPricePercent, gainValue, gainPercent, totalGainValue, totalGainPercent, return, returnBuysOnly, profitFromSell`

**Allocation:** `portfolioAllocation, allocation, currentAllocation, totalShare, category`

**Dividends (per holding):** `divPaid, divTaxes, dividendTax, fromPortfolioDividendTax, yearDivPerShare, yearTotalDivs, divYieldCurrent, divYieldAverage, divYieldTTM, divAmountPerShareTTM, divYearGrowth, divFrequency, divRating, nextDividendDate, nextDividendPerShare, nextDividendAmount, exDividendDate, declaredDate`

**Fundamentals:** `eps, pe, payout, beta, xirr, expenseRatio`

**Bonds (fixed income):** `nominal, realNominal, nkd, nkdFromSell, incomeFromNKD, avgNKD, avgNominal, currentNKD, currentNominal, excludeNkdFromTotal, yieldCoupon, currentYield, modifCurrentYield, yieldToMaturity, effectiveYield, yieldToMaturityPortfolio, effectiveYieldPortfolio, couponsSumm, duration, bondType, bondRatings, term, listingLevel, maturityDate, offerDate, buyBackDate, amortizationReceived, avgAmortizationReceived`

**Period performance:** `periodGainsAmountAbsolute, periodGainsAmountPortfolio, periodGainsAmountPerShare, periodGainsPercent`

**State/misc:** `soldOut, isOversold, secCurr, ignCurr, isAutomaticallyCreated, note, compositeChildren, compositeChildrenTaxRate, compositeChildrenNames, isValid, validationErrors`

## Entity: Holdings Totals (portfolio aggregate)

`amount, totalPrice, currentTotalPrice, buyValue, buyValueOfSoldItems, gainValue, gainPercent, totalGainValue, totalGainPercent, return, profitFromSell, currency, portfolioAllocation, totalShare, reinvestedCost, amortizationReceived, avgAmortizationReceived, yearTotalDivs, divYieldCurrent, divYieldAverage, divYearGrowth, divPaid, divTaxes, oterhTaxesPaid, otherAssetExpensesPaid, commissionPaid, incomeFromNKD, periodGainsAmountPortfolio, periodGainsPercent, pe, payout, beta, expenseRatio`

## Entity: DashboardStats (per-portfolio dashboard row)

`id, name, broker, currency, isComposite, shareIsPublic, sharePublicKey, trackCashType, viewType, order, porder, stats{…}` — where `stats` holds the summary metrics for the dashboard card.

## Entity: Cash / Asset item

`name, ticker, exchange, isin, value, lotCount, currency, secondCurrency, description, logoURL, primaryLogoURL, currentPrice, prevClosePrice, divGrowth, type, asseType, sector, countryISO, assetInfoId, getEtfDataFrom, nextDividends, prevDividends, futureDivsCalculated, inPortfolioAmount, …`

---

## What this means for a 1:1 replica

1. **Rebuild the DB around these entities.** The Snowfolio schema needs a `portfolios` table matching the 38-field config (goals, tax rules, composite children, sync, sharing) and a `holdings`/positions model that can express the 117-field row — most of which are *computed* (allocation, gains, yields, XIRR) rather than stored. So the real design is: store raw **transactions + instrument reference + dividend history**, and compute the 117 fields at query time (exactly what Snowball's backend does).
2. **Match the API contract:** paginated `/holdings` with `sortBy/sortDirection/filter/currency/showSoldHoldings`, a `/holdings/totals` aggregate, `/MyPortfolio` CRUD, `/cash-list`, and `/DashboardStats/portfolio-list`.
3. **Server-side currency conversion** on every endpoint (the `currency=` param) — the FX conversion I added to Snowfolio is the right direction; it needs to move server-side.
4. **First-class bonds + composite (pie) portfolios + broker sync** are core, not afterthoughts.

## Analytics: `POST /extapi/api/main-stats`

The entire Analytics screen is powered by one endpoint. Request body `{ portfolioId, currency }` (plus a section selector the app sends that we haven't decoded). Response envelope:

```
{
  portfolioId, portfolioIsComposite, currency,
  missingFullTransactionHistory, holdingsCount,
  filter, filterOptions,
  common,   // overall stats + diversification (sector / country / asset class)
  divs,     // dividend analytics
  growth,   // growth over time
  goal,     // goal progress
  scores,   // scores (incl. dividend safety)
  bonds     // fixed-income analytics
}
```

Each sub-object is `null` until its tab/section is requested. The Analytics UI has tabs: **common, diversification, divs, growth, scores, report, bonds** (`analytics-<name>-tab`). So diversification and benchmark/growth are sections of `main-stats`, not separate endpoints.

**To capture the sub-object shapes** (when building analytics): hook `XMLHttpRequest` (the app uses XHR here, not fetch), open the Analytics screen, click each tab, and record the request body + response — the body flag that populates `common`/`divs`/`growth`/`scores`/`bonds` will be visible.

## Still to capture (do in Cowork when building each feature)

These controllers exist but their exact names weren't guessable (name-probes 404'd — the real routes differ). Capture each by opening its screen in a logged-in Snowball session with network recording on, then read the `/extapi/api/...` call:

- **`main-stats` section bodies** — the flag that populates `common`/`divs`/`growth`/`scores`/`bonds` (XHR-hook method above). This unlocks diversification, growth, and scores in one go.
- **Benchmark chart** — the index-comparison line (likely part of `growth`, or a chart endpoint on the dashboard).
- **In-app dividend calendar** — the portfolio's upcoming payouts (inside the app; `/dividend-calendar` and `/calendars` are marketing pages).
- **Backtest**, **Rebalancing**, **Screener** — their own screens.

Method reminder: log in → arm `read_network_requests` → open the screen (or hook XHR for POST bodies) → filter by `/extapi/` → fetch the URL with the Bearer token for the response schema.

## Endpoints confirmed this session
`MyPortfolio`, `MyPortfolio/{id}`, `holdings` (117-field rows), `holdings/edit`, `holdings/totals`, `cash-list`, `DashboardStats/portfolio-list`, `corporateActions`, `corporateActions/CheckCorporateActions`, `main-stats`, `notifications/*`. Base: `/extapi/api/`. Auth: Bearer JWT.
