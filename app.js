/* Hauler HQ — CRM, invoicing & money tracking for a hauling business.
   All data lives in localStorage on this device. Use Settings → Backup to export. */
(function () {
  'use strict';

  var STORE_KEY = 'haulerhq_v1';

  var EXPENSE_CATEGORIES = ['Fuel', 'Maintenance & Repairs', 'Insurance', 'Permits & Fees', 'Dump/Disposal Fees', 'Labor', 'Equipment', 'Truck Payment', 'Other'];
  var JOB_STATUSES = ['scheduled', 'in-progress', 'completed', 'invoiced'];

  // ---------- State ----------
  var db = load();
  var currentTab = 'dashboard';
  var subView = null; // {type:'customer'|'job'|'invoice', id: ...}
  var filters = { jobs: 'upcoming', invoices: 'all', customerSearch: '', moneyRange: 'month' };

  function defaults() {
    return {
      customers: [],
      jobs: [],
      invoices: [],
      expenses: [],
      settings: {
        businessName: 'Avery Hauling Services LLC',
        ownerName: '',
        phone: '',
        email: '',
        address: '',
        invoicePrefix: 'INV-',
        nextInvoiceNum: 1,
        taxRate: 0,
        paymentTerms: 14,
        paymentInstructions: '',
        jarvisVoice: 'on',
        jarvisAutoBrief: 'on',
        weatherPlace: '',
        weatherLat: '',
        weatherLon: '',
        lastBackup: '',
        lastBriefDate: ''
      }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      var data = JSON.parse(raw);
      var d = defaults();
      data.settings = Object.assign(d.settings, data.settings || {});
      return Object.assign(d, data);
    } catch (e) {
      return defaults();
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Helpers ----------
  var fmtMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(n) { return fmtMoney.format(Number(n) || 0); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + Number(days || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getCustomer(id) {
    return db.customers.find(function (c) { return c.id === id; });
  }
  function customerName(id) {
    var c = getCustomer(id);
    return c ? c.name : 'Unknown customer';
  }

  function invoiceSubtotal(inv) {
    return inv.items.reduce(function (s, it) { return s + (Number(it.qty) || 0) * (Number(it.rate) || 0); }, 0);
  }
  function invoiceTax(inv) { return invoiceSubtotal(inv) * (Number(inv.taxRate) || 0) / 100; }
  function invoiceTotal(inv) { return invoiceSubtotal(inv) + invoiceTax(inv); }

  function invoiceStatus(inv) {
    if (inv.status === 'sent' && inv.dueDate && inv.dueDate < todayStr()) return 'overdue';
    return inv.status;
  }

  function inRange(dateStr, range) {
    if (!dateStr) return false;
    var now = new Date();
    if (range === 'month') {
      return dateStr.slice(0, 7) === todayStr().slice(0, 7);
    }
    if (range === 'year') {
      return dateStr.slice(0, 4) === String(now.getFullYear());
    }
    return true; // 'all'
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  // ---------- Modal ----------
  var backdrop = document.getElementById('modalBackdrop');
  var sheet = document.getElementById('modalSheet');

  function openModal(title, bodyHtml, onMount) {
    sheet.innerHTML =
      '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button></div>' + bodyHtml;
    backdrop.hidden = false;
    document.getElementById('modalCloseBtn').onclick = closeModal;
    if (onMount) onMount(sheet);
  }
  function closeModal() {
    backdrop.hidden = true;
    sheet.innerHTML = '';
  }
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });

  // ---------- Rendering ----------
  var viewEl = document.getElementById('view');
  var fab = document.getElementById('fab');
  var titleEl = document.getElementById('topbarTitle');

  function render() {
    if (subView) {
      fab.hidden = true;
      if (subView.type === 'customer') return renderCustomerDetail(subView.id);
      if (subView.type === 'invoice') return renderInvoiceDetail(subView.id);
      if (subView.type === 'job') return renderJobDetail(subView.id);
    }
    fab.hidden = currentTab === 'dashboard' || currentTab === 'jarvis';
    var titles = { dashboard: db.settings.businessName || 'Hauler HQ', customers: 'Customers', jobs: 'Jobs', invoices: 'Invoices', money: 'Money', jarvis: 'Jarvis' };
    titleEl.textContent = titles[currentTab];
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'customers') renderCustomers();
    else if (currentTab === 'jobs') renderJobs();
    else if (currentTab === 'invoices') renderInvoices();
    else if (currentTab === 'money') renderMoney();
    else if (currentTab === 'jarvis') renderJarvis();
  }

  function setTab(tab) {
    currentTab = tab;
    subView = null;
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); });
  });

  fab.addEventListener('click', function () {
    if (currentTab === 'customers') customerForm();
    else if (currentTab === 'jobs') jobForm();
    else if (currentTab === 'invoices') invoiceForm();
    else if (currentTab === 'money') expenseForm();
  });

  document.getElementById('settingsBtn').addEventListener('click', settingsForm);

  // ---------- Dashboard ----------
  function renderDashboard() {
    var month = todayStr().slice(0, 7);
    var paidThisMonth = db.invoices
      .filter(function (i) { return i.status === 'paid' && (i.paidDate || '').slice(0, 7) === month; })
      .reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
    var outstanding = 0, overdueAmt = 0, overdueCount = 0;
    db.invoices.forEach(function (i) {
      var st = invoiceStatus(i);
      if (st === 'sent' || st === 'overdue') outstanding += invoiceTotal(i);
      if (st === 'overdue') { overdueAmt += invoiceTotal(i); overdueCount++; }
    });
    var expensesThisMonth = db.expenses
      .filter(function (e) { return (e.date || '').slice(0, 7) === month; })
      .reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var upcoming = db.jobs
      .filter(function (j) { return j.status === 'scheduled' || j.status === 'in-progress'; })
      .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })
      .slice(0, 4);
    var recentInvoices = db.invoices.slice().sort(function (a, b) {
      return (b.issueDate || '').localeCompare(a.issueDate || '');
    }).slice(0, 4);

    var html = '<button class="jv-card" data-act="jarvis"><span class="jv-orb mini"><span></span></span>' +
      '<span><strong>Ask Jarvis</strong><br><small>' + (db.settings.lastBriefDate === todayStr() ? 'Talk to me, or replay today\'s brief' : 'Your daily brief is ready') + '</small></span><span class="jv-go">›</span></button>';
    html += '<div class="stat-grid">' +
      stat('Collected this month', money(paidThisMonth), 'good') +
      stat('Outstanding', money(outstanding), outstanding > 0 ? 'warn' : '') +
      stat('Overdue', money(overdueAmt), overdueCount ? 'bad' : '', overdueCount ? overdueCount + ' invoice' + (overdueCount > 1 ? 's' : '') : 'Nothing overdue') +
      stat('Expenses this month', money(expensesThisMonth), '') +
      '</div>';

    html += '<div class="btn-row">' +
      '<button class="btn primary" data-act="newInvoice">🧾 New Invoice</button>' +
      '<button class="btn secondary" data-act="newJob">🚚 New Job</button>' +
      '</div><div class="btn-row">' +
      '<button class="btn secondary" data-act="newCustomer">👥 New Customer</button>' +
      '<button class="btn secondary" data-act="newExpense">💸 Log Expense</button>' +
      '</div>';

    html += '<div class="section-title">Upcoming jobs</div>';
    html += upcoming.length ? upcoming.map(jobRow).join('') :
      '<div class="card" style="color:var(--text-2);font-size:.85rem">No upcoming jobs. Tap “New Job” to schedule one.</div>';

    html += '<div class="section-title">Recent invoices</div>';
    html += recentInvoices.length ? recentInvoices.map(invoiceRow).join('') :
      '<div class="card" style="color:var(--text-2);font-size:.85rem">No invoices yet. Create your first one above.</div>';

    viewEl.innerHTML = html;

    viewEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.act;
        if (a === 'newInvoice') invoiceForm();
        if (a === 'newJob') jobForm();
        if (a === 'newCustomer') customerForm();
        if (a === 'newExpense') expenseForm();
        if (a === 'jarvis') setTab('jarvis');
      };
    });
    bindRows();
  }

  function stat(label, value, cls, hint) {
    return '<div class="stat ' + (cls || '') + '"><div class="label">' + esc(label) + '</div>' +
      '<div class="value">' + esc(value) + '</div>' +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  // ---------- Customers ----------
  function renderCustomers() {
    var q = filters.customerSearch.toLowerCase();
    var list = db.customers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .filter(function (c) {
        return !q || (c.name + ' ' + (c.company || '') + ' ' + (c.phone || '')).toLowerCase().indexOf(q) >= 0;
      });

    var html = '<div class="search"><input type="search" id="custSearch" placeholder="Search customers…" value="' + esc(filters.customerSearch) + '"></div>';
    if (!db.customers.length) {
      html += '<div class="empty"><div class="big">👥</div>No customers yet.<br>Tap ＋ to add your first customer.</div>';
    } else if (!list.length) {
      html += '<div class="empty">No matches for “' + esc(filters.customerSearch) + '”.</div>';
    } else {
      html += list.map(function (c) {
        var owed = db.invoices.filter(function (i) {
          var st = invoiceStatus(i);
          return i.customerId === c.id && (st === 'sent' || st === 'overdue');
        }).reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
        return '<button class="list-item" data-view="customer" data-id="' + c.id + '">' +
          '<div class="list-main"><div class="list-title">' + esc(c.name) + '</div>' +
          '<div class="list-sub">' + esc(c.company || c.phone || c.email || '') + '</div></div>' +
          '<div class="list-right">' + (owed > 0 ? '<div class="list-amount" style="color:var(--amber)">' + money(owed) + '</div><div class="list-sub">owed</div>' : '') + '</div>' +
          '</button>';
      }).join('');
    }
    viewEl.innerHTML = html;

    var search = document.getElementById('custSearch');
    search.oninput = function () {
      filters.customerSearch = search.value;
      renderCustomers();
      var s = document.getElementById('custSearch');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    };
    bindRows();
  }

  function renderCustomerDetail(id) {
    var c = getCustomer(id);
    if (!c) { subView = null; return render(); }
    titleEl.textContent = 'Customer';
    var jobs = db.jobs.filter(function (j) { return j.customerId === id; })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var invoices = db.invoices.filter(function (i) { return i.customerId === id; })
      .sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); });
    var totalBilled = invoices.reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
    var owed = invoices.filter(function (i) { var st = invoiceStatus(i); return st === 'sent' || st === 'overdue'; })
      .reduce(function (s, i) { return s + invoiceTotal(i); }, 0);

    var html = '<div class="detail-header"><button class="back-btn" id="backBtn">‹ Back</button></div>';
    html += '<div class="card"><h3 style="font-size:1.15rem">' + esc(c.name) + '</h3>' +
      (c.company ? '<div style="color:var(--text-2);font-size:.85rem">' + esc(c.company) + '</div>' : '');

    var actions = [];
    if (c.phone) {
      actions.push('<a href="tel:' + esc(c.phone) + '">📞 Call</a>');
      actions.push('<a href="sms:' + esc(c.phone) + '">💬 Text</a>');
    }
    if (c.email) actions.push('<a href="mailto:' + esc(c.email) + '">✉️ Email</a>');
    if (actions.length) html += '<div class="contact-actions">' + actions.join('') + '</div>';

    html += kv('Phone', c.phone) + kv('Email', c.email) + kv('Address', c.address) +
      kv('Total billed', money(totalBilled)) + kv('Currently owed', money(owed));
    if (c.notes) html += kv('Notes', c.notes);
    html += '</div>';

    html += '<div class="btn-row">' +
      '<button class="btn primary" id="custNewInvoice">🧾 Invoice</button>' +
      '<button class="btn secondary" id="custNewJob">🚚 New Job</button>' +
      '<button class="btn secondary" id="custEdit">✏️ Edit</button>' +
      '</div>';

    html += '<div class="section-title">Jobs (' + jobs.length + ')</div>';
    html += jobs.length ? jobs.map(jobRow).join('') : '<div class="card" style="color:var(--text-2);font-size:.85rem">No jobs yet for this customer.</div>';

    html += '<div class="section-title">Invoices (' + invoices.length + ')</div>';
    html += invoices.length ? invoices.map(invoiceRow).join('') : '<div class="card" style="color:var(--text-2);font-size:.85rem">No invoices yet for this customer.</div>';

    html += '<div class="btn-row" style="margin-top:20px"><button class="btn danger" id="custDelete">Delete customer</button></div>';

    viewEl.innerHTML = html;
    document.getElementById('backBtn').onclick = function () { subView = null; render(); };
    document.getElementById('custEdit').onclick = function () { customerForm(c); };
    document.getElementById('custNewJob').onclick = function () { jobForm(null, c.id); };
    document.getElementById('custNewInvoice').onclick = function () { invoiceForm(null, c.id); };
    document.getElementById('custDelete').onclick = function () {
      if (!confirm('Delete ' + c.name + '? Their jobs and invoices will be kept but unlinked.')) return;
      db.customers = db.customers.filter(function (x) { return x.id !== id; });
      save(); subView = null; render(); toast('Customer deleted');
    };
    bindRows();
  }

  function kv(k, v) {
    if (!v && v !== 0) return '';
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
  }

  function customerForm(existing) {
    var c = existing || {};
    openModal(existing ? 'Edit Customer' : 'New Customer',
      field('Name *', 'text', 'fName', c.name) +
      field('Company', 'text', 'fCompany', c.company) +
      '<div class="field-row">' +
      field('Phone', 'tel', 'fPhone', c.phone) +
      field('Email', 'email', 'fEmail', c.email) +
      '</div>' +
      fieldArea('Address', 'fAddress', c.address) +
      fieldArea('Notes', 'fNotes', c.notes) +
      '<button class="btn primary" id="fSave">Save Customer</button>',
      function (m) {
        m.querySelector('#fSave').onclick = function () {
          var name = m.querySelector('#fName').value.trim();
          if (!name) { toast('Name is required'); return; }
          var data = {
            name: name,
            company: m.querySelector('#fCompany').value.trim(),
            phone: m.querySelector('#fPhone').value.trim(),
            email: m.querySelector('#fEmail').value.trim(),
            address: m.querySelector('#fAddress').value.trim(),
            notes: m.querySelector('#fNotes').value.trim()
          };
          if (existing) Object.assign(existing, data);
          else db.customers.push(Object.assign({ id: uid(), createdAt: todayStr() }, data));
          save(); closeModal(); render();
          toast(existing ? 'Customer updated' : 'Customer added');
        };
      });
  }

  // ---------- Jobs ----------
  function jobRow(j) {
    return '<button class="list-item" data-view="job" data-id="' + j.id + '">' +
      '<div class="list-main"><div class="list-title">' + esc(customerName(j.customerId)) + ' — ' + esc(j.description || 'Haul') + '</div>' +
      '<div class="list-sub">' + fmtDate(j.date) + (j.origin ? ' · ' + esc(j.origin) + (j.destination ? ' → ' + esc(j.destination) : '') : '') + '</div></div>' +
      '<div class="list-right"><div class="list-amount">' + money(j.amount) + '</div>' +
      '<span class="badge ' + j.status + '">' + j.status.replace('-', ' ') + '</span></div></button>';
  }

  function renderJobs() {
    var f = filters.jobs;
    var list = db.jobs.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (f === 'upcoming') {
      list = list.filter(function (j) { return j.status === 'scheduled' || j.status === 'in-progress'; })
        .sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    } else if (f === 'completed') {
      list = list.filter(function (j) { return j.status === 'completed' || j.status === 'invoiced'; });
    }

    var html = chips([['upcoming', 'Upcoming'], ['completed', 'Done'], ['all', 'All']], f, 'jobs');
    if (!db.jobs.length) {
      html += '<div class="empty"><div class="big">🚚</div>No jobs yet.<br>Tap ＋ to schedule your first haul.</div>';
    } else if (!list.length) {
      html += '<div class="empty">Nothing here.</div>';
    } else {
      html += list.map(jobRow).join('');
    }
    viewEl.innerHTML = html;
    bindChips('jobs');
    bindRows();
  }

  function renderJobDetail(id) {
    var j = db.jobs.find(function (x) { return x.id === id; });
    if (!j) { subView = null; return render(); }
    titleEl.textContent = 'Job';
    var html = '<div class="detail-header"><button class="back-btn" id="backBtn">‹ Back</button></div>';
    html += '<div class="card"><h3 style="font-size:1.05rem">' + esc(j.description || 'Haul') + '</h3>' +
      '<div style="margin:4px 0 8px"><span class="badge ' + j.status + '">' + j.status.replace('-', ' ') + '</span></div>' +
      kv('Customer', customerName(j.customerId)) +
      kv('Date', fmtDate(j.date)) +
      kv('Load type', j.loadType) +
      kv('From', j.origin) + kv('To', j.destination) +
      kv('Amount', money(j.amount)) +
      kv('Notes', j.notes) + '</div>';

    html += '<div class="btn-row">';
    if (j.status === 'scheduled') html += '<button class="btn primary" data-status="in-progress">▶️ Start Job</button>';
    if (j.status === 'in-progress') html += '<button class="btn primary" data-status="completed">✅ Mark Done</button>';
    if (j.status === 'completed') html += '<button class="btn primary" id="jobInvoice">🧾 Create Invoice</button>';
    html += '<button class="btn secondary" id="jobEdit">✏️ Edit</button></div>';
    html += '<div class="btn-row"><button class="btn danger" id="jobDelete">Delete job</button></div>';

    viewEl.innerHTML = html;
    document.getElementById('backBtn').onclick = function () { subView = null; render(); };
    document.getElementById('jobEdit').onclick = function () { jobForm(j); };
    var st = viewEl.querySelector('[data-status]');
    if (st) st.onclick = function () { j.status = st.dataset.status; save(); render(); toast('Job updated'); };
    var ji = document.getElementById('jobInvoice');
    if (ji) ji.onclick = function () { invoiceForm(null, j.customerId, [j]); };
    document.getElementById('jobDelete').onclick = function () {
      if (!confirm('Delete this job?')) return;
      db.jobs = db.jobs.filter(function (x) { return x.id !== id; });
      save(); subView = null; render(); toast('Job deleted');
    };
  }

  function jobForm(existing, presetCustomerId) {
    if (!db.customers.length) { toast('Add a customer first'); customerForm(); return; }
    var j = existing || {};
    openModal(existing ? 'Edit Job' : 'New Job',
      selectField('Customer *', 'fCustomer', db.customers.map(function (c) { return [c.id, c.name]; }), j.customerId || presetCustomerId) +
      '<div class="field-row">' +
      field('Date *', 'date', 'fDate', j.date || todayStr()) +
      field('Amount ($)', 'number', 'fAmount', j.amount, '0.00') +
      '</div>' +
      field('Description', 'text', 'fDesc', j.description, 'e.g. Junk removal, gravel delivery') +
      field('Load type', 'text', 'fLoad', j.loadType, 'e.g. Debris, Gravel, Furniture') +
      '<div class="field-row">' +
      field('From', 'text', 'fOrigin', j.origin) +
      field('To', 'text', 'fDest', j.destination) +
      '</div>' +
      selectField('Status', 'fStatus', JOB_STATUSES.map(function (s) { return [s, s.replace('-', ' ')]; }), j.status || 'scheduled') +
      fieldArea('Notes', 'fNotes', j.notes) +
      '<button class="btn primary" id="fSave">Save Job</button>',
      function (m) {
        m.querySelector('#fSave').onclick = function () {
          var data = {
            customerId: m.querySelector('#fCustomer').value,
            date: m.querySelector('#fDate').value,
            amount: Number(m.querySelector('#fAmount').value) || 0,
            description: m.querySelector('#fDesc').value.trim(),
            loadType: m.querySelector('#fLoad').value.trim(),
            origin: m.querySelector('#fOrigin').value.trim(),
            destination: m.querySelector('#fDest').value.trim(),
            status: m.querySelector('#fStatus').value,
            notes: m.querySelector('#fNotes').value.trim()
          };
          if (!data.customerId || !data.date) { toast('Customer and date are required'); return; }
          if (existing) Object.assign(existing, data);
          else db.jobs.push(Object.assign({ id: uid() }, data));
          save(); closeModal(); render();
          toast(existing ? 'Job updated' : 'Job added');
        };
      });
  }

  // ---------- Invoices ----------
  function invoiceRow(inv) {
    var st = invoiceStatus(inv);
    return '<button class="list-item" data-view="invoice" data-id="' + inv.id + '">' +
      '<div class="list-main"><div class="list-title">' + esc(inv.number) + ' · ' + esc(customerName(inv.customerId)) + '</div>' +
      '<div class="list-sub">' + (st === 'paid' ? 'Paid ' + fmtDate(inv.paidDate) : 'Due ' + fmtDate(inv.dueDate)) + '</div></div>' +
      '<div class="list-right"><div class="list-amount">' + money(invoiceTotal(inv)) + '</div>' +
      '<span class="badge ' + st + '">' + st + '</span></div></button>';
  }

  function renderInvoices() {
    var f = filters.invoices;
    var list = db.invoices.slice().sort(function (a, b) { return (b.issueDate || '').localeCompare(a.issueDate || ''); });
    if (f !== 'all') list = list.filter(function (i) { return invoiceStatus(i) === f; });

    var html = chips([['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['overdue', 'Overdue'], ['paid', 'Paid']], f, 'invoices');
    if (!db.invoices.length) {
      html += '<div class="empty"><div class="big">🧾</div>No invoices yet.<br>Tap ＋ to bill your first customer.</div>';
    } else if (!list.length) {
      html += '<div class="empty">No ' + esc(f) + ' invoices.</div>';
    } else {
      html += list.map(invoiceRow).join('');
    }
    viewEl.innerHTML = html;
    bindChips('invoices');
    bindRows();
  }

  function invoiceDocHtml(inv) {
    var s = db.settings;
    var c = getCustomer(inv.customerId);
    var st = invoiceStatus(inv);
    var rows = inv.items.map(function (it) {
      var amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
      return '<tr><td>' + esc(it.desc) + '</td><td class="num">' + esc(it.qty) + '</td>' +
        '<td class="num">' + money(it.rate) + '</td><td class="num">' + money(amt) + '</td></tr>';
    }).join('');
    var sub = invoiceSubtotal(inv), tax = invoiceTax(inv), total = invoiceTotal(inv);

    return '<div class="invoice-doc">' +
      '<div class="doc-head"><div>' +
      '<img class="doc-logo" src="assets/badge.png" alt="">' +
      '<div class="biz-name">' + esc(s.businessName) + '</div>' +
      '<div class="muted">' + esc([s.ownerName, s.phone, s.email, s.address].filter(Boolean).join('\n')) + '</div>' +
      '</div><div>' +
      '<div class="doc-title">INVOICE</div>' +
      '<div class="muted" style="text-align:right">' + esc(inv.number) +
      '\nIssued: ' + fmtDate(inv.issueDate) +
      '\nDue: ' + fmtDate(inv.dueDate) + '</div>' +
      (st === 'paid' ? '<div style="text-align:right"><span class="paid-stamp">Paid</span></div>' : '') +
      '</div></div>' +
      '<div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Bill to</div>' +
      '<div style="font-weight:700">' + esc(c ? c.name : 'Customer') + '</div>' +
      '<div class="muted">' + esc(c ? [c.company, c.address, c.phone, c.email].filter(Boolean).join('\n') : '') + '</div>' +
      '<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="totals">' +
      '<div class="kv"><span class="k">Subtotal</span><span class="v">' + money(sub) + '</span></div>' +
      (tax > 0 ? '<div class="kv"><span class="k">Tax (' + inv.taxRate + '%)</span><span class="v">' + money(tax) + '</span></div>' : '') +
      '<div class="kv grand"><span class="k">Total</span><span class="v">' + money(total) + '</span></div>' +
      '</div>' +
      (inv.notes ? '<div class="muted" style="margin-top:12px"><strong>Notes:</strong> ' + esc(inv.notes) + '</div>' : '') +
      (s.paymentInstructions ? '<div class="muted" style="margin-top:8px"><strong>Payment:</strong> ' + esc(s.paymentInstructions) + '</div>' : '') +
      '</div>';
  }

  function renderInvoiceDetail(id) {
    var inv = db.invoices.find(function (x) { return x.id === id; });
    if (!inv) { subView = null; return render(); }
    titleEl.textContent = 'Invoice ' + inv.number;
    var st = invoiceStatus(inv);

    var html = '<div class="detail-header"><button class="back-btn" id="backBtn">‹ Back</button>' +
      '<span class="badge ' + st + '">' + st + '</span></div>';
    html += invoiceDocHtml(inv);

    html += '<div class="btn-row">';
    if (inv.status === 'draft') html += '<button class="btn primary" id="invSend">📤 Mark Sent</button>';
    if (inv.status !== 'paid') html += '<button class="btn primary" id="invPaid">✅ Mark Paid</button>';
    if (inv.status === 'paid') html += '<button class="btn secondary" id="invUnpaid">Undo Paid</button>';
    html += '<button class="btn secondary" id="invPrint">🖨️ Print / PDF</button></div>';
    html += '<div class="btn-row">' +
      '<button class="btn secondary" id="invShare">📲 Share Text</button>' +
      '<button class="btn secondary" id="invEdit">✏️ Edit</button>' +
      '<button class="btn danger" id="invDelete">Delete</button></div>';

    viewEl.innerHTML = html;
    document.getElementById('backBtn').onclick = function () { subView = null; render(); };

    var send = document.getElementById('invSend');
    if (send) send.onclick = function () { inv.status = 'sent'; save(); render(); toast('Marked as sent'); };
    var paid = document.getElementById('invPaid');
    if (paid) paid.onclick = function () { inv.status = 'paid'; inv.paidDate = todayStr(); save(); render(); toast('Payment recorded 🎉'); };
    var unpaid = document.getElementById('invUnpaid');
    if (unpaid) unpaid.onclick = function () { inv.status = 'sent'; inv.paidDate = null; save(); render(); };

    document.getElementById('invPrint').onclick = function () {
      var pa = document.getElementById('printArea');
      pa.innerHTML = invoiceDocHtml(inv);
      window.print();
    };
    document.getElementById('invShare').onclick = function () {
      var text = db.settings.businessName + ' — Invoice ' + inv.number +
        '\nTotal: ' + money(invoiceTotal(inv)) +
        '\nDue: ' + fmtDate(inv.dueDate) +
        (db.settings.paymentInstructions ? '\nPay via: ' + db.settings.paymentInstructions : '') +
        '\nThank you for your business!';
      if (navigator.share) {
        navigator.share({ title: 'Invoice ' + inv.number, text: text }).catch(function () {});
      } else {
        navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); });
      }
    };
    document.getElementById('invEdit').onclick = function () { invoiceForm(inv); };
    document.getElementById('invDelete').onclick = function () {
      if (!confirm('Delete invoice ' + inv.number + '?')) return;
      db.invoices = db.invoices.filter(function (x) { return x.id !== id; });
      save(); subView = null; render(); toast('Invoice deleted');
    };
  }

  function invoiceForm(existing, presetCustomerId, fromJobs) {
    if (!db.customers.length) { toast('Add a customer first'); customerForm(); return; }
    var inv = existing || {
      items: [],
      taxRate: db.settings.taxRate,
      issueDate: todayStr(),
      dueDate: addDays(todayStr(), db.settings.paymentTerms)
    };
    // Working copy of items so cancel doesn't mutate
    var items = (existing ? existing.items.map(function (i) { return Object.assign({}, i); }) : []);
    var linkedJobIds = existing ? (existing.jobIds || []) : [];

    if (fromJobs && fromJobs.length) {
      fromJobs.forEach(function (j) {
        items.push({ desc: (j.description || 'Hauling') + (j.date ? ' — ' + fmtDate(j.date) : ''), qty: 1, rate: j.amount || 0 });
        linkedJobIds.push(j.id);
      });
    }
    if (!items.length) items.push({ desc: '', qty: 1, rate: '' });

    var custId = existing ? existing.customerId : presetCustomerId;

    function body() {
      var uninvoiced = db.jobs.filter(function (j) {
        return j.customerId === (sheet.querySelector('#fCustomer') ? sheet.querySelector('#fCustomer').value : custId) &&
          j.status === 'completed' && linkedJobIds.indexOf(j.id) < 0;
      });
      return selectField('Customer *', 'fCustomer', db.customers.map(function (c) { return [c.id, c.name]; }), custId) +
        '<div class="field-row">' +
        field('Issue date', 'date', 'fIssue', inv.issueDate) +
        field('Due date', 'date', 'fDue', inv.dueDate) +
        '</div>' +
        '<div class="field"><label>Line items</label><div id="lineItems"></div>' +
        '<button class="btn secondary small" id="addLine">＋ Add line</button> ' +
        (uninvoiced.length ? '<button class="btn secondary small" id="pullJobs">📥 Add ' + uninvoiced.length + ' completed job' + (uninvoiced.length > 1 ? 's' : '') + '</button>' : '') +
        '</div>' +
        '<div class="field-row">' +
        field('Tax rate (%)', 'number', 'fTax', inv.taxRate, '0') +
        '</div>' +
        fieldArea('Notes on invoice', 'fNotes', inv.notes) +
        '<div id="invTotals"></div>' +
        '<button class="btn primary" id="fSave">' + (existing ? 'Save Changes' : 'Create Invoice') + '</button>';
    }

    openModal(existing ? 'Edit Invoice ' + existing.number : 'New Invoice', body(), function (m) {
      function renderLines() {
        var wrap = m.querySelector('#lineItems');
        wrap.innerHTML = items.map(function (it, idx) {
          return '<div class="line-item" data-idx="' + idx + '">' +
            '<input type="text" placeholder="Description" class="li-desc" value="' + esc(it.desc) + '">' +
            '<input type="number" placeholder="Qty" class="li-qty" inputmode="decimal" value="' + esc(it.qty) + '">' +
            '<input type="number" placeholder="Rate" class="li-rate" inputmode="decimal" value="' + esc(it.rate) + '">' +
            '<button class="rm" aria-label="Remove line">✕</button></div>';
        }).join('');
        wrap.querySelectorAll('.line-item').forEach(function (row) {
          var idx = Number(row.dataset.idx);
          row.querySelector('.li-desc').oninput = function (e) { items[idx].desc = e.target.value; };
          row.querySelector('.li-qty').oninput = function (e) { items[idx].qty = e.target.value; renderTotals(); };
          row.querySelector('.li-rate').oninput = function (e) { items[idx].rate = e.target.value; renderTotals(); };
          row.querySelector('.rm').onclick = function () { items.splice(idx, 1); if (!items.length) items.push({ desc: '', qty: 1, rate: '' }); renderLines(); renderTotals(); };
        });
        renderTotals();
      }
      function renderTotals() {
        var fake = { items: items, taxRate: Number(m.querySelector('#fTax').value) || 0 };
        var sub = invoiceSubtotal(fake), tax = invoiceTax(fake);
        m.querySelector('#invTotals').innerHTML =
          '<div class="line-total-row"><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
          (tax > 0 ? '<div class="line-total-row"><span>Tax</span><span>' + money(tax) + '</span></div>' : '') +
          '<div class="line-total-row grand"><span>Total</span><span>' + money(sub + tax) + '</span></div>';
      }
      renderLines();
      m.querySelector('#fTax').oninput = renderTotals;
      m.querySelector('#addLine').onclick = function () { items.push({ desc: '', qty: 1, rate: '' }); renderLines(); };
      var pull = m.querySelector('#pullJobs');
      if (pull) pull.onclick = function () {
        var cid = m.querySelector('#fCustomer').value;
        db.jobs.filter(function (j) { return j.customerId === cid && j.status === 'completed' && linkedJobIds.indexOf(j.id) < 0; })
          .forEach(function (j) {
            items.push({ desc: (j.description || 'Hauling') + (j.date ? ' — ' + fmtDate(j.date) : ''), qty: 1, rate: j.amount || 0 });
            linkedJobIds.push(j.id);
          });
        // Drop the initial blank line if it's still empty
        items = items.filter(function (it) { return it.desc || Number(it.rate); });
        pull.remove();
        renderLines();
        toast('Jobs added to invoice');
      };

      m.querySelector('#fSave').onclick = function () {
        var cleanItems = items.filter(function (it) { return (it.desc && it.desc.trim()) || Number(it.rate); })
          .map(function (it) { return { desc: it.desc.trim() || 'Hauling services', qty: Number(it.qty) || 1, rate: Number(it.rate) || 0 }; });
        if (!cleanItems.length) { toast('Add at least one line item'); return; }
        var data = {
          customerId: m.querySelector('#fCustomer').value,
          issueDate: m.querySelector('#fIssue').value || todayStr(),
          dueDate: m.querySelector('#fDue').value || addDays(todayStr(), db.settings.paymentTerms),
          taxRate: Number(m.querySelector('#fTax').value) || 0,
          notes: m.querySelector('#fNotes').value.trim(),
          items: cleanItems,
          jobIds: linkedJobIds
        };
        if (existing) {
          Object.assign(existing, data);
        } else {
          var num = db.settings.invoicePrefix + String(db.settings.nextInvoiceNum).padStart(4, '0');
          db.settings.nextInvoiceNum++;
          var newInv = Object.assign({ id: uid(), number: num, status: 'draft', paidDate: null }, data);
          db.invoices.push(newInv);
          subView = { type: 'invoice', id: newInv.id };
        }
        // Mark linked jobs as invoiced
        linkedJobIds.forEach(function (jid) {
          var j = db.jobs.find(function (x) { return x.id === jid; });
          if (j && j.status === 'completed') j.status = 'invoiced';
        });
        save(); closeModal(); render();
        toast(existing ? 'Invoice updated' : 'Invoice created');
      };
    });
  }

  // ---------- Money (expenses + reports + backup) ----------
  function renderMoney() {
    var range = filters.moneyRange;
    var income = db.invoices.filter(function (i) { return i.status === 'paid' && inRange(i.paidDate, range); })
      .reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
    var expList = db.expenses.filter(function (e) { return inRange(e.date, range); })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var expTotal = expList.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
    var profit = income - expTotal;

    var byCat = {};
    expList.forEach(function (e) {
      byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0);
    });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var maxCat = cats.length ? byCat[cats[0]] : 1;

    var rangeLabel = range === 'month' ? 'This month' : range === 'year' ? 'This year' : 'All time';

    var html = chips([['month', 'This Month'], ['year', 'This Year'], ['all', 'All Time']], range, 'moneyRange');
    html += '<div class="stat-grid">' +
      stat('Income (paid)', money(income), 'good', rangeLabel) +
      stat('Expenses', money(expTotal), '', rangeLabel) +
      '</div><div class="stat-grid" style="grid-template-columns:1fr">' +
      stat('Profit', money(profit), profit >= 0 ? 'good' : 'bad', rangeLabel) +
      '</div>';

    if (cats.length) {
      html += '<div class="section-title">Expenses by category</div><div class="card">' +
        cats.map(function (c) {
          return '<div class="cat-row"><div class="cat-head"><span>' + esc(c) + '</span><strong>' + money(byCat[c]) + '</strong></div>' +
            '<div class="cat-bar"><div style="width:' + Math.max(4, Math.round(byCat[c] / maxCat * 100)) + '%"></div></div></div>';
        }).join('') + '</div>';
    }

    html += '<div class="section-title">Expenses (' + expList.length + ')</div>';
    if (!expList.length) {
      html += '<div class="card" style="color:var(--text-2);font-size:.85rem">No expenses logged ' + rangeLabel.toLowerCase() + '. Tap ＋ to log fuel, repairs, dump fees…</div>';
    } else {
      html += expList.map(function (e) {
        return '<button class="list-item" data-expense="' + e.id + '">' +
          '<div class="list-main"><div class="list-title">' + esc(e.category) + (e.description ? ' — ' + esc(e.description) : '') + '</div>' +
          '<div class="list-sub">' + fmtDate(e.date) + '</div></div>' +
          '<div class="list-right"><div class="list-amount" style="color:var(--red)">−' + money(e.amount) + '</div></div></button>';
      }).join('');
    }

    viewEl.innerHTML = html;
    bindChips('moneyRange');
    viewEl.querySelectorAll('[data-expense]').forEach(function (row) {
      row.onclick = function () {
        var e = db.expenses.find(function (x) { return x.id === row.dataset.expense; });
        if (e) expenseForm(e);
      };
    });
  }

  function expenseForm(existing) {
    var e = existing || {};
    openModal(existing ? 'Edit Expense' : 'Log Expense',
      '<div class="field-row">' +
      field('Amount ($) *', 'number', 'fAmount', e.amount, '0.00') +
      field('Date *', 'date', 'fDate', e.date || todayStr()) +
      '</div>' +
      selectField('Category', 'fCategory', EXPENSE_CATEGORIES.map(function (c) { return [c, c]; }), e.category || 'Fuel') +
      field('Description', 'text', 'fDesc', e.description, 'e.g. Diesel fill-up, new tires') +
      '<button class="btn primary" id="fSave">Save Expense</button>' +
      (existing ? '<div style="height:9px"></div><button class="btn danger" id="fDelete">Delete Expense</button>' : ''),
      function (m) {
        m.querySelector('#fSave').onclick = function () {
          var amount = Number(m.querySelector('#fAmount').value);
          var date = m.querySelector('#fDate').value;
          if (!amount || !date) { toast('Amount and date are required'); return; }
          var data = {
            amount: amount,
            date: date,
            category: m.querySelector('#fCategory').value,
            description: m.querySelector('#fDesc').value.trim()
          };
          if (existing) Object.assign(existing, data);
          else db.expenses.push(Object.assign({ id: uid() }, data));
          save(); closeModal(); render();
          toast('Expense saved');
        };
        var del = m.querySelector('#fDelete');
        if (del) del.onclick = function () {
          db.expenses = db.expenses.filter(function (x) { return x.id !== existing.id; });
          save(); closeModal(); render(); toast('Expense deleted');
        };
      });
  }

  // ---------- Settings & backup ----------
  function settingsForm() {
    var s = db.settings;
    openModal('Business Settings',
      field('Business name', 'text', 'fBiz', s.businessName) +
      field('Your name', 'text', 'fOwner', s.ownerName) +
      '<div class="field-row">' +
      field('Phone', 'tel', 'fPhone', s.phone) +
      field('Email', 'email', 'fEmail', s.email) +
      '</div>' +
      fieldArea('Business address', 'fAddress', s.address) +
      '<div class="field-row">' +
      field('Invoice prefix', 'text', 'fPrefix', s.invoicePrefix) +
      field('Next invoice #', 'number', 'fNext', s.nextInvoiceNum) +
      '</div>' +
      '<div class="field-row">' +
      field('Default tax rate (%)', 'number', 'fTax', s.taxRate) +
      field('Payment terms (days)', 'number', 'fTerms', s.paymentTerms) +
      '</div>' +
      fieldArea('Payment instructions (shows on invoices)', 'fPay', s.paymentInstructions, 'e.g. Zelle to 555-123-4567, checks payable to…') +
      '<div class="section-title">Jarvis</div>' +
      '<div class="field"><label for="fPlace">Weather location (town or ZIP)</label><div class="field-row">' +
      '<input type="text" id="fPlace" value="' + esc(s.weatherPlace) + '" placeholder="e.g. Tulsa, OK or 74103">' +
      '<button type="button" class="btn small secondary" id="fLocate">📍 Use mine</button></div></div>' +
      '<div class="field-row">' +
      selectField('Jarvis voice', 'fVoice', [['on', 'Speak out loud'], ['off', 'Text only']], s.jarvisVoice) +
      selectField('Daily brief', 'fAutoBrief', [['on', 'Open on first launch each day'], ['off', 'Only when I ask']], s.jarvisAutoBrief) +
      '</div>' +
      '<button class="btn primary" id="fSave">Save Settings</button>' +
      '<div class="section-title">Backup &amp; restore</div>' +
      '<div class="btn-row">' +
      '<button class="btn secondary" id="fExport">⬇️ Export Backup</button>' +
      '<button class="btn secondary" id="fImport">⬆️ Restore Backup</button>' +
      '</div>' +
      '<input type="file" id="fImportFile" accept="application/json" hidden>' +
      '<p style="font-size:.75rem;color:var(--text-2);margin-top:6px">Your data lives only on this device. Export a backup regularly and keep it somewhere safe (email it to yourself, save to cloud storage).</p>',
      function (m) {
        m.querySelector('#fSave').onclick = function () {
          s.businessName = m.querySelector('#fBiz').value.trim() || 'Avery Hauling Services LLC';
          s.ownerName = m.querySelector('#fOwner').value.trim();
          s.phone = m.querySelector('#fPhone').value.trim();
          s.email = m.querySelector('#fEmail').value.trim();
          s.address = m.querySelector('#fAddress').value.trim();
          s.invoicePrefix = m.querySelector('#fPrefix').value || 'INV-';
          s.nextInvoiceNum = Number(m.querySelector('#fNext').value) || 1;
          s.taxRate = Number(m.querySelector('#fTax').value) || 0;
          s.paymentTerms = Number(m.querySelector('#fTerms').value) || 14;
          s.paymentInstructions = m.querySelector('#fPay').value.trim();
          s.jarvisVoice = m.querySelector('#fVoice').value;
          s.jarvisAutoBrief = m.querySelector('#fAutoBrief').value;
          var place = m.querySelector('#fPlace').value.trim();
          var saveBtn = m.querySelector('#fSave');
          function done() { save(); closeModal(); render(); toast('Settings saved'); }
          if (place === s.weatherPlace || place === (s.weatherPlace || '').split(' (')[0]) return done();
          if (!place) { s.weatherPlace = ''; s.weatherLat = ''; s.weatherLon = ''; return done(); }
          saveBtn.textContent = 'Finding ' + place + '…';
          geocode(place).then(function (loc) {
            if (!loc) { saveBtn.textContent = 'Save Settings'; toast('Couldn\'t find that location — try a ZIP code'); return; }
            s.weatherPlace = loc.name; s.weatherLat = loc.lat; s.weatherLon = loc.lon;
            done();
          });
        };
        m.querySelector('#fLocate').onclick = function () {
          if (!navigator.geolocation) { toast('Location isn\'t available on this device'); return; }
          toast('Getting your location…');
          navigator.geolocation.getCurrentPosition(function (pos) {
            s.weatherLat = Math.round(pos.coords.latitude * 100) / 100;
            s.weatherLon = Math.round(pos.coords.longitude * 100) / 100;
            s.weatherPlace = 'My location';
            m.querySelector('#fPlace').value = 'My location';
            save(); toast('Location saved for weather');
          }, function () { toast('Location permission denied — type a town or ZIP instead'); }, { timeout: 10000 });
        };
        m.querySelector('#fExport').onclick = function () {
          var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'haulerhq-backup-' + todayStr() + '.json';
          a.click();
          URL.revokeObjectURL(a.href);
          s.lastBackup = todayStr(); save();
          toast('Backup downloaded');
        };
        var fileInput = m.querySelector('#fImportFile');
        m.querySelector('#fImport').onclick = function () { fileInput.click(); };
        fileInput.onchange = function () {
          var file = fileInput.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            try {
              var data = JSON.parse(reader.result);
              if (!data || !Array.isArray(data.customers)) throw new Error('bad format');
              if (!confirm('Replace all current data with this backup?')) return;
              db = Object.assign(defaults(), data);
              db.settings = Object.assign(defaults().settings, data.settings || {});
              save(); closeModal(); render(); toast('Backup restored');
            } catch (err) {
              toast('That file is not a valid backup');
            }
          };
          reader.readAsText(file);
        };
      });
  }

  // ---------- Form helpers ----------
  function field(label, type, id, value, placeholder) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="' + type + '" id="' + id + '" value="' + esc(value == null ? '' : value) + '"' +
      (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') +
      (type === 'number' ? ' inputmode="decimal" step="any"' : '') + '></div>';
  }
  function fieldArea(label, id, value, placeholder) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<textarea id="' + id + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>' + esc(value || '') + '</textarea></div>';
  }
  function selectField(label, id, options, selected) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' +
      options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>';
  }
  function chips(options, active, filterKey) {
    return '<div class="chips" data-filter="' + filterKey + '">' + options.map(function (o) {
      return '<button class="chip' + (o[0] === active ? ' active' : '') + '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function bindChips(filterKey) {
    var wrap = viewEl.querySelector('[data-filter="' + filterKey + '"]');
    if (!wrap) return;
    wrap.querySelectorAll('.chip').forEach(function (ch) {
      ch.onclick = function () { filters[filterKey] = ch.dataset.val; render(); };
    });
  }
  function bindRows() {
    viewEl.querySelectorAll('[data-view]').forEach(function (row) {
      row.onclick = function () {
        subView = { type: row.dataset.view, id: row.dataset.id };
        render();
        window.scrollTo(0, 0);
      };
    });
  }

  // ---------- Jarvis: voice assistant & daily brief ----------
  var jarvisLog = [];           // [{from:'jarvis'|'me', html:string}]
  var jarvisUndo = null;        // last voice-logged expense id
  var jarvisListening = false;
  var jarvisLastBrief = null;
  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var WEATHER_KEY = 'haulerhq_weather';

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function spokenMoney(n) {
    n = Number(n) || 0;
    var whole = Math.round(n);
    return Math.abs(n - whole) < 0.005 ? '$' + whole.toLocaleString('en-US') : money(n);
  }
  function jobsOn(dateStr) {
    return db.jobs.filter(function (j) {
      return j.date === dateStr && (j.status === 'scheduled' || j.status === 'in-progress');
    });
  }
  function openInvoices() {
    return db.invoices.filter(function (i) { var st = invoiceStatus(i); return st === 'sent' || st === 'overdue'; });
  }
  function overdueInvoices() {
    return db.invoices.filter(function (i) { return invoiceStatus(i) === 'overdue'; })
      .sort(function (a, b) { return invoiceTotal(b) - invoiceTotal(a); });
  }
  function uninvoicedJobs() {
    return db.jobs.filter(function (j) { return j.status === 'completed'; });
  }
  function missedJobs() {
    var t = todayStr();
    return db.jobs.filter(function (j) { return j.status === 'scheduled' && j.date && j.date < t; });
  }
  function incomeBetween(from, to) {
    return db.invoices.filter(function (i) { return i.status === 'paid' && i.paidDate >= from && i.paidDate <= to; })
      .reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
  }
  function expensesBetween(from, to) {
    return db.expenses.filter(function (e) { return e.date >= from && e.date <= to; })
      .reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
  }
  function periodRange(text) {
    var t = todayStr(), d = new Date();
    if (/last month/.test(text)) {
      var lm = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      var end = new Date(d.getFullYear(), d.getMonth(), 0);
      return { label: 'last month', from: lm.getFullYear() + '-' + pad(lm.getMonth() + 1) + '-01', to: end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate()) };
    }
    if (/year|ytd/.test(text)) return { label: 'this year', from: t.slice(0, 4) + '-01-01', to: t };
    if (/week/.test(text)) return { label: 'the last 7 days', from: addDays(t, -6), to: t };
    if (/today/.test(text)) return { label: 'today', from: t, to: t };
    if (/all time|ever|total/.test(text)) return { label: 'all time', from: '0000-01-01', to: '9999-12-31' };
    return { label: 'this month', from: t.slice(0, 8) + '01', to: t };
  }
  function jobLine(j) {
    var where = j.origin ? ' at ' + j.origin + (j.destination ? ' → ' + j.destination : '') : '';
    return customerName(j.customerId) + ' — ' + (j.description || 'Haul') + where + (j.amount ? ' (' + money(j.amount) + ')' : '');
  }
  function jobSpoken(j) {
    return customerName(j.customerId) + ', ' + (j.description || 'a haul') + (j.origin ? ' at ' + j.origin : '');
  }

  // --- Weather (Open-Meteo, free, no key) ---
  var WMO = { 0: 'clear skies', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers',
    82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail' };

  function geocode(place) {
    var zip = /^\d{5}$/.test(place);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
      encodeURIComponent(zip ? place : place.split(',')[0].trim()) + (zip ? '&countryCode=US' : '');
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var r = d && d.results && d.results[0];
      if (!r) return null;
      return { name: r.name + (r.admin1 ? ', ' + r.admin1 : '') + (zip ? ' (' + place + ')' : ''), lat: r.latitude, lon: r.longitude };
    }).catch(function () { return null; });
  }

  function getWeather() {
    var s = db.settings;
    if (s.weatherLat == null || s.weatherLon == null || s.weatherLat === '') return Promise.resolve(null);
    var key = todayStr() + '|' + s.weatherLat + ',' + s.weatherLon;
    try {
      var cached = JSON.parse(localStorage.getItem(WEATHER_KEY) || 'null');
      if (cached && cached.key === key && Date.now() - cached.at < 3 * 3600 * 1000) return Promise.resolve(cached.data);
    } catch (e) {}
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + s.weatherLat + '&longitude=' + s.weatherLon +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3';
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data || !data.daily) return null;
      var d = data.daily, days = [];
      for (var i = 0; i < d.time.length; i++) {
        days.push({ date: d.time[i], code: d.weather_code[i], hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]),
          rain: d.precipitation_probability_max[i] || 0, wind: Math.round(d.wind_speed_10m_max[i]), gust: Math.round(d.wind_gusts_10m_max[i]) });
      }
      try { localStorage.setItem(WEATHER_KEY, JSON.stringify({ key: key, at: Date.now(), data: days })); } catch (e) {}
      return days;
    }).catch(function () { return null; });
  }
  function weatherAlerts(w) {
    var a = [];
    if (w.code >= 95) a.push('Thunderstorms expected — avoid open-bed loads and plan around lightning.');
    else if (w.rain >= 50) a.push(w.rain + '% chance of rain — bring tarps and straps, and expect slow dump-site traffic.');
    if (w.gust >= 35 || w.wind >= 25) a.push('Gusts to ' + w.gust + ' mph — secure loose debris and tarp everything.');
    if (w.hi >= 95) a.push('Heat at ' + w.hi + '° — pack extra water and take breaks.');
    if (w.lo <= 32 || [56, 57, 66, 67, 71, 73, 75, 77, 85, 86].indexOf(w.code) >= 0) a.push('Freezing conditions — watch for ice on ramps and the trailer deck.');
    return a;
  }
  function weatherSentence(w, place) {
    return (place ? place + ': ' : '') + (WMO[w.code] || 'mixed conditions') + ', high of ' + w.hi + '°, low of ' + w.lo + '°' +
      (w.rain ? ', ' + w.rain + '% chance of rain' : '') + ', wind up to ' + w.wind + ' mph.';
  }

  // --- The daily brief ---
  function buildBrief() {
    return getWeather().then(function (wx) {
      var s = db.settings, t = todayStr(), now = new Date();
      var hr = now.getHours();
      var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
      var who = s.ownerName ? ', ' + s.ownerName.split(' ')[0] : '';
      var dateLong = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      var sections = [], speech = [greet + who + '. Here is your brief for ' + dateLong + '.'];
      var priorities = [];

      var today = jobsOn(t).sort(function (a, b) { return (a.status === 'in-progress' ? -1 : 0) - (b.status === 'in-progress' ? -1 : 0); });
      var tomorrow = jobsOn(addDays(t, 1));
      var missed = missedJobs();
      var overdue = overdueInvoices();
      var dueSoon = db.invoices.filter(function (i) { return i.status === 'sent' && i.dueDate >= t && i.dueDate <= addDays(t, 3); });
      var drafts = db.invoices.filter(function (i) { return i.status === 'draft'; });
      var unbilled = uninvoicedJobs();
      var unbilledAmt = unbilled.reduce(function (sum, j) { return sum + (Number(j.amount) || 0); }, 0);
      var overdueAmt = overdue.reduce(function (sum, i) { return sum + invoiceTotal(i); }, 0);
      var outstanding = openInvoices().reduce(function (sum, i) { return sum + invoiceTotal(i); }, 0);

      // Priorities first — what actually needs doing today
      if (missed.length) priorities.push('Close out or reschedule ' + plural(missed.length, 'past-due job') + '.');
      if (today.length) priorities.push('Run ' + plural(today.length, 'job') + ' on today\'s schedule.');
      if (unbilled.length) priorities.push('Invoice ' + plural(unbilled.length, 'finished job') + ' — ' + money(unbilledAmt) + ' not billed yet.');
      if (overdue.length) priorities.push('Chase ' + money(overdueAmt) + ' in overdue payments, starting with ' + customerName(overdue[0].customerId) + '.');
      if (drafts.length) priorities.push('Send ' + plural(drafts.length, 'draft invoice') + ' sitting unsent.');
      if (!priorities.length) priorities.push('Nothing urgent. Good day to line up new work.');
      sections.push({ icon: '🎯', title: 'Top priorities', tone: 'accent', lines: priorities.slice(0, 4) });
      speech.push('Your top priorities: ' + priorities.slice(0, 3).join(' '));

      // Weather
      if (wx && wx[0]) {
        var alerts = weatherAlerts(wx[0]);
        var wl = [weatherSentence(wx[0], s.weatherPlace)].concat(alerts);
        if (wx[1]) wl.push('Tomorrow: ' + (WMO[wx[1].code] || 'mixed') + ', ' + wx[1].hi + '°/' + wx[1].lo + '°' + (wx[1].rain >= 40 ? ', ' + wx[1].rain + '% rain' : '') + '.');
        sections.push({ icon: '🌤️', title: 'Weather on the road', tone: alerts.length ? 'warn' : '', lines: wl });
        speech.push('Weather: ' + weatherSentence(wx[0]) + ' ' + alerts.join(' '));
      } else {
        sections.push({ icon: '🌤️', title: 'Weather', tone: '', lines: [s.weatherLat == null || s.weatherLat === '' ?
          'Set your town or ZIP in ⚙️ Settings → Jarvis and I\'ll include road weather and rain/wind alerts.' :
          'Couldn\'t reach the weather service — check your connection.'] });
      }

      // Schedule
      var sched = today.length ? today.map(function (j) { return (j.status === 'in-progress' ? '▶️ In progress: ' : '') + jobLine(j); })
        : ['No jobs on the books for today.'];
      sections.push({ icon: '🚚', title: 'Today\'s schedule', tone: '', lines: sched });
      speech.push(today.length ? 'You have ' + plural(today.length, 'job') + ' today: ' + today.map(jobSpoken).join('; ') + '.' : 'No jobs scheduled today.');
      if (missed.length) {
        sections.push({ icon: '⚠️', title: 'Past-due jobs', tone: 'bad', lines: missed.map(function (j) { return fmtDate(j.date) + ' · ' + jobLine(j) + ' — still marked scheduled'; }) });
        speech.push(plural(missed.length, 'job') + ' from earlier dates ' + (missed.length === 1 ? 'is' : 'are') + ' still marked scheduled.');
      }
      var weekCount = db.jobs.filter(function (j) { return (j.status === 'scheduled') && j.date > t && j.date <= addDays(t, 7); }).length;
      var ahead = [tomorrow.length ? 'Tomorrow: ' + tomorrow.map(jobLine).join('; ') : 'Tomorrow: nothing booked yet.',
        'Next 7 days: ' + plural(weekCount, 'job') + ' booked.'];
      if (!weekCount) {
        var lapsed = db.customers.map(function (c) {
          var last = db.jobs.filter(function (j) { return j.customerId === c.id; }).map(function (j) { return j.date || ''; }).sort().pop();
          return { c: c, last: last };
        }).filter(function (x) { return x.last && daysBetween(x.last, t) >= 45; })
          .sort(function (a, b) { return a.last.localeCompare(b.last); }).slice(0, 3);
        ahead.push('Your week is open — ' + (lapsed.length ? 'consider reaching out to past customers: ' + lapsed.map(function (x) { return x.c.name; }).join(', ') + '.' : 'a good time to drum up new business.'));
      }
      sections.push({ icon: '📅', title: 'Looking ahead', tone: weekCount ? '' : 'warn', lines: ahead });
      speech.push(tomorrow.length ? plural(tomorrow.length, 'job') + ' tomorrow.' : 'Nothing booked tomorrow yet.');

      // Collections
      var coll = [];
      overdue.forEach(function (i) {
        var c = getCustomer(i.customerId);
        coll.push('🔴 ' + i.number + ' · ' + customerName(i.customerId) + ' owes ' + money(invoiceTotal(i)) + ' — ' + plural(daysBetween(i.dueDate, t), 'day') + ' late' + (c && c.phone ? ' (' + c.phone + ')' : ''));
      });
      dueSoon.forEach(function (i) { coll.push('🟡 ' + i.number + ' · ' + customerName(i.customerId) + ' — ' + money(invoiceTotal(i)) + ' due ' + fmtDate(i.dueDate)); });
      if (drafts.length) coll.push('📝 ' + plural(drafts.length, 'draft invoice') + ' not sent yet (' + money(drafts.reduce(function (sum, i) { return sum + invoiceTotal(i); }, 0)) + ').');
      if (unbilled.length) coll.push('🧾 ' + plural(unbilled.length, 'completed job') + ' not invoiced: ' + unbilled.map(function (j) { return customerName(j.customerId); }).join(', ') + ' — ' + money(unbilledAmt) + '.');
      if (!coll.length) coll.push('Everyone\'s paid up. Nothing to chase. 👍');
      sections.push({ icon: '💵', title: 'Money to collect · ' + money(outstanding) + ' outstanding', tone: overdue.length ? 'bad' : '', lines: coll });
      speech.push(overdue.length ? 'You have ' + spokenMoney(overdueAmt) + ' overdue across ' + plural(overdue.length, 'invoice') + '. The biggest is ' + customerName(overdue[0].customerId) + ' at ' + spokenMoney(invoiceTotal(overdue[0])) + '.' : 'Nothing overdue.');
      if (unbilled.length) speech.push(spokenMoney(unbilledAmt) + ' in finished work hasn\'t been invoiced.');

      // Money snapshot vs same point last month
      var mStart = t.slice(0, 8) + '01';
      var inc = incomeBetween(mStart, t), exp = expensesBetween(mStart, t);
      var lmD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var lmStart = lmD.getFullYear() + '-' + pad(lmD.getMonth() + 1) + '-01';
      var lmEndDay = Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate());
      var lmTo = lmStart.slice(0, 8) + pad(lmEndDay);
      var lmInc = incomeBetween(lmStart, lmTo), lmExp = expensesBetween(lmStart, lmTo);
      var profit = inc - exp, lmProfit = lmInc - lmExp;
      var trend = lmProfit === 0 && profit === 0 ? '' : profit >= lmProfit ? '▲ ' + money(profit - lmProfit) + ' ahead of this point last month' : '▼ ' + money(lmProfit - profit) + ' behind this point last month';
      var fuel = db.expenses.filter(function (e) { return e.category === 'Fuel' && e.date >= mStart; }).reduce(function (sum, e) { return sum + (Number(e.amount) || 0); }, 0);
      var ml = ['Collected ' + money(inc) + ' · Expenses ' + money(exp) + ' · Profit ' + money(profit)];
      if (trend) ml.push(trend + '.');
      if (inc > 0 && exp / inc > 0.6) ml.push('Expenses are ' + Math.round(exp / inc * 100) + '% of income this month — keep an eye on costs.');
      if (fuel) ml.push('Fuel so far: ' + money(fuel) + '.');
      sections.push({ icon: '📈', title: 'This month', tone: profit < 0 ? 'bad' : 'good', lines: ml });
      speech.push('This month you\'ve collected ' + spokenMoney(inc) + ', spent ' + spokenMoney(exp) + ', for a profit of ' + spokenMoney(profit) + '.');

      // Housekeeping — the stuff that bites later
      var hk = [];
      var lastBackup = s.lastBackup;
      if (!lastBackup || daysBetween(lastBackup, t) >= 7) hk.push('Back up your data — ' + (lastBackup ? 'last backup was ' + plural(daysBetween(lastBackup, t), 'day') + ' ago' : 'you haven\'t made one yet') + '. ⚙️ Settings → Export Backup.');
      if (!s.paymentInstructions) hk.push('Add payment instructions (Zelle, Cash App, checks…) in Settings so invoices tell customers how to pay.');
      if (!s.phone) hk.push('Add your business phone in Settings so it prints on invoices.');
      var noContact = db.customers.filter(function (c) { return !c.phone && !c.email; });
      if (noContact.length) hk.push(plural(noContact.length, 'customer') + ' with no phone or email: ' + noContact.slice(0, 3).map(function (c) { return c.name; }).join(', ') + '.');
      if (now.getDate() >= 25) hk.push('Month-end is close — log any missing fuel and dump receipts so your numbers are right.');
      if ([0, 3, 5, 8].indexOf(now.getMonth()) >= 0 && now.getDate() <= 15) hk.push('Quarterly estimated taxes are due mid-month — check with your accountant.');
      if (hk.length) {
        sections.push({ icon: '🧰', title: 'Housekeeping', tone: '', lines: hk });
        speech.push('And ' + plural(hk.length, 'housekeeping item') + (hk.length === 1 ? ' is' : ' are') + ' on the list.');
      }
      speech.push('That\'s everything. Have a safe day on the road.');
      return { sections: sections, speech: speech.join(' ') };
    });
  }

  function briefHtml(b) {
    return '<div class="brief">' + b.sections.map(function (sec) {
      return '<div class="brief-sec ' + (sec.tone || '') + '"><div class="brief-head"><span>' + sec.icon + '</span>' + esc(sec.title) + '</div><ul>' +
        sec.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
    }).join('') + '</div>';
  }

  // --- Speech out ---
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    var voices = speechSynthesis.getVoices();
    var prefs = [/Daniel/i, /Google UK English Male/i, /en-GB/i, /Alex/i, /en-US/i];
    for (var p = 0; p < prefs.length; p++) {
      for (var v = 0; v < voices.length; v++) {
        if (prefs[p].test(voices[v].name) || prefs[p].test(voices[v].lang)) return voices[v];
      }
    }
    return voices[0] || null;
  }
  // Chrome loads voices async; touching getVoices() early primes the list.
  if (window.speechSynthesis) speechSynthesis.getVoices();
  function speak(text) {
    if (!window.speechSynthesis || db.settings.jarvisVoice === 'off') return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text.replace(/[•·→—]/g, ', ').replace(/[^\x00-\x7F°$]/g, ''));
    var v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 1.03; u.pitch = 0.95;
    u.onstart = function () { setOrb('speaking'); };
    u.onend = u.onerror = function () { setOrb(jarvisListening ? 'listening' : ''); };
    speechSynthesis.speak(u);
  }
  function setOrb(state) {
    var orb = document.getElementById('jvOrb');
    if (orb) orb.className = 'jv-orb ' + (state || '');
    var st = document.getElementById('jvStatus');
    if (st) st.textContent = state === 'listening' ? 'Listening…' : state === 'speaking' ? 'Speaking — tap the orb to stop' : state === 'thinking' ? 'Thinking…' : 'Tap 🎙️ and talk, or type below';
  }

  // --- Conversation ---
  function say(html, speech) {
    jarvisLog.push({ from: 'jarvis', html: html });
    if (currentTab === 'jarvis' && !subView) renderJarvisLog();
    if (speech) speak(speech);
  }
  function list(items) { return '<ul class="jv-list">' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }

  function findCustomer(text) {
    var best = null;
    db.customers.forEach(function (c) {
      var name = c.name.toLowerCase();
      var first = name.split(' ')[0];
      if (text.indexOf(name) >= 0 && (!best || name.length > best.name.length)) best = c;
      else if (!best && first.length > 2 && new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text)) best = c;
    });
    return best;
  }

  function runBrief() {
    setOrb('thinking');
    buildBrief().then(function (b) {
      db.settings.lastBriefDate = todayStr(); save();
      say(briefHtml(b) + '<div class="btn-row"><button class="btn small secondary" data-jv="replay">🔊 Read it again</button></div>', b.speech);
      jarvisLastBrief = b;
      if (!(window.speechSynthesis && db.settings.jarvisVoice !== 'off')) setOrb('');
    });
  }
  function handle(raw) {
    var text = String(raw || '').trim();
    if (!text) return;
    jarvisLog.push({ from: 'me', html: esc(text) });
    renderJarvisLog();
    var q = text.toLowerCase().replace(/[?!.,]/g, '');
    var t = todayStr();

    if (/^(stop|quiet|shut up|be quiet|cancel|enough)\b/.test(q)) { if (window.speechSynthesis) speechSynthesis.cancel(); setOrb(''); return say('Standing by.'); }
    if (/^(undo|undo that|remove that|delete that)$/.test(q)) {
      if (!jarvisUndo) return say('There\'s nothing for me to undo.', 'There is nothing to undo.');
      db.expenses = db.expenses.filter(function (e) { return e.id !== jarvisUndo; }); jarvisUndo = null; save();
      return say('Done — I removed that expense.', 'Done. I removed that expense.');
    }
    if (/\b(brief|briefing|rundown|run down|morning report|catch me up|what do i need|what did i miss|update me|sitrep)\b/.test(q)) return runBrief();
    if (/\b(help|what can you do|commands)\b/.test(q)) {
      return say('Here\'s what you can ask me:' + list(['“Give me my daily brief”', '“What\'s on today?” / “What about tomorrow?” / “This week?”', '“Who owes me money?”', '“What haven\'t I invoiced?”', '“How much did I make this month?” (or last month, this year)', '“What did I spend on fuel this month?”', '“Log 60 dollars fuel” — then “undo” if I got it wrong', '“Tell me about Mike Jones” / “Call Mike”', '“What\'s the weather?”', '“Open invoices” / “Go to jobs”']),
        'I can give you your daily brief, your schedule, who owes you, what you made and spent, the weather, look up customers, and log expenses by voice. Just ask.');
    }
    if (/\b(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/.test(q) && q.split(' ').length <= 4) {
      var name = db.settings.ownerName ? ' ' + db.settings.ownerName.split(' ')[0] : '';
      return say('Hey' + esc(name) + '. Want your daily brief? Just say “brief”.', 'Hey' + name + '. Want your daily brief?');
    }
    if (/\b(thanks|thank you|appreciate)\b/.test(q)) return say('Anytime. 🫡', 'Anytime.');

    // Voice expense logging: "log 45 fuel", "spent $120 on dump fees"
    var exp = q.match(/\b(log|add|record|spent|paid)\b.*?\$?\s*(\d+(?:\.\d{1,2})?)\s*(dollars|bucks)?/);
    if (exp && !/\b(how much|what did)\b/.test(q)) {
      var amt = Number(exp[2]);
      var cat = /fuel|gas|diesel/.test(q) ? 'Fuel' : /dump|disposal|landfill|tipping/.test(q) ? 'Dump/Disposal Fees' : /repair|maintenance|oil|tire|brake|mechanic/.test(q) ? 'Maintenance & Repairs'
        : /insurance/.test(q) ? 'Insurance' : /permit|fee|license|registration|toll/.test(q) ? 'Permits & Fees' : /labor|helper|crew|wage/.test(q) ? 'Labor'
        : /truck payment|loan|note/.test(q) ? 'Truck Payment' : /equipment|strap|tarp|dolly|tool/.test(q) ? 'Equipment' : 'Other';
      var e = { id: uid(), date: t, amount: amt, category: cat, description: text };
      db.expenses.push(e); jarvisUndo = e.id; save();
      return say('Logged <strong>' + money(amt) + '</strong> under <strong>' + esc(cat) + '</strong> for today. Say “undo” if that\'s wrong.',
        'Logged ' + spokenMoney(amt) + ' under ' + cat + '. Say undo if that is wrong.');
    }

    if (/\b(weather|rain|forecast|temperature|wind|snow|hot|cold outside)\b/.test(q)) {
      setOrb('thinking');
      return getWeather().then(function (wx) {
        if (!wx) return say('I don\'t have a location for weather yet. Open ⚙️ Settings → Jarvis and enter your town or ZIP.', 'I need your town or zip code first. You can set it in settings.');
        var day = /tomorrow/.test(q) && wx[1] ? wx[1] : wx[0];
        var alerts = weatherAlerts(day);
        say(esc((day === wx[1] ? 'Tomorrow — ' : 'Today — ') + weatherSentence(day, db.settings.weatherPlace)) + (alerts.length ? list(alerts) : ''),
          (day === wx[1] ? 'Tomorrow: ' : 'Today: ') + weatherSentence(day) + ' ' + alerts.join(' '));
      });
    }

    if (/\b(owe|owes|owed|overdue|outstanding|unpaid|collect|late|receivable)\b/.test(q)) {
      var od = overdueInvoices(), open = openInvoices();
      if (!open.length) return say('Nobody owes you anything right now. 👍', 'Nobody owes you anything right now.');
      var total = open.reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
      var rows = open.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); }).map(function (i) {
        var st = invoiceStatus(i);
        return (st === 'overdue' ? '🔴 ' : '') + customerName(i.customerId) + ' — ' + money(invoiceTotal(i)) + ' (' + i.number + ', ' + (st === 'overdue' ? plural(daysBetween(i.dueDate, t), 'day') + ' late' : 'due ' + fmtDate(i.dueDate)) + ')';
      });
      return say('<strong>' + money(total) + '</strong> outstanding' + (od.length ? ', ' + plural(od.length, 'invoice') + ' overdue' : '') + ':' + list(rows),
        'You are owed ' + spokenMoney(total) + ' in total. ' + (od.length ? od.length + ' overdue. The biggest is ' + customerName(od[0].customerId) + ' at ' + spokenMoney(invoiceTotal(od[0])) + '.' : 'Nothing is overdue yet.'));
    }

    if (/\b(invoiced|unbilled|not billed|haven\'?t billed|need to bill|bill)\b/.test(q)) {
      var ub = uninvoicedJobs();
      if (!ub.length) return say('Every finished job has been invoiced. Nice work.', 'Every finished job has been invoiced.');
      var amtU = ub.reduce(function (s, j) { return s + (Number(j.amount) || 0); }, 0);
      return say(plural(ub.length, 'finished job') + ' not invoiced yet — <strong>' + money(amtU) + '</strong>:' + list(ub.map(function (j) { return fmtDate(j.date) + ' · ' + jobLine(j); })) + 'Open a job and tap “Create Invoice” to bill it.',
        'You have ' + plural(ub.length, 'finished job') + ' worth ' + spokenMoney(amtU) + ' that have not been invoiced.');
    }

    if (/\b(spend|spent|expense|expenses|cost|costs)\b/.test(q)) {
      var pr = periodRange(q);
      var catQ = /fuel|gas|diesel/.test(q) ? 'Fuel' : /dump|disposal/.test(q) ? 'Dump/Disposal Fees' : /repair|maintenance/.test(q) ? 'Maintenance & Repairs' : null;
      var list2 = db.expenses.filter(function (e) { return e.date >= pr.from && e.date <= pr.to && (!catQ || e.category === catQ); });
      var sum = list2.reduce(function (s, e) { return s + (Number(e.amount) || 0); }, 0);
      var by = {};
      list2.forEach(function (e) { by[e.category] = (by[e.category] || 0) + (Number(e.amount) || 0); });
      var rowsE = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (k) { return k + ': ' + money(by[k]); });
      return say('You spent <strong>' + money(sum) + '</strong>' + (catQ ? ' on ' + esc(catQ.toLowerCase()) : '') + ' ' + pr.label + '.' + (rowsE.length > 1 ? list(rowsE) : ''),
        'You spent ' + spokenMoney(sum) + (catQ ? ' on ' + catQ : '') + ' ' + pr.label + '.');
    }

    if (/\b(make|made|earn|earned|income|revenue|collected|profit|bring in|brought in|doing)\b/.test(q)) {
      var p = periodRange(q);
      var inc = incomeBetween(p.from, p.to), ex = expensesBetween(p.from, p.to);
      return say('<strong>' + esc(p.label.charAt(0).toUpperCase() + p.label.slice(1)) + ':</strong>' + list(['Collected: ' + money(inc), 'Expenses: ' + money(ex), 'Profit: ' + money(inc - ex)]),
        p.label.charAt(0).toUpperCase() + p.label.slice(1) + ', you collected ' + spokenMoney(inc) + ', spent ' + spokenMoney(ex) + ', for a profit of ' + spokenMoney(inc - ex) + '.');
    }

    // Navigation
    var nav = q.match(/\b(open|go to|show|take me to)\b.*\b(home|dashboard|customers|jobs|invoices|money|settings)\b/);
    if (nav) {
      var dest = nav[2] === 'home' ? 'dashboard' : nav[2];
      if (dest === 'settings') { settingsForm(); return say('Opening settings.'); }
      speak('Opening ' + nav[2] + '.');
      return setTab(dest);
    }

    // Customer lookup / call / text
    var cust = findCustomer(q);
    if (cust) {
      var jobsC = db.jobs.filter(function (j) { return j.customerId === cust.id; }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var owed = db.invoices.filter(function (i) { return i.customerId === cust.id && (invoiceStatus(i) === 'sent' || invoiceStatus(i) === 'overdue'); })
        .reduce(function (s, i) { return s + invoiceTotal(i); }, 0);
      var next = jobsC.filter(function (j) { return j.status === 'scheduled' && j.date >= t; }).pop();
      var info = [cust.phone ? 'Phone: ' + cust.phone : 'No phone on file', jobsC.length ? plural(jobsC.length, 'job') + ' total, last on ' + fmtDate(jobsC[0].date) : 'No jobs yet',
        owed ? 'Owes you ' + money(owed) : 'Paid up', next ? 'Next job: ' + fmtDate(next.date) + ' — ' + (next.description || 'Haul') : 'Nothing scheduled'];
      if (cust.notes) info.push('Notes: ' + cust.notes);
      var btns = '<div class="btn-row">' + (cust.phone ? '<a class="btn small primary" href="tel:' + esc(cust.phone) + '">📞 Call</a><a class="btn small secondary" href="sms:' + esc(cust.phone) + '">💬 Text</a>' : '') +
        '<button class="btn small secondary" data-jv="customer" data-id="' + esc(cust.id) + '">Open profile</button></div>';
      return say('<strong>' + esc(cust.name) + '</strong>' + list(info) + btns,
        (/\b(call|text|phone|number)\b/.test(q) ? (cust.phone ? 'Here is ' + cust.name + '. Tap call or text.' : 'I do not have a phone number for ' + cust.name + '.') :
          cust.name + '. ' + (owed ? 'Owes you ' + spokenMoney(owed) + '. ' : 'Paid up. ') + (next ? 'Next job ' + fmtDate(next.date) + '.' : 'Nothing scheduled.')));
    }

    if (/\b(tomorrow)\b/.test(q)) {
      var tm = jobsOn(addDays(t, 1));
      return say(tm.length ? 'Tomorrow (' + esc(fmtDate(addDays(t, 1))) + '):' + list(tm.map(jobLine)) : 'Nothing booked for tomorrow yet.',
        tm.length ? 'Tomorrow you have ' + plural(tm.length, 'job') + ': ' + tm.map(jobSpoken).join('; ') + '.' : 'Nothing booked for tomorrow yet.');
    }
    if (/\b(week|upcoming|coming up|next few days)\b/.test(q)) {
      var wk = db.jobs.filter(function (j) { return (j.status === 'scheduled' || j.status === 'in-progress') && j.date >= t && j.date <= addDays(t, 7); })
        .sort(function (a, b) { return a.date.localeCompare(b.date); });
      var val = wk.reduce(function (s, j) { return s + (Number(j.amount) || 0); }, 0);
      return say(wk.length ? 'Next 7 days — ' + plural(wk.length, 'job') + ', ' + money(val) + ' booked:' + list(wk.map(function (j) { return fmtDate(j.date) + ' · ' + jobLine(j); })) : 'Nothing booked for the next 7 days. Time to drum up some work.',
        wk.length ? 'You have ' + plural(wk.length, 'job') + ' in the next week, worth ' + spokenMoney(val) + '.' : 'Nothing booked for the next seven days.');
    }
    if (/\b(today|schedule|jobs|job|work|on deck|my day)\b/.test(q)) {
      var td = jobsOn(t), ms = missedJobs();
      var h = td.length ? 'Today:' + list(td.map(function (j) { return (j.status === 'in-progress' ? '▶️ ' : '') + jobLine(j); })) : 'No jobs on the schedule today.';
      if (ms.length) h += '<br>Also, ' + plural(ms.length, 'past job') + ' still marked scheduled:' + list(ms.map(function (j) { return fmtDate(j.date) + ' · ' + jobLine(j); }));
      return say(h, (td.length ? 'Today you have ' + plural(td.length, 'job') + ': ' + td.map(jobSpoken).join('; ') + '.' : 'No jobs today.') + (ms.length ? ' Also, ' + plural(ms.length, 'older job') + ' still need closing out.' : ''));
    }

    say('I didn\'t quite catch that. Try “daily brief”, “who owes me”, “what\'s on today”, or say “help”.', 'Sorry, I did not catch that. Say help to hear what I can do.');
  }

  // --- Listening ---
  var recognizer = null;
  function toggleListen() {
    if (!SpeechRec) { toast('Voice input isn\'t supported in this browser — type instead'); var i = document.getElementById('jvInput'); if (i) i.focus(); return; }
    if (jarvisListening && recognizer) { recognizer.stop(); return; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    recognizer = new SpeechRec();
    recognizer.lang = 'en-US';
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;
    var finalText = '';
    recognizer.onstart = function () { jarvisListening = true; setOrb('listening'); var m = document.getElementById('jvMic'); if (m) m.classList.add('on'); };
    recognizer.onresult = function (ev) {
      var interim = '';
      for (var k = ev.resultIndex; k < ev.results.length; k++) {
        if (ev.results[k].isFinal) finalText += ev.results[k][0].transcript; else interim += ev.results[k][0].transcript;
      }
      var inp = document.getElementById('jvInput'); if (inp) inp.value = finalText + interim;
    };
    recognizer.onerror = function (ev) {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Allow microphone access to talk to Jarvis');
    };
    recognizer.onend = function () {
      jarvisListening = false; setOrb('');
      var m = document.getElementById('jvMic'); if (m) m.classList.remove('on');
      var inp = document.getElementById('jvInput');
      var said = finalText || (inp ? inp.value : '');
      if (inp) inp.value = '';
      if (said.trim()) handle(said);
    };
    recognizer.start();
  }

  // --- View ---
  function renderJarvisLog() {
    var log = document.getElementById('jvLog');
    if (!log) return;
    log.innerHTML = jarvisLog.map(function (m) { return '<div class="jv-msg ' + m.from + '">' + m.html + '</div>'; }).join('');
    log.querySelectorAll('[data-jv]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.jv === 'replay' && jarvisLastBrief) speak(jarvisLastBrief.speech);
        if (b.dataset.jv === 'customer') { currentTab = 'customers'; document.querySelectorAll('.nav-btn').forEach(function (n) { n.classList.toggle('active', n.dataset.tab === 'customers'); }); subView = { type: 'customer', id: b.dataset.id }; render(); }
      };
    });
    var last = log.lastElementChild;
    if (last && jarvisLog.length > 1) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderJarvis() {
    var html = '<div class="jv-hero"><button class="jv-orb" id="jvOrb" aria-label="Stop speaking"><span></span></button>' +
      '<div><div class="jv-name">JARVIS</div><div class="jv-status" id="jvStatus"></div></div></div>' +
      '<div class="chips jv-chips">' +
      [['brief', '☀️ Daily brief'], ['what\'s on today', '🚚 Today'], ['who owes me', '💵 Who owes me'], ['how much did I make this month', '📈 This month'], ['what haven\'t I invoiced', '🧾 Not invoiced'], ['weather', '🌤️ Weather'], ['help', '❔ Help']]
        .map(function (c) { return '<button class="chip" data-ask="' + esc(c[0]) + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      '<div id="jvLog" class="jv-log"></div>' +
      '<form class="jv-bar" id="jvForm"><input id="jvInput" type="text" placeholder="Ask Jarvis anything…" autocomplete="off" enterkeyhint="send">' +
      '<button type="button" class="jv-mic" id="jvMic" aria-label="Talk">🎙️</button><button type="submit" class="jv-send" aria-label="Send">➤</button></form>';
    viewEl.innerHTML = html;
    setOrb(window.speechSynthesis && speechSynthesis.speaking ? 'speaking' : '');
    document.getElementById('jvOrb').onclick = function () { if (window.speechSynthesis) speechSynthesis.cancel(); setOrb(''); };
    document.getElementById('jvMic').onclick = toggleListen;
    document.getElementById('jvForm').onsubmit = function (e) {
      e.preventDefault();
      var inp = document.getElementById('jvInput');
      var v = inp.value; inp.value = '';
      handle(v);
    };
    viewEl.querySelectorAll('[data-ask]').forEach(function (c) { c.onclick = function () { handle(c.dataset.ask); }; });
    if (!jarvisLog.length) {
      if (db.settings.lastBriefDate !== todayStr()) runBrief();
      else say('Welcome back. Ask me anything, or tap ☀️ Daily brief for a fresh rundown.');
    } else renderJarvisLog();
  }

  // ---------- First run ----------
  if (!db.customers.length && !db.invoices.length && !localStorage.getItem(STORE_KEY)) {
    save();
    setTimeout(function () {
      openModal('Welcome to Hauler HQ',
        '<div style="text-align:center;margin-bottom:14px"><img src="assets/logo-full.png" alt="Avery Hauling Services LLC" style="max-width:220px;width:70%;height:auto"></div>' +
        '<p style="margin-bottom:10px;font-size:.92rem">Run your hauling business from your pocket:</p>' +
        '<ul style="margin:0 0 14px 20px;font-size:.88rem;color:var(--text-2)">' +
        '<li><strong>Customers</strong> — contacts, notes, call/text in one tap</li>' +
        '<li><strong>Jobs</strong> — schedule hauls, track status</li>' +
        '<li><strong>Invoices</strong> — bill from your phone, print or share as PDF</li>' +
        '<li><strong>Money</strong> — expenses, income and profit at a glance</li></ul>' +
        '<p style="margin-bottom:14px;font-size:.85rem;color:var(--text-2)">Start by setting up your business info — it appears on every invoice.</p>' +
        '<button class="btn primary" id="setupBtn">Set Up My Business</button>' +
        '<div style="height:9px"></div>' +
        '<button class="btn secondary" id="skipBtn">Skip for now</button>',
        function (m) {
          m.querySelector('#setupBtn').onclick = function () { closeModal(); settingsForm(); };
          m.querySelector('#skipBtn').onclick = closeModal;
        });
    }, 400);
  }

  if (db.settings.jarvisAutoBrief !== 'off' && db.settings.lastBriefDate !== todayStr() && localStorage.getItem(STORE_KEY) && (db.customers.length || db.jobs.length)) {
    setTab('jarvis');
  } else {
    render();
  }
})();
