# QQ 美化系统 + 钱包系统 · 实施计划

> 给接手的 AI 看的。完整需求 + 现状 + 落地步骤。本文件用 UTF-8。

## 0. 开发路线全景图

```
里程碑1 钱包闭环      ─┐
里程碑2 美化库后端+商城骨架 ─┤  这两块是地基，必须先做
里程碑3 头像框跑通    ─┘  （样板模块，跑通后照搬）
        ↓
里程碑4 套到 char + 三个点菜单
        ↓
里程碑5 复制到其他 4 个模块（气泡/背景/头像/皮肤）
        ↓
里程碑6 转账闭环（独立条线，可在里程碑3之后任意时间插队）
        ↓
里程碑7 教程 + 图床 + 全局背景
        ↓
里程碑8 对话框管理 + 收尾
```

**每个里程碑 = 一次 commit + 一次 VPS 推送**。整套预计 8 次推送完成。

## 0.1 接手须知

- 项目根：`D:\OneDrive\BunnyOS`
- 调试：`npm start` → `http://localhost:3000/index.html`
- 改完后端必须重启 `node server.js`
- 静态检查：`node --check server.js`、`node --check apps/QQ/scripts/<file>.js`
- 所有用户决策已在第 1 节锁死，不要再回去问；只有第 7 节明确标了"待定"的可以问

## 0.2 接手协议（每个会话怎么开始、怎么结束）

**开始时**：
1. 读本文件 §0.3 进度看板，找到下一个待办里程碑
2. 读本文件 §0.4 必读文件清单里列的几份代码
3. 跟用户确认"我开始做里程碑 N"
4. 严格按 §8 对应 Step 顺序做，每完成一个 Step 在文档里打勾

**结束时**（一个里程碑做完）：
1. 跑该里程碑的"验证"节点确认没问题
2. 跑 `node --check` 静态检查所有改动文件
3. **在 §0.3 进度看板里把状态改成"完成"并填 commit hash 占位**
4. 提议用户：
   ```powershell
   cd D:\OneDrive\BunnyOS
   .\publish-github.cmd "里程碑N: <做了什么>"
   ```
   推送后 VPS 会自动 pull + restart（见 README.md "GitHub 自动更新 VPS"）
5. 回填真实 commit hash 到 §0.3 看板
6. **不开启下一个里程碑**，让用户决定下次会话再开

> 一个会话不要同时开两个里程碑。token 不够时容易半途而废留下脏状态。

## 0.3 进度看板

| 里程碑 | 状态 | commit | 备注 |
|---|---|---|---|
| M1 钱包闭环 | 完成 | `ed7b464`, `dccb4d5` | S1-S4 + S33/S34/S35 部分前置：红包扣款 + 10轮自动退回 + 视觉徽章 |
| M6 转账闭环 · S33 status字段 | 完成 | `dccb4d5` | 顺势在 M1 做了 |
| M6 转账闭环 · S34 发送时扣款 | 完成 | `dccb4d5` | 顺势在 M1 做了 |
| M6 转账闭环 · S35 10轮自动退回 | 完成 | `dccb4d5` | 顺势在 M1 做了 |
| M6 转账闭环 · S32 三段状态后缀 | 完成 | `51db1ea` | AI 语法解析 [🧧¥X\|note] 同时落地 |
| M6 转账闭环 · S36+S37 领取闭环 | 完成 | `ceca8f1` | 后端 receive 端点 + 前端点击领取 |
| M2 美化库后端+商城骨架 | 完成 | `7af2b5c` | S5-S10：beauties/char-beauty 端点 + #me-beauty 入口 + 5 tab 骨架 |
| M3 头像框跑通（样板模块） | 完成 | `0e406ca` | S11-S17：mockup + 槽位网格 + 新建/编辑/预览/选择删除全套；预览注入逻辑顺手接好 bubble/bg 字段供 M5 复用 |
| M4 套到 char + 三个点菜单 | 完成 | `bc9b80f` | S18-S23：#chat-more + #chat-settings-modal；applyCharBeauty 注入 4 个 style 节点；M4 只通头像框，气泡/背景在 M5 |
| 头像加回美化模块（决策反转）| 完成 | `c9d0456` | 公共库、成对(charUrl+userUrl)、5cc；char-beauty 加 avatarId；chat-render 优先用 pair |
| 数据迁移：carrot JSON 导入 | 完成 | `7eacb97` | `POST /api/qq/import-carrot`：表情包/头像框(按 char/user 拆)/头像对一键入库；主题与字体跳过；不扣 cc |
| 头像框拆 user/char 双选 | 完成 | `13a7c38` | char-beauty 拆 frameCharId/frameUserId；注入 .bunny-qq-frame-{char,user}::after 两条 |
| M5 气泡+背景应用 | 完成 | `da58d52` | 消息渲染加 .bunny-qq-bubble.bunny-qq-bubble-{user,char}；#chat-room 加 .bunny-qq-bg；applyCharBeauty 注入 bubble+bg CSS；面板下拉启用 |
| M5 皮肤全局应用 | 完成 | `8e856e6` | `GET/PUT /api/qq/skin`（写 settings.json.currentSkinId）；QQ.js 启动注入；皮肤槽位"应用"按钮；"预览"走全屏临时套用 + 退出浮窗；body 挂 .bunny-qq-skin |
| 数据迁移补字体/提示音 | 完成 | `4f7e304` | carrot 的 cip_global_fonts_v1 + cip_notif_sounds_v1 + 相关激活字段统一存到 settings.json.imported_carrot 备查（暂无 UI 暴露） |
| 气泡编辑模式 UI 优化 | 完成 | `c0a69a8` | textarea 直接嵌进气泡（透明无边框继承字号），✓/× 圆按钮浮气泡右下；textarea 跟字数自适应高度 |
| 聊天背景改 per-char 上传 | 完成 | `3b273fe` | 美化商城删 backgrounds tab；三个点面板用 full-width 上传块；char-beauty 加 customBackgroundUrl；存 data/qq/char-backgrounds/<cid>.<ext> 覆盖式；POST/DELETE 两端点 |
| 聊天设置顶部 token 估算 | 完成 | `63a7894` | 新端点 /api/qq/chat-tokens/:cid 拼 system+history 估算（沿用酒馆 fallback 思路：CJK 1tk + 其余 4 字/tk） |
| 图片历史回放 / 仅发最新 | 完成 | `f23fb27` | 后端存盘剥 image dataURL（chat 文件不爆），但保留 client_image_id；前端发图同步写 localStorage qq:img:<id>；prompt 端早已是"仅发最新一张" |
| 图片缓存升级 IndexedDB | 完成 | `8f74977` | 新 image-cache.js 封装 IDB put/get/delete/clear/stats；media.js 改写 IDB；chat-render 渲染后异步预加载；启动时迁移老 localStorage qq:img:* |
| 存储配置加缓存管理 | 完成 | `59d88e0` | 聊天图片缓存（IDB 统计 + 清空）+ 浏览器站点缓存（caches API 清空）；推荐定期清前者 |
| carrot 导入去重报告 | 完成 | `bf3e0e4` | stickerSkipped/frameSkipped/avatarSkipped 计数；去重逻辑（按 URL 或 char+user pair）一直在做，只是报告里没显示 |
| 表情包管理 UI | 完成 | `bff7294` | +号旁加铅笔进编辑模式；点合集弹 confirm 删整组；打开合集后每张贴纸右上角 ✕ 直接删；编辑模式抖动提示 |
| M7 图床代理 | 完成 | `62cb42a` | POST /api/upload/image-host（catbox + 自定义 endpoint 代理 fallback，三段顺序：lastWorking → primary → catbox）；设置 App 加图床配置；美化编辑页头像/头像框 URL 字段旁加"上传图床"按钮 |
| 图床错误透传 + 表情包布局 v1 | 完成 | `aa938de` | 502 弹完整 detail+hint；strip 横向滚动；贴纸网格 4 列 |
| 图床 / Jina 教程升级模态 | 完成 | `51e28d1` | 复用 #asr-help-modal；图床 section 加感叹号弹 catbox+imgbb+smms 三家配置；Jina alert 改 modal |
| 自定义提示音改造 + carrot 字体合并 | 完成 | `00edcd8` | 新声音库（URL/试听/保存命名/删除）+ 成功/失败下拉；启动合并 imported_carrot.notifSounds/fonts 到 savedSounds+beautyPresets.font |
| 表情包细节 + ✕ 延迟修复 | 完成 | `5ec518f` | 4 列 + !important + min-width:0；进编辑模式不再 innerHTML 重渲，原地加 class + 插 ✕；抖动 0.4s→0.25s |
| M7 教程 + 图床 + 全局背景 | 未开始 | — | 含 S40 需先确认 §7.3 |
| 编辑气泡 v2 + README/计划同步 | 完成 | `ebbe9d9` | textarea field-sizing:content；JS 兜底；README 加美化/钱包/图床/迁移 API + 下一步指向 M8 |
| M8 对话框管理 | 完成 | `de3db72` | 三端点：DELETE messages 清空 / PATCH hidden / DELETE chat（含 char-beauty + 背景文件清理）；聊天列表过滤 hidden + 顶部"显示隐藏聊天"toggle |

