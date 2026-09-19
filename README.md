# 忆梦云客服系统 Docker 版

包含 Node.js 服务端、平台管理端、租户客服端、客户聊天端、MongoDB 和 Redis。

## 一键安装

将本目录发布到可通过 HTTP/HTTPS 下载的位置，并保证同目录提供源码包 `kf-docker.tar.gz`。然后在 Linux 服务器执行：

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

## 发布安装包

在本目录执行：

```bash
chmod +x build-package.sh
./build-package.sh
```

会生成 `kf-docker.tar.gz`。将它和 `install.sh` 上传到同一个 URL 目录即可。

也可显式指定安装包地址：

```bash
KF_PACKAGE_URL=https://example.com/download/kf-docker.tar.gz \
bash <(curl -Ls https://example.com/download/install.sh)
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
