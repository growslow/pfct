# 登录与研究管理台

入口 `web/login.html`；用户端 `web/index.html`；管理员端 `web/admin.html`。本地 HTTP 服务的根路径会跳转到登录页。默认提供用户/管理员两个演示入口，管理员演示仅使用合成样本，没有真实查询。

## 第一版数据呈现

- 总览：参与者记录、餐食、猜测次数、份量确认次数。包含开发测试和管理账户产生的参与者记录，不等同于正式招募人数。
- 用户列表：研究 ID、加入时间、餐食/猜测数量、最近餐食提交、当前同意事件状态；支持 ID 搜索、是否有餐食筛选、分页。
- 单用户时间线：实际用餐时间、提交时间、原时区、照片数量、全部猜测尝试、食物 ID / 份量确认，以及已有的历史参考/反馈。
- 单独查看习惯快照、研究同意/撤回历史。没有同意记录时显示“未记录”；撤回状态仍显示以支持后续退出流程管理，但本版本未实现研究导出排除。
- 不提供删除、修改原始数据、授予权限、CSV 批量导出或照片原图跨用户访问。

后续优先增加研究分组、可配置同意与退出流程、数据字典和经过授权的去标识化导出。先明确研究问题，再设计学习效果统计；目前没有可靠的历史 FatSecret 营养快照，不生成准确率排行榜或健康等级。

## 管理员授权

应用迁移 `20261022000200_research_admin.sql` 后，在 Supabase SQL Editor 使用数据库所有者身份，为**已注册的账户**添加管理员记录。将示例邮箱替换为你指定的实际管理员邮箱：

```sql
insert into public.app_admins(user_id)
select id from auth.users where lower(email)=lower('replace-with-admin@example.com')
on conflict(user_id) do nothing;
```

检查返回是否插入一条，邮箱不存在时不会自动创建用户。授权前确认该邮箱属于预期管理员。代码不自动授权首位注册用户，也不信任用户元数据里的 `role`、`is_admin` 或登录页选项。

撤销管理员权限：

```sql
delete from public.app_admins
where user_id in (select id from auth.users where lower(email)=lower('replace-with-admin@example.com'));
```

每次管理 RPC 都重新查询授权，撤销后原会话不能继续读取。不要把 service role key 填进浏览器。

## 后端结构

- `app_admins`：可信管理员名单，普通客户端不能读取或写入。
- `is_admin()`：只判断当前登录账户是否在名单中。
- `admin_overview()`、`admin_participants(...)`、`admin_participant_detail(...)`：固定、受限的只读数据接口，内部独立校验管理员。
- `admin_access_log`：记录管理员查询人、时间、操作与目标研究 ID，不记录密码、令牌或完整用户数据。

现有用户表 RLS 不开放给管理员随意跨用户查询。管理接口以受控数据库函数提供指定数据，注册或前端自填角色不能扩大权限。没有部署新迁移前，真实管理员登录应失败，不会退回演示数据冒充真实数据。

## 会话与构建

真实会话跨页面保存在当前标签页 `sessionStorage`，包含项目公开配置与用户会话令牌；退出会清除并尝试撤销服务端会话。刷新令牌在请求前续期。密码与 FatSecret Secret 不写入该存储。研究记录草稿仍只在页面内存。

```sh
python3 scripts/build-preview.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

构建产生 `outputs/pfct-preview.zip`（三个内联 HTML 页面）、`outputs/login.html`、`outputs/index.html`、`outputs/admin.html`。`outputs/pfct.html` 是登录页别名。解压后从 login.html 打开即可演示；真实登录推荐 localhost HTTP。不要只移动一个文件后期待另外两个页面仍可导航。

## 测试边界

`supabase/tests/admin_access.sql` 验证匿名和普通用户不能访问、自填管理员元数据无效、管理员可分页查看、保留全部猜测、普通数据 RLS 未被放宽、读取留痕及撤权立即生效。Node 测试验证公开密钥限制与会话刷新。真实注册、邮件、角色分配和云端登录仍需在部署后的开发项目联调。
