#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="忆梦云客服系统 Docker 版"
DEFAULT_INSTALL_DIR="/opt/yimeng-kf"
# 发布时可将下面的域名改为存放 install.sh 和 kf-docker.tar.gz 的实际地址。
DOWNLOAD_BASE_URL="${KF_DOWNLOAD_BASE_URL:-https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main}"
PACKAGE_URL="${KF_PACKAGE_URL:-}"

red='\033[0;31m'; green='\033[0;32m'; yellow='\033[1;33m'; cyan='\033[0;36m'; reset='\033[0m'
info() { printf "${cyan}[信息]${reset} %s\n" "$*"; }
ok() { printf "${green}[完成]${reset} %s\n" "$*"; }
warn() { printf "${yellow}[提示]${reset} %s\n" "$*"; }
die() { printf "${red}[错误]${reset} %s\n" "$*" >&2; exit 1; }

cleanup() {
  [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]] && rm -rf "$TMP_DIR"
}
trap cleanup EXIT
trap 'die "安装在第 $LINENO 行失败，请检查上方错误信息"' ERR

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  die "请切换到 root 用户后重新执行安装命令（进程替换模式不能自动 sudo）"
fi

[[ "$(uname -s)" == "Linux" ]] || die "仅支持 Linux 服务器"

has() { command -v "$1" >/dev/null 2>&1; }
compose() { docker compose "$@"; }

pkg_manager() {
  if has apt-get; then echo apt
  elif has dnf; then echo dnf
  elif has yum; then echo yum
  else die "不支持当前系统的软件包管理器，请手动安装 curl、tar、openssl 和 Docker"
  fi
}

install_base_dependencies() {
  local manager
  if has curl && has tar && has openssl; then
    ok "基础依赖已安装"
    return
  fi
  manager="$(pkg_manager)"
  info "安装缺少的基础依赖"
  case "$manager" in
    apt)
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl tar openssl
      ;;
    dnf)
      dnf install -y ca-certificates curl tar openssl
      ;;
    yum)
      yum install -y ca-certificates curl tar openssl
      ;;
  esac
}

install_docker() {
  if has docker && docker compose version >/dev/null 2>&1; then
    ok "Docker 和 Docker Compose 已安装"
    return
  fi
  info "安装 Docker Engine 和 Docker Compose"
  curl -fsSL https://get.docker.com | sh
  has systemctl && systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || die "Docker Compose 插件安装失败"
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 ))
}

port_in_use() {
  local port="$1"
  if has ss; then ss -lntH "sport = :$port" 2>/dev/null | grep -q .
  elif has netstat; then netstat -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
  else return 1
  fi
}

prompt_value() {
  local var="$1" label="$2" default="$3" value
  read -r -p "$label [$default]: " value </dev/tty
  printf -v "$var" '%s' "${value:-$default}"
}

prompt_port() {
  local var="$1" label="$2" default="$3" value
  while true; do
    prompt_value value "$label" "$default"
    valid_port "$value" || { warn "端口必须是 1-65535 的数字"; continue; }
    if port_in_use "$value"; then
      read -r -p "端口 $value 当前已被占用，仍然使用吗？[y/N]: " answer </dev/tty
      [[ "$answer" =~ ^[Yy]$ ]] || continue
    fi
    printf -v "$var" '%s' "$value"
    return
  done
}

