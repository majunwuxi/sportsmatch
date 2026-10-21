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
    return {'fixture':{'id':12,'date':'2026-10-21T12:00:00Z','status':{'short':status}},'teams':{'home':{'name':'A'},'away':{'name':'B'}},'goals':{'home':home,'away':away},'score':{'fulltime':{'home':1,'away':0},'halftime':{'home':1,'away':0}}}

def create(client,monkeypatch,start=None):
    monkeypatch.setattr(m,'api',lambda *a:[fixture()])
    return client.post('/api/tasks',auth=('test','test-password'),json={'fixture_id':12,'home':'spoof','away':'spoof','start_at':start or datetime.now(timezone.utc).isoformat(),'interval_minutes':5,'tickets':[]})

@pytest.mark.parametrize('score,selection',[( (6,0),'胜其他'),((4,3),'胜其他'),((5,2),'5:2'),((0,6),'负其他'),((4,4),'平其他'),((3,3),'3:3'),((1,0),'1:0')])
def test_outcome(score,selection):
    r=m.outcome(*score,[{'selection':selection,'stake':2,'odds':1.23}]);assert r['selection']==selection and r['payout']==2.46 and r['net']==.46 and r['total']==2.0
    assert r['tickets'][0]['won'] is True and r['tickets'][0]['share_pct']==100

def test_other_character_spelling_is_valid_and_settles_like_other_score():
    tickets=m.validate_tickets([m.Ticket(market='correct_score',selection='负其它',stake=2,odds=2.5)])
    result=m.outcome(0,6,tickets)
    assert result['tickets'][0]['selection']=='负其它'
    assert result['tickets'][0]['won'] is True
    assert result['payout']==5

def test_all_jczq_markets_settle_against_regular_time_and_halftime():
    tickets=[
        {'market':'correct_score','selection':'2:1','stake':2,'odds':6},
        {'market':'match_result','selection':'胜','stake':2,'odds':1.5},
        {'market':'handicap','selection':'平','handicap':-1,'stake':2,'odds':3},
        {'market':'total_goals','selection':'3','stake':2,'odds':2},
        {'market':'half_full','selection':'胜胜','stake':4,'odds':2},
    ]
    r=m.outcome(2,1,tickets,1,0)
    assert [x['won'] for x in r['tickets']]==[True,True,True,True,True]
    assert r['payout']==33 and r['net']==21 and r['total']==12
    assert [x['share_pct'] for x in r['tickets']]==[16.67,16.67,16.67,16.67,33.33]

def test_mixed_markets_only_pay_selections_that_win():
    tickets=[
        {'market':'correct_score','selection':'1:0','stake':2,'odds':8},
        {'market':'match_result','selection':'平','stake':2,'odds':3},
        {'market':'total_goals','selection':'7+','stake':2,'odds':5},
        {'market':'half_full','selection':'平胜','stake':2,'odds':10},
    ]
    r=m.outcome(1,0,tickets,None,None)
    assert [x['won'] for x in r['tickets']]==[True,False,False,None]
    assert r['payout']==16 and r['net']==8 and r['pending_tickets']==1

def test_total_goals_seven_plus_and_handicap_other_side():
    r=m.outcome(4,3,[{'market':'total_goals','selection':'7+','stake':2,'odds':2},{'market':'handicap','selection':'平','handicap':-1,'stake':2,'odds':4}])
    assert [x['won'] for x in r['tickets']]==[True,True]
    assert r['payout']==12

def test_auth(client):
    for path in ['/','/ocr-parser.js','/ocr-ui.js','/api/tasks','/api/fixtures?date=2026-10-20','/api/usage','/api/health']:
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
    with m.conn() as c:
        row=c.execute('SELECT last_score,settlement_score,half_score FROM tasks').fetchone()
        assert tuple(row)==('2:0','1:0','1:0')

def test_cancel_review(client,monkeypatch):
    t=task(client,monkeypatch);monkeypatch.setattr(m,'api',lambda *a:[fixture('CANC')]);m.tick(t)
    with m.conn() as c:assert c.execute('SELECT status FROM tasks').fetchone()[0]=='review_required'