状态枚举：`未开始 / 进行中 / 完成`。完成时 commit 列填 `git rev-parse --short HEAD` 拿到的 hash。

## 0.4 必读文件清单（按里程碑列，按需读）

**所有里程碑通读**：
- `README.md` 全文（特别是 §装配链路、§关键数据模型、§VPS 部署）
- 本文件 §1（已锁死的需求）

**M1 钱包**：
- `apps/QQ/index.html` 行 167-200（"我"页 HTML 结构）
- `apps/QQ/styles.css` 搜 `.qq-me-action`（"我"页按钮样式）
- `apps/QQ/scripts/navigation.js` 全文（页面切换机制）
- `server.js` 行 1-100（看 const、setup 风格）+ 搜 `/api/settings` 的 GET/POST 实现作模板

**M2 美化库**：
- `server.js` 搜 `/api/qq/characters` 端点（角色卡 CRUD 是最相近的模板）
- `apps/QQ/scripts/api.js` 全文

**M3 头像框样板**：
- `apps/QQ/scripts/contacts.js` 全文（看现有的列表渲染、点击切页风格）
- `apps/QQ/styles.css` 搜 `.qq-avatar`

**M4 三个点菜单**：
- `apps/QQ/index.html` 搜 `qq-topbar`（聊天页顶栏 HTML）
- `apps/QQ/scripts/chat-render.js` 全文
- `apps/QQ/scripts/events.js` 全文

**M6 转账**：
- `server.js` 行 2013-2050（qqMessageToText）+ 行 598 附近（预设说明）
- `apps/QQ/scripts/media.js` 行 140-170（sendTransfer）
- `apps/QQ/scripts/chat-render.js` 行 160-180（transfer 渲染）

**M7 图床 + 设置**：
- `apps/settings/index.html` + `apps/settings/settings.js`（看现有 section 风格）
- `server.js` 搜 `/api/assets/upload`（已有上传端点作模板）

**M8 对话框管理**：
- `apps/QQ/scripts/contacts.js` 全文

## 0.5 VPS 推送约定（出自 README）

每个里程碑完成后必须推送，命令：

```powershell
cd D:\OneDrive\BunnyOS
.\publish-github.cmd "里程碑N: <一句话描述>"
```

publish-github.cmd 会自动 git add + commit + push 到 origin/main，GitHub webhook 触发 VPS 拉取 + `npm install` + `pm2 restart`。

**注意事项**：
- `data/`、`settings.json`、`node_modules/` 在 `.gitignore` 里，不会被提交，本地的钱包/美化数据不会同步到 VPS（VPS 会自己跑生成）
- 不要往代码里硬编码任何 key 或 token
- 推送失败时**不要**用 `--force`；让用户介入

---

## 1. 已确认的需求（不可改动）

### 1.1 钱包
- 全局财务文件 `data/wallet.json` → `{ balance: number, updated_at: number }`
- 首次启动自动初始化 **20000cc**（carrot coin）
- 余额不可负数：不足时拒绝创建美化、拒绝大额转账
- AI **不感知** user 余额（提示词中不暴露）

