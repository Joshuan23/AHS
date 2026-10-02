/* Jarvis — a voice-first AI chief of staff that talks about anything, researches the web,
   and builds and runs a business alongside its owner. Powered by Claude via the official SDK.
   Everything (API key, memory, leads, tasks, docs, conversation) is stored on this device. */
import Anthropic from './vendor/anthropic-sdk.js';

// ---------- Config ----------
const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 — smartest (default)', in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 — faster, about half the cost', in: 2, out: 10, cacheRead: 0.2 },
};
const WEB_SEARCH_COST = 0.01; // $10 per 1,000 searches
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const CONTEXT_TAG = '[jarvis-context]';

// ---------- Storage (IndexedDB key/value — holds far more than localStorage) ----------
const kv = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('jarvis', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  },
};

function freshState() {
  return {
    settings: { apiKey: '', name: '', location: '', model: 'claude-opus-5-5', voice: 'on', handsFree: false },
    profile: {},          // business facts: name, industry, offer, pricing, target customer...
    notes: [],            // things Jarvis should remember about the owner
    leads: [], tasks: [], docs: [], drafts: [], money: [],
    spend: { month: '', usd: 0 },
    lastBriefDate: '',
  };
}
let S = freshState();
let thread = { started: '', messages: [] }; // Claude conversation, append-only

async function loadAll() {
  try {
    const saved = await kv.get('state');
    if (saved) S = Object.assign(freshState(), saved, { settings: Object.assign(freshState().settings, saved.settings || {}) });
    const t = await kv.get('thread');
    if (t && Array.isArray(t.messages)) thread = t;
  } catch (e) { console.error(e); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    kv.set('state', S).catch((e) => toast('Could not save: ' + e.message));
    kv.set('thread', thread).catch(() => {});
  }, 150);
}

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => (n < 10 ? '0' : '') + n;
function today(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
const fmtMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n) => fmtMoney.format(Number(n) || 0);
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  const diff = Math.round((d - new Date(today() + 'T00:00:00')) / 86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Tiny safe Markdown renderer (escapes first, then formats) ----------
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + '<a href="' + u + '" target="_blank" rel="noopener">' + u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + '</a>');
  return s;
}
function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>'; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      let t = '<div class="tbl"><table><thead><tr>' + row(line).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += '<tr>' + row(lines[i]).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>'; i++; }
      html += t + '</tbody></table></div>'; continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { html += '<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'; i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      html += '<blockquote>' + inline(buf.join(' ')) + '</blockquote>'; continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      let l = ordered ? '<ol>' : '<ul>';
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        item = item.replace(/^\[ \]\s*/, '☐ ').replace(/^\[x\]\s*/i, '☑ ');
        l += '<li>' + inline(item) + '</li>'; i++;
      }
      html += l + (ordered ? '</ol>' : '</ul>'); continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    html += '<p>' + buf.map(inline).join('<br>') + '</p>';
  }
  return '<div class="md">' + html + '</div>';
}
function plainForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[#*_`>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- The system prompt (kept byte-stable so it stays cached) ----------
function systemPrompt() {
  const owner = S.settings.name || 'the owner';
  return `You are Jarvis, ${owner}'s personal AI chief of staff, business partner, and all-round assistant. ${owner} talks to you by voice or text from their phone.

Who you are:
- Sharp, warm, loyal, a little dry-witted, like a world-class chief of staff. You call ${owner} by name now and then, not every message.
- You can talk about absolutely anything: business, money, life, news, sports, how-to questions, ideas. Be a real conversation partner.
- When anything depends on current facts (prices, laws, news, weather, companies, people, local businesses, regulations, competitors), use web_search and web_fetch rather than guessing. Mention where facts came from in a few words. Never invent numbers, sources, or contacts.

Your main mission: build and run ${owner}'s business so that ${owner}'s job is mostly to make decisions, show up, and close sales.
- If there is no business yet, help pick one: ask a few sharp questions (skills, budget, time, location, goals), research options, recommend one with reasoning.
- Then build it with them, step by step: market and competitor research, offer and pricing, name and branding ideas, business plan, formation steps for their state (LLC, EIN, licenses, insurance, bank account), website and social copy, marketing plan, sales scripts, email/text templates, proposals, and finding real prospects.
- Do the heavy lifting yourself. Save substantial work as documents (save_document). Track every commitment as a task (add_task), marking owner "jarvis" for work you will do in conversation and "you" for things only ${owner} can do.
- Keep the sales pipeline current: whenever ${owner} mentions a prospect, add or update a lead. When you find real prospects through search, add them as leads with the source URL in notes. Give every open lead a concrete next step and date.
- Push toward revenue. Suggest the next best action, prep ${owner} before sales calls (talking points, likely objections and answers), and draft follow-ups with draft_message so ${owner} can send them with one tap.
- Learn and remember: when ${owner} tells you about themselves, their business, or their preferences, store it with update_profile or remember.

Be honest about what you cannot do from inside this app: you cannot sign documents, pay for things, file with the government, open bank accounts, place phone calls, or send emails/texts on your own. You prepare everything (filled-out answers, links to the right official websites, scripts, drafts) so ${owner} can finish each step in minutes. You also only work while ${owner} has the app open. You do not run in the background, so never claim you will "check back later" on your own; put it on the task list instead. For legal, tax, and financial specifics, give clear general guidance and recommend confirming with a licensed professional when the stakes are real.

How to respond:
- Your replies are often read out loud. Lead with the answer. In conversation keep it to a few natural sentences. Use short bullet lists only when they truly help. Put long material (plans, scripts, research) in save_document and give a brief spoken summary instead of pasting it all.
- Use the tools proactively and quietly. Do not narrate every tool call. Do not ask permission for routine record-keeping.
- When asked for a daily brief: call get_overview first, check today's weather for the owner's location and anything newsworthy for their industry with web_search, then give a tight brief: top 3 priorities for today, sales follow-ups due (with who, why, and the suggested message), tasks due or overdue, what you (Jarvis) will work on next, money snapshot if there is data, and one useful insight or opportunity. Make it energizing and under about 250 words.
- When asked to work on your own task list: call get_overview, pick the most valuable open "jarvis" tasks, actually do them now (research, write the documents, find leads), mark them done, and report what you finished and what ${owner} needs to do next.
- Each user message may end with a ${CONTEXT_TAG} block containing the current date, time, and location. Use it, but never mention the tag itself.`;
}

// ---------- Tools Jarvis can use on this device ----------
const S_STR = { type: 'string' };
const tools = [
  {
    name: 'get_overview',
    description: "Get the full current picture: the owner's business profile and remembered notes, all leads in the pipeline, all tasks, saved document titles, unsent drafts, and money totals. Call this before a daily brief, before working the task list, and whenever you need to know the current state of the business.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_profile',
    description: 'Save or update a fact about the business (e.g. business_name, industry, location, offer, pricing, target_customer, stage, goals, website, phone, legal_entity, ein_status). Use one call per fact. Use an empty value to clear it.',
    input_schema: { type: 'object', properties: { field: S_STR, value: S_STR }, required: ['field', 'value'], additionalProperties: false },
  },
  {
    name: 'remember',
    description: 'Remember a personal note about the owner for future conversations: preferences, schedule, family, goals, how they like to work.',
    input_schema: { type: 'object', properties: { note: S_STR }, required: ['note'], additionalProperties: false },
  },
  {
    name: 'add_task',
    description: 'Add a task. owner "you" = something only the human owner can do (sign, pay, call, meet, decide). owner "jarvis" = research or writing Jarvis will do in a conversation.',
    input_schema: {
      type: 'object',
      properties: {
        title: S_STR, owner: { type: 'string', enum: ['you', 'jarvis'] },
        due: { type: 'string', description: 'YYYY-MM-DD, optional' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] }, notes: S_STR,
      },
      required: ['title', 'owner'], additionalProperties: false,
    },
  },
  {
    name: 'update_task',
    description: 'Update a task by id: mark it done or reopen it, or change its title, due date, owner, priority, or notes.',
    input_schema: {
      type: 'object',
      properties: {
        id: S_STR, status: { type: 'string', enum: ['open', 'done'] }, title: S_STR, due: S_STR,
        owner: { type: 'string', enum: ['you', 'jarvis'] }, priority: { type: 'string', enum: ['high', 'normal', 'low'] }, notes: S_STR,
      },
      required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'add_lead',
    description: 'Add a sales lead or prospect to the pipeline. Only add real people or businesses: ones the owner mentioned, or ones you found via web search (put the source URL in source).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person or business name' }, company: S_STR, phone: S_STR, email: S_STR, website: S_STR,
        source: S_STR, value: { type: 'number', description: 'Estimated deal value in USD' },
        stage: { type: 'string', enum: STAGES }, next_step: S_STR, next_date: { type: 'string', description: 'YYYY-MM-DD' }, notes: S_STR,
      },
      required: ['name'], additionalProperties: false,
    },
  },
  {
    name: 'update_lead',
    description: 'Update a lead by id. Use it to change stage (new, contacted, qualified, proposal, won, lost), set the next step and date, record value, contact details, or notes. To add to notes, include the old notes plus the new info.',
    input_schema: {
      type: 'object',
      properties: {
        id: S_STR, name: S_STR, company: S_STR, phone: S_STR, email: S_STR, website: S_STR, source: S_STR,
        value: { type: 'number' }, stage: { type: 'string', enum: STAGES }, next_step: S_STR, next_date: S_STR, notes: S_STR,
      },
      required: ['id'], additionalProperties: false,
    },
  },
  {
    name: 'save_document',
    description: 'Save a document the owner can open, copy, and share later: business plans, research, scripts, templates, proposals, checklists, website copy. Content is Markdown. Pass id to replace an existing document.',
    input_schema: {
      type: 'object',
      properties: {
        title: S_STR, kind: { type: 'string', enum: ['plan', 'research', 'script', 'template', 'proposal', 'checklist', 'marketing', 'other'] },
        content: S_STR, id: S_STR,
      },
      required: ['title', 'content'], additionalProperties: false,
    },
  },
  {
    name: 'read_document',
    description: 'Read the full content of a saved document by id.',
    input_schema: { type: 'object', properties: { id: S_STR }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'draft_message',
    description: 'Prepare an email or text message for the owner to send with one tap (it opens their mail or messages app, prefilled). Use for follow-ups, outreach, proposals, and replies.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['email', 'sms'] }, to_name: S_STR,
        to_address: { type: 'string', description: 'Email address or phone number, if known' },
        subject: S_STR, body: S_STR, lead_id: S_STR,
      },
      required: ['channel', 'body'], additionalProperties: false,
    },
  },
  {
    name: 'log_money',
    description: 'Record business income or an expense.',
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['income', 'expense'] }, amount: { type: 'number' }, description: S_STR, date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' } },
      required: ['type', 'amount', 'description'], additionalProperties: false,
    },
  },
].map((t) => Object.assign(t, { eager_input_streaming: true }));

