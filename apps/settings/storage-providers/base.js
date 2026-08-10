(function () {
    class CloudStorageProvider {
        constructor(config = {}) {
            this.config = config;
        }

        required(name, label) {
            const value = String(this.config[name] || '').trim();
            if (!value) throw new Error(`请填写${label}`);
            return value;
        }

        async readLocalBackup() {
            const response = await fetch('/api/storage/backup/export');
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `生成本地备份失败 (HTTP ${response.status})`);
            return data;
        }

        async restoreLocalBackup(backup) {
            const response = await fetch('/api/storage/backup/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backup)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `恢复备份失败 (HTTP ${response.status})`);
            return data;
        }

        async testConnection() { throw new Error('未实现 testConnection'); }
        async uploadBackup() { throw new Error('未实现 uploadBackup'); }
        async downloadBackup() { throw new Error('未实现 downloadBackup'); }
    }

    window.CloudStorageProvider = CloudStorageProvider;
})();
