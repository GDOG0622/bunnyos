'use strict';

const fs = require('fs');
const path = require('path');

function createWorldbookStore({ directory, legacyFile }) {
    const migrationMarker = path.join(directory, '.migration-complete');

    function validateName(value) {
        const name = String(value || '').trim();
        if (!name || name.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
            || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
            const error = new Error('世界书名称不能为空、超过 100 字，或包含文件名禁用字符');
            error.statusCode = 400;
            throw error;
        }
        return name;
    }

    function fileFor(book) {
        return path.join(directory, `${validateName(book.name)}.json`);
    }

    function validateBooks(books) {
        if (!Array.isArray(books)) throw new Error('世界书数据必须是数组');
        const names = new Set();
        const ids = new Set();
        for (const book of books) {
            const name = validateName(book?.name);
            const nameKey = name.toLocaleLowerCase('zh-CN');
            if (names.has(nameKey)) {
                const error = new Error(`世界书名称不能重复：${name}`);
                error.statusCode = 409;
                throw error;
            }
            names.add(nameKey);
            const id = String(book?.id || '');
            if (!id || ids.has(id)) {
                const error = new Error('世界书 ID 缺失或重复');
                error.statusCode = 400;
                throw error;
            }
            ids.add(id);
        }
    }

    function persist(books) {
        validateBooks(books);
        fs.mkdirSync(directory, { recursive: true });
        const wanted = new Set();
        for (const book of books) {
            const file = fileFor(book);
            wanted.add(path.basename(file).toLocaleLowerCase('zh-CN'));
            const serialized = JSON.stringify(book, null, 2);
            if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === serialized) continue;
            const temp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(temp, serialized, 'utf8');
            fs.renameSync(temp, file);
        }
        fs.writeFileSync(migrationMarker, '', 'utf8');
        for (const name of fs.readdirSync(directory)) {
            if (name.toLowerCase().endsWith('.json') && !wanted.has(name.toLocaleLowerCase('zh-CN'))) {
                fs.rmSync(path.join(directory, name), { force: true });
            }
        }
    }

    function ensureMigrated() {
        fs.mkdirSync(directory, { recursive: true });
        if (fs.existsSync(migrationMarker)) return;
        const existing = fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.json'));
        if (existing.length) {
            fs.writeFileSync(migrationMarker, '', 'utf8');
            return;
        }
        const legacy = fs.existsSync(legacyFile) ? JSON.parse(fs.readFileSync(legacyFile, 'utf8')) : null;
        const books = Array.isArray(legacy?.books) ? legacy.books : [];
        const usedNames = new Set();
        const migrated = books.map((book, index) => {
            let base = String(book?.name || `未命名世界书 ${index + 1}`)
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 90).replace(/[. ]+$/g, '');
            if (!base || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `世界书 ${index + 1}`;
            let name = base;
            let suffix = 2;
            while (usedNames.has(name.toLocaleLowerCase('zh-CN'))) name = `${base} (${suffix++})`;
            usedNames.add(name.toLocaleLowerCase('zh-CN'));
            return { ...book, name };
        });
        persist(migrated);
    }

    function read() {
        ensureMigrated();
        return fs.readdirSync(directory)
            .filter(name => name.toLowerCase().endsWith('.json'))
            .map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
            .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    }

    function write(books) {
        ensureMigrated();
        persist(books);
    }

    return { read, write, validateName };
}

module.exports = { createWorldbookStore };
