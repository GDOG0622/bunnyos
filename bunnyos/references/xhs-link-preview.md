# 社交链接解析技术笔记

本文记录 BunnyOS 里小红书、抖音、微信公众号、微博链接解析的实现经验，覆盖正文、封面图、评论、前端/后端抓取顺序、AI 可读图片，以及 prompt 中的平台标签和轮次衰减。

## 目标

用户在 QQ 聊天输入社交平台分享链接后，系统应生成一张链接卡片，并尽量把可用内容传给 AI：

- 识别裸短链，例如 `xhslink.com/o/...`，不要求用户手动补 `https://`
- 跟随短链跳转到真实内容页
- 解析标题、正文/描述、话题标签等文本内容
- 解析封面图，并缓存成本地静态文件用于卡片显示
- 将封面图作为多模态图片附件发给 AI，而不是只把图片 URL 发给 AI
- 小红书解析页面首屏状态里能拿到的前 10 条评论，包含楼中楼回复；抖音、微博走各自公开 web API 拉最多 10 条评论
- 发给 AI 的平台内容分别用 `<xhs>...</xhs>`、`<dy>...</dy>`、`<wx>...</wx>`、`<wb>...</wb>` 包裹
- 6 组 user-char 对话后，旧平台链接内容从 prompt 中衰减为 `[标题-正文前15字.xhs|dy|wx|wb]`
- 原生抓取失败时再走 Jina Reader 兜底，Jina Token 支持逗号/空格分隔多个 key 轮流试

## 平台能力

| 平台 | 识别 host | 原生解析 | 评论 | Prompt 标签 | 6 组后占位 |
| --- | --- | --- | --- | --- | --- |
| 小红书 | `xhslink.com`、`xiaohongshu.com`、`xhscdn.com` | `parseXhsFromHtml` 读取 `noteData` | 首屏 state 里最多 10 条 | `<xhs>` | `[标题-正文前15字.xhs]` |
| 抖音 | `douyin.com`、`iesdouyin.com`、`amemv.com` | `parseDouyinFromHtml` 读取 meta/HTML 描述和封面 | `iesdouyin` 评论接口，按 `awemeId` 拉最多 10 条 | `<dy>` | `[标题-正文前15字.dy]` |
| 微信公众号 | `mp.weixin.qq.com`、`weixin.qq.com` | `parseWechatFromHtml` 读取 `js_content`、作者和封面 | 暂无 | `<wx>` | `[标题-正文前15字.wx]` |
| 微博 | `weibo.com`、`m.weibo.cn`、`sinaimg.cn` | 通用 `parseOgFromHtml`（无专用结构化解析） | `m.weibo.cn`/`weibo.com` 评论接口，最多 10 条 | `<wb>` | `[标题-正文前15字.wb]` |
| 淘宝 | `e.tb.cn`、`m.tb.cn`、`taobao.com`、`tmall.com` | 追 JS 短链 + OG/分享文案/URL price | — | `<product>` | `[标题.tb]` |
| 闲鱼 | `m.tb.cn`、`goofish.com`、`2.taobao.com` | 追 JS 短链 + OG/分享文案 | — | `<product>` | `[标题.xy]` |
| 拼多多 | `yangkeduo.com`、`pinduoduo.com` | 追 HTTP 跳转 + OG/第三方解析 | — | `<product>` | `[标题.pdd]` |

## 当前链路

入口在 `apps/QQ/scripts/message-actions.js`：

1. `extractFirstLink(rawText)` 识别 `https://...` 和裸域名链接。
2. `normalizeInputLink(url)` 给裸链接补 `https://`。
3. 先尝试前端直抓 `tryFrontendLinkPreview(url, rawText)`。
4. 前端失败后调用后端 `POST /api/qq/link-preview`。
5. 后端返回后，前端保存一条 `type: "link"` 消息，字段包括：
   - `url`
   - `title`
   - `description`
   - `fullDescription`
   - `image`
   - `imageLocal`
   - `comments`
   - `siteName`
   - `source`
   - `limitedReason`

后端入口在 `server.js` 的 `/api/qq/link-preview`：

1. 接受裸 URL，并补成 `https://...`。
2. 拒绝内网地址，避免 SSRF。
3. 如果配置了第三方解析 API，先尝试第三方解析。
4. 原生 `fetchHtml` 抓页面并跟随 HTTP redirect。
5. 如果 HTML 里有 JS/meta redirect，再追一跳。
6. 如果最终 host 是小红书，走 `parseXhsFromHtml`；失败后走 Jina Reader。
7. 如果最终 host 是抖音，走 `parseDouyinFromHtml`；失败后走 Jina Reader，再退到分享文案。
8. 如果最终 host 是微信公众号，走 `parseWechatFromHtml`；失败后走 Jina Reader。
9. 其他网页走通用 OG/meta 解析，失败后走 Jina Reader。
10. 返回前统一经过 `sendPreview`，尝试下载封面到本地。

