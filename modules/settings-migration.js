function migrateSettings(settings, force = false) {
    if (!force && settings._assetMigrationVersion >= 1) return false;
    const saved = settings.notify_savedSounds && typeof settings.notify_savedSounds === 'object' ? settings.notify_savedSounds : {};
    for (const kind of ['success', 'fail']) {
        if (settings[`notify_${kind}SoundUrl`] && !settings[`notify_${kind}SoundName`]) {
            const name = kind === 'success' ? '成功-默认' : '失败-默认';
            saved[name] ||= settings[`notify_${kind}SoundUrl`];
            settings[`notify_${kind}SoundName`] = name;
        }
    }
    const imported = settings.imported_carrot || {};
    for (const [name, url] of Object.entries(imported.notifSounds || {})) saved[name] ||= url;
    for (const kind of ['success', 'fail']) {
        const name = imported[kind === 'success' ? 'notifSuccess' : 'notifFail'];
        if (name && saved[name] && !settings[`notify_${kind}SoundName`]) {
            settings[`notify_${kind}SoundName`] = name;
            settings[`notify_${kind}SoundUrl`] = saved[name];
        }
    }
    settings.notify_savedSounds = saved;
    const fonts = ((settings.beautyPresets ||= {}).font ||= {});
    for (const [name, definition] of Object.entries(imported.fonts || {})) {
        fonts[name] ||= { url: definition?.url || '', size: '', weight: '' };
    }
    settings._assetMigrationVersion = 1;
    return true;
}

module.exports = { migrateSettings };
