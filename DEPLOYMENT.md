# lcygzback 生产环境部署指南（Ubuntu 24.04 LTS）

本文档说明如何在一台 Ubuntu 24.04 LTS 服务器上，将项目仓库  
`https://github.com/lichuyi459/lcygzback` 部署为生产服务。

## 1. 架构与技术栈概览

- 应用框架：NestJS 11（基于 Express）
- 语言与运行时：Node.js（建议 LTS 版本，≥ 20）
- 包管理器：pnpm
- ORM：Prisma 7（PostgreSQL）
- 数据库：PostgreSQL
- 认证：JWT（`/auth/login`）
- 静态文件：本地 `uploads/` 目录，通过 `/uploads/**` 暴露
- 进程管理：PM2（推荐），也可选 systemd
- 反向代理（可选）：Nginx + HTTPS

---

## 2. 准备服务器

### 2.1 创建部署用户（可选，但推荐）

```bash
# 使用 root 登录后执行
adduser lcygzback
usermod -aG sudo lcygzback

# 切换到部署用户
su - lcygzback
```

### 2.2 安装基础依赖

```bash
sudo apt update
sudo apt install -y curl git build-essential
```

---

## 3. 安装 Node.js 与 pnpm

### 3.1 使用 nvm 安装 Node.js LTS

```bash
# 安装 nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 重新加载 shell（或重新登录）
source ~/.bashrc

# 安装并使用 Node.js LTS（示例使用 LTS）
nvm install --lts
nvm use --lts

# 确认版本
node -v
npm -v
```

### 3.2 安装 pnpm

```bash
npm install -g pnpm
pnpm -v
```

---

## 4. 安装 PostgreSQL 并配置数据库

### 4.1 安装 PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
```

### 4.2 创建数据库和用户

进入 PostgreSQL：

```bash
sudo -u postgres psql
```

在 psql 里执行（根据需要修改数据库名、用户名和密码）：

```sql
CREATE USER lcygzback_user WITH PASSWORD '强密码自己改';
CREATE DATABASE lcygzback_prod OWNER lcygzback_user;

-- 切换到新创建的数据库
\c lcygzback_prod

-- 关键：确保应用用户在 public schema 下有建表权限（Prisma 迁移需要在此 schema 创建表）
GRANT USAGE, CREATE ON SCHEMA public TO lcygzback_user;
\q
```

### 4.3 生成 `DATABASE_URL`

在后面 `.env` 中会用到：

```text
DATABASE_URL="postgresql://lcygzback_user:lichuyi459..@localhost:5432/lcygzback_prod?schema=public"
```

---

## 5. 拉取项目代码

假设代码路径为 `/opt/lcygzback`：

```bash
sudo mkdir -p /opt/lcygzback
sudo chown -R $USER:$USER /opt/lcygzback

cd /opt
git clone https://github.com/lichuyi459/lcygzback.git
cd lcygzback
```

后续更新上线可以用：

```bash
cd /opt/lcygzback
git pull
```

---

## 6. 安装依赖并构建

### 6.1 安装依赖

```bash
cd /opt/lcygzback
pnpm install
```

### 6.2 生成 Prisma Client 与迁移数据库

先确保 `DATABASE_URL` 已设置（可先在当前 shell 中导出，后面会写入 `.env`）：

```bash
export DATABASE_URL="postgresql://lcygzback_user:强密码自己改@localhost:5432/lcygzback_prod?schema=public"

# 生成 Prisma Client
pnpm prisma generate

# 如果已经有 migrations，使用 migrate deploy 应用迁移
pnpm prisma migrate deploy
```

> 注意：具体迁移命令以你仓库已有的 Prisma 迁移为准。如果已经有 `prisma/migrations` 目录，使用 `migrate deploy` 即可。

### 6.3 构建 NestJS 项目

```bash
pnpm build
```

成功后会生成 `dist/` 目录。

---

## 7. 配置环境变量

在项目根目录创建 `.env`（生产环境使用）：

```bash
cd /opt/lcygzback
nano .env
```

内容示例：

```env
# 服务器监听端口（可选，默认 3000）
PORT=3000

# 数据库连接
DATABASE_URL="postgresql://lcygzback_user:强密码自己改@localhost:5432/lcygzback_prod?schema=public"

# 管理员登录密码（/auth/login）
ADMIN_PASSWORD="自己设置的强密码"

# JWT 签名密钥
JWT_SECRET="使用 openssl rand -hex 32 生成的随机值"

# Node 环境
NODE_ENV=production
```

建议使用 `openssl` 生成随机密钥：

```bash
openssl rand -hex 32
```

将输出结果填入 `JWT_SECRET`。

---

## 8. 生产运行（使用 PM2，推荐）

### 8.1 创建运行目录与上传目录

确保 `uploads` 目录存在，并且对运行用户可写：

```bash
cd /opt/lcygzback
mkdir -p uploads
chmod 755 uploads
```

### 8.2 安装 PM2

```bash
npm install -g pm2
```

### 8.3 使用 PM2 启动应用

```bash
cd /opt/lcygzback

