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
    return {'fixture':{'id':12,'date':'2026-10-21T12:00:00Z','status':{'short':status}},'teams':{'home':{'name':'A'},'away':{'name':'B'}},'league':{'name':'UEFA Youth League','country':'Europe','season':2026,'round':'League Phase'},'goals':{'home':home,'away':away},'score':{'fulltime':{'home':1,'away':0},'halftime':{'home':1,'away':0}}}

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

def test_other_score_uses_screenshot_sp_list_as_not_in_set():
    tickets=[{'market':'correct_score','selection':'胜其它','stake':2,'odds':20}]
    listed=m.outcome(5,2,tickets,listed_scores=['5:2','2:0'])
    omitted=m.outcome(5,2,tickets,listed_scores=['2:0'])
    assert listed['tickets'][0]['won'] is False
    assert listed['payout']==0
    assert omitted['tickets'][0]['won'] is True
    assert omitted['payout']==40
    exact=m.outcome(5,2,[{'market':'correct_score','selection':'5:2','stake':2,'odds':8}],listed_scores=['5:2'])
    assert exact['tickets'][0]['won'] is True
    away=m.outcome(2,5,[{'market':'correct_score','selection':'负其它','stake':2,'odds':10}],listed_scores=['2:5'])
    assert away['tickets'][0]['won'] is False

def test_task_persists_screenshot_sp_list_and_requires_confirmation(client,monkeypatch):
    monkeypatch.setattr(m,'api',lambda *a:[fixture()])
    body={'fixture_id':12,'home':'spoof','away':'spoof','start_at':datetime.now(timezone.utc).isoformat(),
        'interval_minutes':5,'tickets':[{'market':'correct_score','selection':'胜其它','stake':2,'odds':20}],
        'listed_scores':['5:2','2:0'],'listed_scores_verified':True}
    response=client.post('/api/tasks',auth=('test','test-password'),json=body)
    assert response.status_code==200
    with m.conn() as c:
        c.execute("UPDATE tasks SET last_score='5:2',settlement_score='5:2'")
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert row['listed_scores']==['5:2','2:0']
    assert row['listed_scores_verified'] is True
    assert row['settlement']['score_list_source']=='截图SP识别清单'
    assert row['settlement']['tickets'][0]['won'] is False
    body['listed_scores_verified']=False
    body['fixture_id']=13
    assert client.post('/api/tasks',auth=('test','test-password'),json=body).status_code==422

def test_fixture_search_returns_competition_and_requests_beijing_timezone(client,monkeypatch):
    calls=[]
    monkeypatch.setattr(m,'api',lambda endpoint,params:(calls.append((endpoint,params)) or [fixture()]))
    response=client.get('/api/fixtures?date=2026-10-21',auth=('test','test-password'))
    assert response.status_code==200
    assert calls==[('fixtures',{'date':'2026-10-21','timezone':'Asia/Shanghai'})]
    assert response.json()[0]['league_name']=='UEFA Youth League'
    assert response.json()[0]['kickoff']=='2026-10-21T12:00:00Z'

@pytest.mark.parametrize('query,expected_team', [('曼城','Manchester City'),('Manchester City','Manchester City'),('利物浦','Liverpool'),('利物','Liverpool')])
def test_fixture_search_accepts_chinese_team_names(client,monkeypatch,query,expected_team):
    city=fixture();city['fixture']['id']=50;city['teams']['home']['name']='Manchester City'
    liverpool=fixture();liverpool['fixture']['id']=40;liverpool['teams']['away']['name']='Liverpool'
    arsenal=fixture();arsenal['fixture']['id']=42;arsenal['teams']['home']['name']='Arsenal'
    monkeypatch.setattr(m,'api',lambda *_:[city,liverpool,arsenal])
    response=client.get('/api/fixtures',params={'date':'2026-10-21','q':query},auth=('test','test-password'))
    assert response.status_code==200
    assert len(response.json())==1
    assert expected_team in (response.json()[0]['home'],response.json()[0]['away'])

