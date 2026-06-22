document.addEventListener('DOMContentLoaded', () => {
    const tabAvatar = $('#qq-user-avatar');
    if (tabAvatar) tabAvatar.innerHTML = DEFAULT_AVATAR_HTML;
    const topbarAvatar = $('#qq-topbar-avatar');
    if (topbarAvatar) topbarAvatar.innerHTML = DEFAULT_AVATAR_HTML;
    // 给 body 挂上皮肤包裹类，user 的皮肤 CSS 走 .bunny-qq-skin 作用域（§1.6）
    document.body.classList.add('bunny-qq-skin');
    bindEvents();
    loadPersonas();
    loadPromptPresetSetting();
    loadData();
    loadGlobalSkin();
    notifyNavState();
});