## 前端抓取的现实限制

前端抓取的出口 IP 是用户当前设备网络，理论上可能绕过 VPS 机房 IP 风控。但浏览器会受这些限制：

- CORS 阻止跨域读取 HTML
- 跳转链可能被浏览器安全策略拦截
- 登录态 cookies 未必能跨站带上
- 小红书页面脚本/风控可能不下发完整 state

实测从 `http://127.0.0.1:3000` 前端直接 `fetch('https://xhslink.com/o/...')` 会返回 `TypeError: Failed to fetch`。因此前端只是第一机会，不可作为主可靠方案。

## 正文解析

### 小红书

小红书页面首屏 HTML 里通常有 `window.__INITIAL_STATE__`，其中包含 `noteData`。实际结构常见为：

```text
"noteData":{
  "data":{
    "noteData":{
      "title":"...",
      "desc":"...",
      "imageList":[...],
      "cover":{...}
    }
  }
}
```

经验：

- 不要整体 `JSON.parse(__INITIAL_STATE__)`，页面状态很大，里面可能有非标准值或脚本噪声。
- 用字符串定位 `"noteData":`，再做括号配平抠出对象。
- 遍历所有同名 key，找到带 `title` 或 `desc` 的 note 对象。
- 正文不要裁剪，不要删除话题标签。
- `description` 和 `fullDescription` 都应保存全文，视觉折叠交给 CSS。

### 抖音

抖音分享链接通常先落到短链，再跳到视频页。当前实现主要从 HTML/meta 中取：

- `description` / `og:description`
- `<title>`
- `canonical`
- `og:image` 或首个图片

经验：

- 抖音标题常混在描述里，格式类似“正文 - 作者于日期发布在抖音”。解析时要去掉平台尾巴。
- 抖音视频本体目前不会下载，也不会转成 AI 可读视频；AI 只看到文本和封面图。
- 如果原生解析失败，Jina Reader 可作为兜底，但成功率取决于目标页是否对 Jina 开放。

### 微信公众号

微信公众号文章页面较大，目标链接实测可接近 3MB，因此 `fetchHtml` 当前最多读取 4MB，避免正文容器被 2MB 上限截断。

当前解析策略：

- 标题：优先 OG title，其次 `var msg_title`
- 摘要：OG description 或 `var msg_desc`
- 作者：`meta name="author"`，兜底 `nickname` / `profile_nickname`
- 正文：定位 `id="js_content"`，从对应 `<div>` 抽取到二维码/底部栏/脚本前
- 封面：OG image、`msg_cdn_url` 或正文里的第一张 `mmbiz.qpic.cn` 图片

经验：

- 微信公众号正文 HTML 嵌套复杂，不适合用简单“遇到第一个 `</div>`”截断。
- 抽正文时应去掉 script/style/svg，再把段落、section、div、br 转成换行。
- 解析成功时返回 `source: "wechat-html"`；只有正文拿不到但 meta 可用时才是 `wechat-og`。

### 微博

微博没有像小红书那样稳定的内嵌 JSON 结构，正文解析直接复用通用 `parseOgFromHtml`（OG title/description/image）。

经验：

- 微博常把未登录访客跳到 `Sina Visitor System` / `visitor.passport.weibo.cn` 验证页，HTML 里检测到这个特征就跳过 OG 解析，直接走 Jina 兜底，避免把验证页内容当正文。
- 只有 HTML 不含 visitor 特征且 OG 有内容（description/image，或 title 不是"微博"这种通用词）时才用 `source: "weibo-og"`。
- 评论走独立接口（见下方评论解析），跟正文解析是否成功无关，两边并行处理。
- 都拿不到内容时用分享文案兜底，`source: "weibo-limited"`，`limitedReason` 提示"微博未登录访问受限"。

## 封面图解析和本地缓存

封面候选顺序：

1. `note.cover.urlDefault`
2. `note.imageList[0].url`
3. `note.imageList[0].infoList` 中 `WB_DFT` / `H5_DTL` / `DFT`
4. `note.imageList[0].infoList[0].url`
5. OG / Jina 返回的图片

直接把 `xhscdn` URL 放到前端 `<img>` 不可靠，常见问题：

- 防盗链
- CDN 临时签名失效
- `http` 图片在 `https` 页面里被混合内容策略拦截
- AI 不能读取远程图片 URL 的实际视觉内容