function serverTools() {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
  ];
}

// Inputs stream eagerly, so the API no longer validates them — check against the schema ourselves.
function validateInput(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object.';
  const sch = tool.input_schema;
  for (const k of sch.required || []) if (input[k] === undefined || input[k] === '') return 'Missing required field "' + k + '".';
  for (const [k, v] of Object.entries(input)) {
    const p = sch.properties[k];
    if (!p) return 'Unknown field "' + k + '".';
    if (p.type === 'number' && typeof v !== 'number') return 'Field "' + k + '" must be a number.';
    if (p.type === 'string' && typeof v !== 'string') return 'Field "' + k + '" must be a string.';
    if (p.enum && !p.enum.includes(v)) return 'Field "' + k + '" must be one of: ' + p.enum.join(', ') + '.';
  }
  return null;
}

function pick(obj, keys) { const o = {}; keys.forEach((k) => { if (obj[k] !== undefined) o[k] = obj[k]; }); return o; }
const LEAD_KEYS = ['name', 'company', 'phone', 'email', 'website', 'source', 'value', 'stage', 'next_step', 'next_date', 'notes'];

function runTool(name, input, toolUseId) {
  switch (name) {
    case 'get_overview': {
      const inc = S.money.filter((m) => m.type === 'income'), exp = S.money.filter((m) => m.type === 'expense');
      const month = today().slice(0, 7);
      const sum = (a) => a.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      return {
        today: today(),
        profile: S.profile, notes: S.notes,
        leads: S.leads, tasks: S.tasks,
        documents: S.docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, updated: d.updated })),
        unsent_drafts: S.drafts.filter((d) => !d.sent).map((d) => ({ to: d.to_name, channel: d.channel, subject: d.subject, created: d.created })),
        money: {
          income_this_month: sum(inc.filter((m) => m.date.slice(0, 7) === month)), expenses_this_month: sum(exp.filter((m) => m.date.slice(0, 7) === month)),
          income_all_time: sum(inc), expenses_all_time: sum(exp), recent: S.money.slice(-10),
        },
      };
    }
    case 'update_profile': {
      const key = input.field.trim().toLowerCase().replace(/\s+/g, '_');
      if (input.value) S.profile[key] = input.value; else delete S.profile[key];
      return { ok: true };
    }
    case 'remember':
      S.notes.push({ note: input.note, date: today() });
      if (S.notes.length > 200) S.notes.shift();
      return { ok: true };
    case 'add_task': {
      const t = Object.assign({ id: 't_' + uid(), status: 'open', created: today(), priority: 'normal' }, pick(input, ['title', 'owner', 'due', 'priority', 'notes']));
      S.tasks.push(t); return { ok: true, id: t.id };
    }
    case 'update_task': {
      const t = S.tasks.find((x) => x.id === input.id);
      if (!t) return { error: 'No task with id ' + input.id };
      Object.assign(t, pick(input, ['status', 'title', 'due', 'owner', 'priority', 'notes']));
      if (input.status === 'done') t.completed = today();
      return { ok: true };
    }
    case 'add_lead': {
      const dupe = S.leads.find((l) => l.name.toLowerCase() === input.name.toLowerCase() && (l.company || '') === (input.company || ''));
      if (dupe) return { error: 'Lead already exists with id ' + dupe.id + '. Use update_lead instead.' };
      const l = Object.assign({ id: 'l_' + uid(), stage: 'new', created: today() }, pick(input, LEAD_KEYS));
      S.leads.push(l); return { ok: true, id: l.id };
    }
    case 'update_lead': {
      const l = S.leads.find((x) => x.id === input.id);
      if (!l) return { error: 'No lead with id ' + input.id };
      Object.assign(l, pick(input, LEAD_KEYS)); l.updated = today();
      return { ok: true };
    }
    case 'save_document': {
      let d = input.id && S.docs.find((x) => x.id === input.id);
      if (d) Object.assign(d, { title: input.title, kind: input.kind || d.kind, content: input.content, updated: today() });
      else { d = { id: 'd_' + uid(), title: input.title, kind: input.kind || 'other', content: input.content, created: today(), updated: today() }; S.docs.push(d); }
      return { ok: true, id: d.id };
    }
    case 'read_document': {
      const d = S.docs.find((x) => x.id === input.id);
      return d ? { title: d.title, content: d.content } : { error: 'No document with id ' + input.id };
    }
    case 'draft_message': {
      const d = Object.assign({ id: toolUseId, created: today(), sent: false }, pick(input, ['channel', 'to_name', 'to_address', 'subject', 'body', 'lead_id']));
      S.drafts.push(d);
      return { ok: true, note: 'Draft is shown to the owner with a one-tap Send button.' };
    }
    case 'log_money': {
      S.money.push({ id: 'm_' + uid(), type: input.type, amount: input.amount, description: input.description, date: input.date || today() });
      return { ok: true };
    }
  }
  return { error: 'Unknown tool ' + name };
}

