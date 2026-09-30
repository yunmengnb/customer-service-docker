# 忆梦云团队开发
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:5176"
CHANNEL_TOKEN = "demo-channel"
CHALLENGE_ID = "507f1f77bcf86cd799439011"
VIEWPORTS = [360, 390, 768, 1024, 1440]


def json_response(route, data, status=200):
    route.fulfill(status=status, content_type="application/json", body=__import__("json").dumps(data, ensure_ascii=False))


def install_api_mocks(page, *, authenticated=True, bound=False):
    requests = []

    def handle(route):
        request = route.request
        path = request.url.split("/api", 1)[-1].split("?", 1)[0]
        requests.append((request.method, path, request.post_data or ""))

        if path == "/client/public-settings":
            return json_response(route, {"code": 0, "data": {
                "customerLoginEnabled": True,
                "customerRegisterEnabled": True,
                "customerRegisterEmailVerificationEnabled": False,
                "customerServiceClientDownloadPromptEnabled": False,
            }})
        if path == f"/client/channels/{CHANNEL_TOKEN}":
            return json_response(route, {"code": 0, "data": {
                "id": "507f1f77bcf86cd799439012",
                "name": "测试渠道",
                "brandName": "忆梦云客服",
                "status": "online",
                "agentIds": [],
                "agentOnline": False,
            }})
        if path == "/client/me":
            if not authenticated:
                return json_response(route, {"code": 4012, "message": "未登录"}, 401)
            return json_response(route, {"code": 0, "data": {
                "_id": "507f1f77bcf86cd799439013",
                "tenantId": "507f1f77bcf86cd799439014",
                "channelId": "507f1f77bcf86cd799439012",
                "conversationId": "507f1f77bcf86cd799439015",
                "identityType": "customer",
                "phone": "13800000000",
                "qq": "12345",
            }})
        if path == "/client/conversation":
            return json_response(route, {"code": 0, "data": {
                "_id": "507f1f77bcf86cd799439015",
                "tenantId": "507f1f77bcf86cd799439014",
                "channelId": "507f1f77bcf86cd799439012",
                "customerId": "507f1f77bcf86cd799439013",
                "status": "waiting",
                "createdAt": "2026-09-23T00:00:00.000Z",
            }})
        if path == "/client/conversation/messages":
            return json_response(route, {"code": 0, "data": []})
        if path == "/wechat/client/binding":
            return json_response(route, {"code": 0, "data": {
                "bound": bound,
                "available": True,
                "account": "测试公众号",
            }})
        if path == "/wechat/client/unbind":
            return json_response(route, {"code": 0, "data": {"unbound": True}})
        if path == "/wechat/client/login":
            return json_response(route, {"code": 0, "data": {
                "id": CHALLENGE_ID,
                "phrase": "青山-明月",
                "scanUrl": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='white'/%3E%3Cpath d='M20 20h60v60H20zm120 0h60v60h-60zM20 140h60v60H20z' fill='black'/%3E%3C/svg%3E",
                "expiresAt": "2026-09-23T12:00:00.000Z",
            }})
        if path == "/wechat/client/direct-login":
            return json_response(route, {"code": 0, "data": {
                "id": CHALLENGE_ID,
                "phrase": "青山-明月",
                "authorizationUrl": "https://open.weixin.qq.com/connect/oauth2/authorize?appid=test&redirect_uri=https%3A%2F%2Fexample.test&response_type=code&scope=snsapi_base&state=" + "a" * 64 + "#wechat_redirect",
            }})
        if path.startswith("/wechat/client/status/"):
            return json_response(route, {"code": 0, "data": {"state": "pending", "expiresAt": "2099-01-01T00:00:00.000Z"}})
        if path.startswith("/wechat/client/cancel/"):
            return json_response(route, {"code": 0, "data": {}})
        return json_response(route, {"code": 0, "data": {}})

    page.route("**/api/**", handle)
    page.route("**/socket.io/**", lambda route: route.abort())
    return requests


def assert_no_horizontal_overflow(page, label):
    dimensions = page.evaluate("() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})")
    assert dimensions["scroll"] <= dimensions["client"] + 1, f"{label}: unexpected horizontal overflow {dimensions}"


def open_chat(page, *, authenticated=True, bound=False):
    if authenticated:
        page.add_init_script("localStorage.setItem('client_token', 'mock-session-token')")
    install_api_mocks(page, authenticated=authenticated, bound=bound)
    page.goto(f"{BASE_URL}/c/{CHANNEL_TOKEN}")
    page.wait_for_load_state("networkidle")
    page.locator(".loading-page").wait_for(state="detached")


def test_five_viewports(browser):
    for width in VIEWPORTS:
        page = browser.new_page(viewport={"width": width, "height": 844})
        open_chat(page)
        page.get_by_text("忆梦云客服", exact=True).wait_for()
        assert_no_horizontal_overflow(page, f"chat-{width}")
        page.close()


def test_desktop_qr(browser):
    page = browser.new_page(viewport={"width": 1024, "height": 768})
    open_chat(page, authenticated=False)
    page.get_by_role("button", name="客户账号").click()
    page.get_by_role("button", name="使用微信授权登录").click()
    page.get_by_role("dialog", name="微信授权登录").wait_for()
    assert page.locator("img.wechat-qr-image").get_attribute("src").startswith("data:image/svg+xml")
    assert "青山-明月" in page.locator(".wechat-phrase-box").inner_text()
    assert_no_horizontal_overflow(page, "desktop-qr")
    page.close()