因此后端返回前执行 `cachePreviewImage(imageUrl, refererUrl)`：

- 用移动端 UA 和 `Referer` 下载图片
- `http` URL 优先尝试改成 `https`
- 限制图片大小，当前最大 8MB
- 保存到 `data/assets/link-previews/<sha1>.<ext>`
- 返回 `imageLocal: "/data/assets/link-previews/xxx.jpg"`
- 缓存有自动清理上限：默认最多 10MB、最多 500 个文件，按最旧访问/修改时间删除。

前端卡片优先显示 `imageLocal`，失败才显示原始 `image`。

## AI 可读图片

仅把封面 URL 写进 prompt 没有意义，模型无法看到图片内容，还可能根据 URL 胡猜。

当前做法：

1. 聊天消息里保存 `imageLocal`。
2. 请求 AI 回复时，后端检查最近一条用户视觉消息。
3. 如果最近视觉消息是链接卡片，读取 `imageLocal` 对应本地文件。
4. 转成 `data:image/...;base64,...`。
5. 作为 OpenAI 兼容多模态 `image_url` 发给模型：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "[链接卡片] 标题...描述...评论...；封面图：已作为图片附件发送" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
  ]
}
```

注意：

- 只发送“最后一个”用户视觉附件，避免历史图片无限膨胀。
- 远程 API 不能访问用户本机 `localhost`，所以必须用 data URL 或公网可访问文件。
- 如果上游模型不支持多模态，这部分可能被上游忽略或报错，需要根据具体 API 能力判断。

## 评论解析

部分小红书分享页首屏 state 里有：

```text
"commentData":{
  "commentCount":16,
  "comments":[...]
}
```

当前解析策略：

- 定位 `"commentData":`
- 括号配平解析对象
- 读取 `comments`
- 每条提取：
  - `nickname`
  - `content`
  - `ipLocation`
  - `likeCount` / `likeViewCount`
  - `subCommentCount`
  - `parentNickname`
- 顶层评论和楼中楼按页面顺序展开，最多 10 条。
- 如果评论正文为空但带图片，标记为 `[图片评论]`，不把评论图片 URL 发给 AI。

限制：

- 只能拿页面首屏 state 已下发的评论。
- 若页面不下发评论，需要登录态、接口签名、风控参数或二次请求，当前不强行抓。
- `commentCount` 可能大于实际已展开评论数。例如页面显示 16，但 state 里只展开 8 条，则只返回 8 条。

### 抖音 / 微博评论

小红书是从页面首屏 state 里"顺手"抠评论；抖音和微博没有这种内嵌结构，改成直接调各自的公开 web API：

- 抖音：从 `finalUrl` 路径 `/video/<id>` 或 `/note/<id>`、`modal_id`/`aweme_id` 查询参数、或 HTML 里的 `aweme_id`/`modal_id`/`video_id`/`itemId` 字段提取 `awemeId`，再请求 `https://www.iesdouyin.com/web/api/v2/comment/list/?aweme_id=...&count=20&cursor=0`。
- 微博：从 URL 路径末尾的数字 ID、`/detail/<id>` 或 `id` 查询参数提取微博 ID，依次尝试 `m.weibo.cn/comments/hotflow` 和 `weibo.com/ajax/statuses/buildComments`，第一个返回非空评论就用。
- 两者都用 `normalizeGenericComments` 统一归一化字段（`nickname` / `content` / `ipLocation` / `likeCount` / `parentNickname`），楼中楼通过 `reply_comment` 展开，最多 10 条。
- 都是非登录态公开接口，请求头带移动端 UA + 对应站点 `Referer`；返回非 JSON（例如又被跳到验证页）直接判空，不抛错中断主流程。
- 抖音评论请求失败不影响正文解析结果，两者独立 try/catch，即使评论接口挂了也照常返回标题/描述/封面。

限制：

- 抖音、微博评论接口都可能因为风控临时返回空或非 JSON，此时静默返回空数组，不重试、不报错给用户。
- 微博未登录态能看到的评论有限，量大或热门微博可能只返回一部分。

## 给 AI 的文本

`qqMessageToText(msg)` 会先用 `linkPromptKind(msg)` 判断平台。四类平台链接生成结构相同，只是标签不同：

```text
<xhs>
标题：...
描述：...
评论前N条：1. ... / 2. ...
站点：小红书
</xhs>
```

```text
<dy>
标题：...
描述：...
站点：抖音
</dy>
```

```text
<wx>
标题：...
描述：...
站点：微信公众号 · 作者
</wx>
```

```text
<wb>
标题：...
描述：...
评论前N条：1. ... / 2. ...
站点：微博
</wb>
```

刻意不包含：

