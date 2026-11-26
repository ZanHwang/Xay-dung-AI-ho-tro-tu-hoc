import json
import uuid
from datetime import timedelta
from pathlib import Path
import httpx
import runtime
from app.database import SessionLocal
from app.models import Quiz, QuizQuestion, Review, Document, DocumentStatus
from app.utils.dates import today_hcm

out = []
client = httpx.Client(base_url='http://127.0.0.1:8000', timeout=30)
marker = client.get('/_functional-check')
if marker.status_code != 200 or marker.json().get('isolated_functional_check') is not True:
    raise SystemExit('Start scripts/functional-check/runtime.py before running checks')
def check(label, method, path, expected=200, headers=None, **kw):
    response = client.request(method, path, headers=headers, **kw)
    row = {'check': label, 'status': response.status_code, 'expected': expected, 'pass': response.status_code == expected}
    try:
        data = response.json()
    except ValueError:
        data = {'text': response.text[:300]}
    if not row['pass']:
        row['response'] = data
    out.append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
    return data

suffix = uuid.uuid4().hex[:8]
def account(role):
    email = role + suffix + '@example.com'
    user = check('register ' + role, 'POST', '/api/auth/register', 201,
                 json={'email': email, 'full_name': 'Functional ' + role, 'password': 'CheckOnly123!', 'confirm_password': 'CheckOnly123!', 'role': role})
    login = check('login ' + role, 'POST', '/api/auth/login', data={'username':email, 'password':'CheckOnly123!'})
    return user, {'Authorization':'Bearer ' + login['access_token']}, email

check('root', 'GET', '/')
check('database health', 'GET', '/health/db')
student, sh, email = account('student')
teacher, th, _ = account('teacher')
check('profile', 'GET', '/api/auth/me', headers=sh)
check('wrong password', 'POST', '/api/auth/login', 401, data={'username':email, 'password':'wrong'})
check('unauthenticated access', 'GET', '/api/subjects/', 401)
subject = check('create subject', 'POST', '/api/subjects/', 201, headers=sh, json={'name':'Toan hoc','color':'#ff0000'})
sid = subject['id']
check('list subjects', 'GET', '/api/subjects/', headers=sh)
check('update subject', 'PUT', '/api/subjects/' + sid, headers=sh, json={'name':'Toan kiem thu'})
check('subject ownership', 'GET', '/api/subjects/' + sid, 404, headers=th)
check('dashboard', 'GET', '/api/progress/dashboard', headers=sh)
check('empty learning path', 'GET', f'/api/subjects/{sid}/path/topics', headers=sh)
conversation = check('create empty conversation (no AI)', 'POST', '/api/conversations/', 201, headers=sh, json={'title':'Functional history', 'subject_id':sid})
cid = conversation['id']

with SessionLocal() as db:
    quiz = Quiz(user_id=uuid.UUID(student['id']), subject_id=uuid.UUID(sid), title='Functional quiz', difficulty='medium', source='shared')
    db.add(quiz); db.flush()
    questions = [QuizQuestion(quiz_id=quiz.id, question_text=f'{n}+1=?', options=json.dumps([str(n+1),'0','-1','9']), correct_answer=0, explanation='Addition') for n in range(3)]
    db.add_all(questions); db.commit()
    qid = str(quiz.id); question_ids = [str(q.id) for q in questions]
    doc = Document(user_id=uuid.UUID(student['id']), subject_id=uuid.UUID(sid), filename='fixture.pdf', file_path=str(Path(runtime.ROOT) / 'fixture.pdf'), file_type='pdf', status=DocumentStatus.READY, total_pages=1, topics_json='[]')
    db.add(doc); db.commit(); did = str(doc.id)

check('get quiz', 'GET', '/api/quizzes/' + qid, headers=sh)
result = check('submit partial quiz', 'POST', f'/api/quizzes/{qid}/submit', headers=sh, json={'answers':[{'question_id':question_ids[0], 'selected_answer':0}]})
out.append({'check':'partial score consistency', 'score':result.get('score'), 'expected_score':100/3, 'correct_count':result.get('correct_count'), 'total_questions':result.get('total_questions'), 'pass':abs(result.get('score', -1)-100/3)<0.1})
check('submit complete quiz', 'POST', f'/api/quizzes/{qid}/submit', headers=sh, json={'answers':[{'question_id':q, 'selected_answer':0} for q in question_ids]})
check('quiz history', 'GET', '/api/quizzes/history/results', headers=sh)
check('retry wrong answers', 'POST', f"/api/quizzes/results/{result['id']}/retry-wrong", 201, headers=sh, json={})
with SessionLocal() as db:
    for r in db.query(Review).filter(Review.user_id == uuid.UUID(student['id'])):
        r.next_review = today_hcm() - timedelta(days=1)
    db.commit()
check('due review listing', 'GET', '/api/progress/reviews/due', headers=sh)
check('cross-subject review creation', 'POST', '/api/quizzes/from-review', 201, headers=sh, json={'num_questions':3})
check('subject review creation', 'POST', '/api/quizzes/from-review', 201, headers=sh, json={'subject_id':sid, 'num_questions':3})
annotation = check('create reading note', 'POST', f'/api/reading/{did}/annotations', 201, headers=sh, json={'page':1,'text':'Test note','type':'note'})
check('list reading notes', 'GET', f'/api/reading/{did}/annotations', headers=sh)
check('delete reading note', 'DELETE', f"/api/reading/{did}/annotations/{annotation['id']}", 204, headers=sh)
room = check('teacher creates class', 'POST', '/api/classes/', 201, headers=th, json={'name':'Functional class'})
check('student cannot create class', 'POST', '/api/classes/', 403, headers=sh, json={'name':'Not allowed'})
check('join class', 'POST', '/api/classes/join', headers=sh, json={'code':room['code']})
check('list joined classes', 'GET', '/api/classes/', headers=sh)
check('list class members', 'GET', f"/api/classes/{room['id']}/members", headers=th)
check('invalid class code', 'POST', '/api/classes/join', 404, headers=sh, json={'code':'ZZZZZZ'})
check('essay history', 'GET', '/api/essays/', headers=sh)
check('reject unsupported upload', 'POST', '/api/documents/', 400, headers=sh, files={'file':('test.exe',b'test','application/octet-stream')})
check('document list', 'GET', '/api/documents/', headers=sh)
check('delete conversation', 'DELETE', f'/api/conversations/{cid}', 204, headers=sh)
check('logout', 'POST', '/api/auth/logout', headers=sh)
(runtime.ROOT / 'api-results.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
(runtime.ROOT / 'browser-fixture.json').write_text(json.dumps({'student':email,'password':'CheckOnly123!','class_code':room['code']}), encoding='utf-8')
print('RESULTS:', sum(r.get('pass') is True for r in out), 'passed;', sum(r.get('pass') is False for r in out), 'failed', flush=True)
raise SystemExit(1 if any(r.get('pass') is False for r in out) else 0)
