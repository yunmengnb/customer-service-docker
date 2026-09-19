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