// ---------- Talking to Claude ----------
let client = null;
let busy = false;
let currentStream = null;
let liveText = '';        // text streaming in right now
let liveStatus = '';      // "Searching the web…" etc.
let turnStartIndex = 0;   // where this exchange began in thread.messages

function getClient() {
  if (!client) client = new Anthropic({ apiKey: S.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  return client;
}

function contextBlock() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return CONTEXT_TAG + ' Now: ' + now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) +
    ' (' + tz + '). Owner location: ' + (S.settings.location || 'unknown') + '.';
}

function trackSpend(usage) {
  if (!usage) return;
  const p = MODELS[S.settings.model] || MODELS['claude-opus-5-5'];
  const usd = ((usage.input_tokens || 0) * p.in + (usage.cache_creation_input_tokens || 0) * p.in * 1.25 +
    (usage.cache_read_input_tokens || 0) * p.cacheRead + (usage.output_tokens || 0) * p.out) / 1e6 +
    ((usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0) * WEB_SEARCH_COST;
  const m = today().slice(0, 7);
  if (S.spend.month !== m) S.spend = { month: m, usd: 0 };
  S.spend.usd += usd;
}

class TruncatedToolInput extends Error {}

async function ask(text, opts = {}) {
  text = String(text || '').trim();
  if (!text || busy) return;
  if (!S.settings.apiKey) { openSettings(); return; }
  stopSpeaking();
  busy = true;
  turnStartIndex = thread.messages.length;
  if (!thread.started) thread.started = today();
  thread.messages.push({ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: contextBlock() }] });
  save();
  liveText = ''; liveStatus = 'Thinking…'; setOrb('thinking');
  renderChat();

  let jsonRetries = 0;
  let spoken = '';
  try {
    for (let step = 0; step < 25; step++) {
      liveText = '';
      const stream = getClient().beta.messages.stream({
        model: S.settings.model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort || 'medium' },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(),
        tools: [...serverTools(), ...tools],
        messages: thread.messages,
      });
      currentStream = stream;
      stream.on('text', (delta) => { liveText += delta; liveStatus = ''; renderLive(); });
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start') {
          const b = ev.content_block;
          if (b.type === 'server_tool_use') liveStatus = b.name === 'web_fetch' ? 'Reading a web page…' : 'Searching the web…';
          else if (b.type === 'tool_use') liveStatus = toolStatus(b.name);
          else if (b.type === 'thinking') liveStatus = 'Thinking…';
          renderLive();
        }
      });

      let msg;
      try {
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.APIError || stream.aborted || err.name === 'AbortError' || jsonRetries++ >= 2) throw err;
        continue; // a streamed tool input wasn't parseable JSON — re-issue the turn
      } finally { currentStream = null; }

      trackSpend(msg.usage);
      if (msg.stop_reason === 'refusal') {
        // Not appended: a refused turn can hold a cut-off tool call. The next user message simply follows.
        addLocalNote('err', "I can't help with that one. Try asking a different way.");
        break;
      }
      thread.messages.push({ role: 'assistant', content: msg.content });
      spoken += msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') + ' ';
      save();
      if (msg.stop_reason === 'pause_turn') continue;

      const toolUses = msg.content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) break;

      const results = toolUses.map((tu) => {
        if (msg.stop_reason === 'max_tokens') return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Tool input was cut off by the length limit. Try again with a shorter input or split it up.' };
        const def = tools.find((t) => t.name === tu.name);
        const problem = def ? validateInput(def, tu.input) : 'Unknown tool.';
        if (problem) return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'INVALID_INPUT: ' + problem };
        try {
          return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(runTool(tu.name, tu.input, tu.id)) };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Tool failed: ' + e.message };
        }
      });
      thread.messages.push({ role: 'user', content: results });
      save();
      liveStatus = 'Working…';
      renderChat();
    }
  } catch (err) {
    if (!(err && (err.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError))) addLocalNote('err', friendlyError(err));
  } finally {
    busy = false; currentStream = null; liveText = ''; liveStatus = '';
    save(); renderChat(); updateBadges();
    setOrb('');
    if (spoken.trim()) speak(spoken); else maybeListenAgain();
  }
}

function toolStatus(name) {
  return ({
    get_overview: 'Reviewing your business…', update_profile: 'Updating your profile…', remember: 'Making a note…',
    add_task: 'Adding a task…', update_task: 'Updating tasks…', add_lead: 'Adding a lead…', update_lead: 'Updating your pipeline…',
    save_document: 'Writing a document…', read_document: 'Reading a document…', draft_message: 'Drafting a message…', log_money: 'Logging money…',
  })[name] || 'Working…';
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Open ⚙️ Settings and paste a valid key from console.anthropic.com.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Your API key does not have access to this model or feature. Check your Anthropic Console account.';
  if (err instanceof Anthropic.RateLimitError) return "I'm being rate-limited by Anthropic. Wait a minute and try again. If it keeps happening, check your plan limits and credit balance in the Console.";
  if (err instanceof Anthropic.BadRequestError) {
    const m = (err.message || '').toLowerCase();
    if (m.includes('credit')) return 'Your Anthropic account is out of credits. Add credits at console.anthropic.com → Billing.';
    return 'The request was rejected: ' + err.message + '. If this keeps happening, start a new conversation (✚).';
  }
  if (err instanceof Anthropic.InternalServerError) return "Anthropic's servers are busy right now. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionError) return "I can't reach the internet right now. Check your connection and try again.";
  if (err instanceof Anthropic.APIError) return 'Something went wrong (' + (err.status || 'error') + '): ' + err.message;
  return 'Something went wrong: ' + ((err && err.message) || err);
}

