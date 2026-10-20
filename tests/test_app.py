import os
os.environ['ADMIN_USER']='test'
os.environ['ADMIN_PASSWORD']='test-password'
os.environ['ENABLE_POLLER']='false'
os.environ['DATABASE_PATH']='/tmp/match-monitor-test.sqlite3'
import app as m
import pytest
from fastapi.testclient import TestClient
from datetime import datetime,timezone,timedelta

@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(m,'DB',tmp_path/'test.sqlite')
    m.init_db()

@pytest.fixture
def client():
    with TestClient(m.app) as c: yield c

def fixture(status='NS',home=0,away=0):
    return {'fixture':{'id':12,'date':'2026-10-21T12:00:00Z','status':{'short':status}},'teams':{'home':{'name':'A'},'away':{'name':'B'}},'goals':{'home':home,'away':away},'score':{'fulltime':{'home':1,'away':0}}}

def create(client,monkeypatch,start=None):
    monkeypatch.setattr(m,'api',lambda *a:[fixture()])
    return client.post('/api/tasks',auth=('test','test-password'),json={'fixture_id':12,'home':'spoof','away':'spoof','start_at':start or datetime.now(timezone.utc).isoformat(),'interval_minutes':5,'tickets':[]})

@pytest.mark.parametrize('score,selection',[( (6,0),'胜其他'),((4,3),'胜其他'),((5,2),'5:2'),((0,6),'负其他'),((4,4),'平其他'),((3,3),'3:3'),((1,0),'1:0')])
def test_outcome(score,selection):
    r=m.outcome(*score,[{'selection':selection,'stake':2,'odds':1.23}]);assert r=={'selection':selection,'payout':2.46,'net':.46,'total':2.0}

def test_auth(client):
    for path in ['/','/api/tasks','/api/fixtures?date=2026-10-20','/api/usage','/api/health']:
        assert client.get(path).status_code==401
    assert client.get('/docs').status_code==404
    assert client.post('/api/tasks',headers={'origin':'https://evil.example'}).status_code==403

def test_future_resume(client,monkeypatch):
    start=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
    assert create(client,monkeypatch,start).status_code==200
    for action in ['pause','resume']:assert client.post('/api/tasks/1/'+action,auth=('test','test-password')).status_code==200
    r=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert datetime.fromisoformat(r['next_check'])>=datetime.fromisoformat(start)
    assert r['home']=='A'

def task(client,monkeypatch):
    create(client,monkeypatch)
    with m.conn() as c:return dict(c.execute('SELECT * FROM tasks').fetchone())

def test_notification_retry(client,monkeypatch):
    t=task(client,monkeypatch)
    monkeypatch.setattr(m,'api',lambda *a:[fixture('FT',6,0)])
    monkeypatch.setattr(m,'notify',lambda *a:(_ for _ in ()).throw(RuntimeError('offline')))
    with pytest.raises(RuntimeError):m.tick(t)
    with m.conn() as c:assert c.execute('SELECT last_score FROM tasks').fetchone()[0] is None

def test_postponement(client,monkeypatch):
    t=task(client,monkeypatch);monkeypatch.setattr(m,'api',lambda *a:[fixture('PST')]);m.tick(t)
    with m.conn() as c:assert c.execute('SELECT status FROM tasks').fetchone()[0]=='running'

def test_extra_time_90_minutes(client,monkeypatch):
    t=task(client,monkeypatch);monkeypatch.setattr(m,'api',lambda *a:[fixture('AET',2,0)]);m.tick(t)
    with m.conn() as c:assert c.execute('SELECT last_score FROM tasks').fetchone()[0]=='1:0'

def test_cancel_review(client,monkeypatch):
    t=task(client,monkeypatch);monkeypatch.setattr(m,'api',lambda *a:[fixture('CANC')]);m.tick(t)
    with m.conn() as c:assert c.execute('SELECT status FROM tasks').fetchone()[0]=='review_required'

def test_ticket_validation(client,monkeypatch):
    create(client,monkeypatch)
    for ticket in [{'selection':'胜其他','stake':3,'odds':2},{'selection':'bad','stake':2,'odds':2}]:
        assert client.put('/api/tasks/1/tickets',auth=('test','test-password'),json=[ticket]).status_code==422

def test_budget_atomic(monkeypatch):
    monkeypatch.setenv('APISPORTS_KEY','fake-test-only');monkeypatch.setenv('API_DAILY_LIMIT','1')
    monkeypatch.setattr(m,'request_json',lambda *a,**kw:{'response':[]})
    m.api('fixtures',{})
    with pytest.raises(RuntimeError,match='budget'):m.api('fixtures',{})
