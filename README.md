# BunnyOS / 萝卜机

支持多设备访问的个人 AI 聊天桌面。程序目录只存代码；用户数据、上传资源和线上配置统一放在独立存储目录。默认是程序目录旁的 `<程序目录名>-data/`（例如 `BunnyOS-data/`），也可以用 `BUNNYOS_STORAGE_DIR` 指定绝对路径。下文的 `data/`、`settings.json` 和用户资源路径均相对于该存储目录。

## 启动

**Windows 一键**：双击 `start.bat`。首次会自动 `npm install`（约 1-2 分钟），之后两秒后自动打开浏览器。关窗口即停服务。

**macOS / Linux 一键**：`./start.sh`（必要时 `chmod +x start.sh`）。Ctrl+C 停。

**手动**：
```bash
npm install
npm start
```

访问 `http://localhost:3000/index.html`。文件统一 UTF-8。需要 Node.js v18+。

### MCP 工具与情侣空间

- **工具**：从桌面「工具」或「设置 → 工具、MCP 与提醒」进入，开启聊天工具后，QQ 可以调用内置提醒、Tavily 联网搜索和外接 MCP。支持 HTTP、SSE、stdio；外部操作先显示确认卡片。搜索需配置密钥或搜索 MCP，真实点单需接入相应商家服务。
- **Suki**：选择已有 AI 角色建立小家，记录相恋天数、心情、图文日记、纪念日和共同心愿，参与每日问答与小兔养成。日记和问答可邀请角色回应，近期空间记录会进入 QQ 聊天上下文。
- 更新后请运行 `npm install` 并重启后端。提醒需要服务持续运行；系统通知还需开启本设备推送。MCP 凭据和执行回执仅保存在当前机器，不进入可移植备份。

参考项目、设计选择、配置步骤及限制见 [MCP 与 Suki 调研和使用说明](docs/mcp-suki-research.md)。

### GitHub Pages 项目说明

Pages 发布来源为 `main` 分支的 `/docs`，入口是 `docs/index.md`，展示启动说明和完整文档链接。聊天、存储与推送需要通过上面的 Node.js 服务或 VPS 部署运行。修改文档或构建检查工作流的 PR 会先运行同一 Jekyll 构建并检查生成的首页和样式文件；合并后继续由 GitHub Pages 发布。

### 登录与公网部署

首次访问会显示浏览器登录框，用户名是 `bunnyos`。默认启动时自动生成随机密码，保存在独立存储目录的 `data/access.json`；也可以用至少 16 字符的环境变量 `BUNNYOS_PASSWORD` 指定密码。密码不会打印到日志，不会进入云备份，恢复备份也不会替换本机登录密码。

公网访问请使用 HTTPS 反向代理，并设置 `BUNNYOS_ORIGIN` 为浏览器使用的完整来源（例如 `https://bunny.example.com`，含非默认端口时也要写端口）。未设置时按请求的协议和 Host 检查来源；HTTPS 代理后若未配置外部来源，写入请求可能被拒绝。页面、API、图片和设置事件流均需要登录，只允许同源访问。更新 webhook 仍单独校验 `BUNNYOS_UPDATE_TOKEN`。

静态服务只开放前端目录和受保护的媒体目录；`settings.json`、聊天 JSON、备份、VAPID 私钥和服务端代码不提供静态下载。已上传的 SVG 等用户资源附带 sandbox 策略，避免在直接打开时执行脚本。

### 聊天与备份的数据保护

