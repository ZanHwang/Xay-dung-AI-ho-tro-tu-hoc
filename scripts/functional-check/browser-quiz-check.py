import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(tempfile.gettempdir()) / 'tuhoc-functional-check'
fixture = json.loads((root / 'browser-fixture.json').read_text())
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE'), headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1000})
    page.set_default_timeout(25000)
    forbidden = []
    def guard(route):
        url = route.request.url
        if '/conversations/chat' in url or '/essays/grade' in url or '/reading/' in url and ('/ask' in url or '/summarize' in url):
            forbidden.append(url)
            route.abort()
        else:
            route.continue_()
    page.route('**/api/**', guard)
    page.goto('http://localhost:5173/login', wait_until='networkidle')
    page.get_by_label('Email',exact=True).fill(fixture['student'])
    page.get_by_label('Mật khẩu',exact=True).fill(fixture['password'])
    page.get_by_role('button',name='Đăng nhập',exact=True).click()
    page.wait_for_url('**/workspace')
    page.get_by_role('button',name='Môn học',exact=True).first.click()
    card = page.locator('article').filter(has=page.get_by_role('heading',name='Toan kiem thu',exact=True))
    card.get_by_role('button',name='Mở môn học',exact=False).click()
    page.get_by_role('tab',name='Quiz',exact=True).click()
    row = page.locator('.list-row').filter(has=page.get_by_text('Functional quiz',exact=True))
    row.get_by_role('button',name='Làm lại Functional quiz',exact=True).click()
    submissions = []
    page.on('response', lambda r: submissions.append(r.status) if '/submit' in r.url else None)
    for round_number in (1, 2):
        expect(page.locator('fieldset')).to_have_count(3)
        for fieldset in page.locator('fieldset').all():
            fieldset.get_by_role('radio').first.check()
        page.get_by_role('button',name='Nộp bài',exact=True).click()
        status = page.get_by_role('status').filter(has_text='3/3 câu đúng')
        expect(status).to_be_visible()
        page.wait_for_timeout(1200)
        expect(status).to_be_visible()
        expect(page.get_by_role('button',name='Nộp bài',exact=True)).to_have_count(0)
        expect(page.locator('fieldset')).to_have_count(0)
        assert len(submissions) == round_number, submissions
        results.append({'check':f'retake round {round_number} stays on result', 'pass':True})
        if round_number == 1:
            page.get_by_role('button',name='Làm lại',exact=True).click()
    page.screenshot(path=str(root/'quiz-retake-result.png'),full_page=True)
    state = page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('jarvis.quizzes.v1:')).map(k => JSON.parse(localStorage.getItem(k)))")
    assert not state[0]['drafts'], state[0]['drafts']
    assert forbidden == [], forbidden
    results.append({'check':'no leftover draft and no AI requests', 'pass':True})
    page.reload(wait_until='networkidle')
    page.wait_for_timeout(1500)
    state_after = page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('jarvis.quizzes.v1:')).map(k => JSON.parse(localStorage.getItem(k)))")
    assert len(state_after[0]['attempts']) == len(state[0]['attempts'])
    results.append({'check':'reload keeps history without duplicate attempts','pass':True})
    browser.close()
(root/'quiz-browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
for result in results:
    print(json.dumps(result),flush=True)