### 1.2 转账机制
现有 transfer 消息结构（见 `apps/QQ/scripts/media.js:150` 和 `chat-render.js:164`）：
```js
{ role: 'user'|'assistant', type: 'transfer', amount, currency, note, text }
```
需要扩展字段：`status: 'pending'|'received'|'returned'`、`settled_at: number`

| 方向 | 立即动账 | 领取/退回 | AI 提示词标注 |
|---|---|---|---|
| user → char | 发送时立即 -user 余额 | **10 轮 user-char 交互**后仍 pending → 自动 +回 user 余额、status=returned | "未领" / "已自动退回" |
| char → user | 不动钱（status=pending） | user 点气泡上的"领取"按钮 → +user 余额、status=received | "未领" / "已领" |

**"1 轮 user-char 交互"定义**：从该 transfer 消息往后数，每出现一次"user 至少 1 条消息 + 紧接着 char 至少 1 条消息"算 1 轮。reply_group 内多气泡只算 char 那一侧的 1 次。退回检测时机：每次新增消息后扫描所有 pending user→char transfer，若已满 10 轮则结算。

提示词暴露方式：`qqMessageToText`（**在 `server.js:2013` 附近**，现有渲染 `[🧧¥10|备注]`，无备注时是 `[🧧¥10|]`）。改为**三段**：`[🧧${currency}${amount}|${note}|${status}]`，无备注则中间为空但保留两个分隔符。

| 场景 | 渲染 |
|---|---|
| char→user pending  | `[🧧¥10\|我很喜欢你\|未领]` 或无备注 `[🧧¥10\|\|未领]` |
| char→user received | `[🧧¥10\|我很喜欢你\|已领]` |
| user→char pending  | `[🧧¥10\|生日快乐\|未领]` |
| user→char returned | `[🧧¥10\|生日快乐\|已自动退回]` |

注意：备注、状态分别是独立的第 2、第 3 段。AI 端的预设（`server.js:598` 那段说明）也要同步改成三段说明。

### 1.3 商城入口
- QQ "我"页里已有 `#me-wallet` 按钮（`apps/QQ/index.html:179`）——绑钱包页
- **在它旁边新增** `#me-beauty` 按钮 → 美化商城页
- 钱包页和美化页都是 QQ App 内的子页（不是新 App，不是设置 App 内）
- 美化页顶部常驻一条余额状态条

### 1.4 商城结构
5 个模块 tab：**皮肤 / 头像 / 头像框 / 气泡 / 背景图**（顺序如左）。

> 头像归属变更历史：2026-06-21 决策剔出 → 2026-06-22 决策反转加回（公共库、成对 charUrl+userUrl、5cc，换也成对换）。

| 模块 | 创建价 | 顶部预览 | 数据结构单元 | 编辑器 UX |
|---|---|---|---|---|
| 皮肤 | 20cc | 槽位"应用 / 预览"按钮：预览=全屏临时套 + 退出浮窗；应用=写入全局 `currentSkinId` | 单 CSS | textarea |
| 头像 | 5cc | mockup（直接换两张 `<img src>`） | **成对 `charUrl + userUrl`**（公共库共享，换也成对换） | 两个 URL 输入框 |
| 头像框 | 5cc | mockup | **图片直链 `url`**（透明 PNG，覆盖在头像上一层；不写 CSS）。**应用时拆 char/user 双选**（`.bunny-qq-frame-char/-user::after` 两条 CSS） | URL 输入框 |
| 气泡 | 5cc | mockup | **userCss + charCss 两个字段** | 两个 textarea |
| 背景图 | 0cc | 无（用户决策：背景不需要预览） | 上传文件，**覆盖式存到 `data/qq/beauty-backgrounds/<id>.<ext>`**（同 id 旧文件先删，仿设置 App 的 `removeBackgroundSlot`），写回 `url` | `.wallpaper-pick` 缩略按钮；**无命名、无预览图字段** |

每模块内自上而下：
1. **顶部 mockup 预览**（皮肤除外，是按钮）。mockup 是固定布局的虚拟聊天场景（含 user/char 头像、reply_to 一例、文本气泡若干、转账气泡示例），实时套用"当前选中槽位"的 CSS / 图。
2. **默认折叠的"美化教程"** 卡片：
   - 一段说明文字（"把以下 CSS 和提示词扔给 AI，让它帮你改"）
   - **默认 CSS 一键复制**按钮（每模块各有一份预制底稿，见第 4 节）
   - **推荐提示词一键复制**按钮，模板见 1.7
3. **槽位网格**：
   - 第一个永远是不可删的"默认"槽位（指向 QQ 原生样式 / 空 CSS）
   - user 自创的槽位
   - 末尾一个 "+" 新增按钮
4. **右上角"选择"按钮** → 当前模块内进入多选删除模式（不跨模块）

**槽位卡**（统一格式）：
```
┌─────────────┐
│  预览图      │ ← user 上传图床的直链；空则显示美化名首字
│             │
├─────────────┤
│ 美化名       │
├─────────────┤
│[预览] [编辑] │ ← 「预览」=把这套套到顶部 mockup；皮肤的「预览」=全屏切一圈
└─────────────┘
```

**编辑页**（统一格式）：
- 预览图直链输入框 + "上传图床"按钮（见 1.8）
- 美化名输入框
- CSS textarea（气泡为两个并排：user CSS / char CSS）
- 所有字段 debounce 500ms 自动 PUT 保存

**删除流程**：点删除 → 弹窗"该美化正在被 X 个 char 使用：[名字1, 名字2...]，删除后他们将回归默认。是否继续？" → 确认 → 删除并解绑（char-beauty.json 里把指向该 id 的字段置 null）→ **不退币**

### 1.5 美化所有权与应用
美化是 **user 个人共享库**：1 套可多 char 共用，改 CSS 所有应用 char 同步生效。

