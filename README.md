# 🧭 随行导览

> 走到哪里，就显示当地的景点、美食、酒店和攻略。
> 一套代码，两种形态：**Android App**（WebView 壳 + H5）+ **电脑网页版**。

基于**高德地图**的旅游导览应用。支持全国任意地点搜索、周边推荐、图片大图查看、一键路线规划（驾车 / 步行 / **公交地铁换乘**）。

---

## ✨ 功能

| 功能 | 说明 |
|---|---|
| 🔍 **全国搜索** | 搜任意地点（故宫 / 西湖 / 如家），全国结果打点 + 列表 |
| 📂 **五大分类** | 🏞️ 景点 · 🍜 美食 · 🛍️ 商场 · 🏨 酒店 · 📖 攻略 |
| 📍 **周边推荐** | 按当前位置搜索半径内 POI，移动超阈值自动刷新 |
| 🖼️ **图片查看器** | 详情图片点击放大，支持滚轮缩放、拖拽、双击、双指捏合 |
| 🧭 **一键规划路线** | 多个地点加入行程，自动最近邻排序，生成路线 + 总里程耗时 |
| 🚇 **三种出行方式** | 驾车（蓝）/ 步行（绿）/ **公交地铁（橙）**，地铁模式显示换乘方案与上下车站 |
| 🗺️ **地图内导航** | 直接在地图上画路线，不跳出 App |
| 📱 **行程抽屉** | 底部抽屉式面板，可下拉收起不挡地图 |
| 🏪 **周边好店** | 详情页列出周边美食/店铺，点击可查看详情 |
| ⭐ **携程查价** | 跳转携程看真实价格（可选带联盟追踪参数） |

---

## 🚀 快速开始

### 方式一：直接用网页版（最简单，无需构建）

```bash
node build_standalone.js
```

会生成 `suixing-web.html`（HTML/CSS/JS 全内联的单文件），**双击用浏览器打开即可**，也可以直接部署到任意静态托管。

> ⚠️ 打开前记得先填好 Key（见下一步）。

### 方式二：构建 Android APK

```bash
# 1. 按需指定本机路径（可选，脚本有默认值）
export ANDROID_HOME=$HOME/Android/Sdk
export GRADLE_BIN=/opt/gradle-8.9/bin/gradle

# 2. 构建
bash build_apk.sh
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

> APK 本体很小（约 40KB），因为它只是个 WebView 壳，真正的界面逻辑在 `webapp/` 里的 H5。

---

## 🔑 申请高德 Key（必做）

代码里的 Key 已替换为占位符，**必须替换成你自己的才能出图**。免费申请，约 5 分钟。

### 1. 注册并创建应用

1. 打开 [高德开放平台控制台](https://console.amap.com/)，注册/登录
2. 进入「应用管理 → 我的应用」→ 点「**创建新应用**」，名称随便填（如 `随行导览`）
3. 在应用下点「**添加 Key**」

### 2. 申请两个 Key

| Key 类型 | 服务平台 | 填到代码哪里 | 作用 |
|---|---|---|---|
| **JS API Key** | `Web端(JS API)` | `AMAP_KEY` | 地图显示、POI 搜索（**必需**） |
| **Web服务 Key** | `Web服务` | `WEB_KEY` | 拉取更全的详情（图片/简介/人均）、路径规划（**强烈建议**） |

> 2021-12 之后申请的 Key 还会附带一个「**安全密钥 securityJsCode**」，一并填到 `SECURITY_CODE`。
> 老 Key 没有这一项，留空即可。

### 3. 修改配置

编辑 **`webapp/app.js`** 和 **`web-desktop/app.js`** 顶部的 `CONFIG`：

```js
const CONFIG = {
  AMAP_KEY:      '你的JS_API_Key',        // ← 必填
  SECURITY_CODE: '你的安全密钥',           // ← 新 Key 必填，老 Key 留空 ''
  WEB_KEY:       '你的Web服务Key',         // ← 建议填
  ...
};
```

**两个文件都要改**（一个是手机版、一个是网页版）。

### 4. 设置域名白名单（重要）

JS API Key 在控制台的「**域名白名单**」要设为 `*`：

- Android WebView 加载的是 `file://` 协议，来源为空，不设 `*` 会白屏
- 本地开发用 `localhost` 打开也需要放行

---

## 📁 目录结构

```
├── web-desktop/          # 电脑网页版源码（左列表 + 右地图）
│   ├── index.html
│   ├── styles.css
│   └── app.js            # ← CONFIG 在这里
├── webapp/               # 手机版 H5（打进 APK 的界面，手机布局）
│   ├── index.html
│   ├── styles.css
│   └── app.js            # ← CONFIG 也在这里
├── android/              # Android 工程（WebView 壳）
│   └── app/src/main/
│       ├── java/.../MainActivity.java
│       └── res/
├── build_standalone.js   # 网页版打包成单文件 HTML
├── build_apk.sh          # 构建 APK（会自动同步 webapp → assets）
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

> `webapp/` 和 `web-desktop/` 功能一致，只是布局不同（手机 vs 桌面）。
> 改功能时**两边都要同步改**，`build_apk.sh` 只把 `webapp/` 打进 APK。

---

## 🛠 技术栈

- **地图**：高德地图 JS API（路径规划、POI 搜索、周边推荐、公交地铁换乘）
- **前端**：原生 HTML / CSS / JavaScript，零框架依赖
- **Android**：WebView 壳 + Gradle 构建

---

## ⚠️ 常见问题

**Q：地图白屏 / 提示 `INVALID_USER_SCODE`？**
A：新申请的 Key 需要安全密钥，把 `securityJsCode` 填到 `SECURITY_CODE`。

**Q：APK 装好后地图出不来？**
A：JS API Key 的域名白名单要设 `*`（WebView 用 `file://` 协议）。

**Q：详情里的图片/简介很少？**
A：没填 `WEB_KEY`（Web服务 Key）。填了会走高德详情接口，数据全很多。

**Q：公交地铁模式画的是直线？**
A：该区间无公交/地铁覆盖（常见于偏远景区），会自动回退成直线估算，属正常降级。

---

## 📄 开源许可

[MIT License](LICENSE) — 可自由使用、修改、商用，只需保留版权声明。

地图数据版权归高德所有，使用需遵守高德开放平台服务条款。
