# HTTPS 测试网站

公共入口：https://pfct-nutrition-test.tasty-guppy-6736.chatgpt.site/login.html

Sites 项目 ID：`appgprj_6adb66c4c2e08191814e292411c8b64a`。网站设为 public，访问网页无需 ChatGPT 账号，真实数据仍由 Supabase 登录和 RLS 控制。连接现有开发数据库，记录与本地页面共享。仅用于开发测试，研究同意流程尚未完成。

## 状态与下一步

已验证公共登录页、角色切换和用户演示入口。已有账号使用原邮箱和密码登录。Node 的 14 项测试通过；尚未在公共域名重新验证完整注册与上传流程，也未验证国内外网络可用性。

注册开放且需要邮箱确认。当前 CLI 账号修改认证 URL 返回 403，控制台对应字段也不可编辑。项目 Owner 或有相应权限的管理员需在 Authentication → URL Configuration 中设置：

- Site URL：`https://pfct-nutrition-test.tasty-guppy-6736.chatgpt.site/login.html`
- Redirect URLs：添加同一个完整地址；本地开发可另保留 `http://127.0.0.1:8080/login.html` 和 `http://localhost:8080/login.html`。

没有关闭邮箱确认或修改其他认证设置。完成后需用测试者邮箱验证邮件送达及确认跳转，外部邮箱的邮件投递配置仍需实际检查。

## 更新网站

源码在 `web/`。`public-config.mjs` 仅保存公开项目地址和 publishable / anon key，禁止写入 secret、service_role 或 FatSecret 凭证。

Sites checkout 在 `work/pfct-public/`，其 `.openai/hosting.json` 保存项目身份，`dist/` 仅包含 `web/` 的 HTML、JS、MJS 和 CSS，不含 `.env`、用户照片或数据库导出。更新时复用同一项目 ID，将最新网页复制到 `dist/`，使用 Sites source helper 同步打包，再保存版本和部署。GitHub 提交不会自动更新 Sites 网站。

首次发布版本：1，源码提交 `b598611657c9c0d29468347a1ea58457519ceca3`。
