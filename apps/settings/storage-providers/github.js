(function () {
    function bytesToBase64(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function base64ToText(value) {
        const binary = atob(String(value || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    class GitHubStorage extends window.CloudStorageProvider {
        values() {
            return {
                token: this.required('token', 'GitHub Token'),
                owner: this.required('owner', '仓库所有者'),
                repo: this.required('repo', '仓库名'),
                branch: String(this.config.branch || 'main').trim() || 'main',
                filePath: String(this.config.filePath || 'bunnyos-backups/latest.json').trim().replace(/^\/+/, '')
            };
        }

        headers() {
            const { token } = this.values();
            return {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28'
            };
        }

        api(pathname) {
            const { owner, repo } = this.values();
            return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${pathname}`;
        }

        async request(url, options = {}) {
            const response = await fetch(url, { ...options, headers: { ...this.headers(), ...(options.headers || {}) } });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const error = new Error(data.message || `GitHub 请求失败 (HTTP ${response.status})`);
                error.status = response.status;
                throw error;
            }
            return data;
        }

        async testConnection() {
            const { branch } = this.values();
            const data = await this.request(this.api(`?ref=${encodeURIComponent(branch)}`));
            return `已连接 ${data.full_name || `${data.owner?.login}/${data.name}`}`;
        }

        async existingFile() {
            const { branch, filePath } = this.values();
            try {
                return await this.request(this.api(`/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`));
            } catch (error) {
                if (error.status === 404) return null;
                throw error;
            }
        }

        async uploadBackup() {
            const backup = await this.readLocalBackup();
            const current = await this.existingFile();
            const { branch, filePath } = this.values();
            const body = {
                message: `BunnyOS backup ${backup.createdAt}`,
                branch,
                content: bytesToBase64(JSON.stringify(backup))
            };
            if (current?.sha) body.sha = current.sha;
            await this.request(this.api(`/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            return backup;
        }

        async downloadBackup() {
            const current = await this.existingFile();
            if (!current?.content) throw new Error('云端还没有 BunnyOS 备份');
            return JSON.parse(base64ToText(current.content));
        }
    }

    window.GitHubStorage = GitHubStorage;
})();
