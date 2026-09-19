#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="忆梦云客服系统 Docker 版"
INSTALL_DIR="${KF_INSTALL_DIR:-/opt/yimeng-kf}"
DOWNLOAD_BASE_URL="${KF_DOWNLOAD_BASE_URL:-https://raw.githubusercontent.com/yunmengnb/customer-service-docker/main}"
PACKAGE_URL="${KF_PACKAGE_URL:-${DOWNLOAD_BASE_URL%/}/kf-docker.tar.gz}"
CONFIG_FILE="/etc/ym-kf.conf"

red='\033[0;31m'; green='\033[0;32m'; yellow='\033[1;33m'; cyan='\033[0;36m'; reset='\033[0m'
info() { printf "${cyan}[信息]${reset} %s\n" "$*"; }
ok() { printf "${green}[完成]${reset} %s\n" "$*"; }
warn() { printf "${yellow}[提示]${reset} %s\n" "$*"; }
die() { printf "${red}[错误]${reset} %s\n" "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "请使用 root 用户运行 ym-kf"
[[ "$(uname -s)" == "Linux" ]] || die "仅支持 Linux 服务器"
[[ -r /dev/tty ]] || die "请在交互式终端中运行 ym-kf"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

compose() {
  docker compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" "$@"
}

require_install() {
  [[ -f "$INSTALL_DIR/docker-compose.yml" && -f "$INSTALL_DIR/.env" ]] || die "尚未安装系统，请先选择 1 安装"
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || die "Docker 或 Docker Compose 不可用"
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 ))
}

prompt_port() {
  local var="$1" label="$2" default="$3" input=""
  while true; do
    read -r -p "$label [$default]: " input </dev/tty
    input="${input:-$default}"
    valid_port "$input" || { warn "端口必须是 1-65535 的数字"; continue; }
    printf -v "$var" '%s' "$input"
    return
  done
}

