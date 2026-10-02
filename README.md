# Hauler HQ 🚛

A phone-first CRM, invoicing, and money-tracking app for a hauling business. No accounts, no monthly fees — everything runs in your browser and your data stays on your device.

## What it does

- **Customers (CRM)** — keep contacts with phone, email, address, and notes. Call, text, or email a customer in one tap. See every job and invoice for a customer, plus what they currently owe you.
- **Jobs** — schedule hauls with date, load type, pickup/drop-off, and price. Move them through *scheduled → in progress → done*, then turn completed jobs into an invoice with one tap.
- **Invoices** — professional invoices with line items, tax, due dates, and your payment instructions. Mark them sent/paid, spot overdue ones instantly, print or save as PDF right from your phone, or share a payment request by text.
- **Money** — log expenses (fuel, repairs, dump fees, insurance…), see income vs. expenses vs. profit for the month, year, or all time, with a category breakdown.
- **Jarvis 🎙️** — a voice assistant you can talk to. Tap the mic (or type) and ask things like *"give me my daily brief"*, *"who owes me?"*, *"what's on tomorrow?"*, *"how much did I make this month?"*, *"log 60 dollars fuel"*, *"call Mike"*, or *"will it rain?"*. Say *"help"* for the full list. Jarvis reads its answers out loud (you can switch to text-only in Settings).
- **Daily brief** — the first time you open the app each day, Jarvis gives you a rundown: top priorities, road weather with rain/wind/heat/ice alerts, today's jobs, past-due jobs still marked scheduled, tomorrow and the week ahead, who owes you (with phone numbers), finished jobs you haven't billed, unsent drafts, this month's income/expenses/profit compared with the same point last month, and housekeeping reminders (backups, missing invoice info, month-end receipts, quarterly taxes). Set your town or ZIP in ⚙️ Settings → Jarvis to turn on weather.
- **Backup** — export all your data as a file from Settings ⚙️ and restore it on any device.

## Using it on your phone

1. Host the files anywhere that serves static pages (GitHub Pages is free — see below).
2. Open the link on your phone.
3. Add it to your home screen: **iPhone** — Share → *Add to Home Screen*. **Android** — menu ⋮ → *Add to Home screen / Install app*.
4. It opens full-screen like a regular app and works offline after the first load.

## Free hosting with GitHub Pages

In this repository on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root → Save**. Your app will be live at `https://<your-username>.github.io/AHS/` in a minute or two.

## Important: your data

All data is stored in your phone's browser storage (localStorage) — nothing is sent to any server. (The one exception: if you turn on weather, Jarvis sends your town/ZIP or rough location to the free Open-Meteo weather service. Voice input uses your phone's built-in speech recognition, which may process audio through Apple or Google.) That means:

- **Export a backup regularly** (⚙️ Settings → Export Backup) and email it to yourself or save it to cloud storage.
- Clearing your browser data will erase the app's data. The backup file restores everything.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `styles.css` | All styling (light + dark mode) |
| `app.js` | All app logic and data handling |
| `manifest.json` / `sw.js` / `icon.svg` | Makes it installable and offline-capable (PWA) |
