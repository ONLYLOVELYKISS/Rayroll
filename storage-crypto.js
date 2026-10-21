const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT_PREFIX = 'SCG1:';

function getOrCreateLocalKey(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const keyPath = path.join(directory, '.storage-key');
    try {
        const existing = fs.readFileSync(keyPath);
        if (existing.length !== 32) throw new Error(`Invalid local storage key: ${keyPath}`);
        return existing;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const generated = crypto.randomBytes(32);
    try {
        // On Windows, the containing per-user AppData directory supplies the
        // access-control boundary; mode 0600 also restricts access on POSIX.
        fs.writeFileSync(keyPath, generated, { flag: 'wx', mode: 0o600 });
        return generated;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = fs.readFileSync(keyPath);
        if (existing.length !== 32) throw new Error(`Invalid local storage key: ${keyPath}`);
        return existing;
    }
}

function createLocalCipher(directory) {
    const key = getOrCreateLocalKey(directory);

    function encrypt(plaintext) {
        const nonce = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        return `${FORMAT_PREFIX}${nonce.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
    }

    function isCurrentFormat(value) {
        return String(value).startsWith(FORMAT_PREFIX);
    }

    function decrypt(value) {
        const serialized = String(value);
        if (isCurrentFormat(serialized)) {
            const [nonceHex, tagHex, ciphertextHex] = serialized.slice(FORMAT_PREFIX.length).split(':');
            if (!nonceHex || !tagHex || ciphertextHex === undefined) throw new Error('Invalid encrypted record format');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
        }

        // Read-only compatibility for files written by older desktop builds.
        // New records never use this embedded legacy key or fixed IV.
        const legacyKey = Buffer.from('12345678901234567890123456789012', 'utf8');
        const legacyIv = Buffer.from('1234567890123456', 'utf8');
        const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, legacyIv);
        return decipher.update(serialized, 'hex', 'utf8') + decipher.final('utf8');
    }

    return { encrypt, decrypt, isCurrentFormat };
}

module.exports = { createLocalCipher };
