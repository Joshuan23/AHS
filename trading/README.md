# Alex G — "Set & Forget" Trading Indicator 📈

A ready-to-use **TradingView Pine Script v5** indicator that encodes the
widely taught *"set and forget"* price-action swing method popularised by trader
Alex G. It watches the chart for you, marks clean trade setups, and draws the
exact **Entry / Stop Loss / Take Profit** so you can place the order and walk
away — no babysitting.

> ⚠️ **Not financial advice.** This is an educational tool and an interpretation
> of a publicly taught approach. It is not affiliated with, endorsed by, or the
> property of any individual. Trading is risky — backtest first and never risk
> money you can't afford to lose.

## The strategy in one breath

1. **Trend first.** Only look for longs when the trend is up, shorts when it's
   down (price vs. a 200 EMA, optionally confirmed on a higher timeframe).
2. **Wait for the pullback.** Price must return to a real support/resistance
   level (auto-detected from swing pivots).
3. **Get confirmation.** A bullish/bearish **engulfing** candle or a
   **rejection / pin bar** must form *at* the level.
4. **Set it.** The indicator places your Entry, a Stop Loss beyond the swing
   (with an ATR buffer), and a Take Profit at a fixed risk:reward (default 1:2).
5. **Forget it.** Don't move the stop, don't panic — let the trade play out.
   Alerts fire automatically so you don't even have to watch the screen.

## What you see on the chart

| Element | Meaning |
| --- | --- |
| **Coloured EMA line** | Trend bias — green/up, red/down |
| **Support / resistance dots** | The active levels price is trading against |
| **`SET` ▲ / ▼ triangles** | A confirmed buy/sell setup on that bar |
| **Green box** | Reward zone (Entry → Take Profit) |
| **Red box** | Risk zone (Entry → Stop Loss) |
| **BUY/SELL, SL, TP labels** | Exact prices, the R:R, and a suggested position size |
| **Dashboard (top-right)** | Current bias, higher-timeframe state, R:R and $ risk |

## Install it (about 60 seconds)

1. Open [TradingView](https://www.tradingview.com/) and load any chart.
2. Bottom panel → **Pine Editor**.
3. Delete the starter code, then paste in the full contents of
   [`alex-g-set-and-forget.pine`](./alex-g-set-and-forget.pine).
4. Click **Save**, then **Add to chart**.
5. Open the indicator's ⚙️ **Settings** to tune it to your instrument.

## Set up the alerts (the "forget" part)

1. Right-click the chart → **Add alert** (or the ⏰ icon).
2. **Condition:** `Alex G — Set & Forget` → choose *BUY* or *SELL*.
3. Pick your delivery (app push, email, webhook) → **Create**.

Now you get pinged only when a full setup lines up — place the trade with the
levels shown, set your SL/TP, and forget it.

## Settings that matter most

| Setting | Default | What it changes |
| --- | --- | --- |
| **Trend EMA length** | 200 | The bias line. Lower = more trades, more noise. |
| **Confirm with higher timeframe** | on | Filters out counter-trend setups. Great for cleaner signals. |
| **Pivot lookback** | 10 / 10 | Bigger = fewer but stronger support/resistance levels. |
| **Level-tap tolerance (ATR ×)** | 0.5 | How close to a level counts as a "tap." |
| **Risk : Reward** | 2.0 | TP distance vs. stop distance. The core of set-and-forget. |
| **Stop buffer (ATR ×)** | 0.5 | Breathing room beyond the swing so noise doesn't stop you out. |
| **Risk per trade ($)** | 100 | Used to suggest a position size on each signal. |
| **Min bars between signals** | 5 | Stops back-to-back duplicate signals. |

## How it decides (under the hood)

- **Bias:** `close > EMA(200)` for longs, `<` for shorts; optional higher-TF
  agreement via `request.security`.
- **Levels:** `ta.pivothigh` / `ta.pivotlow` track the most recent confirmed swing.
- **Tap:** the candle's wick reaches within `tolerance × ATR` of the level and
  closes back on the correct side of it.
- **Confirmation:** engulfing (body engulfs the prior body) or a pin bar whose
  rejection wick is ≥ `ratio ×` the body, closing in the correct half.
- **Trade math:** `Stop = swing ± (ATR × buffer)`, `Risk = |Entry − Stop|`,
  `Take Profit = Entry ± Risk × R:R`, `Size ≈ $risk ÷ Risk`.

## A note on honesty

No public indicator can perfectly reproduce a private, discretionary method, and
this one doesn't claim to. It's a faithful, transparent implementation of the
*rules* behind the "set and forget" style so you can see, backtest, and adjust
every decision it makes. Treat the signals as a starting point, not gospel.