def test_reminder_rate_limit_and_unbind(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    open_chat(page)
    reminder = page.get_by_role("complementary", name="微信绑定提醒")
    reminder.wait_for()
    reminder.get_by_role("button", name="关闭微信绑定提醒").click()
    key = page.evaluate("() => Object.keys(localStorage).find(key => key.startsWith('client_wechat_reminder_'))")
    until = int(page.evaluate("key => localStorage.getItem(key)", key))
    assert until > 0
    page.reload()
    page.wait_for_load_state("networkidle")
    assert reminder.count() == 0
    page.close()

    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.on("dialog", lambda dialog: dialog.accept())
    open_chat(page, bound=True)
    page.get_by_role("button", name="控制面板").click()
    page.get_by_role("button", name="解绑微信").click()
    page.get_by_text("微信已解绑，请重新登录").wait_for()
    assert page.evaluate("() => localStorage.getItem('client_token')") is None
    page.get_by_text("请选择本次咨询身份").wait_for()
    page.close()


def test_direct_oauth_entry(browser):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent="Mozilla/5.0 MicroMessenger/8.0.50",
    )
    page = context.new_page()
    requests = install_api_mocks(page, authenticated=False)
    page.route("https://open.weixin.qq.com/**", lambda route: route.fulfill(status=200, content_type="text/html", body="direct oauth mock"))
    page.goto(f"{BASE_URL}/c/{CHANNEL_TOKEN}")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="客户账号").click()
    page.get_by_role("button", name="使用微信授权登录").click()
    page.wait_for_url("https://open.weixin.qq.com/**")
    assert any(path == "/wechat/client/direct-login" for _, path, _ in requests)
    assert not any(path == "/wechat/client/login" for _, path, _ in requests)
    context.close()


def test_multi_identity_direct_confirm(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    requests = []

    def handle(route):
        path = route.request.url.split("/api", 1)[-1].split("?", 1)[0]
        requests.append(path)
        if path == f"/wechat/client/confirm/{CHALLENGE_ID}" and route.request.method == "GET":
            return json_response(route, {"code": 0, "data": {
                "purpose": "login",
                "authMode": "direct",
                "account": "测试公众号",
                "channel": "测试渠道",
                "phrase": "青山-明月",
                "channelPublicToken": CHANNEL_TOKEN,
                "candidates": [
                    {"id": "binding-a", "label": "客户 A", "subjectType": "customer"},
                    {"id": "binding-b", "label": "访客 B", "subjectType": "visitor"},
                ],
            }})
        if path == f"/wechat/client/confirm/{CHALLENGE_ID}":
            assert "binding-b" in (route.request.post_data or "")
            return json_response(route, {"code": 0, "data": {"confirmed": True}})
        if path == f"/wechat/client/redeem/{CHALLENGE_ID}":
            return json_response(route, {"code": 0, "data": {"token": "direct-session-token"}})
        return json_response(route, {"code": 0, "data": {}})

    page.route("**/api/**", handle)
    page.goto(f"{BASE_URL}/wechat-client-confirm?id={CHALLENGE_ID}&code=must-be-removed&state=must-be-removed")
    page.wait_for_load_state("networkidle")
    page.get_by_text("访客 B", exact=True).click()
    page.get_by_role("button", name="确认使用所选身份登录").click()
    page.wait_for_url(f"**/c/{CHANNEL_TOKEN}")
    assert page.evaluate("() => localStorage.getItem('client_token')") == "direct-session-token"
    assert "code=" not in page.url and "state=" not in page.url
    page.close()


def test_notification_exchange(browser):
    page = browser.new_page(viewport={"width": 360, "height": 800})
    captured = []

    def handle(route):
        captured.append((route.request.method, route.request.url, route.request.headers, route.request.post_data))
        return json_response(route, {"code": 0, "data": {
            "token": "notification-session-token",
            "subjectType": "visitor",
            "channelPublicToken": CHANNEL_TOKEN,
            "conversationId": "507f1f77bcf86cd799439015",
        }})

    page.route("**/api/wechat/notification/exchange", handle)
    page.goto(f"{BASE_URL}/wechat-notification?code=secret-code&state=secret-state&reference=secret-reference")
    page.wait_for_url(f"**/c/{CHANNEL_TOKEN}")
    assert page.evaluate("() => localStorage.getItem('client_token')") == "notification-session-token"
    assert captured[0][2].get("x-wechat-intent") == "notification-v1"
    assert "secret-code" not in page.url and "secret-state" not in page.url and "secret-reference" not in page.url
    assert_no_horizontal_overflow(page, "notification")
    page.close()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        test_five_viewports(browser)
        test_desktop_qr(browser)
        test_reminder_rate_limit_and_unbind(browser)
        test_direct_oauth_entry(browser)
        test_multi_identity_direct_confirm(browser)
        test_notification_exchange(browser)
        browser.close()
    print("client-web Playwright: 5 viewports and WeChat mock flows passed")


if __name__ == "__main__":
    main()
