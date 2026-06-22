# 小红书链接解析技术笔记

本文记录 BunnyOS 里小红书链接解析的实现经验，覆盖正文、封面图、评论、前端/后端抓取顺序，以及 AI 可读图片的处理方式。

## 目标

用户在 QQ 聊天输入小红书分享链接后，系统应生成一张链接卡片，并尽量把可用内容传给 AI：

- 识别裸短链，例如 `xhslink.com/o/...`，不要求用户手动补 `https://`
- 跟随短链跳转到真实 `xiaohongshu.com/discovery/item/...`
- 解析笔记标题、正文全文、话题标签
- 解析封面图，并缓存成本地静态文件用于卡片显示
- 将封面图作为多模态图片附件发给 AI，而不是只把图片 URL 发给 AI
- 解析页面首屏状态里能拿到的前 10 条评论，包含楼中楼回复
- 发给 AI 的小红书解析内容用 `<xhs>...</xhs>` 包裹
- 6 组 user-char 对话后，旧小红书内容从 prompt 中衰减为 `[标题-正文前15字.xhs]`
- 原生抓取失败时再走 Jina Reader 兜底

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
6. 如果最终 host 是小红书，走 `parseXhsFromHtml`。
7. 小红书原生失败后，才走 Jina Reader。
8. 返回前统一经过 `sendPreview`，尝试下载封面到本地。

## 前端抓取的现实限制

前端抓取的出口 IP 是用户当前设备网络，理论上可能绕过 VPS 机房 IP 风控。但浏览器会受这些限制：

- CORS 阻止跨域读取 HTML
- 跳转链可能被浏览器安全策略拦截
- 登录态 cookies 未必能跨站带上
- 小红书页面脚本/风控可能不下发完整 state

实测从 `http://127.0.0.1:3000` 前端直接 `fetch('https://xhslink.com/o/...')` 会返回 `TypeError: Failed to fetch`。因此前端只是第一机会，不可作为主可靠方案。

## 正文解析

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
- 缓存有自动清理上限：默认最多 100MB、最多 500 个文件，按最旧访问/修改时间删除。

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

## 给 AI 的文本

`qqMessageToText(msg)` 对小红书 `type: "link"` 生成文本：

```text
<xhs>
标题：...
描述：...
评论前N条：1. ... / 2. ...
站点：小红书
</xhs>
```

刻意不包含：

- 原链接 URL
- 封面图 URL
- 评论图片 URL

原因是 AI 不能从 URL 直接读取视觉内容，发 URL 反而会增加噪声。封面图通过多模态附件发送。

### 6 组后衰减

小红书解析内容可能很长，不能永久占用 prompt。当前使用轮次衰减：

- 从该 XHS 链接消息开始计数。
- 后续每出现一次“至少一条 user 消息之后接到 assistant 回复”，算 1 组 user-char 对话。
- 同一次 assistant 回复拆成多条气泡不额外计数。
- 重 roll 是替换同一段 assistant 回复，不增加新消息轮次，因此不额外计数。
- 达到 6 组后，该 XHS 链接在 prompt 中改写成短占位：

```text
[标题-正文前15字.xhs]
```

聊天记录本身不删全文、不删评论、不删本地封面；只是 prompt 装配时隐藏。

## 调试信号

后端日志：

```text
[link-preview xhs] finalUrl=... htmlLen=... hasState=true hasNote=true blocked=false
[link-preview jina] target=... token=yes
[link-preview image cache failed] ...
```

返回字段：

- `source: "frontend-xhs-state"` 前端解析成功
- `source: "xhs-state"` 后端小红书 state 解析成功
- `source: "xhs-og"` 小红书 OG 兜底
- `source: "jina"` Jina 兜底
- `source: "xhs-limited"` 小红书受限或解析失败
- `limitedReason` 展示具体失败原因

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
- 若未来要抓更多评论，应新增独立的 XHS 评论接口适配层，并处理登录态、签名、限流和风控失败提示。
