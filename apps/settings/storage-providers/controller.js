(function () {
    function value(id) {
        return document.getElementById(id)?.value || '';
    }

    function currentProvider() {
        const kind = value('cloudStorage_provider') || 'github';
        if (kind === 'supabase') {
            return new window.SupabaseStorage({
                url: value('cloudStorage_supabaseUrl'),
                key: value('cloudStorage_supabaseKey'),
                bucket: value('cloudStorage_supabaseBucket'),
                objectPath: value('cloudStorage_supabasePath')
            });
        }
        return new window.GitHubStorage({
            token: value('cloudStorage_githubToken'),
            owner: value('cloudStorage_githubOwner'),
            repo: value('cloudStorage_githubRepo'),
            branch: value('cloudStorage_githubBranch'),
            filePath: value('cloudStorage_githubPath')
        });
    }

    function setStatus(text, kind = '') {
        const status = document.getElementById('cloud-storage-status');
        if (!status) return;
        status.textContent = text;
        status.dataset.kind = kind;
    }

    function toggleCloudStorageProvider() {
        const kind = value('cloudStorage_provider') || 'github';
        document.getElementById('cloud-storage-github')?.classList.toggle('hidden', kind !== 'github');
        document.getElementById('cloud-storage-supabase')?.classList.toggle('hidden', kind !== 'supabase');
    }

    async function withBusy(label, callback) {
        const buttons = [...document.querySelectorAll('[data-cloud-action]')];
        buttons.forEach(button => { button.disabled = true; });
        setStatus(label);
        try {
            return await callback();
        } catch (error) {
            setStatus(error?.message || '操作失败', 'error');
            throw error;
        } finally {
            buttons.forEach(button => { button.disabled = false; });
        }
    }

    async function testCloudStorage() {
        await saveData();
        try {
            const message = await withBusy('正在测试连接…', () => currentProvider().testConnection());
            setStatus(message, 'success');
        } catch (error) {
            alert(`连接失败：${error.message}`);
        }
    }

    async function backupToCloud() {
        await saveData();
        if (!confirm('将当前 BunnyOS 数据上传到云端，并覆盖同一路径的旧备份？\n\n备份包含聊天记录、角色、世界书、设置及其中填写的 API Key。')) return;
        try {
            const backup = await withBusy('正在整理并上传备份…', () => currentProvider().uploadBackup());
            const time = new Date(backup.createdAt).toLocaleString();
            localStorage.setItem('bunnyos:last-cloud-backup-at', backup.createdAt);
            setStatus(`备份完成 · ${backup.fileCount} 个文件 · ${time}`, 'success');
        } catch (error) {
            alert(`云端备份失败：${error.message}`);
        }
    }

    async function loadCloudBackup() {
        if (!confirm('加载云端备份会覆盖当前 BunnyOS 数据。恢复前会自动保留一份本机回滚快照，确定继续吗？')) return;
        try {
            const result = await withBusy('正在下载云端备份…', async () => {
                const backup = await currentProvider().downloadBackup();
                setStatus('正在恢复数据…');
                return currentProvider().restoreLocalBackup(backup);
            });
            setStatus(`已恢复 ${result.restoredFiles} 个文件`, 'success');
            alert(`恢复完成。回滚快照：${result.rollbackPath}\n页面将重新加载。`);
            window.top.location.reload();
        } catch (error) {
            alert(`加载备份失败：${error.message}`);
        }
    }

    function showCloudStorageHelp() {
        const kind = value('cloudStorage_provider') || 'github';
        if (kind === 'supabase') {
            showHelpModal('Supabase 云存储配置', `
                <ol>
                    <li>登录 <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Supabase Dashboard</a>，创建自己的项目。</li>
                    <li>在 Storage 中新建私有 bucket，名称建议为 <code>bunnyos-backups</code>。</li>
                    <li>在 Project Settings → API 复制 Project URL。</li>
                    <li>复制项目的 <code>service_role</code> / Secret Key 填入本页。这个 Key 只保存在你的 BunnyOS 设置中，不要发给别人。</li>
                    <li>填写 bucket 与备份路径，先点“测试连接”，成功后再点“云端备份”。</li>
                </ol>
                <p class="muted">发布 APK 时不要预填你自己的 Secret Key；应由每位用户填写自己的 Supabase 项目。</p>
            `);
            return;
        }
        showHelpModal('GitHub 云存储配置', `
            <ol>
                <li>在 GitHub 新建一个私有仓库，建议专门用于 BunnyOS 备份。</li>
                <li>进入 Settings → Developer settings → Personal access tokens，创建 Fine-grained token。</li>
                <li>只授权该私有仓库，并授予 Contents 的 Read and write 权限。</li>
                <li>填写 Token、仓库所有者、仓库名和分支，备份路径通常保持默认即可。</li>
                <li>先点“测试连接”，成功后再点“云端备份”。</li>
            </ol>
            <p class="muted">Token 由用户自己填写。备份包含设置和聊天等私密数据，请务必使用私有仓库。</p>
        `);
    }

    Object.assign(window, {
        toggleCloudStorageProvider,
        testCloudStorage,
        backupToCloud,
        loadCloudBackup,
        showCloudStorageHelp
    });
})();