- 聊天接口返回服务端 `version`（文件内容摘要）；修改请求必须携带读取时的 `version`，新聊天传 `null`。过期请求返回 `409 / CHAT_VERSION_CONFLICT`，页面保留当前修改并暂停后续保存；复制需要的内容后重新加载页面，再继续编辑。清空、隐藏、删除、领取红包和总结也参与版本校验。
- 当前部署保持单个 Node.js 进程（PM2 `instances: 1`）。版本检查与同步落盘在同一进程内完成；增加 worker 或多台服务前需要改用数据库事务或跨进程锁。
- 新发送的 PNG、JPEG、GIF、WebP、AVIF 原图保存到 `data/assets/chat-images/`，聊天仅保存资源路径，云备份包含这些原图。单张原图上限 20MB，备份仍保持原有 100MB 上限。
- 新图片上传后只保存服务端资源引用，显示和模型请求都读取该原图。旧图片请在「设置 → 存储配置 → 旧版聊天图片迁移」补传；执行云备份时也会尝试补传。若原图只存在另一台设备，请在原设备、原浏览器中运行迁移；缺少原图时云备份会报错，不再报告完整备份成功。清除旧设备缓存前请先完成迁移。
- 恢复前会验证所有路径、文件内容、大小写冲突、文件与目录冲突及符号链接，在临时目录准备完成后才替换当前数据。替换失败会自动还原原文件；恢复前快照保留在 `data/backups/`。恢复期间仍需额外磁盘空间；进程被强制终止或断电不属于可捕获异常，出现残留 `.restore-*` 时应先保留目录中的原文件再人工恢复。

- 设置通过 `PATCH /api/settings` 提交 `{version, changes}`，世界书通过 `PATCH /api/worldbooks/books/:id` 按本提交同样的结构。版本分别来自读取结果的 `_version`；冲突返回 409，编辑器保留草稿，重新加载前停止保存。
- 钱包余额、交易 ID 和恢复队列共同保存在 `data/wallet.json`。领取、退款、购买和付费消息采用幂等交易；聊天或美化文件写入失败时，先完成账本中的恢复任务，再处理后续 API。重试必须复用原 `requestId`。
- 小总结卡片与待归档标记在同一世界书文件中提交；聊天落盘失败或进程退出后，启动和后续 API 会先恢复归档，再接受修改。原版本的重试复用已提交卡片；若文件被外部修改到不匹配的版本，恢复会停止并返回 503，保留双方数据以便检查。
- 普通回复和重新生成均由服务端解析、检查聊天版本并保存结构化消息，随后才返回成功及推送通知。关页不取消生成；「停止」按钮会显式取消服务端任务。代回仍只填入输入框。
- 预设使用 `extensions.bunnyosPresetId` 作为稳定身份；旧文件首次读取时以原 ID 迁移，QQ 和编辑器的选择互相独立。改名可以更改可读文件名，不改变 ID。
- 真实预览可选择角色聊天，和回复、代回、token 统计共用 ST 上下文构建及采样参数。时间、随机宏和概率世界书条目仍按每次构建求值。

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
├─ icon.png                网页 favicon + PWA 图标
├─ assets/
│  ├─ styles/              base.css / desktop.css / window.css
│  └─ scripts/             theme.js / apps.js / window-manager.js / clock.js / notify.js
├─ apps/
│  ├─ settings/            通用 API、美化（含提示音+推送）、生图、语音、存储、关于
│  ├─ QQ/                  聊天主战场（总结前端集中在 scripts/summary.js）
│  ├─ prompt-manager/      预设、世界书、变量手册（QQ 内置打开，桌面 hidden）
│  ├─ tools/               MCP 连接、搜索、提醒与调用记录
│  ├─ suki/                AI 角色情侣空间
│  └─ X/                   占位
├─ modules/
│  ├─ qq-summary.js         QQ 分层总结后端
│  ├─ tool-assistant.js     MCP 客户端、工具调用循环、确认回执与提醒
│  ├─ suki.js               按角色保存的情侣空间与 AI 回应
│  └─ st-context/           ST 风格上下文、世界书与 tokenizer/token 预算引擎
└─ tests/                   node:test 聚焦测试

BunnyOS-data/               独立存储目录（可通过环境变量更改）
├─ server-env.json          线上环境配置，不包含在可移植备份中
├─ settings.json            全局设置
├─ assets/backgrounds/      上传壁纸（thin-back.* / wide-back.*）
├─ assets/app-icons/        上传 App 图标
└─ data/
   ├─ characters/          角色卡 <id>.json
   ├─ chats/qq/            单人聊天 <characterId>.json
   ├─ presets/
   │  ├─ image-prompts.json     生图提示词预设
   │  ├─ st-presets/            每份酒馆兼容预设一个「预设名.json」，内部 ID 独立于文件名
   │  └─ st-presets-settings.json
   ├─ qq/                  QQ App 自身的 settings/groups/sticker-packs
   ├─ userpersonas/        user 人设，按名字命名
   ├─ worldbooks/             每本世界书一个「id-<ID 的 SHA-256>.json」
   ├─ worlds/worldbooks.json   旧版合集，首次迁移后保留作回退副本
   ├─ assets/              头像、背景、生图、音频、贴纸池
   ├─ vapid.json           Web Push VAPID 密钥对（自动生成，勿提交）
   ├─ push-subscriptions.json  已订阅推送的设备列表
   └─ backups/
