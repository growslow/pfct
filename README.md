# PFCT 后端

面向营养认知学习 App 的 Supabase / PostgreSQL 初始骨架。当前实现账户关联、用户习惯历史、餐食、私有照片、PFCT 猜测，以及供后端写入的营养参考结果与反馈。

**当前状态：初始骨架已准备，本地 CLI 已关联 Supabase 开发项目；数据库迁移尚未应用到云端。** 已配置 GitHub Actions，实际验证结果请查看对应提交的 Actions 运行记录。照片识别、FatSecret 调用、Perfect 规则、研究导出和账户退出/数据清理流程尚未实现。没有生成模拟分析结果。

## GitHub 自动测试

打开仓库的 **Actions → Backend tests**。推送到 main、创建或更新 PR 时自动运行，也可以点击 **Run workflow** 手动运行。

工作流在 GitHub 临时机器上启动独立 Supabase，应用迁移、检查数据库函数，并执行 `supabase/tests/access.sql` 的权限断言。无需配置云端 Supabase 密钥，不会连接或修改你的云端项目。

- 绿色：本次数据库迁移与所覆盖的权限检查通过。
- 红色：展开失败步骤查看日志；失败后的数据库日志用于排查。
- 测试会创建两名临时用户，验证本人读写、跨用户隔离、历史记录保护、参考结果写入限制，以及照片元数据的访问权限。

这不是可操作的网页，也不覆盖真实图片上传、移动端登录、FatSecret、AI 识别或游戏反馈。那些功能需要后续接口与页面联调测试。

## 架构

```text
iOS / Android
  ├─ Supabase Auth：注册、登录、访问令牌
  ├─ Supabase Data API → PostgreSQL + RLS：本人数据
  └─ Supabase Storage：私有餐食照片

后续可信服务 / Edge Functions
  ├─ 图片识别与用户确认
  ├─ FatSecret：食物匹配与营养计算
  └─ 写入 nutrition_estimates / feedback
```

初期不必再搭一套通用 CRUD 服务。客户端以 publishable key + 用户 JWT 访问 Supabase，数据库通过 RLS 隔离用户。FatSecret secret 和 Supabase service role key 只能放在服务端。

## 本地启动

前置依赖：Supabase CLI、Docker；运行数据库权限测试还需要 `psql`。安装方式见 [Supabase 本地开发文档](https://supabase.com/docs/guides/local-development)。

在此目录执行：

```sh
supabase start
supabase status
cp .env.example .env
```

把本地 URL 与 publishable key 填入 `.env`。本地注册需要确认邮箱，在 Supabase 启动输出显示的邮件测试页面读取确认邮件。配置中的 localhost 回调仅供本地使用；原生 App 接入时配置真实 deep link。

迁移文件会在首次启动时应用。只在**可丢弃的本地数据库**上使用 `supabase db reset`，该命令会清空本地数据并重建。

```sh
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -v ON_ERROR_STOP=1 -f supabase/tests/access.sql
supabase db lint --local
```

测试在事务中创建两个账户，验证数据隔离、跨用户写入、客户端修改历史和伪造参考答案的限制，完成后回滚。

## 连接云端开发项目

先在你自己的 Supabase 账户创建**开发项目**，再执行：

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

迁移会创建数据表、注册触发器、RLS 和私有图片 bucket。`config.toml` 是本地配置，云端 Auth、邮件、redirect URLs 等仍需在项目设置中单独配置。不要将现有生产项目作为初次测试目标。

## 数据设计

| 表 | 用途 | 客户端权限 |
| --- | --- | --- |
| participants | Auth 账户映射到独立研究参与者 ID | 本人读取 |
| profile_versions | 语言、时区、饮食习惯的历史快照 | 本人读取、追加 |
| consent_events | 研究同意与撤回事件 | 本人读取、追加 |
| meals | 餐次、用餐时间、当地时区 | 本人读取、追加 |
| meal_photos | 图片路径与餐食关联 | 本人读取、追加 |
| guesses | 用户每次 PFCT 猜测 | 本人读取、追加 |
| nutrition_estimates | 参考估算与来源、方法版本 | 本人读取；可信后端写入 |
| feedback | 与具体猜测、参考结果关联的反馈 | 本人读取；可信后端写入 |

P/F/C 使用克，T 使用 kcal。四个数字独立保存，不强行以 P×4 + F×9 + C×4 覆盖用户的热量猜测。时间使用 `timestamptz`，另存 IANA 时区；按用户当地日期查询时，由客户端计算该日对应的 UTC 起止时间。

客户端不能更新、删除历史记录，也不能指定服务器 `created_at`。猜测修改采用新建记录；查询按 `created_at` 排序。研究原始导出需保留全部版本；以后汇总每日营养时必须先为每餐选定一个参考版本，不能把所有版本直接相加。

照片路径：`<participant_id>/<meal_id>/<随机文件名>.jpg`。bucket 非公开，只允许本人上传和读取；不允许客户端覆盖或删除。上传时使用 `upsert: false`。数据库路径校验不证明文件已上传，前端需在上传成功后登记；可信后端将来还需核验文件实际存在、格式与内容。

## 开发边界

- `consent_events` 目前仅记录事件，尚未强制同意流程、撤回后的研究排除或导出权限；接入真实研究参与者前必须完成。
- Auth 账户删除时保留研究 ID，解除账户关联。这个设计不等于已经实现匿名化或合规的数据删除。删除、保存期限、照片清理与退出研究流程需要单独实现，暂不开放真实用户自助注销。
- `provenance` 预留食物/份量 ID、确认后的重量、营养计算输入及可保存的数据来源版本；FatSecret 原始响应的保存范围需要按实际套餐条款确认后决定。
- 不设摄入目标、用户等级或默认 Perfect 阈值。反馈结果与规则版本由后续可信服务写入。
- 当前允许用户多次猜测，尚未限制看答案后的再次提交；分析学习效果时需区分首次猜测与后续尝试。严格的揭晓/猜测阶段门控留到下一步。
- 国内、海外部署区域尚未选定，当前代码不代表已验证两地服务可用性。

前端接口流程见 [docs/api.md](docs/api.md)。官方参考：[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Storage 访问控制](https://supabase.com/docs/guides/storage/security/access-control)、[FatSecret OAuth2](https://platform.fatsecret.com/docs/guides/authentication/oauth2)。
