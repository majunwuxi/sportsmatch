import os, json, time, sqlite3, threading, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse
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
          last_score TEXT, last_check TEXT, next_check TEXT NOT NULL,
          ticket_json TEXT NOT NULL DEFAULT '[]',
          error TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (
          utc_day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0
        );
        """)

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

def outcome(home,away,tickets):
    total=sum((Decimal(str(t["stake"])) for t in tickets), Decimal(0))
    selection=None
    if home is not None and away is not None:
        score=f"{home}:{away}"
        selection=score if score in SCORES else ("胜其他" if home>away else "负其他" if home<away else "平其他")
    payout=sum((Decimal(str(t["stake"]))*Decimal(str(t["odds"])) for t in tickets if t["selection"]==selection),Decimal(0))
    money=lambda n:float(n.quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))
    return {"selection":selection,"payout":money(payout),"net":money(payout-total),"total":money(total)}

def tick(task):
    fid=task["fixture_id"]
    r=api("fixtures",{"id":fid})
    if len(r)!=1:raise RuntimeError("Fixture unavailable")
    f=r[0]
    if int(f["fixture"]["id"])!=fid:raise RuntimeError("Unexpected fixture")
    home=f["teams"]["home"]["name"]
    away=f["teams"]["away"]["name"]
    if home!=task["home"] or away!=task["away"]:raise RuntimeError("Team mismatch")
    h=f["goals"]["home"]; a=f["goals"]["away"]
    if f["fixture"]["status"]["short"] in {"ET","BT","AET","PEN"}:
        h=f["score"]["fulltime"]["home"]; a=f["score"]["fulltime"]["away"]
    score=f"{h}:{a}"
    status=f["fixture"]["status"]["short"]
    closed=status in TERMINAL
    now=datetime.now(timezone.utc)
    next_at=(now+timedelta(minutes=task["interval_minutes"])).isoformat()
    ticket=json.loads(task["ticket_json"])
    result=outcome(h,a,ticket)
    if status in VOID: result={"selection":None,"payout":0,"net":0,"total":result["total"],"review_required":True}
    message=(f"{'🏁 终场' if closed else '⚽ 赛况更新'}\n{home} {score} {away}\n状态：{status}\n"
       +f"当前票项：{result['selection'] or '未覆盖'}，若此时结算净额：¥{result.get('net',0)}")
    if status in VOID: message="比赛中断/取消或异常终止："+home+" vs "+away+"，状态 "+status+"。请根据官方公告人工确认退款或结算，平台不自动兑奖。"
    if not closed:message+="\n仅为当前比分，并非最终中奖结果"
    should_send=(task["last_score"] is None or task["last_score"]!=score or closed)
    if should_send: notify(message)
    with conn() as c:
        c.execute("UPDATE tasks SET last_score=?,last_check=?,next_check=?,status=?,error=NULL WHERE id=? AND enabled=1 AND status IN ('pending','running')",
             (score,now.isoformat(),next_at,"review_required" if status in VOID else "finished" if closed else "running",task["id"]))

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
    stake:float=Field(gt=0,allow_inf_nan=False)
    odds:float=Field(ge=1,allow_inf_nan=False)

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
        if t.selection not in SCORES: raise HTTPException(422,f"Unsupported correct score: {t.selection}")
        if t.stake%2: raise HTTPException(422,"Stake must be multiple of ¥2")
    return [t.model_dump() for t in items]

@app.get("/api/health")
def health(_:str=Depends(auth)):
    return {"ok":True,"poller":POLL_ENABLED,"timezone":"Asia/Shanghai"}

@app.get("/api/fixtures")
def fixtures(date:str=Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),q:str="",_:str=Depends(auth)):
    matches=api("fixtures",{"date":date,"timezone":"Asia/Shanghai"})
    term=q.strip().casefold()
    return [{"id":x["fixture"]["id"],"home":x["teams"]["home"]["name"],"away":x["teams"]["away"]["name"],
             "kickoff":x["fixture"]["date"],"status":x["fixture"]["status"]["short"]}
             for x in matches if not term or term in x["teams"]["home"]["name"].casefold() or term in x["teams"]["away"]["name"].casefold()]

@app.get("/api/tasks")
def tasks(_:str=Depends(auth)):
    with conn() as c:
        rows=[dict(x) for x in c.execute("SELECT * FROM tasks ORDER BY created_at DESC")]
    for x in rows:
        x["tickets"]=json.loads(x.pop("ticket_json"))
        parts=(x["last_score"] or "").split(":")
        x["settlement"]=outcome(*(map(int,parts) if len(parts)==2 and all(p.isdigit() for p in parts) else [None,None]),x["tickets"])
        x["settlement"]["final"]=x["status"]=="finished"

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
