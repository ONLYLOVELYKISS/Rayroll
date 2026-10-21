const http = require('node:http');
const nodeXlsx = require('xlsx');

const targetUrl = process.env.RAYROLL_URL || 'http://127.0.0.1:3000/';
const endpoint = process.env.RAYROLL_CDP || 'http://127.0.0.1:9222/json';
let activeSocket;

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        }).on('error', reject);
    });
}

function decodeEvaluation(result) {
    const value = result?.result?.value;
    return typeof value === 'string' ? JSON.parse(value) : value;
}

function makeRedactedWorkbook(filePath) {
    const workbook = nodeXlsx.readFile(filePath, { cellDates: true, cellStyles: true });
    const safeNames = [];
    const expectedMonths = [];
    let expectedRecords = 0;
    const setCell = (sheet, rowIndex, columnIndex, value) => {
        const address = nodeXlsx.utils.encode_cell({ r: rowIndex, c: columnIndex });
        const cell = sheet[address] || {};
        delete cell.f;
        delete cell.l;
        delete cell.c;
        cell.v = value;
        cell.t = typeof value === 'number' ? 'n' : 's';
        sheet[address] = cell;
    };
    workbook.SheetNames.forEach((originalName, sheetIndex) => {
        const sheet = workbook.Sheets[originalName];
        const rows = nodeXlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const headerIndex = rows.findIndex((row) => row.some((value) => String(value).trim() === '姓名') && row.some((value) => String(value).includes('实发工资')));
        const monthMatch = originalName.match(/(20\d{2})年\s*(\d{1,2})月/);
        const month = monthMatch ? `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}` : '';
        const safeName = `工资表${sheetIndex + 1}${monthMatch ? `-${monthMatch[1]}年${monthMatch[2].padStart(2, '0')}月` : ''}`;
        safeNames.push(safeName);
        if (month) expectedMonths.push(month);

        const range = nodeXlsx.utils.decode_range(sheet['!ref'] || 'A1');
        for (let rowIndex = 0; rowIndex <= range.e.r; rowIndex++) {
            const row = rows[rowIndex] || [];
            if (rowIndex === headerIndex) continue; // Payroll column labels are retained for format testing.
            for (let columnIndex = 0; columnIndex <= range.e.c; columnIndex++) setCell(sheet, rowIndex, columnIndex, '');
            // Leave the worksheet's month only in its sanitized tab name. This
            // catches regressions where the file name incorrectly wins fallback.
            if (rowIndex === 0) setCell(sheet, rowIndex, 0, '脱敏工资表样式');

            const hasNumbers = row.some((value) => typeof value === 'number' || value instanceof Date);
            if (headerIndex >= 0 && rowIndex > headerIndex && hasNumbers) {
                const values = Array(32).fill(0);
                values[0] = '测试员工甲';
                values[1] = 'G5';
                values[2] = 1;
                values[3] = 7000;
                values[4] = 1200;
                values[6] = 300;
                values[7] = 500;
                values[21] = 9000;
                values[22] = 300;
                values[23] = 100;
                values[24] = 500;
                values[25] = 200;
                values[26] = 50;
                values[27] = 50;
                values[28] = 500;
                values[29] = 100;
                values[30] = 200;
                values[31] = 7000;
                values.forEach((value, columnIndex) => setCell(sheet, rowIndex, columnIndex, value));
                expectedRecords++;
            } else if (headerIndex >= 0 && rowIndex > headerIndex && row.some((value) => typeof value === 'string' && value.trim())) {
                setCell(sheet, rowIndex, 0, '说明：脱敏测试说明项');
            }
        }
        workbook.Sheets[safeName] = sheet;
        delete workbook.Sheets[originalName];
        if (workbook.Workbook?.Sheets?.[sheetIndex]) workbook.Workbook.Sheets[sheetIndex].name = safeName;
    });
    workbook.SheetNames = safeNames;
    workbook.Props = { Title: '脱敏工资条测试', Subject: '', Author: '', Creator: '', LastAuthor: '', Company: '', Manager: '', Keywords: '', Comments: '' };
    workbook.Custprops = {};
    if (workbook.Workbook) workbook.Workbook.Names = [];
    delete workbook.vbaraw;
    const base64 = nodeXlsx.write(workbook, { type: 'base64', bookType: 'xlsx' });
    return { base64, expectedRecords, expectedMonths, sheetCount: safeNames.length };
}

