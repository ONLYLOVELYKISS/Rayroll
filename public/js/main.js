document.addEventListener('DOMContentLoaded', () => {
    const byId = (id) => document.getElementById(id);
    const fileInput = byId('file-input');
    const imageInput = byId('image-input');
    const uploadButton = byId('upload-button');
    const statusMessage = byId('status-message');
    const statusPanel = byId('status-panel');
    const fileNameDisplay = byId('file-name-display');
    const reviewDialog = byId('review-dialog');
    const settingsDialog = byId('settings-dialog');
    const reviewRecords = byId('review-records');
    const manualDialog = byId('manual-record-dialog');
    const manualForm = byId('manual-record-form');
    const viewModeGroup = byId('view-mode-group');
    const chartTypeGroup = byId('chart-type-group');
    const yearSelect = byId('year-select');
    const monthSelect = byId('month-select');
    const searchInput = byId('record-search');

    const grossKeys = Object.keys(COLUMN_DEFINITIONS).filter((key) => COLUMN_DEFINITIONS[key].type === 'grossPay');
    const deductionKeys = Object.keys(COLUMN_DEFINITIONS).filter((key) => COLUMN_DEFINITIONS[key].type === 'deduction');
    const aliases = Object.entries(COLUMN_DEFINITIONS).flatMap(([key, definition]) =>
        definition.aliases.map((alias) => [normalizeText(alias), key])
    );
    const localDate = new Date();
    const currentMonth = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}`;
    const state = { records: [], drafts: [], expenses: [], payItems: [], settings: { employee: '', month: currentMonth }, theme: localStorage.getItem('rayroll-theme') || 'system', view: 'all', filter: '', chart: 'bar', page: 1, pageSize: 8, search: '', busy: false };
    let chart;
    let tesseractWorker;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme(systemDark = systemTheme.matches) {
        const mode = ['system', 'light', 'dark'].includes(state.theme) ? state.theme : 'system';
        document.documentElement.dataset.themeMode = mode;
        const resolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
        document.documentElement.dataset.theme = resolvedTheme;
        document.querySelector('meta[name="theme-color"]').content = resolvedTheme === 'light' ? '#eef2f4' : '#0d1116';
        if (byId('theme-mode')) byId('theme-mode').value = mode;
        if (chart) renderCharts();
    }
    applyTheme();
    const handleSystemThemeChange = (event) => { if (state.theme === 'system') applyTheme(event.matches); };
    if (systemTheme.addEventListener) systemTheme.addEventListener('change', handleSystemThemeChange);
    else systemTheme.addListener?.(handleSystemThemeChange);

    function personalRecords() {
        return state.settings.employee ? state.records.filter((record) => record.name === state.settings.employee) : [];
    }

    function populateProfileSelectors() {
        const employees = [...new Set(state.records.map((record) => record.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        if (employees.length === 1 && !state.settings.employee) state.settings.employee = employees[0];
        ['budget-employee', 'insight-employee', 'record-employee'].forEach((id) => {
            const select = byId(id);
            select.innerHTML = employees.length > 1 ? '<option value="">选择本人档案</option>' : '';
            select.insertAdjacentHTML('beforeend', employees.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join(''));
            select.value = employees.includes(state.settings.employee) ? state.settings.employee : '';
        });
    }

    function showAppError(title, detail = '数据仍保存在本机。请重试；若仍失败，可重新加载应用。') {
        byId('error-title').textContent = title;
        byId('error-detail').textContent = detail;
        byId('error-toast').hidden = false;
    }

    window.addEventListener('error', (event) => {
        console.error('Uncaught application error', event.error || event.message);
        setBusy(false);
        showAppError('\u5e94\u7528\u9047\u5230\u5f02\u5e38', event.message || '\u672c\u673a\u6570\u636e\u4ecd\u5728\u672c\u673a\uff0c\u8bf7\u91cd\u8bd5\u6216\u91cd\u65b0\u52a0\u8f7d\u3002');
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled application rejection', event.reason);
        setBusy(false);
        showAppError('\u64cd\u4f5c\u6ca1\u6709\u5b8c\u6210', event.reason?.message || String(event.reason || '\u8bf7\u91cd\u8bd5\u3002'));
    });

    function normalizeText(value) {
        return String(value ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
    }

    function isNonPersonName(value) {
        const name = normalizeText(value);
        const labels = new Set(['\u8bf4\u660e', '\u5907\u6ce8', '\u6ce8\u91ca', '\u6ce8', '\u63d0\u793a', '\u5408\u8ba1', '\u603b\u8ba1', '\u5c0f\u8ba1', '\u672c\u6708\u5408\u8ba1', '\u90e8\u95e8\u5408\u8ba1', '\u516c\u53f8\u5408\u8ba1', '\u603b\u989d', '\u5e73\u5747', '\u516c\u53f8', '\u5de5\u8d44\u8be6\u60c5', '\u5de5\u8d44\u660e\u7ec6', '\u6536\u5165\u9879\u76ee', '\u6263\u6b3e\u9879\u76ee']);
        return !name || labels.has(name) || /^(?:说明|备注|注释|提示|附注|本表|合计|总计|小计)/.test(name) || /(?:工资月份|所属月份|发薪日期|工资表|工资明细|薪资表|薪酬表|payroll|payslip|\d{4}年\d{1,2}月)/i.test(name);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    function parseMoney(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        let cleaned = String(value ?? '').trim().replace(/人民币|RMB|CNY/gi, '').replace(/[¥￥元,，\s]/g, '').replace(/[−－]/g, '-');
        if (!cleaned || ['-', '—', '无', 'n/a'].includes(cleaned.toLowerCase())) return 0;
        const parenthesized = (cleaned.startsWith('(') && cleaned.endsWith(')')) || (cleaned.startsWith('（') && cleaned.endsWith('）'));
        const trailingMinus = cleaned.endsWith('-');
        cleaned = cleaned.replace(/[()（）]/g, '').replace(/-$/, '');
        const numeric = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
        const parsed = numeric ? Number.parseFloat(numeric[0]) : Number.NaN;
        return Number.isFinite(parsed) ? (parenthesized || trailingMinus ? -Math.abs(parsed) : parsed) : 0;
    }

    function matchColumn(header) {
        const normalized = normalizeText(header);
        if (!normalized) return null;
        if (/(?:应发|税前|收入).{0,6}(?:合计|总额|总计)|(?:合计|总额|总计).{0,6}(?:应发|税前|收入)/.test(normalized)) return 'grossPayTotal';
        if (/(?:应扣|扣款|扣除|扣减).{0,6}(?:合计|总额|总计)|(?:合计|总额|总计).{0,6}(?:应扣|扣款|扣除|扣减)/.test(normalized)) return 'deductionTotal';
        if (/(?:实发|到手|实领|到账|到卡).{0,6}(?:合计|工资|金额|总额)|(?:合计|金额|工资).{0,6}(?:实发|到手|实领|到账|到卡)/.test(normalized)) return 'netPay';
        let exact = aliases.find(([alias]) => alias === normalized);
        if (exact) return exact[1];
        // Prefer the most specific phrase: e.g. “扣养老保险” must not be
        // swallowed by a shorter “养老保险” alias, and never match a header
        // just because it is a short fragment of an alias.
        const contained = aliases
            .filter(([alias]) => alias.length >= 2 && normalized.includes(alias))
            .sort((a, b) => b[0].length - a[0].length);
        return contained[0]?.[1] || null;
    }

    function monthValue(value, preferRangeEnd = false) {
        if (value instanceof Date && !Number.isNaN(value.valueOf())) {
            return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
        }
        if (typeof value === 'number' && value > 20000 && value < 80000 && XLSX.SSF?.parse_date_code) {
            const date = XLSX.SSF.parse_date_code(value);
            if (date) return `${date.y}-${String(date.m).padStart(2, '0')}`;
        }
        let text = String(value ?? '').trim();
        if (preferRangeEnd) {
            const fullDates = [...text.matchAll(/20\d{2}\s*[年./_-]\s*(?:1[0-2]|0?[1-9])\s*(?:月\s*(?:0?[1-9]|[12]\d|3[01])日?)?/g)];
            if (fullDates.length > 1) text = fullDates.at(-1)[0];
            else {
                const usDates = [...text.matchAll(/(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])[/.-]20\d{2}/g)];
                if (usDates.length > 1) text = usDates.at(-1)[0];
            }
        }
        const match = text.match(/(20\d{2})\s*[年./_-]\s*(1[0-2]|0?[1-9])\s*月?/);
        if (match) return `${match[1]}-${match[2].padStart(2, '0')}`;
        const usDate = text.match(/(?:^|\b)(0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])[/.-](20\d{2})(?:\b|$)/);
        if (usDate) return `${usDate[2]}-${usDate[1].padStart(2, '0')}`;
        const reversed = text.match(/(?:^|\b)(0?[1-9]|1[0-2])[/.-](20\d{2})(?:\b|$)/);
        if (reversed) return `${reversed[2]}-${reversed[1].padStart(2, '0')}`;
        const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(?:0?[1-9]|[12]\d|3[01]),?\s*(20\d{2})\b/i);
        if (named) {
            const month = named[1].slice(0, 3).toLowerCase();
            return `${named[2]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month) + 1).padStart(2, '0')}`;
        }
        return '';
    }

    function resolvePayrollColumn(header, index) {
        const headerText = normalizeText(header);
        if (/单位缴|公司缴|企业缴|单位承担|公司承担|企业承担/.test(headerText)) return null;
        const key = matchColumn(header);
        if (key) return { key, label: COLUMN_DEFINITIONS[key].displayName, known: true };
        const text = String(header ?? '').trim();
        const normalized = normalizeText(text);
        if (!normalized || /^(?:金额|数额|合计|备注|说明|序号|编号|单位|签字|日期)$/.test(normalized)) return null;

        const catalogMatches = state.payItems.filter((item) => normalizeText(item.label) === normalized);
        const catalogTypes = [...new Set(catalogMatches.map((item) => item.type))];
        if (catalogTypes.length === 1) {
            const type = catalogTypes[0];
            return { key: `custom_${type}_${index}`, label: text, type, known: false };
        }

        // Keep company-specific pay and deduction items instead of dropping
        // them. Their direction is inferred only from explicit payroll terms.
        const deduction = /代扣|扣款|扣除|罚款|个人缴|养老保险|医疗保险|失业保险|生育保险|工伤保险|社保|公积金|个税|所得税|年金|会费|withholding|deduction|employeecontribution|insurance|providentfund/.test(normalized);
        const income = /工资|薪酬|薪资|奖金|补贴|津贴|补助|加班费|绩效|提成|补发|补偿金|收入|salary|allowance|bonus|overtime|commission|earnings|income|stipend/.test(normalized);
        if (!deduction && !income) return null;
        const type = deduction ? 'deduction' : 'grossPay';
        return { key: `custom_${type}_${index}`, label: text, type, known: false };
    }

    function calculate(record) {
        const itemGross = grossKeys.reduce((sum, key) => sum + parseMoney(record[key]), 0) +
            (record.unmappedGrossKeys || []).reduce((sum, key) => sum + parseMoney(record[key]), 0);
        const itemDeduction = deductionKeys.reduce((sum, key) => sum + parseMoney(record[key]), 0) +
            (record.unmappedDeductionKeys || []).reduce((sum, key) => sum + parseMoney(record[key]), 0);
        const calculatedGrossPay = itemGross || parseMoney(record.grossPayTotal);
        const calculatedDeduction = itemDeduction || parseMoney(record.deductionTotal);
        const expectedNetPay = calculatedGrossPay - calculatedDeduction;
        const netSource = record.netPay === undefined || record.netPay === '' ? expectedNetPay : parseMoney(record.netPay);
        record.grossPayTotal = record.grossPayTotal === undefined ? calculatedGrossPay : parseMoney(record.grossPayTotal);
        record.deductionTotal = record.deductionTotal === undefined ? calculatedDeduction : parseMoney(record.deductionTotal);
        record.netPay = netSource;
        record.calculatedGrossPay = calculatedGrossPay;
        record.calculatedDeduction = calculatedDeduction;
        record.calculatedNetPay = netSource;
        const check = (reported, calculated) => reported === undefined || reported === null || reported === '' ? 'n/a' : Math.abs(parseMoney(reported) - calculated) < 0.01 ? 'ok' : 'mismatch';
        record.grossPayStatus = check(record.grossPayTotal, calculatedGrossPay);
        record.deductionStatus = check(record.deductionTotal, calculatedDeduction);
        record.netPayStatus = check(record.netPay, expectedNetPay);
        return record;
    }

    function setStatus(message, kind = '') {
        statusMessage.textContent = message;
        statusPanel.className = `status-panel ${kind}`.trim();
        if (kind === 'success') byId('error-toast').hidden = true;
    }

    function setBusy(isBusy, message = '') {
        state.busy = isBusy;
        uploadButton.disabled = isBusy;
        uploadButton.innerHTML = isBusy ? '<i data-feather="loader" class="spin"></i> 正在识别…' : '<i data-feather="scan"></i> 开始识别';
        if (message) setStatus(message, isBusy ? 'busy' : '');
        feather.replace();
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('rayroll', 2);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'recordId' });
                if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('payItems')) db.createObjectStore('payItems', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('数据库升级被旧页面占用。请关闭其他薪澈窗口后重试。'));
        });
    }

    async function readStore(storeName) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        });
    }

    async function saveStoreItem(storeName, item) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            transaction.objectStore(storeName).put(item);
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
            transaction.onabort = () => { db.close(); reject(transaction.error); };
        });
    }

    async function deleteStoreItem(storeName, id) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            transaction.objectStore(storeName).delete(id);
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
        });
    }

    async function readRecords() {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const request = db.transaction('records', 'readonly').objectStore('records').getAll();
            request.onsuccess = () => {
                const records = request.result.filter((record) => !isNonPersonName(record.name));
                db.close();
                resolve(records);
            };
            request.onerror = () => { db.close(); reject(request.error); };
        });
    }

    async function saveRecords(records) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('records', 'readwrite');
            const store = transaction.objectStore('records');
            records.forEach((record) => {
                const normalized = calculate({ ...record });
                store.put({ ...normalized, updatedAt: Date.now(), recordId: `${normalized.name}-${normalized['月份']}` });
            });
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
            transaction.onabort = () => { db.close(); reject(transaction.error); };
        });
    }

    async function clearRecords() {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('records', 'readwrite');
            transaction.objectStore('records').clear();
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
        });
    }

    async function addExpense(expense) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('expenses', 'readwrite');
            transaction.objectStore('expenses').add(expense);
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
        });
    }

    async function saveBudgetSettings() {
        await saveStoreItem('settings', { key: 'budget', ...state.settings });
    }

    async function clearAllLocalData() {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['records', 'expenses', 'payItems', 'settings'], 'readwrite');
            ['records', 'expenses', 'payItems', 'settings'].forEach((name) => transaction.objectStore(name).clear());
            transaction.oncomplete = () => { db.close(); resolve(); };
            transaction.onerror = () => { db.close(); reject(transaction.error); };
        });
    }

    function money(value) {
        return `¥ ${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function monthLabel(month) {
        return /^\d{4}-\d{2}$/.test(month || '') ? `${month.slice(0, 4)}年${Number(month.slice(5))}月` : '未识别月份';
    }

    function visibleRecords() {
        const query = normalizeText(state.search);
        const records = state.records.filter((record) => {
            const matchesSearch = !query || normalizeText(`${record.name} ${record.department || ''} ${record.employer || ''}`).includes(query);
            const matchesMonth = state.view !== 'month' || !state.filter || record['月份'] === state.filter;
            const matchesYear = state.view !== 'year' || !state.filter || String(record['月份']).startsWith(state.filter);
            return matchesSearch && matchesMonth && matchesYear;
        });
        return records.sort((a, b) => String(b['月份']).localeCompare(String(a['月份'])) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
    }

    function updateFilterControls() {
        viewModeGroup.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
        const months = [...new Set(state.records.map((record) => record['月份']).filter((month) => /^\d{4}-\d{2}$/.test(month)))].sort().reverse();
        const years = [...new Set(months.map((month) => month.slice(0, 4)))];
        yearSelect.innerHTML = '<option value="">全部年份</option>' + years.map((year) => `<option value="${year}">${year} 年</option>`).join('');
        monthSelect.innerHTML = '<option value="">全部月份</option>' + months.map((month) => `<option value="${month}">${monthLabel(month)}</option>`).join('');
        yearSelect.style.display = state.view === 'year' ? '' : 'none';
        monthSelect.style.display = state.view === 'month' ? '' : 'none';
        if (state.view === 'year') yearSelect.value = state.filter;
        if (state.view === 'month') monthSelect.value = state.filter;
    }

    function renderOverview() {
        populateProfileSelectors();
        const records = personalRecords();
        const personalExpenses = state.expenses.filter((expense) => expense.employee === state.settings.employee);
        const availableMonths = [...new Set([currentMonth, ...records.map((record) => record['月份']), ...personalExpenses.map((expense) => expense.month)].filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')))].sort().reverse();
        const homeMonth = byId('home-month');
        if (!availableMonths.includes(state.settings.month)) state.settings.month = availableMonths[0] || currentMonth;
        homeMonth.innerHTML = availableMonths.map((month) => `<option value="${month}">${escapeHtml(monthLabel(month))}</option>`).join('');
        homeMonth.value = state.settings.month;
        const monthRecords = records.filter((record) => record['月份'] === state.settings.month);
        const salary = [...monthRecords].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
        const expenses = state.expenses.filter((expense) => expense.employee === state.settings.employee && expense.month === state.settings.month);
        const spent = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        const income = salary ? Number(salary.calculatedNetPay ?? salary.netPay ?? 0) : 0;
        const remaining = income - spent;
        byId('hero-net').textContent = salary ? money(remaining) : '待录入';
        byId('hero-net').classList.toggle('over-budget', salary && remaining < 0);
        byId('hero-gross').textContent = salary ? money(income) : '待录入';
        byId('hero-records').textContent = money(spent);
        byId('hero-people').textContent = `${monthRecords.length} 条`;
        byId('home-progress-fill').style.width = `${salary && income > 0 ? Math.min(100, Math.max(0, spent / income * 100)) : 0}%`;
        byId('home-progress-fill').classList.toggle('over-budget', salary && spent > income);
        byId('home-summary-note').textContent = !state.settings.employee
            ? '请先导入工资条并选择本人档案；不同姓名不会混合统计。'
            : salary ? (remaining < 0 ? `已记花销超过本月实发 ${money(Math.abs(remaining))}。核对账目，了解本月实际收支。` : `本月工资记录已匹配；已录花销 ${expenses.length} 笔，余额按本机账目计算。`)
                : `${monthLabel(state.settings.month)} 暂无工资条；已记花销 ${money(spent)}，添加工资记录后即可计算余额。`;
        const recent = [...records].sort((a, b) => String(b['月份']).localeCompare(String(a['月份']))).slice(0, 4);
        byId('recent-records').innerHTML = recent.map((record) => `<button class="recent-item" data-open-records><span class="person-avatar">${escapeHtml((record.name || '薪').slice(0, 1))}</span><span class="recent-meta"><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(monthLabel(record['月份']))}${record.department ? ` · ${escapeHtml(record.department)}` : ''}</small></span><span class="recent-amount">${money(record.calculatedNetPay)}</span></button>`).join('');
        if (!recent.length) byId('recent-records').innerHTML = '<div class="empty-state">选择本人档案后，这里显示该档案的工资记录。</div>';
    }

    function renderBudget() {
        populateProfileSelectors();
        const employeeSelect = byId('budget-employee');
        const monthSelect = byId('budget-month');
        const employees = [...new Set(state.records.map((record) => record.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        if (!employees.length) employeeSelect.innerHTML = '<option value="">先录入或导入工资条</option>';
        if (!employees.includes(state.settings.employee)) state.settings.employee = employees.length === 1 ? employees[0] : '';
        employeeSelect.value = state.settings.employee;

        const months = [...new Set([currentMonth, ...state.records.map((record) => record['月份']), ...state.expenses.map((expense) => expense.month)].filter((month) => /^\d{4}-\d{2}$/.test(month || '')))].sort().reverse();
        monthSelect.innerHTML = months.map((month) => `<option value="${month}">${escapeHtml(monthLabel(month))}</option>`).join('');
        if (!months.includes(state.settings.month)) state.settings.month = months[0] || currentMonth;
        monthSelect.value = state.settings.month;

        const salary = state.records
            .filter((record) => record.name === state.settings.employee && record['月份'] === state.settings.month)
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
        const income = salary ? Number(salary.calculatedNetPay ?? salary.netPay ?? 0) : 0;
        const expenses = state.expenses.filter((expense) => expense.employee === state.settings.employee && expense.month === state.settings.month).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
        const spent = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        const remaining = income - spent;
        byId('budget-income').textContent = salary ? money(income) : '待录入';
        byId('budget-source-note').textContent = !employees.length
            ? '先导入或手动录入工资条，再按当月实发工资核销花销。'
            : !state.settings.employee
                ? '请选择本人工资档案；不同姓名不会合并计算。'
                : salary ? `${salary.employer || '本人工资记录'} · ${monthLabel(state.settings.month)} 实发工资` : `该档案 ${monthLabel(state.settings.month)} 暂无工资记录；录入后即可核销。`;
        byId('budget-spent').textContent = money(spent);
        byId('budget-remaining').textContent = salary ? money(remaining) : '—';
        byId('budget-remaining').classList.toggle('over-budget', salary && remaining < 0);
        const progress = salary && income > 0 ? Math.min(100, Math.max(0, spent / income * 100)) : 0;
        byId('budget-progress-fill').style.width = `${progress}%`;
        byId('budget-progress-fill').classList.toggle('over-budget', salary && spent > income);

        const [year, monthNumber] = state.settings.month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNumber, 0).getDate();
        const now = new Date();
        const isCurrentMonth = year === now.getFullYear() && monthNumber === now.getMonth() + 1;
        const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && monthNumber < now.getMonth() + 1);
        const elapsedDays = isCurrentMonth ? now.getDate() : isPastMonth ? daysInMonth : 0;
        const daysLeft = isCurrentMonth ? daysInMonth - now.getDate() + 1 : 0;
        byId('expense-daily-average').textContent = elapsedDays ? money(spent / elapsedDays) : '本月尚未开始';
        byId('expense-daily-allowance').textContent = salary && daysLeft ? money(Math.max(0, remaining) / daysLeft) : salary && remaining <= 0 ? '已超出收入' : isPastMonth ? '月份已结束' : '—';

        const categoryTotals = new Map();
        expenses.forEach((expense) => categoryTotals.set(expense.category, (categoryTotals.get(expense.category) || 0) + Number(expense.amount || 0)));
        byId('expense-categories-summary').innerHTML = categoryTotals.size
            ? [...categoryTotals].sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<div class="expense-category-row"><span>${escapeHtml(category)} <small>${spent ? (amount / spent * 100).toFixed(1) : '0.0'}%</small></span><strong>${money(amount)}</strong><i style="width:${spent ? Math.min(100, amount / spent * 100) : 0}%"></i></div>`).join('')
            : '<div class="empty-state">记下第一笔花销后，这里会显示分类汇总。</div>';
        byId('expense-total-share').textContent = spent ? `${expenses.length} 笔 · 100%` : '';
        byId('expense-count').textContent = `${expenses.length} 笔`;
        const expenseDays = new Map();
        expenses.forEach((expense) => expenseDays.set(expense.date, [...(expenseDays.get(expense.date) || []), expense]));
        byId('expense-list').innerHTML = expenses.length
            ? [...expenseDays].map(([date, items]) => `<section class="expense-day-group"><header><strong>${escapeHtml(date)}</strong><span>${items.length} 笔 · ${money(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))}</span></header>${items.map((expense) => `<article class="expense-item"><span class="expense-item-meta"><strong>${escapeHtml(expense.category)}</strong><small>${escapeHtml(expense.note || '—')}</small></span><strong class="expense-item-amount">${money(expense.amount)}</strong><button class="icon-button expense-edit" data-edit-expense="${escapeHtml(expense.id)}" aria-label="编辑花销"><i data-feather="edit-2"></i></button><button class="icon-button" data-delete-expense="${escapeHtml(expense.id)}" aria-label="删除花销"><i data-feather="trash-2"></i></button></article>`).join('')}</section>`).join('')
            : '<div class="empty-state">本月还没有花销记录。</div>';
        const categories = [...new Set(['餐饮', '住房', '交通', '购物', '医疗', '娱乐', '订阅', '其他', ...state.expenses.map((expense) => expense.category)])];
        byId('expense-categories').innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('');
        byId('expense-quick-categories').innerHTML = categories.slice(0, 8).map((category) => `<button type="button" class="quick-category" data-category="${escapeHtml(category)}" aria-pressed="${byId('expense-category').value === category}">${escapeHtml(category)}</button>`).join('');
        const employerOptions = [...new Set([...state.records.map((record) => record.employer), ...state.payItems.map((item) => item.employer)].filter(Boolean))];
        byId('employer-options').innerHTML = employerOptions.map((employer) => `<option value="${escapeHtml(employer)}"></option>`).join('');
    }

    function renderPayItemCatalog() {
        const options = [...new Set([...state.payItems.map((item) => item.label), ...Object.values(COLUMN_DEFINITIONS).filter((item) => ['grossPay', 'deduction'].includes(item.type)).map((item) => item.displayName)])];
        byId('pay-item-options').innerHTML = options.map((label) => `<option value="${escapeHtml(label)}"></option>`).join('');
        byId('pay-item-list').innerHTML = state.payItems.length
            ? [...state.payItems].sort((a, b) => String(a.employer).localeCompare(String(b.employer), 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN')).map((item) => `<div class="pay-item-row"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.employer || '通用')} · ${item.type === 'deduction' ? '扣款' : '收入'}</small></span><button class="text-button" data-delete-pay-item="${escapeHtml(item.id)}">移除</button></div>`).join('')
            : '<small>添加公司专属项目后，可在手动录入时快速选择。</small>';
    }

    function payItemId(employer, label, type) {
        return `${normalizeText(employer || '通用')}|${type}|${normalizeText(label)}`;
    }

    async function rememberPayItem(employer, label, type) {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel || !['grossPay', 'deduction'].includes(type)) return;
        const item = { id: payItemId(employer, cleanLabel, type), employer: String(employer || '').trim(), label: cleanLabel, type };
        await saveStoreItem('payItems', item);
        state.payItems = [...state.payItems.filter((entry) => entry.id !== item.id), item];
    }

    function updateManualTotals() {
        let gross = 0;
        let deduction = 0;
        byId('manual-item-rows').querySelectorAll('.manual-item-row').forEach((row) => {
            const label = row.querySelector('.manual-item-label').value.trim();
            const amount = Math.abs(parseMoney(row.querySelector('.manual-item-amount').value));
            if (!label) return;
            if (row.querySelector('.manual-item-type').value === 'deduction') deduction += amount;
            else gross += amount;
        });
        byId('manual-gross-total').textContent = money(gross);
        byId('manual-deduction-total').textContent = money(deduction);
        byId('manual-net-total').textContent = money(gross - deduction);
    }

    function addManualItemRow(item = {}) {
        const row = document.createElement('div');
        row.className = 'manual-item-row';
        row.innerHTML = '<select class="manual-item-type" aria-label="项目类型"><option value="grossPay">收入</option><option value="deduction">扣款</option></select><input class="manual-item-label" list="pay-item-options" placeholder="项目名称" maxlength="40" aria-label="工资项目" required><input class="manual-item-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="金额" aria-label="项目金额" required><button class="icon-button" type="button" data-remove-manual-item aria-label="移除项目">×</button>';
        row.querySelector('.manual-item-type').value = item.type || 'grossPay';
        row.querySelector('.manual-item-label').value = item.label || '';
        row.querySelector('.manual-item-amount').value = item.amount ?? '';
        row.querySelector('.manual-item-label').addEventListener('change', () => {
            const employer = normalizeText(byId('manual-employer').value);
            const label = normalizeText(row.querySelector('.manual-item-label').value);
            const match = state.payItems.find((entry) => normalizeText(entry.label) === label && (!entry.employer || normalizeText(entry.employer) === employer));
            if (match) row.querySelector('.manual-item-type').value = match.type;
            updateManualTotals();
        });
        row.addEventListener('input', updateManualTotals);
        row.addEventListener('change', updateManualTotals);
        row.querySelector('[data-remove-manual-item]').addEventListener('click', () => {
            row.remove();
            if (!byId('manual-item-rows').children.length) addManualItemRow();
            updateManualTotals();
        });
        byId('manual-item-rows').append(row);
    }

    async function saveManualRecord(event) {
        event.preventDefault();
        if (!manualForm.reportValidity()) return;
        const employer = byId('manual-employer').value.trim();
        const record = {
            name: byId('manual-name').value.trim(),
            '月份': byId('manual-month').value,
            employer,
            department: byId('manual-department').value.trim(),
            unmappedGrossKeys: [], unmappedDeductionKeys: [], customLabels: {}
        };
        try {
            let index = 0;
            for (const row of byId('manual-item-rows').querySelectorAll('.manual-item-row')) {
                const label = row.querySelector('.manual-item-label').value.trim();
                const rawAmount = row.querySelector('.manual-item-amount').value;
                if (!label || rawAmount === '') continue;
                const type = row.querySelector('.manual-item-type').value;
                const amount = Math.abs(parseMoney(rawAmount));
                if (!(amount > 0)) continue;
                const key = `custom_${type}_${index++}`;
                const target = type === 'deduction' ? record.unmappedDeductionKeys : record.unmappedGrossKeys;
                target.push(key);
                record.customLabels[key] = label;
                record[key] = amount;
                await rememberPayItem(employer, label, type);
            }
            if (!index) {
                showAppError('还没有工资项目', '至少填写一个项目名称和金额，再保存工资条。');
                return;
            }
            await saveRecords([calculate(record)]);
            state.records = await readRecords();
            state.settings.employee = record.name;
            state.settings.month = record['月份'];
            await saveBudgetSettings();
            manualDialog.close();
            manualForm.reset();
            byId('manual-item-rows').replaceChildren();
            addManualItemRow();
            refresh();
            setStatus(`已录入 ${record.name} 的 ${monthLabel(record['月份'])} 工资条。`, 'success');
        } catch (error) {
            showAppError('工资条没有保存', error.message || '请检查本机存储空间后重试。');
        }
    }

    async function saveExpense(event) {
        event.preventDefault();
        const form = byId('expense-form');
        if (!form.reportValidity()) return;
        const editing = state.expenses.find((item) => item.id === byId('expense-edit-id').value);
        const employee = editing?.employee || state.settings.employee;
        if (!employee) {
            showAppError('先选择本人档案', '导入或手动录入一张本人工资条后，再选择工资档案记录花销。');
            return;
        }
        const date = byId('expense-date').value;
        const amount = Math.abs(parseMoney(byId('expense-amount').value));
        if (!date || !(amount > 0)) return;
        const expense = {
            id: byId('expense-edit-id').value || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            employee,
            date,
            month: date.slice(0, 7),
            category: byId('expense-category').value.trim(),
            amount,
            note: byId('expense-note').value.trim(),
            createdAt: Date.now()
        };
        try {
            if (byId('expense-edit-id').value) {
                await saveStoreItem('expenses', expense);
                state.expenses = state.expenses.map((entry) => entry.id === expense.id ? expense : entry);
            } else {
                await addExpense(expense);
                state.expenses.push(expense);
            }
            state.settings.month = expense.month;
            await saveBudgetSettings();
            byId('budget-month').value = expense.month;
            byId('expense-amount').value = '';
            byId('expense-note').value = '';
            byId('expense-edit-id').value = '';
            byId('expense-submit-label').textContent = '保存花销';
            refresh();
            setStatus(`已记录 ${expense.category} ${money(amount)}。`, 'success');
        } catch (error) {
            showAppError('花销没有保存', error.message || '请检查本机存储空间后重试。');
        }
    }

    function renderCharts() {
        const profileRecords = personalRecords();
        const records = profileRecords.filter((record) => {
            if (state.view === 'year' && state.filter) return String(record['月份']).startsWith(state.filter);
            if (state.view === 'month' && state.filter) return record['月份'] === state.filter;
            return true;
        });
        const groups = {};
        records.forEach((record) => {
            const month = record['月份'];
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return;
            const key = state.view === 'all' ? month.slice(0, 4) : month;
            if (!groups[key]) groups[key] = { gross: 0, net: 0, deduction: 0 };
            groups[key].gross += Number(record.calculatedGrossPay || 0);
            groups[key].net += Number(record.calculatedNetPay || 0);
            groups[key].deduction += Number(record.calculatedDeduction || 0);
        });
        const keys = Object.keys(groups).filter((key) => key !== 'unkno').sort();
        const styles = getComputedStyle(document.documentElement);
        const textColor = styles.getPropertyValue('--text').trim() || '#ece9e2';
        const mutedColor = styles.getPropertyValue('--muted').trim() || '#a3a6a4';
        const lineColor = styles.getPropertyValue('--line').trim() || 'rgba(255,255,255,.11)';
        const grossColor = styles.getPropertyValue('--amber').trim() || '#d7b46a';
        const netColor = styles.getPropertyValue('--mint').trim() || '#8ed7bd';
        const deductionColor = styles.getPropertyValue('--red').trim() || '#dc8e81';
        if (chart) { chart.dispose(); chart = null; }
        if (!keys.length) {
            byId('chart-container').innerHTML = `<div class="empty-state"><i data-feather="bar-chart-2"></i><p>${state.settings.employee ? '该档案当前筛选条件下没有工资记录' : '请选择本人档案查看个人收入走势'}</p></div>`;
            renderIncomeStats(records);
            feather.replace();
            return;
        }
        byId('chart-container').innerHTML = '';
        chart = echarts.init(byId('chart-container'));
        const colors = { gross: grossColor, net: netColor, deduction: deductionColor };
        const totals = keys.reduce((sum, key) => ({ gross: sum.gross + groups[key].gross, net: sum.net + groups[key].net, deduction: sum.deduction + groups[key].deduction }), { gross: 0, net: 0, deduction: 0 });
        const option = state.chart === 'bar' ? {
            color: [colors.gross, colors.net, colors.deduction],
            tooltip: { trigger: 'axis', backgroundColor: styles.getPropertyValue('--panel').trim(), borderColor: lineColor, textStyle: { color: textColor, fontSize: 12 }, valueFormatter: (value) => money(value) },
            legend: { bottom: 0, itemWidth: 8, itemHeight: 8, textStyle: { color: mutedColor, fontSize: 11 }, data: ['应发', '实发', '扣款'] },
            grid: { left: 48, right: 12, top: 20, bottom: 44 },
            xAxis: { type: 'category', data: keys, axisLine: { lineStyle: { color: lineColor } }, axisLabel: { color: mutedColor, fontSize: 11, interval: 'auto' } },
            yAxis: { type: 'value', axisLabel: { color: mutedColor, fontSize: 10, formatter: (value) => value >= 10000 ? `${(value / 10000).toFixed(0)}万` : value }, splitLine: { lineStyle: { color: lineColor } } },
            series: [{ name: '应发', type: 'bar', data: keys.map((key) => groups[key].gross), itemStyle: { borderRadius: [5, 5, 0, 0] }, barMaxWidth: 18 }, { name: '实发', type: 'bar', data: keys.map((key) => groups[key].net), itemStyle: { borderRadius: [5, 5, 0, 0] }, barMaxWidth: 18 }, { name: '扣款', type: 'line', smooth: true, symbolSize: 5, data: keys.map((key) => groups[key].deduction) }]
        } : {
            tooltip: { trigger: 'item', formatter: ({ name, value, percent }) => `${escapeHtml(name)}<br>${money(value)} · ${percent}%`, backgroundColor: styles.getPropertyValue('--panel').trim(), borderColor: lineColor, textStyle: { color: textColor, fontSize: 12 } },
            graphic: { type: 'text', left: 'center', top: 'center', style: { text: `实发\n${money(totals.net)}`, textAlign: 'center', fill: textColor, fontSize: 13, lineHeight: 22, fontFamily: 'DM Mono, sans-serif' } },
            series: [{ type: 'pie', radius: ['48%', '74%'], center: ['50%', '48%'], avoidLabelOverlap: true, label: { show: false }, itemStyle: { borderColor: styles.getPropertyValue('--panel').trim(), borderWidth: 3 }, data: [{ name: '实发工资', value: totals.net, itemStyle: { color: colors.net } }, { name: '扣款', value: totals.deduction, itemStyle: { color: colors.deduction } }] }]
        };
        chart.setOption(option);
        chart.resize();
        renderIncomeStats(records);
    }

    function updateRecordProfile() {
        const records = personalRecords().filter((record) => {
            const query = normalizeText(state.search);
            return !query || normalizeText(`${record.department || ''} ${record.employer || ''} ${record.position || ''}`).includes(query);
        }).sort((a, b) => String(b['月份']).localeCompare(String(a['月份'])));
        const totalNet = records.reduce((sum, record) => sum + Number(record.calculatedNetPay || 0), 0);
        const monthCount = new Set(records.map((record) => record['月份']).filter((month) => /^\d{4}-\d{2}$/.test(month || ''))).size;
        const latest = records[0];
        byId('salary-profile-summary').innerHTML = state.settings.employee
            ? `<div class="salary-profile-head"><span class="person-avatar">${escapeHtml(state.settings.employee.slice(0, 1))}</span><div><strong>${escapeHtml(state.settings.employee)}</strong><small>${latest ? `${escapeHtml(latest.employer || '个人工资档案')} · 最近记录 ${escapeHtml(monthLabel(latest['月份']))}` : '个人工资档案'}</small></div></div><div class="salary-profile-stats"><div><span>累计实发</span><strong>${money(totalNet)}</strong></div><div><span>有记录月份</span><strong>${monthCount} 个月</strong></div><div><span>工资条数量</span><strong>${records.length} 条</strong></div></div>`
            : '<div class="empty-state">先在顶部选择本人档案。个人信息只汇总该档案，不混合其他员工记录。</div>';
        const person = state.settings.employee;
        byId('full-data-display').innerHTML = person ? records.map((record) => {
            const renderItems = (keys, unmapped = []) => {
                const items = [...keys.map((key) => ({ label: COLUMN_DEFINITIONS[key].displayName, value: parseMoney(record[key]) })), ...unmapped.map((key) => ({ label: record.customLabels?.[key] || key, value: parseMoney(record[key]) }))].filter((item) => item.value);
                return items.length ? items.map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>${money(item.value)}</strong></li>`).join('') : '<li class="no-pay-items">本类暂无明细</li>';
            };
            const status = [record.grossPayStatus, record.deductionStatus, record.netPayStatus].includes('mismatch') ? '<span class="record-check warning"><i data-feather="alert-triangle"></i> 合计与明细不一致，请核对</span>' : [record.grossPayStatus, record.deductionStatus, record.netPayStatus].every((item) => item === 'ok') ? '<span class="record-check"><i data-feather="check-circle"></i> 明细与工资单合计一致</span>' : '';
            return `<article class="salary-month-card"><header><div><span class="eyebrow">PAYROLL STATEMENT</span><h2>${escapeHtml(monthLabel(record['月份']))}</h2><small>${escapeHtml(record.employer || '个人工资记录')}${record.department ? ` · ${escapeHtml(record.department)}` : ''}</small></div><span class="salary-month-badge">实发 ${money(record.calculatedNetPay)}</span></header>${status}<details class="salary-detail"><summary>查看工资构成与扣款明细</summary><div class="salary-detail-grid"><section><h3>收入项目</h3><ul>${renderItems(grossKeys, record.unmappedGrossKeys)}</ul></section><section><h3>扣款项目</h3><ul>${renderItems(deductionKeys, record.unmappedDeductionKeys)}</ul></section></div><div class="salary-totals"><div><span>应发合计</span><strong>${money(record.calculatedGrossPay)}</strong></div><div><span>扣款合计</span><strong>${money(record.calculatedDeduction)}</strong></div><div><span>实发工资</span><strong>${money(record.calculatedNetPay)}</strong></div></div></details></article>`;
        }).join('') : '';
        if (person && !records.length) byId('full-data-display').innerHTML = '<div class="empty-state">这个档案还没有工资条。可导入 Excel、图片，或手动录入。</div>';
        feather.replace();
    }

    function renderIncomeStats(records) {
        const months = new Map();
        records.forEach((record) => {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record['月份'] || '')) return;
            const item = months.get(record['月份']) || { gross: 0, deduction: 0, net: 0, count: 0 };
            item.gross += Number(record.calculatedGrossPay || 0);
            item.deduction += Number(record.calculatedDeduction || 0);
            item.net += Number(record.calculatedNetPay || 0);
            item.count++;
            months.set(record['月份'], item);
        });
        const observed = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));
        const totals = observed.reduce((sum, [, month]) => ({ gross: sum.gross + month.gross, deduction: sum.deduction + month.deduction, net: sum.net + month.net }), { gross: 0, deduction: 0, net: 0 });
        const values = observed.map(([, month]) => month.net).sort((a, b) => a - b);
        const median = values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : null;
        const change = observed.length > 1 ? (() => {
            const [lastMonth, last] = observed.at(-1);
            const [year, month] = lastMonth.split('-').map(Number);
            const previousMonth = `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`;
            const previous = months.get(previousMonth);
            return previous && previous.net !== 0 ? (last.net - previous.net) / Math.abs(previous.net) * 100 : null;
        })() : null;
        const selected = Boolean(state.settings.employee);
        byId('insight-gross').textContent = selected ? money(totals.gross) : '—';
        byId('insight-net').textContent = selected ? money(totals.net) : '—';
        byId('insight-deduction').textContent = selected ? money(totals.deduction) : '—';
        byId('insight-deduction-rate').textContent = !selected ? '请选择本人档案' : totals.gross > 0 ? `占应发 ${(totals.deduction / totals.gross * 100).toFixed(1)}%` : '应发为零，未计算比例';
        byId('insight-net-rate').textContent = !selected || totals.gross <= 0 ? '—' : `${(totals.net / totals.gross * 100).toFixed(1)}%`;
        byId('insight-average').textContent = !selected || !values.length ? '—' : money(totals.net / values.length);
        byId('insight-median').textContent = !selected || median === null ? '—' : money(median);
        byId('insight-change').textContent = !selected ? '—' : change === null ? '缺少连续月份' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
        byId('insight-method').textContent = `本人档案：${state.settings.employee || '尚未选择，请先选档案'} · 当前筛选区间有记录月份 ${observed.length} 个月；缺失月份不填零。均值＝月实发合计 ÷ 有记录月份数；中位数为月实发排序中位数；环比仅在连续两月都有记录时计算。`;
    }

    function verificationIcon(status, reported, calculated) {
        if (status === 'ok') return '<i data-feather="check-circle" class="icon-success" title="与工资表总计一致"></i>';
        if (status === 'mismatch') return `<i data-feather="alert-triangle" class="icon-warning" title="工资表合计 ${money(reported)}，按明细计算 ${money(calculated)}"></i>`;
        return '';
    }

    function refresh() {
        updateFilterControls();
        renderOverview();
        renderCharts();
        updateRecordProfile();
        renderBudget();
        renderPayItemCatalog();
        feather.replace();
    }

    async function loadRecords() {
        try {
            const [records, expenses, payItems, settings] = await Promise.all([readRecords(), readStore('expenses'), readStore('payItems'), readStore('settings')]);
            state.records = records;
            state.expenses = expenses;
            state.payItems = payItems;
            const budget = settings.find((item) => item.key === 'budget');
            if (budget) state.settings = { employee: budget.employee || '', month: budget.month || currentMonth };
            const theme = settings.find((item) => item.key === 'theme');
            if (theme?.mode) { state.theme = theme.mode; applyTheme(); }
            if (!state.records.length && location.protocol === 'http:') {
                try {
                    const response = await fetch('/api/data');
                    if (response.ok) {
                        const legacy = await response.json();
                        if (legacy.length) { await saveRecords(legacy); state.records = await readRecords(); }
                    }
                } catch (_) { /* Desktop import is optional. */ }
            }
            refresh();
        } catch (error) {
            console.error('Failed to load local records', error);
            setStatus(`本地数据读取失败：${error.message}`, 'error');
            showAppError('无法读取本机数据', '请关闭其他应用窗口后重试。未执行删除操作。');
        }
    }

    function findHeaderRows(rows) {
        const candidates = [];
        rows.forEach((_, endIndex) => {
            for (let depth = 1; depth <= 2 && endIndex - depth + 1 >= 0; depth++) {
                const startIndex = endIndex - depth + 1;
                if (depth > 1 && rows.slice(startIndex, endIndex).some((row) => row.filter((cell) => String(cell ?? '').trim()).length < 2 || row.some((cell) => /\d/.test(String(cell ?? ''))))) continue;
                const width = Math.max(...rows.slice(startIndex, endIndex + 1).map((row) => row.length), 0);
                const labels = Array.from({ length: width }, (_, column) => rows
                    .slice(startIndex, endIndex + 1)
                    .map((row) => String(row[column] ?? '').trim())
                    .filter(Boolean)
                    .join(' '));
                const columns = labels.map((label, index) => resolvePayrollColumn(label, index));
                const useful = columns.filter(Boolean);
                const unique = new Set(useful.map((column) => column.key));
                const hasName = columns.some((column) => column?.key === 'name');
                const hasPay = columns.some((column) => column?.known && ['grossPay', 'deduction', 'summary'].includes(COLUMN_DEFINITIONS[column.key].type)) ||
                    columns.some((column) => !column?.known && column?.type);
                const score = unique.size * 10 + useful.filter((column) => column.known).length * 2 - (depth - 1);
                if (hasName && hasPay) candidates.push({ index: endIndex, startIndex, score, columns });
            }
        });
        candidates.sort((a, b) => a.index - b.index || b.score - a.score);
        const headers = [];
        for (const candidate of candidates) {
            const previous = headers.at(-1);
            if (previous && candidate.index <= previous.index + 1) {
                if (candidate.score > previous.score) headers[headers.length - 1] = candidate;
                continue;
            }
            headers.push(candidate);
        }
        return headers;
    }

    function findMonth(rows, sheetName, fileName) {
        const text = rows.flat().join(' ');
        const explicit = text.match(/(?:工资月份|所属月份|发薪月份|薪资月份)[^\d]{0,12}((?:20\d{2})\s*[年./_-]\s*(?:1[0-2]|0?[1-9])\s*月?)/);
        if (explicit) return monthValue(explicit[1]);
        const match = text.match(/(20\d{2})\s*[年./_-]\s*(1[0-2]|0?[1-9])\s*月?/);
        return monthValue(sheetName) || (match ? `${match[1]}-${match[2].padStart(2, '0')}` : '') || monthValue(fileName);
    }

    function rowToRecord(row, columns, month) {
        const record = { '月份': '', unmappedGrossKeys: [], unmappedDeductionKeys: [] };
        row.forEach((value, index) => {
            const column = columns[index];
            if (!column || value === '' || value === null || value === undefined) return;
            const { key, label } = column;
            const definition = COLUMN_DEFINITIONS[key];
            const type = definition?.type || column.type;
            let parsed = ['月份', 'payDate', 'periodStart', 'periodEnd'].includes(key) ? monthValue(value, true) || String(value).trim() : definition?.parser ? definition.parser(value) : type === 'summary' || type === 'grossPay' || type === 'deduction' || key === 'coefficient' ? parseMoney(value) : String(value).trim();
            if (type === 'deduction' || key === 'deductionTotal') parsed = Math.abs(parseMoney(parsed));
            record[key] = parsed;
            if (!column.known) {
                record.customLabels ||= {};
                record.customLabels[key] = label;
                const list = type === 'deduction' ? record.unmappedDeductionKeys : record.unmappedGrossKeys;
                if (!list.includes(key)) list.push(key);
            }
        });
        record['月份'] = (/^20\d{2}-(0[1-9]|1[0-2])$/.test(record['月份']) ? record['月份'] : '') || monthValue(record.periodEnd, true) || monthValue(record.periodStart, true) || monthValue(record.payDate, true) || month;
        if (isNonPersonName(record.name)) return null;
        return calculate(record);
    }

    async function parseExcel(files) {
        const parsed = [];
        let totalSheets = 0;
        for (const file of files) {
            setBusy(true, `读取 ${file.name}…`);
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
            for (const sheetName of workbook.SheetNames) {
                totalSheets++;
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
                const headerRows = findHeaderRows(rows);
                if (!headerRows.length) continue;
                for (let section = 0; section < headerRows.length; section++) {
                    const headerRow = headerRows[section];
                    const nextHeader = headerRows[section + 1];
                    const detectedMonth = findMonth(rows.slice(Math.max(0, headerRow.startIndex - 3), headerRow.index + 1), sheetName, file.name);
                    for (const row of rows.slice(headerRow.index + 1, nextHeader?.startIndex ?? rows.length)) {
                        if (!row.some((cell) => String(cell ?? '').trim())) continue;
                        const record = rowToRecord(row, headerRow.columns, detectedMonth);
                        if (record) parsed.push({ ...record, source: `${file.name} · ${sheetName}` });
                    }
                }
            }
        }
        if (!parsed.length) throw new Error(`扫描了 ${files.length} 个文件、${totalSheets} 个工作表，未匹配到包含姓名和工资字段的表头。`);
        return parsed;
    }

    async function getOcrWorker() {
        if (tesseractWorker) return tesseractWorker;
        if (!window.Tesseract) throw new Error('离线 OCR 资源尚未加载，请运行 npm run prepare:web。');
        tesseractWorker = await Tesseract.createWorker('chi_sim+eng', 1, {
            workerPath: new URL('vendor/tesseract-worker.min.js', document.baseURI).href,
            corePath: new URL('vendor/', document.baseURI).href,
            langPath: new URL('vendor/', document.baseURI).href,
            workerBlobURL: false,
            cacheMethod: 'refresh',
            gzip: true,
            logger: (progress) => {
                if (progress.status === 'recognizing text') setBusy(true, `\u56fe\u7247\u8bc6\u522b\u4e2d ${(progress.progress * 100).toFixed(0)}%...`);
                else if (progress.status === 'loading language traineddata') setBusy(true, `\u6b63\u5728\u52a0\u8f7d\u79bb\u7ebf OCR \u8bed\u8a00\u5305 ${(progress.progress * 100).toFixed(0)}%...`);
                else if (progress.status) setBusy(true, `\u6b63\u5728\u51c6\u5907\u672c\u5730 OCR: ${progress.status}...`);
            },
            errorHandler: (error) => {
                console.error('Tesseract worker error', error);
                showAppError('\u56fe\u7247\u8bc6\u522b\u5f15\u64ce\u5f02\u5e38', error?.message || '\u672c\u5730 OCR \u53d1\u751f\u9519\u8bef\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u56fe\u7247\u3002');
            }
        });
        return tesseractWorker;
    }

    function parseOcrText(text) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const normalizedLines = lines.map((line) => line.normalize('NFKC').replace(/[\s:：]/gu, ''));
        const findField = (pattern) => normalizedLines.map((line) => line.match(pattern)).find(Boolean);
        const findAdjacentValue = (labelPattern, valuePattern) => {
            for (let index = 0; index < normalizedLines.length; index++) {
                const line = normalizedLines[index];
                const label = line.match(labelPattern);
                if (!label) continue;
                const inline = line.slice(label.index + label[0].length).match(valuePattern);
                if (inline) return inline[1] || inline[0];
                const following = normalizedLines[index + 1]?.match(valuePattern);
                if (following) return following[1] || following[0];
            }
            return '';
        };
        const fields = [
            ['name', /(?:员工姓名|职工姓名|姓名|员工|name)([\u3400-\u9fff·A-Za-z.]{2,20})/i],
            ['grossPayTotal', /(?:应发工资|应发合计|应发总额|工资总额|税前工资|gross)([¥￥]?[\d,，.()（）-]+)/i],
            ['deductionTotal', /(?:应扣工资|扣款合计|扣款总额|扣除合计|扣款|deduction)([¥￥]?[\d,，.()（）-]+)/i],
            ['netPay', /(?:实发工资|实发合计|实发金额|到手工资|净收入|netpay)([¥￥]?[\d,，.()（）-]+)/i],
            ['department', /(?:所属部门|部门|department)([\u3400-\u9fffA-Za-z0-9_-]{2,24})/i],
            ['position', /(?:岗位|职位|职务|position)([\u3400-\u9fffA-Za-z0-9_-]{2,24})/i]
        ];
        const record = { '月份': '', unmappedGrossKeys: [], unmappedDeductionKeys: [] };
        fields.forEach(([key, expression]) => {
            const match = findField(expression);
            if (match) record[key] = ['grossPayTotal', 'deductionTotal', 'netPay'].includes(key) ? parseMoney(match[1]) : match[1].trim();
        });
        const amountValue = /([¥￥]?[-−(（]?\d[\d,，]*(?:\.\d+)?[)）-]?)/;
        const separatedFields = [
            ['name', /(?:员工姓名|职工姓名|人员姓名|姓名|员工|name)/i, /^[\u3400-\u9fff·A-Za-z.]{2,20}/],
            ['grossPayTotal', /(?:应发工资|应发合计|应发总额|工资总额|税前工资|gross)/i, amountValue],
            ['deductionTotal', /(?:应扣工资|扣款合计|扣款总额|扣除合计|扣款|deduction)/i, amountValue],
            ['netPay', /(?:实发工资|实发合计|实发金额|到手工资|净收入|netpay)/i, amountValue],
            ['department', /(?:所属部门|部门|department)/i, /^[\u3400-\u9fffA-Za-z0-9_-]{2,24}/],
            ['position', /(?:岗位|职位|职务|position)/i, /^[\u3400-\u9fffA-Za-z0-9_-]{2,24}/]
        ];
        separatedFields.forEach(([key, label, valuePattern]) => {
            if (record[key] !== undefined) return;
            const value = findAdjacentValue(label, valuePattern);
            if (value) record[key] = ['grossPayTotal', 'deductionTotal', 'netPay'].includes(key) ? parseMoney(value) : value.trim();
        });
        const dateAtom = '(?:20\\d{2}\\s*[年./_-]\\s*(?:1[0-2]|0?[1-9])(?:(?:\\s*月\\s*|\\s*[/._-]\\s*)(?:0?[1-9]|[12]\\d|3[01])\\s*日?)?|(?:1[0-2]|0?[1-9])[/.-](?:0?[1-9]|[12]\\d|3[01])[/.-]20\\d{2})';
        const findAdjacentDate = (labelPattern) => {
            for (let index = 0; index < normalizedLines.length; index++) {
                const line = normalizedLines[index];
                const label = line.match(labelPattern);
                if (!label) continue;
                const inline = line.slice(label.index + label[0].length);
                const dates = [...inline.matchAll(new RegExp(dateAtom, 'gi'))];
                if (dates.length) return dates.at(-1)[0];
                const following = [...(normalizedLines[index + 1] || '').matchAll(new RegExp(dateAtom, 'gi'))];
                if (following.length) return following.at(-1)[0];
            }
            return '';
        };
        record['月份'] = monthValue(findAdjacentDate(/(?:工资所属月份|工资月份|所属月份|薪资月份|结算月份|payrollmonth|paymonth|工资期间)/i), true) || '';
        record.periodEnd = findAdjacentDate(/(?:计薪期间结束日期|工资期间结束日期|薪资期间结束日期|计薪结束日期|工资截止日期|期间结束|payperiodend|periodend)/i);
        record.periodStart = findAdjacentDate(/(?:计薪期间开始日期|工资期间开始日期|薪资期间开始日期|计薪开始日期|工资起始日期|期间开始|payperiodstart|periodstart)/i);
        record.payDate = findAdjacentDate(/(?:实际发薪日期|工资发放日期|发薪日期|发放日期|到账日期|支付日期|paydate|paymentdate|checkdate)/i);
        record['月份'] ||= monthValue(record.periodEnd) || monthValue(record.periodStart) || monthValue(record.payDate);
        if (!record['月份']) record['月份'] = monthValue(normalizedLines.join('')) || '';
        if (!record.name && normalizedLines.length) {
            const plausible = normalizedLines.find((line) => /^[\u3400-\u9fff]{2,5}$/.test(line) && !/(\u5de5\u8d44|\u660e\u7ec6|\u85aa\u916c|\u5408\u8ba1|\u516c\u53f8)/.test(line) && !isNonPersonName(line));
            if (plausible) record.name = plausible;
        }
        if (isNonPersonName(record.name)) record.name = '';
        if (!record.netPay && record.grossPayTotal !== undefined && record.deductionTotal !== undefined) record.netPay = record.grossPayTotal - record.deductionTotal;
        record.ocrText = text;
        return calculate(record);
    }

    async function enhanceImageForOcr(file) {
        if (typeof createImageBitmap !== 'function') return file;
        const bitmap = await createImageBitmap(file);
        try {
            if (bitmap.width >= 900 && bitmap.width <= 2800 && bitmap.height <= 2800) return file;
            const scale = bitmap.width < 900
                ? Math.min(1.8, 1500 / bitmap.width, 2800 / bitmap.height)
                : Math.min(1, 2800 / bitmap.width, 2800 / bitmap.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            return blob ? new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-enhanced.png`, { type: 'image/png' }) : file;
        } finally {
            bitmap.close();
        }
    }

    async function parseImage(file) {
        const worker = await getOcrWorker();
        setBusy(true, '增强工资单图像…');
        const preparedImage = await enhanceImageForOcr(file);
        const result = await worker.recognize(preparedImage);
        const record = parseOcrText(result.data.text);
        record.ocrConfidence = Math.round(result.data.confidence || 0);
        record.source = file.name;
        if (!record.name && !record.grossPayTotal && !record.netPay) throw new Error('图片已扫描，但没有识别到姓名或工资字段。请使用清晰、正向、光线均匀的工资单图片。');
        return [record];
    }

    function renderReview(records, sourceType) {
        state.drafts = records;
        byId('review-summary').textContent = `${records.length} 条待确认 · ${sourceType} · 保存前可修改识别内容`;
        const inputs = [
            ['name', '本人姓名', 'text', true], ['月份', '工资月份', 'month', true], ['employer', '任职单位（可选）', 'text', false], ['department', '部门（可选）', 'text', false],
            ['grossPayTotal', '应发合计', 'number', true], ['deductionTotal', '扣款合计', 'number', true], ['netPay', '实发工资', 'number', true]
        ];
        reviewRecords.innerHTML = records.map((record, index) => {
            const confidence = record.ocrConfidence === undefined ? '表格识别' : `OCR ${record.ocrConfidence}%`;
            const fields = inputs.map(([key, label, type, required]) => {
                const value = key === '月份' ? record[key] || '' : record[key] ?? '';
                return `<label class="review-field">${label}<input type="${type}" data-index="${index}" data-field="${key}" value="${escapeHtml(value)}" ${type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} ${required ? 'required' : ''}></label>`;
            }).join('');
            const lineItems = [...grossKeys, ...deductionKeys].filter((key) => parseMoney(record[key]) !== 0).map((key) => `${COLUMN_DEFINITIONS[key].displayName} ${money(record[key])}`);
            [...(record.unmappedGrossKeys || []), ...(record.unmappedDeductionKeys || [])].forEach((key) => {
                if (parseMoney(record[key]) !== 0) lineItems.push(`${record.customLabels?.[key] || key} ${money(record[key])}`);
            });
            const items = lineItems.length ? `<p class="recognized-items">识别项目：${escapeHtml(lineItems.join(' · '))}</p>` : '';
            return `<article class="review-card"><div class="review-card-head"><strong>${escapeHtml(record.name || `工资记录 ${index + 1}`)}</strong><span class="confidence-badge">${confidence}</span></div><div class="review-fields">${fields}</div>${items}${record.ocrText ? `<details class="ocr-source"><summary>查看原始识别文本</summary><pre>${escapeHtml(record.ocrText)}</pre></details>` : ''}</article>`;
        }).join('');
        feather.replace();
        reviewDialog.showModal();
    }

    async function recognizeSelection() {
        if (state.busy) return;
        const spreadsheets = [...fileInput.files];
        const image = imageInput.files?.[0];
        if (!spreadsheets.length && !image) {
            setStatus('请先选择 Excel 表格或工资单图片。', 'error');
            return;
        }
        setBusy(true, '准备本地识别…');
        fileNameDisplay.textContent = [...spreadsheets, ...(image ? [image] : [])].map((file) => file.name).join(' · ');
        try {
            const records = spreadsheets.length ? await parseExcel(spreadsheets) : await parseImage(image);
            setBusy(false);
            setStatus(`识别完成，发现 ${records.length} 条候选记录。请核对后保存。`, 'success');
            renderReview(records, spreadsheets.length ? 'Excel 表格' : '本地中文 OCR');
        } catch (error) {
            console.error('Payroll recognition failed', error);
            setBusy(false);
            const message = error.message || '\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u6216\u56fe\u7247\u3002';

            setStatus(message, 'error');

            showAppError(spreadsheets.length ? 'Excel 表格识别失败' : '图片识别失败', spreadsheets.length ? `${message} 请确认工作簿未损坏、包含姓名和工资字段后重试。` : `${message} 可重新选择图片重试。`);

        } finally {
            fileInput.value = '';
            imageInput.value = '';
        }
    }

    async function confirmImport() {
        const inputs = [...reviewRecords.querySelectorAll('[data-field]')];
        const drafts = state.drafts.map((record) => ({ ...record }));
        for (const input of inputs) {
            const { index, field } = input.dataset;
            if (!input.reportValidity()) return;
            drafts[index][field] = field === '月份' ? input.value : ['grossPayTotal', 'deductionTotal', 'netPay'].includes(field) ? parseMoney(input.value) : input.value.trim();
        }
        if (drafts.some((record) => isNonPersonName(record.name) || !/^\d{4}-\d{2}$/.test(record['\u6708\u4efd'] || ''))) {
            byId('review-summary').textContent = '请填写有效员工姓名和工资月份（YYYY-MM），再保存。';
            return;
        }
        try {
            for (const record of drafts) {
                for (const key of record.unmappedGrossKeys || []) await rememberPayItem(record.employer, record.customLabels?.[key] || key, 'grossPay');
                for (const key of record.unmappedDeductionKeys || []) await rememberPayItem(record.employer, record.customLabels?.[key] || key, 'deduction');
            }
            await saveRecords(drafts);
            reviewDialog.close();
            state.records = await readRecords();
            refresh();
            setStatus(`已保存 ${drafts.length} 条工资记录至本机。`, 'success');
        } catch (error) {
            byId('review-summary').textContent = `保存失败：${error.message}`;
            showAppError('识别结果没有保存', error.message || '请重试；识别内容仍可留在核对窗口中。');
        }
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            fileNameDisplay.textContent = [...fileInput.files].map((file) => file.name).join(' · ');
            imageInput.value = '';
            setStatus('Excel 已就绪，点击“开始识别”。');
        }
    });
    imageInput.addEventListener('change', () => {
        const file = imageInput.files?.[0];
        if (file) {
            fileNameDisplay.textContent = file.name;
            fileInput.value = '';
            setStatus('已选择图片，正在启动本地中文 OCR…');
            recognizeSelection();
        }
    });
    uploadButton.addEventListener('click', recognizeSelection);
    byId('confirm-import').addEventListener('click', (event) => { event.preventDefault(); confirmImport(); });
    byId('error-reload').addEventListener('click', () => location.reload());
    byId('error-dismiss').addEventListener('click', () => { byId('error-toast').hidden = true; });
    byId('manual-entry-button').addEventListener('click', () => {
        manualForm.reset();
        byId('manual-month').value = state.settings.month || currentMonth;
        byId('manual-item-rows').replaceChildren();
        addManualItemRow();
        updateManualTotals();
        manualDialog.showModal();
    });
    byId('add-manual-item').addEventListener('click', () => addManualItemRow());
    manualForm.addEventListener('submit', saveManualRecord);
    byId('settings-button').addEventListener('click', () => { renderPayItemCatalog(); settingsDialog.showModal(); });
    byId('theme-mode').addEventListener('change', async (event) => {
        state.theme = event.target.value;
        localStorage.setItem('rayroll-theme', state.theme);
        applyTheme();
        try { await saveStoreItem('settings', { key: 'theme', mode: state.theme }); }
        catch (error) { showAppError('主题设置没有保存', error.message || '请重试。'); }
    });
    byId('save-pay-item').addEventListener('click', async () => {
        const label = byId('pay-item-label').value.trim();
        if (!label) {
            showAppError('请填写工资项目名称', '例如：岗位津贴、夜班补助或个人保险。');
            return;
        }
        try {
            await rememberPayItem(byId('pay-item-employer').value.trim(), label, byId('pay-item-type').value);
            byId('pay-item-label').value = '';
            renderPayItemCatalog();
            byId('pay-item-status').textContent = '项目模板已添加，录入本人工资条时可直接选择。';
            byId('pay-item-status').classList.add('success');
        } catch (error) {
            byId('pay-item-status').textContent = `项目模板没有保存：${error.message || '请重试。'}`;
            byId('pay-item-status').classList.remove('success');
            showAppError('项目模板没有保存', error.message || '请重试。');
        }
    });
    byId('pay-item-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete-pay-item]');
        if (!button) return;
        try {
            await deleteStoreItem('payItems', button.dataset.deletePayItem);
            state.payItems = state.payItems.filter((item) => item.id !== button.dataset.deletePayItem);
            refresh();
        } catch (error) {
            showAppError('项目模板没有移除', error.message || '请重试。');
        }
    });
    byId('budget-employee').addEventListener('change', async (event) => {
        state.settings.employee = event.target.value;
        try { await saveBudgetSettings(); refresh(); }
        catch (error) { showAppError('档案选择没有保存', error.message || '请重试。'); }
    });
    byId('insight-employee').addEventListener('change', async (event) => {
        state.settings.employee = event.target.value;
        try { await saveBudgetSettings(); refresh(); } catch (error) { showAppError('档案选择没有保存', error.message || '请重试。'); }
    });
    byId('record-employee').addEventListener('change', async (event) => {
        state.settings.employee = event.target.value;
        try { await saveBudgetSettings(); refresh(); } catch (error) { showAppError('档案选择没有保存', error.message || '请重试。'); }
    });
    byId('budget-month').addEventListener('change', async (event) => {
        state.settings.month = event.target.value;
        const today = new Date();
        const todayMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        byId('expense-date').value = event.target.value === todayMonth ? `${todayMonth}-${String(today.getDate()).padStart(2, '0')}` : `${event.target.value}-01`;
        try { await saveBudgetSettings(); refresh(); }
        catch (error) { showAppError('月份选择没有保存', error.message || '请重试。'); }
    });
    byId('home-month').addEventListener('change', async (event) => {
        state.settings.month = event.target.value;
        const today = new Date();
        const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        byId('expense-date').value = state.settings.month === thisMonth ? `${thisMonth}-${String(today.getDate()).padStart(2, '0')}` : `${state.settings.month}-01`;
        try { await saveBudgetSettings(); refresh(); }
        catch (error) { showAppError('月份选择没有保存', error.message || '请重试。'); }
    });
    const shiftBudgetMonth = async (delta) => {
        const [year, month] = (state.settings.month || currentMonth).split('-').map(Number);
        const next = new Date(year, month - 1 + delta, 1);
        state.settings.month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
        const today = new Date();
        const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        byId('expense-date').value = state.settings.month === thisMonth ? `${thisMonth}-${String(today.getDate()).padStart(2, '0')}` : `${state.settings.month}-01`;
        await saveBudgetSettings();
        refresh();
    };
    byId('budget-month-prev').addEventListener('click', () => shiftBudgetMonth(-1).catch((error) => showAppError('月份切换失败', error.message || '请重试。')));
    byId('budget-month-next').addEventListener('click', () => shiftBudgetMonth(1).catch((error) => showAppError('月份切换失败', error.message || '请重试。')));
    const today = new Date();
    byId('expense-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    byId('expense-form').addEventListener('submit', saveExpense);
    byId('expense-quick-categories').addEventListener('click', (event) => {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        byId('expense-category').value = button.dataset.category;
        byId('expense-quick-categories').querySelectorAll('[data-category]').forEach((item) => {
            const selected = item === button;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-pressed', String(selected));
        });
        byId('expense-amount').focus();
    });
    byId('expense-category').addEventListener('input', (event) => {
        byId('expense-quick-categories').querySelectorAll('[data-category]').forEach((item) => {
            const selected = item.dataset.category === event.target.value;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-pressed', String(selected));
        });
    });
    byId('expense-list').addEventListener('click', async (event) => {
        const editButton = event.target.closest('[data-edit-expense]');
        if (editButton) {
            const expense = state.expenses.find((item) => item.id === editButton.dataset.editExpense);
            if (!expense) return;
            byId('expense-edit-id').value = expense.id;
            byId('expense-date').value = expense.date;
            byId('expense-category').value = expense.category;
            byId('expense-amount').value = expense.amount;
            byId('expense-note').value = expense.note || '';
            byId('expense-submit-label').textContent = '保存修改';
            byId('expense-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
            byId('expense-amount').focus({ preventScroll: true });
            return;
        }
        const button = event.target.closest('[data-delete-expense]');
        if (!button) return;
        try {
            await deleteStoreItem('expenses', button.dataset.deleteExpense);
            state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.deleteExpense);
            if (byId('expense-edit-id').value === button.dataset.deleteExpense) { byId('expense-form').reset(); byId('expense-edit-id').value = ''; byId('expense-submit-label').textContent = '保存花销'; }
            refresh();
        } catch (error) {
            showAppError('花销没有删除', error.message || '请重试。');
        }
    });
    byId('clear-data-button').addEventListener('click', async () => {
        if (!confirm('确定清除本机保存的工资、花销、预算和工资项目模板吗？此操作不可恢复。')) return;
        try {
            await clearAllLocalData();
        } catch (error) {
            showAppError('数据没有清除', error.message || '请重试。');
            return;
        }
        state.records = [];
        state.expenses = [];
        state.payItems = [];
        state.settings = { employee: '', month: currentMonth };
        settingsDialog.close();
        state.page = 1;
        refresh();
        setStatus('本机工资、花销及项目模板已清除。', 'success');
    });

    document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
        document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${button.dataset.tab}-view`));
        if (button.dataset.tab === 'insights') requestAnimationFrame(() => chart?.resize());
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    byId('quick-expense-button').addEventListener('click', () => {
        document.querySelector('[data-tab="budget"]').click();
        window.setTimeout(() => {
            byId('expense-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
            byId('expense-amount').focus({ preventScroll: true });
        }, 220);
    });
    document.querySelectorAll('[data-goto]').forEach((button) => button.addEventListener('click', () => document.querySelector(`[data-tab="${button.dataset.goto}"]`).click()));
    byId('recent-records').addEventListener('click', (event) => { if (event.target.closest('[data-open-records]')) document.querySelector('[data-tab="records"]').click(); });
    viewModeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-view]');
        if (!button) return;
        state.view = button.dataset.view;
        state.filter = '';
        state.page = 1;
        updateFilterControls();
        renderCharts();
    });
    yearSelect.addEventListener('change', () => { state.filter = yearSelect.value; renderCharts(); });
    monthSelect.addEventListener('change', () => { state.filter = monthSelect.value; renderCharts(); });
    chartTypeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-chart]');
        if (!button) return;
        state.chart = button.dataset.chart;
        chartTypeGroup.querySelectorAll('[data-chart]').forEach((item) => item.classList.toggle('active', item === button));
        renderCharts();
        feather.replace();
    });
    searchInput.addEventListener('input', () => { state.search = searchInput.value; state.page = 1; updateRecordProfile(); });
    window.addEventListener('resize', () => chart?.resize());

    loadRecords();
});
