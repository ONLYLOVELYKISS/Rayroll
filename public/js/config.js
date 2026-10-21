// public/js/config.js (网络增强版 - 已加固)

// 内置一个解析器，用于清理数字格式
const parseAsNumber = (value) => {
    // 处理空值或空白字符串
    if (value === null || value === undefined || String(value).trim() === '') {
        return 0;
    }

    const cleanedValue = String(value).replace(/[¥￥,]/g, '').trim();

    // 明确处理常见的非数字占位符
    if (['-', '无', 'n/a'].includes(cleanedValue.toLowerCase())) {
        return 0;
    }

    // 处理会计格式的负数, e.g., (100) -> -100
    if (cleanedValue.startsWith('(') && cleanedValue.endsWith(')')) {
        const negativeValue = cleanedValue.replace(/[()]/g, '');
        return parseFloat(negativeValue) * -1 || 0;
    }

    // 最终解析，任何无法解析的文本都会返回 0
    return parseFloat(cleanedValue) || 0;
};

const COLUMN_DEFINITIONS = {
    // --- 核心人员信息 (type: 'info') ---
    name:           { displayName: '姓名',       aliases: ['姓名', '员工姓名', '职工姓名', '人员姓名', '员工名称', '人员名称', '员工', '姓名/Name', 'name', 'employee', 'employeename', 'staffname'], type: 'info' },
    '月份':         { displayName: '工资月份',   aliases: ['工资所属月份', '工资结算月', '月份', '工资月份', '所属月份', '发薪月份', '薪资月份', '结算月份', '工资期间', '期间', 'payperiod', 'paymonth', 'payrollmonth'], type: 'info' },
    payDate:        { displayName: '发薪日期',   aliases: ['实际发薪日期', '工资发放日期', '薪资发放日', '发薪日期', '支付日期', '付款日期', '发放日期', '到账日期', '工资日期', 'paydate', 'paymentdate', 'checkdate', 'date'], type: 'info' },
    periodStart:    { displayName: '计薪开始日期', aliases: ['计薪期间开始日期', '工资期间开始日期', '薪资期间开始日期', '工资起始日期', '薪资起始日期', '工资期间开始', '薪资期间开始', '计薪开始日期', '期间开始', 'payperiodstart', 'payperiodstartdate', 'periodstart', 'periodstartdate', 'fromdate'], type: 'info' },
    periodEnd:      { displayName: '计薪结束日期', aliases: ['计薪期间结束日期', '工资期间结束日期', '薪资期间结束日期', '工资截止日期', '薪资截止日期', '工资期间结束', '薪资期间结束', '计薪结束日期', '期间结束', 'payperiodend', 'payperiodenddate', 'periodend', 'periodenddate', 'todate'], type: 'info' },
    employer:       { displayName: '公司 / 单位', aliases: ['公司', '所属公司', '公司名称', '企业', '企业名称', '用人单位', '雇主', 'employer', 'company'], type: 'info' },
    department:     { displayName: '部门',       aliases: ['部门', '所属部门', '所在部门', '部门名称', '部门/Dept', 'department', 'dept'], type: 'info' },
    position:       { displayName: '岗位',       aliases: ['岗位', '职位', '职务', '岗位/Position', 'position'],      type: 'info' },
    jobGrade:       { displayName: '岗级',       aliases: ['岗级', '职级', '级别', 'grade'],                            type: 'info' },
    coefficient:    { displayName: '岗位系数',   aliases: ['岗位系数', '系数', 'coefficient'],                        type: 'info', parser: parseAsNumber },

    // --- 应发工资项 (type: 'grossPay') ---
    jobSalary:      { displayName: '岗位工资',   aliases: ['岗位工资', '基本工资', '标准薪酬', '固定工资', '基础工资', '底薪', 'basesalary'], type: 'grossPay', parser: parseAsNumber },
    perfSalary:     { displayName: '绩效工资',   aliases: ['预发绩效', '绩效工资', '月度绩效', '绩效奖金', '绩效', 'performance'], type: 'grossPay', parser: parseAsNumber },
    floatPerfSalary:{ displayName: '浮动绩效',   aliases: ['浮动绩效'],                                type: 'grossPay', parser: parseAsNumber },
    seniorityPay:   { displayName: '年功工资',   aliases: ['年功工资', '工龄工资', '司龄工资'],                    type: 'grossPay', parser: parseAsNumber },
    overtimePay:    { displayName: '加班工资',   aliases: ['加班工资', '加班费', 'ot'],                        type: 'grossPay', parser: parseAsNumber },
    attendanceBonus:{ displayName: '全勤奖',     aliases: ['全勤奖', '全勤奖励'],                      type: 'grossPay', parser: parseAsNumber },
    yearEndBonus:   { displayName: '年终奖',     aliases: ['年终奖', '年终奖金', '13薪', '14薪'],                      type: 'grossPay', parser: parseAsNumber },
    projectSub:     { displayName: '项目补贴',   aliases: ['国内项目岗位补贴', '项目补贴', '项目津贴'],type: 'grossPay', parser: parseAsNumber },
    fieldSub:       { displayName: '外勤津贴',   aliases: ['外勤补贴/艰苦津贴', '外勤补贴', '外勤津贴', '艰苦津贴'], type: 'grossPay', parser: parseAsNumber },
    nightShiftSub:  { displayName: '中夜班津贴', aliases: ['中夜班津贴', '夜班补助', '夜班津贴'],                    type: 'grossPay', parser: parseAsNumber },
    securitySub:    { displayName: '保密津贴',   aliases: ['融合项目保密津贴', '保密津贴', '保密费'],            type: 'grossPay', parser: parseAsNumber },
    petitionSub:    { displayName: '信访津贴',   aliases: ['信访津贴'],                                type: 'grossPay', parser: parseAsNumber },
    mentorSub:      { displayName: '导师津贴',   aliases: ['导师津贴'],                                type: 'grossPay', parser: parseAsNumber },
    commSub:        { displayName: '通讯补贴',   aliases: ['通讯补贴', '话费补贴', '话补'],            type: 'grossPay', parser: parseAsNumber },
    transportSub:   { displayName: '交通补贴',   aliases: ['交通补贴', '交通补助', '车补'],            type: 'grossPay', parser: parseAsNumber },
    mealSub:        { displayName: '餐补',       aliases: ['餐补', '午餐补助', '餐费补贴', '饭补'],              type: 'grossPay', parser: parseAsNumber },
    housingSub:     { displayName: '住房补贴',   aliases: ['住房补贴', '房补'],                        type: 'grossPay', parser: parseAsNumber },
    certSub:        { displayName: '执业资格补贴', aliases: ['执业资格补贴', '证书补贴', '证书津贴'],                type: 'grossPay', parser: parseAsNumber },
    bonus:          { displayName: '单项奖',     aliases: ['单项奖', '专项奖金', '一次性奖金'],                        type: 'grossPay', parser: parseAsNumber },
    backPay:        { displayName: '补发工资',   aliases: ['补发工资', '补发'],                                type: 'grossPay', parser: parseAsNumber },

    // --- 应扣工资项 (type: 'deduction') ---
    deductJobSalary:{ displayName: '扣岗位工资', aliases: ['扣岗位工资'],                              type: 'deduction', parser: parseAsNumber },
    deductPerf:     { displayName: '扣预发绩效', aliases: ['扣预发绩效'],                              type: 'deduction', parser: parseAsNumber },
    deductSafety:   { displayName: '扣安全风险金', aliases: ['扣安全风险金'],                          type: 'deduction', parser: parseAsNumber },
    deductLate:     { displayName: '迟到扣款',   aliases: ['迟到扣款', '迟到罚款'],                      type: 'deduction', parser: parseAsNumber },
    deductLeave:    { displayName: '事假扣款',   aliases: ['事假扣款', '事假'],                                type: 'deduction', parser: parseAsNumber },
    deductSick:     { displayName: '病假扣款',   aliases: ['病假扣款', '病假'],                                type: 'deduction', parser: parseAsNumber },
    deductUnion:    { displayName: '工会会费',   aliases: ['扣工会会费', '工会费', '工会费扣款'],                      type: 'deduction', parser: parseAsNumber },
    pension:        { displayName: '养老保险',   aliases: ['扣养老保险金', '个人养老保险', '养老保险个人', '养老保险', '养老金', '养老'], type: 'deduction', parser: parseAsNumber },
    medical:        { displayName: '医疗保险',   aliases: ['扣医疗保险金', '个人医疗保险', '医疗保险个人', '医疗保险', '医保'], type: 'deduction', parser: parseAsNumber },
    criticalIllness:{ displayName: '大病医保',   aliases: ['扣大病医保', '大病医保', '大病保险'],                 type: 'deduction', parser: parseAsNumber },
    unemployment:   { displayName: '失业保险',   aliases: ['扣失业保险', '失业保险', '失业'],                   type: 'deduction', parser: parseAsNumber },
    housingFund:    { displayName: '公积金',     aliases: ['扣公积金', '个人公积金', '公积金个人', '公积金', '住房公积金'], type: 'deduction', parser: parseAsNumber },
    annuity:        { displayName: '企业年金',   aliases: ['扣企业年金', '企业年金'],                 type: 'deduction', parser: parseAsNumber },
    tax:            { displayName: '个人所得税', aliases: ['扣个人所得税', '个税', '个人所得税', '所得税'], type: 'deduction', parser: parseAsNumber },

    // --- 合计项 (type: 'summary') ---
    grossPayTotal:  { displayName: '应发工资',   aliases: ['应发工资', '应发金额', '应发薪酬', '应发合计', '应发总额', '税前工资', '税前收入', '工资总额', '工资合计', '薪资总额', '总工资', '收入合计', 'grosspay', 'grosspaytotal', 'grosssalary', 'pretaxsalary'], type: 'summary', parser: parseAsNumber },
    deductionTotal: { displayName: '应扣工资',   aliases: ['应扣工资', '应扣款项', '应扣合计', '应扣总额', '扣款合计', '扣款总额', '扣除合计', '扣减合计', '个人扣款', '总扣款', 'deductiontotal', 'totaldeductions', 'totalwithheld'], type: 'summary', parser: parseAsNumber },
    netPay:         { displayName: '实发工资',   aliases: ['实发工资', '实发合计', '实发金额', '实领金额', '到账金额', '到卡金额', '实发', '到手工资', '实领工资', '净收入', '净工资', 'netpay', 'netpaytotal', 'netsalary', 'takehomepay'], type: 'summary', parser: parseAsNumber },
};
