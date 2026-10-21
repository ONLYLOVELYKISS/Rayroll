const targetUrl = process.env.RAYROLL_URL || 'http://127.0.0.1:3000/';
const endpoint = process.env.RAYROLL_CDP || 'http://127.0.0.1:9222/json';
const prefix = '__RAYROLL_UI_REDESIGN_TEST__';
let socket;

async function main() {
    const pages = await (await fetch(endpoint)).json();
    const page = pages.find((item) => item.type === 'page' && item.url === targetUrl);
    if (!page) throw new Error(`Open ${targetUrl} in Edge with remote debugging enabled.`);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 12000 });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        const value = result.result?.value;
        if (typeof value !== 'string') return value;
        try { return JSON.parse(value); } catch { return value; }
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1050, deviceScaleFactor: 1, mobile: true });
    await send('Page.reload', { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const snapshot = await evaluate(`(async()=>{const r=indexedDB.open('rayroll',2);const db=await new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)});const settings=await new Promise((a,b)=>{const q=db.transaction('settings').objectStore('settings').getAll();q.onsuccess=()=>a(q.result.filter(x=>['budget','theme'].includes(x.key)));q.onerror=()=>b(q.error)});db.close();return JSON.stringify({settings,localTheme:localStorage.getItem('rayroll-theme')})})()`);
    const report = { themeModes: [], profileIsolation: false, incomeStatistics: false, missingMonthComparison: false, salaryDetails: false, expenseMonthBoundary: false, monthNavigation: false, viewport: null };
    let fixtureInstalled = false;
    try {
        await evaluate(`(async()=>{const names=['records','expenses','settings'];const r=indexedDB.open('rayroll',2);const db=await new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)});const tx=db.transaction(names,'readwrite');const records=tx.objectStore('records');const expenses=tx.objectStore('expenses');const settings=tx.objectStore('settings');const ids=['${prefix}A-2025-01','${prefix}A-2025-03','${prefix}B-2025-03'];const collision=await Promise.all(ids.map(id=>new Promise(resolve=>{const q=records.get(id);q.onsuccess=()=>resolve(!!q.result);q.onerror=()=>resolve(true)})));if(collision.some(Boolean)){db.close();throw Error('Test fixture key already exists; abort to preserve it.')}const base={updatedAt:1,unmappedGrossKeys:[],unmappedDeductionKeys:[],employer:'测试单位',department:'测试部门'};records.put({...base,recordId:ids[0],name:'${prefix}甲','月份':'2025-01',grossPayTotal:5000,deductionTotal:1000,netPay:4000});records.put({...base,recordId:ids[1],name:'${prefix}甲','月份':'2025-03',grossPayTotal:6000,deductionTotal:1500,netPay:4300});records.put({...base,recordId:ids[2],name:'${prefix}乙','月份':'2025-03',grossPayTotal:100000,deductionTotal:10000,netPay:90000});expenses.put({id:'${prefix}expense-march',employee:'${prefix}甲',date:'2025-03-15',month:'2025-03',category:'测试餐饮',amount:12.5,note:'测试',createdAt:2});expenses.put({id:'${prefix}expense-february',employee:'${prefix}甲',date:'2025-02-28',month:'2025-02',category:'测试交通',amount:88,note:'测试',createdAt:1});settings.put({key:'budget',employee:'${prefix}甲',month:'2025-03'});await new Promise((a,b)=>{tx.oncomplete=a;tx.onerror=()=>b(tx.error);tx.onabort=()=>b(tx.error)});db.close();return 'ok'})()`);
        fixtureInstalled = true;
        await send('Page.reload', { ignoreCache: true });
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const themeModes = [];
        for (const [mode, expected] of [['dark', 'dark'], ['light', 'light']]) {
            await evaluate(`(()=>{const s=document.querySelector('#theme-mode');s.value='${mode}';s.dispatchEvent(new Event('change',{bubbles:true}));return 'ok'})()`);
            await new Promise((resolve) => setTimeout(resolve, 80));
            themeModes.push(await evaluate(`JSON.stringify({mode:document.documentElement.dataset.themeMode,resolved:document.documentElement.dataset.theme,bg:getComputedStyle(document.body).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme})`));
            if (themeModes.at(-1).mode !== mode || themeModes.at(-1).resolved !== expected) throw new Error(`Theme mode failed: ${mode}`);
        }
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
        await evaluate(`(()=>{const s=document.querySelector('#theme-mode');s.value='system';s.dispatchEvent(new Event('change',{bubbles:true}));return 'ok'})()`);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const followsDark = await evaluate(`JSON.stringify({mode:document.documentElement.dataset.themeMode,resolved:document.documentElement.dataset.theme})`);
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        await new Promise((resolve) => setTimeout(resolve, 80));
        const followsLight = await evaluate(`JSON.stringify({mode:document.documentElement.dataset.themeMode,resolved:document.documentElement.dataset.theme})`);
        if (followsDark.resolved !== 'dark' || followsLight.resolved !== 'light') throw new Error('System theme did not follow live media changes.');
        report.themeModes = [...themeModes, followsDark, followsLight];
        await send('Emulation.setEmulatedMedia', { features: [] });

        const selectProfile = async (id, name) => evaluate(`(async()=>{const s=document.querySelector('#${id}');s.value='${name}';s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));return 'ok'})()`);
        await selectProfile('insight-employee', `${prefix}甲`);
        const income = await evaluate(`JSON.stringify({gross:document.querySelector('#insight-gross').textContent,net:document.querySelector('#insight-net').textContent,deduction:document.querySelector('#insight-deduction').textContent,average:document.querySelector('#insight-average').textContent,median:document.querySelector('#insight-median').textContent,change:document.querySelector('#insight-change').textContent})`);
        report.incomeStatistics = income.gross.includes('11,000') && income.net.includes('8,300') && income.deduction.includes('2,500') && income.average.includes('4,150') && income.median.includes('4,150');
        report.missingMonthComparison = income.change.includes('缺少');
        await selectProfile('insight-employee', `${prefix}乙`);
        const isolated = await evaluate(`JSON.stringify({gross:document.querySelector('#insight-gross').textContent,net:document.querySelector('#insight-net').textContent})`);
        report.profileIsolation = isolated.gross.includes('100,000') && isolated.net.includes('90,000') && !isolated.net.includes('8,300');
        await selectProfile('record-employee', `${prefix}甲`);
        await evaluate(`(()=>{document.querySelector('[data-tab="records"]').click();return 'ok'})()`);
        const salary = await evaluate(`JSON.stringify({cards:document.querySelectorAll('.salary-month-card').length,closed:[...document.querySelectorAll('.salary-detail')].every(x=>!x.open),warning:!!document.querySelector('.record-check.warning')})`);
        report.salaryDetails = salary.cards === 2 && salary.closed && salary.warning;
        await selectProfile('budget-employee', `${prefix}甲`);
        const expense = await evaluate(`JSON.stringify({spent:document.querySelector('#budget-spent').textContent,categories:[...document.querySelectorAll('.expense-category-row')].map(x=>x.textContent),daily:document.querySelector('#expense-daily-average').textContent})`);
        report.expenseMonthBoundary = expense.spent.includes('12.50') && !expense.spent.includes('100.50') && expense.categories.length === 1;
        await evaluate(`(()=>{document.querySelector('#budget-month-prev').click();return 'ok'})()`);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const previous = await evaluate(`JSON.stringify({month:document.querySelector('#budget-month').value,date:document.querySelector('#expense-date').value,spent:document.querySelector('#budget-spent').textContent})`);
        report.monthNavigation = previous.month === '2025-02' && previous.date.startsWith('2025-02-') && previous.spent.includes('88.00');
        report.viewport = await evaluate(`JSON.stringify({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,logo:!!document.querySelector('.brand-mark img')})`);
        if (!report.incomeStatistics || !report.missingMonthComparison || !report.profileIsolation || !report.salaryDetails || !report.expenseMonthBoundary || !report.monthNavigation || report.viewport.width !== 480 || report.viewport.scrollWidth > 480 || !report.viewport.logo) throw new Error(`Redesign regression failed: ${JSON.stringify(report)}`);
    } finally {
        if (fixtureInstalled) {
            await evaluate(`(async()=>{const r=indexedDB.open('rayroll',2);const db=await new Promise((a,b)=>{r.onsuccess=()=>a(r.result);r.onerror=()=>b(r.error)});const tx=db.transaction(['records','expenses','settings'],'readwrite');const records=tx.objectStore('records');['${prefix}A-2025-01','${prefix}A-2025-03','${prefix}B-2025-03'].forEach(id=>records.delete(id));const expenses=tx.objectStore('expenses');expenses.delete('${prefix}expense-march');expenses.delete('${prefix}expense-february');const settings=tx.objectStore('settings');${snapshot.settings.find((item) => item.key === 'budget') ? `settings.put(${JSON.stringify(snapshot.settings.find((item) => item.key === 'budget'))})` : `settings.delete('budget')`};${snapshot.settings.find((item) => item.key === 'theme') ? `settings.put(${JSON.stringify(snapshot.settings.find((item) => item.key === 'theme'))})` : `settings.delete('theme')`};await new Promise((a,b)=>{tx.oncomplete=a;tx.onerror=()=>b(tx.error);tx.onabort=()=>b(tx.error)});db.close();${snapshot.localTheme === null ? `localStorage.removeItem('rayroll-theme')` : `localStorage.setItem('rayroll-theme',${JSON.stringify(snapshot.localTheme)})`};return 'cleaned'})()`);
            await send('Page.reload', { ignoreCache: true });
        }
    }
    console.log(JSON.stringify(report, null, 2));
    socket.close();
}

main().catch((error) => { console.error(error.stack || error.message); socket?.close(); process.exitCode = 1; });
