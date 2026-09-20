const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icons = {
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M10 9v12M4 15h16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  moon: '<path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5.65"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5 5.5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V7M17 16V4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  move: '<path d="M3 12h18m-4-4 4 4-4 4M7 8l-4 4 4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7h.01"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8 2-2-3-3 2-2-2-2-2 2"/>',
  'log-out': '<path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((element) => { element.innerHTML = icon(element.dataset.icon); });
}

const today = new Date();
let data = null;
let admin = false;
let selectedMonth = String(today.getMonth() + 1).padStart(2, '0');
if (!['09', '10', '11', '12', '01', '02', '03', '04', '05'].includes(selectedMonth)) selectedMonth = '09';
let statusFilter = 'all';
let search = '';
let saving = false;
let loading = false;
let toastTimer;
let loadNumber = 0;
let authBusy = false;

function setTheme(theme, remember = true) {
  document.documentElement.dataset.theme = theme;
  $$('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
  $('meta[name="theme-color"]').content = theme === 'dark' ? '#19241e' : '#187b56';
  if (remember) { try { localStorage.setItem('fond-theme', theme); } catch { /* Theme still works when storage is blocked. */ } }
}
let initialTheme;
try { initialTheme = localStorage.getItem('fond-theme'); } catch { /* Optional preference. */ }
setTheme(['light', 'dark'].includes(initialTheme) ? initialTheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
hydrateIcons();

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error('Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Saytning server qismi javob bermayapti. Fond mas’uli hosting sozlamalarini tekshirishi kerak.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('Server javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'So‘rov bajarilmadi.'), { status: response.status });
  return result;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
}
function saveStatus(message, type = '') {
  $('#save-state').className = `save-state ${type ? `is-${type}` : ''}`;
  $('#save-state').innerHTML = `<span class="mini-dot green-dot"></span><span>${escapeHTML(message)}</span>`;
}
function setAdmin(value) {
  admin = value;
  $('#access-badge').classList.toggle('is-admin', admin);
  $('#access-badge').innerHTML = `${icon(admin ? 'shield' : 'lock')}<span>${admin ? 'Tahrirlash huquqi' : 'Faqat ko‘rish'}</span>`;
  $('#admin-button').innerHTML = `${icon('shield')}<span>${admin ? 'Admin hisobi' : 'Admin kirish'}</span>`;
  $('#info-note p').textContent = admin
    ? 'Admin rejimi yoqilgan. Katakdagi holatni tanlang — o‘zgarish avtomatik saqlanadi.'
    : 'Jadvalni hamma ko‘rishi mumkin. To‘lov holatini faqat admin o‘zgartiradi.';
}