let localNotes = []; // UI-only messages (errors) keyed to a thread position
function addLocalNote(kind, text) { localNotes.push({ at: thread.messages.length, kind, text }); }

function stopTurn() { if (currentStream) currentStream.abort(); }

// ---------- Voice ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null, listening = false;

function pickVoice() {
  if (!window.speechSynthesis) return null;
  const voices = speechSynthesis.getVoices();
  const prefs = [/Daniel/i, /Google UK English Male/i, /Arthur/i, /en-GB/i, /Alex/i, /Google US English/i, /en-US/i];
  for (const p of prefs) { const v = voices.find((x) => p.test(x.name) || p.test(x.lang)); if (v) return v; }
  return voices[0] || null;
}
if (window.speechSynthesis) speechSynthesis.getVoices();

function speak(text) {
  const clean = plainForSpeech(text);
  if (!window.speechSynthesis || S.settings.voice === 'off' || !clean) { maybeListenAgain(); return; }
  speechSynthesis.cancel();
  // Speak sentence-sized chunks: long single utterances get cut off on some phones.
  const chunks = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const v = pickVoice();
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.04; u.pitch = 0.95;
    if (i === 0) u.onstart = () => setOrb('speaking');
    if (i === chunks.length - 1) u.onend = () => { setOrb(''); maybeListenAgain(); };
    u.onerror = () => setOrb('');
    speechSynthesis.speak(u);
  });
}
function stopSpeaking() { if (window.speechSynthesis) speechSynthesis.cancel(); setOrb(''); }
function maybeListenAgain() {
  if (S.settings.handsFree && currentTab === 'chat' && !busy && !listening) setTimeout(() => { if (!busy && !listening) startListening(); }, 350);
}

function startListening() {
  if (!SpeechRec) { toast("Voice input isn't supported in this browser. Type instead."); return; }
  if (listening) { recognizer && recognizer.stop(); return; }
  stopSpeaking();
  recognizer = new SpeechRec();
  recognizer.lang = 'en-US'; recognizer.interimResults = true; recognizer.continuous = false;
  let finalText = '';
  recognizer.onstart = () => { listening = true; setOrb('listening'); const m = $('#micBtn'); if (m) m.classList.add('on'); };
  recognizer.onresult = (ev) => {
    let interim = '';
    for (let k = ev.resultIndex; k < ev.results.length; k++) {
      if (ev.results[k].isFinal) finalText += ev.results[k][0].transcript; else interim += ev.results[k][0].transcript;
    }
    const inp = $('#chatInput'); if (inp) inp.value = finalText + interim;
  };
  recognizer.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { toast('Allow microphone access to talk to Jarvis'); S.settings.handsFree = false; save(); }
  };
  recognizer.onend = () => {
    listening = false; setOrb('');
    const m = $('#micBtn'); if (m) m.classList.remove('on');
    const inp = $('#chatInput');
    const said = (finalText || (inp ? inp.value : '')).trim();
    if (inp) inp.value = '';
    if (/^(stop|cancel|never ?mind|that'?s all|goodbye|bye)\.?$/i.test(said)) { S.settings.handsFree = false; save(); renderChat(); return; }
    if (said) ask(said);
  };
  try { recognizer.start(); } catch (e) { listening = false; }
}

function setOrb(state) {
  const orb = $('#orb'); if (orb) orb.className = 'orb ' + (state || '');
  const st = $('#orbStatus');
  if (st) st.textContent = state === 'listening' ? 'Listening…' : state === 'speaking' ? 'Speaking. Tap me to stop.' : state === 'thinking' ? (liveStatus || 'Thinking…') :
    (S.settings.handsFree ? 'Hands-free is on. Just talk.' : 'Tap 🎙️ to talk, or type.');
}

// ---------- Views ----------
let currentTab = 'chat';
const viewEl = $('#view');

function render() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab));
  if (!S.settings.apiKey) return renderSetup();
  if (currentTab === 'chat') renderChat();
  else if (currentTab === 'pipeline') renderPipeline();
  else if (currentTab === 'tasks') renderTasks();
  else if (currentTab === 'docs') renderDocs();
  updateBadges();
}
function setTab(tab) { currentTab = tab; render(); window.scrollTo(0, 0); }
document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

function updateBadges() {
  const dueFollowups = S.leads.filter((l) => !['won', 'lost'].includes(l.stage) && l.next_date && l.next_date <= today()).length;
  const myDue = S.tasks.filter((t) => t.status === 'open' && t.owner === 'you' && t.due && t.due <= today()).length;
  const set = (tab, n) => {
    const b = document.querySelector('.nav-btn[data-tab="' + tab + '"] span:last-child');
    if (b) b.innerHTML = b.textContent.replace(/\d+$/, '').trim() + (n ? ' <span class="count">' + n + '</span>' : '');
  };
  set('pipeline', dueFollowups); set('tasks', myDue);
}

// --- Setup (first run) ---
function renderSetup() {
  viewEl.innerHTML = '<div class="setup"><div class="orb" id="orb"></div><h1>J.A.R.V.I.S.</h1>' +
    '<p class="lead">Your AI chief of staff. Talk to me about anything. I research, plan, and build your business with you. You close the sales.</p>' +
    '<div class="card"><h3>One-time setup</h3><ol class="steps">' +
    '<li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> and sign up.</li>' +
    '<li>Add a few dollars of credit under <strong>Billing</strong>. You pay per use: usually a few cents to about 30¢ per conversation, more for deep research.</li>' +
    '<li>Create an API key and paste it below.</li></ol>' +
    field('Your first name', 'text', 'sName', S.settings.name, 'e.g. Josh') +
    field('Anthropic API key', 'password', 'sKey', '', 'sk-ant-…') +
    field('Your city & state (for weather and local research)', 'text', 'sLoc', S.settings.location, 'e.g. Tulsa, OK') +
    '<button class="btn primary" id="sGo">Bring Jarvis online</button>' +
    '<p class="hint" style="margin-top:10px">Your key and all your data stay on this phone. They are sent only to Anthropic to run Jarvis.</p></div></div>';
  $('#sGo').onclick = async () => {
    const key = $('#sKey').value.trim();
    if (!/^sk-ant-/.test(key)) { toast('That does not look like an Anthropic API key (starts with sk-ant-)'); return; }
    S.settings.name = $('#sName').value.trim(); S.settings.location = $('#sLoc').value.trim(); S.settings.apiKey = key;
    client = null; save();
    currentTab = 'chat'; render();
    ask("Hi Jarvis, I just set you up. Introduce yourself in a few sentences, tell me what you can do for me, and ask me the first questions you need to get started on building my business.");
  };
}

