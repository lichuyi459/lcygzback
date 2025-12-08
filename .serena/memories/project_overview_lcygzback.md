# 项目总览：lcygzback（School Contest Portal 后端）

## 技术栈
- 框架：NestJS 11（基于 Express）
- 语言：TypeScript（Node.js LTS）
- 包管理：pnpm
- ORM：Prisma 7（PostgreSQL，使用 `@prisma/adapter-pg`）
- 数据库：PostgreSQL
- 认证：JWT（`/auth/login`），单管理员口令
- 限流：`@nestjs/throttler`（全局 10/min，`POST /submissions` 5/min）
- 静态文件：本地 `uploads/`，通过 `/uploads/**` 暴露 + API 受控下载

## 核心模块与接口

### 1. Auth 模块
- 路由前缀：`/auth`
- 登录接口：`POST /auth/login`
  - 请求体：`{ password: string }`
  - 校验逻辑：比较 `ADMIN_PASSWORD` 环境变量，不匹配抛 `UnauthorizedException('Invalid credentials')`
  - 成功返回：`{ access_token: string }`，payload `{ role: 'admin' }`，使用 `JWT_SECRET` 签名，有效期 1 天
  - 控制器：`src/auth/auth.controller.ts`
  - 服务：`src/auth/auth.service.ts`
  - 守卫与策略：`JwtStrategy` + `JwtAuthGuard`

### 2. Submissions 模块
- 路由前缀：`/submissions`
- 数据模型（Prisma `Submission`）
  - 字段：`id, studentName, grade, classNumber, category (PROGRAMMING|AIGC), workTitle, fileName, storedFileName, fileType, fileSize, submittedAt`

#### 2.1 创建提交 `POST /submissions`
- Auth：无
- Content-Type：`multipart/form-data`
- Form 字段：
  - `studentName` (2-10 chars)
  - `grade` (1-6 int)
  - `classNumber` (>=1 int)
  - `category` (`PROGRAMMING | AIGC`)
  - `workTitle` (1-50 chars)
  - `file` (必需)
- 文件规则：
  - 大小：<= 50MB
  - `PROGRAMMING`：扩展名 `.sb3`/`.mp`，文件头必须为 ZIP (`0x50 0x4b`)
  - `AIGC`：扩展名 `.png`/`.jpg`/`.jpeg`，文件魔数必须为 PNG/JPEG 标准头
- 存储：
  - 目录：`process.cwd()/uploads`
  - 文件名：`randomUUID() + 原始扩展名`
  - Prisma 写入 `Submission`
- 错误处理：
  - 缺文件：`400 File is required`
  - 魔数/后缀不匹配：`400 Unsupported file type for the given category`
  - 空文件或不支持的分类：`400 Uploaded file is empty` / `Unsupported submission category`
  - 失败时尽量删除已写入的文件
- 限流：`@Throttle({ default: { limit: 5, ttl: 60_000 } })`

#### 2.2 列表接口
- `GET /submissions`（需管理员 JWT）
  - 行为：返回所有 `Submission`，按 `submittedAt` 降序
- `GET /submissions/final`（需管理员 JWT）
  - 行为：每个 `(grade, classNumber, studentName, category)` 组合只返回 `submittedAt` 最新的一条

#### 2.3 下载与配额
- `GET /submissions/:id/download`（需管理员 JWT）
  - 行为：
    - 查找 Submission；不存在返回 `404 Submission not found`
    - 检查 `uploads/<storedFileName>` 存在；缺失返回 `404 File not found`
    - 使用 `StreamableFile` 流式返回；`Content-Type` 来源于 `fileType`
    - `Content-Disposition` 文件名形如 `grade-classNumber-studentName.ext`
- `GET /submissions/check`（匿名）
  - Query：`studentName`
  - 缺少参数：`400 studentName is required`
  - 行为：统计当天该 `studentName` 是否已有 `Submission`，返回 `{ canSubmit: boolean }`

### 3. 全局行为
- `GET /`：返回 `"Hello World!"`
- Validation：全局 `ValidationPipe({ transform: true, whitelist: true })`
- 错误格式：自定义 `HttpExceptionFilter`，统一返回：
  - `{ statusCode, message, error?, timestamp }`
- 限流：
  - `ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])` + `APP_GUARD = ThrottlerGuard`
  - e2e 中通过环境与 Guard 覆盖禁用限流

## 测试
- e2e 测试：`test/app.e2e-spec.ts`
  - 覆盖：根路由、登录成功/失败、投稿上传/校验、列表、final 分组、下载成功/404、每日配额检查、静态 `/uploads` 文件
  - 测试环境通过 `.env` / 进程变量提供 `ADMIN_PASSWORD` 和 `JWT_SECRET`

## 部署
- 生产系统：Ubuntu 24.04 LTS
- 进程管理：PM2（主推荐）
- 部署文档：`DEPLOYMENT.md`（包含 Node + pnpm 安装、PostgreSQL/Prisma 配置、PM2 启动、Nginx 反代、Let’s Encrypt HTTPS）
- 域名示例：`www.guzhenscjy.cn`，HTTPS 终止于 Nginx，NestJS 只监听本地 HTTP

## 约定与注意点
- 所有文件与源码使用 UTF-8 编码
- 错误响应结构统一由 `HttpExceptionFilter` 控制
- 上传文件目录为项目根目录下的 `uploads/`，注意备份与权限管理
- Prisma 使用 `adapter-pg` + `pg` 连接 Postgres，`DATABASE_URL` 通过 `.env` 或环境变量配置
