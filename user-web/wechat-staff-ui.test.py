# 忆梦云团队开发
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in [360, 390, 768, 1024, 1440]:
        page = browser.new_page(viewport={"width": width, "height": 900})
        page.add_init_script("sessionStorage.setItem('tenant_token','mock');")
        state = {"bound": False, "confirmed": False, "finished": False}
        def handle(route):
            path = route.request.url.split('/api/wechat/staff/')[-1]
            data = {}
            if path == 'binding':
                data = {"bound": state['bound'], "available": True, "account": "测试服务号"}
            elif path == 'bind':
                assert route.request.post_data_json['password'] == 'mock-password'
                assert route.request.headers['x-wechat-intent'] == 'staff-v1'
                data = {"id": 'a' * 24, "phrase": "ABC123", "scanUrl": "https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=mock-ticket"}
            elif path.startswith('status/'):
                data = {"state": "confirmed", "phrase": "ABC123"}
            elif path.startswith('finish-bind/'):
                assert route.request.post_data_json['confirm'] is True
                state['bound'] = True
                data = {"bound": True}
            elif path == 'unbind':
                assert route.request.post_data_json['password'] == 'mock-password'
                state['bound'] = False
            elif path.startswith('confirm/'):
                if route.request.method == 'POST':
                    assert route.request.post_data_json['bindingId'] == 'candidate-A'
                    state['confirmed'] = True
                else:
                    data = {"purpose": "login", "phrase": "ABC123", "company": "测试企业", "account": "测试服务号", "candidates": [{"id": "candidate-A", "label": "客服甲"}, {"id": "candidate-B", "label": "客服乙"}]}
            route.fulfill(json={"code": 0, "data": data})
        page.route('**/api/**', handle)
        page.goto('http://127.0.0.1:5178/wechat-binding')
        page.wait_for_load_state('networkidle')
        page.get_by_label('当前账号密码').fill('mock-password')
        page.get_by_role('button', name='生成绑定二维码').click()
        page.get_by_alt_text('请使用微信扫描授权二维码').wait_for()
        assert page.get_by_alt_text('请使用微信扫描授权二维码').get_attribute('src').startswith('https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('button', name='核对短语一致，完成绑定').click()
        page.get_by_text('绑定成功。通知尚未开放。').wait_for()
        page.get_by_label('当前账号密码').fill('mock-password')
        page.get_by_role('button', name='确认解绑并撤销微信会话').click()
        page.wait_for_url('http://127.0.0.1:5178/login')
        assert page.evaluate("sessionStorage.getItem('tenant_token')") is None
        page.goto('http://127.0.0.1:5178/wechat-confirm?id=' + 'a' * 24)
        page.wait_for_load_state('networkidle')
        button = page.get_by_role('button', name='我已核对，明确同意')
        assert button.is_disabled()
        assert not state['confirmed']
        page.get_by_label('客服甲').check()
        button.click()
        page.get_by_text('已确认，请回到原浏览器完成操作。').wait_for()
        assert state['confirmed']
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        print(f'PASS {width}: QR, browser bind confirmation, unbind, explicit identity choice, no overflow (mock API)')
        page.close()
    browser.close()