// --- Chat ---
function quickChips() {
  return '<div class="quick">' +
    [['☀️ Daily brief', 'brief'], ['▶️ Work your list', 'work'], ['🎯 Who should I call?', 'call'], ['🚀 Start a business', 'start'], ['💡 Grow my sales', 'grow']]
      .map((c) => '<button class="chip" data-quick="' + c[1] + '">' + c[0] + '</button>').join('') +
    '<button class="chip' + (S.settings.handsFree ? ' on' : '') + '" id="handsFreeChip">🎧 Hands-free ' + (S.settings.handsFree ? 'on' : 'off') + '</button></div>';
}
const QUICK = {
  brief: () => dailyBrief(),
  work: () => ask('Work through your open Jarvis tasks now. Do the most valuable ones, then tell me what you finished and what I need to do next.', { effort: 'high' }),
  call: () => ask('Who should I contact today to make money? Give me the top people, why, and what to say. Draft the messages I should send.'),
  start: () => ask("I want you to help me start a business from scratch. Interview me with a few questions at a time, then research and recommend the best option for me and set up the full launch plan."),
  grow: () => ask('Look at my business and pipeline and tell me the three highest-leverage moves to get more sales this week. Research what is working for similar businesses. Then set up the tasks.', { effort: 'high' }),
};
function dailyBrief() {
  S.lastBriefDate = today(); save();
  ask('Give me my daily brief.', { effort: 'high' });
}

function renderChat() {
  if (currentTab !== 'chat' || !S.settings.apiKey) return;
  const first = !$('#chatLog');
  if (first) {
    viewEl.innerHTML = '<div class="hero"><button class="orb" id="orb" aria-label="Stop"></button><div><div class="hero-name">JARVIS</div><div class="hero-status" id="orbStatus"></div></div></div>' +
      '<div class="log" id="chatLog"></div>' +
      '<div class="inputbar" id="inputBar"></div>';
    $('#orb').onclick = () => { stopSpeaking(); stopTurn(); };
  }
  const bar = $('#inputBar');
  bar.innerHTML = quickChips() + '<div class="row"><textarea id="chatInput" rows="1" placeholder="Talk to Jarvis…" enterkeyhint="send"></textarea>' +
    '<button class="round mic" id="micBtn" aria-label="Talk">🎙️</button>' +
    (busy ? '<button class="round stop" id="stopBtn" aria-label="Stop">■</button>' : '<button class="round send" id="sendBtn" aria-label="Send">➤</button>') + '</div>';
  const input = $('#chatInput');
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = input.value; input.value = ''; ask(v); } };
  $('#micBtn').onclick = startListening;
  if ($('#sendBtn')) $('#sendBtn').onclick = () => { const v = input.value; input.value = ''; ask(v); };
  if ($('#stopBtn')) $('#stopBtn').onclick = stopTurn;
  bar.querySelectorAll('[data-quick]').forEach((c) => { c.onclick = () => QUICK[c.dataset.quick](); });
  $('#handsFreeChip').onclick = () => {
    S.settings.handsFree = !S.settings.handsFree; save(); renderChat();
    if (S.settings.handsFree) { toast('Hands-free on. Jarvis listens after every reply. Say "stop" to end.'); startListening(); }
    else if (listening && recognizer) recognizer.stop();
  };

  $('#chatLog').innerHTML = threadHtml() + '<div id="live"></div>';
  bindLogButtons($('#chatLog'));
  renderLive();
  setOrb(busy ? 'thinking' : listening ? 'listening' : (window.speechSynthesis && speechSynthesis.speaking) ? 'speaking' : '');
  if (!thread.messages.length && !busy) {
    $('#live').innerHTML = '<div class="msg jarvis">' + md('Good ' + partOfDay() + (S.settings.name ? ', ' + S.settings.name : '') +
      '. What are we working on? Tap **☀️ Daily brief**, **🚀 Start a business**, or just talk to me.') + '</div>';
  }
  requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}
function partOfDay() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }

function renderLive() {
  const live = $('#live'); if (!live) return;
  if (!busy) { live.innerHTML = ''; return; }
  live.innerHTML = (liveText ? '<div class="msg jarvis">' + md(liveText) + '</div>' : '') +
    (liveStatus || !liveText ? '<div class="activity"><span class="act-chip typing"><span></span><span></span><span></span>' + esc(liveStatus || 'Thinking…') + '</span></div>' : '');
  setOrb('thinking');
  window.scrollTo(0, document.body.scrollHeight);
}

function threadHtml() {
  let html = '';
  const failed = new Set();
  thread.messages.forEach((m) => { if (m.role === 'user' && Array.isArray(m.content)) m.content.forEach((b) => { if (b.type === 'tool_result' && b.is_error) failed.add(b.tool_use_id); }); });
  const notesAt = (i) => localNotes.filter((n) => n.at === i).map((n) => '<div class="msg ' + (n.kind === 'err' ? 'err' : 'jarvis') + '">' + esc(n.text) + '</div>').join('');
  thread.messages.forEach((m, i) => {
    html += notesAt(i);
    if (m.role === 'user') {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const txt = blocks.filter((b) => b.type === 'text' && !b.text.startsWith(CONTEXT_TAG)).map((b) => b.text).join('\n');
      if (txt) html += '<div class="msg me">' + esc(txt) + '</div>';
      return;
    }
    let text = '', chips = [], sources = [], cards = '';
    for (const b of m.content) {
      if (b.type === 'text') {
        text += b.text;
        (b.citations || []).forEach((c) => { if (c.url && !sources.find((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title || c.url }); });
      } else if (b.type === 'server_tool_use') {
        chips.push(b.name === 'web_fetch' ? '🌐 Read ' + ((b.input && b.input.url) || 'a page').replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) : '🔎 ' + ((b.input && b.input.query) || 'Searched the web'));
      } else if (b.type === 'tool_use') {
        if (failed.has(b.id)) continue;
        const c = toolChip(b); if (c) chips.push(c);
        if (b.name === 'draft_message') cards += draftCard(S.drafts.find((d) => d.id === b.id));
      }
    }
    if (chips.length) html += '<div class="activity">' + chips.map((c) => '<span class="act-chip">' + esc(c) + '</span>').join('') + '</div>';
    if (text.trim()) {
      html += '<div class="msg jarvis">' + md(text) +
        (sources.length ? '<div class="sources">Sources: ' + sources.slice(0, 6).map((s) => '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>').join('') + '</div>' : '') + '</div>';
    }
    html += cards;
  });
  html += notesAt(thread.messages.length);
  return html;
}

