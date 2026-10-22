# PFCT HTML 测试页面

无第三方前端依赖，HTML + CSS + JavaScript，适配电脑与手机。此页用于开发联调，不应直接开放给研究参与者。

## 打开

从仓库根目录运行：

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

浏览器访问 `http://127.0.0.1:8080/login.html`，停止服务按 Ctrl+C。用户登录进入 index.html，管理员登录进入 admin.html。使用 `scripts/build-preview.py` 生成的三页内联 HTML 包可解压后直接打开 login.html 演示；真实接口联调推荐通过本地 HTTP 服务运行。

## 两种模式

- 用户演示：在登录页选择“体验用户演示”，选择照片、输入猜测、按包装标签计算对比。图片不上传，餐食记录仅在当前页内存，刷新即清空。不生成模拟营养答案或 Perfect。
- 管理员演示：在登录页切换管理员入口，点击体验；仅展示合成的用户与餐食样本。
- Supabase 联调：在登录页展开“开发环境连接”，填写项目根地址与 publishable / legacy anon key，再注册或登录。会话与公开配置保存在当前标签页的 sessionStorage，退出清除；密码不保存。禁止填写 secret / service_role key。需要事先应用仓库迁移；页面不会执行迁移。管理员还需要数据库所有者授权，见 `docs/admin-workspace.md`。

真实模式按顺序创建餐食、上传私有图片、登记照片、保存猜测；失败后保留此次操作 ID 与阶段，在原页面重试可以避免重复记录。刷新页面会失去尚未完成的重试状态；当前没有后台恢复或自动清理孤立记录的功能。

列表显示最新 20 餐；照片使用五分钟签名 URL，过期后点击“刷新记录”。手动份量功能需要新增迁移和 `food-reference` 函数，具体见 `docs/manual-food-confirmation.md`。当前 FatSecret 计算结果只在内存展示，不永久保存名称和营养值；历史确认可重新查询，页面明确标记重算。尚未实现图片自动识别、Perfect 规则、个人习惯设置和研究同意流程。

## 已验证范围

JavaScript 语法、HTML 控件引用、原始演示保存、缺少照片提示、防重复保存、新建餐食与 390px 窄屏布局已检查。份量计算与服务端身份验证有 Node 自动测试；云端登录/上传/FatSecret 查询仍需在配置好的开发项目中实际联调。