**两个文件**：
- `data/qq/beauties.json` → 美化库本体
  ```json
  {
    "skins":      [{ "id", "name", "preview", "css" }],
    "avatars":    [{ "id", "name", "preview", "charUrl", "userUrl" }],
    "frames":     [{ "id", "name", "preview", "url" }],
    "bubbles":    [{ "id", "name", "preview", "userCss", "charCss" }],
    "backgrounds":[{ "id", "name", "preview", "url" }]
  }
  ```
  注：
  - `avatars` 是**成对**（charUrl + userUrl），公共库共享，2026-06-22 决策。
  - `frames` 用 `url`（透明 PNG 直链），前端通过 `.bunny-qq-frame-char/-user::after { background-image: ... }` 叠在头像上。
  - `backgrounds` 用 `url`，走上传端点覆盖式存盘到 `data/qq/beauty-backgrounds/<id>.<ext>`。
  每类的第一个永远是 `id: "default"`，name 是"默认"，css/url 为空字符串，不可删，不可编辑名字。

- `data/qq/char-beauty.json` → char 的选择
  ```json
  {
    "<characterId>": {
      "avatarId":      "default",
      "frameCharId":   "default",
      "frameUserId":   "default",
      "bubbleId":      "default",
      "backgroundId":  "default"
    }
  }
  ```
  缺省视为全 default。**头像框拆 char/user 两个槽位**（2026-06-22 决策）；旧 `frameId` 字段读时兼容回填给两侧。

- `data/qq/beauty-backgrounds/<beautyId>.<ext>` → 背景图实际文件，**每次上传覆盖同 id 旧文件**，不在后端累积。上传端点 `POST /api/qq/beauties/backgrounds/:id/image` body `{dataUrl}`，参考设置 App 背景的 `removeBackgroundSlot` 写法。

**应用入口**：进入 char 聊天 → 标题栏右侧新增三个点按钮（**目前 QQ 聊天页没有这个按钮，需要从零加**） → 弹出"聊天设置"面板，含：
- 三个紧凑下拉：头像框 ↓ / 气泡组 ↓ / 聊天背景 ↓ （头像目前在聊天页用的是角色卡 avatar；这里的"头像"槽位是给 user 头像吗？← **看 7.1**）
- 分割线
- 操作按钮：清空聊天记录 / 隐藏聊天 / 删除聊天

**全局皮肤**：商城里"应用"皮肤是即时套到 QQ App 整体；同时存 `data/qq/settings.json` → `currentSkinId`。

**全局背景**：设置 App 美化页里另设一个"QQ 聊天全局背景"选择器，存 `data/qq/settings.json` → `globalBackgroundId`。**优先级**：char 设置的背景 > 全局背景 > 无。

### 1.6 CSS 作用域
每模块各自的包裹类，由 BunnyOS 在 DOM 上挂好，user 写 CSS **必须以这些类开头**（不自动加前缀）：

| 模块 | 包裹类 | 注入位置 | 注入方式 |
|---|---|---|---|
| 皮肤 | `.bunny-qq-skin` | `<body>` 上（QQ.js 启动时 add） | user 写 CSS；启动从 `/api/qq/skin` 拉一次 |
| 头像（成对） | — | 渲染时直接换 `<img src>`（chat-render.js） | 不通过 CSS，pair.charUrl/userUrl 直接进 src |
| 头像框（char） | `.bunny-qq-frame.bunny-qq-frame-char` | `.qq-message-row.assistant` 的头像 wrapper | **不写 CSS**：注入 `.bunny-qq-frame-char::after { background-image: url(...) }`；base 规则在 `styles.css` 全局 |
| 头像框（user） | `.bunny-qq-frame.bunny-qq-frame-user` | `.qq-message-row.user` 的头像 wrapper | 同上，注入 `.bunny-qq-frame-user::after { ... }` |
| 气泡（user） | `.bunny-qq-bubble.bunny-qq-bubble-user` | 渲染后 post-process 加到每个 user 行的 `.qq-message` 上 | user 写 CSS |
| 气泡（char） | `.bunny-qq-bubble.bunny-qq-bubble-char` | 同上，char 行 | user 写 CSS |
| 背景 | `.bunny-qq-bg` | `#chat-room` 容器上（index.html 静态） | **不写 CSS**：单一槽位上传后端覆盖式存盘，注入 `.bunny-qq-bg { background-image: url(...) }` |

气泡内部子元素（reply_to、表情、图片、转账、语音、+系统+、收藏星）走原逻辑；美化 CSS 只控气泡外壳样式（背景、边框、圆角、阴影、文字色等）。

**CSS 注入实现**：动态创建 `<style id="bunny-beauty-skin">` 等节点塞到 `<head>`，根据 char 切换时换内容。每个模块一个独立 `<style>` 节点。

### 1.7 美化教程模板
每个模块的教程卡片里准备两段一键复制：

**默认 CSS**：见第 4 节内置底稿。

**推荐提示词模板**（中文，气泡模块为例）：
```
我在 BunnyOS 这个聊天应用里写一套 QQ 气泡 CSS。请帮我修改下面这份默认 CSS，做成 ___（描述你的需求）___ 的风格。

要求：
1. 所有选择器必须以 .bunny-qq-bubble 开头（user 款的还要加 .bunny-qq-bubble-user，char 款加 .bunny-qq-bubble-char）
2. 不要改变气泡内部子元素的布局（图片、表情、转账卡等保留原样）
3. 只输出 CSS 代码，不要其他解释

默认 CSS：
<<<这里粘默认 CSS>>>
```

其他模块改对应类名。

### 1.8 图床
后端代理多图床上传（绕开浏览器 CORS）：

**新端点 `POST /api/upload/image-host`**（multipart/form-data）：
1. 读 `settings.json` 里 `imageHost.order` 字段（数组，依次尝试，缺省 `['catbox', 'postimages']`）
2. 当前可用顺序：上次成功的优先（`imageHost.lastWorking`），仿 ASR 的 `asr_lastWorking` 模式
3. 调对应图床的 anonymous 上传 API：
   - catbox：`POST https://catbox.moe/user/api.php`，字段 `reqtype=fileupload`, `fileToUpload=<file>`
   - postimages：（查 API，备用）
   - 自定义：从 `settings.json.imageHost.custom` 拿 endpoint + key
4. 成功返回 `{ url: "<直链>" }`；全失败返回 `{ error: '所有图床均失败', detail }`

**设置 App** 里"通用"或"美化"页加一节"图床配置"：图床顺序拖拽 / 自定义端点表单。

