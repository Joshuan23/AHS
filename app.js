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
        businessName: 'My Hauling Business',
        ownerName: '',
        phone: '',
        email: '',
        address: '',
        invoicePrefix: 'INV-',
        nextInvoiceNum: 1,
        taxRate: 0,
        paymentTerms: 14,
        paymentInstructions: ''
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
    fab.hidden = currentTab === 'dashboard';
    var titles = { dashboard: db.settings.businessName || 'Hauler HQ', customers: 'Customers', jobs: 'Jobs', invoices: 'Invoices', money: 'Money' };
    titleEl.textContent = titles[currentTab];
    if (currentTab === 'dashboard') renderDashboard();
    else if (currentTab === 'customers') renderCustomers();
    else if (currentTab === 'jobs') renderJobs();
    else if (currentTab === 'invoices') renderInvoices();
    else if (currentTab === 'money') renderMoney();
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

    var html = '<div class="stat-grid">' +
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
          s.businessName = m.querySelector('#fBiz').value.trim() || 'My Hauling Business';
          s.ownerName = m.querySelector('#fOwner').value.trim();
          s.phone = m.querySelector('#fPhone').value.trim();
          s.email = m.querySelector('#fEmail').value.trim();
          s.address = m.querySelector('#fAddress').value.trim();
          s.invoicePrefix = m.querySelector('#fPrefix').value || 'INV-';
          s.nextInvoiceNum = Number(m.querySelector('#fNext').value) || 1;
          s.taxRate = Number(m.querySelector('#fTax').value) || 0;
          s.paymentTerms = Number(m.querySelector('#fTerms').value) || 14;
          s.paymentInstructions = m.querySelector('#fPay').value.trim();
          save(); closeModal(); render(); toast('Settings saved');
        };
        m.querySelector('#fExport').onclick = function () {
          var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'haulerhq-backup-' + todayStr() + '.json';
          a.click();
          URL.revokeObjectURL(a.href);
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

  // ---------- First run ----------
  if (!db.customers.length && !db.invoices.length && !localStorage.getItem(STORE_KEY)) {
    save();
    setTimeout(function () {
      openModal('Welcome to Hauler HQ! 🚛',
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

  render();
})();
