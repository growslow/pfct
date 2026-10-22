# 手动确认食物与份量

当前流程：先上传照片并保存原始 PFCT 猜测，再选择食物与标准份，输入实际重量或份数，计算参考结果。没有自动图片识别，也没有自定 Perfect 阈值。

## 无凭证也可测试的本地流程

```sh
python3 scripts/build-preview.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

打开 http://127.0.0.1:8080/login.html 并选择“体验用户演示”。保存猜测后，在“确认食物”填写实际包装标签、基准重量和食用重量，可添加多项后计算。这里的参考来源明确标为用户填写标签，不是 FatSecret；餐食数据仅在内存中。标签热量若是 kJ，先除以 4.184 转为 kcal。不要把自己的营养猜测再用作标签参考值。

## 接通真实 FatSecret

代码已实现服务端 OAuth2 Basic、搜索与标准份量查询。实际套餐权限和来源 IP 白名单需使用你的账户验证。当前选择 Basic 搜索 v1 和 food v1；food v1 已被上游标记为 deprecated，升级时需核实套餐支持，不能假定 Premier 或中文地区接口已可用。

先应用两个迁移到 Supabase **开发项目**，再部署 Edge Function。下列命令会修改云端项目，仅在你准备好部署时运行；本次代码修改不会自动执行它们：

```sh
supabase db push --dry-run
supabase db push
cp supabase/functions/.env.example supabase/functions/.env
```

在本地编辑 `supabase/functions/.env` 填入 Client ID、Client Secret 和允许的网页来源。此文件已被 Git 忽略，禁止上传或发到聊天中。Supabase 注入自身 URL、anon key 和 service role key，不要把这些再写到 secrets 文件里。

```sh
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy food-reference
```

本地 Edge 开发可运行 `supabase functions serve food-reference --env-file supabase/functions/.env`，需要 Docker 和本地 Supabase 已启动。云端 Edge Function 的实际出口 IP 是否符合你的 FatSecret 白名单必须实测；不符合时需要固定出口的服务端代理，当前不伪装或绕过该限制。

在独立登录页展开“开发环境连接”、填写公开密钥和项目地址，登录后保存猜测，再搜索英文食物名称、选择标准份和实际数量。`servings` 指完整标准份的倍数：选择“2 tablespoons”后输入 2，表示共 4 tablespoons。只有返回同一 metric unit 且基准量大于零时才允许 g/ml 换算。

## 服务端与数据流

`POST /functions/v1/food-reference`，携带用户 JWT 和项目公开 key：

- `search`：`{action, query}` → 食物候选。
- `servings`：`{action, food_id}` → 可用标准份。缺失营养的标准份不会冒充零。
- `confirm`：`{action, meal_id, guess_id, request_id, items}` → 重新从 FatSecret 获取选定份量的营养值，计算总量、差值，保存确认记录。
- `review`：`{action, confirmation_id}` → 读取本人历史选择，重新查询当前营养数据并计算；不是原始历史营养快照。

每个 item 仅包含 `food_id, serving_id, quantity, measure`。服务端忽略客户端自报的参考营养值，先验证 JWT 和本人猜测归属，再调用外部接口。只有可信服务可执行数据库保存函数；幂等 request ID 防止网络重试重复写入。响应带 `Cache-Control: no-store`。

新表 `food_confirmations` 保存选择 ID、用户填写的数量、猜测关联、计算方法版本和服务器时间，RLS 只允许本人读；客户端不能写、更新或删除。

## FatSecret 数据保存边界

依据 [Storable Data](https://platform.fatsecret.com/docs/guides/storable-data) 和 [food.get 文档](https://platform.fatsecret.com/docs/v1/food.get)，默认不把返回的名称、标准份描述、营养值或相应数值差值永久保存。只在本次请求/页面内存中展示营养参考，数据库保留 food_id、serving_id 及用户自己的选择。现有 `nutrition_estimates` / `feedback` 表不会被此功能写入。

如果后续研究需要可复现的历史营养快照，应先取得相应数据保存授权或更换允许该用途的数据源，再设计持久化。当前历史记录可重算，但不能声称可复现过去的营养答案。前端展示 fatsecret 来源链接；正式上线还需按照实际套餐完成所需品牌标识。

## 验证

```sh
node --test tests/*.test.mjs
```

使用合成测试数据验证换算、单位不匹配、缺失数据、零分母、单对象响应、身份与归属验证、凭证缺失、仅持久化允许字段。数据库测试 `supabase/tests/food_confirmations.sql` 验证新增记录隔离、重试幂等、禁止未授权调用和拒绝营养字段写入。真实 FatSecret 授权、白名单及云端端到端操作仍需配置后验证。
