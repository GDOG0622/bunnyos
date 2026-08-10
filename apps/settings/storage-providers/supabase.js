(function () {
    class SupabaseStorage extends window.CloudStorageProvider {
        values() {
            return {
                url: this.required('url', 'Supabase Project URL').replace(/\/+$/, ''),
                key: this.required('key', 'Supabase Key'),
                bucket: String(this.config.bucket || 'bunnyos-backups').trim() || 'bunnyos-backups',
                objectPath: String(this.config.objectPath || 'latest.json').trim().replace(/^\/+/, '') || 'latest.json'
            };
        }

        headers(extra = {}) {
            const { key } = this.values();
            return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
        }

        async testConnection() {
            const { url, bucket } = this.values();
            const response = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
                method: 'POST',
                headers: this.headers({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ prefix: '', limit: 1, offset: 0 })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || `Supabase 请求失败 (HTTP ${response.status})`);
            return `已连接存储桶 ${bucket}`;
        }

        async uploadBackup() {
            const backup = await this.readLocalBackup();
            const { url, bucket, objectPath } = this.values();
            const target = `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
            const response = await fetch(target, {
                method: 'POST',
                headers: this.headers({ 'Content-Type': 'application/json', 'x-upsert': 'true' }),
                body: JSON.stringify(backup)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || `Supabase 上传失败 (HTTP ${response.status})`);
            return backup;
        }

        async downloadBackup() {
            const { url, bucket, objectPath } = this.values();
            const target = `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
            const response = await fetch(target, { headers: this.headers() });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || data.error || `Supabase 下载失败 (HTTP ${response.status})`);
            return data;
        }
    }

    window.SupabaseStorage = SupabaseStorage;
})();
