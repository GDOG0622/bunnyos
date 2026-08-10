# BunnyOS / 萝卜机

本地"小手机"式 AI 聊天器外壳。`apps/` 装 App，`data/` 装用户数据，`settings.json` 装全局设置。

## 启动

**Windows 一键**：双击 `start.bat`。首次会自动 `npm install`（约 1-2 分钟），之后两秒后自动打开浏览器。关窗口即停服务。

**macOS / Linux 一键**：`./start.sh`（必要时 `chmod +x start.sh`）。Ctrl+C 停。

**手动**：
```bash
npm install
npm start
```

访问 `http://localhost:3000/index.html`。文件统一 UTF-8。需要 Node.js v18+。

## 文件地图

```text
BunnyOS/
├─ index.html              主桌面骨架（含 PWA manifest 引用）
├─ server.js               Express 本地服务 + 所有 API
├─ service-worker.js       PWA + Web Push 接收（必须在根域）
├─ manifest.webmanifest    PWA 安装信息
├─ start.bat               Windows 一键启动
├─ start.sh                macOS/Linux 一键启动
├─ ecosystem.config.js     PM2 配置（VPS 部署用）
├─ settings.json           全局设置
├─ icon.png                网页 favicon + PWA 图标
├─ assets/
│  ├─ backgrounds/         用户上传的壁纸（thin-back.* 竖屏 / wide-back.* 横屏）
│  ├─ app-icons/           用户上传的 App 图标
│  ├─ styles/              base.css / desktop.css / window.css
│  └─ scripts/             theme.js / apps.js / window-manager.js / clock.js / notify.js
├─ apps/
│  ├─ settings/            通用 API、美化（含提示音+推送）、生图、语音、存储、关于
│  ├─ QQ/                  聊天主战场（index.html / styles.css / QQ.js / scripts/*）
│  ├─ prompt-manager/      预设、世界书、变量手册（QQ 内置打开，桌面 hidden）
│  ├─ suki/                占位
│  └─ X/                   占位
└─ data/
   ├─ characters/          角色卡 <id>.json
   ├─ chats/qq/            单人聊天 <characterId>.json
   ├─ presets/
   │  ├─ image-prompts.json     生图提示词预设
   │  ├─ st-presets/            酒馆兼容预设工作副本
   │  └─ st-presets-settings.json
   ├─ qq/                  QQ App 自身的 settings/groups/sticker-packs
   ├─ userpersonas/        user 人设，按名字命名
   ├─ worlds/worldbooks.json   { books: [{id,name,entries:[{id,name,content}]}] }
   ├─ assets/              头像、背景、生图、音频、贴纸池
   ├─ vapid.json           Web Push VAPID 密钥对（自动生成，勿提交）
   ├─ push-subscriptions.json  已订阅推送的设备列表
   └─ backups/
```

## 后端 server.js

端口 3000。常量名见文件头。

