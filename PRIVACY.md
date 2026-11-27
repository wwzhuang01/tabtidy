# Privacy Policy — TabTidy

*Last updated: November 27, 2026*

## Summary

**TabTidy runs 100% locally in your browser.** It makes **zero network requests**, collects **zero analytics or telemetry**, requires **no account**, and never transmits your browsing history, tab titles, URLs, or Tab Group names anywhere.

## Data Storage

All extension state is stored strictly inside your local Chrome profile using standard Chrome Extension storage APIs:

- `chrome.storage.local`: Stores your settings (sleep/close thresholds, deduplication preferences, domain whitelist), per-tab last-active timestamps, session locks, and the local Corral archive of tabs closed by TabTidy.
- `chrome.storage.session`: Stores short-lived runtime initialization flags and new-tab duplicate-check timestamps for the current browser session only.

You can clear all stored history at any time from the **Corral** tab ("Clear Corral") or remove all data completely by uninstalling the extension.

## Permissions Explained

TabTidy requests only the minimum Manifest V3 permissions required for its features:

| Permission | Why It Is Needed |
| :--- | :--- |
| `tabs` | Read open tabs across windows, switch/focus tabs on click, discard (sleep) idle tabs to free memory, and close duplicate or expired tabs. |
| `tabGroups` | Read Chrome Tab Group names, colors, and collapse state for display, and restore archived tabs back into their original groups. |
| `storage` | Persist your preferences, idle timestamps, and local Corral recovery list inside your Chrome profile. |
| `alarms` | Schedule the lightweight 1-minute background sweep safely under Manifest V3 without keeping a background page permanently alive. |
| `sidePanel` | Display TabTidy inside Chrome's native Side Panel. |

TabTidy does **not** request host permissions (`<all_urls>`), does **not** inject content scripts into web pages, and does **not** communicate with any external server.

---

# 隐私政策 — TabTidy

*最后更新：2026 年 11 月 27 日*

## 核心承诺

**TabTidy 完全在你的本地浏览器中运行。** 本扩展 **不发起任何网络请求**、**不收集任何统计或遥测数据**、**无需登录账号**，也不会将你的标签页标题、网址、浏览历史或分组名称上传到任何服务器。

## 本地存储说明

所有扩展数据仅保存在你当前的本地 Chrome 配置文件中：

- `chrome.storage.local`：保存你的自定义设置（休眠/关闭时长、去重偏好、白名单域名）、标签页最后活跃时间、锁定状态以及本地回收站（Corral）记录。
- `chrome.storage.session`：仅保存当前浏览器会话内的初始化标记和防重复检查临时状态，关闭浏览器后自动清除。

你可以随时在「回收站」页面一键清空历史记录，或通过卸载扩展彻底删除所有本地数据。

## 权限说明

TabTidy 仅申请实现核心功能所必需的最小 Manifest V3 权限，**不申请网站主机权限，不向网页注入任何脚本**：

| 权限 | 用途 |
| :--- | :--- |
| `tabs` | 读取各窗口已打开的标签页、点击跨窗口切换聚焦、休眠闲置标签页释放内存，以及关闭重复或超时标签页。 |
| `tabGroups` | 读取 Chrome 原生标签分组的名称、颜色与折叠状态，并在从回收站恢复时将页面归回原分组。 |
| `storage` | 在本地 Chrome 配置中保存设置、活跃时间戳和回收站记录。 |
| `alarms` | 按 Manifest V3 规范每分钟触发一次轻量闲置巡检，不常驻后台消耗资源。 |
| `sidePanel` | 在 Chrome 原生侧边栏中展示 TabTidy 界面。 |
