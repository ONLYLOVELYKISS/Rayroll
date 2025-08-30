// server.js (用于 npm run start 开发)

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// --- 路径、加密、日志等配置 ---
const appDataPath = process.env.LOCALAPPDATA || process.env.APPDATA;
if (!appDataPath) { console.error("错误：无法确定应用数据目录 (APPDATA)。"); process.exit(1); }
const APP_DIR = path.join(appDataPath, 'SalaryCompass');
const DATA_DIR = path.join(APP_DIR, 'data');
const LOG_DIR = path.join(APP_DIR, 'logs');
const ENCRYPTION_KEY = '12345678901234567890123456789012';
const IV = '1234567890123456';
const ALGORITHM = 'aes-256-cbc';

// --- 工具函数 ---
const encrypt = (text) => { const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, IV); let encrypted = cipher.update(text, 'utf8', 'hex'); encrypted += cipher.final('hex'); return encrypted; };
const decrypt = (encryptedText) => { const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, IV); let decrypted = decipher.update(encryptedText, 'hex', 'utf8'); decrypted += decipher.final('utf8'); return decrypted; };
const writeLog = async (message, level = 'info') => { const timestamp = new Date().toISOString(); const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`; try { await fs.mkdir(LOG_DIR, { recursive: true }); await fs.appendFile(path.join(LOG_DIR, 'app.log'), logMessage); } catch (err) { console.error('写入日志文件失败:', err); } };
const sanitizeFilename = (input) => String(input).replace(/[\\?%*|:"<>/\\]/g, '_');

// --- 服务器配置 ---
const app = express();
const PORT = 3000;
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- API 路由定义 ---
app.get('/api/data', async (req, res) => { try { await fs.mkdir(DATA_DIR, { recursive: true }); const files = await fs.readdir(DATA_DIR); const jsonFiles = files.filter(file => file.endsWith('.json')); const allData = await Promise.all(jsonFiles.map(async file => { const filePath = path.join(DATA_DIR, file); try { const encryptedContent = await fs.readFile(filePath, 'utf8'); if (!encryptedContent) return null; const decryptedContent = decrypt(encryptedContent); return JSON.parse(decryptedContent); } catch (decryptError) { await writeLog(`文件 ${file} 解密或解析失败: ${decryptError.message}。`, 'warn'); return null; } })); res.json(allData.filter(item => item !== null)); } catch (error) { await writeLog(`读取数据目录失败: ${error.message}`, 'error'); res.status(500).send('获取数据失败'); } });

app.post('/api/save-records', async (req, res) => {
    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).send('请求体必须是一个数组');
    
    const validatedRecords = records.filter(record => {
        const hasName = typeof record.name === 'string' && record.name.length > 0;
        const hasMonth = typeof record.月份 === 'string' && /^\d{4}-\d{2}$/.test(record.月份);
        const hasNetPay = typeof record.calculatedNetPay === 'number';
        if (!hasName || !hasMonth || !hasNetPay) {
            writeLog(`无效记录被过滤: ${JSON.stringify(record)}`, 'warn');
            return false;
        }
        return true;
    });

    if (validatedRecords.length === 0 && records.length > 0) {
        await writeLog(`收到的 ${records.length} 条记录均为无效格式。`, 'warn');
        return res.status(200).send('记录已收到，但均为无效格式。');
    }
    
    await writeLog(`收到 ${validatedRecords.length} 条有效新纪录需要加密保存...`, 'info');
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await Promise.all(validatedRecords.map(async record => {
            const name = record.name; const month = record.月份;
            const sanitizedName = sanitizeFilename(name); const sanitizedMonth = sanitizeFilename(month);
            const fileName = `${sanitizedName}-${sanitizedMonth}.json`;
            const filePath = path.join(DATA_DIR, fileName);
            const encryptedData = encrypt(JSON.stringify(record));
            await fs.writeFile(filePath, encryptedData);
        }));
        await writeLog(`${validatedRecords.length} 条新纪录加密保存成功。`, 'success');
        res.status(200).send('记录保存成功');
    } catch (error) {
        console.error(error); await writeLog(`保存新纪录时发生严重错误: ${error.stack}`, 'error'); res.status(500).send('保存记录失败');
    }
});
app.post('/api/clear-all', async (req, res) => { await writeLog('收到清空所有数据的请求...', 'warn'); try { await fs.rm(DATA_DIR, { recursive: true, force: true }); await writeLog('数据目录已清空。', 'success'); res.status(200).send('所有数据已清除'); } catch (error) { console.error(error); await writeLog(`清空数据时发生错误: ${error.stack}`, 'error'); res.status(500).send('清空数据失败'); } });
app.post('/api/log', (req, res) => { const { message, level } = req.body; if (message && level) { writeLog(message, level); res.status(200).send('日志已记录'); } else { res.status(400).send('日志格式错误'); } });

// --- 启动服务器 ---
app.listen(PORT, async () => {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await writeLog('开发服务器启动成功。');
        console.log(`开发服务器正在运行，请在浏览器中访问 http://localhost:${PORT}`);
        console.log(`应用数据和日志将存储在: ${APP_DIR}`);
    } catch (error) {
        console.error('初始化应用目录失败:', error);
        await writeLog(`初始化应用目录失败: ${error.stack}`, 'error');
    }
});