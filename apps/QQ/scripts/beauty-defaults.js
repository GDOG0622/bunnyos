// 美化教程"一键复制"用的默认 CSS 底稿（S38 从 styles.css 提取）
// 商城各模块"美化教程"折叠卡里的"复制默认 CSS"按钮使用这些常量。

// 皮肤：覆盖 CSS 变量即可整体换色；body 上会挂 .bunny-qq-skin
const DEFAULT_SKIN_CSS = `.bunny-qq-skin {
    /* ===== 亮色调色板（参考 Telegram Light）===== */
    --qq-bg: #ffffff;
    --qq-surface: #ffffff;
    --qq-surface-2: #f1f1f4;
    --qq-glass-top: rgba(255, 255, 255, 0.86);
    --qq-glass-body: rgba(255, 255, 255, 0.86);
    --qq-glass-rail: rgba(255, 255, 255, 0.86);
    --qq-text: #000000;
    --qq-text-sub: #707579;
    --qq-text-fade: #aeb4ba;
    --qq-divider: rgba(0, 0, 0, 0.07);
    --qq-divider-strong: rgba(0, 0, 0, 0.12);
    --qq-accent: #3390ec;        /* 蓝色强调色（按钮、链接） */
    --qq-danger: #e5484d;
    /* 气泡 */
    --qq-bubble-in: #ffffff;      /* char 气泡背景 */
    --qq-bubble-in-text: #000000;
    --qq-bubble-out: #effdde;     /* user 气泡背景（绿色系） */
    --qq-bubble-out-text: #000000;
    --qq-chat-bg: #e7ebef;        /* 聊天区域底色 */
}

/* 深色模式：如需跟随系统自动切换，可取消下面的注释
@media (prefers-color-scheme: dark) {
    .bunny-qq-skin {
        --qq-bg: #17212b;
        --qq-surface: #17212b;
        --qq-surface-2: #232e3c;
        --qq-glass-top: rgba(23, 33, 43, 0.86);
        --qq-glass-body: rgba(23, 33, 43, 0.9);
        --qq-glass-rail: rgba(23, 33, 43, 0.9);
        --qq-text: #ffffff;
        --qq-text-sub: #7d8b99;
        --qq-text-fade: #5a6b7b;
        --qq-divider: rgba(255, 255, 255, 0.08);
        --qq-divider-strong: rgba(255, 255, 255, 0.14);
        --qq-accent: #64b5ef;
        --qq-bubble-in: #182533;
        --qq-bubble-in-text: #ffffff;
        --qq-bubble-out: #2b4a33;
        --qq-bubble-out-text: #e8ffe0;
        --qq-chat-bg: #0e1621;
    }
}
*/`;

const DEFAULT_SKIN_PROMPT = `我在 BunnyOS 这个聊天应用里写一套 QQ 皮肤 CSS。请帮我修改下面这份默认 CSS，做成 ___（描述你的需求）___ 的风格。

要求：
1. 所有选择器必须以 .bunny-qq-skin 开头
2. 主要通过覆盖 --qq-* CSS 变量来换色，不要破坏布局
3. 只输出 CSS 代码，不要其他解释

默认 CSS：
<<<这里粘默认 CSS>>>`;

// 头像框：透明 PNG 叠在头像上，通过 ::after 实现；通常只需填 URL，不写 CSS
// 若需微调框的覆盖范围，可覆盖以下规则
const DEFAULT_FRAME_CSS = `/* 头像框通过透明 PNG 图片 URL 实现，一般无需写 CSS。
   若需微调框的覆盖范围，可覆盖以下规则
   选择器必须以 .bunny-qq-frame-char 或 .bunny-qq-frame-user 开头 */

.bunny-qq-frame-char::after,
.bunny-qq-frame-user::after {
    inset: -10%;           /* 框比头像略大，负值=向外扩；调大让框更明显 */
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
}`;

const DEFAULT_FRAME_PROMPT = `我在 BunnyOS 这个聊天应用里给 QQ 头像框调 CSS。请帮我修改下面这份默认 CSS，做成 ___（描述你的需求）___ 的效果。

要求：
1. 选择器必须以 .bunny-qq-frame-char 或 .bunny-qq-frame-user 开头
2. 不要改变 ::after 的定位逻辑（position/content），只可调整 inset / background-size 等视觉属性
3. 只输出 CSS 代码，不要其他解释

默认 CSS：
<<<这里粘默认 CSS>>>`;

// 用户气泡：选择器以 .bunny-qq-bubble-user 开头
const DEFAULT_BUBBLE_USER_CSS = `.bunny-qq-bubble-user .qq-message {
    background: #effdde;               /* 气泡背景色 */
    color: #000000;                    /* 文字颜色 */
    border-radius: 16px 16px 5px 16px; /* 右下角为收尾角 */
    padding: 7px 12px 8px;
    box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08);
}`;

// 角色气泡：选择器以 .bunny-qq-bubble-char 开头
const DEFAULT_BUBBLE_CHAR_CSS = `.bunny-qq-bubble-char .qq-message {
    background: #ffffff;               /* 气泡背景色 */
    color: #000000;                    /* 文字颜色 */
    border-radius: 16px 16px 16px 5px; /* 左下角为收尾角 */
    padding: 7px 12px 8px;
    box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.08);
}`;

const DEFAULT_BUBBLE_PROMPT = `我在 BunnyOS 这个聊天应用里写一套 QQ 气泡 CSS。请帮我修改下面这份默认 CSS，做成 ___（描述你的需求）___ 的风格。

要求：
1. 所有选择器必须以 .bunny-qq-bubble 开头（user 款的还要加 .bunny-qq-bubble-user，char 款加 .bunny-qq-bubble-char）
2. 不要改变气泡内部子元素的布局（图片、表情、转账卡等保留原样）
3. 只输出 CSS 代码，不要其他解释

默认 CSS：
<<<这里粘默认 CSS>>>`;

const DEFAULT_AVATAR_HINT = '头像走图片直链，不需要写 CSS。在编辑页分别填入角色头像 URL 和用户头像 URL 即可。';
const DEFAULT_BG_HINT     = '聊天背景走图片直链，在三个点 → 聊天设置面板里上传，不用写 CSS。';
