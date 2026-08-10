// QQ 分层总结：设置面板、自动触发、小总结归档、大总结阅览确认。

function renderChatSummarySection(worldbooks, summarySettings) {
    const settings = summarySettings || {};
    const threshold = Number(settings.layerThreshold) || 100;
    const options = [
        `<option value=""${settings.summaryWorldbookId ? '' : ' selected'}>未指定（首次总结时自动创建）</option>`,
        ...(Array.isArray(worldbooks) ? worldbooks : []).map(book =>
            `<option value="${escapeAttr(book.id)}"${book.id === settings.summaryWorldbookId ? ' selected' : ''}>${escapeHtmlText(book.name || book.id)}</option>`
        )
    ].join('');
    return `
        <details class="qq-chat-settings-section" open>
            <summary>总结 <i class="bi bi-chevron-down"></i></summary>
            <div class="qq-chat-settings-section-body">
                <div class="qq-chat-settings-row">
                    <label>每次总结</label>
                    <div class="qq-summary-threshold-control"><input id="chat-summary-threshold" type="number" min="1" max="5000" value="${threshold}"><span>层</span></div>
                </div>
                <div class="qq-chat-settings-row">
                    <label>总结世界书</label>
                    <select id="chat-summary-worldbook">${options}</select>
                </div>
                <div class="qq-summary-status">当前尚未总结 ${settings.unsummarizedLayers || 0} 层；达到 ${threshold + 1} 层时，总结前 ${threshold} 层。启用中的小总结 ${settings.activeSmallCards || 0} 张。</div>
            </div>
        </details>`;
}

function bindChatSummarySettingsEvents(body) {
    body?.querySelector('#chat-summary-threshold')?.addEventListener('change', saveChatSummarySettings);
    body?.querySelector('#chat-summary-worldbook')?.addEventListener('change', saveChatSummarySettings);
}

async function saveChatSummarySettings() {
    const charId = state.chatSettingsCharId;
    if (!charId) return;
    const thresholdInput = $('#chat-summary-threshold');
    const worldbookSelect = $('#chat-summary-worldbook');
    const layerThreshold = Math.max(1, Math.min(parseInt(thresholdInput?.value, 10) || 100, 5000));
    if (thresholdInput) thresholdInput.value = String(layerThreshold);
    try {
        const res = await fetch(`/api/qq/summary-settings/${encodeURIComponent(charId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layerThreshold, summaryWorldbookId: worldbookSelect?.value || '' })
        });
        const data = await readApiResponse(res);
        if (!res.ok) {
            await showBackendError(`保存总结设置失败 (HTTP ${res.status})`, data, res);
            return;
        }
        const character = state.characters.find(item => item.id === charId);
        if (character) character.summaryWorldbookId = data.summaryWorldbookId || '';
        toast('总结设置已保存');
        await renderChatSettings();
    } catch (error) {
        await showBackendError('保存总结设置失败', {
            error: error.message, error_code: error.name || 'CLIENT_NETWORK_ERROR', operation: 'summary-settings'
        });
    }
}

async function maybeRunLayerSummary(chat, signal) {
    try {
        const res = await fetch('/api/qq/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId: chat.characterId }),
            signal,
        });
        const data = await readApiResponse(res);
        if (!res.ok) {
            await showBackendError(`自动总结失败 (HTTP ${res.status})`, data, res);
            return { failed: true };
        }
        if (!data.triggered) return data;
        const archived = new Set(Array.isArray(data.archivedMessageIndexes) ? data.archivedMessageIndexes : []);
        (chat.messages || []).forEach((message, index) => {
            if (archived.has(index)) message.summary_archived = true;
        });
        const character = state.characters.find(item => item.id === chat.characterId);
        if (character && data.summaryWorldbookId) character.summaryWorldbookId = data.summaryWorldbookId;
        toast(`已生成小总结，前 ${data.entry?.sourceLayerCount || ''} 层不再发送给 AI`);
        return data;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        await showBackendError('自动总结失败', {
            error: error.message || '无法连接服务器',
            error_code: error.name || 'CLIENT_NETWORK_ERROR',
            error_type: 'client_network_error',
            operation: 'summarize',
            timestamp: new Date().toISOString(),
        });
        return { failed: true };
    }
}

async function offerBigSummary(characterId) {
    if (!characterId || state.bigSummaryPreviewLoading) return;
    const accepted = await askQqConfirm('总结世界书里已有至少 5 张启用的小总结。现在把最新 5 张整理成一张大总结吗？\n\n生成后会先让你阅览，确认保存后才会关闭原来的 5 张小总结。', '生成大总结');
    if (!accepted) return;
    state.bigSummaryPreviewLoading = true;
    toast('正在生成大总结…');
    try {
        const res = await fetch('/api/qq/summarize/big/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ characterId })
        });
        const data = await readApiResponse(res);
        if (!res.ok) {
            await showBackendError(`生成大总结失败 (HTTP ${res.status})`, data, res);
            return;
        }
        state.bigSummaryDraft = {
            characterId,
            sourceEntryIds: Array.isArray(data.sourceEntryIds) ? data.sourceEntryIds : []
        };
        const textarea = $('#summary-review-text');
        if (textarea) textarea.value = data.content || '';
        $('#summary-review-modal')?.classList.remove('hidden');
    } catch (error) {
        await showBackendError('生成大总结失败', {
            error: error.message, error_code: error.name || 'CLIENT_NETWORK_ERROR', operation: 'summarize-big-preview'
        });
    } finally {
        state.bigSummaryPreviewLoading = false;
    }
}

function closeSummaryReview() {
    $('#summary-review-modal')?.classList.add('hidden');
    state.bigSummaryDraft = null;
}

async function confirmBigSummary() {
    const draft = state.bigSummaryDraft;
    const content = $('#summary-review-text')?.value?.trim() || '';
    if (!draft || !content) {
        toast('大总结内容不能为空');
        return;
    }
    const button = $('#summary-review-save');
    if (button) button.disabled = true;
    try {
        const res = await fetch('/api/qq/summarize/big/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...draft, content })
        });
        const data = await readApiResponse(res);
        if (!res.ok) {
            await showBackendError(`保存大总结失败 (HTTP ${res.status})`, data, res);
            return;
        }
        closeSummaryReview();
        toast('大总结已保存，原来的 5 张小总结已关闭');
        if (!$('#chat-settings-modal')?.classList.contains('hidden')) await renderChatSettings();
    } catch (error) {
        await showBackendError('保存大总结失败', {
            error: error.message, error_code: error.name || 'CLIENT_NETWORK_ERROR', operation: 'summarize-big-confirm'
        });
    } finally {
        if (button) button.disabled = false;
    }
}