```

## 后端 server.js

`server.js` 负责通用装配与启动；QQ 总结由 `modules/qq-summary.js` 驱动，ST 风格上下文由 `modules/st-context/` 独立驱动，可移植备份由 `modules/portable-backup.js` 驱动，前端总结交互集中在 `apps/QQ/scripts/summary.js`。

端口 3000。常量名见文件头。

### API 速查

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/apps` | 扫描 `apps/*/manifest.json` 返回 App 清单 |
| GET / PATCH | `/api/settings` | 读取全局设置 / 带版本的字段补丁 |
| GET / POST | `/api/storage/backup/export` `/restore` | 生成可移植备份 / 恢复备份并自动保留本机回滚快照 |
| POST | `/api/assets/upload` | 上传壁纸 / App 图标 |
| GET / POST | `/api/presets` | 生图提示词预设 |
| GET | `/api/st-presets` | 酒馆预设列表 + 当前 id |
| POST | `/api/st-presets/new` | 新建仅含 9 个固定 marker 的空白预设 |
| POST | `/api/st-presets/current` | 切换当前 |
| GET / POST / DELETE | `/api/st-presets/:id` | 读 / 覆盖 / 删 |
| POST | `/api/st-presets/:id/rename` `/copy` `/refresh-default` | 改名 / 复制 / 重置为仅含固定条目的空白预设 |
| POST | `/api/st-presets/import-default` | 重新导入默认预设 |
| GET | `/api/worldbooks` | 全部世界书及各本版本 |
| PATCH | `/api/worldbooks/books/:id` | 带版本修改该本的名称或条目 |
| POST | `/api/worldbooks/books` | 新建空白本 |
| DELETE | `/api/worldbooks/books/:id` | 删整本（清角色绑定 + QQ 全局列表） |
| POST | `/api/worldbooks/import-st` | 导入酒馆世界书 JSON，并保留 ST 激活、位置、概率和递归字段 |
| GET / POST | `/api/qq/global-worldbooks` | QQ 全局选中的书 id 列表 |
| POST | `/api/qq/prompt-preview` | 用指定角色聊天和编辑中的预设执行真实上下文构建 |
| GET / POST | `/api/prompt/variables` `/render` | 变量手册 + 模板渲染 |
| GET | `/api/tokenizers/status?model=` | 当前模型自动选择的 tokenizer、精确/回退状态 |
| POST | `/api/tokenizers/openai/count?model=` | ST 兼容消息数组 token 计数 |
| GET / POST / PUT / DELETE | `/api/userpersonas[/:id]` `/current` | user 人设 |
| GET / POST | `/api/qq/prompt-preset` | QQ 选用哪个预设 |
| GET / POST / PUT / DELETE | `/api/qq/characters[/:id]` | 角色卡 |
| GET / POST | `/api/qq/chats[/:characterId]` | 聊天记录；列表启动用 `?summary=1` 只返回最后消息和计数，点入聊天再取全文 |
| GET / PUT | `/api/qq/summary-settings/:characterId` | 每个角色的总结层数阈值 + 总结世界书选择 |
| POST | `/api/qq/summarize` | 第 `阈值+1` 层触发小总结；副 API 生成、写世界书并归档旧层 |
| POST | `/api/qq/summarize/big/preview` `/big/confirm` | 最新 5 张小总结生成大总结草稿；用户确认后保存并关闭原卡 |
| GET / POST | `/api/qq/groups` `/sticker-packs` | 群定义 / 自定义表情包合集 |
| POST | `/api/qq/reply` | 携带 characterId / version；服务端生成并保存，replaceIndex 指定重生成的最后一组回复 |
| POST | `/api/qq/reply/cancel` | 使用 characterId / generationId 显式停止生成 |
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
| GET | `/api/qq/chat-tokens/:characterId` | 按当前模型 tokenizer 统计 prompt token，并返回上下文分项；加载失败才使用 ST 字节回退估算 |
| POST | `/api/upload/image-host` | 图床代理：catbox + 自定义 endpoint fallback（顺序：lastWorking → primary → catbox） |
| GET | `/api/proxy/catbox?url=...` | Catbox 资源流式代理：VPS 直连 → Cloudflare Worker → wsrv 图片兜底；严格域名白名单，单文件上限 30MB |
| POST | `/api/qq/import-carrot` | 导入 carrot 插件 JSON：表情包 / 头像对 / 头像框 / 字体 / 提示音，去重按 URL 或 pair |

