# 忆梦云客服系统 Docker 版

包含 Node.js 服务端、平台管理端、租户客服端、客户聊天端、MongoDB 和 Redis。

## 一键安装

在 Linux 服务器中使用 GitHub 地址执行一键安装：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main/install.sh)
```

安装程序会：

1. 检测 Linux、root、curl、tar、OpenSSL、Docker 和 Docker Compose；
2. 自动安装缺少的基础依赖和 Docker；
3. 交互配置安装目录、三个后台端口、管理员账号密码和默认租户；
4. 生成 JWT 密钥和 `.env`；
5. 构建并启动容器；
6. 等待健康检查并初始化管理员、默认租户和客服渠道。

默认访问端口：

- 平台管理端：5174
- 租户客服端：5175
- 客户聊天端：5176

生产环境建议使用 Nginx/Caddy 绑定域名并启用 HTTPS。

## Android APP 源码

项目同时包含两个原生 Android APP：

- `android-native-app/`：租户客服端 APP，包名 `com.user.ymykf`，当前版本 `1.0.0`，访问 `https://user.by0.me`；
- `customer-android-app/`：客户聊天端 APP，包名 `com.chat.ymykf`，当前版本 `1.0.0`，访问 `https://chat.by0.me`。

使用 Android Studio 打开对应目录，构建环境要求 Java 17、Android SDK 35。也可在对应目录执行：

```bash
./gradlew assembleDebug
```

Windows 使用：

```powershell
.\gradlew.bat assembleDebug
```

APP 服务地址配置位于各项目的 `AppConfig.java`，部署到自己的域名后应在构建前修改。公开源码不包含 `local.properties`、APK、Gradle 缓存、正式签名属性或 JKS/Keystore 私钥；发布 Release 包时请自行通过环境变量、用户级 Gradle 配置或本地 `signing` 文件配置签名。

## 发布安装包

在本目录执行：

```bash
chmod +x build-package.sh
./build-package.sh
```

会生成 `kf-docker.tar.gz`。本项目默认使用 GitHub `main` 分支中的安装脚本和安装包：

```text
https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main/install.sh
https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main/kf-docker.tar.gz
```

如需显式指定 GitHub 安装包地址：

```bash
KF_PACKAGE_URL=https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main/kf-docker.tar.gz \
bash <(curl -Ls https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main/install.sh)
```

## 管理菜单

安装完成后，在终端执行：

```bash
ym-kf
```

可使用以下菜单：

```text
1. 安装/升级系统
2. 重置管理员账号密码
3. 卸载程序
4. 重置端口
0. 退出菜单
```

## 常用管理命令

安装后进入安装目录：

```bash
cd /opt/yimeng-kf
sudo docker compose ps
sudo docker compose logs -f
sudo docker compose restart
sudo docker compose down
```

数据存储于 Docker 命名卷。不要执行 `docker compose down -v`，除非确定要永久删除数据库、Redis 和上传文件。

## MongoDB 单节点副本集与受控重启

Docker 部署默认使用固定副本集名 `kf-rs0`，`mongo-init` 会通过重试而非固定 sleep 幂等执行 `rs.initiate()`，并等待 PRIMARY、majority 写入和事务能力就绪。业务库 URI 与 control 库 URI 都包含 `replicaSet=kf-rs0&authSource=admin&directConnection=true`，两者数据库名必须不同。当前 Compose 未默认开启 MongoDB 鉴权，因此不生成无意义的 keyFile；若生产环境启用鉴权，多成员副本集必须另行配置持久化、权限为 0400/0600 的共享 keyFile 和独立的业务/control 用户。

首次启动：

```bash
docker compose up -d --build
# 确认 mongo-init 成功、Mongo PRIMARY、Redis 与服务健康
docker compose ps
docker compose logs mongo-init
```

从已有 standalone 升级时，必须先做可恢复备份并安排维护窗口；不要删除或重建 `mongo_data` 卷。更新配置后仅重建容器，`mongo-init` 会在原数据目录上初始化副本集。确认 `rs.status()`、事务探针和应用健康后再恢复流量。副本集写入后不支持直接降级回 standalone 继续写入；回滚应恢复升级前备份到独立环境，或保留副本集配置回滚应用版本。

迁移数据面和活动指针仍默认关闭。仅在独立备份及双站演练完成后，在 `.env` 中显式设置 `MIGRATION_DATA_PLANE_ENABLED=true`、`MIGRATION_ACTIVE_POINTER_ENABLED=true` 和至少 32 字节随机 `MIGRATION_MASTER_KEY`。`INSTANCE_REPLICA_COUNT=1` 与 `MIGRATION_RESTART_MODE=docker` 已由 Compose 固定；切换 journal 落盘后服务以专用退出码 75 退出，由 `restart: on-failure:5` 受控拉起，不挂载 Docker socket。

现有 `uploads_data` 卷保持不变，staging 位于该卷内的隐藏目录 `/app/uploads/.migration-private/staging`，服务明确拒绝静态访问此目录；backup 和 temp 使用独立卷。由于 `/app/uploads` 本身是命名卷挂载根目录，且 staging 位于 active uploads 内部，当前布局会将真实目录切换判定为不安全并 fail-closed，不会提交活动数据库指针或执行 uploads rename。若后续需要启用真实切换，须先在备份和维护窗口内将 active 与 staging 规划为同一持久卷中的两个同级子目录，并完成独立演练；不得直接迁移现有数据卷。