def test_ticket_validation(client,monkeypatch):
    create(client,monkeypatch)
    for ticket in [{'selection':'胜其他','stake':3,'odds':2},{'selection':'bad','stake':2,'odds':2},
                   {'market':'handicap','selection':'胜','stake':2,'odds':2},
                   {'market':'total_goals','selection':'8','stake':2,'odds':2}]:
        assert client.put('/api/tasks/1/tickets',auth=('test','test-password'),json=[ticket]).status_code==422
    for ticket in [{'market':'match_result','selection':'胜','stake':2,'odds':2},
                   {'market':'correct_score','selection':'负其它','stake':2,'odds':2},
                   {'market':'handicap','selection':'平','handicap':-1,'stake':4,'odds':3},
                   {'market':'total_goals','selection':'7+','stake':2,'odds':1.9},
                   {'market':'half_full','selection':'负胜','stake':2,'odds':8}]:
        assert client.put('/api/tasks/1/tickets',auth=('test','test-password'),json=[ticket]).status_code==200

def test_tasks_expose_chinese_status_and_bet_breakdown(client,monkeypatch):
    create(client,monkeypatch)
    with m.conn() as c:
        c.execute("UPDATE tasks SET last_score='2:1',settlement_score='2:1',half_score='1:0'")
        c.execute("UPDATE tasks SET ticket_json=?",('[{"market":"half_full","selection":"胜胜","stake":4,"odds":2},{"market":"match_result","selection":"平","stake":2,"odds":3}]',))
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert row['status_cn']=='等待开始'
    assert row['settlement']['tickets'][0]['won'] is True
    assert row['settlement']['tickets'][0]['share_pct']==66.67
    assert row['settlement']['tickets'][1]['won'] is False

def test_tasks_sort_upcoming_by_start_and_hide_finished_after_24_hours(client):
    now=datetime.now(timezone.utc)
    def add(fixture_id,status,start,created,finished_at=None):
        with m.conn() as c:
            cur=c.execute("""INSERT INTO tasks(fixture_id,home,away,start_at,interval_minutes,next_check,status,finished_at,ticket_json,created_at)
                VALUES(?, 'A', 'B', ?, 5, ?, ?, ?, '[]', ?)""",
                (fixture_id,start.isoformat(),now.isoformat(),status,finished_at.isoformat() if finished_at else None,created.isoformat()))
            return cur.lastrowid
    older_created=now-timedelta(hours=2)
    soon=add(101,'pending',now+timedelta(minutes=15),older_created)
    next_up=add(102,'paused',now+timedelta(minutes=45),older_created+timedelta(minutes=1))
    later=add(103,'pending',now+timedelta(hours=2),older_created+timedelta(minutes=2))
    add(104,'running',now-timedelta(minutes=10),now-timedelta(minutes=1))
    recent_finished=add(105,'finished',now-timedelta(hours=26),now-timedelta(hours=25),now-timedelta(hours=23))
    expired_finished=add(106,'finished',now-timedelta(hours=30),now-timedelta(hours=29),now-timedelta(hours=24,seconds=1))

    rows=client.get('/api/tasks',auth=('test','test-password')).json()
    ids=[row['id'] for row in rows]
    assert ids[:3]==[soon,next_up,later]
    assert recent_finished in ids
    assert expired_finished not in ids

def test_poll_uses_live_score_for_display_and_chinese_telegram(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'DB',tmp_path/'tick.sqlite')
    m.init_db()
    t={'id':321,'fixture_id':12,'home':'A','away':'B','interval_minutes':5,'ticket_json':'[{"market":"correct_score","selection":"1:0","stake":2,"odds":4}]','last_score':None}
    f=fixture('AET',2,0);f['score']={'fulltime':{'home':1,'away':0},'halftime':{'home':0,'away':0}}
    monkeypatch.setattr(m,'api',lambda *a:[f]);messages=[];monkeypatch.setattr(m,'notify',messages.append)
    with m.conn() as c:
        c.execute("INSERT OR REPLACE INTO tasks(id,fixture_id,home,away,start_at,interval_minutes,next_check,ticket_json,created_at) VALUES(321,12,'A','B','2026-01-01T00:00:00+00:00',5,'2026-01-01T00:00:00+00:00',?,'2026-01-01T00:00:00+00:00')",(t['ticket_json'],))
    m.tick(t)
    with m.conn() as c:
        row=c.execute('SELECT last_score,settlement_score,status,finished_at FROM tasks WHERE id=321').fetchone()
    assert tuple(row[i] for i in range(3))==('2:0','1:0','finished')
    assert row['finished_at'] is not None
    assert '状态：加时赛结束' in messages[0]
    assert '返奖 ¥8.00' in messages[0]