**前端**：每个有预览图字段的编辑页都有一个"上传图床"按钮：选文件 → POST 该端点 → 回填直链。同时保留"直接贴直链"输入框作为兜底。

### 1.9 对话框管理（顺便上）
聊天页右上三个点菜单里加：
- **聊天设置**（即 1.5 中的美化下拉）
- **清空聊天记录**：仅清 messages 数组，不删聊天本身
- **隐藏聊天**：在 chat 数据里加 `hidden: true`，联系人列表过滤掉，从"我"页或某入口可恢复
- **删除聊天**：删 chat 文件 + 从联系人列表移除

需要在联系人列表加一个"显示隐藏的聊天"开关（顶栏或下拉里）。

---

## 2. 现状速查（事实，已核实）

- `apps/QQ/index.html:179` 已有 `<button id="me-wallet">钱包</button>` 但**没有 click handler**（grep 不到 `me-wallet` 在 js 里有绑定）。需要新建钱包页 + 绑定。
- `apps/QQ/index.html:90` 已有 `#btn-transfer` 按钮 + `#transfer-modal` 弹窗（449 行）。
- 现有 transfer 消息字段：`amount, currency, note, text`（见 `media.js:157`）。**没有 status 字段**，需要 schema 扩展。
- 渲染在 `chat-render.js:164`，目前不展示"领取"按钮，需要加。
- **QQ 聊天页没有标题栏三个点按钮**，需要从零加（HTML + CSS + 事件）。
- `server.js` 2398 行；transfer 在 `qqMessageToText` 里渲染成 `[🧧¥10|备注]`，搜 `🧧` 定位。
- `data/qq/settings.json` 现有字段：`currentPersonaId / currentPromptPresetId / globalWorldbookIds`。
- 没有 `data/qq/groups.json` 之外的 wallet/beauty 相关文件。
- 设置 App 美化页：`apps/settings/index.html` 的 beauty 部分；图床配置应加在这里。

---

## 3. 实施步骤（按依赖顺序）

### Phase A · 后端基础（先打地基）

**A1. 钱包后端**
- 新建 `data/wallet.json` 自动初始化逻辑（server 启动时若不存在则写 `{balance: 20000, updated_at: Date.now()}`）
- 新端点：
  - `GET /api/wallet` → 返回当前余额
  - `POST /api/wallet/adjust` body `{delta, reason}` → 内部用（不暴露给 AI）；返回新余额；delta 会让 balance<0 时拒绝
- SSE 广播：复用现有 `/api/settings/events` 还是新开 `/api/wallet/events`？建议**复用**（在原 SSE 加一个 `wallet-updated` 事件类型），避免多连接。

**A2. 美化库后端**
- 新建 `data/qq/beauties.json`，server 启动时若不存在则写默认骨架（5 个数组各含 1 个 `id: "default"` 不可删项）
- 新端点（全部 no-store）：
  - `GET /api/qq/beauties` → 全量
  - `GET /api/qq/beauties/:type` → 单类（type ∈ skins/avatars/frames/bubbles/backgrounds）
  - `POST /api/qq/beauties/:type` body `{name}` → 创建空白槽位；**自动扣对应价格**（5/0/5/5/20）；若余额不足返 402；返回新 id
  - `PUT /api/qq/beauties/:type/:id` body `{name?, preview?, css?, userCss?, charCss?, url?}` → 部分更新（不收费）
  - `DELETE /api/qq/beauties/:type/:id` → 拒绝删 `default`；删后扫 `char-beauty.json` 把指向该 id 的字段置 "default"；不退币
- 价格表写常量在 server.js 顶部

**A3. char 美化绑定后端**
- 新建 `data/qq/char-beauty.json`（空对象起步）
- 新端点：
  - `GET /api/qq/char-beauty/:characterId` → 该 char 配置（缺省返全 default）
  - `PUT /api/qq/char-beauty/:characterId` body `{avatarId?, frameId?, bubbleId?, backgroundId?}` → 部分更新

**A4. transfer 改造**
- `qqMessageToText` 中按 1.2 表加 status 后缀
- 新增「领取/退回结算」逻辑：每次 `POST /api/qq/chats/:characterId` 写入消息后，扫描所有 pending user→char transfer，按"轮"判定是否到 10 轮，到了改 status=returned + 调钱包 +回
- 新端点 `POST /api/qq/chats/:characterId/transfer/:messageId/receive`（user 领取 char→user 红包）：把 status=received + 调钱包 +
- 旧消息无 status 字段视为 received/closed，不再结算

**A5. 图床代理**
- `POST /api/upload/image-host`（见 1.8）
- 用 `https-proxy-agent` 已在依赖里（README 提到），catbox 的 form-data 提交可用 node-fetch + form-data 包，或直接 https 模块

### Phase B · 美化商城前端

**B1. "我"页新按钮**
- 在 `apps/QQ/index.html` 的 `#me-wallet` 旁边加 `<button id="me-beauty">美化</button>`，CSS 仿现有 `.qq-me-action`
- 在 `apps/QQ/scripts/events.js` 或新建 `apps/QQ/scripts/beauty.js` 注册 click handler

**B2. 钱包页**
- 新 view container `<div class="qq-wallet-view hidden">`，包含余额数字 + 一段说明
- 给 `#me-wallet` 加 handler 切到这个 view
- 复用现有 navigation.js 的页面切换机制（参考 `navigateTo` 之类函数）

**B3. 美化商城页骨架**
- 新 view container `<div class="qq-beauty-view hidden">`
- 顶部：返回按钮 / 标题"美化商城" / 余额状态条 / 右上"选择"按钮
- 5 个 tab 横向切换：皮肤 / 头像 / 头像框 / 气泡 / 背景图
- 每个 tab 是一个 module panel 组件，渲染：mockup 区 / 教程卡 / 槽位网格

**B4. Mockup 组件**
- 一段固定 HTML 模拟聊天场景：1 张 char 头像 + 1 条 char 文本气泡 + 1 张 user 头像 + 1 条 user 文本气泡 + 1 条转账气泡 + 1 条 reply_to
- 容器加上所有 5 个包裹类（`.bunny-qq-skin.bunny-qq-bg`...）让所有美化 CSS 都能影响到
- 选中某个槽位时，把该槽位的 CSS 注入到 mockup 范围的 `<style id="mockup-preview-xxx">` 标签里

