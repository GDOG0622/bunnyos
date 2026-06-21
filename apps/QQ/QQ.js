document.addEventListener('DOMContentLoaded', () => {
    const tabAvatar = $('#qq-user-avatar');
    if (tabAvatar) tabAvatar.innerHTML = DEFAULT_AVATAR_HTML;
    const topbarAvatar = $('#qq-topbar-avatar');
    if (topbarAvatar) topbarAvatar.innerHTML = DEFAULT_AVATAR_HTML;
    bindEvents();
    loadPersonas();
    loadPromptPresetSetting();
    loadData();
    notifyNavState();
});
