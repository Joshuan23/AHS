# Jarvis 🎙️ — your AI chief of staff

Talk to Jarvis about anything, by voice or text. It researches the web, remembers what you tell it, and builds and runs your business with you: plans, research, scripts, finding prospects, follow-ups, and a daily brief. Your job is to decide, show up, and close.

Jarvis is powered by Claude (Anthropic's AI) using your own Anthropic API key.

## What it does
- **Talk about anything.** It's a real conversation. Tap 🎙️ to talk, or turn on **🎧 Hands-free** and it listens again after every reply. Say "stop" to end hands-free.
- **Finds answers.** It searches and reads the web for current facts (prices, laws, competitors, local businesses, news) and shows its sources.
- **Builds your business.** Tap **🚀 Start a business** and it interviews you, researches options, recommends one, and sets up the launch plan: formation steps, pricing, branding, marketing, and scripts.
- **Runs your pipeline (🎯).** It adds real prospects it finds or that you mention, gives every lead a next step and date, and **🧠 Prep me to close** gives you research, talking points, objection answers, and a ready-to-send message.
- **One-tap follow-ups.** It drafts texts and emails, and you hit **Send** (it opens your Messages or Mail app, already filled in).
- **Tasks (✅).** It splits the work between *your to-do* (sign, pay, call, decide) and *Jarvis's list*. Tap **▶️ Let Jarvis work** and it does its open tasks.
- **Docs (📄).** Business plan, research, scripts, templates and proposals, ready to copy or share.
- **☀️ Daily brief.** Top priorities, who to follow up with and what to say, tasks due, weather, industry news, and a money snapshot.
- **Memory.** It remembers your business and preferences. Each day starts a fresh conversation (faster and cheaper), and your profile, leads, tasks and docs carry over.

## Setup (5 minutes)
1. Open the app: `https://<your-github-username>.github.io/AHS/jarvis/` once GitHub Pages is on (see the main README).
2. Create an account at **console.anthropic.com**, add a few dollars of credit under **Billing**, and create an **API key**.
3. Paste the key into Jarvis. Add it to your home screen: iPhone Share → *Add to Home Screen*, Android ⋮ → *Install app*.
4. Recommended: set a **monthly spend limit** in the Anthropic Console. ⚙️ Settings in Jarvis shows an estimated cost for the month.

## Honest limits
- Jarvis prepares everything, but **you** sign, pay, file, and press Send. It can't file an LLC, open a bank account, make payments, or send messages on its own.
- It only works while the app is open. It doesn't run in the background or wake you up with alerts.
- Legal, tax and financial guidance is general information. Confirm big decisions with a licensed professional.

## Privacy
Your API key, conversation, leads, tasks and docs are stored only on your phone (IndexedDB) and sent only to Anthropic to run Jarvis. Back up from ⚙️ Settings. The backup leaves out your API key.

## Files
| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | App shell and HUD styling |
| `app.js` | Conversation loop, voice, tools (leads, tasks, docs, drafts, memory), views |
| `vendor/anthropic-sdk.js` | Official Anthropic JS SDK v0.131.0, bundled for the browser (MIT) |
| `manifest.json`, `sw.js`, `icon.svg` | Installable, offline-capable app |