**B5. 槽位网格 + 编辑页**
- 网格用 CSS grid；卡片宽 100~120px
- 编辑页用全屏覆盖式 panel（仿 prompt-manager 风格）
- textarea 自动保存：onInput → debounce 500ms → PUT

**B6. 多选删除**
- 点"选择"切到选择模式：每个卡片左上角出现 checkbox，底部出现"删除选中"按钮
- 删除逐个调 DELETE 端点，每个删之前弹"X 个 char 在用"确认（或集中确认）

### Phase C · char 应用美化

**C1. 聊天页三个点按钮**
- 在聊天 view 的标题栏右侧加 `<button id="chat-more">⋯</button>`
- 弹出 "聊天设置" 面板（slide-in 或弹窗，仿 message-menu 风格）

**C2. 聊天设置面板**
- 三个 `<select>`：从 beauties.json 拉对应类的所有项填 option，当前选中读 char-beauty.json
- onChange → PUT char-beauty + 立即把对应 `<style>` 节点内容换成新 CSS
- 下方按钮：清空记录 / 隐藏 / 删除（按 1.9）

**C3. CSS 注入器**
- 在 QQ App 加载时建 5 个 `<style>` 节点（id 为 `bunny-style-skin / -avatar / -frame / -bubble / -bg`）
- 进入某 char 聊天时：读该 char 的 char-beauty，把对应美化项的 CSS 塞到相应 `<style>` 里；头像 / 背景是图片直链则改 DOM 属性而不是 CSS
- 切 char 或退出聊天时清空（皮肤除外，皮肤是全局）

**C4. DOM 加包裹类**
- 给 `apps/QQ/index.html` 的 `<body>` 加 `class="bunny-qq-skin"`
- 改 `chat-render.js` 渲染消息时给 `.qq-message` 加 `bunny-qq-bubble` + `bunny-qq-bubble-user/-char`
- 给头像 wrapper 加 `bunny-qq-frame`
- 给 `.qq-chat-view` 加 `bunny-qq-bg`

### Phase D · 转账闭环

**D1. char→user 领取按钮**
- 改 `chat-render.js:164` 的 transfer 渲染：char→user 且 status=pending 时显示"未领取"角标 + 点气泡触发领取
- 调 `POST /api/qq/chats/:characterId/transfer/:messageId/receive`
- 接口返成功后重渲消息

**D2. user→char 自动退回**
- 在后端 messages 写入端点里实现（A4）
- 前端无需特殊处理，重拉聊天记录即可显示新状态

**D3. transfer 发送时扣钱**
- 改 `media.js:sendTransfer`：在 appendChatMessage 之前先 `POST /api/wallet/adjust {delta: -amount}`，失败（余额不足）就 alert 并中断
- 写入消息时带 `status: 'pending', settled_at: null`

### Phase E · 图床 + 设置

**E1. 设置 App 图床配置区块**
- 在 `apps/settings/index.html` 加 section
- 顺序拖拽 + 自定义 endpoint
- 保存到 `settings.json.imageHost`

**E2. 编辑页"上传图床"按钮**
- 复用一个函数 `uploadToImageHost(file)`，所有需要预览图的编辑页都调

### Phase F · 收尾

- 余额 SSE：钱包页 + 商城余额条订阅 `wallet-updated`
- 全屏皮肤预览：点皮肤槽位的"预览"按钮 → 临时把皮肤 CSS 应用到全局 + 显示一个"退出预览"浮窗
- 默认槽位的"编辑"按钮：禁用 / 提示"默认不可编辑"
- 写测试聊天验证 mockup 渲染对齐
- 改 README.md 的 "下一步" / API 速查 / 文件地图

---

## 4. 内置默认 CSS 底稿（教程"一键复制"用）

需要扒现有 `apps/QQ/styles.css` 抽出与各模块对应的样式，存成 5 份字符串常量放在 `apps/QQ/scripts/beauty-defaults.js`：

- `DEFAULT_SKIN_CSS`：QQ App 整体配色 / tab / 顶栏（约 80~150 行）
- `DEFAULT_FRAME_CSS`：头像圆角、阴影、外框（约 20 行，可能是空底稿+示例注释）
- `DEFAULT_BUBBLE_USER_CSS` + `DEFAULT_BUBBLE_CHAR_CSS`：从 `.qq-message` 系列规则抽（约 40~80 行）
- `DEFAULT_BG_CSS`：背景图模块本身不用 CSS，跳过

每段底稿前面加注释说明用了哪些类，让 AI 看得懂。

抽取方法：在 styles.css 里搜 `.qq-message` `.qq-avatar` `.qq-topbar` 等，复制相关规则段，把选择器改成 `.bunny-qq-bubble-user` 等。

---

## 5. 提示词层面的改动

`server.js` 中 `qqMessageToText`（搜 `🧧` 定位）：
- transfer 渲染按 1.2 表加状态后缀
- 不要在任何 prompt 段落里暴露 user 当前余额

---

## 6. 文件清单

新建：
- `data/wallet.json`（启动时自动生成）
- `data/qq/beauties.json`（启动时自动生成）
- `data/qq/char-beauty.json`（启动时自动生成）
- `apps/QQ/scripts/beauty.js` — 美化商城前端逻辑
- `apps/QQ/scripts/wallet.js` — 钱包前端逻辑
- `apps/QQ/scripts/beauty-defaults.js` — 默认 CSS 底稿常量
- `apps/QQ/scripts/chat-settings.js` — 三个点菜单 + 聊天设置面板

修改：
- `server.js` — 端点 A1~A5、qqMessageToText
- `settings.json` — 加 imageHost 字段（手动加初值或代码兜底）
- `apps/QQ/index.html` — 美化按钮、商城/钱包 view、三个点按钮、聊天设置面板 HTML
- `apps/QQ/styles.css` — 商城/钱包/聊天设置面板样式 + 5 个包裹类的默认空规则
- `apps/QQ/scripts/events.js` — 新按钮事件绑定
- `apps/QQ/scripts/chat-render.js` — 加包裹类、transfer 领取按钮
- `apps/QQ/scripts/media.js` — sendTransfer 先扣钱
- `apps/QQ/scripts/navigation.js` — 新增钱包/商城视图路由
- `apps/QQ/scripts/contacts.js` — 隐藏聊天过滤、删除聊天处理
- `apps/settings/index.html` + `apps/settings/settings.js` — 图床配置 + 全局 QQ 背景
- `README.md` — 同步新 API 和文件结构

