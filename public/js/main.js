// public/js/main.js (Chart Content & Title Enhancement)

document.addEventListener('DOMContentLoaded', () => {
    // ... [大部分辅助函数和配置加载保持不变，此处省略] ...
    if (typeof COLUMN_DEFINITIONS === 'undefined') { alert('严重错误：核心配置文件 config.js 加载失败！请检查文件路径。'); return; }
    const getKeysByType = (type) => Object.keys(COLUMN_DEFINITIONS).filter(key => COLUMN_DEFINITIONS[key].type === type);
    const GROSS_PAY_KEYS = getKeysByType('grossPay');
    const DEDUCTION_KEYS = getKeysByType('deduction');
    const aliasReverseMap = new Map();
    for (const standardKey in COLUMN_DEFINITIONS) { for (const alias of COLUMN_DEFINITIONS[standardKey].aliases) { aliasReverseMap.set(normalizeText(alias), standardKey); } }
    function normalizeText(text) { return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')'); }
    function levenshtein(a, b) { const an = a ? a.length : 0; const bn = b ? b.length : 0; if (an === 0) return bn; if (bn === 0) return an; const matrix = Array(an + 1); for (let i = 0; i <= an; i++) { matrix[i] = Array(bn + 1); matrix[i][0] = i; } for (let j = 0; j <= bn; j++) { matrix[0][j] = j; } for (let i = 1; i <= an; i++) { for (let j = 1; j <= bn; j++) { const cost = a[i - 1] === b[j - 1] ? 0 : 1; matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost); }} return matrix[an][bn]; }
    function isMatch(headerText, alias) { const normalizedHeader = normalizeText(headerText); const normalizedAlias = normalizeText(alias); if (normalizedHeader === normalizedAlias) return true; let threshold = 0; if (normalizedAlias.length >= 5) threshold = 2; else if (normalizedAlias.length >= 3) threshold = 1; if (threshold > 0 && levenshtein(normalizedHeader, normalizedAlias) <= threshold) return true; return false; }
    function findHeaderRow(sheetData, startRow = 0) { let bestMatch = { score: 0, rowIndex: -1, header: [] }; const maxRowsToScan = Math.min(sheetData.length, startRow + 15); for (let i = startRow; i < maxRowsToScan; i++) { const row = sheetData[i]; let score = 0; if (!Array.isArray(row) || row.length < 3) continue; for (const cell of row) { for (const key in COLUMN_DEFINITIONS) { let foundMatch = false; for (const alias of COLUMN_DEFINITIONS[key].aliases) { if (isMatch(cell, alias)) { score++; foundMatch = true; break; } } if(foundMatch) break; } } if (score > bestMatch.score && score >= 3) { bestMatch = { score, rowIndex: i, header: row.map(h => String(h || '').trim()) }; } } return bestMatch; };
    function isValidName(name) { if (!name || typeof name !== 'string' || name.trim() === '') { return false; } const trimmedName = name.trim(); const EXCLUSION_KEYWORDS = ['合计', '总计', '共计', '平均', '制表', '审核', '公司', '部门', '总额', '总数']; if (EXCLUSION_KEYWORDS.some(keyword => trimmedName === keyword || trimmedName.endsWith(keyword))) { return false; } const chineseNameRegex = /^[\u4e00-\u9fa5]{2,6}(·[\u4e00-\u9fa5]+)*$/; const englishNameRegex = /^[a-zA-Z\s]{3,}$/; if (chineseNameRegex.test(trimmedName) || englishNameRegex.test(trimmedName)) { return true; } return false; }
    const fileInput = document.getElementById('file-input'); const uploadButton = document.getElementById('upload-button'); const clearDataButton = document.getElementById('clear-data-button'); const statusMessage = document.getElementById('status-message'); const fullDataDisplay = document.getElementById('full-data-display'); const fileNameDisplay = document.getElementById('file-name-display'); const yearSelect = document.getElementById('year-select'); const monthSelect = document.getElementById('month-select'); const chartContainer = document.getElementById('chart-container'); const viewModeGroup = document.getElementById('view-mode-group'); const chartTypeGroup = document.getElementById('chart-type-group'); const paginationControls = document.getElementById('pagination-controls');
    let appState = { allData: [], viewMode: 'all', filterValue: null, chartType: 'bar', isUploading: false, currentPage: 1, itemsPerPage: 10 }; let chartInstance = null;
    const fetchData = async () => { try { const response = await fetch('/api/data'); if (!response.ok) throw new Error(`Server error: ${response.statusText}`); appState.allData = await response.json(); appState.allData.sort((a, b) => (a.name + a.月份).localeCompare(b.name + b.月份)); update(); } catch (error) { console.error(`加载数据失败:`, error); statusMessage.textContent = `加载数据失败: ${error.message}`; } };
    const saveData = async (newRecords) => { try { const response = await fetch('/api/save-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRecords) }); if (!response.ok) throw new Error(`Server save failed: ${response.statusText}`); return true; } catch (error) { console.error(`保存数据失败:`, error); return false; } };
    const update = () => { if (appState.isUploading) { uploadButton.disabled = true; uploadButton.innerHTML = '<i data-feather="loader" class="spin"></i> ...'; } else { uploadButton.disabled = false; uploadButton.innerHTML = '<i data-feather="bar-chart-2"></i> 上传并分析'; } feather.replace(); updateFilterControls(); renderCharts(); renderFullDataTable(); };
    const updateFilterControls = () => { viewModeGroup.querySelectorAll('.control-button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === appState.viewMode)); const months = [...new Set(appState.allData.map(d => d['月份']))].sort((a, b) => b.localeCompare(a)); const years = [...new Set(months.map(m => m.substring(0, 4)))]; yearSelect.innerHTML = ['<option value="">所有年份</option>', ...years.map(y => `<option value="${y}">${y}年</option>`)].join(''); monthSelect.innerHTML = ['<option value="">所有月份</option>', ...months.map(m => `<option value="${m}">${m.replace('-', '年')}月</option>`)].join(''); yearSelect.style.display = appState.viewMode === 'year' ? 'block' : 'none'; monthSelect.style.display = appState.viewMode === 'month' ? 'block' : 'none'; if (appState.viewMode === 'year') { yearSelect.value = appState.filterValue || ''; appState.filterValue = yearSelect.value; } else if (appState.viewMode === 'month') { monthSelect.value = appState.filterValue || ''; appState.filterValue = monthSelect.value; } };
    
    // --- MAJOR UPDATE: 渲染逻辑更新 ---
    const renderCharts = () => {
        const { chartData, title, totalGross, totalNet } = filterData();
        const dataKeys = Object.keys(chartData);
        const emptyStateHTML = `<div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-bar-chart-2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg><p>暂无可用数据</p></div>`;
        if (dataKeys.length === 0) { if (chartInstance) { chartInstance.dispose(); chartInstance = null; } chartContainer.innerHTML = emptyStateHTML; feather.replace(); return; }
        if (!chartInstance) { chartContainer.innerHTML = ''; chartInstance = echarts.init(chartContainer); }
        
        let option;
        try {
            if (appState.chartType === 'bar') {
                const xAxisData = dataKeys.sort();
                const grossPayData = xAxisData.map(key => chartData[key].grossPay || 0);
                const netPayData = xAxisData.map(key => chartData[key].netPay || 0);
                const deductionData = xAxisData.map(key => chartData[key].deduction || 0);

                option = {
                    title: { text: `${title}趋势分析 (应发总额: ¥${totalGross.toFixed(2)})`, left: 'center', textStyle: { fontWeight: 'normal', color: '#fff' } },
                    tooltip: { trigger: 'axis', valueFormatter: value => `¥ ${Number(value || 0).toFixed(2)}` },
                    legend: { data: ['应发工资', '实发工资', '应扣合计'], bottom: 10, textStyle: { color: '#fff' } },
                    xAxis: { type: 'category', data: xAxisData, axisLine: { lineStyle: { color: 'rgba(84, 84, 88, 0.65)' } } },
                    yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(84, 84, 88, 0.65)' } } },
                    grid: { containLabel: true, left: '8%', right: '5%', bottom: '15%' },
                    series: [
                        { name: '应发工资', type: 'bar', barGap: '20%', barMaxWidth: '40px', data: grossPayData, showBackground: true, backgroundStyle: { color: 'rgba(180, 180, 180, 0.1)' }, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#83bff6' },{ offset: 0.5, color: '#188df0' },{ offset: 1, color: '#188df0' }]) }, emphasis: { itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#2378f7' },{ offset: 0.7, color: '#2378f7' },{ offset: 1, color: '#83bff6' }]) } } }, 
                        { name: '实发工资', type: 'bar', barMaxWidth: '40px', data: netPayData, showBackground: true, backgroundStyle: { color: 'rgba(180, 180, 180, 0.1)' }, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#7fe3a6' },{ offset: 1, color: '#26c566' }]) }, emphasis: { itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#26c566' },{ offset: 1, color: '#aff0c9' }]) } } },
                        { name: '应扣合计', type: 'line', smooth: true, data: deductionData, itemStyle: { color: '#EE6666' } } // 新增折线图
                    ]
                };
            } else {
                const { grossItems, deductionItems, totalGross, totalDeduction } = dataKeys.reduce((acc, key) => {
                    const data = chartData[key].nestedPieItems;
                    data.gross.forEach(item => { acc.grossItems[item.name] = (acc.grossItems[item.name] || 0) + item.value; });
                    data.deduction.forEach(item => { acc.deductionItems[item.name] = (acc.deductionItems[item.name] || 0) + item.value; });
                    acc.totalGross += data.totalGross;
                    acc.totalDeduction += data.totalDeduction;
                    return acc;
                }, { grossItems: {}, deductionItems: {}, totalGross: 0, totalDeduction: 0 });

                const coolColors = ['#5470C6', '#91CC75', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'];
                const warmColors = ['#EE6666', '#FAC858', '#d53a35', '#db6322', '#bd9936'];
                const outerData = [ ...Object.entries(grossItems).map(([name, value], i) => ({ name, value, itemStyle: { color: coolColors[i % coolColors.length] } })), ...Object.entries(deductionItems).map(([name, value], i) => ({ name, value, itemStyle: { color: warmColors[i % warmColors.length] } })) ];
                const innerData = [ { name: '应发合计', value: totalGross, itemStyle: { color: '#5470C6' } }, { name: '应扣合计', value: totalDeduction, itemStyle: { color: '#EE6666' } } ];
                
                option = {
                    title: { text: `${title}收支构成 (应发总额: ¥${totalGross.toFixed(2)})`, left: 'center', textStyle: { fontWeight: 'normal', color: '#fff' } },
                    tooltip: { trigger: 'item', formatter: "{a} <br/>{b}: ¥{c}" },
                    legend: { show: false },
                    // 新增：在图表中心显示实发总额
                    graphic: {
                        type: 'text',
                        left: 'center',
                        top: '53%',
                        style: {
                            text: `实发总额\n¥${totalNet.toFixed(2)}`,
                            textAlign: 'center',
                            fill: '#fff',
                            fontSize: 20,
                            fontWeight: 'bold'
                        }
                    },
                    series: [
                        { name: '收支摘要', type: 'pie', radius: ['30%', '45%'], center: ['50%', '55%'], data: innerData, animationType: 'scale', animationEasing: 'elasticOut', label: { show: false }, emphasis: { scaleSize: 15 } },
                        { name: '收支明细', type: 'pie', radius: ['55%', '75%'], center: ['50%', '55%'], data: outerData, itemStyle: { borderRadius: 8, borderColor: 'rgba(0,0,0,0.5)', borderWidth: 2 }, label: { formatter: '{b|{b}}', rich: { b: { color: '#fff', fontSize: 12, lineHeight: 18 } } }, labelLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.7)' } }, emphasis: { focus: 'self' } }
                    ]
                };
            }
            chartInstance.setOption(option, true);
            chartInstance.resize();
        } catch(err) { console.error(`ECharts 渲染失败:`, err); chartContainer.innerHTML = emptyStateHTML; feather.replace(); }
    };
    
    // --- MAJOR UPDATE: 数据过滤逻辑更新，为新图表准备更多聚合数据 ---
    const filterData = () => {
        let data = [...appState.allData];
        let title = '';
        let groupBy = 'month';
        switch (appState.viewMode) {
            case 'year': if (appState.filterValue) { data = data.filter(d => d['月份'].startsWith(appState.filterValue)); title = `${appState.filterValue}年度 `; } else { title = '历年'; } groupBy = 'month'; break;
            case 'month': if (appState.filterValue) { data = data.filter(d => d['月份'] === appState.filterValue); title = `${appState.filterValue}月 `; } else { title = '最近一月'; } groupBy = 'month'; break;
            case 'all': default: title = '总览'; groupBy = 'year'; break;
        }
        
        let totalGross = 0;
        let totalNet = 0;

        const chartData = data.reduce((acc, item) => {
            const key = groupBy === 'year' ? item['月份'].substring(0, 4) : item['月份'];
            if (!acc[key]) {
                acc[key] = { grossPay: 0, netPay: 0, deduction: 0, nestedPieItems: { gross: [], deduction: [], totalGross: 0, totalDeduction: 0 } };
            }
            acc[key].grossPay += item.calculatedGrossPay;
            acc[key].netPay += item.calculatedNetPay;
            acc[key].deduction += item.calculatedDeduction;

            totalGross += item.calculatedGrossPay;
            totalNet += item.calculatedNetPay;

            acc[key].nestedPieItems.totalGross += item.calculatedGrossPay;
            acc[key].nestedPieItems.totalDeduction += item.calculatedDeduction;
            GROSS_PAY_KEYS.forEach(prop => { if (item[prop] > 0) { acc[key].nestedPieItems.gross.push({ name: COLUMN_DEFINITIONS[prop].displayName, value: item[prop] }); } });
            (item.unmappedGrossKeys || []).forEach(prop => { acc[key].nestedPieItems.gross.push({ name: prop, value: item[prop] }); });
            DEDUCTION_KEYS.forEach(prop => { if (item[prop] > 0) { acc[key].nestedPieItems.deduction.push({ name: COLUMN_DEFINITIONS[prop].displayName, value: item[prop] }); } });
            (item.unmappedDeductionKeys || []).forEach(prop => { acc[key].nestedPieItems.deduction.push({ name: prop, value: item[prop] }); });

            return acc;
        }, {});
        return { chartData, title, totalGross, totalNet };
    };

    // ... [其余所有函数 renderFullDataTable, renderPaginationControls, etc. 保持不变] ...
    const renderFullDataTable = () => { fullDataDisplay.innerHTML = ''; if (appState.allData.length === 0) { fullDataDisplay.innerHTML = `<div class="empty-state"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-file-text"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg><p>无详细数据</p></div>`; feather.replace(); renderPaginationControls(0, 0); return; } const peopleData = appState.allData.reduce((acc, current) => { const name = current.name || '未知人员'; if (!acc[name]) acc[name] = []; acc[name].push(current); return acc; }, {}); const sortedPeople = Object.keys(peopleData).sort(); const totalPages = Math.ceil(sortedPeople.length / appState.itemsPerPage); appState.currentPage = Math.max(1, Math.min(appState.currentPage, totalPages)); const startIndex = (appState.currentPage - 1) * appState.itemsPerPage; const endIndex = startIndex + appState.itemsPerPage; const peopleToShow = sortedPeople.slice(startIndex, endIndex); peopleToShow.forEach(name => { const records = peopleData[name]; const getLatestInfo = (key) => records.slice().reverse().find(r => r[key])?.[key] || ''; const personContainer = document.createElement('div'); personContainer.className = 'person-container'; let personHeaderHTML = `<div class="person-name">${name}</div>`; const metaItems = []; const latestInfo = { position: getLatestInfo('position'), department: getLatestInfo('department'), jobGrade: getLatestInfo('jobGrade'), coefficient: getLatestInfo('coefficient') }; if (latestInfo.department) metaItems.push(`<span><i data-feather="briefcase"></i> ${latestInfo.department}</span>`); if (latestInfo.position) metaItems.push(`<span><i data-feather="user"></i> ${latestInfo.position}</span>`); if (latestInfo.jobGrade) metaItems.push(`<span><i data-feather="award"></i> ${latestInfo.jobGrade}</span>`); if (latestInfo.coefficient) metaItems.push(`<span><i data-feather="trending-up"></i> ${latestInfo.coefficient}</span>`); if (metaItems.length > 0) { personHeaderHTML += `<div class="person-meta">${metaItems.join('')}</div>`; } personContainer.innerHTML = personHeaderHTML; records.sort((a,b) => b.月份.localeCompare(a.月份)).forEach(item => { const monthSection = document.createElement('div'); monthSection.className = 'month-section'; const generateList = (title, itemKeys, unmappedKeys = []) => { let itemsWithValues = itemKeys.map(key => ({ name: COLUMN_DEFINITIONS[key].displayName, value: item[key] || 0 })); if (unmappedKeys.length > 0) { const unmappedItems = unmappedKeys.map(key => ({ name: `${key} (?)`, value: item[key] || 0 })); itemsWithValues.push(...unmappedItems); } itemsWithValues = itemsWithValues.filter(i => i.value !== 0); if (itemsWithValues.length === 0) return ''; return `<div class="list-container"><h4>${title}</h4><ul>${itemsWithValues.map(i => `<li><span>${i.name}</span><span>¥ ${i.value.toFixed(2)}</span></li>`).join('')}</ul></div>`; }; const getVerificationIcon = (status, excelValue, calculatedValue) => { if (status === 'ok') return `<i data-feather="check-circle" class="icon-success" title="验证通过：程序计算结果与表中总计一致。"></i>`; if (status === 'mismatch') return `<i data-feather="alert-triangle" class="icon-warning" title="注意：程序计算结果(¥${calculatedValue.toFixed(2)})与表中总计(¥${excelValue.toFixed(2)})不符。"></i>`; return ''; }; monthSection.innerHTML = `<h3>${item['月份']}</h3><div class="details-grid">${generateList('应发项目', GROSS_PAY_KEYS, item.unmappedGrossKeys)}${generateList('应扣项目', DEDUCTION_KEYS, item.unmappedDeductionKeys)}</div><div class="summary-list"><ul><li><span>应发工资合计 ${getVerificationIcon(item.grossPayStatus, item.grossPayTotal, item.calculatedGrossPay)}</span><span class="summary-gross">¥ ${item.calculatedGrossPay.toFixed(2)}</span></li><li><span>应扣工资合计 ${getVerificationIcon(item.deductionStatus, item.deductionTotal, item.calculatedDeduction)}</span><span class="summary-deduction">¥ ${item.calculatedDeduction.toFixed(2)}</span></li><li><span class="summary-net-label">实发工资 ${getVerificationIcon(item.netPayStatus, item.netPay, item.calculatedNetPay)}</span><span class="summary-net">¥ ${item.calculatedNetPay.toFixed(2)}</span></li></ul></div>`; personContainer.appendChild(monthSection); }); fullDataDisplay.appendChild(personContainer); }); renderPaginationControls(sortedPeople.length, totalPages); feather.replace(); };
    const renderPaginationControls = (totalItems, totalPages) => { if (totalPages <= 1) { paginationControls.innerHTML = ''; return; } const prevDisabled = appState.currentPage === 1 ? 'disabled' : ''; const nextDisabled = appState.currentPage === totalPages ? 'disabled' : ''; paginationControls.innerHTML = ` <button id="prev-page" class="pagination-button" ${prevDisabled}><i data-feather="arrow-left"></i> 上一页</button> <span class="page-info">第 ${appState.currentPage} / ${totalPages} 页 (共 ${totalItems} 人)</span> <button id="next-page" class="pagination-button" ${nextDisabled}>下一页 <i data-feather="arrow-right"></i></button> `; feather.replace(); document.getElementById('prev-page')?.addEventListener('click', () => { if(appState.currentPage > 1) { appState.currentPage--; renderFullDataTable();} }); document.getElementById('next-page')?.addEventListener('click', () => { if(appState.currentPage < totalPages) { appState.currentPage++; renderFullDataTable();} }); };
    const performCalculationsAndVerification = (item) => { let calculatedGrossPay = GROSS_PAY_KEYS.reduce((sum, key) => sum + (item[key] || 0), 0); if (item.unmappedGrossKeys) { calculatedGrossPay += item.unmappedGrossKeys.reduce((sum, key) => sum + (item[key] || 0), 0); } let calculatedDeduction = DEDUCTION_KEYS.reduce((sum, key) => sum + (item[key] || 0), 0); if (item.unmappedDeductionKeys) { calculatedDeduction += item.unmappedDeductionKeys.reduce((sum, key) => sum + (item[key] || 0), 0); } const calculatedNetPay = calculatedGrossPay - calculatedDeduction; item.calculatedGrossPay = calculatedGrossPay; item.calculatedDeduction = calculatedDeduction; item.calculatedNetPay = calculatedNetPay; const check = (excelKey, calculatedValue) => { if (item[excelKey] !== undefined && item[excelKey] !== null) { return Math.abs(item[excelKey] - calculatedValue) < 0.01 ? 'ok' : 'mismatch'; } return 'n/a'; }; item.grossPayStatus = check('grossPayTotal', calculatedGrossPay); item.deductionStatus = check('deductionTotal', calculatedDeduction); item.netPayStatus = check('netPay', calculatedNetPay); };
    const findHeaderAndMapColumns = (sheetData, startRow) => { const { rowIndex, header } = findHeaderRow(sheetData, startRow); if (rowIndex === -1) return { headerRowIndex: -1 }; const columnIndexMap = new Map(); const unmappedIndices = new Set([...Array(header.length).keys()]); header.forEach((colName, idx) => { if (!colName) { unmappedIndices.delete(idx); return; } const standardKey = aliasReverseMap.get(normalizeText(colName)); if (standardKey) { columnIndexMap.set(idx, standardKey); unmappedIndices.delete(idx); } }); unmappedIndices.forEach(idx => { const colName = header[idx]; if (!colName) return; for (const key in COLUMN_DEFINITIONS) { const def = COLUMN_DEFINITIONS[key]; if (def.type !== 'summary') { for (const alias of def.aliases) { if (isMatch(colName, alias)) { columnIndexMap.set(idx, key); return; } } } } }); return { headerRowIndex: rowIndex, header, columnIndexMap }; };
    const processDataRows = (sheetData, headerInfo, searchStartRow) => { const { headerRowIndex, header, columnIndexMap } = headerInfo; const newRecords = []; const dateMatch = JSON.stringify(sheetData.slice(searchStartRow, headerRowIndex + 1)).match(/(\d{4})[-年.](\d{1,2})月?/); const month = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}` : '未知月份'; let lastDataRowIndex = headerRowIndex; for (let i = headerRowIndex + 1; i < sheetData.length; i++) { const rowData = sheetData[i]; lastDataRowIndex = i; if (!Array.isArray(rowData) || rowData.every(cell => cell === "" || cell === null)) { break; } let item = { '月份': month, unmappedGrossKeys: [], unmappedDeductionKeys: [] }; rowData.forEach((cellValue, idx) => { const standardKey = columnIndexMap.get(idx); const definition = standardKey ? COLUMN_DEFINITIONS[standardKey] : null; const parser = definition?.parser; const value = parser ? parser(cellValue) : cellValue; if (standardKey) { item[standardKey] = value; } else { const colName = header[idx]; if (colName && typeof value === 'number' && value !== 0) { if (colName.includes('扣') || colName.includes('罚')) { item.unmappedDeductionKeys.push(colName); } else { item.unmappedGrossKeys.push(colName); } item[colName] = value; } } }); if (isValidName(item.name)) { performCalculationsAndVerification(item); newRecords.push(item); } else { console.log(`已跳过无效行，内容为: "${item.name}"`); } } return { newRecords, lastDataRowIndex }; };
    const handleFileUpload = async () => { const files = fileInput.files; if (files.length === 0 || appState.isUploading) return; appState.isUploading = true; update(); statusMessage.textContent = '智能引擎启动...'; try { const readFile = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.onerror = (err) => reject(err); reader.readAsArrayBuffer(file); }); let allNewRecords = []; for (const file of files) { statusMessage.textContent = `(1/3) 正在读取文件 ${file.name}...`; const buffer = await readFile(file); const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' }); statusMessage.textContent = `(2/3) 正在智能扫描所有工作表...`; for (const sheetName of workbook.SheetNames) { const worksheet = workbook.Sheets[sheetName]; const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }); if (sheetData.length < 2) continue; let startRow = 0; while(startRow < sheetData.length) { const headerInfo = findHeaderAndMapColumns(sheetData, startRow); if (headerInfo.headerRowIndex === -1) break; const recordsFromSheet = processDataRows(sheetData, headerInfo, startRow); allNewRecords.push(...recordsFromSheet.newRecords); startRow = recordsFromSheet.lastDataRowIndex + 1; } } } if (allNewRecords.length > 0) { statusMessage.textContent = `(3/3) 正在保存 ${allNewRecords.length} 条记录...`; const saveSuccess = await saveData(allNewRecords); if (!saveSuccess) throw new Error('服务器保存失败。'); appState.currentPage = 1; statusMessage.textContent = `成功解析并添加 ${allNewRecords.length} 条新记录！`; await fetchData(); } else { statusMessage.textContent = '未在文件中找到可识别的数据。'; } } catch (error) { console.error(`文件上传或处理过程中发生错误:`, error); statusMessage.textContent = `处理失败: ${error.message}`; } finally { appState.isUploading = false; fileInput.value = ''; handleFileChange(); update(); } };
    const handleFileChange = () => { const files = fileInput.files; fileNameDisplay.textContent = files.length > 0 ? `${files.length} 个文件已选择` : '点击选择 Excel 文件'; };
    const handleClearData = async () => { if (confirm('确定要清空所有数据吗？此操作不可撤销。')) { try { const response = await fetch('/api/clear-all', { method: 'POST' }); if (!response.ok) throw new Error('服务器清空失败'); appState.allData = []; appState.currentPage = 1; update(); statusMessage.textContent = '所有数据已清除。'; } catch (error) { console.error(`清空数据失败: ${error.message}`); statusMessage.textContent = `清空失败: ${error.message}`; } } };
    fileInput.addEventListener('change', handleFileChange); uploadButton.addEventListener('click', handleFileUpload); clearDataButton.addEventListener('click', handleClearData);
    viewModeGroup.addEventListener('click', (e) => { const target = e.target.closest('.control-button'); if (!target || target.classList.contains('active')) return; appState.viewMode = target.dataset.view; appState.filterValue = null; appState.currentPage = 1; update(); });
    yearSelect.addEventListener('change', (e) => { appState.filterValue = e.target.value; appState.currentPage = 1; update(); });
    monthSelect.addEventListener('change', (e) => { appState.filterValue = e.target.value; appState.currentPage = 1; update(); });
    chartTypeGroup.addEventListener('click', (e) => { const target = e.target.closest('.control-button'); if (!target || target.classList.contains('active')) return; appState.chartType = target.dataset.chart; chartTypeGroup.querySelector('.active').classList.remove('active'); target.classList.add('active'); renderCharts(); });
    window.addEventListener('resize', () => { if (chartInstance) chartInstance.resize(); });
    fetchData();
});