# 第一次启动（使用构建后的 dist/src/main.js）
NODE_ENV=production pm2 start dist/src/main.js --name lcygzback
```

### 8.4 设置开机自启

```bash
pm2 startup systemd
pm2 save
```

### 8.5 常用 PM2 命令

```bash
# 查看进程状态
pm2 status

# 重启服务
pm2 restart lcygzback

# 查看日志
pm2 logs lcygzback

# 停止服务
pm2 stop lcygzback
```

---

## 9. 生产运行方式二：systemd 服务（可选）

如果你更习惯使用 systemd 管理服务，可以参考本节。

### 9.1 创建 systemd 单元文件

使用 root 用户创建服务文件：

```bash
sudo nano /etc/systemd/system/lcygzback.service
```

内容示例（假设使用用户 `lcygzback`，路径 `/opt/lcygzback`，端口 3000）：

```ini
[Unit]
Description=NestJS lcygzback service
After=network.target postgresql.service

[Service]
User=lcygzback
WorkingDirectory=/opt/lcygzback
Environment=NODE_ENV=production
EnvironmentFile=/opt/lcygzback/.env
ExecStart=/bin/bash -lc "cd /opt/lcygzback && pnpm start:prod"
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

说明：

- 使用 `pnpm start:prod`，对应 `node dist/src/main`（见 `package.json`）。
- `EnvironmentFile` 指向 `.env`，统一管理环境变量。
- `After=postgresql.service` 确保数据库服务先启动。

### 9.2 重新加载并启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable lcygzback
sudo systemctl start lcygzback

# 查看运行状态
sudo systemctl status lcygzback

# 查看日志
journalctl -u lcygzback -f
```

---

## 10. 反向代理与 HTTPS（以 Nginx 为例）

在当前架构下：

- **HTTPS/SSL 终止点在 Nginx 上**（部署在你的 Ubuntu 服务器上）。
- NestJS 应用本身只监听本地 HTTP 端口（例如 `http://127.0.0.1:3000`），不直接处理证书。
- 前端（无论是本机静态托管还是托管在其他平台）通过浏览器访问 `https://www.guzhenscjy.cn`，只要这个域名前面是 Nginx，SSL 就由 Nginx 负责。

如果未来前端单独托管在其他平台，并使用不同的域名或子域名（例如 `app.guzhenscjy.cn`），则：

- 对外入口在前端平台时，该平台需要为对应域名配置证书；
- 你的这台后端服务器则为自己的域名（例如 `api.guzhenscjy.cn`）配置证书。

### 10.1 安装 Nginx

```bash
sudo apt install -y nginx
```

### 10.2 配置虚拟主机

你的域名为 `www.guzhenscjy.cn`，应用在本地 `3000` 端口：

```bash
sudo nano /etc/nginx/sites-available/lcygzback.conf
```

内容示例（HTTP，后续再加 HTTPS）：

```nginx
server {
    listen 80;
    server_name www.guzhenscjy.cn;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 静态上传文件（由 Nest 暴露 /uploads）
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

启用配置并重载：

```bash
sudo ln -s /etc/nginx/sites-available/lcygzback.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 10.3 配置 HTTPS（Let’s Encrypt）

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d www.guzhenscjy.cn
```

按提示完成证书签发后，Nginx 会自动生成 HTTPS 配置和自动续期任务。

---

## 11. 日常运维与更新流程

### 11.1 更新代码并重启服务

每次代码更新上线：

```bash
cd /opt/lcygzback
git pull

# 如果有 schema 或依赖变化
pnpm install
pnpm prisma migrate deploy
pnpm build

# 使用 PM2 重启服务
pm2 restart lcygzback
```

### 11.2 查看日志

```bash
pm2 logs lcygzback
```

---

## 12. 备份与安全建议

- **数据库备份**
  - 使用 `pg_dump` 进行定期备份：
    ```bash
    pg_dump -U lcygzback_user lcygzback_prod > lcygzback_prod_$(date +%F).sql
    ```
  - 配合 cron 或备份脚本自动化。
- **uploads 目录备份**
  - `uploads/` 存储用户上传作品，建议与数据库一起做定期备份。
- **安全**
  - 限制 SSH 登录（使用公钥登录、关闭 root 直登）。
  - 保持系统与 Node.js 依赖及时更新。
  - `ADMIN_PASSWORD` 和 `JWT_SECRET` 使用高强度随机值，避免泄露。

---

## 13. 快速检查清单

部署完成后，可按以下步骤自检：

1. `curl http://127.0.0.1:3000/` 返回 `"Hello World!"`。
2. `POST /auth/login` 使用正确 `ADMIN_PASSWORD` 能返回 `access_token`。
3. 使用 `Authorization: Bearer <token>` 测试：
   - `GET /submissions` 返回 JSON 数组。
   - `POST /submissions` 使用合法作品文件上传成功，数据库中有记录。
   - `GET /submissions/final` 能返回分组后的最新作品。
   - `GET /submissions/:id/download` 能正确下载文件。
4. 如配置 Nginx：
   - 访问 `http://www.guzhenscjy.cn/` 或 `https://www.guzhenscjy.cn/` 能透传到 Nest 应用。
5. 确认 `uploads/` 权限正确，能写入和读取文件。