const transliteration = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};
const normalize = (value) => value.toLowerCase().replace(/[а-яёўқғҳ]/g, (letter) => transliteration[letter]).replace(/[‘’ʻʼ'`]/g, '').replace(/\s+/g, ' ').trim();
const isPaid = (memberId, month) => Boolean(data.payments[`${memberId}:${month}`]?.paid);
function visibleMembers() {
  const terms = normalize(search).split(' ').filter(Boolean);
  return data.members.filter((member) => terms.every((term) => normalize(member.fullName).includes(term)) && (statusFilter === 'all' || isPaid(member.id, selectedMonth) === (statusFilter === 'paid')));
}
function renderSummary() {
  const count = data.members.length;
  const paid = data.members.filter((member) => isPaid(member.id, selectedMonth)).length;
  const percent = Math.round(paid / count * 100);
  $('#total-count').textContent = count;
  $('#paid-count').textContent = paid;
  $('#unpaid-count').textContent = count - paid;
  $('#percentage').textContent = percent;
  $('#progress-fill').style.width = `${percent}%`;
  $('.progress-track').setAttribute('aria-valuenow', String(percent));
  $('#progress-caption').textContent = `${count} tadan ${paid} ta to‘lov`;
  $$('.summary-month').forEach((element) => { element.textContent = data.months.find((month) => month.id === selectedMonth).name; });
}
function renderTable() {
  const visible = visibleMembers();
  const focused = document.activeElement?.dataset?.payment;
  $('#table-head').innerHTML = `<tr><th scope="col" class="number-cell">#</th><th scope="col" class="member-cell"><span class="col-letter">A</span>O‘quvchi ismi va familiyasi</th>${data.months.map((month, index) => `<th scope="col" class="${month.id === selectedMonth ? 'selected-month' : ''}"><span class="col-letter">${String.fromCharCode(66 + index)}</span><button class="month-heading" data-month="${month.id}" aria-pressed="${month.id === selectedMonth}" title="${month.name} statistikasi">${month.name}</button></th>`).join('')}</tr>`;
  $('#table-body').innerHTML = visible.length ? visible.map((member) => {
    const index = data.members.indexOf(member);
    const initials = member.name.split(' ').slice(0, 2).map((part) => part[0]).join('');
    return `<tr><td class="number-cell">${String(index + 1).padStart(2, '0')}</td><th scope="row" class="member-cell"><div class="member-details"><span class="avatar" data-color="${index % 5}" aria-hidden="true">${escapeHTML(initials)}</span><span class="member-name" title="${escapeHTML(member.name)}">${escapeHTML(member.name)}</span></div></th>${data.months.map((month) => {
      const paid = isPaid(member.id, month.id);
      return `<td class="${month.id === selectedMonth ? 'selected-month' : ''}"><div class="payment-control ${paid ? 'paid' : 'unpaid'} ${admin ? 'editable' : ''}"><select data-payment="${member.id}:${month.id}" aria-label="${escapeHTML(member.name)}, ${month.name}" ${!admin || saving || loading ? 'disabled' : ''} title="${admin ? 'To‘lov holatini tanlang' : 'Faqat admin o‘zgartira oladi'}"><option value="unpaid" ${!paid ? 'selected' : ''}>To‘lanmagan</option><option value="paid" ${paid ? 'selected' : ''}>To‘langan</option></select>${admin ? `<span class="cell-chevron">${icon('chevron')}</span>` : ''}</div></td>`;
    }).join('')}</tr>`;
  }).join('') : '<tr><td colspan="11" class="empty-state"><span data-icon="search"></span><p>Bu qidiruv yoki filtr bo‘yicha o‘quvchi topilmadi.</p><button class="button button-white" id="clear-filters">Filtrlarni tozalash</button></td></tr>';
  $('#table-foot').innerHTML = `<tr><td class="number-cell">Σ</td><td class="member-cell total-label">Jami to‘langan</td>${data.months.map((month) => `<td class="${month.id === selectedMonth ? 'selected-month' : ''}"><span class="total-paid">${visible.filter((member) => isPaid(member.id, month.id)).length}</span><span class="total-separator"> / ${visible.length}</span></td>`).join('')}</tr>`;
  $('#visible-count').textContent = visible.length === data.members.length ? `${data.members.length} ta o‘quvchi ko‘rsatilmoqda` : `${data.members.length} tadan ${visible.length} ta o‘quvchi`;
  if (focused) $$('[data-payment]').find((element) => element.dataset.payment === focused)?.focus({ preventScroll: true });
  hydrateIcons($('#table-body'));
}
function render() {
  if (!data) return;
  $('#year-select').innerHTML = data.years.map((year) => `<option value="${year}" ${year === data.year ? 'selected' : ''}>${year}–${year + 1} o‘quv yili</option>`).join('');
  $('#year-select').disabled = saving || loading;
  $('#month-select').innerHTML = data.months.map((month) => `<option value="${month.id}" ${month.id === selectedMonth ? 'selected' : ''}>${month.name}</option>`).join('');
  $('#month-select').disabled = false;
  $('#export-button').disabled = false;
  $('#member-tag').textContent = `${data.members.length} o‘quvchi`;
  $('#school-year-footer').textContent = `${data.year}–${data.year + 1} o‘quv yili`;
  renderSummary();
  renderTable();
  renderActivity();
}
async function loadData(year = data?.year, silent = false) {
  if (saving || (silent && (loading || authBusy))) return;
  const currentLoad = ++loadNumber;
  loading = true;
  if (!silent) {
    saveStatus('Yuklanmoqda…', 'saving');
    $('#year-select').disabled = true;
    $$('[data-payment]').forEach((element) => { element.disabled = true; });
  }
  try {
    const [nextData, session] = await Promise.all([api(`/api/state${year ? `?year=${year}` : ''}`), api('/api/session')]);
    if (currentLoad !== loadNumber) return;
    data = nextData;
    setAdmin(session.admin);
    saveStatus(admin ? 'Barcha o‘zgarishlar saqlandi' : 'Jadval yangilangan');
  } catch (error) {
    if (currentLoad !== loadNumber) return;
    saveStatus('Aloqa yo‘q. Qayta urinish kerak.', 'error');
    if (!data) {
      $('#table-body').innerHTML = `<tr><td colspan="11" class="empty-state"><span data-icon="info"></span><p>${escapeHTML(error.message)}</p><button id="retry-button" class="button button-primary">Qayta yuklash</button></td></tr>`;
      hydrateIcons($('#table-body'));
    } else if (!silent) toast(error.message);
  } finally {
    if (currentLoad === loadNumber) { loading = false; render(); }
  }
}

async function changePayment(select) {
  if (!admin || saving || loading) { renderTable(); return; }
  const [memberId, month] = select.dataset.payment.split(':');
  const key = select.dataset.payment;
  const paid = select.value === 'paid';
  if (paid === isPaid(memberId, month)) return;
  const version = data.payments[key]?.version || 0;
  ++loadNumber;
  saving = true;
  select.closest('.payment-control').classList.add('is-pending');
  $$('[data-payment]').forEach((element) => { element.disabled = true; });
  $('#year-select').disabled = true;
  saveStatus('Saqlanmoqda…', 'saving');
  let failure;
  try {
    data = await api('/api/payments', { method: 'PATCH', body: JSON.stringify({ memberId, month, year: data.year, paid, version }) });
    saveStatus('Barcha o‘zgarishlar saqlandi');
  } catch (error) {
    failure = error;
    if (error.status === 401) setAdmin(false);
  } finally {
    saving = false;
    if (failure) {
      await loadData(data.year, true);
      saveStatus('O‘zgarishni tekshiring', 'error');
      toast(failure.message);
    }
    render();
    if (admin) $$('[data-payment]').find((element) => element.dataset.payment === key)?.focus({ preventScroll: true });
  }
}
function chooseMonth(month) {
  selectedMonth = month;
  $('#month-select').value = month;
  renderSummary();
  renderTable();
}
function renderActivity() {
  if (!data) return;
  $('#activity-description').textContent = `${data.year}–${data.year + 1} o‘quv yilidagi so‘nggi 100 ta o‘zgarish.`;
  $('#activity-list').innerHTML = data.activity.length ? data.activity.map((entry) => {
    const member = data.members.find((item) => item.id === entry.memberId);
    const month = data.months.find((item) => item.id === entry.month);
    return `<article class="activity-entry"><span class="stat-icon ${entry.paid ? 'green' : 'amber'}">${icon(entry.paid ? 'check-circle' : 'clock')}</span><div><strong>${escapeHTML(member?.name || entry.memberId)}</strong><p>${escapeHTML(month?.name || entry.month)}: ${entry.paid ? 'To‘langan' : 'To‘lanmagan'}</p><time datetime="${escapeHTML(entry.createdAt)}">${escapeHTML(new Date(entry.createdAt).toLocaleString('uz-UZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}</time></div></article>`;
  }).join('') : `<div class="activity-empty"><span>${icon('history')}</span><p>Hozircha o‘zgarishlar yo‘q.</p><p>To‘lovlar belgilanganida shu yerda ko‘rinadi.</p></div>`;
}
function exportCSV() {
  if (!data) return;
  const rows = [['№', 'Ism va familiya', ...data.months.map((month) => month.name)], ...data.members.map((member, index) => [index + 1, member.name, ...data.months.map((month) => isPaid(member.id, month.id) ? 'To‘langan' : 'To‘lanmagan')])];
  const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `11-B-fond-${data.year}-${data.year + 1}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Jadval Excel uchun CSV shaklida yuklandi.');
}
function openDialog(id) {
  const dialog = $(id);
  if (dialog.open) return;
  dialog.showModal();
  dialog.querySelector('input')?.focus();
}

$$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
$('#member-search').addEventListener('input', (event) => { search = event.target.value; if (data) renderTable(); });
$('#month-select').addEventListener('change', (event) => { if (data) chooseMonth(event.target.value); });
$('#year-select').addEventListener('change', (event) => { void loadData(Number(event.target.value)); });
$$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  statusFilter = button.dataset.filter;
  $$('[data-filter]').forEach((item) => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  if (data) renderTable();
}));
$('#payment-table').addEventListener('change', (event) => { if (event.target.matches('[data-payment]')) void changePayment(event.target); });
$('#payment-table').addEventListener('click', (event) => {
  const month = event.target.closest('[data-month]');
  if (month && data) chooseMonth(month.dataset.month);
  if (event.target.closest('#retry-button')) void loadData();
  if (event.target.closest('#clear-filters')) {
    $('#member-search').value = search = '';
    $('[data-filter="all"]').click();
  }
});
$('#export-button').addEventListener('click', exportCSV);
$('#help-button').addEventListener('click', () => openDialog('#help-dialog'));
$('#activity-button').addEventListener('click', () => { renderActivity(); openDialog('#activity-dialog'); });
$('#admin-button').addEventListener('click', () => {
  if (saving) { toast('To‘lov saqlanishini kuting.'); return; }
  if (!admin) { $('#login-error').textContent = ''; $('#login-form').reset(); $('#admin-password').type = 'password'; }
  openDialog(admin ? '#account-dialog' : '#login-dialog');
});
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => { $$('input[type="password"], input[name="password"]', dialog).forEach((input) => { input.value = ''; }); });
});
$$('[data-reveal]').forEach((button) => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.reveal);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.setAttribute('aria-label', input.type === 'password' ? 'Parolni ko‘rsatish' : 'Parolni yashirish');
}));
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (authBusy) return;
  authBusy = true;
  const button = $('button[type="submit"]', event.target);
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#admin-password').value }) });
    setAdmin(true);
    $('#login-dialog').close();
    await loadData(data?.year);
    toast('Admin sifatida kirdingiz. Endi to‘lovlarni boshqarishingiz mumkin.');
  } catch (error) { $('#login-error').textContent = error.message; }
  finally { authBusy = false; button.disabled = false; }
});
$('#logout-button').addEventListener('click', async () => {
  if (authBusy || saving) return;
  authBusy = true;
  $('#logout-button').disabled = true;
  try {
    await api('/api/logout', { method: 'POST', body: '{}' });
    ++loadNumber;
    loading = false;
    setAdmin(false);
    render();
    $('#account-dialog').close();
    saveStatus('Jadval yangilangan');
    toast('Hisobdan chiqdingiz. Jadval faqat ko‘rish rejimida.');
  } catch (error) { toast(error.message); }
  finally { authBusy = false; $('#logout-button').disabled = false; }
});
$('#change-password-button').addEventListener('click', () => {
  $('#account-dialog').close();
  $('#password-form').reset();
  $('#password-error').textContent = '';
  openDialog('#password-dialog');
});
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (authBusy) return;
  $('#password-error').textContent = '';
  if ($('#new-password').value !== $('#confirm-password').value) { $('#password-error').textContent = 'Yangi parollar bir xil emas.'; return; }
  authBusy = true;
  const button = $('button[type="submit"]', event.target);
  button.disabled = true;
  try {
    await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword: $('#current-password').value, newPassword: $('#new-password').value }) });
    $('#password-dialog').close();
    toast('Parol almashtirildi. Boshqa qurilmalardagi admin hisoblari yopildi.');
  } catch (error) { $('#password-error').textContent = error.message; }
  finally { authBusy = false; button.disabled = false; }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.matches('input, textarea, select') && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#member-search').focus(); }
});
window.addEventListener('online', () => { void loadData(data?.year, true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadData(data?.year, true); });
setInterval(() => { if (!document.hidden) void loadData(data?.year, true); }, 30000);
void loadData();