### API 速查

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/apps` | 扫描 `apps/*/manifest.json` 返回 App 清单 |
| GET / POST | `/api/settings` | 全局 settings.json 读写 |
| POST | `/api/assets/upload` | 上传壁纸 / App 图标 |
| GET / POST | `/api/presets` | 生图提示词预设 |
| GET | `/api/st-presets` | 酒馆预设列表 + 当前 id |
| POST | `/api/st-presets/new` | 新建空白预设（10 个 builtin marker + 默认采样） |
| POST | `/api/st-presets/current` | 切换当前 |
| GET / POST / DELETE | `/api/st-presets/:id` | 读 / 覆盖 / 删 |
| POST | `/api/st-presets/:id/rename` `/copy` `/refresh-default` | 改名 / 复制 / 从 Liminal_online.json 重读 |
| POST | `/api/st-presets/import-default` | 重新导入默认预设 |
| GET / POST | `/api/worldbooks` | 全部世界书读 / 覆盖 |
| POST | `/api/worldbooks/books` | 新建空白本 |
| DELETE | `/api/worldbooks/books/:id` | 删整本（清角色绑定 + QQ 全局列表） |
| POST | `/api/worldbooks/import-st` | 导入酒馆世界书 JSON（comment→name, content→content，其他字段丢） |
| GET / POST | `/api/qq/global-worldbooks` | QQ 全局选中的书 id 列表 |
| GET | `/api/qq/preset-marker-preview?characterId=` | 装配预览：world_info + memories 真实内容 |
| GET / POST | `/api/prompt/variables` `/render` | 变量手册 + 模板渲染 |
| GET / POST / PUT / DELETE | `/api/userpersonas[/:id]` `/current` | user 人设 |
| GET / POST | `/api/qq/prompt-preset` | QQ 选用哪个预设 |
| GET / POST / PUT / DELETE | `/api/qq/characters[/:id]` | 角色卡 |
| GET / POST | `/api/qq/chats[/:characterId]` | 聊天记录；列表启动用 `?summary=1` 只返回最后消息和计数，点入聊天再取全文 |
| GET / PUT | `/api/qq/summary-settings/:characterId` | 每个角色的总结层数阈值 + 总结世界书选择 |
| POST | `/api/qq/summarize` | 第 `阈值+1` 层触发小总结；副 API 生成、写世界书并归档旧层 |
| POST | `/api/qq/summarize/big/preview` `/big/confirm` | 最新 5 张小总结生成大总结草稿；用户确认后保存并关闭原卡 |
| GET / POST | `/api/qq/groups` `/sticker-packs` | 群定义 / 自定义表情包合集 |
| POST | `/api/qq/reply` | AI 回复（按预设装配 + 采样参数 + 抗截断） |
| POST | `/api/qq/impersonate` | AI 代回（user 视角拟回复，填入输入框不发送） |
| POST | `/api/qq/link-preview` | 社交/商品链接解析；支持淘宝、闲鱼、拼多多短链和商品卡 |
| GET | `/api/notify/vapid-public-key` | Web Push 公钥（前端订阅时取）|
| POST | `/api/notify/subscribe` `/unsubscribe` | 订阅 / 取消订阅本设备的推送 |
| GET | `/api/notify/subscriptions` | 查询订阅数量 |
| POST | `/api/notify/test` | 测试推送（向所有订阅设备发一条）|
| GET / POST | `/api/wallet` `/wallet/adjust` | 钱包余额（萝卜币 cc）/ 加减（含余额下限 0） |
| POST | `/api/qq/chats/:characterId/transfer/:idx/receive` | user 领取 char→user 红包 |
| GET / POST / PUT / DELETE | `/api/qq/beauties[/:type[/:id]]` | 美化库 CRUD：皮肤 / 头像（成对） / 头像框 / 气泡（user+char 双 CSS） |
| POST | `/api/qq/beauties/backgrounds/:id/image` | 美化库背景覆盖式上传（用 1 个槽位作为全局背景） |
| GET | `/api/qq/char-beauty-usage/:type/:id` | 删除前查多少 char 在用某项 |
| GET / PUT | `/api/qq/char-beauty/:characterId` | char 美化绑定（avatarId / frameCharId / frameUserId / bubbleId / customBackgroundUrl） |
| POST / DELETE | `/api/qq/char-beauty/:characterId/background` | char 专属聊天背景上传 / 清除（覆盖到 `data/qq/char-backgrounds/<cid>.<ext>`） |
| GET / PUT | `/api/qq/skin` | 全局皮肤 CSS（写 `qq/settings.json.currentSkinId`，QQ App 启动注入到 `<body class="bunny-qq-skin">`） |
| GET | `/api/qq/chat-tokens/:characterId` | 当前 prompt token 估算（CJK 1tk + 其余 4 字/tk，沿用酒馆 fallback 思路） |
| POST | `/api/upload/image-host` | 图床代理：catbox + 自定义 endpoint fallback（顺序：lastWorking → primary → catbox） |
| GET | `/api/proxy/catbox?url=...` | Catbox 资源流式代理：VPS 直连 → Cloudflare Worker → wsrv 图片兜底；严格域名白名单，单文件上限 30MB |
| POST | `/api/qq/import-carrot` | 导入 carrot 插件 JSON：表情包 / 头像对 / 头像框 / 字体 / 提示音，去重按 URL 或 pair |

**静态路径必须放在 `:id` 之前**：`/api/st-presets/current` `/new` `/import-default` 都要先注册。

### 装配链路（核心）

`POST /api/qq/reply` 接收 `{characterId, messages, chatType}`：

1. `buildPromptVariables` 算 18 个变量（{{now}} {{char}} {{user}} {{char_role_setting}} {{chat_history}} 等）
2. `qqMessageToText` 把每条 QQ 消息映射为 AI 文本：
   - text → 裸文本
   - sticker → `[name]`
   - image → `[图片]`（同时附 multimodal `image_url`）
   - transfer → `[🧧¥10|备注]`
   - system → `+content+`（BUNNY 元层，char 应忽略）
3. `injectCharRulesAtDepth` 把角色卡 `rp_rules` 按 `rp_rules_depth` 0-4 splice 进 history 当 system 消息
4. `buildQqPresetPrompt` 按当前预设 `prompt_order` 遍历 enabled 条目
   - 普通条目：渲染 `prompt.content` 后按 `prompt.role`（system/user/assistant）独立成消息，相邻同 role 合并
   - marker：调 `buildBuiltinPromptContent(identifier, character, userPersona, variables, chatType)` 拿动态内容
   - `chatHistory` marker：原样展开为真实多条 user/assistant
5. 采样参数从预设 JSON 顶层读：temperature / top_p / frequency_penalty / presence_penalty / openai_max_tokens
6. **抗截断循环**（开关 `mainApi_antiCutoffEnabled` + 次数 `mainApi_antiCutoffMaxRetries`）：调主 API 后，若 finish_reason=length 或 strip 思维链后为空 → 把已生成内容当 assistant 消息 + 追 user「续写」再调，最多 N 次
7. **关键**：每个 chunk 单独剥 `<think>...</think>`（含未闭合的）再累加。不能整体累加再 strip——多 chunk 间未闭合的 `<think>` 会让兜底正则吃掉后续好内容
8. 累加结果用 `splitReplyToSegments`（仅按 `\n` 切，不剥任何文字）拆成多条气泡
9. 完成时 `sendWebPushToAll(...)` fire-and-forget 推给所有订阅设备

### 模板渲染 renderPromptTemplate

按顺序：
1. `{{// ... }}` 跨行注释剥离
2. `{{random::a,b,c}}` 随机一个
3. `{{roll::XdY}}` / `{{roll::Y}}` 骰点求和
4. `{{name}}` / `<name>` 变量替换

### 内置 marker（10 个，UI 锁死 / 内容由 server.js 决定）

| identifier | 名称 | 内容来源 |
| --- | --- | --- |
| `bunnyosRealtime` | 实时模式 | 时间变量 |
| `charDescription` | CHAR人设 | `<character_info>` 包角色卡 role_setting / other_setting（不含 rp_rules） |
| `personaDescription` | USER人设 | `<user_info>` 包当前 user 人设 |
| `worldInfoAfter` | 世界书 | `<world_info>` 依次包含角色 `worldbookIds`、QQ `globalWorldbookIds`（角色在前、全局在后） |
| `worldInfoBefore` | 总结内容 | `<memories>` 只包含当前角色 `summaryWorldbookId` 指定的总结世界书 |
| `scenario` | 场景信息 | 角色卡 scenario |
| `dialogueExamples` | 示例聊天 | 角色卡 mes_example |
| `onlinePrivateChat` | 线上·私聊 | chatType=private 时注入 `ONLINE_PRIVATE_CHAT_PROTOCOL` 常量 |
| `onlineGroupChat` | 线上·群聊 | chatType=group 时注入 `ONLINE_GROUP_CHAT_PROTOCOL` 常量 |
| `chatHistory` | 聊天记录 | 展开为真实多条 user/assistant |

私聊/群聊 marker 内容在 server.js 顶部两个 const 定义，按 Liminal_online 原文精简到 1/3。

## 关键数据模型

**角色卡 `data/characters/<id>.json`**：核心字段 `name / avatar / role_setting / rp_rules / rp_rules_depth(0-4) / other_setting / scenario / mes_example / worldbookIds:[] / summaryWorldbookId`。`worldbookIds` 是角色专属世界书；`summaryWorldbookId` 是独立的总结世界书。`description / personality / nsfw_setting` 是旧兼容字段，分别映射 role_setting / rp_rules / other_setting。

**聊天记录 `data/chats/qq/<characterId>.json`**：`{characterId, messages:[{role, type, text, created_at, ...}], summaryLayerThreshold, updated_at}`。message type：`text / image / sticker / transfer / service / link / system`。`service` 用 `serviceType / platform / price / item / note` 表示礼物、外卖和打车；商品 `link` 额外带 `previewType: "product" / platform / price`。可选字段：`reply_to` / `favorited` / `persona` / `reply_group_id` / `reply_group_versions` / `reply_group_version_index`；已进入小总结的消息标记 `summary_archived:true`，界面仍显示，但不会再装入 AI prompt。

**user 人设 `data/userpersonas/<名字>.json`**：`id / name / gender / birthday / status / customStatus / signature / note / prompt / avatar`。注入 AI 的字段：name / gender / birthday / prompt。

**世界书 `data/worlds/worldbooks.json`**：`{books: [{id, name, entries: [{id, name, content, enabled}]}]}`。条目无 key/depth/probability 命中引擎，装配时纯打包；但条目级 `enabled`（默认 `true`）可临时关闭单条而不删除，prompt 装配时按 `entry.enabled !== false` 过滤。

**酒馆预设**：标准 ST 结构。BunnyOS 在 `extensions.bunnyosPromptGroups` 存自定义分组，`extensions.bunnyosBuiltinArranged` 标记 builtin marker 已排序。

**QQ 设置 `data/qq/settings.json`**：`currentPersonaId / currentPromptPresetId / globalWorldbookIds:[]`。

## 前端约定

- 主桌面响应宽窄屏切换：窄屏 iPhone 风、宽屏 macOS 风
- App 用 iframe 挂载；iframe 通过 `postMessage` 发 `bunnyos:navigation-state`（含 title / canGoBack）让外层处理移动端返回栏
- iframe 同源时外层会写 `documentElement.dataset.appLayout="mobile|desktop"`，App 内用 `html[data-app-layout]` 做窗口级响应式
- 拖拽缩放时外层加 `.resizing` 类，禁掉 iframe 事件
- 美化字体推荐 `.woff2`；`beauty_fontUrl` 支持 `.woff2/.woff/.ttf/.css`
- 全屏 App 控制热区：鼠标靠近顶部展开红黄绿控制栏
- QQ「我」页：钱包下拉旁是 QQ 专属预设选择 + 提示词管理入口（在 QQ 内全屏打开 prompt-manager）
- QQ PC 横屏输入快捷键：`Enter` 等同“输入”，`Ctrl+Enter` 等同“发送并请求回复”；`Shift/Alt/Meta+Enter` 保留 textarea 换行

## 规划

### 已完成的大件

- 角色卡 ↔ 世界书绑定（多选 chip）
- 角色 RP 规则按 depth 注入 history
- 酒馆兼容预设 + 采样参数接管 + 新建空白预设
- 私聊/群聊 marker 内置 + 按 chatType 互斥触发
- BUNNY 系统信息 +xxx+
- AI 代回（impersonate）
- 模板宏：`{{//}} / {{random}} / {{roll}}`
- USER 语音转文字（STT）：QQ 麦克风按钮 → `MediaRecorder` 录 opus → **前端直传** Groq 或硅基流动的 OpenAI 兼容转写端点 → 回填 `=MM:SS|content=`。Key 存在 `settings.json` 的 `asr_groqKey` / `asr_siliconflowKey`，调度顺序按 `asr_lastWorking` 优先。后端零参与
- **QQ 美化系统**（详见 `QQ美化系统计划.md`）：5 个模块（皮肤 / 头像 / 头像框 / 气泡 / 背景）；公共库 + char-beauty 个性化；头像框 char/user 双侧独立；全局皮肤启动注入；per-char 聊天背景直接上传到 `data/qq/char-backgrounds/<cid>.<ext>`；气泡点击侧弹菜单替代长按；每条消息 QQ 风头像 + frame 叠层；编辑模式 textarea 嵌进气泡（`field-sizing: content`）
- **钱包（萝卜币 cc）+ 转账闭环**：启动初始化 `data/wallet.json` 20000cc；美化创建按价扣费（皮肤 20 / 其他 5 / 背景 0）；红包 user→char 发送即扣，现实时间满 24 小时仍未领取则自动退回；char→user 用户点击领取入账；礼物/外卖/打车由 user 发送时也按填写价格立即扣款；AI 看到红包状态但看不到余额
- **生活服务商品卡**：QQ 输入栏 🎁 统一入口发送淘宝礼物、美团外卖、滴滴打车；char 可按 `[🎁淘宝\|Price\|Item\|Note]`、`[🛵美团\|Price\|Item\|Note]`、`[🚕滴滴\|Price\|Item\|Note]` 输出同款卡片
- **QQ 渐进加载**：启动只取角色与聊天摘要，点入某个聊天后才读取其完整记录；界面首次只创建最近 20 层消息（同一方连续发送的一组气泡算 1 层），上滑到顶部每次再追加 20 层。图片、链接封面和表情图仅随当前可见层加载
- **图床代理**：`POST /api/upload/image-host`（catbox 默认 + 自定义 imgbb/smms endpoint），调用方在美化编辑页头像 / 头像框的 URL 输入旁
- **Catbox 免梯读取**：主桌面、QQ、设置和提示词管理器加载 `assets/scripts/catbox-proxy.js`，只在渲染时把 Catbox 的 `src/href/poster/srcset/CSS url()` 改写到 `/api/proxy/catbox`，不改存档原 URL；后端直连失败后复用 carrot 的 Cloudflare Worker，支持图片、GIF、视频、音频和字体
- **carrot 数据迁移**：`POST /api/qq/import-carrot` 把酒馆 carrot 插件导出的 JSON 一键导入到 BunnyOS——表情包按 url 去重 / 头像框按 char-user 拆 / 头像对成对入库 / 字体合并到 `beautyPresets.font` / 提示音合并到 `notify_savedSounds`
- **图片缓存升级 IndexedDB**：发过的图片 dataURL 写到 IDB `bunnyos-qq/images`（旧 `localStorage qq:img:*` 启动时自动迁移）；后端 chat 文件不存 dataURL 但保留 `client_image_id`；AI prompt 只发最近一张
- **存储管理**：设置 → 存储配置 → 缓存管理（IDB 图片库统计 + 清空 / 浏览器站点 caches 清空）；图床配置在同一页
- **M8 对话框管理**：聊天页三个点面板"清空聊天记录 / 隐藏此聊天 / 删除聊天"三个操作；后端 `DELETE /api/qq/chats/:cid/messages` + chat 加 `hidden` 字段 `PATCH /api/qq/chats/:cid/hidden`；联系人列表过滤 `hidden`，顶栏"显示隐藏聊天"toggle；删除会级联清掉对应的 char-beauty/char-background
- **分层总结记忆**：聊天页三个点把头像/头像框/气泡/背景收进默认折叠的“美化”，新增“总结”；默认每 100 层总结一次，第 101 层才触发。副 API 生成一张小总结卡写入指定总结世界书，未指定时自动新建“角色名的记忆”；旧层只从 prompt 隐藏，不删聊天记录。启用小总结满 5 张后询问是否生成大总结，用户阅览确认后保存并关闭对应 5 张小卡
- **社交与商品链接解析**（详见 `bunnyos/references/xhs-link-preview.md`）：除小红书/抖音/微信公众号/微博外，识别淘宝、闲鱼、拼多多商品短链，追踪真实商品 URL，尽量提取标题、价格和主图并渲染商品卡；平台限制匿名抓取时使用分享文案/链接参数兜底，不伪造缺失字段。最近一张封面本地缓存后作为多模态附件发给 AI，6 组 user-char 对话后衰减为短标签

### 下一步

**P1 美化教程一键复制**（§8 S38/S39）：每个美化模块 panel 加默认 CSS 一键复制 + 推荐提示词模板复制，让用户把模板扔给 AI 帮改。

**P1 群聊接入 AI**：`chatType=group` 路由已就位，需要：群聊 chat 界面、群聊聊天记录结构 `{groupId, members:[characterId], messages:[{senderId,...}]}`、`/api/qq/reply` 增加 `groupId` 支持、群成员轮替逻辑。

**P1 主动发消息**：新增端点 `POST /api/qq/proactive`，按当前时间/上下文判断 char 是否会主动发。每次调用独立选 chatType。

**P2 加号工具区扩展**：
- 礼物：保留占位

**P3 设置 App 弹窗统一**：剩余的几个 `alert` 换成项目内 dialog

**P3 存储层**：JSON 文件够用。若数据量起来再考虑 SQLite 索引层 + JSON 导入导出

### PWA / 移动端注意

- 设置、美化、API Key 等全局数据都来自后端 `settings.json`，不应依赖浏览器 `localStorage`。
- PWA 安装版和浏览器版必须使用完全相同的 origin（协议、域名、端口都一致）。例如 `https://example.com` 与 `https://www.example.com`、`http://IP` 与 `https://域名` 都是不同来源，表现可能不同。
- `/api/*` 响应必须 `no-store`，避免 Cloudflare、浏览器或安装版 PWA 拿到旧的空设置响应。若安装版仍显示旧设置，先删除桌面图标并清理该站点数据后重新安装。
- 多端设置同步使用 `/api/settings/events` 的 Server-Sent Events：电脑端保存设置后，手机/PWA 会收到 `settings-updated` 并重拉 `/api/settings`。前端还会在窗口回到前台和每 30 秒轮询兜底。若反代启用了响应缓冲，需对该接口关闭缓冲（Nginx 可用 `proxy_buffering off;`），否则实时性会退化成兜底轮询。

## VPS 部署

```bash
git clone <repo>
cd BunnyOS
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup    # 开机自启
```

反代（Nginx/Caddy）把 HTTPS 域名指到 `localhost:3000`。务必 HTTPS（Web Push + PWA 强制）。Cloudflare 在前面代理可以，源站 HTTP 也行。

首次启动会自动生成 `data/vapid.json`（VAPID 密钥对）——**不要提交到 git**，丢失会让所有已订阅设备失效。

推送配置流程：在浏览器打开 BunnyOS → 设置 → 美化 → 自定义提示音 → 点「订阅本设备」→ 浏览器弹通知权限 → 同意。从此该设备就算关浏览器也能收到 AI 回复完成的 OS 系统通知。

| 文件 | 用途 |
| --- | --- |
| `service-worker.js` | PWA + push 接收（根域，必须 `/service-worker.js`） |
| `manifest.webmanifest` | PWA 安装信息 |
| `data/vapid.json` | VAPID 密钥对（自动生成，加 .gitignore） |
| `data/push-subscriptions.json` | 所有订阅本站推送的设备 |
| `ecosystem.config.js` | PM2 配置 |

### GitHub 自动更新 VPS

推荐工作流：

```text
本地修改 → publish-github.cmd 提交并推送 GitHub → GitHub Webhook 调 VPS → VPS 自动 git pull / npm install / pm2 restart
```

本地发布：

```powershell
cd D:\OneDrive\BunnyOS
.\publish-github.cmd "更新说明"
```

如果仓库还没有远端，先在本地加：

```powershell
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

VPS 端准备：

```bash
cd /opt
git clone <你的 GitHub 仓库地址> bunnyos
cd /opt/bunnyos
npm install --omit=dev
```

在 `ecosystem.config.js` 的 `env` 中设置一个长随机密钥：

```js
BUNNYOS_UPDATE_TOKEN: '换成一长串随机字符'
```

然后启动：

```bash
pm2 start ecosystem.config.js --update-env
pm2 save
```

GitHub 仓库设置 Webhook：

```text
Payload URL: https://你的域名/api/admin/update-from-github?token=同一个随机密钥
Content type: application/json
Events: Just the push event
```

安全注意：

- `BUNNYOS_UPDATE_TOKEN` 不要提交到 GitHub；只放在 VPS 的 PM2 环境或线上 `ecosystem.config.js`。
- `data/`、`settings.json`、`node_modules/` 不要提交；它们在 `.gitignore` 中应保持忽略。
- Webhook 更新会在 `git reset --hard origin/main` 前临时备份并恢复 `settings.json`、`data/`、上传壁纸/图标目录以及线上 `ecosystem.config.js`，避免 GitHub 代码更新覆盖线上设置、聊天记录、API Key 和 PM2 token。
- 这个 webhook 端点只有设置了 `BUNNYOS_UPDATE_TOKEN` 才启用；没有 token 时返回 404。
