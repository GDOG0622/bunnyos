// 钱包页：拉余额、打开/关闭弹窗。详见 QQ美化系统计划.md §1.1
async function loadWalletBalance() {
    try {
        const res = await fetch('/api/wallet');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const el = $('#wallet-balance');
        if (el) el.textContent = formatCC(data.balance);
        state.walletBalance = data.balance;
        return data;
    } catch (err) {
        console.warn('[WALLET] load failed', err);
        const el = $('#wallet-balance');
        if (el) el.textContent = '加载失败';
        return null;
    }
}

function formatCC(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US');
}

// 通用钱包加减（供红包 / 商城等模块调用）。失败时抛错
async function adjustWallet(delta, reason = '') {
    const res = await fetch('/api/wallet/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, reason })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.error || '钱包操作失败');
        err.status = res.status;
        err.balance = data?.balance;
        throw err;
    }
    state.walletBalance = data.balance;
    return data;
}

function openWalletModal() {
    $('#wallet-modal')?.classList.remove('hidden');
    state.pageHistory.push('wallet');
    notifyNavState();
    loadWalletBalance();
}

function closeWalletModal() {
    $('#wallet-modal')?.classList.add('hidden');
    if (state.pageHistory[state.pageHistory.length - 1] === 'wallet') {
        state.pageHistory.pop();
        notifyNavState();
    }
}