prompt_password() {
  local var="$1" label="$2" first="" second=""
  while true; do
    read -r -s -p "$label（至少 8 位）: " first </dev/tty; echo
    [[ ${#first} -ge 8 ]] || { warn "密码长度不能少于 8 位"; continue; }
    case "${first,,}" in admin123|demo123|password|12345678) warn "不能使用常见弱密码"; continue;; esac
    [[ "$first" =~ ^[A-Za-z0-9_@%+=:,!.-]+$ ]] || { warn "密码只能包含字母、数字及 _@%+=:,!.-"; continue; }
    read -r -s -p "请再次输入密码: " second </dev/tty; echo
    [[ "$first" == "$second" ]] || { warn "两次输入不一致"; continue; }
    printf -v "$var" '%s' "$first"
    return
  done
}

read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$INSTALL_DIR/.env" | tail -n 1 | sed 's/^"//;s/"$//'
}

set_env() {
  local key="$1" value="$2" file="$INSTALL_DIR/.env" escaped
  escaped="${value//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*$|${key}=\"${escaped}\"|" "$file"
  else
    printf '%s="%s"\n' "$key" "$escaped" >> "$file"
  fi
}

public_host() {
  local url host
  url="$(read_env CLIENT_PUBLIC_URL)"
  host="${url#*://}"; host="${host%%:*}"; host="${host%%/*}"
  [[ -n "$host" ]] || host="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  printf '%s' "${host:-127.0.0.1}"
}

install_or_upgrade() {
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    info "开始首次安装"
    bash <(curl -fsSL "${DOWNLOAD_BASE_URL%/}/install.sh")
    return
  fi

  require_install
  local tmp backup
  tmp="$(mktemp -d)"
  backup="$(mktemp)"
  cp "$INSTALL_DIR/.env" "$backup"
  trap 'rm -rf "$tmp" "$backup"' RETURN
  info "下载最新安装包"
  curl -fL --retry 3 --connect-timeout 15 "$PACKAGE_URL" -o "$tmp/kf-docker.tar.gz"
  tar -tzf "$tmp/kf-docker.tar.gz" >/dev/null || die "安装包格式无效"
  compose down
  tar -xzf "$tmp/kf-docker.tar.gz" -C "$INSTALL_DIR"
  cp "$backup" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  install -m 0755 "$INSTALL_DIR/ym-kf.sh" /usr/local/bin/ym-kf
  docker compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" pull mongo redis
  docker compose -f "$INSTALL_DIR/docker-compose.yml" --env-file "$INSTALL_DIR/.env" up -d --build
  ok "系统升级完成"
}

reset_admin() {
  require_install
  local current_username new_username new_password
  current_username="$(read_env DEFAULT_ADMIN_USERNAME)"
  read -r -p "当前管理员账号 [$current_username]: " input </dev/tty
  current_username="${input:-$current_username}"
  read -r -p "新管理员账号 [$current_username]: " input </dev/tty
  new_username="${input:-$current_username}"
  [[ "$new_username" =~ ^[A-Za-z0-9_.-]{3,50}$ ]] || die "管理员账号格式不正确"
  prompt_password new_password "新管理员密码"
  compose run --rm -e RESET_ADMIN_CURRENT_USERNAME="$current_username" -e RESET_ADMIN_USERNAME="$new_username" -e RESET_ADMIN_PASSWORD="$new_password" server node reset-admin-password.js
  set_env DEFAULT_ADMIN_USERNAME "$new_username"
  set_env DEFAULT_ADMIN_PASSWORD "$new_password"
  ok "管理员账号密码已重置"
}

reset_ports() {
  require_install
  local admin_port user_port client_port host
  prompt_port admin_port "平台管理端口" "$(read_env ADMIN_PORT)"
  prompt_port user_port "租户客服端口" "$(read_env USER_PORT)"
  prompt_port client_port "客户聊天端口" "$(read_env CLIENT_PORT)"
  [[ "$admin_port" != "$user_port" && "$admin_port" != "$client_port" && "$user_port" != "$client_port" ]] || die "三个端口不能重复"
  host="$(public_host)"
  set_env ADMIN_PORT "$admin_port"
  set_env USER_PORT "$user_port"
  set_env CLIENT_PORT "$client_port"
  set_env CORS_ORIGIN "http://$host:$admin_port,http://$host:$user_port,http://$host:$client_port"
  set_env CLIENT_PUBLIC_URL "http://$host:$client_port"
  compose up -d --force-recreate server admin-web user-web client-web
  ok "端口已更新"
  printf "平台管理端：http://%s:%s\n租户客服端：http://%s:%s\n客户聊天端：http://%s:%s\n" "$host" "$admin_port" "$host" "$user_port" "$host" "$client_port"
}

uninstall_app() {
  require_install
  local remove_data="" answer=""
  read -r -p "确认卸载程序？[y/N]: " answer </dev/tty
  [[ "$answer" =~ ^[Yy]$ ]] || { warn "已取消卸载"; return; }
  read -r -p "同时永久删除数据库、Redis 和上传数据？[y/N]: " remove_data </dev/tty
  if [[ "$remove_data" =~ ^[Yy]$ ]]; then compose down -v; else compose down; fi
  rm -rf "$INSTALL_DIR"
  rm -f "$CONFIG_FILE" /usr/local/bin/ym-kf
  ok "卸载完成"
  exit 0
}

while true; do
  clear 2>/dev/null || true
  printf "${cyan}%s 管理菜单${reset}\n\n" "$APP_NAME"
  printf "1. 安装/升级系统\n"
  printf "2. 重置管理员账号密码\n"
  printf "3. 卸载程序\n"
  printf "4. 重置端口\n"
  printf "0. 退出菜单\n\n"
  read -r -p "请选择 [0-4]: " choice </dev/tty
  case "$choice" in
    1) install_or_upgrade ;;
    2) reset_admin ;;
    3) uninstall_app ;;
    4) reset_ports ;;
    0) exit 0 ;;
    *) warn "无效选项" ;;
  esac
  printf "\n"
  read -r -p "按回车键返回菜单..." _ </dev/tty
 done
