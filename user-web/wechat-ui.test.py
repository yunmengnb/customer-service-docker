# 忆梦云团队开发
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in [360, 390, 768, 1024, 1440]:
        page = browser.new_page(viewport={"width": width, "height": 900})
        page.add_init_script("sessionStorage.setItem('tenant_token','mock'); sessionStorage.setItem('tenant_user',JSON.stringify({_id:'mock',role:'owner',displayName:'Test'}));")
        state = {"configuration": None}
        def handle(route):
            if '/extensions/wechat-official' in route.request.url:
                if route.request.method == 'PUT':
                    data = route.request.post_data_json
                    assert data['password'] == 'mock-password'
                    state['configuration'] = {"appId": data['appId'], "displayName": data['displayName'], "configVersion": 1, "callbackUrl": 'https://example.test/api/wechat/callback/' + 'a' * 64, "oauthDomain": 'example.test', "lastCredentialResult": 'not_checked'}
                    route.fulfill(json={"code": 0, "data": state['configuration']})
                else:
                    route.fulfill(json={"code": 0, "data": state})
            else:
                route.fulfill(json={"code": 0, "data": {"user": {"role": "owner"}, "tenant": {"name": "Mock"}}})
        page.route('**/api/**', handle)
        prefix = 'm' if width < 768 else 'desktop'
        page.goto(f'http://127.0.0.1:5178/{prefix}/extensions/wechat-official')
        page.wait_for_load_state('networkidle')
        page.get_by_role('heading', name='微信公众号', exact=True).wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow at {width}'
        inputs = page.locator('.wechat-config form input')
        for index, value in enumerate(['Mock Account', 'wx1234567890abcdef', 'mocksecret123456789', 'mocktoken', 'a' * 43, 'mock-password']):
            inputs.nth(index).fill(value)
        page.get_by_role('button', name='保存草稿', exact=True).click()
        page.get_by_text('草稿已保存，所有用户能力保持关闭。', exact=True).wait_for()
        assert inputs.nth(2).input_value() == ''
        assert inputs.nth(5).input_value() == ''
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'configured overflow at {width}'
        print(f'PASS viewport={width}: AJAX save, secret clear, no horizontal overflow')
        page.close()
    browser.close()
