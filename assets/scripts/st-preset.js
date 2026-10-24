(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.StPreset = api;
})(globalThis, function() {
    const builtins = [
        ['bunnyosRealtime', '实时模式'], ['worldInfoBefore', '世界书·角色前'], ['charDescription', 'CHAR人设'],
        ['worldInfoAfter', '世界书·角色后'], ['personaDescription', 'USER人设'], ['memory', '记忆'],
        ['onlinePrivateChat', '线上·私聊'], ['onlineGroupChat', '线上·群聊'], ['chatHistory', '聊天记录']
    ].map(([identifier, name]) => ({ identifier, name, role: 'system', content: '' }));
    const builtinIds = new Set(builtins.map(item => item.identifier));

    function normalize(preset, defaults = {}) {
        const before = JSON.stringify(preset);
        preset.prompts = (Array.isArray(preset.prompts) ? preset.prompts : []).filter(prompt => prompt.identifier !== 'charPersonality');
        if (!preset.extensions || typeof preset.extensions !== 'object' || Array.isArray(preset.extensions)) preset.extensions = {};
        const groups = Array.isArray(preset.extensions.bunnyosPromptGroups) ? preset.extensions.bunnyosPromptGroups : [];
        preset.extensions.bunnyosPromptGroups = groups.map(group => ({ ...group, itemIds: (group.itemIds || []).filter(id => id !== 'charPersonality') }))
            .filter(group => group.itemIds.length > 1);
        for (const builtin of builtins) {
            let prompt = preset.prompts.find(item => item.identifier === builtin.identifier);
            if (!prompt) {
                prompt = { ...builtin, enabled: true, injection_position: 0, injection_depth: 4, injection_order: 100,
                    content: defaults[builtin.identifier] ?? '', injection_trigger: '' };
                preset.prompts.push(prompt);
            }
            Object.assign(prompt, { name: builtin.name, role: prompt.role || builtin.role, marker: true, system_prompt: true, forbid_overrides: true });
        }
        if (!Array.isArray(preset.prompt_order) || !preset.prompt_order.length) preset.prompt_order = [{ character_id: 100001, order: [] }];
        for (const group of preset.prompt_order) {
            const order = (group.order || []).filter(entry => entry.identifier !== 'charPersonality');
            for (const builtin of builtins) {
                if (!order.some(entry => entry.identifier === builtin.identifier)) order.unshift({ identifier: builtin.identifier, enabled: true });
            }
            order.forEach(entry => { if (builtinIds.has(entry.identifier)) entry.enabled = true; });
            group.order = preset.extensions.bunnyosBuiltinArranged ? order
                : [...builtins.map(item => ({ identifier: item.identifier, enabled: true })), ...order.filter(entry => !builtinIds.has(entry.identifier))];
        }
        preset.extensions.bunnyosBuiltinArranged = true;
        return before !== JSON.stringify(preset);
    }

    return { builtins, normalize };
});