def test_fixture_search_chinese_partial_name_matches_multiple_teams(client,monkeypatch):
    milan=fixture();milan['fixture']['id']=489;milan['teams']['home']['name']='AC Milan'
    inter=fixture();inter['fixture']['id']=505;inter['teams']['away']['name']='Inter'
    arsenal=fixture();arsenal['fixture']['id']=42;arsenal['teams']['home']['name']='Arsenal'
    monkeypatch.setattr(m,'api',lambda *_:[milan,inter,arsenal])
    response=client.get('/api/fixtures',params={'date':'2026-10-21','q':'米兰'},auth=('test','test-password'))
    assert response.status_code==200
    assert {row['id'] for row in response.json()}=={489,505}

def test_task_stores_competition_and_requests_beijing_local_kickoff(client,monkeypatch):
    provider=fixture()
    provider['fixture']['date']='2026-10-21T19:00:00+08:00'
    calls=[]
    monkeypatch.setattr(m,'api',lambda endpoint,params:(calls.append((endpoint,params)) or [provider]))
    response=client.post('/api/tasks',auth=('test','test-password'),json={'fixture_id':12,'home':'spoof','away':'spoof','start_at':datetime.now(timezone.utc).isoformat(),'interval_minutes':5,'tickets':[]})
    assert response.status_code==200
    assert calls==[('fixtures',{'id':12,'timezone':'Asia/Shanghai'})]
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert row['league_name']=='UEFA Youth League'
    assert row['kickoff']=='2026-10-21T19:00:00+08:00'