function toolChip(b) {
  const i = b.input || {};
  switch (b.name) {
    case 'get_overview': return '📊 Reviewed your business';
    case 'update_profile': return '🏢 Saved: ' + (i.field || '').replace(/_/g, ' ');
    case 'remember': return '🧠 Noted';
    case 'add_task': return (i.owner === 'jarvis' ? '🤖 My task: ' : '✅ Your task: ') + (i.title || '');
    case 'update_task': return i.status === 'done' ? '☑ Task done' : '✏️ Task updated';
    case 'add_lead': return '🎯 New lead: ' + (i.name || '');
    case 'update_lead': return '🎯 Lead updated' + (i.stage ? ': ' + i.stage : '');
    case 'save_document': return '📄 Saved doc: ' + (i.title || '');
    case 'read_document': return '📄 Read a doc';
    case 'log_money': return (i.type === 'income' ? '💵 Income ' : '💸 Expense ') + money(i.amount);
    case 'draft_message': return null;
  }
  return null;
}

function draftCard(d) {
  if (!d) return '';
  const href = draftHref(d);
  return '<div class="card draft-card"><div class="row-between"><div><strong>' + (d.channel === 'sms' ? '💬 Text' : '✉️ Email') + ' to ' + esc(d.to_name || d.to_address || '…') + '</strong>' +
    (d.subject ? '<div class="muted">' + esc(d.subject) + '</div>' : '') + '</div>' + (d.sent ? '<span class="badge won">sent</span>' : '') + '</div>' +
    '<div class="draft-body">' + esc(d.body) + '</div><div class="btn-row">' +
    (href ? '<a class="btn small gold" href="' + esc(href) + '" data-sent="' + esc(d.id) + '">Send</a>' : '') +
    '<button class="btn small secondary" data-copy="' + esc(d.id) + '">Copy</button></div></div>';
}
function draftHref(d) {
  const addr = (d.to_address || '').trim();
  if (d.channel === 'sms') return 'sms:' + addr.replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(d.body);
  return 'mailto:' + encodeURIComponent(addr).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(d.subject || '') + '&body=' + encodeURIComponent(d.body);
}

function bindLogButtons(root) {
  root.querySelectorAll('[data-sent]').forEach((a) => {
    a.addEventListener('click', () => {
      const d = S.drafts.find((x) => x.id === a.dataset.sent);
      if (d) {
        d.sent = true;
        const l = d.lead_id && S.leads.find((x) => x.id === d.lead_id);
        if (l && l.stage === 'new') l.stage = 'contacted';
        save();
      }
    });
  });
  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = () => {
      const d = S.drafts.find((x) => x.id === b.dataset.copy);
      if (d) navigator.clipboard.writeText((d.subject ? d.subject + '\n\n' : '') + d.body).then(() => toast('Copied'));
    };
  });
}

