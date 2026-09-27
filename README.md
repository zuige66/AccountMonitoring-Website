# Gate Pulse

Gate Pulse 是一个在本机运行的 Gate 永续合约仓位与盈亏仪表盘。

- 前端：原生 HTML、CSS 和 JavaScript
- 后端：Node.js 内置模块，无需安装第三方依赖
- 数据：Gate API v4，同步后保存在本地 SQLite（`data/gate-pulse.db`）
- 默认地址：`http://localhost:4173`

## 功能

- 账户资产、钱包余额、今日收益和预估收益率
- 当前多空仓位、浮动盈亏、开仓价、标记价和强平价
- 1天、7天、1月及全部收益曲线
- 单日盈亏日历
- 按币种汇总平仓盈亏、手续费、资金费和浮动盈亏
- 完全平仓和部分平仓历史
- 风险评分、最大回撤及盈利天数
- 每 60 秒自动更新数据

## 环境要求

- Node.js 22.5 或更高版本（需要内置的 `node:sqlite`）
- Gate 只读 API Key（查看真实账户时需要）

本项目没有第三方 npm 依赖，因此不需要运行 `npm install`。

## 本地启动

1. 安装 [Node.js](https://nodejs.org/)。
2. 下载或解压项目。
3. 在项目目录打开 PowerShell 或终端。
4. 启动服务：

```powershell
node server.js
```

也可以运行：

```powershell
npm start
```

5. 浏览器打开：

```text
http://localhost:4173
```

未配置密钥时，页面会显示演示数据。

## 配置自己的 Gate 账户

Windows PowerShell：

```powershell
Copy-Item .env.example .env
notepad .env
```

macOS 或 Linux：

```bash
cp .env.example .env
```

在 `.env` 中填写自己的密钥：

```env
GATE_API_KEY=your_read_only_api_key
GATE_API_SECRET=your_api_secret
GATE_SETTLE=usdt
GATE_BASE_URL=https://api.gateio.ws/api/v4
PORT=4173
```

保存后重新运行 `node server.js`。

## API Key 安全要求

API Key 应当：

- 只开启永续合约读取权限
- 关闭交易权限
- 关闭提现权限
- 尽可能配置本机 IP 白名单
- 每位使用者使用自己的密钥

不要把 API Key 或 Secret 写进 `public/` 下的 HTML、CSS 或 JavaScript。浏览器中的代码和网络请求都可以被查看，无法安全保存 Secret。

本项目只在本地 Node.js 后端读取 `.env`，不会把 Gate Secret 返回给浏览器。

## 打包 ZIP 发给别人

可以将项目压缩后发给其他人。压缩包应包含：

```text
public/
server.js
package.json
README.md
.env.example
.gitignore
```

不要包含：

```text
.env
node_modules/
*.log
```

收到 ZIP 的用户按照“本地启动”和“配置自己的 Gate 账户”操作即可。

## 上传到 GitHub

项目源代码可以上传到 GitHub，包括公开仓库，但绝对不能上传真实的 `.env`。

当前 `.gitignore` 已忽略 `.env` 和常见的环境变量文件，同时保留只有占位符的 `.env.example`。

首次上传示例：

```powershell
git init
git add .
git status
git commit -m "Initial Gate Pulse dashboard"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

在执行 `git commit` 前，务必运行 `git status`，确认列表中没有 `.env`。

如果真实密钥曾经被提交过，仅仅加入 `.gitignore` 并不能从 Git 历史中删除它。应立即在 Gate 后台撤销并重新生成密钥，然后再清理仓库历史。

## GitHub Pages 限制

GitHub Pages 只能托管静态 HTML、CSS 和 JavaScript，不能运行本项目的 `server.js`，也不能安全保存 Gate Secret。

因此：

- 可以把源代码存放在 GitHub。
- 不能只依靠 GitHub Pages 运行真实账户版本。
- 每位用户可以从 GitHub 下载后，在自己的电脑上运行 Node.js 后端。
- 如果需要公网版本，前端和后端必须分别部署，并为后端增加 HTTPS、用户认证、密钥加密存储和访问隔离。

## 是否让用户在网页中输入密钥

本地使用时不是必须的，使用 `.env` 最简单，也更容易确认密钥只保存在自己的电脑上。

如果以后增加首次启动配置页面，应遵守以下原则：

- 输入内容提交给本机 Node.js 后端，不能由前端直接调用 Gate 私有接口。
- Secret 不能写入浏览器的 `localStorage`、Cookie 或前端源代码。
- 已存在本地 `.env` 时直接进入仪表盘，不显示配置页面。
- 没有 `.env` 时才显示配置页面，并由用户决定仅在内存中使用或保存到本机。
- 公网部署时不能让陌生用户把 Gate Secret 提交到没有完整安全措施的服务器。

## 数据口径

- 当前仓位和浮动盈亏：Gate futures positions（每次实时读取）
- 账户流水和成交先同步到本地 SQLite（`data/gate-pulse.db`），再从本地读取
  - `account_book` 按 `from/to` 分段回填历史，之后每次增量同步（默认回填最近 90 天，可用 `GATE_HISTORY_START=2026-08-21` 指定起点）
  - `my_trades` 官方接口只返回最近约 30 天且忽略时间参数，因此从启用本功能起滚动收录，更早的成交无法从 API 取回
- 平仓盈亏、手续费和资金费：同步后的账户流水
- 完全及部分平仓：同步后的成交明细 `close_size`
- 单日盈亏：账户流水按本地日期聚合，不包含充提
- 1天收益曲线：最近 24 小时逐笔账户流水
- 月度和年度预估收益率：最近最多 30 天平均每日净收益，以当前钱包余额为本金折算，仅供参考

## 免责声明

页面数据仅供个人记录和参考，不构成投资建议。预估收益率不代表未来收益。