---

## 7. 待用户决策（不要替他决定）

### 7.1 头像模块的归属 · 已决（2026-06-21）
**头像不算美化模块**。从 BEAUTY_TYPES / char-beauty / 商城 tab 中全部移除。用户若要换头像走原有的角色卡 / 人设 avatar 流程。

### 7.2 隐藏聊天的恢复入口
1.9 提到"显示隐藏的聊天"开关。放在哪？
- 联系人列表顶部下拉？
- "我"页里另开一个"隐藏的聊天"入口？
- 长按联系人手势？

**默认按"联系人顶部菜单加 toggle"实施**；如有更好位置再问。

### 7.3 图床的具体备选
postimages 的免登录 API 不如 catbox 稳；是否要换成别的（如 0x0.st、imgbb 需 key 但稳定）？
**默认实现 catbox 单家 + 自定义 endpoint 兜底**；postimages 留接口位但不接，等用户决定。

---

## 8. 实际开做顺序（线性执行清单）

第 3 节是逻辑分组，**实际下手按这里走**。每个 Step 完成后应该是"能独立验证"的状态——不是攒一堆改动一起调。

完成一个 Step 就在前面打勾。Step 之间有明确依赖箭头，不要乱序。

### 里程碑 1 · 钱包能跑起来（最小闭环）

- [x] **S1** 改 `server.js`：启动时检查并初始化 `data/wallet.json`（balance: 20000）
- [x] **S2** `server.js` 加 `GET /api/wallet` + `POST /api/wallet/adjust`（含余额下限校验）
- [x] **S3** 新建 `apps/QQ/scripts/wallet.js` + 钱包弹窗 HTML（仿 persona-modal 样式）+ CSS
- [x] **S4** `#me-wallet` 绑 click → 打开钱包弹窗 → 拉 `/api/wallet` 显示余额

### 里程碑 2 · 美化库后端 + 商城骨架

- [x] **S5** `server.js`：启动时检查并初始化 `data/qq/beauties.json`（5 类各含 default 项）
- [x] **S6** `server.js`：加美化 CRUD 端点（GET 全量、GET 单类、POST 创建+扣费、PUT 更新、DELETE 解绑+不退费）
- [x] **S7** `server.js`：启动时检查并初始化 `data/qq/char-beauty.json`；加 GET/PUT 端点（顺手加 `GET /api/qq/char-beauty-usage/:type/:id` 给删除前的"X 个 char 在用"提示用）
- [x] **S8** 新建 `apps/QQ/scripts/beauty.js` + `apps/QQ/scripts/beauty-defaults.js`（先放空字符串占位）
- [x] **S9** index.html 加 `#me-beauty` 按钮 + `#beauty-modal` 骨架（顶部余额条 + 5 个 tab + 空 panel + "选择"占位）
- [x] **S10** 商城页 tab 切换 + 余额条（先轮询：开弹窗时拉一次 `/api/wallet`，SSE 留到 M8 S48）

### 里程碑 3 · 单个模块跑通（先做"头像框"，最简单）

> 选头像框先做，因为它就是一份 CSS、没有 user/char 双 CSS、没有图片直链复杂度。跑通后其他模块照搬。

- [x] **S11** 头像框 panel：渲染槽位网格（拉 `/api/qq/beauties/frames`）+ "+"按钮
- [x] **S12** "+" 按钮 → POST 创建 → 失败弹"余额不足" / 成功后槽位出现
- [x] **S13** 槽位点"编辑" → 全屏编辑页 `#beauty-editor`（名字 + 预览图 URL + CSS textarea）
- [x] **S14** 编辑页 debounce 500ms 自动 PUT 保存 + "已保存"指示
- [x] **S15** 顶部 mockup 组件：固定 HTML（user/char 头像 + 气泡），挂上 4 个包裹类（去头像后 4 个）
- [x] **S16** 选中槽位"预览" → 注入 CSS 到 `<style id="beauty-mockup-style">`（frames 走 css 字段；bubbles/backgrounds/skins 一并接好用于 M5）
- [x] **S17** "选择"多选模式 + 批量删除（先 `GET /api/qq/char-beauty-usage/:type/:id` 查使用情况，再弹 confirm，删后回到默认）

### 里程碑 4 · 套用到 char + 三个点菜单

- [x] **S18** 改 `apps/QQ/index.html`：聊天页"更多"按钮加 `id="chat-more"`，原有 SVG 不动
- [x] **S19** 新建 `apps/QQ/scripts/chat-settings.js`：点 #chat-more → 弹 `#chat-settings-modal`
- [x] **S20** 面板里头像框下拉（option 从 `/api/qq/beauties`、当前值从 `/api/qq/char-beauty/:id`）→ onChange 调 PUT
- [x] **S21** CSS 注入器 `applyCharBeauty(charId)`：建 `<style id="bunny-style-{skin,frame,bubble,bg}">` 四节点，写入当前 char 选中头像框的 `::after { background-image }`（M5 接气泡/背景）
- [x] **S22** index.html 把 `#chat-head-avatar` 包进 `.bunny-qq-frame` wrapper（聊天页标题头像）
- [x] **S23** 共享库语义：两个 char 选同一 frameId → 编辑同一记录 → 切回任意 char 进入即同步生效（applyCharBeauty 每次进入聊天都拉最新）

### 里程碑 5 · 复制模式到其他 4 个模块