// --- Pipeline ---
function renderPipeline() {
  const open = S.leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const won = S.leads.filter((l) => l.stage === 'won');
  const pipeValue = open.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const wonValue = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const month = today().slice(0, 7);
  const sumM = (type) => S.money.filter((m) => m.type === type && m.date.slice(0, 7) === month).reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const due = open.filter((l) => l.next_date && l.next_date <= today()).sort((a, b) => a.next_date.localeCompare(b.next_date));

  let html = '<div class="stat-grid">' + stat('Open pipeline', money(pipeValue), 'cyan') + stat('Won', money(wonValue), 'good') +
    stat('Profit (mo)', money(sumM('income') - sumM('expense')), sumM('income') - sumM('expense') < 0 ? 'bad' : '') + '</div>';
  html += '<div class="btn-row"><button class="btn primary" id="addLead">＋ Add lead</button><button class="btn secondary" id="findLeads">🔎 Have Jarvis find leads</button></div>';
  if (due.length) html += '<div class="section-title">Follow up today</div>' + due.map(leadCard).join('');
  STAGES.forEach((st) => {
    const list = S.leads.filter((l) => l.stage === st && !due.includes(l));
    if (!list.length) return;
    html += '<div class="section-title">' + st + ' <span class="muted">' + list.length + '</span></div>' + list.map(leadCard).join('');
  });
  if (!S.leads.length) html += '<div class="empty"><div class="big">🎯</div>No leads yet.<br>Add one, or ask Jarvis to find prospects for you.</div>';
  viewEl.innerHTML = html;
  $('#addLead').onclick = () => leadForm();
  $('#findLeads').onclick = () => { setTab('chat'); ask('Find me 5 to 10 real prospects I could sell to, using web search. Add them to my pipeline with contact info and a suggested first message.', { effort: 'high' }); };
  viewEl.querySelectorAll('[data-lead]').forEach((b) => { b.onclick = () => leadForm(S.leads.find((l) => l.id === b.dataset.lead)); });
  viewEl.querySelectorAll('[data-prep]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const l = S.leads.find((x) => x.id === b.dataset.prep);
      setTab('chat'); ask('Prep me to close ' + l.name + (l.company ? ' at ' + l.company : '') + ' (lead id ' + l.id + '). Research them, give me talking points, likely objections with answers, and draft my next message.', { effort: 'high' });
    };
  });
}
function stat(label, value, cls) { return '<div class="stat ' + (cls || '') + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div></div>'; }
function leadCard(l) {
  const contact = [];
  if (l.phone) contact.push('<a class="btn small secondary" href="tel:' + esc(l.phone) + '" onclick="event.stopPropagation()">📞</a><a class="btn small secondary" href="sms:' + esc(l.phone) + '" onclick="event.stopPropagation()">💬</a>');
  if (l.email) contact.push('<a class="btn small secondary" href="mailto:' + esc(l.email) + '" onclick="event.stopPropagation()">✉️</a>');
  if (safeUrl(l.website)) contact.push('<a class="btn small secondary" href="' + esc(l.website) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">🌐</a>');
  const overdue = l.next_date && l.next_date <= today() && !['won', 'lost'].includes(l.stage);
  return '<div class="card list-btn" data-lead="' + esc(l.id) + '"><div class="row-between"><div><h3>' + esc(l.name) + '</h3>' +
    '<div class="lead-meta">' + esc([l.company, l.value ? money(l.value) : ''].filter(Boolean).join(' · ')) + '</div></div>' +
    '<span class="badge ' + esc(l.stage) + '">' + esc(l.stage) + '</span></div>' +
    (l.next_step ? '<div class="next-step">' + (overdue ? '⏰ ' : '➡️ ') + esc(l.next_step) + (l.next_date ? ' · <strong>' + esc(fmtDate(l.next_date)) + '</strong>' : '') + '</div>' : '') +
    '<div class="btn-row">' + contact.join('') + (['won', 'lost'].includes(l.stage) ? '' : '<button class="btn small gold" data-prep="' + esc(l.id) + '">🧠 Prep me to close</button>') + '</div></div>';
}
function leadForm(l) {
  const x = l || { stage: 'new' };
  openModal(l ? 'Edit lead' : 'New lead',
    field('Name *', 'text', 'fName', x.name) + field('Company', 'text', 'fCo', x.company) +
    '<div class="field-row">' + field('Phone', 'tel', 'fPhone', x.phone) + field('Email', 'email', 'fEmail', x.email) + '</div>' +
    '<div class="field-row">' + selectField('Stage', 'fStage', STAGES, x.stage) + field('Deal value ($)', 'number', 'fVal', x.value) + '</div>' +
    '<div class="field-row">' + field('Next step', 'text', 'fNext', x.next_step) + field('Next date', 'date', 'fDate', x.next_date) + '</div>' +
    field('Website', 'url', 'fWeb', x.website) + areaField('Notes', 'fNotes', x.notes) +
    '<button class="btn primary" id="fSave">Save</button>' + (l ? '<div class="btn-row"><button class="btn danger" id="fDel">Delete lead</button></div>' : ''),
    (m) => {
      $('#fSave', m).onclick = () => {
        const name = $('#fName', m).value.trim(); if (!name) { toast('Name is required'); return; }
        const data = { name, company: $('#fCo', m).value.trim(), phone: $('#fPhone', m).value.trim(), email: $('#fEmail', m).value.trim(), stage: $('#fStage', m).value,
          value: Number($('#fVal', m).value) || undefined, next_step: $('#fNext', m).value.trim(), next_date: $('#fDate', m).value, website: $('#fWeb', m).value.trim(), notes: $('#fNotes', m).value.trim() };
        if (l) Object.assign(l, data, { updated: today() }); else S.leads.push(Object.assign({ id: 'l_' + uid(), created: today() }, data));
        save(); closeModal(); render();
      };
      if (l) $('#fDel', m).onclick = () => { if (confirm('Delete this lead?')) { S.leads = S.leads.filter((y) => y.id !== l.id); save(); closeModal(); render(); } };
    });
}

// --- Tasks ---
function renderTasks() {
  const sortT = (a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || (a.due || '9999').localeCompare(b.due || '9999') || (a.priority === 'high' ? -1 : 0);
  const mine = S.tasks.filter((t) => t.owner === 'you' && (t.status === 'open' || t.completed === today())).sort(sortT);
  const his = S.tasks.filter((t) => t.owner === 'jarvis' && (t.status === 'open' || t.completed === today())).sort(sortT);
  let html = '<div class="btn-row"><button class="btn primary" id="addTask">＋ Add task</button><button class="btn gold" id="workList">▶️ Let Jarvis work</button></div>';
  html += '<div class="section-title">Your to-do</div>' + (mine.length ? mine.map(taskRow).join('') : '<div class="card muted">Nothing on your plate. 🎉</div>');
  html += '<div class="section-title">Jarvis is on it</div>' + (his.length ? his.map(taskRow).join('') : '<div class="card muted">Jarvis has no open tasks. Give him a project in chat.</div>');
  const doneCount = S.tasks.filter((t) => t.status === 'done').length;
  if (doneCount) html += '<p class="muted" style="text-align:center;margin-top:14px">' + doneCount + ' tasks completed so far.</p>';
  viewEl.innerHTML = html;
  $('#addTask').onclick = () => taskForm();
  $('#workList').onclick = () => { setTab('chat'); QUICK.work(); };
  viewEl.querySelectorAll('[data-check]').forEach((c) => {
    c.onchange = () => {
      const t = S.tasks.find((x) => x.id === c.dataset.check);
      t.status = c.checked ? 'done' : 'open'; t.completed = c.checked ? today() : undefined; save(); renderTasks(); updateBadges();
    };
  });
  viewEl.querySelectorAll('[data-task]').forEach((r) => { r.onclick = () => taskForm(S.tasks.find((x) => x.id === r.dataset.task)); });
}
function taskRow(t) {
  const late = t.status === 'open' && t.due && t.due <= today();
  return '<div class="card task' + (t.status === 'done' ? ' done' : '') + '"><input type="checkbox" data-check="' + esc(t.id) + '"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="Done">' +
    '<div class="list-btn" data-task="' + esc(t.id) + '"><div class="task-title">' + esc(t.title) + '</div><div class="lead-meta">' +
    (t.priority === 'high' ? '<span class="badge high">high</span> ' : '') + (t.due ? '<span class="badge ' + (late ? 'due' : '') + '">' + esc(fmtDate(t.due)) + '</span> ' : '') +
    esc(t.notes || '') + '</div></div></div>';
}
function taskForm(t) {
  const x = t || { owner: 'you', priority: 'normal' };
  openModal(t ? 'Edit task' : 'New task',
    field('Task *', 'text', 'fTitle', x.title) +
    '<div class="field-row">' + selectField('Who', 'fOwner', ['you', 'jarvis'], x.owner) + selectField('Priority', 'fPri', ['high', 'normal', 'low'], x.priority) + '</div>' +
    field('Due', 'date', 'fDue', x.due) + areaField('Notes', 'fNotes', x.notes) +
    '<button class="btn primary" id="fSave">Save</button>' + (t ? '<div class="btn-row"><button class="btn danger" id="fDel">Delete task</button></div>' : ''),
    (m) => {
      $('#fSave', m).onclick = () => {
        const title = $('#fTitle', m).value.trim(); if (!title) { toast('Task is required'); return; }
        const data = { title, owner: $('#fOwner', m).value, priority: $('#fPri', m).value, due: $('#fDue', m).value, notes: $('#fNotes', m).value.trim() };
        if (t) Object.assign(t, data); else S.tasks.push(Object.assign({ id: 't_' + uid(), status: 'open', created: today() }, data));
        save(); closeModal(); render();
      };
      if (t) $('#fDel', m).onclick = () => { S.tasks = S.tasks.filter((y) => y.id !== t.id); save(); closeModal(); render(); };
    });
}

// --- Docs ---
function renderDocs() {
  const docs = S.docs.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  let html = '<div class="btn-row"><button class="btn secondary" id="bizPlan">📘 Write my business plan</button><button class="btn secondary" id="scripts">🗣️ Sales scripts</button></div>';
  if (Object.keys(S.profile).length) {
    html += '<div class="section-title">Your business</div><div class="card">' + Object.entries(S.profile).map(([k, v]) =>
      '<div class="lead-meta"><strong style="color:var(--text)">' + esc(k.replace(/_/g, ' ')) + ':</strong> ' + esc(v) + '</div>').join('') + '</div>';
  }
  html += '<div class="section-title">Documents</div>';
  html += docs.length ? docs.map((d) => '<div class="card list-btn" data-doc="' + esc(d.id) + '"><div class="row-between"><h3>' + esc(d.title) + '</h3><span class="badge">' + esc(d.kind) + '</span></div>' +
    '<div class="lead-meta">Updated ' + esc(fmtDate(d.updated)) + '</div></div>').join('') :
    '<div class="empty"><div class="big">📄</div>Plans, research, scripts and templates Jarvis writes for you will show up here.</div>';
  viewEl.innerHTML = html;
  $('#bizPlan').onclick = () => { setTab('chat'); ask('Write or update my full business plan as a document. Research my market first. If you are missing key info, ask me first.', { effort: 'high' }); };
  $('#scripts').onclick = () => { setTab('chat'); ask('Write me a complete sales script pack as a document: cold call, follow-up text, follow-up email, top 8 objections with answers, and a closing script. Base it on my business.', { effort: 'high' }); };
  viewEl.querySelectorAll('[data-doc]').forEach((c) => { c.onclick = () => openDoc(S.docs.find((d) => d.id === c.dataset.doc)); });
}
function openDoc(d) {
  openModal(d.title, md(d.content) + '<div class="btn-row"><button class="btn primary" id="dCopy">Copy</button><button class="btn secondary" id="dShare">Share</button>' +
    '<button class="btn secondary" id="dAsk">Ask Jarvis to revise</button></div><div class="btn-row"><button class="btn danger" id="dDel">Delete</button></div>', (m) => {
    $('#dCopy', m).onclick = () => navigator.clipboard.writeText(d.content).then(() => toast('Copied'));
    $('#dShare', m).onclick = () => {
      if (navigator.share) navigator.share({ title: d.title, text: d.content }).catch(() => {});
      else navigator.clipboard.writeText(d.content).then(() => toast('Copied'));
    };
    $('#dAsk', m).onclick = () => {
      closeModal(); setTab('chat');
      const inp = $('#chatInput'); inp.value = 'Revise the document "' + d.title + '" (id ' + d.id + '): '; inp.focus();
    };
    $('#dDel', m).onclick = () => { if (confirm('Delete this document?')) { S.docs = S.docs.filter((x) => x.id !== d.id); save(); closeModal(); render(); } };
  });
}

// --- Settings ---
function openSettings() {
  const s = S.settings;
  const spend = S.spend.month === today().slice(0, 7) ? S.spend.usd : 0;
  openModal('Settings',
    field('Your first name', 'text', 'sName', s.name) +
    field('City & state', 'text', 'sLoc', s.location, 'e.g. Tulsa, OK') +
    field('Anthropic API key', 'password', 'sKey', s.apiKey, 'sk-ant-…') +
    '<p class="hint" style="margin:-6px 0 12px">Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Stored only on this device.</p>' +
    selectField('Brain', 'sModel', Object.keys(MODELS), s.model, (k) => MODELS[k].label) +
    selectField('Voice', 'sVoice', ['on', 'off'], s.voice, (v) => (v === 'on' ? 'Jarvis speaks out loud' : 'Text only')) +
    '<div class="card"><div class="row-between"><span>Estimated AI cost this month</span><strong>$' + spend.toFixed(2) + '</strong></div>' +
    '<p class="hint">Estimated from token usage. Your Anthropic Console shows the exact bill, and you can set a monthly spend limit there.</p></div>' +
    '<button class="btn primary" id="sSave">Save</button>' +
    '<div class="section-title">Your data</div><div class="btn-row"><button class="btn secondary" id="sExport">⬇️ Export backup</button><button class="btn secondary" id="sImport">⬆️ Restore</button></div>' +
    '<input type="file" id="sFile" accept="application/json" hidden>' +
    '<div class="btn-row"><button class="btn danger" id="sWipe">Erase everything on this device</button></div>',
    (m) => {
      $('#sSave', m).onclick = () => {
        const key = $('#sKey', m).value.trim();
        if (key && !/^sk-ant-/.test(key)) { toast('API keys start with sk-ant-'); return; }
        if (key !== s.apiKey) client = null;
        Object.assign(s, { name: $('#sName', m).value.trim(), location: $('#sLoc', m).value.trim(), apiKey: key, model: $('#sModel', m).value, voice: $('#sVoice', m).value });
        save(); closeModal(); render(); toast('Saved');
      };
      $('#sExport', m).onclick = () => {
        const data = Object.assign({}, S, { settings: Object.assign({}, S.settings, { apiKey: '' }) });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ state: data, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
        a.download = 'jarvis-backup-' + today() + '.json'; a.click(); URL.revokeObjectURL(a.href);
        toast('Backup saved (API key not included)');
      };
      $('#sImport', m).onclick = () => $('#sFile', m).click();
      $('#sFile', m).onchange = () => {
        const f = $('#sFile', m).files[0]; if (!f) return;
        f.text().then((txt) => {
          const d = JSON.parse(txt);
          if (!d.state || !Array.isArray(d.state.leads)) throw new Error('bad');
          if (!confirm('Replace your Jarvis data with this backup?')) return;
          const key = S.settings.apiKey;
          S = Object.assign(freshState(), d.state); S.settings = Object.assign(freshState().settings, d.state.settings, { apiKey: key });
          save(); closeModal(); render(); toast('Restored');
        }).catch(() => toast('That is not a Jarvis backup file'));
      };
      $('#sWipe', m).onclick = () => {
        if (!confirm('Erase your API key, memory, leads, tasks, docs and conversation from this device?')) return;
        S = freshState(); thread = { started: '', messages: [] }; localNotes = []; client = null; save(); closeModal(); render();
      };
    });
}

// ---------- Modal & form helpers ----------
const backdrop = $('#modalBackdrop'), sheet = $('#modalSheet');
function openModal(title, body, onMount) {
  sheet.innerHTML = '<div class="modal-head"><h2>' + esc(title) + '</h2><button class="modal-close" id="mClose" aria-label="Close">✕</button></div>' + body;
  backdrop.hidden = false; $('#mClose').onclick = closeModal; if (onMount) onMount(sheet);
}
function closeModal() { backdrop.hidden = true; sheet.innerHTML = ''; }
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
function field(label, type, id, value, ph) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input type="' + type + '" id="' + id + '" value="' + esc(value == null ? '' : value) + '"' +
    (ph ? ' placeholder="' + esc(ph) + '"' : '') + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + ' autocomplete="off"></div>';
}
function areaField(label, id, value) { return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><textarea id="' + id + '">' + esc(value || '') + '</textarea></div>'; }
function selectField(label, id, options, selected, labelFn) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' + options.map((o) =>
    '<option value="' + esc(o) + '"' + (o === selected ? ' selected' : '') + '>' + esc(labelFn ? labelFn(o) : o) + '</option>').join('') + '</select></div>';
}

// ---------- Top bar ----------
$('#settingsBtn').onclick = openSettings;
$('#briefBtn').onclick = () => { if (!S.settings.apiKey) return openSettings(); setTab('chat'); dailyBrief(); };
$('#newChatBtn').onclick = () => {
  if (busy) return;
  if (thread.messages.length && !confirm('Start a fresh conversation? Jarvis keeps your business profile, notes, leads, tasks and docs.')) return;
  thread = { started: today(), messages: [] }; localNotes = []; save(); setTab('chat');
};

// ---------- Boot ----------
await loadAll();
// Start each day with a fresh conversation (memory lives in the profile, notes, leads, tasks and docs).
// This keeps replies fast and costs down.
if (thread.started && thread.started !== today() && thread.messages.length) { thread = { started: today(), messages: [] }; save(); }
render();
