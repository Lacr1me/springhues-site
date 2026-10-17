# Springhues

[springhues.com](https://springhues.com/) 的公开前端仓库：作品墙、每日简报页面与 SHARD 视觉系统。

纯静态站点：HTML、CSS、原生 JavaScript。不使用前端框架，也没有包管理器；Node.js 脚本只负责构建、校验和本地预览。

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.html` | 首页 |
| `site/` | 共享样式、脚本、作品清单 `works.json` |
| `works/` | 作品页面 |
| `game/`、`minsheng/` | 每日简报频道页 |
| `messages/`、`privacy/` | 留言页与隐私说明 |
| `data/`、`downloads/`、`game-brief-assets/` | 每日简报正文、导出图与配图 |
| `assets/`、`brand-assets/` | 首屏图、字体与品牌素材 |
| `vendor/lenis/` | 本地托管的 Lenis |
| `scripts/` | 构建、校验与本地预览 |

## 本地预览

```powershell
node scripts/serve.mjs
```

默认地址 `http://127.0.0.1:4173`，可用 `PORT` 环境变量换端口。

## 构建与校验

```powershell
node scripts/build-embedded.mjs
node scripts/test-home.mjs
node scripts/check-shard-style.mjs
node scripts/build-site.mjs
node scripts/verify-build.mjs
```

产物在 `dist/`。推送到 `main` 后由 GitHub Actions 构建并发布。

## 许可

代码采用 MIT 许可证，内容保留所有权利。具体范围见 [NOTICE.md](NOTICE.md)。