async function main() {
    const stage = (name) => { if (process.env.RAYROLL_TEST_VERBOSE) console.error(`UI check: ${name}`); };
    stage('connect');
    const pages = await fetchJson(endpoint);
    const page = pages.find((item) => item.type === 'page' && item.url === targetUrl);
    if (!page) throw new Error(`Open ${targetUrl} in Edge with remote debugging enabled first.`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    activeSocket = socket;
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    const errors = [];
    let nextId = 1;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            errors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '));
        }
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            message.error ? reject(new Error(message.error.message)) : resolve(message.result);
        }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1050, deviceScaleFactor: 1, mobile: true });
    await send('Page.reload', { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    stage('page loaded');
    errors.length = 0;
    const result = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
            title: document.title,
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            activeView: document.querySelector('.view.active')?.id,
            icons: document.querySelectorAll('svg.feather').length,
            featherLoaded: typeof window.feather,
            ocrLoaded: typeof window.Tesseract,
            localAssets: [...document.scripts].filter(s => s.src).map(s => ({ name: s.src.split('/').pop(), loaded: s.dataset.testLoaded || 'requested' })),
            recordSummary: document.querySelector('#hero-records')?.textContent,
            status: document.querySelector('#status-message')?.textContent
        })`,
        returnByValue: true
    });
    const report = decodeEvaluation(result);
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: true });
    const narrowResult = await send('Runtime.evaluate', { expression: 'JSON.stringify({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth })', returnByValue: true });
    report.narrowViewport = decodeEvaluation(narrowResult);
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 1050, deviceScaleFactor: 1, mobile: true });
    const originalThemeResult = await send('Runtime.evaluate', { expression: "document.querySelector('#theme-mode').value", returnByValue: true });
    const originalTheme = originalThemeResult.result?.value || 'system';
    report.themeFixture = { modes: [] };
    for (const mode of ['dark', 'light', 'system']) {
        const modeResult = await send('Runtime.evaluate', { expression: `(() => { const select = document.querySelector('#theme-mode'); select.value = '${mode}'; select.dispatchEvent(new Event('change', { bubbles: true })); return JSON.stringify({ mode: document.documentElement.dataset.themeMode, resolved: document.documentElement.dataset.theme, scheme: getComputedStyle(document.documentElement).colorScheme }); })()`, returnByValue: true });
        report.themeFixture.modes.push(decodeEvaluation(modeResult));
    }
    report.themeFixture.original = originalTheme;
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const systemDark = await send('Runtime.evaluate', { expression: "JSON.stringify({mode:document.documentElement.dataset.themeMode,resolved:document.documentElement.dataset.theme})", returnByValue: true });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const systemLight = await send('Runtime.evaluate', { expression: "JSON.stringify({mode:document.documentElement.dataset.themeMode,resolved:document.documentElement.dataset.theme})", returnByValue: true });
    report.themeFixture.systemDark = decodeEvaluation(systemDark);
    report.themeFixture.systemLight = decodeEvaluation(systemLight);
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Runtime.evaluate', { expression: `(() => { const select = document.querySelector('#theme-mode'); select.value = '${report.themeFixture.original}'; select.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`, returnByValue: true });
    if (report.ocrLoaded === 'object' && process.env.RAYROLL_SKIP_OCR !== '1') {
        stage('OCR fixture');
        const ocrResult = await send('Runtime.evaluate', {
            expression: `(async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1200; canvas.height = 1400;
                const context = canvas.getContext('2d');
                context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = '#111'; context.font = '58px Microsoft YaHei, sans-serif';
                ['工资单', '姓名', '张三', '工资期间', '2026/08/26-2026/09/25', '发薪日期', '2026/10/05', '应发工资', '12000.00', '扣款合计', '1500.00', '实发工资', '10500.00'].forEach((line, index) => context.fillText(line, 48, 100 + index * 105));
                const image = await new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], 'rayroll-ocr-fixture.png', { type: 'image/png' }))));
                const files = new DataTransfer(); files.items.add(image);
                Object.defineProperty(document.querySelector('#image-input'), 'files', { configurable: true, value: files.files });
                document.querySelector('#image-input').dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('#upload-button').click();
                for (let attempt = 0; attempt < 600 && !document.querySelector('#review-dialog').open; attempt++) await new Promise((resolve) => setTimeout(resolve, 200));
                const dialog = document.querySelector('#review-dialog');
                const values = [...dialog.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input.value]);
                const rawText = dialog.querySelector('.ocr-source pre')?.textContent || '';
                const confidence = dialog.querySelector('.confidence-badge')?.textContent;
                if (dialog.open) dialog.close();
                return JSON.stringify({ confidence, values, rawText, status: document.querySelector('#status-message').textContent, foundReview: !!values.length });
            })()`,
            awaitPromise: true,
            returnByValue: true,
            timeout: 120000
        });
        if (!ocrResult.result?.value) {
            socket.close();
            throw new Error(`Local OCR worker failed: ${JSON.stringify(ocrResult)}`);
        }
        report.ocrFixture = decodeEvaluation(ocrResult);
    }
    stage('starting Excel fixture');
    const excelResult = await send('Runtime.evaluate', {
        expression: `(async () => {
            const workbook = XLSX.utils.book_new();
            const sheet = XLSX.utils.aoa_to_sheet([
                ['个人工资明细 工资月份：2026年05月 发薪日期：2026/06/05'],
                ['员工姓名', '工资月份', '应发工资', '扣款合计', '实发工资'],
                ['李四', '2026-05', '¥12,000.00', '(1,500.00)', '10,500.00'],
                ['说明栏', '本表金额仅供核对', '', '', ''],
                ['备注：仅供核对', '这不是工资记录', '', '', ''],
                [],
                ['工资月份：2026年06月'],
                ['员工姓名', '工资月份', '应发工资', '扣款合计', '实发工资'],
                ['王五', '2026-06', '¥13,000.00', '(1,600.00)', '11,400.00']
            ]);
            const periods = XLSX.utils.aoa_to_sheet([
                ['职工姓名', '计薪期间开始日期', '计薪期间结束日期', '基本工资', '个税', '实发金额'],
                ['赵六', '2026/05/26', '2026/06/25', 9000, 500, 8500]
            ]);
            const payDate = XLSX.utils.aoa_to_sheet([
                ['人员姓名', '实际发薪日期', '实发工资'],
                ['孙八', '7/02/2026', 7000],
                [],
                ['员工姓名', '工资期间', '实发工资'],
                ['周九', '2026/05/26-2026/06/25', 6600]
            ]);
            XLSX.utils.book_append_sheet(workbook, sheet, '按月工资表');
            XLSX.utils.book_append_sheet(workbook, periods, '计薪期间');
            XLSX.utils.book_append_sheet(workbook, payDate, '发薪日期');
            const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            const file = new File([bytes], 'payroll-2026-09.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const files = new DataTransfer(); files.items.add(file);
            Object.defineProperty(document.querySelector('#file-input'), 'files', { configurable: true, value: files.files });
            document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('#upload-button').click();
            for (let attempt = 0; attempt < 100 && !document.querySelector('#review-dialog').open; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
            const dialog = document.querySelector('#review-dialog');
            const records = [...dialog.querySelectorAll('.review-card')].map((card) => Object.fromEntries([...card.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input.value])));
            const values = records.flatMap((record) => Object.entries(record));
            const summary = document.querySelector('#review-summary').textContent;
            if (dialog.open) dialog.close();
            return JSON.stringify({ values, records, summary, foundReview: records.length > 0 });
        })()`,
        awaitPromise: true,
        returnByValue: true,
        timeout: 15000
    });
    stage('Excel fixture');
    if (excelResult.result?.value) report.excelFixture = decodeEvaluation(excelResult);
    let redactedExpectation = null;
    if (process.env.RAYROLL_SOURCE_WORKBOOK) {
        stage('redacted workbook');
        redactedExpectation = makeRedactedWorkbook(process.env.RAYROLL_SOURCE_WORKBOOK);
        const redactedResult = await send('Runtime.evaluate', {
            expression: `(async () => {
                const binary = atob('${redactedExpectation.base64}');
                const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
                const file = new File([bytes], '工资条-2026年05月-脱敏测试.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const files = new DataTransfer(); files.items.add(file);
                Object.defineProperty(document.querySelector('#file-input'), 'files', { configurable: true, value: files.files });
                document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true }));
                document.querySelector('#upload-button').click();
                for (let attempt = 0; attempt < 100 && !document.querySelector('#review-dialog').open; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
                const dialog = document.querySelector('#review-dialog');
                const records = [...dialog.querySelectorAll('.review-card')].map((card) => Object.fromEntries([...card.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input.value])));
                const summary = document.querySelector('#review-summary').textContent;
                if (dialog.open) dialog.close();
                return JSON.stringify({ records, summary, foundReview: records.length > 0 });
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        if (redactedResult.result?.value) report.redactedWorkbook = decodeEvaluation(redactedResult);
        report.redactedWorkbook.sheetCount = redactedExpectation.sheetCount;
        report.redactedWorkbook.expectedMonths = redactedExpectation.expectedMonths;
        report.redactedWorkbook.expectedRecords = redactedExpectation.expectedRecords;
    }
    if (process.env.RAYROLL_SKIP_ERROR !== '1') {
    stage('starting error recovery fixture');
    const errorResult = await send('Runtime.evaluate', {
        expression: `(async () => {
            const file = new File([new Uint8Array([1, 2, 3])], 'invalid-payroll.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const files = new DataTransfer(); files.items.add(file);
            Object.defineProperty(document.querySelector('#file-input'), 'files', { configurable: true, value: files.files });
            document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true }));
            document.querySelector('#upload-button').click();
            for (let attempt = 0; attempt < 50 && document.querySelector('#error-toast').hidden; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
            const result = { visible: !document.querySelector('#error-toast').hidden, title: document.querySelector('#error-title').textContent, detail: document.querySelector('#error-detail').textContent, uploadEnabled: !document.querySelector('#upload-button').disabled };
            document.querySelector('#error-dismiss').click();
            return JSON.stringify(result);
        })()`,
        awaitPromise: true,
        returnByValue: true
    });
    stage('error recovery fixture');
    if (errorResult.result?.value) report.errorFixture = decodeEvaluation(errorResult);
    }
    errors.length = 0; // The parser error above is expected and its recovery UI is asserted below.
    console.log(JSON.stringify({ report, runtimeErrors: errors }, null, 2));
    socket.close();
    const recognizedFields = Object.fromEntries(report.ocrFixture?.values || []);
    const excelRecords = report.excelFixture?.records || [];
    const byName = Object.fromEntries(excelRecords.map((record) => [record.name, record]));
    const redactedRecords = report.redactedWorkbook?.records || [];
    const redactedMonths = redactedRecords.map((record) => record['月份']).sort();
    const expectedRedactedMonths = [...(redactedExpectation?.expectedMonths || [])].sort();
    const redactedValid = !redactedExpectation || (
        redactedRecords.length === redactedExpectation.expectedRecords &&
        redactedRecords.every((record) => record.name === '测试员工甲' && Number(record.grossPayTotal) === 9000 && Number(record.deductionTotal) === 2000 && Number(record.netPay) === 7000) &&
        JSON.stringify(redactedMonths) === JSON.stringify(expectedRedactedMonths) &&
        expectedRedactedMonths.includes('2025-10')
    );
    const ocrInvalid = process.env.RAYROLL_SKIP_OCR !== '1' && (!report.ocrFixture?.foundReview || recognizedFields.name !== '张三' || recognizedFields['月份'] !== '2026-09' || Number(recognizedFields.grossPayTotal) !== 12000 || Number(recognizedFields.deductionTotal) !== 1500 || Number(recognizedFields.netPay) !== 10500);
    const errorInvalid = process.env.RAYROLL_SKIP_ERROR !== '1' && (!report.errorFixture?.visible || !report.errorFixture?.uploadEnabled || report.errorFixture.title !== 'Excel 表格识别失败' || !report.errorFixture.detail);
    const themeInvalid = !report.themeFixture || !report.themeFixture.modes.every((item, index) => item.mode === ['dark', 'light', 'system'][index] && item.resolved === ['dark', 'light', (item.resolved === 'dark' ? 'dark' : 'light')][index]) || report.themeFixture.systemDark.resolved !== 'dark' || report.themeFixture.systemLight.resolved !== 'light';
    if (report.title !== '薪澈 · 本地工资分析' || report.scrollWidth > report.width || report.narrowViewport.width !== 320 || report.narrowViewport.scrollWidth > 320 || !report.featherLoaded || !report.ocrLoaded || !report.icons || errors.length || ocrInvalid || !report.excelFixture?.foundReview || excelRecords.length !== 5 || !byName['李四'] || byName['李四']['月份'] !== '2026-05' || !byName['王五'] || byName['王五']['月份'] !== '2026-06' || !byName['赵六'] || byName['赵六']['月份'] !== '2026-06' || !byName['孙八'] || byName['孙八']['月份'] !== '2026-07' || !byName['周九'] || byName['周九']['月份'] !== '2026-06' || excelRecords.some((record) => ['说明栏', '备注：仅供核对', '本表金额仅供核对'].includes(record.name)) || !redactedValid || errorInvalid || themeInvalid) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error.message); activeSocket?.close(); process.exitCode = 1; });
