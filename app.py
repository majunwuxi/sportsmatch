import os, json, time, sqlite3, threading, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
import secrets
import base64
from decimal import Decimal, ROUND_HALF_UP
from fastapi import Request
from fastapi.responses import JSONResponse

TZ=ZoneInfo("Asia/Shanghai")
DB=Path(os.getenv("DATABASE_PATH","./data/matches.sqlite3"))
DB.parent.mkdir(parents=True, exist_ok=True)
BASIC=HTTPBasic()
STOP=threading.Event()
LOCK=threading.Lock()
POLL_ENABLED=os.getenv("ENABLE_POLLER","false").lower()=="true"
LISTED_WINS={"1:0","2:0","2:1","3:0","3:1","3:2","4:0","4:1","4:2","5:0","5:1","5:2"}
TERMINAL={"FT","AET","PEN","CANC","ABD","AWD","WO"}
VOID={"CANC","ABD","AWD","WO"}
LISTED_DRAWS={"0:0","1:1","2:2","3:3"}
LISTED_LOSSES={":".join(reversed(x.split(":"))) for x in LISTED_WINS}
SCORES=LISTED_WINS | LISTED_DRAWS | LISTED_LOSSES | {"胜其他","平其他","负其他"}
MARKETS={"correct_score":"比分","match_result":"胜平负","handicap":"让球胜平负","total_goals":"总进球","half_full":"半全场"}
RESULTS={"胜","平","负"}
HALF_FULL={a+b for a in RESULTS for b in RESULTS}
TOTAL_GOALS={"0","1","2","3","4","5","6","7+"}
STATUS_CN={"TBD":"待定","NS":"未开赛","1H":"上半场","HT":"中场休息","2H":"下半场","ET":"加时赛","BT":"加时赛休息","P":"点球大战","SUSP":"暂停","INT":"中断","FT":"完场","AET":"加时赛结束","PEN":"点球结束","PST":"延期","CANC":"已取消","ABD":"比赛中止","AWD":"判定赛果","WO":"弃权"}
TASK_STATUS_CN={"pending":"等待开始","running":"监测中","paused":"已暂停","stopped":"已停止","finished":"已完赛","review_required":"待人工确认"}

def conn():
    c=sqlite3.connect(DB, timeout=15)
    c.row_factory=sqlite3.Row
    return c