**静态路径必须放在 `:id` 之前**：`/api/st-presets/current` `/new` `/import-default` 都要先注册。

### 装配链路（核心）

`POST /api/qq/reply` 接收 `{characterId, messages, chatType, generationType}`；`generationType` 支持 normal / continue / swipe / regenerate / quiet：

1. `buildPromptVariables` 生成时间、角色、用户、总结与聊天变量（如 `{{now}}`、`{{char_info}}`、`{{summary}}`、`{{chat_history}}`）
2. `qqMessageToText` 把每条 QQ 消息映射为 AI 文本：
   - text → 裸文本
   - sticker → `[name]`
   - image → `[图片]`（同时附 multimodal `image_url`）
   - transfer → `[🧧¥10|备注]`
   - system → `+content+`（BUNNY 元层，char 应忽略）
3. `modules/st-context` 按 ST Chat Completion 语义装配：相对条目遵循 `prompt_order`；聊天内条目按 `injection_depth / injection_order / role` 插入；`injection_trigger` 按生成类型过滤
4. 世界书先扫描再注入：角色书优先于全局书，总结书独立；支持主/次关键词、四种次关键词逻辑、常驻、概率、递归、独立预算、位置、depth、Outlet、触发类型和包含组；旧条目无激活字段时继续视为常驻
5. `modules/st-context/tokenizer.js` 按模型自动选择 tokenizer：OpenAI/o 系列用 tiktoken；Gemini 用 ST 同路线的 Gemma SentencePiece；Claude、Llama、Qwen、DeepSeek 等按家族加载本地模型并缓存到 `data/_cache/tokenizers/`；加载失败才按 ST 的 UTF-8 字节估算回退
6. 用 `mainApi_context - openai_max_tokens` 得到提示词预算；固定提示词先占预算，聊天历史从最新一条向前装入，超出时丢最旧历史；若固定内容占满预算，仍保留最近一条有效 user 消息并报告警告；未固定示例在历史之后竞争剩余预算
7. 采样参数从预设 JSON 顶层读：temperature / top_p / frequency_penalty / presence_penalty / openai_max_tokens
8. **抗截断循环**（开关 `mainApi_antiCutoffEnabled` + 次数 `mainApi_antiCutoffMaxRetries`）：调主 API 后，若 finish_reason=length 或 strip 思维链后为空 → 把已生成内容当 assistant 消息 + 追 user「续写」再调，最多 N 次
9. **关键**：每个 chunk 单独剥 `<think>...</think>`（含未闭合的）再累加。不能整体累加再 strip——多 chunk 间未闭合的 `<think>` 会让兜底正则吃掉后续好内容
10. 累加结果用 `splitReplyToSegments`（仅按 `\n` 切，不剥任何文字）拆成多条气泡；响应附 `context_itemization / context_warnings` 供诊断
11. 完成时 `sendWebPushToAll(...)` fire-and-forget 推给所有订阅设备

### 云端备份与公告