- [x] **S24** 气泡模块：编辑页双 textarea（userCss + charCss）已在 M3 顺手做完；预览注入到 mockup
- [x] **S25** 气泡：chat-render.js 渲染后给所有 `.qq-message` 加 `bunny-qq-bubble` + `-user/-char`（统一 post-process）
- [x] **S26** 聊天设置面板加气泡下拉（onChange → PUT char-beauty.bubbleId → 重 apply）
- [x] **S27** 背景图模块：单一 full-width 块上传（用户决策 2026-06-22 反转，不要网格不要 +）；走 `POST /api/qq/beauties/backgrounds/:id/image` 覆盖式存盘
- [x] **S28** 聊天设置面板加聊天背景下拉；applyCharBeauty 注入 `.bunny-qq-bg { background-image: url(...) }`，`#chat-room` 挂上 `.bunny-qq-bg` 作用域
- [x] ~~**S29** 头像模块~~ → 改为：**头像加回美化模块成对版**（用户决策 2026-06-22 反转）。公共库、charUrl+userUrl、5cc；mockup 预览直接换 `<img src>`；char-beauty 加 avatarId
- [x] **S30** 皮肤模块：编辑页单 textarea；mockup 区改成"应用 / 预览"按钮；"预览"走全屏临时套用 + "退出预览"浮窗
- [x] **S31** 皮肤"应用"逻辑：`PUT /api/qq/skin` 写入 `data/qq/settings.json.currentSkinId`；QQ.js 启动 `loadGlobalSkin()` 注入到 `<style id="bunny-style-skin">`；body 挂 `.bunny-qq-skin`

### 里程碑 6 · 转账闭环

- [x] **S32** 改 `qqMessageToText`（server.js）：transfer 渲染加 status 后缀（见 §0.3 commit `51db1ea`）
- [x] **S33** 给 transfer 消息加 `status / settled_at` 字段；老数据兜底当 received 处理（见 §0.3 commit `dccb4d5`）
- [x] **S34** 改 `media.js:sendTransfer`：先 POST /api/wallet/adjust 扣钱，失败中断（见 §0.3 commit `dccb4d5`）
- [x] **S35** 服务端 messages 写入端点里加结算扫描：每次写入后扫所有 pending user→char transfer，按"1 轮"定义算够 10 轮就标 returned + +回 user（见 §0.3 commit `dccb4d5`）
- [x] **S36** 新端点 `POST /api/qq/chats/:characterId/transfer/:messageId/receive`（见 §0.3 commit `ceca8f1`）
- [x] **S37** chat-render.js 改 transfer 渲染：char→user 且 pending 显示"领取"按钮 → click 调 S36（见 §0.3 commit `ceca8f1`）

### 里程碑 7 · 教程 + 图床 + 全局背景

- [x] **S38** 提取现有 styles.css 的相关规则写入 `beauty-defaults.js`（5 个常量）
- [x] **S39** 每个模块 panel 加"美化教程"折叠卡 + 两个一键复制按钮
- [x] **S40** `server.js` 加 `POST /api/upload/image-host`：catbox 主选 + 自定义 endpoint fallback；`uploadToCatbox` 用 Node 18 native FormData + Blob，自定义支持 fileField/urlField/key
- [x] **S41** 设置 App 加图床配置 section（写入 settings.json.imageHost）：主用下拉 + 自定义 endpoint/key/fileField/urlField 四栏
- [x] **S42** 编辑页加"上传图床"按钮（头像 charUrl / userUrl、头像框 url；背景已是 per-char 直接上传，不需要图床）
- [ ] ~~**S43** 全局背景选择器~~ → 已废弃：背景改 per-char 上传，没有"全局背景"概念
- [ ] ~~**S44** CSS 注入器优先级~~ → 已废弃：同上

### 里程碑 8 · 对话框管理 + 收尾

- [x] **S45** 聊天设置面板分割线下三个按钮启用：清空 / 隐藏 / 删除
- [x] **S46** 后端：chat 加 `hidden`；`DELETE /api/qq/chats/:cid/messages`、`PATCH /api/qq/chats/:cid/hidden`、`DELETE /api/qq/chats/:cid`（删 chat 时清 char-beauty + 专属背景）
- [x] **S47** renderChats 过滤 `hidden`；顶部"显示隐藏聊天"toggle 自动出现（有隐藏才显，state.showHiddenChats）
- [ ] ~~**S48** SSE 广播 wallet-updated~~ → 暂缓：钱包当前是显式 fetch，没真正出现"多端同步漂移"，等真有需求再加
- [x] **S49** 待决项决策都已落回 §1.4/§1.5/§1.6/§7.1
- [x] **S50** README.md 已同步美化/钱包/图床/迁移 API + 下一步指向
- [ ] **S51** 跑 §9 验收清单（留给你手动验）

### 关键依赖（避免乱序）

```
S1-S2 ──► S3-S4 (钱包页)
S1-S2 ──► S5-S7 (美化库后端)
S5-S7 ──► S8-S10 (商城骨架)
S8-S10 + S15-S16 ──► S11-S17 (单模块跑通)
S17 ──► S18-S23 (套用 char)
S23 ──► S24-S31 (复制 4 个模块)
S5-S7 ──► S32-S37 (转账闭环，独立条线，可与里程碑3-5并行)
所有模块就位 ──► S38-S44 (教程图床)
任意时候 ──► S45-S47 (对话框管理，最独立)
S1-S51 全部 ──► S48-S51 (收尾)
```

里程碑 6（转账）是独立条线，**可以在里程碑 3 完成后随时插队做**——不阻塞美化主路径。

---

## 9. 验收清单（实现完跑一遍）

- [ ] 首次启动 wallet.json 自动初始化 20000
- [ ] 创建气泡扣 5cc，余额不足时拒绝
- [ ] 默认槽位不可删不可改名
- [ ] 编辑 CSS 后 mockup 实时更新
- [ ] 选择气泡套到 char，进聊天看到生效
- [ ] 两个 char 用同一个气泡，改 CSS 同步变
- [ ] 删除被使用的气泡有 X 个 char 确认提示
- [ ] user 发红包扣钱，10 轮后自动退回
- [ ] char 发红包点领取后 user 余额 +
- [ ] AI 提示词里能看到 transfer 状态后缀，但看不到余额
- [ ] 图床上传按钮能拿回直链
- [ ] 全屏皮肤预览能进能退
- [ ] 隐藏聊天的会从联系人列表消失，能恢复
- [ ] node --check 全部通过
- [ ] README.md 已同步更新
