<div align="center">
  <img src="icons/icon128.png" alt="TabTidy 图标" width="108" height="108" />
  <h1>TabTidy</h1>
  <p><strong>轻量级 Chrome 侧边栏标签页管理扩展：原生分组导航、智能去重、分级自动休眠与分组级回收恢复。</strong></p>
  <p>
    <a href="https://wwzhuang01.github.io/tabtidy/"><strong>项目主页</strong></a> ·
    <a href="README.md">English</a> ·
    <a href="#核心功能">核心功能</a> ·
    <a href="#整理规则">整理规则</a> ·
    <a href="#安装与打开">安装与打开</a> ·
    <a href="#隐私与本地运行">隐私保障</a> ·
    <a href="#项目结构与测试">开发与测试</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Chrome-116%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome 116+" />
    <img src="https://img.shields.io/badge/Manifest-V3-34D399?style=flat-square" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/外部依赖-零依赖-F59E0B?style=flat-square" alt="零依赖" />
    <img src="https://img.shields.io/badge/License-MIT-60A5FA?style=flat-square" alt="MIT License" />
  </p>
</div>

---

**TabTidy** 将「按 Chrome 分组管理的侧边栏列表」「重复标签去重」与「闲置自动休眠/收起」合三为一，直接运行在 Chrome 原生 **Side Panel（侧边栏）** 中——**零构建步骤、零第三方运行时依赖、100% 本地运行**。

专为重度使用 **Chrome Tab Groups（标签页分组）**、经常重复开页面或被内存爆满困扰的用户打造。

## 核心功能

- **完整展示 Chrome 分组名称与配色**：按 **窗口 → 已固定 → Chrome 标签分组（保留原分组名称、官方配色圆点与同色左侧竖条）→ 未分组** 清晰归类，支持顶部一键 **全部展开 / 全部收起**。
- **跨窗口秒搜与一键跳转**：支持跨所有 Chrome 窗口实时搜索 **标题、网址与分组名**，点击任意条目即可直接切换标签页并拉起对应窗口。
- **智能重复检测与一键去重**：
  - 支持可配置的网址规范化（默认忽略 `#锚点` 与末尾斜杠，适合飞书文档等场景；可选忽略 `?查询参数`）。
  - 去重时按智能优先级保留最佳副本：**当前聚焦活跃 > 活跃 > 已固定 > 已锁定 > 有名分组 > 分组内 > 最近访问**。
  - 支持整批/单组一键去重，以及可选的「**打开重复页面时自动跳转并关闭副本**」开关。
- **普通页与分组页独立分级休眠 / 关闭**：
  - **普通（未分组）标签页**：默认闲置 **15 分钟** 自动休眠释放内存（设为 `0` 可关闭休眠），**60 分钟** 后自动收起进回收站。
  - **分组（Group 内）标签页**：默认闲置 **30 分钟** 自动休眠（留在原分组不破坏结构），**24 小时** 后移入回收站；也可开启「**分组内标签页仅休眠**」永不自动关闭。
- **保留分组记忆的回收站（Corral）**：由 TabTidy 自动收起、去重或手动关闭的标签页均会保存在本地回收站（最多 500 条），并完整记录原 **分组名称与颜色**。点击恢复时会自动归回当前窗口同名分组，若分组已关则自动按原名原色重建。
- **多重安全护栏防误杀**：自动整理永远跳过活跃页、固定页（Pinned）、正在播放声音的页面（会议/音乐）、手动锁定的标签/分组/窗口、白名单域名与浏览器内部页，并在达到「最少保留标签数」后停止自动关闭。
- **自动适配浅色 / 深色与中英双语**：随系统与 Chrome 外观自动切换，内置 **中 / 英双语界面**（默认跟随浏览器，可在「设置 → 通用 → 界面语言」中实时切换），专为窄幅侧边栏（320px+）排版优化。

## 整理规则

| 标签类型 | 闲置后自动休眠（释放内存） | 闲置后自动关闭（移入回收站） | 可配置项 |
| :--- | :--- | :--- | :--- |
| **普通标签页** | `15 分钟`（设为 `0` 可关闭） | `60 分钟` | 在「设置」中独立调整 |
| **分组标签页** | `30 分钟` | `24 小时`（或开启 **仅休眠**） | 独立时长 + 仅休眠开关 |

- 后台基于 Manifest V3 `chrome.alarms` **每 1 分钟** 轻量巡检一次，不常驻后台，几乎零资源开销。
- 顶部随时可点 **暂停 / 恢复** 暂停自动整理，或点击 **立即整理** 立刻按当前规则扫一遍。
- 单页 / 整组 / 整窗锁定在当前 Chrome 会话内有效，防止重要页面被自动休眠或收起。

### 快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| **`⌘ + Shift + E`**（macOS）/ **`Ctrl + Shift + E`**（Windows/Linux） | 呼出 TabTidy 侧边栏（可在 `chrome://extensions/shortcuts` 自定义） |
| **`/`** | 在「标签页」或「回收站」中快速聚焦搜索框 |
| **`Esc`** | 清空当前搜索关键词 |

## 安装与打开

无需构建，无需安装任何 npm 依赖，Chrome 116 及以上版本直接加载即可：

1. 克隆本仓库到本地：
   ```sh
   git clone https://github.com/wwzhuang01/tabtidy.git
   ```
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择刚才克隆的 `tabtidy` 目录。
5. 点击浏览器工具栏的 **TabTidy** 图标，或按 **`⌘⇧E`** / **`Ctrl+Shift+E`** 即可打开侧边栏。

## 隐私与本地运行

**100% 纯本地运行，零网络请求。** TabTidy 不申请任何网站主机权限，不向网页注入任何内容脚本，不会上传你的网址、标题、分组名或浏览习惯。所有配置与回收记录仅保存在你当前的本地 Chrome 配置中。

详细权限说明请查看 [PRIVACY.md](PRIVACY.md)。

## 项目结构与测试

```text
tabtidy/
├── manifest.json          # Chrome Manifest V3 扩展配置
├── sidepanel.html         # 侧边栏入口页面
├── icons/                 # 主 SVG 与 16/32/48/128px PNG 图标
├── src/
│   ├── background.js      # 后台服务、定时巡检、Chrome API 与消息处理
│   ├── sidepanel.js       # 侧边栏 UI 与 Chrome 实时事件同步
│   ├── sidepanel.css      # 浅色/深色主题与 Chromium 官方分组配色
│   └── core/
│       ├── url.js         # 网址规范化、重复聚合与保留优先级算法
│       ├── policy.js      # 分级闲置休眠/关闭引擎与设置校验
│       ├── locks.js       # 标签页 / 分组 / 窗口锁定判断
│       └── corral.js      # 回收站去重、上限裁剪与搜索
├── tests/                 # Node.js 内置测试套件
├── docs/                  # 中英双语静态项目主页（支持 GitHub Pages）
├── PRIVACY.md             # 本地隐私政策说明
└── package.json           # 测试脚本（零外部依赖）
```

使用 Node.js 18 或以上版本运行单元测试：

```sh
npm test
```

## 关于「已保存但关闭的标签组」的说明

受限于 Chromium 扩展 API（`chrome.tabGroups`），扩展目前只能读取**当前已打开**（含折叠状态）的标签组，无法读取仅保存在书签栏上的已关闭分组。建议将常用任务分组保持打开并配合 TabTidy 的自动休眠功能，既省内存又能随时按分组搜索一键跳转。

## 许可证

[MIT](LICENSE) © 2026 wwzhuang01
