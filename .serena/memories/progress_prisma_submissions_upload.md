# 当前迭代进度：/submissions 上传接口 + Prisma 7 适配

## 项目背景
- NestJS 11 + TypeScript 后端
- 使用 Prisma 7.1.0 作为 ORM，并采用 `prisma.config.ts` + `prisma/schema.prisma` 的新配置方式
- 数据模型 `Submission` 已在 `prisma/schema.prisma` 中定义（含枚举 `Category`）

## 已完成工作

### 1. `/submissions` 上传接口实现
- 新增模块目录：`src/submissions/`
  - `submissions.module.ts`：注册 `SubmissionsController` 和 `SubmissionsService`
  - `dto/create-submission.dto.ts`：定义并验证上传表单字段：
    - `studentName`: 2~10 字符
    - `grade`: 1~6 的整数
    - `classNumber`: >=1 的整数
    - `category`: `PROGRAMMING | AIGC`
    - `workTitle`: 1~50 字符
  - `submissions.controller.ts`：实现 `POST /submissions`，主要行为：
    - 使用 `FileInterceptor('file', { limits: { fileSize: 50MB }, storage: diskStorage(...) })` 处理文件上传
    - 存储目录为项目根的 `uploads/`，如不存在会自动创建
    - 生成 `storedFileName`：`randomUUID() + 原始扩展名`
    - 使用 `@Throttle({ default: { limit: 5, ttl: 60000 } })` 针对该路由限流（5 次 / 60 秒）
    - 若缺少文件，抛出 `BadRequestException('File is required')`
    - 根据 `category` 做二进制级别文件校验：
      - `PROGRAMMING`: 扩展名 `.sb3`/`.mp`，并检查文件头为 ZIP (`0x50 0x4b`)
      - `AIGC`: 扩展名 `.png`/`.jpg`/`.jpeg`，并检查 PNG/JPEG 魔数
      - 校验失败会删除已写入磁盘的文件，并抛出 `BadRequestException('Unsupported file type for the given category')`
  - `submissions.service.ts`：
    - 注入 `PrismaService`
    - 在 `createSubmission` 中调用 `this.prisma.submission.create({ data: { ... } })`，写入 Submission 记录
    - 使用 `Category` 类型保证 `dto.category` 与 Prisma 枚举兼容

### 2. 全局基础设施调整
- `src/app.module.ts`：
  - 引入 `ConfigModule.forRoot({ isGlobal: true })`
  - 配置 `ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])` 作为全局限流默认值
  - 注册 `PrismaModule`、`AuthModule`、`SubmissionsModule`
  - 使用 `APP_GUARD + ThrottlerGuard` 实现全局限流 Guard
- `src/main.ts`：
  - 启用 CORS：`origin: 'http://localhost:5173', credentials: true`
  - 启用全局 `ValidationPipe({ transform: true, whitelist: true })`

### 3. Prisma 配置与 7.x 新特性适配
- `prisma/schema.prisma`：
  - 使用 `generator client { provider = "prisma-client-js" }`
  - 使用 `datasource db { provider = "postgresql" }`
- 解决 Prisma 7 新版对 Client 构造的严格校验：
  - Prisma 7 使用新的 “client 引擎”，要求 `PrismaClient` 构造函数必须提供非空的 `PrismaClientOptions`，并且若使用 `engine type "client"`，需要显式指定 `adapter` 或 `accelerateUrl`。
- 最终采用官方推荐方式：使用 **driver adapter**
  - 在 `package.json` 中增加依赖：
    - `@prisma/adapter-pg`
    - `pg`
  - 在 `src/prisma/prisma.service.ts` 中实现：
    ```ts
    import { PrismaClient } from '@prisma/client';
    import { PrismaPg } from '@prisma/adapter-pg';
    import { Pool } from 'pg';

    @Injectable()
    export class PrismaService
      extends PrismaClient
      implements OnModuleInit, OnModuleDestroy
    {
      constructor() {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
        });
        const adapter = new PrismaPg(pool);
        super({ adapter });
      }

      async onModuleInit() {
        await this.$connect();
      }

      async onModuleDestroy() {
        await this.$disconnect();
      }
    }
    ```
  - 这样满足了 Prisma 7 对 `PrismaClient` 的构造要求，解决了：
    - `PrismaClientInitializationError: 'PrismaClient' needs to be constructed with a non-empty, valid 'PrismaClientOptions'`
    - `PrismaClientConstructorValidationError: Using engine type "client" requires either "adapter" or "accelerateUrl"...`

### 4. 当前状态
- TypeScript 编译通过（`npx tsc -p tsconfig.json --noEmit` 无错误）
- Nest 应用可以正常启动（`pnpm start:dev` 不再抛 Prisma 构造错误）
- 数据库连接信息通过 `.env` 中的 `DATABASE_URL` 提供
- `/submissions` 上传接口已可用，严格按 `api.md` 中的字段与文件校验规则实现

## 下一步建议
1. 根据 `api.md` 实现剩余的 `/submissions` 接口：
   - `GET /submissions` 列表
   - `GET /submissions/final` 最终提交列表
   - `GET /submissions/:id/download` 文件下载
   - `GET /submissions/check` 每日提交额度检查
2. 为 `/submissions` 相关功能补充 e2e 测试，用 `supertest` 验证：
   - 表单字段校验
   - 不同类别文件的扩展名和魔数校验
   - 限流行为（429）
3. 适配 `api.md` 中描述的统一错误响应结构（自定义 `HttpExceptionFilter`）。