- 设置 → 存储配置提供 GitHub 私有仓库和 Supabase Storage 两种手动云端备份；两者分别由独立 provider 类实现。
- “云端备份”覆盖约定路径的上一份备份；“加载备份”恢复前先在 `data/backups/` 创建本机回滚快照。
- 备份包含 `settings.json`、`data/` 和用户上传的桌面资源，但排除运行缓存、Web Push 设备密钥与历史回滚快照。
- OS 公告栏每日首次进入时提醒备份；可选择关闭提醒直到下次公告版本更新，点击“去备份”直达存储配置。
- QQ 生成任务按角色隔离，不同角色可以并行；App iframe 常驻，因此回到桌面或切换设置、Suki 时生成继续，完成后走 OS 信息条提醒。

### 模板渲染 renderPromptTemplate

按顺序：
1. `{{// ... }}` 跨行注释剥离
2. `{{random::a,b,c}}` 随机一个
3. `{{roll::XdY}}` / `{{roll::Y}}` 骰点求和
4. `{{name}}` / `<name>` 变量替换

### 新建预设的固定 marker（9 个，不可删除）

| identifier | 名称 | 内容来源 |
| --- | --- | --- |
| `bunnyosRealtime` | 实时模式 | 预设中可编辑正文，发送时渲染时间变量并自动包 `<realtime>` |
| `worldInfoBefore` | 世界书·角色前 | 扫描后命中“角色定义前”的世界书条目，正文不加标签 |
| `charDescription` | CHAR人设 | `<char_info>` 包角色名和角色卡 char_info |
| `worldInfoAfter` | 世界书·角色后 | 扫描后命中“角色定义后”的世界书条目，正文不加标签 |
| `personaDescription` | USER人设 | `<user_info>` 包当前 user 人设 |
| `memory` | 记忆 | `<memory>` 包角色总结世界书中启用的内容 |
| `onlinePrivateChat` | 线上·私聊 | 预设中可编辑正文，仅在 chatType=private 时注入并自动包 `<private_chat_protocol>` |
| `onlineGroupChat` | 线上·群聊 | 预设中可编辑正文，仅在 chatType=group 时注入并自动包 `<group_chat_protocol>` |
| `chatHistory` | 聊天记录 | `<chat_history>` 包真实多条 user/assistant 消息；其后追加独立的 `<rp_rules>` system 消息 |

这三个可编辑 marker 仅允许修改正文，名称、标识和外层标签固定。新预设写入默认正文；旧预设原先为空的正文首次读取时补入原有默认内容，之后每份预设独立保存修改。私聊/群聊默认正文保留在 server.js 的协议常量中。

## 关键数据模型

**角色卡 `data/characters/<id>.json`**：新建角色只存 `id / name / avatar / char_info / rp_rules / worldbookIds:[] / memory:{summaryWorldbookId}`。`worldbookIds` 绑定角色世界书；`memory.summaryWorldbookId` 引用独立的总结世界书。已有角色的 `role_setting / description / personality / summaryWorldbookId` 保留读取兼容。`rp_rules` 固定作为模型回复前最后一条 system 消息，不再设置插入深度。

**聊天记录 `data/chats/qq/<characterId>.json`**：`{characterId, messages:[{role, type, text, created_at, ...}], summaryLayerThreshold, updated_at}`。message type：`text / image / sticker / transfer / service / link / system`。`service` 用 `serviceType / platform / price / item / note` 表示礼物、外卖和打车；商品 `link` 额外带 `previewType: "product" / platform / price`。可选字段：`reply_to` / `favorited` / `persona` / `reply_group_id` / `reply_group_versions` / `reply_group_version_index`；已进入小总结的消息标记 `summary_archived:true`，界面仍显示，但不会再装入 AI prompt。

**user 人设 `data/userpersonas/<名字>.json`**：`id / name / gender / birthday / status / customStatus / signature / note / prompt / avatar`。注入 AI 的字段：name / gender / birthday / prompt。

**世界书 `data/worldbooks/id-<ID 的 SHA-256>.json`**：文件路径由稳定 ID 决定，改名只原子替换同一个文件。名称不能重复；旧版合集和按名称保存的文件自动迁移。中断改名留下的重复 ID 优先保留已发布的 ID 文件，否则选择 `updated_at` 最新的副本（相同时按文件修改时间选择）。旧版 `data/worlds/worldbooks.json` 保留原文件。条目支持 ST 的关键词、概率、递归、位置和触发字段；旧条目没有激活字段时按常驻处理。