def init_db():
    with conn() as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fixture_id INTEGER NOT NULL UNIQUE,
          home TEXT NOT NULL, away TEXT NOT NULL,
          kickoff TEXT, start_at TEXT NOT NULL,
          interval_minutes INTEGER NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          last_score TEXT, last_check TEXT, finished_at TEXT, next_check TEXT NOT NULL,
          ticket_json TEXT NOT NULL DEFAULT '[]',
          error TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (
          utc_day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0
        );
        """)
        columns={r[1] for r in c.execute("PRAGMA table_info(tasks)")}
        if "settlement_score" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN settlement_score TEXT")
            c.execute("UPDATE tasks SET settlement_score=last_score WHERE settlement_score IS NULL")
        if "half_score" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN half_score TEXT")
        if "provider_status" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN provider_status TEXT")
        if "finished_at" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN finished_at TEXT")
        c.execute("UPDATE tasks SET finished_at=COALESCE(NULLIF(last_check,''),created_at) WHERE status='finished' AND finished_at IS NULL")

def auth(credentials:HTTPBasicCredentials=Depends(BASIC)):
    username=os.getenv("ADMIN_USER","")
    password=os.getenv("ADMIN_PASSWORD","")
    if not username or not password or not (
       secrets.compare_digest(credentials.username.encode(),username.encode()) and
       secrets.compare_digest(credentials.password.encode(),password.encode())):
        raise HTTPException(status_code=401,detail="Unauthorized",headers={"WWW-Authenticate":"Basic"})
    return credentials.username

def request_json(url,headers=None,post=None):
    data=urllib.parse.urlencode(post).encode() if post else None
    req=urllib.request.Request(url,headers=headers or {},data=data)
    with urllib.request.urlopen(req, timeout=18) as r:
        return json.load(r)

def api(endpoint,params):
    key=os.getenv("APISPORTS_KEY")
    if not key: raise RuntimeError("APISPORTS_KEY missing")
    day=datetime.now(timezone.utc).strftime("%Y-%m-%d")
    limit=max(1,int(os.getenv("API_DAILY_LIMIT","90")))
    with LOCK:
        with conn() as c:
            c.execute("BEGIN IMMEDIATE")
            row=c.execute("SELECT requests FROM usage WHERE utc_day=?",(day,)).fetchone()
            used=row["requests"] if row else 0
            if used>=limit: raise RuntimeError("Daily API budget exhausted")
            c.execute("INSERT INTO usage(utc_day,requests) VALUES (?,1) ON CONFLICT(utc_day) DO UPDATE SET requests=requests+1",(day,))
    q=urllib.parse.urlencode(params)
    result=request_json("https://v3.football.api-sports.io/"+endpoint+"?"+q, {"x-apisports-key":key})
    if result.get("errors"):raise RuntimeError(str(result["errors"]))
    return result.get("response",[])

def notify(message):
    token=os.getenv("TELEGRAM_BOT_TOKEN")
    chat=os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat: return
    out=request_json("https://api.telegram.org/bot"+token+"/sendMessage",post={"chat_id":chat,"text":message})
    if not out.get("ok"): raise RuntimeError("Telegram sendMessage failed")

def score_result(home,away):
    return "胜" if home>away else "负" if home<away else "平"

def score_category(home,away):
    score=f"{home}:{away}"
    return score if score in SCORES else ("胜其他" if home>away else "负其他" if home<away else "平其他")

def ticket_matches(ticket,home,away,half_home=None,half_away=None):
    if home is None or away is None: return None
    market=ticket.get("market","correct_score")
    selection=ticket["selection"]
    if market=="correct_score": return selection==score_category(home,away)
    if market=="match_result": return selection==score_result(home,away)
    if market=="handicap": return selection==score_result(home+int(ticket["handicap"]),away)
    if market=="total_goals": return selection==("7+" if home+away>=7 else str(home+away))
    if market=="half_full":
        if half_home is None or half_away is None: return None
        return selection==score_result(half_home,half_away)+score_result(home,away)
    return False

def outcome(home,away,tickets,half_home=None,half_away=None):
    total=sum((Decimal(str(t["stake"])) for t in tickets), Decimal(0))
    payout=Decimal(0)
    rows=[]
    for index,t in enumerate(tickets):
        stake=Decimal(str(t["stake"]))
        won=ticket_matches(t,home,away,half_home,half_away)
        amount=stake*Decimal(str(t["odds"])) if won else Decimal(0)
        payout+=amount
        rows.append({"index":index,"market":t.get("market","correct_score"),"market_label":MARKETS.get(t.get("market","correct_score"),"未知玩法"),
            "selection":t["selection"],"handicap":t.get("handicap"),"stake":float(stake),"share_pct":float((stake*100/total).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)) if total else 0,
            "odds":float(t["odds"]),"won":won,"payout":float(amount.quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))})
    money=lambda n:float(n.quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))
    selection=score_category(home,away) if home is not None and away is not None else None
    has_score=home is not None and away is not None
    return {"selection":selection,"payout":money(payout),"net":money(payout-total) if has_score else None,"total":money(total),"tickets":rows,"has_score":has_score,
        "halftime_score":f"{half_home}:{half_away}" if half_home is not None and half_away is not None else None,
        "pending_tickets":sum(1 for row in rows if row["won"] is None)}

def tick(task):
    fid=task["fixture_id"]
    r=api("fixtures",{"id":fid})
    if len(r)!=1:raise RuntimeError("Fixture unavailable")
    f=r[0]
    if int(f["fixture"]["id"])!=fid:raise RuntimeError("Unexpected fixture")
    home=f["teams"]["home"]["name"]
    away=f["teams"]["away"]["name"]
    if home!=task["home"] or away!=task["away"]:raise RuntimeError("Team mismatch")
    status=f["fixture"]["status"]["short"]
    goals=f.get("goals") or {}
    h=goals.get("home"); a=goals.get("away")
    score=f"{h}:{a}" if h is not None and a is not None else None
    ft=(f.get("score") or {}).get("fulltime") or {}
    if status in {"ET","BT","P","AET","PEN"}:
        if ft.get("home") is None or ft.get("away") is None:
            raise RuntimeError("Regular-time score unavailable from provider")
        settle_h,settle_a=ft["home"],ft["away"]
    else:
        settle_h,settle_a=h,a
    regulation_score=f"{settle_h}:{settle_a}" if settle_h is not None and settle_a is not None else None
    half=(f.get("score") or {}).get("halftime") or {}
    half_h,half_a=half.get("home"),half.get("away")
    closed=status in TERMINAL
    now=datetime.now(timezone.utc)
    next_at=(now+timedelta(minutes=task["interval_minutes"])).isoformat()
    ticket=json.loads(task["ticket_json"])
    result=outcome(settle_h,settle_a,ticket,half_h,half_a)
    if status in VOID: result={"selection":None,"payout":0,"net":0,"total":result["total"],"review_required":True}
    calc=(f"按常规90分钟比分 {regulation_score} 试算：返奖 ¥{result.get('payout',0):.2f}，净利润 ¥{result.get('net',0):.2f}" if result.get("has_score") else "比分尚未产生，暂不结算")
    message=f"{'🏁 比赛结束' if closed else '⚽ 赛况更新'}\n{home} {score or '—'} {away}\n状态：{STATUS_CN.get(status,status)}\n{calc}"
    winners=[r for r in result.get("tickets",[]) if r["won"] is True]
    if winners: message+="\n命中投注："+"；".join(f"{r['market_label']} {r['selection']} ¥{r['stake']:g} → 返奖 ¥{r['payout']:.2f}" for r in winners)
    elif result.get("pending_tickets"): message+="\n半全场投注等待半场比分数据"
    else: message+="\n当前选择未命中"
    if status in VOID: message="比赛中断/取消或异常终止："+home+" vs "+away+"，状态 "+STATUS_CN.get(status,status)+"。请根据官方公告人工确认退款或结算，平台不自动兑奖。"
    elif not closed: message+="\n仅为当前比分试算，不代表最终中奖结果"
    changed=task.get("last_score")!=score or task.get("provider_status")!=status
    should_send=(changed and (score is not None or task.get("provider_status")!=status)) or closed
    if should_send: notify(message)
    task_status="review_required" if status in VOID else "finished" if closed else "running"
    with conn() as c:
        c.execute("UPDATE tasks SET last_score=?,settlement_score=?,half_score=?,provider_status=?,last_check=?,next_check=?,status=?,finished_at=CASE WHEN ?='finished' THEN COALESCE(finished_at,?) ELSE finished_at END,error=NULL WHERE id=? AND enabled=1 AND status IN ('pending','running')",
             (score,regulation_score,f"{half_h}:{half_a}" if half_h is not None and half_a is not None else None,status,now.isoformat(),next_at,task_status,task_status,now.isoformat(),task["id"]))

def poll_loop():
    while not STOP.wait(5):
        now=datetime.now(timezone.utc).isoformat()
        try:
            with conn() as c:
                due=c.execute("SELECT * FROM tasks WHERE enabled=1 AND status NOT IN ('finished','stopped','review_required') AND next_check<=? ORDER BY next_check LIMIT 10",(now,)).fetchall()
            for row in due:
                task=dict(row)
                try:tick(task)
                except Exception as e:
                    next_at=(datetime.now(timezone.utc)+timedelta(minutes=max(5,task["interval_minutes"]))).isoformat()
                    with conn() as c:c.execute("UPDATE tasks SET error=?,next_check=? WHERE id=?",(type(e).__name__+": provider/notification request failed; see protected server logs",next_at,task["id"]))
        except Exception as e:
            print("poll_loop:",repr(e),flush=True)

@asynccontextmanager
async def lifespan(app):
    init_db()
    STOP.clear()
    poll_lock=None
    if POLL_ENABLED:
        import fcntl
        poll_lock=open(str(DB)+".poller.lock","a")
        try: fcntl.flock(poll_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError("Only one poller may use this database")
    if POLL_ENABLED:
        thread=threading.Thread(target=poll_loop,daemon=True)
        thread.start()
    yield
    STOP.set()
    if POLL_ENABLED: thread.join(timeout=45)
    if poll_lock: poll_lock.close()

app=FastAPI(title="Match Monitor",lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

@app.middleware("http")
async def guard(request:Request, call_next):
    origin=request.headers.get("origin")
    expected=os.getenv("PUBLIC_ORIGIN","")
    if request.method not in {"GET","HEAD","OPTIONS"} and origin and origin!=expected:
        return JSONResponse({"detail":"Cross-origin write denied"},status_code=403)
    response=await call_next(request)
    response.headers["Cache-Control"]="no-store"
    response.headers["X-Content-Type-Options"]="nosniff"
    return response


class Ticket(BaseModel):
    selection:str
    market:str="correct_score"
    stake:float=Field(gt=0,allow_inf_nan=False)
    odds:float=Field(ge=1,allow_inf_nan=False)
    handicap:int|None=None

class TaskIn(BaseModel):
    fixture_id:int=Field(gt=0)
    home:str
    away:str
    kickoff:str|None=None
    start_at:str
    interval_minutes:int=Field(default=10,ge=1,le=120)
    tickets:list[Ticket]=Field(default_factory=list,max_length=1000)

def validate_tickets(items):
    if len(items)>1000: raise HTTPException(422,"Too many tickets")
    for t in items:
        if t.market not in MARKETS: raise HTTPException(422,f"Unsupported market: {t.market}")
        valid={"correct_score":t.selection in SCORES,"match_result":t.selection in RESULTS,"handicap":t.selection in RESULTS and t.handicap is not None and -9<=t.handicap<=9,
            "total_goals":t.selection in TOTAL_GOALS,"half_full":t.selection in HALF_FULL}[t.market]
        if not valid: raise HTTPException(422,f"Invalid selection for {MARKETS[t.market]}: {t.selection}")
        if Decimal(str(t.stake))%Decimal("2"): raise HTTPException(422,"Stake must be a positive multiple of ¥2")
    return [t.model_dump() for t in items]

@app.get("/api/health")
def health(_:str=Depends(auth)):
    return {"ok":True,"poller":POLL_ENABLED,"timezone":"Asia/Shanghai"}

@app.get("/api/fixtures")
def fixtures(date:str=Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),q:str="",_:str=Depends(auth)):
    matches=api("fixtures",{"date":date,"timezone":"Asia/Shanghai"})
    term=q.strip().casefold()
    return [{"id":x["fixture"]["id"],"home":x["teams"]["home"]["name"],"away":x["teams"]["away"]["name"],
             "kickoff":x["fixture"]["date"],"status":x["fixture"]["status"]["short"],"status_cn":STATUS_CN.get(x["fixture"]["status"]["short"],x["fixture"]["status"]["short"])}
             for x in matches if not term or term in x["teams"]["home"]["name"].casefold() or term in x["teams"]["away"]["name"].casefold()]

def _utc_datetime(value):
    try:
        parsed=datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed=parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError,ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)

@app.get("/api/tasks")
def tasks(_:str=Depends(auth)):
    now=datetime.now(timezone.utc)
    with conn() as c:
        rows=[dict(x) for x in c.execute("SELECT * FROM tasks ORDER BY created_at DESC")]
    upcoming=[]
    visible=[]
    for x in rows:
        if x["status"]=="finished":
            ended=x.get("finished_at") or x.get("last_check") or x.get("created_at")
            if _utc_datetime(ended)+timedelta(hours=24)<=now:
                continue
        start=_utc_datetime(x.get("start_at"))
        if x["status"] in {"pending","paused"} and start>now:
            upcoming.append(x)
        else:
            visible.append(x)
    upcoming.sort(key=lambda x:(_utc_datetime(x.get("start_at")),x["id"]))
    rows=upcoming+visible
    for x in rows:
        x["tickets"]=json.loads(x.pop("ticket_json"))
        parts=(x.get("settlement_score") or x["last_score"] or "").split(":")
        half=(x.get("half_score") or "").split(":")
        x["settlement"]=outcome(*(map(int,parts) if len(parts)==2 and all(p.isdigit() for p in parts) else [None,None]),x["tickets"],
            *(map(int,half) if len(half)==2 and all(p.isdigit() for p in half) else [None,None]))
        x["settlement"]["final"]=x["status"]=="finished"
        x["status_cn"]=TASK_STATUS_CN.get(x["status"],x["status"])

    return rows

@app.post("/api/tasks")
def create_task(data:TaskIn,_:str=Depends(auth)):
    tickets=validate_tickets(data.tickets)
    try:
        start=datetime.fromisoformat(data.start_at)
        if start.tzinfo is None:raise ValueError()
    except ValueError:raise HTTPException(422,"start_at must include timezone offset")
    # Confirm match identity from the provider; never trust just the browser's team names.
    rows=api("fixtures",{"id":data.fixture_id})
    if len(rows)!=1:raise HTTPException(422,"Fixture not accessible")
    fixture=rows[0]
    home=fixture["teams"]["home"]["name"];away=fixture["teams"]["away"]["name"]
    now=datetime.now(timezone.utc).isoformat()
    next_at=max(start.astimezone(timezone.utc).isoformat(),now)
    with conn() as c:
        try:
            cur=c.execute("""INSERT INTO tasks(fixture_id,home,away,kickoff,start_at,interval_minutes,next_check,ticket_json,created_at)
             VALUES (?,?,?,?,?,?,?,?,?)""",(data.fixture_id,home,away,fixture["fixture"]["date"],start.isoformat(),data.interval_minutes,next_at,json.dumps(tickets,ensure_ascii=False),now))
        except sqlite3.IntegrityError:raise HTTPException(409,"Fixture already monitored")
    return {"id":cur.lastrowid,"home":home,"away":away}

@app.put("/api/tasks/{task_id}/tickets")
def update_tickets(task_id:int,tickets:list[Ticket],_:str=Depends(auth)):
    values=validate_tickets(tickets)
    with conn() as c:
        r=c.execute("UPDATE tasks SET ticket_json=? WHERE id=?",(json.dumps(values,ensure_ascii=False),task_id))
        if not r.rowcount:raise HTTPException(404,"Task not found")
    return {"ok":True,"tickets":len(values)}

@app.post("/api/tasks/{task_id}/{action}")
def task_action(task_id:int,action:str,_:str=Depends(auth)):
    if action not in {"pause","resume","stop"}:raise HTTPException(400,"Invalid action")
    with conn() as c:
        row=c.execute("SELECT status,start_at FROM tasks WHERE id=?",(task_id,)).fetchone()
        if not row:raise HTTPException(404,"Task not found")
        if row["status"] in {"finished","review_required"}:raise HTTPException(409,"Finished match cannot be resumed")
        next_at=max(datetime.now(timezone.utc),datetime.fromisoformat(row["start_at"]).astimezone(timezone.utc)).isoformat()
        vals={"pause":("paused",0),"resume":("pending",1),"stop":("stopped",0)}
        status,enabled=vals[action]
        c.execute("UPDATE tasks SET status=?,enabled=?,next_check=? WHERE id=?",(status,enabled,next_at,task_id))
    return {"ok":True,"status":status}

@app.get("/api/usage")
def usage(_:str=Depends(auth)):
    today=datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with conn() as c:
        row=c.execute("SELECT requests FROM usage WHERE utc_day=?",(today,)).fetchone()
    return {"day_utc":today,"used":row["requests"] if row else 0,"budget":int(os.getenv("API_DAILY_LIMIT","90"))}

@app.get("/",response_class=HTMLResponse)
def index(_:str=Depends(auth)):
    return Path(__file__).with_name("index.html").read_text(encoding="utf-8")

@app.get("/ocr-parser.js")
def ocr_parser(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("ocr-parser.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})

@app.get("/ocr-ui.js")
def ocr_ui(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("ocr-ui.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})
