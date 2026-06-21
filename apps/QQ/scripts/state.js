/* QQ App */

const DEFAULT_AVATAR_URL = 'https://i.postimg.cc/qvx2bC69/bohzfm.png';
const DEFAULT_AVATAR_HTML = `<img src="${DEFAULT_AVATAR_URL}" alt="">`;

const state = {
    tab: 'messages',
    subtab: 'friends',
    characters: [],
    groups: [],
    groupchats: [],
    chats: [],
    stickerPacks: [],
    personas: [],
    currentPersonaId: '',
    currentPersona: null,
    promptPresets: [],
    currentPromptPresetId: '',
    activeChatId: '',
    chatListCollapsed: false,
    composeHeight: 260,
    editingId: '',
    editingAvatarDataUrl: '',
    friendSnapshot: '',
    friendClosing: false,
    editingWorldbookIds: [],
    worldbookBooks: [],
    editingPersonaId: '',
    editingPersonaAvatarDataUrl: '',
    personaSnapshot: '',
    personaClosing: false,
    accountDeleteMode: false,
    messageMenuIndex: -1,
    replyDraft: null,
    editingMessageIndex: -1,
    deleteMode: false,
    deleteRangeMode: false,
    selectedDeleteIndexes: new Set(),
    messageMenuOpenedAt: 0,
    pageHistory: ['main'],
    imageAttachments: {},
};

const PERSONA_STATUSES = ['在忙中', '写作业', '搬砖中', '玩游戏', '恋爱中', 'emo中', '超开心', '气鼠了', '累瘫了', '自定义'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