def test_poll_does_not_repeat_no_score_notice(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'DB',tmp_path/'pending.sqlite');m.init_db()
    f=fixture('NS',None,None);monkeypatch.setattr(m,'api',lambda *a:[f]);messages=[];monkeypatch.setattr(m,'notify',messages.append)
    with m.conn() as c:
        c.execute("INSERT INTO tasks(fixture_id,home,away,start_at,interval_minutes,next_check,ticket_json,created_at) VALUES(12,'A','B','2026-01-01T00:00:00+00:00',5,'2026-01-01T00:00:00+00:00','[]','2026-01-01T00:00:00+00:00')")
        task=dict(c.execute('SELECT * FROM tasks').fetchone())
    m.tick(task)
    with m.conn() as c: task=dict(c.execute('SELECT * FROM tasks').fetchone())
    m.tick(task)
    assert len(messages)==1 and '状态：未开赛' in messages[0]

def test_existing_database_migration_preserves_tasks_and_tickets(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'DB',tmp_path/'legacy.sqlite')
    with m.conn() as c:
        c.executescript("""
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, fixture_id INTEGER NOT NULL UNIQUE,
          home TEXT NOT NULL, away TEXT NOT NULL, kickoff TEXT, start_at TEXT NOT NULL,
          interval_minutes INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending', last_score TEXT, last_check TEXT,
          next_check TEXT NOT NULL, ticket_json TEXT NOT NULL DEFAULT '[]', error TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE usage (utc_day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0);
        INSERT INTO tasks(fixture_id,home,away,start_at,interval_minutes,next_check,last_score,status,last_check,ticket_json,created_at)
        VALUES(22,'A','B','2026-10-21T00:00:00+00:00',10,'2026-10-21T00:00:00+00:00','3:0','finished','2026-10-21T01:00:00+00:00','[{"selection":"3:0","stake":2,"odds":5}]','2026-10-20T00:00:00+00:00');
        """)
    m.init_db()
    with m.conn() as c:
        row=c.execute('SELECT last_score,settlement_score,ticket_json,finished_at FROM tasks WHERE fixture_id=22').fetchone()
        columns={r[1] for r in c.execute('PRAGMA table_info(tasks)')}
    assert tuple(row[i] for i in range(3))==('3:0','3:0','[{"selection":"3:0","stake":2,"odds":5}]')
    assert row['finished_at']=='2026-10-21T01:00:00+00:00'
    assert {'settlement_score','half_score','provider_status','finished_at'}<=columns

def test_index_contains_simulator_and_no_old_score_calculator():
    html=(m.Path(__file__).parents[1]/'index.html').read_text(encoding='utf-8')
    assert '竞彩足球比分投注模拟器' in html
    assert '下载JSON文件' in html and '自动均衡分配' in html
    assert 'betScreenshot' in html and 'ocrConfirm' in html and '/ocr-parser.js' in html and '/ocr-ui.js' in html
    assert 'id="simulatorManual" hidden' in html and 'id="manualMode"' in html
    assert '网易投注助手比赛链接' not in html and 'bettingLink' not in html and 'netease_betting_assistant_url' not in html
    assert '竞彩单场比分计算' not in html
    assert 'MARKETS={correct_score:"比分"' in html and '半全场' in html

def test_ocr_assets_are_authenticated_and_local_code_only(client):
    for path, marker in [('/ocr-parser.js','MatchMonitorOCR'),('/ocr-ui.js','createImageBitmap(file)')]:
        response=client.get(path,auth=('test','test-password'))
        assert response.status_code==200
        assert 'javascript' in response.headers['content-type']
        assert marker in response.text
    ui=(m.Path(__file__).parents[1]/'ocr-ui.js').read_text(encoding='utf-8')
    assert 'worker.recognize(canvases.ocr' in ui
    assert 'FormData' not in ui
    assert 'screenshotFile' not in ui[ui.index('function buildOcrPayload'):ui.index('function clearOcr')]

def test_budget_atomic(monkeypatch):
    monkeypatch.setenv('APISPORTS_KEY','fake-test-only');monkeypatch.setenv('API_DAILY_LIMIT','1')
    monkeypatch.setattr(m,'request_json',lambda *a,**kw:{'response':[]})
    m.api('fixtures',{})
    with pytest.raises(RuntimeError,match='budget'):m.api('fixtures',{})