- 原链接 URL
- 封面图 URL
- 评论图片 URL

原因是 AI 不能从 URL 直接读取视觉内容，发 URL 反而会增加噪声。封面图通过多模态附件发送。

### 6 组后衰减

社交平台解析内容可能很长，不能永久占用 prompt。当前使用轮次衰减：

- 从该链接消息开始计数。
- 后续每出现一次“至少一条 user 消息之后接到 assistant 回复”，算 1 组 user-char 对话。
- 同一次 assistant 回复拆成多条气泡不额外计数。
- 重 roll 是替换同一段 assistant 回复，不增加新消息轮次，因此不额外计数。
- 达到 6 组后，该链接在 prompt 中改写成短占位：

```text
[标题-正文前15字.xhs]
[标题-正文前15字.dy]
[标题-正文前15字.wx]
[标题-正文前15字.wb]
```

聊天记录本身不删全文、不删评论、不删本地封面；只是 prompt 装配时隐藏。

同时，链接封面作为多模态附件发送时也会检查衰减状态：超过 6 组后的平台链接不再把历史封面塞进本次请求。

## 调试信号

后端日志：

```text
[link-preview xhs] finalUrl=... htmlLen=... hasState=true hasNote=true blocked=false
[link-preview jina] target=... key #1
[link-preview jina] key #1 额度/限流（HTTP 429），尝试下一个 key
[link-preview jina] 切到 key #2 成功
[link-preview image cache failed] ...
```

返回字段：

- `source: "frontend-xhs-state"` 前端解析成功
- `source: "xhs-state"` 后端小红书 state 解析成功
- `source: "xhs-og"` 小红书 OG 兜底
- `source: "douyin-html"` 抖音 HTML/meta 解析成功
- `source: "douyin-shared-text"` 抖音退到分享文案
- `source: "wechat-html"` 微信公众号正文解析成功
- `source: "wechat-og"` 微信公众号 OG/meta 兜底
- `source: "weibo-og"` 微博 OG 解析成功
- `source: "weibo-limited"` 微博受限或解析失败
- `source: "jina"` Jina 兜底
- `source: "xhs-limited"` 小红书受限或解析失败
- `limitedReason` 展示具体失败原因

### Jina Token 多 key 轮换

`linkPreview_jinaToken` 这一个设置字段现在可以填多个 key，用逗号或空白分隔。`tryJinaReader` 依次尝试：

- 命中 401/402/403/429（额度耗尽/限流/鉴权失败）才切下一个 key 重试。
- 网络错误或其他状态码直接放弃，不消耗后面的 key（这类错误换 key 也没用）。
- 一个 key 都没配时，仍会匿名试一次（免费档，限速更严）。
- 所有 key 都失败后返回 `null`，上层照常走各平台自己的兜底（分享文案 / `xhs-limited` / `weibo-limited` 等）。

## 常见故障

### 前端完全不调用解析

旧问题：只识别 `http://` / `https://`，裸短链 `xhslink.com/o/...` 不会触发解析。

修法：前端和后端都接受裸 URL，并自动补 `https://`。

### VPS 上抓不到，家宽能抓到

小红书对机房 IP 有风控。后端部署在 VPS 时，出口 IP 是 VPS，不是用户家宽。前端直抓才是用户家宽，但会被 CORS 拦。

处理顺序：

```text
前端直抓 -> 后端直抓 -> Jina Reader -> 分享文案兜底
```

### 卡片无图

排查：

- 后端返回是否有 `image`
- 后端返回是否有 `imageLocal`
- `imageLocal` 文件是否存在于 `data/assets/link-previews/`
- 浏览器是否能访问 `/data/assets/link-previews/xxx.jpg`

### AI 看不到图

只显示卡片图不等于 AI 看图。必须确认 `/api/qq/reply` 中最近链接卡片的 `imageLocal` 被转成 data URL，并作为 `image_url` 放入 messages。

### 评论不足 10 条

不是 bug。当前只读取首屏 state 已下发的评论。页面里没有展开够 10 条时，只返回实际拿到的数量。

## 维护建议

- 不要为了卡片美观裁剪 `description`，视觉裁剪用 CSS。
- 不要删除话题标签，标签是正文语义的一部分。
- 不要把图片 URL 当作 AI 可读图片。
- 不要为了评论数硬凑或猜测，拿不到就返回空数组。
- 图片缓存目录属于用户数据，应留在 `data/` 下，不提交 Git。
- 若未来要抓更多评论，应新增独立的平台评论接口适配层，并处理登录态、签名、限流和风控失败提示。
- 若未来要让 AI 理解抖音视频内容，需要新增视频下载/抽帧/转写流程；当前只处理文本和封面图。
