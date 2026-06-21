function bindEvents() {
    $$('.qq-tab, .qq-topbar-profile').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'settings') {
                toast('QQ 设置：后续迭代');
                return;
            }
            if (btn.dataset.tab === 'messages' && state.tab === 'messages') {
                setChatListCollapsed(!state.chatListCollapsed);
                return;
            }
            switchTab(btn.dataset.tab);
        });
    });

    $$('.qq-subtab').forEach(btn => {
        btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
    });

    $('#me-avatar-btn')?.addEventListener('click', () => openPersonaModal(state.currentPersonaId));
    $('#me-signature')?.addEventListener('click', editSignatureInline);
    $('#me-wallet')?.addEventListener('click', () => toast('钱包后续迭代'));
    $('#me-prompt-preset')?.addEventListener('change', event => savePromptPresetSetting(event.target.value));
    $('#me-prompt-manager')?.addEventListener('click', openPromptManager);
    $('#me-switch-account')?.addEventListener('click', openAccountModal);
    $('#persona-avatar-btn')?.addEventListener('click', () => $('#persona-avatar-input').click());
    $('#persona-avatar-input')?.addEventListener('change', onPersonaAvatarPicked);
    $('#persona-status')?.addEventListener('change', toggleCustomStatusField);
    $$('#persona-modal [data-persona-close]').forEach(el => {
        el.addEventListener('click', () => closePersonaModal());
    });
    $$('#account-modal [data-account-close]').forEach(el => {
        el.addEventListener('click', closeAccountModal);
    });
    $$('#prompt-manager-modal [data-prompt-manager-close]').forEach(el => {
        el.addEventListener('click', closePromptManager);
    });
    $('#account-new')?.addEventListener('click', () => {
        closeAccountModal();
        openPersonaModal('');
    });
    $('#account-delete')?.addEventListener('click', toggleAccountDeleteMode);

    $('#btn-topbar-action')?.addEventListener('click', onAddAction);
    $('#btn-contact-add')?.addEventListener('click', onAddAction);
    $$('#add-menu .qq-dropdown-item').forEach(btn => {
        btn.addEventListener('click', () => {
            hideAddMenu();
            handleAddAction(btn.dataset.action);
        });
    });
    document.addEventListener('click', (e) => {
        const menu = $('#add-menu');
        const addButton = e.target.closest('#btn-topbar-action, #btn-contact-add');
        if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !addButton) {
            hideAddMenu();
        }
        const messageMenu = $('#message-menu');
        if (!messageMenu.classList.contains('hidden') && !messageMenu.contains(e.target)) {
            if (Date.now() - state.messageMenuOpenedAt < 260) return;
            hideMessageMenu();
        }
        const emojiPanel = $('#emoji-panel');
        if (!emojiPanel.classList.contains('hidden') && !emojiPanel.contains(e.target)
            && !e.target.closest('#btn-emoji')) {
            hideEmojiPanel();
        }
    });

    $('#friend-avatar-btn').addEventListener('click', () => $('#friend-avatar-input').click());
    $('#friend-avatar-input').addEventListener('change', onFriendAvatarPicked);
    $('#friend-delete').addEventListener('click', deleteFriend);
    $('#friend-start-chat').addEventListener('click', () => {
        if (state.editingId) startChat(state.editingId);
    });
    $$('#friend-modal [data-close]').forEach(el => {
        el.addEventListener('click', () => closeFriendModal());
    });

    $('#btn-emoji').addEventListener('click', toggleEmojiPanel);
    $('.qq-sticker-tab[data-pack="emoji"]').addEventListener('click', showEmojiPicker);
    $('#btn-add-sticker-pack').addEventListener('click', () => openPopModal('sticker-modal'));
    $('#sticker-pack-save').addEventListener('click', saveStickerPack);
    $('#btn-transfer').addEventListener('click', () => openPopModal('transfer-modal'));
    $('#btn-impersonate')?.addEventListener('click', () => requestImpersonateReply());
    $('#btn-system-msg')?.addEventListener('click', () => openPopModal('system-msg-modal'));
    $('#system-msg-send')?.addEventListener('click', sendSystemMessage);
    $('#transfer-send').addEventListener('click', sendTransfer);
    // 来自横幅的"打开聊天"指令
    window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        if (event.data?.type !== 'bunnyos:open-chat') return;
        const cid = event.data.characterId;
        if (!cid) return;
        if (state.characters.find(c => c.id === cid)) {
            state.activeChatId = cid;
            switchTab('messages');
            setChatListCollapsed(true);
            renderChats();
            renderActiveChat();
        }
    });
    $('#btn-chat-image').addEventListener('click', () => $('#chat-image-input').click());
    $('#chat-image-input').addEventListener('change', onChatImagePicked);
    $$('.qq-pop-modal [data-pop-close]').forEach(btn => {
        btn.addEventListener('click', () => closePopModal(btn.dataset.popClose));
    });

    $('#btn-input-message').addEventListener('click', inputMessage);
    $('#chat-compose').addEventListener('submit', generateReply);
    $('#reply-draft-clear')?.addEventListener('click', clearReplyDraft);
    $('#btn-delete-mode')?.addEventListener('click', () => setDeleteMode(true));
    $('#delete-cancel')?.addEventListener('click', () => setDeleteMode(false));
    $('#delete-confirm')?.addEventListener('click', confirmDeleteSelection);
    $('#delete-range-mode')?.addEventListener('change', (event) => {
        state.deleteRangeMode = event.target.checked;
    });
    $$('#message-menu .qq-message-menu-item').forEach(btn => {
        btn.addEventListener('click', () => handleMessageMenuAction(btn.dataset.action));
    });
    $('#chat-back')?.addEventListener('click', () => {
        state.activeChatId = '';
        renderChats();
        renderActiveChat();
    });
    $('#chat-messages')?.addEventListener('click', (e) => {
        const voiceCard = e.target.closest('[data-voice-toggle]');
        if (voiceCard && !state.deleteMode) {
            voiceCard.classList.toggle('collapsed');
            return;
        }
        const editBtn = e.target.closest('[data-edit-save], [data-edit-cancel]');
        if (editBtn) {
            const row = editBtn.closest('.qq-message-row');
            const idx = Number(row?.dataset.idx);
            if (!Number.isNaN(idx)) {
                if (editBtn.hasAttribute('data-edit-save')) saveInlineEdit(idx);
                else cancelInlineEdit();
            }
            return;
        }
        const versionBtn = e.target.closest('[data-version-dir]');
        if (versionBtn) {
            const row = versionBtn.closest('.qq-message-row');
            const idx = Number(row?.dataset.idx);
            if (!Number.isNaN(idx)) switchMessageVersion(idx, Number(versionBtn.dataset.versionDir));
            return;
        }
        const rowForDelete = e.target.closest('.qq-message-row');
        if (state.deleteMode && rowForDelete) {
            const idx = Number(rowForDelete.dataset.idx);
            if (!Number.isNaN(idx)) toggleDeleteSelection(idx);
            return;
        }
        const btn = e.target.closest('.qq-msg-actions button');
        if (!btn) return;
        const row = btn.closest('.qq-message-row');
        const idx = Number(row?.dataset.idx);
        if (Number.isNaN(idx)) return;
        if (btn.dataset.act === 'regen') regenerateReplyAt(idx);
        else if (btn.dataset.act === 'edit') editMessage(idx);
        else if (btn.dataset.act === 'fav') toggleFavorite(idx);
        else if (btn.dataset.act === 'version') generateMessageVersion(idx);
    });
    bindMessageMenuEvents();
    // + 号展开/收起输入栏工具
    $('#btn-attach')?.addEventListener('click', () => {
        const tools = $('#compose-tools');
        const open = tools.classList.toggle('hidden') === false;
        $('#chat-compose')?.classList.toggle('tools-open', open);
    });
    // 加号 → 钟表：已收藏的对话
    $('#btn-fav-list')?.addEventListener('click', openFavListModal);
    // 加号 → 链接：粘贴 URL 发链接卡片
    $('#btn-link')?.addEventListener('click', sendLinkCard);
    // 加号 → 麦克风：语音输入（MediaRecorder → ASR API）
    // Edge Android 录音中按钮 click 偶发不触发，绑 pointerup + click + touchend 三重兜底
    // 同时录音中输入栏上方会显示红色「点此结束」横幅作为最稳定入口
    {
        let lastToggleAt = 0;
        const handler = (event) => {
            event.preventDefault();
            const now = Date.now();
            if (now - lastToggleAt < 500) return;
            lastToggleAt = now;
            toggleVoiceInput();
        };
        const voiceButton = $('#btn-voice-input');
        voiceButton?.addEventListener('pointerup', handler);
        voiceButton?.addEventListener('click', handler);
        voiceButton?.addEventListener('touchend', handler);
        const banner = $('#voice-recording-banner');
        banner?.addEventListener('pointerup', handler);
        banner?.addEventListener('click', handler);
        banner?.addEventListener('touchend', handler);
    }
    $$('#fav-list-modal [data-fav-close]').forEach(el => {
        el.addEventListener('click', () => {
            setFavSelectMode(false);
            $('#fav-list-modal')?.classList.add('hidden');
        });
    });
    $('#fav-select-toggle')?.addEventListener('click', () => setFavSelectMode(true));
    $('#fav-select-cancel')?.addEventListener('click', () => setFavSelectMode(false));
    $('#fav-delete-confirm')?.addEventListener('click', batchUnfavorite);

    window.addEventListener('message', (e) => {
        if (e.data?.type === 'bunnyos:navigate-back') handleNavigateBack();
    });
    // 横竖屏切换时，重新评估是否隐藏外层栏
    window.addEventListener('resize', () => notifyNavState());

    const contactsPanel = $('.qq-panel[data-panel="contacts"]');
    if (contactsPanel) {
        let lastY = 0;
        contactsPanel.addEventListener('scroll', () => {
            const y = contactsPanel.scrollTop;
            const wrap = $('.qq-search-wrap');
            if (!wrap) return;
            if (y > 20 && y > lastY) wrap.classList.add('collapsed');
            else if (y < lastY - 4 || y <= 4) wrap.classList.remove('collapsed');
            lastY = y;
        }, { passive: true });
    }
}