def test_poll_backfills_competition_for_existing_tasks(client,monkeypatch):
    create(client,monkeypatch)
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    with m.conn() as c:
        c.execute("UPDATE tasks SET league_name=NULL,next_check=? WHERE id=?",((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat(),row['id']))
    row['league_name']=None
    monkeypatch.setattr(m,'notify',lambda *_:None)
    m.tick(row)
    refreshed=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert refreshed['league_name']=='UEFA Youth League'

def test_listed_score_validation_rejects_non_exact_options():
    with pytest.raises(m.HTTPException) as error:
        m.validate_listed_scores(['负其它'])
    assert error.value.status_code==422

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
    assert r['payout']==16 and r['net'] is None and r['pending_tickets']==1
    groups={x['market']:x for x in r['market_summaries']}
    assert groups['correct_score']['total']==2 and groups['correct_score']['payout']==16 and groups['correct_score']['net']==14
    assert groups['half_full']['pending_tickets']==1 and groups['half_full']['net'] is None

def test_mixed_market_profit_is_settled_and_summed_per_market():
    tickets=[
        {'market':'correct_score','selection':'2:1','stake':4,'odds':7},
        {'market':'correct_score','selection':'2:2','stake':2,'odds':11.5},
        {'market':'total_goals','selection':'3','stake':8,'odds':3.75},
        {'market':'total_goals','selection':'4','stake':6,'odds':4.1},
    ]
    result=m.outcome(2,1,tickets)
    groups={row['market']:row for row in result['market_summaries']}
    assert groups['correct_score']=={
        'market':'correct_score','market_label':'比分','total':6.0,'payout':28.0,'net':22.0,'tickets':2,'pending_tickets':0,
    }
    assert groups['total_goals']=={
        'market':'total_goals','market_label':'总进球','total':14.0,'payout':30.0,'net':16.0,'tickets':2,'pending_tickets':0,
    }
    assert sum(row['net'] for row in groups.values())==result['net']==38.0
    assert result['total']==20.0 and result['payout']==58.0

def test_total_goals_seven_plus_and_handicap_other_side():
    r=m.outcome(4,3,[{'market':'total_goals','selection':'7+','stake':2,'odds':2},{'market':'handicap','selection':'平','handicap':-1,'stake':2,'odds':4}])
    assert [x['won'] for x in r['tickets']]==[True,True]
    assert r['payout']==12

def test_auth(client):
    for path in ['/','/ocr-parser.js','/ocr-ui.js','/teams-map.js','/team-logo/569.png','/brand-logo.webp','/api/tasks','/api/fixtures?date=2026-10-20','/api/usage','/api/health']:
        assert client.get(path).status_code==401
    assert client.get('/docs').status_code==404
    assert client.post('/api/tasks',headers={'origin':'https://evil.example'}).status_code==403
    assert client.put('/api/tasks/1/schedule',json={'start_at':'2026-10-22T12:00:00+08:00','interval_minutes':10}).status_code==401
    assert client.delete('/api/tasks/1').status_code==401
    assert client.delete('/api/tasks/1',auth=('test','test-password'),headers={'origin':'https://evil.example'}).status_code==403

def test_self_hosted_ui_origin_is_allowed_for_authenticated_writes(client,monkeypatch):
    monkeypatch.setenv('PUBLIC_ORIGIN','https://sportsmatch.sendmymail.top')
    response=client.put('/api/tasks/1/schedule',auth=('test','test-password'),
        headers={'origin':'https://sportsmatch.sendmymail.top'},
        json={'start_at':'2026-10-26T12:00:00+08:00','interval_minutes':10})
    assert response.status_code==404

def test_health_advertises_screenshot_score_list_support(client):
    response=client.get('/api/health',auth=('test','test-password'))
    assert response.status_code==200
    assert response.json()['screenshot_score_lists'] is True

def test_future_resume(client,monkeypatch):
    start=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
    assert create(client,monkeypatch,start).status_code==200
    for action in ['pause','resume']:assert client.post('/api/tasks/1/'+action,auth=('test','test-password')).status_code==200
    r=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert datetime.fromisoformat(r['next_check'])>=datetime.fromisoformat(start)
    assert r['home']=='A'

def test_schedule_update_sets_start_and_interval(client,monkeypatch):
    assert create(client,monkeypatch).status_code==200
    start=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()
    response=client.put('/api/tasks/1/schedule',auth=('test','test-password'),json={'start_at':start,'interval_minutes':30})
    assert response.status_code==200
    body=response.json()
    assert body['interval_minutes']==30 and body['status']=='pending'
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert datetime.fromisoformat(row['start_at'])==datetime.fromisoformat(start)
    assert datetime.fromisoformat(row['next_check'])>=datetime.fromisoformat(start)

def test_schedule_update_validates_input_and_preserves_paused_state(client,monkeypatch):
    assert create(client,monkeypatch).status_code==200
    auth=('test','test-password')
    assert client.put('/api/tasks/1/schedule',auth=auth,json={'start_at':'2026-10-22T12:00:00','interval_minutes':10}).status_code==422
    start=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat()
    assert client.put('/api/tasks/1/schedule',auth=auth,json={'start_at':start,'interval_minutes':121}).status_code==422
    assert client.put('/api/tasks/999/schedule',auth=auth,json={'start_at':start,'interval_minutes':10}).status_code==404
    assert client.post('/api/tasks/1/pause',auth=auth).status_code==200
    response=client.put('/api/tasks/1/schedule',auth=auth,json={'start_at':start,'interval_minutes':15})
    assert response.status_code==200 and response.json()['status']=='paused'
    row=client.get('/api/tasks',auth=auth).json()[0]
    assert row['enabled']==0 and row['interval_minutes']==15

def test_schedule_update_rejects_finished_task(client,monkeypatch):
    assert create(client,monkeypatch).status_code==200
    with m.conn() as c:c.execute("UPDATE tasks SET status='finished',enabled=0")
    response=client.put('/api/tasks/1/schedule',auth=('test','test-password'),json={'start_at':datetime.now(timezone.utc).isoformat(),'interval_minutes':10})
    assert response.status_code==409

def test_delete_task_removes_it_and_prevents_a_stale_poll(client,monkeypatch):
    task_data=task(client,monkeypatch)
    response=client.delete('/api/tasks/1',auth=('test','test-password'))
    assert response.status_code==200 and response.json()['deleted']==1
    assert client.get('/api/tasks',auth=('test','test-password')).json()==[]
    assert client.delete('/api/tasks/1',auth=('test','test-password')).status_code==404
    monkeypatch.setattr(m,'api',lambda *a:(_ for _ in ()).throw(AssertionError('deleted task polled')))
    m.tick(task_data)

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

def test_ticket_updates_can_change_stake_and_sp_then_remove_a_row(client,monkeypatch):
    create(client,monkeypatch)
    with m.conn() as c:
        c.execute("UPDATE tasks SET last_score='2:1',settlement_score='2:1'")
    tickets=[
        {'market':'correct_score','selection':'2:1','stake':4,'odds':6},
        {'market':'total_goals','selection':'3','stake':2,'odds':3.5},
    ]
    edited=client.put('/api/tasks/1/tickets',auth=('test','test-password'),json=tickets)
    assert edited.status_code==200 and edited.json()['tickets']==2
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert row['settlement']['total']==6
    assert row['settlement']['payout']==31
    assert row['settlement']['tickets'][0]['stake']==4
    assert row['settlement']['tickets'][0]['odds']==6
    updated=[{'market':'correct_score','selection':'2:1','stake':6,'odds':7.25}]
    removed=client.put('/api/tasks/1/tickets',auth=('test','test-password'),json=updated)
    assert removed.status_code==200 and removed.json()['tickets']==1
    row=client.get('/api/tasks',auth=('test','test-password')).json()[0]
    assert row['tickets']==updated
    assert row['settlement']['total']==6
    assert row['settlement']['payout']==43.5
    assert row['settlement']['net']==37.5

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
    assert {'settlement_score','half_score','provider_status','finished_at','league_name'}<=columns

def test_index_contains_simulator_and_no_old_score_calculator():
    html=(m.Path(__file__).parents[1]/'index.html').read_text(encoding='utf-8')
    assert '竞彩足球比分投注模拟器' in html
    assert 'class="dashboard-layout"' in html and 'class="dashboard-left"' in html
    assert 'id="monitorTasks"' in html and 'class="card simulator-card"' in html
    assert 'class="section-divider"' in html
    assert '.dashboard-layout{display:grid' in html and '@media(max-width:900px)' in html
    assert html.index('<h2>查找比赛</h2>') < html.index('<h2>创建监测任务</h2>') < html.index('<h2>监测任务</h2>') < html.index('class="section-divider"') < html.index('竞彩足球比分投注模拟器')
    assert '下载JSON文件' not in html and '复制投注 JSON' in html and '自动均衡分配' in html
    assert 'betScreenshot' in html and 'ocrConfirm' in html and '/ocr-parser.js' in html and '/ocr-ui.js' in html
    assert 'id="simulatorManual" hidden' in html and 'id="manualMode"' in html
    assert 'id="ocrBudget"' in html and 'ocr-balance-row' in html
    assert 'id="ocrSelectedCount"' in html and 'id="ocrSelectedTotal"' in html
    assert 'id="exportOcrJson"' in html and 'id="applyOcrJson"' in html
    assert 'id="scheduleDialog"' in html and 'id="scheduleStart"' in html
    assert 'id="scheduleInterval"' in html and 'id="saveSchedule"' in html
    assert 'leagueLabel' in html and 'UEFA Youth League' in html and '赛事：' in html
    assert '调整计划' in html and 'textContent="删除"' in html
    assert 'method:"DELETE"' in html and '"/schedule"' in html
    assert '请选择项目、核对SP并分配金额。' in html
    assert 'expandedBetTaskIds' in html and '展开投注' in html and 'aria-expanded' in html
    assert 'finished=t.status==="finished"' in html and 'b.disabled=finished' in html
    assert 'ticketDrafts' in html and 'className="ticket-edit-input"' in html
    assert 'validateInlineTicket' in html and 'textContent="保存"' in html
    assert 'textContent="删除"' in html and 'colSpan=6' in html
    assert 'ticketUpdatesInFlight' in html and '保存失败：' in html
    assert '.task.task-finished{background:#fff7d6' in html
    assert 'box.className="task"+(t.status==="finished"?" task-finished":"")' in html
    ui=(m.Path(__file__).parents[1]/'ocr-ui.js').read_text(encoding='utf-8')
    assert 'Number($("ocrBudget").value)' in ui and 'hasRecognizedSelections' in ui
    assert '$("ocrSelectedTotal").textContent = money(total)' in ui
    assert '$("exportOcrJson").onclick' in ui and 'const payload = buildOcrPayload()' in ui
    assert '$("tickets").value = JSON.stringify(payload, null, 2)' in ui
    assert '网易投注助手比赛链接' not in html and 'bettingLink' not in html and 'netease_betting_assistant_url' not in html
    assert '竞彩单场比分计算' not in html
    assert 'MARKETS={correct_score:"比分"' in html and '半全场' in html

def test_team_map_asset_is_authenticated_and_contains_team_badges(client):
    assert client.get('/teams-map.js').status_code==401
    response=client.get('/teams-map.js',auth=('test','test-password'))
    assert response.status_code==200
    assert 'javascript' in response.headers['content-type']
    assert 'MatchMonitorTeamDirectory' in response.text
    assert 'Club Brugge KV' in response.text and '布鲁日' in response.text
    assert 'Fagiano Okayama' in response.text and '冈山绿雉' in response.text
    assert 'https://media.api-sports.io/football/teams/569.png' in response.text
    assert 'https://thumb.wikimedia.org/wikipedia/en/thumb/0/07/Fagiano_Okayama_logo.svg/960px-Fagiano_Okayama_logo.svg.png?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=thumbnail' in response.text

def test_team_logo_proxy_uses_the_logo_registered_for_each_team(client,monkeypatch):
    calls=[]
    image=b'\x89PNG\r\n\x1a\nvalid-png'
    monkeypatch.setattr(m,'fetch_team_logo',lambda url:(calls.append(url) or image))
    response=client.get('/team-logo/569.png',auth=('test','test-password'))
    assert response.status_code==200
    assert response.content==image
    assert response.headers['content-type']=='image/png'
    assert response.headers['cache-control']=='private, max-age=86400'
    assert response.headers['x-content-type-options']=='nosniff'
    assert calls==['https://media.api-sports.io/football/teams/569.png']
    fagiano_logo='https://thumb.wikimedia.org/wikipedia/en/thumb/0/07/Fagiano_Okayama_logo.svg/960px-Fagiano_Okayama_logo.svg.png?utm_source=en.wikipedia.org&utm_campaign=imageinfo&utm_content=thumbnail'
    response=client.get('/team-logo/310.png',auth=('test','test-password'))
    assert response.status_code==200 and response.content==image
    assert calls==['https://media.api-sports.io/football/teams/569.png',fagiano_logo]
    assert client.get('/team-logo/999999.png',auth=('test','test-password')).status_code==404
    assert calls==['https://media.api-sports.io/football/teams/569.png',fagiano_logo]


def test_custom_registered_logo_from_another_https_host_is_served(client,monkeypatch):
    response=client.get('/teams-map.js',auth=('test','test-password'))
    assert response.status_code==200
    assert '"549"' in response.text and '贝西克塔斯' in response.text
    assert "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/da/BesiktasJK-Logo.svg/960px-BesiktasJK-Logo.svg.png" in response.text
    calls=[]
    image=b'\x89PNG\r\n\x1a\nvalid-png'
    monkeypatch.setattr(m,'fetch_team_logo',lambda url:(calls.append(url) or image))
    custom_logo='https://logos.example.org/football/custom-club.png?width=256'
    monkeypatch.setattr(m,'team_directory_by_id',lambda:{'777':{'name_en':'Custom Club','logo':custom_logo}})
    response=client.get('/team-logo/777.png',auth=('test','test-password'))
    assert response.status_code==200
    assert response.content==image
    assert calls==[custom_logo]
    for unsafe_logo in ('http://logos.example.org/badge.png','https://user:pass@logos.example.org/badge.png','https://logos.example.org:8443/badge.png','https://127.0.0.1/badge.png'):
        monkeypatch.setattr(m,'team_directory_by_id',lambda url=unsafe_logo:{'777':{'logo':url}})
        assert client.get('/team-logo/777.png',auth=('test','test-password')).status_code==404
    assert calls==[custom_logo]

def test_team_logo_dns_resolution_pins_only_public_addresses(monkeypatch):
    import socket
    monkeypatch.setattr(m.socket,'getaddrinfo',lambda host,port,type:[(socket.AF_INET,socket.SOCK_STREAM,6,'',( '93.184.216.34',port))])
    assert m._resolve_public_team_logo_target('https://logos.example.org/badge.png?size=2')==('logos.example.org','93.184.216.34','/badge.png?size=2')
    monkeypatch.setattr(m.socket,'getaddrinfo',lambda host,port,type:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',port)),(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',port))])
    with pytest.raises(ValueError):
        m._resolve_public_team_logo_target('https://logos.example.org/badge.png')

def test_brand_logo_is_authenticated_and_serves_webp(client):
    response=client.get('/brand-logo.webp',auth=('test','test-password'))
    assert response.status_code==200
    assert response.headers['content-type']=='image/webp'
    assert response.headers['cache-control']=='private, max-age=86400'
    assert response.headers['x-content-type-options']=='nosniff'
    assert response.content[:4]==b'RIFF' and response.content[8:12]==b'WEBP'

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