**酒馆预设**：标准 ST 结构。BunnyOS 在 `extensions.bunnyosPromptGroups` 存自定义分组，`extensions.bunnyosBuiltinArranged` 标记 builtin marker 已排序。

**QQ 设置 `data/qq/settings.json`**：`currentPersonaId / currentPromptPresetId / globalWorldbookIds:[]`，以及 `world_info_*` 扫描深度、预算、递归、匹配和来源顺序设置。

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
- **聊天原图**：新图片保存在服务端；旧 `localStorage qq:img:*` 和 IDB `bunnyos-qq/images` 只由独立迁移入口读取，日常渲染和生成不访问旧缓存。
- **存储管理**：设置 → 存储配置 → 缓存管理（IDB 图片库统计 + 清空 / 浏览器站点 caches 清空）；图床配置在同一页
- **M8 对话框管理**：聊天页三个点面板"清空聊天记录 / 隐藏此聊天 / 删除聊天"三个操作；后端 `DELETE /api/qq/chats/:cid/messages` + chat 加 `hidden` 字段 `PATCH /api/qq/chats/:cid/hidden`；联系人列表过滤 `hidden`，顶栏"显示隐藏聊天"toggle；删除会级联清掉对应的 char-beauty/char-background
- **分层总结记忆**：聊天页三个点把头像/头像框/气泡/背景收进默认折叠的“美化”，新增“总结”；默认每 100 层总结一次，第 101 层才触发。副 API 生成一张小总结卡写入指定总结世界书，未指定时自动新建“角色名的记忆”；旧层只从 prompt 隐藏，不删聊天记录。启用小总结满 5 张后询问是否生成大总结，用户阅览确认后保存并关闭对应 5 张小卡
- **ST 风格上下文引擎**：预设相对顺序、聊天内 depth/order/role 注入、generation trigger、世界书关键词与递归预算、历史裁剪、Outlet 和 Prompt Itemization 响应均由独立 `modules/st-context/` 驱动
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

在独立存储目录（默认 `/opt/bunnyos-data`）创建 `server-env.json`，线上设置不要写回程序目录的 `ecosystem.config.js`：

```json
{
  "BUNNYOS_PASSWORD": "至少16字符的登录密码",
  "BUNNYOS_ORIGIN": "https://你的域名",
  "BUNNYOS_UPDATE_TOKEN": "换成一长串随机字符"
}
```

将该文件权限设为 `600`。自定义存储目录时，每次启动 PM2 或部署脚本都要设置相同的 `BUNNYOS_STORAGE_DIR`；PowerShell 部署脚本使用 `-StoragePath` 参数。

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

- `BUNNYOS_UPDATE_TOKEN` 等线上配置只放在独立存储目录的 `server-env.json` 或环境变量中，不提交到 GitHub。
- `data/`、`settings.json`、`node_modules/` 不要提交；它们在 `.gitignore` 中应保持忽略。
- Webhook 更新只 fetch/reset 程序、安装依赖并重启 PM2，不复制或恢复用户数据。部署包也始终排除用户数据。
- 这个 webhook 端点只有设置了 `BUNNYOS_UPDATE_TOKEN` 才启用；没有 token 时返回 404。

### 从程序目录内存储升级（仅一次）

首次升级请停用旧 webhook 更新流程。先停止旧服务，再安装新代码并迁移数据：

```bash
pm2 stop bunnyos
# 获取本版本代码后，在程序目录执行；--pm2 会保留 PM2 中的 BunnyOS 环境配置。
node scripts/migrate-storage.js --pm2
pm2 startOrRestart ecosystem.config.js --update-env
pm2 save
```

本地启动器用户先关闭旧服务窗口，再执行 `node scripts/migrate-storage.js`。迁移按原路径移动 `settings.json`、`data/` 和上传壁纸/图标目录，不覆盖已存在的目标；跨文件系统移动或目标冲突会中止，需要处理后再重试。旧目录仍有用户数据时，新服务会拒绝启动，防止静默切换到空存储。VPS 部署脚本在检测到旧目录时会先停止服务，再执行这一次迁移；此后更新不再接触用户数据。