prompt_password() {
  local var="$1" label="$2" first second
  while true; do
    read -r -s -p "$label（至少 8 位）: " first </dev/tty; echo
    [[ ${#first} -ge 8 ]] || { warn "密码长度不能少于 8 位"; continue; }
    case "${first,,}" in admin123|demo123|password|12345678) warn "不能使用常见弱密码"; continue;; esac
    read -r -s -p "请再次输入密码: " second </dev/tty; echo
    [[ "$first" == "$second" ]] || { warn "两次输入不一致"; continue; }
    printf -v "$var" '%s' "$first"
    return
  done
}

escape_env() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

detect_package_url() {
  [[ -n "$PACKAGE_URL" ]] && return
  if [[ -z "$DOWNLOAD_BASE_URL" || "$DOWNLOAD_BASE_URL" == *"域名"* ]]; then
    die "请先将 install.sh 中的 DOWNLOAD_BASE_URL 改为实际地址，或通过 KF_PACKAGE_URL 指定安装包地址"
  fi
  PACKAGE_URL="${DOWNLOAD_BASE_URL%/}/kf-docker.tar.gz"
}

download_source() {
  detect_package_url
  TMP_DIR="$(mktemp -d)"
  info "下载安装包：$PACKAGE_URL"
  curl -fL --retry 3 --connect-timeout 15 "$PACKAGE_URL" -o "$TMP_DIR/kf-docker.tar.gz"
  tar -tzf "$TMP_DIR/kf-docker.tar.gz" >/dev/null || die "安装包格式无效"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TMP_DIR/kf-docker.tar.gz" -C "$INSTALL_DIR"
  [[ -f "$INSTALL_DIR/docker-compose.yml" && -f "$INSTALL_DIR/server/Dockerfile" ]] || die "安装包缺少 docker-compose.yml 或服务端源码"
}

public_host() {
  local host
  host="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [[ -n "$host" ]] || host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${host:-127.0.0.1}"
}

write_env() {
  local host="$1"
  umask 077
  cat > "$INSTALL_DIR/.env" <<EOF
ADMIN_PORT=$ADMIN_PORT
USER_PORT=$USER_PORT
CLIENT_PORT=$CLIENT_PORT
JWT_SECRET=$(escape_env "$JWT_SECRET")
CORS_ORIGIN=$(escape_env "http://$host:$ADMIN_PORT,http://$host:$USER_PORT,http://$host:$CLIENT_PORT")
CLIENT_PUBLIC_URL=$(escape_env "http://$host:$CLIENT_PORT")
DEFAULT_ADMIN_USERNAME=$(escape_env "$ADMIN_USERNAME")
DEFAULT_ADMIN_PASSWORD=$(escape_env "$ADMIN_PASSWORD")
DEFAULT_ADMIN_EMAIL=$(escape_env "$ADMIN_EMAIL")
DEFAULT_TENANT_NAME=$(escape_env "$TENANT_NAME")
DEFAULT_TENANT_USERNAME=$(escape_env "$TENANT_USERNAME")
DEFAULT_TENANT_PASSWORD=$(escape_env "$TENANT_PASSWORD")
EOF
  chmod 600 "$INSTALL_DIR/.env"
}

wait_for_health() {
  local i
  info "等待后端健康检查"
  for i in $(seq 1 60); do
    if compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" exec -T server node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      ok "后端服务已就绪"
      return
    fi
    sleep 3
  done
  compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" logs --tail=100 server || true
  die "后端健康检查超时"
}

printf "\n${cyan}%s${reset}\n\n" "$APP_NAME"
[[ -r /dev/tty ]] || die "安装程序需要交互式终端，请直接在终端中执行"
if has docker && docker compose version >/dev/null 2>&1; then
  ok "检测到 Docker 和 Docker Compose"
else
  warn "未检测到完整的 Docker 环境，确认配置后将自动安装"
fi

prompt_value INSTALL_DIR "安装目录" "$DEFAULT_INSTALL_DIR"
prompt_port ADMIN_PORT "平台管理端口" "5174"
prompt_port USER_PORT "租户客服端口" "5175"
prompt_port CLIENT_PORT "客户聊天端口" "5176"
[[ "$ADMIN_PORT" != "$USER_PORT" && "$ADMIN_PORT" != "$CLIENT_PORT" && "$USER_PORT" != "$CLIENT_PORT" ]] || die "三个访问端口不能重复"

prompt_value ADMIN_USERNAME "平台管理员账号" "admin"
prompt_value ADMIN_EMAIL "平台管理员邮箱" "admin@example.com"
prompt_password ADMIN_PASSWORD "平台管理员密码"
prompt_value TENANT_NAME "默认企业名称" "默认企业"
prompt_value TENANT_USERNAME "默认租户账号" "demo"
prompt_password TENANT_PASSWORD "默认租户密码"
detect_package_url
PUBLIC_HOST="$(public_host)"

printf "\n安装配置：\n"
printf "  安装目录：%s\n" "$INSTALL_DIR"
printf "  平台管理端：http://%s:%s\n" "$PUBLIC_HOST" "$ADMIN_PORT"
printf "  租户客服端：http://%s:%s\n" "$PUBLIC_HOST" "$USER_PORT"
printf "  客户聊天端：http://%s:%s\n" "$PUBLIC_HOST" "$CLIENT_PORT"
printf "  管理员账号：%s\n" "$ADMIN_USERNAME"
printf "  默认租户：%s (%s)\n\n" "$TENANT_NAME" "$TENANT_USERNAME"
read -r -p "确认开始安装？[y/N]: " confirm </dev/tty
[[ "$confirm" =~ ^[Yy]$ ]] || { warn "已取消安装"; exit 0; }

install_base_dependencies
install_docker
JWT_SECRET="$(openssl rand -hex 48)"

if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  warn "检测到已有安装，将保留 Docker 数据卷并更新程序文件"
  compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" down 2>/dev/null || true
fi

download_source
write_env "$PUBLIC_HOST"

info "拉取镜像并构建服务"
compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" pull mongo redis
compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" up -d --build
wait_for_health

info "初始化管理员、默认租户和客服渠道"
compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" run --rm server node seed.js

ok "$APP_NAME 安装完成"
printf "\n平台管理端：http://%s:%s\n" "$PUBLIC_HOST" "$ADMIN_PORT"
printf "租户客服端：http://%s:%s\n" "$PUBLIC_HOST" "$USER_PORT"
printf "客户聊天端：http://%s:%s\n" "$PUBLIC_HOST" "$CLIENT_PORT"
printf "\n配置文件：%s/.env（权限 600）\n" "$INSTALL_DIR"
printf "查看状态：cd %s && docker compose ps\n\n" "$INSTALL_DIR"
