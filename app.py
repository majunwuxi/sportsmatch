import os, json, time, sqlite3, threading, urllib.request, urllib.parse, urllib.error, http.client, ipaddress, socket, ssl, re, math
from itertools import combinations, product
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse, FileResponse, Response
from pydantic import BaseModel, Field
import secrets
import base64
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from fastapi import Request
from fastapi.responses import JSONResponse

TZ=ZoneInfo("Asia/Shanghai")
DB=Path(os.getenv("DATABASE_PATH","./data/matches.sqlite3"))
DB.parent.mkdir(parents=True, exist_ok=True)
BASIC=HTTPBasic()
STOP=threading.Event()
LOCK=threading.Lock()
BALLDONTLIE_LOCK=threading.Lock()
BALLDONTLIE_LAST_REQUEST=0.0
TASK_LOCK=threading.RLock()
POLL_ENABLED=os.getenv("ENABLE_POLLER","false").lower()=="true"
LISTED_WINS={"1:0","2:0","2:1","3:0","3:1","3:2","4:0","4:1","4:2","5:0","5:1","5:2"}
TERMINAL={"FT","AET","PEN","CANC","ABD","AWD","WO"}
VOID={"CANC","ABD","AWD","WO"}
LISTED_DRAWS={"0:0","1:1","2:2","3:3"}
LISTED_LOSSES={":".join(reversed(x.split(":"))) for x in LISTED_WINS}
LISTED_SCORE_OPTIONS=LISTED_WINS | LISTED_DRAWS | LISTED_LOSSES
SCORES=LISTED_SCORE_OPTIONS | {"胜其他","平其他","负其他","胜其它","平其它","负其它"}
OTHER_SCORE_ALIASES={"胜其它":"胜其他","平其它":"平其他","负其它":"负其他"}
MARKETS={"correct_score":"比分","match_result":"胜平负","handicap":"让球胜平负","total_goals":"总进球","half_full":"半全场",
    "basketball_result":"竞彩篮球胜负","basketball_handicap":"竞彩篮球让分胜负",
    "basketball_total":"竞彩篮球大小分","basketball_margin":"竞彩篮球胜分差"}
BASKETBALL_MARKETS={"basketball_result","basketball_handicap","basketball_total","basketball_margin"}
BASKETBALL_RESULT_SELECTIONS={"主胜","客胜"}
BASKETBALL_RESULT_ALIASES={"胜":"主胜","主胜":"主胜","主队胜":"主胜","客负":"主胜","负":"客胜","客胜":"客胜","客队胜":"客胜","主负":"客胜"}
RESULTS={"胜","平","负"}
FOOTBALL_RESULT_SELECTIONS={"主胜","平","客胜"}
FOOTBALL_RESULT_ALIASES={"胜":"主胜","负":"客胜","主队胜":"主胜","客队胜":"客胜","平局":"平","主负":"客胜","客负":"主胜"}
HALF_FULL={a+b for a in RESULTS for b in RESULTS}
TOTAL_GOALS={"0","1","2","3","4","5","6","7+"}
STATUS_CN={"TBD":"待定","NS":"未开赛","1H":"上半场","HT":"中场休息","2H":"下半场","ET":"加时赛","BT":"加时赛休息","P":"点球大战","SUSP":"暂停","INT":"中断","FT":"完场","AET":"加时赛结束","PEN":"点球结束","PST":"延期","CANC":"已取消","ABD":"比赛中止","AWD":"判定赛果","WO":"弃权"}
BALLDONTLIE_GAME_ID_BASE={"nba":1_000_000_000_000,"wnba":2_000_000_000_000}

def _load_basketball_teams():
    source=Path(__file__).with_name("basketball-teams.js").read_text(encoding="utf-8").strip()
    prefix="globalThis.MatchMonitorBasketballTeamDirectory = "
    if not source.startswith(prefix):return []
    payload=source[len(prefix):].strip()
    if payload.endswith(";"):payload=payload[:-1]
    try:teams=json.loads(payload)
    except json.JSONDecodeError:return []
    return teams if isinstance(teams,list) else []

BASKETBALL_TEAMS=_load_basketball_teams()
BASKETBALL_TEAM_NAMES_ZH={team["name_en"]:team["name_zh"] for team in BASKETBALL_TEAMS
    if isinstance(team,dict) and team.get("name_en") and team.get("name_zh")}
TASK_STATUS_CN={"pending":"等待开始","running":"监测中","paused":"已暂停","stopped":"已停止","finished":"已完赛","review_required":"待人工确认"}
PARLAY_STATUS_CN={"pending":"监测中","won":"已中奖","lost":"未中奖","review_required":"待人工核验","stopped":"已停止"}
# Official JCZQ system-pass modes, mapped to the sizes of the elementary
# combinations contained in the ticket. Each mode is validated by its exact
# generated combination count before it is accepted.
PASS_COMBO_SIZES={
    2:{1:(2,),3:(1,2)},
    3:{1:(3,),3:(2,),4:(2,3),7:(1,2,3)},
    4:{1:(4,),4:(3,),5:(3,4),6:(2,),11:(2,3,4),15:(1,2,3,4)},
    5:{1:(5,),5:(4,),6:(4,5),10:(3,),16:(3,4,5),20:(2,3),26:(2,3,4,5),31:(1,2,3,4,5)},
    6:{1:(6,),6:(5,),7:(5,6),15:(4,),20:(3,),22:(4,5,6),35:(3,4),42:(3,4,5,6),50:(2,3,4),57:(2,3,4,5,6),63:(1,2,3,4,5,6)},
    7:{1:(7,),7:(6,),8:(6,7),21:(5,),35:(4,),56:(3,),120:(2,3,4,5,6,7),127:(1,2,3,4,5,6,7)},
    8:{1:(8,),8:(7,),9:(7,8),28:(6,),56:(5,),70:(4,),247:(2,3,4,5,6,7,8),255:(1,2,3,4,5,6,7,8)},
}

def conn():
    c=sqlite3.connect(DB, timeout=15)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c

def init_db():
    with conn() as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fixture_id INTEGER NOT NULL UNIQUE,
          home TEXT NOT NULL, away TEXT NOT NULL,
          league_name TEXT, kickoff TEXT, start_at TEXT NOT NULL,
          interval_minutes INTEGER NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          last_score TEXT, last_check TEXT, finished_at TEXT, next_check TEXT NOT NULL,
          ticket_json TEXT NOT NULL DEFAULT '[]',
          error TEXT, created_at TEXT NOT NULL,
          created_for_parlay INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS usage (
          utc_day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS parlay_tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pass_type TEXT NOT NULL,
          multiples INTEGER NOT NULL,
          unit_stake REAL NOT NULL DEFAULT 2,
          total_stake REAL NOT NULL,
          declared_payout REAL,
          status TEXT NOT NULL DEFAULT 'pending',
          last_notified_state TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS parlay_legs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parlay_id INTEGER NOT NULL REFERENCES parlay_tickets(id) ON DELETE CASCADE,
          leg_index INTEGER NOT NULL,
          fixture_id INTEGER NOT NULL,
          sport TEXT NOT NULL DEFAULT 'football',
          league_code TEXT,
          home TEXT NOT NULL,
          away TEXT NOT NULL,
          league_name TEXT,
          kickoff TEXT,
          market TEXT NOT NULL,
          selection TEXT NOT NULL,
          handicap INTEGER,
          line REAL,
          odds TEXT NOT NULL,
          selections_json TEXT NOT NULL DEFAULT '[]',
          void_confirmed INTEGER NOT NULL DEFAULT 0,
          UNIQUE(parlay_id,leg_index)
        );
        """)
        columns={r[1] for r in c.execute("PRAGMA table_info(tasks)")}
        if "league_name" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN league_name TEXT")
        if "listed_scores_json" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN listed_scores_json TEXT")
        if "listed_scores_verified" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN listed_scores_verified INTEGER NOT NULL DEFAULT 0")
        if "settlement_score" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN settlement_score TEXT")
            c.execute("UPDATE tasks SET settlement_score=last_score WHERE settlement_score IS NULL")
        if "half_score" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN half_score TEXT")
        if "provider_status" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN provider_status TEXT")
        if "finished_at" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN finished_at TEXT")
        if "created_for_parlay" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN created_for_parlay INTEGER NOT NULL DEFAULT 0")
        if "sport" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN sport TEXT NOT NULL DEFAULT 'football'")
        if "provider_game_id" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN provider_game_id TEXT")
        if "league_code" not in columns:
            c.execute("ALTER TABLE tasks ADD COLUMN league_code TEXT")
        c.execute("UPDATE tasks SET league_code='nba' WHERE sport='basketball' AND (league_code IS NULL OR league_code='')")
        c.execute("UPDATE tasks SET provider_game_id=CAST(fixture_id AS TEXT) WHERE sport='football' AND provider_game_id IS NULL")
        c.execute("UPDATE tasks SET finished_at=COALESCE(NULLIF(last_check,''),created_at) WHERE status='finished' AND finished_at IS NULL")
        parlay_columns={r[1] for r in c.execute("PRAGMA table_info(parlay_legs)")}
        if "sport" not in parlay_columns:c.execute("ALTER TABLE parlay_legs ADD COLUMN sport TEXT NOT NULL DEFAULT 'football'")
        if "league_code" not in parlay_columns:c.execute("ALTER TABLE parlay_legs ADD COLUMN league_code TEXT")
        if "line" not in parlay_columns:c.execute("ALTER TABLE parlay_legs ADD COLUMN line REAL")
        if "selections_json" not in parlay_columns:c.execute("ALTER TABLE parlay_legs ADD COLUMN selections_json TEXT NOT NULL DEFAULT '[]'")

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

def balldontlie_key():
    key=os.getenv("BALLDONTLIE_API_KEY","").strip()
    return "" if key.casefold() in {"replace_me","your_key","your_api_key"} else key

def balldontlie_api(endpoint,params=None,league_code="nba"):
    global BALLDONTLIE_LAST_REQUEST
    league_code=str(league_code or "nba").lower()
    if league_code not in BALLDONTLIE_GAME_ID_BASE:raise HTTPException(422,"Basketball league must be nba or wnba")
    key=balldontlie_key()
    if not key:raise HTTPException(503,"篮球监测尚未配置 BALLDONTLIE_API_KEY")
    try:min_interval=max(0.0,float(os.getenv("BALLDONTLIE_MIN_INTERVAL_SECONDS","12.5")))
    except (TypeError,ValueError):min_interval=12.5
    with BALLDONTLIE_LOCK:
        wait=min_interval-(time.monotonic()-BALLDONTLIE_LAST_REQUEST)
        if wait>0:time.sleep(wait)
        BALLDONTLIE_LAST_REQUEST=time.monotonic()
        url="https://api.balldontlie.io/"+league_code+"/v1/"+str(endpoint).lstrip("/")
        if params:url+="?"+urllib.parse.urlencode(params,doseq=True)
        try:
            result=request_json(url,{"Authorization":key})
        except urllib.error.HTTPError as error:
            if error.code==401:raise HTTPException(503,f"BallDontLie API Key 无效或当前账号无权访问 {league_code.upper()} 比赛数据") from error
            if error.code==429:raise HTTPException(503,"BallDontLie 请求达到服务方限额，请稍后重试") from error
            raise HTTPException(502,f"BallDontLie 暂时无法提供比赛数据（HTTP {error.code}）") from error
        except urllib.error.URLError as error:
            raise HTTPException(502,"暂时无法连接 BallDontLie，请稍后重试") from error
        if not isinstance(result,dict) or result.get("error") or result.get("errors"):
            raise HTTPException(502,"BallDontLie 返回了无法识别的比赛数据")
        return result

def _bdl_state(game):
    state=str(game.get("status_state") or "").strip().lower()
    if state in {"scheduled","in_progress","final","postponed","canceled","delayed","suspended","abandoned","unknown"}:
        return state
    raw=str(game.get("status") or "").strip().lower()
    if raw=="final":return "final"
    if raw in {"1st qtr","2nd qtr","halftime","3rd qtr","4th qtr"} or re.search(r"\b(?:q[1-4]|[1-4](?:st|nd|rd|th)?\s*(?:qtr|quarter)|overtime|ot\d*)\b",raw):return "in_progress"
    if raw in {"in progress","live"}:return "in_progress"
    if game.get("postponed"):return "postponed"
    if raw:return "scheduled"
    return "unknown"

def _bdl_status_cn(state,raw_status=""):
    if state=="scheduled":return "未开赛"
    if state=="in_progress":
        normalized=str(raw_status or "").strip().lower()
        labels={"1st qtr":"第1节","2nd qtr":"第2节","halftime":"中场休息","3rd qtr":"第3节","4th qtr":"第4节"}
        if normalized in labels:return labels[normalized]
        for pattern,label in ((r"\b(?:q1|1st\s*(?:qtr|quarter))\b","第1节"),(r"\b(?:q2|2nd\s*(?:qtr|quarter))\b","第2节"),
            (r"\b(?:q3|3rd\s*(?:qtr|quarter))\b","第3节"),(r"\b(?:q4|4th\s*(?:qtr|quarter))\b","第4节")):
            if re.search(pattern,normalized):return label
        if "half" in normalized:return "中场休息"
        if re.search(r"\b(?:ot\d*|overtime)\b",normalized):return "加时赛"
        return "比赛进行中"
    return {"final":"已完赛","postponed":"比赛延期","canceled":"比赛已取消","delayed":"比赛延迟",
        "suspended":"比赛暂停","abandoned":"比赛中止","unknown":"状态待确认"}.get(state,"状态待确认")

def _bdl_datetime(value):
    if not value:return None
    try:
        parsed=datetime.fromisoformat(str(value).replace("Z","+00:00"))
        if parsed.tzinfo is None:parsed=parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError,ValueError):return None

def basketball_fixtures(date_value,q="",league_code="nba"):
    league_code=str(league_code or "nba").lower()
    if league_code not in BALLDONTLIE_GAME_ID_BASE:raise HTTPException(422,"Basketball league must be nba or wnba")
    try:
        day=datetime.fromisoformat(date_value+"T00:00:00+08:00")
    except (TypeError,ValueError):raise HTTPException(422,"比赛日期无效")
    end=day+timedelta(days=1)
    api_start=day.astimezone(timezone.utc).date().isoformat()
    api_end=(end-timedelta(microseconds=1)).astimezone(timezone.utc).date().isoformat()
    result=balldontlie_api("games",{"start_date":api_start,"end_date":api_end,"per_page":100},league_code)
    games=result.get("data")
    if not isinstance(games,list):raise HTTPException(502,f"BallDontLie 返回的 {league_code.upper()} 赛程格式无效")
    term=str(q or "").strip().casefold()
    matches=[]
    for game in games:
        kickoff=_bdl_datetime(game.get("datetime") or game.get("date"))
        if kickoff is None:continue
        local_kickoff=kickoff.astimezone(TZ)
        if not day.date()<=local_kickoff.date()<end.date():continue
        home=(game.get("home_team") or {}).get("full_name") or ""
        away=(game.get("visitor_team") or {}).get("full_name") or ""
        def team_matches(name):
            return not term or term in name.casefold() or term in BASKETBALL_TEAM_NAMES_ZH.get(name,"").casefold()
        if not (team_matches(home) or team_matches(away)):continue
        state=_bdl_state(game)
        postseason=bool(game.get("postseason"))
        league_name=("WNBA季后赛" if postseason else "WNBA") if league_code=="wnba" else "NBA季后赛" if postseason else "NBA杯" if game.get("ist_stage") else "NBA"
        raw_status=str(game.get("status") or "")
        matches.append({"id":int(game["id"]),"provider_id":int(game["id"]),"sport":"basketball",
            "league_code":league_code,"home":home,"home_cn":BASKETBALL_TEAM_NAMES_ZH.get(home,""),"away":away,"away_cn":BASKETBALL_TEAM_NAMES_ZH.get(away,""),
            "league_name":league_name,"kickoff":kickoff.isoformat(),"status":state,"status_cn":_bdl_status_cn(state,raw_status)})
    return sorted(matches,key=lambda row:row["kickoff"])

def notify(message):
    token=os.getenv("TELEGRAM_BOT_TOKEN")
    chat=os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat: return
    out=request_json("https://api.telegram.org/bot"+token+"/sendMessage",post={"chat_id":chat,"text":message})
    if not out.get("ok"): raise RuntimeError("Telegram sendMessage failed")

def score_result(home,away):
    return "胜" if home>away else "负" if home<away else "平"

def normalize_football_result_selection(value):
    raw=str(value or "").strip().replace(" ","").replace("　","")
    return FOOTBALL_RESULT_ALIASES.get(raw,raw)

def football_result_value(value):
    return {"主胜":"胜","平":"平","客胜":"负"}.get(normalize_football_result_selection(value))

def score_category(home,away,listed_scores=None):
    score=f"{home}:{away}"
    exact_scores=LISTED_SCORE_OPTIONS if listed_scores is None else set(listed_scores)
    return score if score in exact_scores else ("胜其他" if home>away else "负其他" if home<away else "平其他")

def basketball_margin_result(home,away):
    margin=abs(int(home)-int(away))
    band="1-5" if margin<=5 else "6-10" if margin<=10 else "11-15" if margin<=15 else "16-20" if margin<=20 else "21-25" if margin<=25 else "26+"
    return ("主胜" if home>away else "客胜")+band+"分" if margin else None

def normalize_basketball_margin_selection(value):
    raw=str(value or "").strip().replace(" ","").replace("　","").replace("：",":")
    match=re.fullmatch(r"(主胜|客胜|主队胜|客队胜)(1-5|6-10|11-15|16-20|21-25|26\+|26分以上|26分及以上)分?",raw)
    if not match:return None
    side="主胜" if match.group(1) in {"主胜","主队胜"} else "客胜"
    band="26+" if match.group(2).startswith("26") else match.group(2)
    return side+band+"分"

def normalize_basketball_result_selection(value):
    raw=str(value or "").strip().replace(" ","").replace("　","")
    return BASKETBALL_RESULT_ALIASES.get(raw,raw)

def is_half_point_line(value):
    try:return abs(Decimal(str(value))*2)%Decimal(2)==Decimal(1)
    except Exception:return False

def ticket_matches(ticket,home,away,half_home=None,half_away=None,listed_scores=None):
    if home is None or away is None: return None
    market=ticket.get("market","correct_score")
    selection=ticket["selection"]
    if market=="correct_score": return OTHER_SCORE_ALIASES.get(selection,selection)==score_category(home,away,listed_scores)
    if market=="match_result": return football_result_value(selection)==score_result(home,away)
    if market=="handicap": return football_result_value(selection)==score_result(home+int(ticket["handicap"]),away)
    if market=="total_goals": return selection==("7+" if home+away>=7 else str(home+away))
    if market=="half_full":
        if half_home is None or half_away is None: return None
        return selection==score_result(half_home,half_away)+score_result(home,away)
    if market=="basketball_result":
        result="主胜" if home>away else "客胜" if home<away else None
        return normalize_basketball_result_selection(selection)==result if result else None
    if market=="basketball_handicap":
        adjusted=Decimal(str(home))+Decimal(str(ticket["handicap"]))
        opponent=Decimal(str(away))
        result="主胜" if adjusted>opponent else "客胜" if adjusted<opponent else None
        return normalize_basketball_result_selection(selection)==result if result else None
    if market=="basketball_total":
        total=Decimal(str(home+away));line=Decimal(str(ticket["line"]))
        result="大" if total>line else "小" if total<line else None
        return selection==result if result else None
    if market=="basketball_margin":
        result=basketball_margin_result(home,away)
        return normalize_basketball_margin_selection(selection)==result if result else None
    return False

def outcome(home,away,tickets,half_home=None,half_away=None,listed_scores=None):
    total=sum((Decimal(str(t["stake"])) for t in tickets), Decimal(0))
    payout=Decimal(0)
    rows=[]
    by_market={}
    for index,t in enumerate(tickets):
        stake=Decimal(str(t["stake"]))
        won=ticket_matches(t,home,away,half_home,half_away,listed_scores)
        amount=stake*Decimal(str(t["odds"])) if won else Decimal(0)
        payout+=amount
        market=t.get("market","correct_score")
        group=by_market.setdefault(market,{"market":market,"market_label":MARKETS.get(market,"未知玩法"),"total":Decimal(0),"payout":Decimal(0),"tickets":0,"pending_tickets":0})
        group["total"]+=stake
        group["tickets"]+=1
        if won is None:
            group["pending_tickets"]+=1
        else:
            group["payout"]+=amount
        rows.append({"index":index,"market":market,"market_label":MARKETS.get(market,"未知玩法"),
            "selection":t["selection"],"handicap":t.get("handicap"),"line":t.get("line"),"stake":float(stake),"share_pct":float((stake*100/total).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)) if total else 0,
            "odds":float(t["odds"]),"won":won,"payout":float(amount.quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))})
    money=lambda n:float(n.quantize(Decimal("0.01"),rounding=ROUND_HALF_UP))
    market_summaries=[{"market":g["market"],"market_label":g["market_label"],"total":money(g["total"]),"payout":money(g["payout"]),
        "net":money(g["payout"]-g["total"]) if g["pending_tickets"]==0 else None,"tickets":g["tickets"],"pending_tickets":g["pending_tickets"]}
        for g in by_market.values()]
    selection=score_category(home,away,listed_scores) if home is not None and away is not None else None
    has_score=home is not None and away is not None
    pending_tickets=sum(1 for row in rows if row["won"] is None)
    return {"selection":selection,"payout":money(payout),"net":money(payout-total) if has_score and pending_tickets==0 else None,"total":money(total),"tickets":rows,"market_summaries":market_summaries,"has_score":has_score,
        "score_list_source":"截图SP识别清单" if listed_scores is not None else "标准竞彩比分表",
        "listed_scores_count":len(listed_scores) if listed_scores is not None else len(LISTED_SCORE_OPTIONS),
        "halftime_score":f"{half_home}:{half_away}" if half_home is not None and half_away is not None else None,
        "pending_tickets":pending_tickets}

def tick(task):
    # Serialize polling against schedule edits and deletion. Reload after taking
    # the lock so a row copied by poll_loop before a delete cannot still run.
    with TASK_LOCK:
        with conn() as c:
            current=c.execute("SELECT * FROM tasks WHERE id=? AND enabled=1 AND status IN ('pending','running')",(task["id"],)).fetchone()
        if not current or _utc_datetime(current["next_check"])>datetime.now(timezone.utc):
            return
        return _tick(dict(current))

def _tick_basketball(task):
    league_code=str(task.get("league_code") or "nba").lower()
    if league_code not in BALLDONTLIE_GAME_ID_BASE:raise RuntimeError("Basketball league metadata is invalid")
    provider_id=int(task.get("provider_game_id") or (int(task["fixture_id"])-BALLDONTLIE_GAME_ID_BASE[league_code]))
    payload=balldontlie_api(f"games/{provider_id}",league_code=league_code)
    game=payload.get("data")
    if not isinstance(game,dict) or int(game.get("id",0))!=provider_id:raise RuntimeError(f"{league_code.upper()} game unavailable from BallDontLie")
    home=(game.get("home_team") or {}).get("full_name") or ""
    away=(game.get("visitor_team") or {}).get("full_name") or ""
    if home!=task["home"] or away!=task["away"]:raise RuntimeError(f"{league_code.upper()} team mismatch from BallDontLie")
    state=_bdl_state(game)
    raw_status=str(game.get("status") or "")
    provider_status=state+"|"+_bdl_status_cn(state,raw_status)
    home_score=game.get("home_team_score") if league_code=="nba" else game.get("home_score")
    away_score=game.get("visitor_team_score") if league_code=="nba" else game.get("away_score")
    score=None
    if state in {"in_progress","final"} and home_score is not None and away_score is not None:
        score=f"{int(home_score)}:{int(away_score)}"
    if state=="final" and score is None:raise RuntimeError(f"Final {league_code.upper()} game has no final score")
    closed=state=="final"
    tied_final=state=="final" and int(home_score)==int(away_score)
    requires_review=state in {"canceled","abandoned"} or tied_final
    now=datetime.now(timezone.utc)
    next_at=(now+timedelta(minutes=task["interval_minutes"])).isoformat()
    status_text=_bdl_status_cn(state,raw_status)
    clock=str(game.get("time") or "").strip()
    clock_text=f" · 剩余 {clock}" if state=="in_progress" and clock else ""
    league_label="WNBA" if league_code=="wnba" else "NBA"
    competition=("WNBA季后赛" if bool(game.get("postseason")) else "WNBA") if league_code=="wnba" else "NBA季后赛" if bool(game.get("postseason")) else "NBA杯" if game.get("ist_stage") else "NBA"
    tickets=json.loads(task.get("ticket_json") or "[]")
    result=outcome(int(home_score) if home_score is not None else None,int(away_score) if away_score is not None else None,tickets)
    if requires_review:result={"selection":None,"payout":0,"net":None,"total":result["total"],"tickets":[],"pending_tickets":len(tickets)}
    calc=("仅监测比分，未设置竞彩篮球投注" if not tickets else
        "终场比分为平局，暂不自动结算" if tied_final else
        f"按当前比分试算：返奖 ¥{result.get('payout',0):.2f}" if result.get("has_score") else "尚无比分，暂不结算")
    message=(f"{'🏁' if closed else '🏀'} {league_label} 比赛{'结束' if closed else '赛况更新'}\n{home} {score or '—'} {away}\n"
        f"状态：{status_text}{clock_text}\n赛事：{competition}\n{calc}")
    if tied_final:message+="\n终场比分为平局，竞彩篮球投注无法按此比分自动结算，请核对官方赛果；系统不会自动结算。"
    elif requires_review:message+="\n比赛已取消或中止，请核对官方状态；系统不会自动结算。"
    elif closed:message+="\n终场比分已记录，比分监测已结束。"
    elif not tickets:message+="\n该比赛比分会供关联的竞彩篮球过关票结算使用。"
    elif tickets:message+="\n命中投注："+("；".join(f"{r['market_label']} {r['selection']} ¥{r['stake']:g} → 返奖 ¥{r['payout']:.2f}" for r in result["tickets"] if r["won"] is True) or "当前暂无命中")
    changed=task.get("last_score")!=score or task.get("provider_status")!=provider_status
    if changed or closed:notify(message)
    task_status="review_required" if requires_review else "finished" if closed else "running"
    kickoff=_bdl_datetime(game.get("datetime") or game.get("date"))
    kickoff_value=kickoff.isoformat() if kickoff else None
    with conn() as c:
        c.execute("""UPDATE tasks SET kickoff=COALESCE(?,kickoff),last_score=?,settlement_score=?,provider_status=?,last_check=?,next_check=?,status=?,
            finished_at=CASE WHEN ?='finished' THEN COALESCE(finished_at,?) ELSE finished_at END,error=NULL
            WHERE id=? AND enabled=1 AND status IN ('pending','running')""",
            (kickoff_value,score,score,provider_status,now.isoformat(),next_at,task_status,task_status,now.isoformat(),task["id"]))
    sync_parlays_for_fixture(int(task["fixture_id"]))

def _tick(task):
    if task.get("sport","football")=="basketball":return _tick_basketball(task)
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
    listed_scores=json.loads(task["listed_scores_json"]) if task.get("listed_scores_json") and task.get("listed_scores_verified") else None
    result=outcome(settle_h,settle_a,ticket,half_h,half_a,listed_scores)
    if status in VOID: result={"selection":None,"payout":0,"net":0,"total":result["total"],"review_required":True}
    calc=("本场仅监测比分，未设置单场投注" if not ticket else
        f"按常规90分钟比分 {regulation_score} 试算：返奖 ¥{result.get('payout',0):.2f}，净利润 ¥{result.get('net',0):.2f}" if result.get("has_score") else "比分尚未产生，暂不结算")
    message=f"{'🏁 比赛结束' if closed else '⚽ 赛况更新'}\n{home} {score or '—'} {away}\n状态：{STATUS_CN.get(status,status)}\n{calc}"
    winners=[r for r in result.get("tickets",[]) if r["won"] is True]
    if not ticket: message+="\n该比赛比分会供关联的过关票结算使用"
    elif winners: message+="\n命中投注："+"；".join(f"{r['market_label']} {r['selection']} ¥{r['stake']:g} → 返奖 ¥{r['payout']:.2f}" for r in winners)
    elif result.get("pending_tickets"): message+="\n半全场投注等待半场比分数据"
    else: message+="\n当前选择未命中"
    if status in VOID: message="比赛中断/取消或异常终止："+home+" vs "+away+"，状态 "+STATUS_CN.get(status,status)+"。请根据官方公告人工确认退款或结算，平台不自动兑奖。"
    elif not closed: message+="\n仅为当前比分试算，不代表最终中奖结果"
    changed=task.get("last_score")!=score or task.get("provider_status")!=status
    should_send=(changed and (score is not None or task.get("provider_status")!=status)) or closed
    if should_send: notify(message)
    task_status="review_required" if status in VOID else "finished" if closed else "running"
    with conn() as c:
        league_name=(f.get("league") or {}).get("name")
        c.execute("UPDATE tasks SET league_name=COALESCE(league_name,?),last_score=?,settlement_score=?,half_score=?,provider_status=?,last_check=?,next_check=?,status=?,finished_at=CASE WHEN ?='finished' THEN COALESCE(finished_at,?) ELSE finished_at END,error=NULL WHERE id=? AND enabled=1 AND status IN ('pending','running')",
             (league_name,score,regulation_score,f"{half_h}:{half_a}" if half_h is not None and half_a is not None else None,status,now.isoformat(),next_at,task_status,task_status,now.isoformat(),task["id"]))
    sync_parlays_for_fixture(fid)

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
                    with TASK_LOCK:
                        with conn() as c:
                            current=c.execute("SELECT enabled,status,next_check,interval_minutes FROM tasks WHERE id=?",(task["id"],)).fetchone()
                            if current and current["enabled"] and current["status"] in {"pending","running"}:
                                retry_at=datetime.now(timezone.utc)+timedelta(minutes=max(5,current["interval_minutes"]))
                                next_at=max(_utc_datetime(current["next_check"]),retry_at).isoformat()
                                c.execute("UPDATE tasks SET error=?,next_check=? WHERE id=?",(type(e).__name__+": provider/notification request failed; see protected server logs",next_at,task["id"]))
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
    if "Cache-Control" not in response.headers:
        response.headers["Cache-Control"]="no-store"
    response.headers["X-Content-Type-Options"]="nosniff"
    return response


class Ticket(BaseModel):
    selection:str
    market:str="correct_score"
    stake:float=Field(gt=0,allow_inf_nan=False)
    odds:float=Field(ge=1,allow_inf_nan=False)
    handicap:float|None=Field(default=None,allow_inf_nan=False)
    line:float|None=Field(default=None,allow_inf_nan=False)

class TaskIn(BaseModel):
    fixture_id:int=Field(gt=0)
    sport:Literal["football","basketball"]="football"
    league_code:Literal["nba","wnba"]="nba"
    home:str
    away:str
    kickoff:str|None=None
    start_at:str
    interval_minutes:int=Field(default=10,ge=1,le=120)
    tickets:list[Ticket]=Field(default_factory=list,max_length=1000)
    listed_scores:list[str]|None=None
    listed_scores_verified:bool=False

class TicketUpdateIn(BaseModel):
    tickets:list[Ticket]=Field(max_length=1000)
    listed_scores:list[str]|None=None
    listed_scores_verified:bool|None=None

class ScheduleUpdateIn(BaseModel):
    start_at:str
    interval_minutes:int=Field(ge=1,le=120)

class ParlaySelectionIn(BaseModel):
    market:str
    selection:str
    odds:float=Field(ge=1,allow_inf_nan=False)
    handicap:float|None=Field(default=None,allow_inf_nan=False)
    line:float|None=Field(default=None,allow_inf_nan=False)

class ParlayLegIn(BaseModel):
    fixture_id:int=Field(gt=0)
    sport:Literal["football","basketball"]="football"
    league_code:Literal["nba","wnba"]="nba"
    market:str
    selection:str
    odds:float=Field(ge=1,allow_inf_nan=False)
    handicap:float|None=Field(default=None,allow_inf_nan=False)
    line:float|None=Field(default=None,allow_inf_nan=False)
    selections:list[ParlaySelectionIn]|None=Field(default=None,max_length=24)
    start_at:str|None=None
    interval_minutes:int=Field(default=10,ge=1,le=120)

class ParlayIn(BaseModel):
    pass_type:str
    multiples:int=Field(gt=0,le=10000)
    unit_stake:float=Field(default=2,gt=0,allow_inf_nan=False)
    declared_total:float|None=Field(default=None,gt=0,allow_inf_nan=False)
    declared_payout:float|None=Field(default=None,gt=0,allow_inf_nan=False)
    legs:list[ParlayLegIn]

class ParlayOddsLegUpdateIn(BaseModel):
    leg_id:int=Field(gt=0)
    odds:list[float]=Field(min_length=1,max_length=24)

class ParlayOddsUpdateIn(BaseModel):
    legs:list[ParlayOddsLegUpdateIn]=Field(min_length=2,max_length=8)

class ConfirmVoidIn(BaseModel):
    confirmed:bool

def validate_tickets(items,sport="football"):
    if len(items)>1000: raise HTTPException(422,"Too many tickets")
    soccer_markets=set(MARKETS)-BASKETBALL_MARKETS
    for t in items:
        allowed=BASKETBALL_MARKETS if sport=="basketball" else soccer_markets
        if t.market not in allowed: raise HTTPException(422,f"Unsupported {sport} market: {t.market}")
        selection=normalize_football_result_selection(t.selection) if sport=="football" and t.market in {"match_result","handicap"} else normalize_basketball_result_selection(t.selection) if sport=="basketball" and t.market in {"basketball_result","basketball_handicap"} else t.selection
        if sport=="basketball":
            if t.market=="basketball_result":valid=selection in BASKETBALL_RESULT_SELECTIONS and t.handicap is None and t.line is None
            elif t.market=="basketball_handicap":valid=selection in BASKETBALL_RESULT_SELECTIONS and t.handicap is not None and is_half_point_line(t.handicap) and t.line is None
            elif t.market=="basketball_total":valid=t.selection in {"大","小"} and t.line is not None and is_half_point_line(t.line) and t.handicap is None
            else:valid=normalize_basketball_margin_selection(t.selection) is not None and t.handicap is None and t.line is None
        else:
            valid={"correct_score":t.selection in SCORES,"match_result":selection in FOOTBALL_RESULT_SELECTIONS,
                "handicap":selection in FOOTBALL_RESULT_SELECTIONS and t.handicap is not None and t.handicap.is_integer() and -9<=t.handicap<=9 and t.line is None,
                "total_goals":t.selection in TOTAL_GOALS and t.handicap is None and t.line is None,
                "half_full":t.selection in HALF_FULL and t.handicap is None and t.line is None}[t.market]
        if not valid: raise HTTPException(422,f"Invalid selection for {MARKETS[t.market]}: {t.selection}")
        if Decimal(str(t.stake))%Decimal("2"): raise HTTPException(422,"Stake must be a positive multiple of ¥2")
    result=[]
    for t in items:
        row=t.model_dump(exclude_none=True)
        if sport=="basketball" and t.market=="basketball_margin":row["selection"]=normalize_basketball_margin_selection(t.selection)
        if sport=="basketball" and t.market in {"basketball_result","basketball_handicap"}:row["selection"]=normalize_basketball_result_selection(t.selection)
        if sport=="football" and t.market in {"match_result","handicap"}:row["selection"]=normalize_football_result_selection(t.selection)
        if sport=="football" and t.market=="handicap":row["handicap"]=int(t.handicap)
        result.append(row)
    return result

def validate_listed_scores(items):
    if items is None: return None
    if len(items)>len(LISTED_SCORE_OPTIONS): raise HTTPException(422,"Too many listed correct-score options")
    result=[]
    for item in items:
        score=str(item).strip().replace("：",":").replace(" ","")
        if score not in LISTED_SCORE_OPTIONS: raise HTTPException(422,f"Invalid listed correct-score option: {item}")
        if score not in result: result.append(score)
    return result

def validate_score_metadata(tickets,listed_scores,verified):
    has_other=any(t.get("market","correct_score")=="correct_score"
        and OTHER_SCORE_ALIASES.get(t["selection"],t["selection"]) in {"胜其他","平其他","负其他"}
        for t in tickets)
    if verified and listed_scores is None: raise HTTPException(422,"A verified screenshot score list is required")
    if has_other and listed_scores is not None and not verified:
        raise HTTPException(422,"Confirm the screenshot SP score list before using 胜其它/负其它")
    if has_other and listed_scores == []:
        raise HTTPException(422,"The screenshot SP score list is empty; add the recognized exact scores first")

def normalize_pass_type(value,leg_count):
    raw=str(value or "").strip().lower().replace("×","串").replace("x","串").replace("*","串").replace(" ","")
    match=re.fullmatch(r"(\d+)串(\d+)",raw)
    if not match: raise HTTPException(422,"过关方式格式应为2串1、3串4等")
    count,mode=map(int,match.groups())
    if count!=leg_count: raise HTTPException(422,"过关方式的场次数必须与比赛腿数量一致")
    sizes=PASS_COMBO_SIZES.get(count,{}).get(mode)
    if not sizes: raise HTTPException(422,"该场次数不支持此过关方式")
    combination_count=sum(math.comb(count,size) for size in sizes)
    if combination_count!=mode: raise HTTPException(500,"过关方式组合表配置不一致")
    return f"{count}串{mode}",tuple(sizes)

def pass_combinations(leg_count,pass_type):
    canonical,sizes=normalize_pass_type(pass_type,leg_count)
    return canonical,[indices for size in sizes for indices in combinations(range(leg_count),size)]

def _money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)

def _score_pair(value):
    parts=str(value or "").split(":")
    return tuple(map(int,parts)) if len(parts)==2 and all(part.isdigit() for part in parts) else (None,None)

def _parlay_leg_choices(leg):
    try:choices=json.loads(leg.get("selections_json") or "[]")
    except (TypeError,json.JSONDecodeError):choices=[]
    if not choices:
        choices=[{"market":leg["market"],"selection":leg["selection"],"handicap":leg.get("handicap"),
            "line":leg.get("line"),"odds":float(leg["odds"])}]
    return choices

def _parlay_pick_result(leg,pick,task):
    current_score=((task.get("settlement_score") if task.get("status")=="finished" else task.get("last_score")) if task else None)
    settle_value=(task.get("settlement_score") or (task.get("last_score") if task and task.get("status")=="finished" else None)) if task else None
    if leg.get("void_confirmed"):
        state="void"
    elif not task:
        state="pending"
    elif task.get("provider_status") in VOID or task.get("status")=="review_required":
        state="review_required"
    elif task.get("status")=="finished":
        home,away=_score_pair(settle_value)
        if home is None:
            state="review_required"
        elif pick["market"]=="correct_score" and OTHER_SCORE_ALIASES.get(pick["selection"],pick["selection"]) in {"胜其他","平其他","负其他"} and not task.get("listed_scores_verified"):
            state="review_required"
        else:
            listed=json.loads(task["listed_scores_json"]) if task.get("listed_scores_json") and task.get("listed_scores_verified") else None
            result=ticket_matches(pick,home,away,*_score_pair(task.get("half_score")),listed)
            state="review_required" if result is None else "won" if result else "lost"
    else:
        state="pending"
    live_home,live_away=_score_pair(current_score)
    live_result=None
    if task and live_home is not None and state in {"pending","won","lost"}:
        listed=json.loads(task["listed_scores_json"]) if task.get("listed_scores_json") and task.get("listed_scores_verified") else None
        live_result=ticket_matches(pick,live_home,live_away,*_score_pair(task.get("half_score")),listed)
    status_text={"pending":"等待赛果","won":"命中","lost":"未命中","void":"已确认无效","review_required":"待人工核验"}.get(state,state)
    if state=="pending" and task and task.get("status") in {"paused","stopped"}:status_text="监测已暂停"
    return {**pick,"market_label":MARKETS.get(pick["market"],"玩法"),"odds":float(pick["odds"]),"state":state,
        "status_cn":status_text,"current_result":live_result,"score":settle_value or current_score}

def evaluate_parlay(parlay,legs,tasks_by_fixture):
    pass_type,combo_indices=pass_combinations(len(legs),parlay["pass_type"])
    multiple=int(parlay["multiples"]);unit=Decimal(str(parlay["unit_stake"]))
    choices_by_leg=[_parlay_leg_choices(leg) for leg in legs]
    leg_results=[]
    for leg,choices in zip(legs,choices_by_leg):
        task=tasks_by_fixture.get(int(leg["fixture_id"]))
        pick_results=[_parlay_pick_result(leg,pick,task) for pick in choices]
        states=[pick["state"] for pick in pick_results]
        state="void" if states and all(value=="void" for value in states) else "won" if "won" in states else "review_required" if "review_required" in states else "pending" if "pending" in states else "lost"
        first=pick_results[0]
        status_text={"pending":"等待赛果","won":"至少一项命中","lost":"全部未命中","void":"已确认无效","review_required":"待人工核验"}.get(state,state)
        if state=="pending" and task and task.get("status") in {"paused","stopped"}:status_text="监测已暂停"
        leg_results.append({"id":int(leg["id"]),"leg_index":int(leg["leg_index"]),"fixture_id":int(leg["fixture_id"]),"home":leg["home"],"away":leg["away"],
            "sport":leg.get("sport") or "football","league_code":leg.get("league_code"),
            "league_name":leg.get("league_name") or (task.get("league_name") if task else None),"kickoff":leg.get("kickoff"),
            "home_cn":BASKETBALL_TEAM_NAMES_ZH.get(leg["home"],"") if leg.get("sport")=="basketball" else "",
            "away_cn":BASKETBALL_TEAM_NAMES_ZH.get(leg["away"],"") if leg.get("sport")=="basketball" else "",
            "monitor_start_at":task.get("start_at") if task else None,"market":first["market"],"market_label":first["market_label"],
            "selection":first["selection"],"handicap":first.get("handicap"),"line":first.get("line"),"odds":first["odds"],"score":first.get("score"),
            "match_status":task.get("provider_status") if task else None,"task_status":task.get("status") if task else None,
            "state":state,"status_cn":status_text,"current_result":first.get("current_result"),"void_confirmed":bool(leg.get("void_confirmed")),"selections":pick_results})

    combos=[];confirmed_payout=Decimal(0);max_possible=Decimal(0);max_payout=Decimal(0)
    has_pending=False;has_review=False;choice_payouts=[];pending_payouts=[]
    for event_indices in combo_indices:
        event_choices=[choices_by_leg[index] for index in event_indices]
        for selected_choices in product(*event_choices):
            selected_results=[_parlay_pick_result(legs[index],pick,tasks_by_fixture.get(int(legs[index]["fixture_id"])))
                for index,pick in zip(event_indices,selected_choices)]
            active=[(index,pick,result) for index,pick,result in zip(event_indices,selected_choices,selected_results)
                if not legs[index].get("void_confirmed")]
            stake=unit*multiple
            if not active:
                state="review_required";payout=None;has_review=True
            elif any(result["state"]=="lost" for _,_,result in active):
                state="lost";payout=Decimal(0)
            elif any(result["state"]=="review_required" for _,_,result in active):
                state="review_required";payout=None;has_review=True
            elif any(result["state"]=="pending" for _,_,result in active):
                state="pending";payout=None;has_pending=True
            else:
                state="won";single=_money(unit*math.prod(Decimal(str(pick["odds"])) for _,pick,_ in active));payout=single*multiple;confirmed_payout+=payout
            theoretical=_money(unit*math.prod(Decimal(str(pick["odds"])) for _,pick,_ in active))*multiple if active else None
            if theoretical is not None:
                choice_payouts.append(theoretical)
                if state=="pending":pending_payouts.append(theoretical)
            combo_legs=[]
            for index,pick,result in zip(event_indices,selected_choices,selected_results):
                combo_legs.append({**leg_results[index],**result,"market":pick["market"],"selection":pick["selection"],
                    "handicap":pick.get("handicap"),"line":pick.get("line"),"odds":float(pick["odds"]),"state":result["state"],
                    "status_cn":result["status_cn"],"current_result":result["current_result"]})
            combos.append({"number":len(combos)+1,"legs":combo_legs,"state":state,
                "status_cn":{"won":"中奖","lost":"未中奖","pending":"待结算","review_required":"待核验"}.get(state,state),
                "stake":float(stake),"payout":float(payout) if payout is not None else None,
                "max_payout":float(theoretical) if theoretical is not None else None})

    only_full_combo=len(combo_indices)==1 and len(combo_indices[0])==len(legs)
    if only_full_combo:
        max_payout=max(choice_payouts,default=Decimal(0));max_possible=max(pending_payouts,default=Decimal(0))
    else:
        max_payout=sum(choice_payouts,Decimal(0));max_possible=sum(pending_payouts,Decimal(0))
    needed_fixtures={int(item["fixture_id"]) for combo in combos if combo["state"] in {"pending","review_required"}
        for item in combo["legs"] if item["state"]=="pending"}
    for result in leg_results:
        result["monitor_needed"]=int(result["fixture_id"]) in needed_fixtures
        if result["state"]=="pending" and not result["monitor_needed"]:result["status_cn"]="本票无需继续等待"

    if has_review:status="review_required"
    elif has_pending:status="pending"
    elif any(item["state"]=="won" for item in combos):status="won"
    else:status="lost"
    total=Decimal(str(parlay["total_stake"]));void_adjusted=any(bool(leg.get("void_confirmed")) for leg in legs)
    return {"id":int(parlay["id"]),"pass_type":pass_type,"multiples":multiple,"unit_stake":float(unit),
        "combination_count":len(combos),"total_stake":float(total),"declared_payout":parlay.get("declared_payout"),
        "max_payout":float(max_payout),"payout_matches_ticket":None if void_adjusted or parlay.get("declared_payout") is None else _money(max_payout)==_money(parlay["declared_payout"]),"payout":float(_money(confirmed_payout)),
        "max_possible_payout":float(_money(confirmed_payout+max_possible)) if not has_review else None,
        "net":float(_money(confirmed_payout-total)) if status in {"won","lost"} else None,
        "status":status,"status_cn":PARLAY_STATUS_CN[status],"final":status in {"won","lost"},"legs":leg_results,"combinations":combos}

def load_parlay(parlay_id):
    with conn() as c:
        parent=c.execute("SELECT * FROM parlay_tickets WHERE id=?",(parlay_id,)).fetchone()
        if not parent: return None
        legs=[dict(row) for row in c.execute("SELECT * FROM parlay_legs WHERE parlay_id=? ORDER BY leg_index",(parlay_id,))]
        fixture_ids=[int(row["fixture_id"]) for row in legs]
        tasks={int(row["fixture_id"]):dict(row) for row in c.execute(
            "SELECT * FROM tasks WHERE fixture_id IN ("+",".join("?" for _ in fixture_ids)+")",fixture_ids)} if fixture_ids else {}
    return dict(parent),legs,tasks

def pending_parlay_fixture_ids():
    with conn() as c:
        ids=[int(row[0]) for row in c.execute(
            "SELECT id FROM parlay_tickets WHERE status IN ('pending','review_required')")]
    required=set()
    for parlay_id in ids:
        loaded=load_parlay(parlay_id)
        if not loaded:continue
        parent,legs,tasks=loaded
        evaluated=evaluate_parlay(parent,legs,tasks)
        for combo in evaluated["combinations"]:
            if combo["state"] in {"pending","review_required"}:
                required.update(int(leg["fixture_id"]) for leg in combo["legs"] if leg["state"]=="pending")
    return required

def sync_parlay(parlay_id,send_notice=True):
    loaded=load_parlay(parlay_id)
    if not loaded:return None
    parent,legs,tasks=loaded
    result=evaluate_parlay(parent,legs,tasks)
    stopped=parent.get("status")=="stopped"
    if stopped:
        result["status"]="stopped";result["status_cn"]=PARLAY_STATUS_CN["stopped"];result["net"]=None;result["final"]=False
    with conn() as c:
        if not stopped:c.execute("UPDATE parlay_tickets SET status=?,updated_at=? WHERE id=?",(result["status"],datetime.now(timezone.utc).isoformat(),parlay_id))
        current=c.execute("SELECT last_notified_state FROM parlay_tickets WHERE id=?",(parlay_id,)).fetchone()
        last=current["last_notified_state"] if current else None
    stop_unused_parlay_watchers([int(leg["fixture_id"]) for leg in legs])
    if send_notice and result["status"] in {"won","lost","review_required"} and result["status"]!=last:
        parts=[f"🎟️ 过关票状态：{result['status_cn']}",f"方式：{result['pass_type']} · {result['multiples']}倍 · {result['combination_count']}注",f"总投入：¥{result['total_stake']:.2f}"]
        for leg in result["legs"]:
            parts.append(f"{leg['home']} {leg['score'] or '—'} {leg['away']} · {leg['market_label']} {leg['selection']} · {leg['status_cn']}")
        parts.append(f"返奖：¥{result['payout']:.2f} · 净利：{('¥%+.2f'%result['net']) if result['net'] is not None else '待核验'}")
        notify("\n".join(parts))
        with conn() as c:c.execute("UPDATE parlay_tickets SET last_notified_state=? WHERE id=?",(result["status"],parlay_id))
    return result

def sync_parlays_for_fixture(fixture_id):
    with conn() as c:
        ids=[row[0] for row in c.execute("SELECT DISTINCT p.id FROM parlay_tickets p JOIN parlay_legs l ON l.parlay_id=p.id WHERE l.fixture_id=? AND p.status IN ('pending','review_required')",(fixture_id,))]
    for parlay_id in ids:sync_parlay(parlay_id)

@app.get("/api/health")
def health(_:str=Depends(auth)):
    return {"ok":True,"poller":POLL_ENABLED,"timezone":"Asia/Shanghai","screenshot_score_lists":True,
        "parlay_monitoring":True,"basketball_monitoring":bool(balldontlie_key())}

@app.get("/api/fixtures")
def fixtures(date:str=Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),q:str="",sport:Literal["football","basketball"]="football",
             league_code:Literal["nba","wnba"]="nba",_:str=Depends(auth)):
    if sport=="basketball":return basketball_fixtures(date,q,league_code)
    matches=api("fixtures",{"date":date,"timezone":"Asia/Shanghai"})
    term=q.strip().casefold()
    search_terms=[term] if term else []
    if term:
        directory=team_directory_by_id()
        exact_zh={team.get("name_en","").casefold() for team in directory.values()
                  if team.get("name_zh","").strip().casefold()==term and team.get("name_en")}
        if exact_zh:
            search_terms=sorted(exact_zh)
        elif len(term)>=2:
            partial_zh={team.get("name_en","").casefold() for team in directory.values()
                        if term in team.get("name_zh","").strip().casefold() and team.get("name_en")}
            if partial_zh:
                search_terms=sorted(partial_zh)
    def team_matches(name):
        name=(name or "").casefold()
        return not search_terms or any(search_term in name for search_term in search_terms)
    return [{"id":x["fixture"]["id"],"provider_id":x["fixture"]["id"],"sport":"football","home":x["teams"]["home"]["name"],"away":x["teams"]["away"]["name"],
             "league_name":(x.get("league") or {}).get("name"),
             "kickoff":x["fixture"]["date"],"status":x["fixture"]["status"]["short"],"status_cn":STATUS_CN.get(x["fixture"]["status"]["short"],x["fixture"]["status"]["short"])}
             for x in matches if team_matches(x["teams"]["home"]["name"]) or team_matches(x["teams"]["away"]["name"])]

def _utc_datetime(value):
    try:
        parsed=datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed=parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError,ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)

@app.get("/api/tasks")
def tasks(_:str=Depends(auth), include_history:bool=False):
    now=datetime.now(timezone.utc)
    with conn() as c:
        rows=[dict(x) for x in c.execute("SELECT * FROM tasks ORDER BY created_at DESC")]
    upcoming=[]
    visible=[]
    for x in rows:
        if x["status"]=="finished" and not include_history:
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
        listed_scores_raw=x.pop("listed_scores_json",None)
        x["listed_scores"]=json.loads(listed_scores_raw) if listed_scores_raw else None
        x["listed_scores_verified"]=bool(x.pop("listed_scores_verified",0))
        parts=(x.get("settlement_score") or x["last_score"] or "").split(":")
        half=(x.get("half_score") or "").split(":")
        verified_scores=x["listed_scores"] if x["listed_scores_verified"] else None
        x["settlement"]=outcome(*(map(int,parts) if len(parts)==2 and all(p.isdigit() for p in parts) else [None,None]),x["tickets"],
            *(map(int,half) if len(half)==2 and all(p.isdigit() for p in half) else [None,None]),verified_scores)
        if x["status"]=="review_required":
            settlement=x["settlement"]
            settlement["selection"]=None
            settlement["payout"]=0
            settlement["net"]=None
            settlement["pending_tickets"]=len(settlement["tickets"])
            for ticket in settlement["tickets"]:
                ticket["won"]=None
                ticket["payout"]=0
            for market in settlement["market_summaries"]:
                market["payout"]=0
                market["net"]=None
                market["pending_tickets"]=market["tickets"]
        x["settlement"]["final"]=x["status"]=="finished"
        x["status_cn"]=TASK_STATUS_CN.get(x["status"],x["status"])
        if x.get("sport")=="basketball":
            x["home_cn"]=BASKETBALL_TEAM_NAMES_ZH.get(x["home"],"")
            x["away_cn"]=BASKETBALL_TEAM_NAMES_ZH.get(x["away"],"")
            state,_,raw_status=str(x.get("provider_status") or "").partition("|")
            x["game_status_cn"]=(raw_status or _bdl_status_cn(state)) if state else "等待首次查询"

    return rows

@app.get("/api/statistics")
def statistics(_:str=Depends(auth)):
    days={}
    details={}
    missing=0
    def date_key(value):
        try:
            return (_utc_datetime(value).astimezone(TZ)-timedelta(hours=12)).date().isoformat() if value else None
        except (ValueError,TypeError,OverflowError):
            return None
    def add(key,stake,payout,settled):
        day=days.setdefault(key,{"stake":Decimal(0),"payout":Decimal(0),"settled_stake":Decimal(0),"pending":0})
        day["stake"]+=Decimal(str(stake))
        if settled:
            day["settled_stake"]+=Decimal(str(stake));day["payout"]+=Decimal(str(payout or 0))
        else:day["pending"]+=1
    for task in tasks(_=_,include_history=True):
        picks=task.get("tickets") or []
        if not picks:continue
        key=date_key(task.get("kickoff"))
        if not key:missing+=1;continue
        result=task["settlement"]
        for pick in result["tickets"]:
            settled=task["status"]=="finished" and pick["won"] is not None
            add(key,pick["stake"],pick["payout"],settled)
            line=f"（让球/让分 {pick['handicap']}）" if pick.get("handicap") is not None else f"（总分 {pick['line']}）" if pick.get("line") is not None else ""
            details.setdefault(key,[]).append({"type":"single","id":task["id"],"kickoff":task.get("kickoff"),"match":task["home"]+" vs "+task["away"],"market":pick["market_label"],"selection":f"{pick['selection']}{line} · SP {pick['odds']}","stake":pick["stake"],"payout":pick["payout"] if settled else None,"net":pick["payout"]-pick["stake"] if settled else None})
    with conn() as c:ids=[row[0] for row in c.execute("SELECT id FROM parlay_tickets")]
    for parlay_id in ids:
        loaded=load_parlay(parlay_id)
        if not loaded:continue
        parent,legs,linked_tasks=loaded
        keys=[date_key(leg.get("kickoff")) for leg in legs]
        if not keys or any(key is None for key in keys):missing+=1;continue
        key=min(keys)
        result=evaluate_parlay(parent,legs,linked_tasks)
        for combo in result["combinations"]:
            add(key,combo["stake"],combo["payout"],combo["state"] in {"won","lost"})
        details.setdefault(key,[]).append({"type":"parlay","id":parlay_id,"kickoff":min(legs,key=lambda leg:_utc_datetime(leg["kickoff"]))["kickoff"],"match":"；".join(leg["home"]+" vs "+leg["away"] for leg in legs),"market":result["pass_type"],"selection":"；".join(f"{leg['home']} vs {leg['away']}："+"、".join(f"{pick['market_label']} {pick['selection']} SP {pick['odds']}" for pick in leg["selections"]) for leg in result["legs"]),"stake":result["total_stake"],"payout":result["payout"],"net":result["net"],"pending":sum(combo["state"] not in {"won","lost"} for combo in result["combinations"])})
    return {"days":{key:{"stake":float(v["stake"]),"payout":float(v["payout"]),"settled_stake":float(v["settled_stake"]),"net":float(v["payout"]-v["settled_stake"]),"pending":v["pending"]} for key,v in days.items()},"details":details,"missing_dates":missing}

@app.get("/api/parlays")
def get_parlays(_:str=Depends(auth)):
    with conn() as c: ids=[row[0] for row in c.execute("SELECT id FROM parlay_tickets ORDER BY created_at DESC")]
    result=[]
    for parlay_id in ids:
        item=sync_parlay(parlay_id,send_notice=False)
        if item:result.append(item)
    return result

@app.post("/api/parlays")
def create_parlay(data:ParlayIn,_:str=Depends(auth)):
    if not 2<=len(data.legs)<=8:raise HTTPException(422,"过关票须包含2到8场比赛")
    if len({leg.sport for leg in data.legs})!=1:raise HTTPException(422,"同一张过关票不能混合足球和篮球比赛")
    if Decimal(str(data.unit_stake))!=Decimal("2"):raise HTTPException(422,"竞彩过关每注金额必须为2元")
    try:canonical,combo_indices=pass_combinations(len(data.legs),data.pass_type)
    except HTTPException:raise
    except Exception:raise HTTPException(422,"无效的过关方式")
    canonical_choices={}
    for leg in data.legs:
        raw_choices=leg.selections or [ParlaySelectionIn(market=leg.market,selection=leg.selection,odds=leg.odds,handicap=leg.handicap,line=leg.line)]
        if not raw_choices:raise HTTPException(422,"每场比赛至少需要一个投注选项")
        if len({pick.market for pick in raw_choices})!=1:raise HTTPException(422,"同一比赛腿的多选项必须属于同一玩法")
        normalized=[];seen=set()
        for pick in raw_choices:
            candidate=Ticket(selection=pick.selection,market=pick.market,stake=2,odds=pick.odds,handicap=pick.handicap,line=pick.line)
            validated=validate_tickets([candidate],leg.sport)[0]
            key=(validated["market"],validated["selection"],validated.get("handicap"),validated.get("line"),validated["odds"])
            if key in seen:raise HTTPException(422,"同一比赛腿中存在重复投注项")
            seen.add(key);normalized.append(validated)
        canonical_choices[id(leg)]=normalized
    count=sum(math.prod(len(canonical_choices[id(data.legs[index])]) for index in indices) for indices in combo_indices)
    if count>5000:raise HTTPException(422,"展开后的过关注数超过5000注")
    total=Decimal("2")*int(data.multiples)*count
    if data.declared_total is not None and _money(data.declared_total)!=_money(total):
        raise HTTPException(422,f"票面总金额与过关组合数不符：按此过关方式应为¥{total:.2f}")
    internal_ids={}
    for leg in data.legs:
        if leg.sport=="basketball":
            namespace=BALLDONTLIE_GAME_ID_BASE[leg.league_code]
            if leg.fixture_id>=namespace:raise HTTPException(422,"BallDontLie 比赛 ID 无效")
            internal_id=namespace+leg.fixture_id
        else:internal_id=leg.fixture_id
        if internal_id in internal_ids.values():raise HTTPException(422,"同一场比赛不能重复作为多条比赛腿")
        internal_ids[id(leg)]=internal_id
    # Reuse existing task rows by provider-specific ID. Basketball IDs are
    # namespaced so NBA, WNBA, and API-Football fixtures cannot collide.
    fixture_ids=list(internal_ids.values())
    fixtures={}
    with conn() as c:
        existing={int(row["fixture_id"]):dict(row) for row in c.execute(
            "SELECT * FROM tasks WHERE fixture_id IN ("+",".join("?" for _ in fixture_ids)+")",fixture_ids)}
    for leg in data.legs:
        internal_id=internal_ids[id(leg)]
        if internal_id in existing:continue
        if leg.sport=="basketball":
            payload=balldontlie_api(f"games/{leg.fixture_id}",league_code=leg.league_code)
            fixture=payload.get("data")
            if not isinstance(fixture,dict) or int(fixture.get("id",0))!=leg.fixture_id:
                raise HTTPException(422,f"第{data.legs.index(leg)+1}场比赛无法在 {leg.league_code.upper()} 数据中核实")
            home=(fixture.get("home_team") or {}).get("full_name") or ""
            away=(fixture.get("visitor_team") or {}).get("full_name") or ""
            kickoff=_bdl_datetime(fixture.get("datetime") or fixture.get("date"))
            if not home or not away or kickoff is None:raise HTTPException(422,"BallDontLie 未提供完整的球队名称或开赛时间")
            postseason=bool(fixture.get("postseason"))
            league_name=("WNBA季后赛" if postseason else "WNBA") if leg.league_code=="wnba" else "NBA季后赛" if postseason else "NBA杯" if fixture.get("ist_stage") else "NBA"
            fixtures[internal_id]={"sport":"basketball","provider_game_id":str(leg.fixture_id),"league_code":leg.league_code,
                "home":home,"away":away,"league_name":league_name,"kickoff":kickoff.isoformat()}
        else:
            rows=api("fixtures",{"id":leg.fixture_id,"timezone":"Asia/Shanghai"})
            if len(rows)!=1 or int(rows[0].get("fixture",{}).get("id",0))!=leg.fixture_id:
                raise HTTPException(422,f"第{data.legs.index(leg)+1}场比赛无法在 API-Football 中核实")
            fixture=rows[0]
            fixtures[internal_id]={"sport":"football","provider_game_id":str(leg.fixture_id),"league_code":None,
                "home":fixture["teams"]["home"]["name"],"away":fixture["teams"]["away"]["name"],
                "league_name":(fixture.get("league") or {}).get("name"),"kickoff":fixture["fixture"]["date"]}
    now=datetime.now(timezone.utc)
    created_at=now.isoformat()
    resumed=[]
    with TASK_LOCK:
        with conn() as c:
            c.execute("BEGIN IMMEDIATE")
            # Recheck after provider calls to avoid creating a second watcher if
            # another request added this fixture while validation was in flight.
            current={int(row["fixture_id"]):dict(row) for row in c.execute(
                "SELECT * FROM tasks WHERE fixture_id IN ("+",".join("?" for _ in fixture_ids)+")",fixture_ids)}
            for leg in data.legs:
                internal_id=internal_ids[id(leg)]
                if internal_id not in current:
                    fixture=fixtures[internal_id]
                    kickoff=fixture["kickoff"]
                    raw_start=leg.start_at
                    if raw_start:
                        try:
                            start=datetime.fromisoformat(raw_start)
                            if start.tzinfo is None:raise ValueError()
                        except ValueError:raise HTTPException(422,"比赛腿开始监测时间必须带时区")
                    else:
                        start=_utc_datetime(kickoff)+timedelta(minutes=150 if leg.sport=="basketball" else 120)
                    next_at=max(start.astimezone(timezone.utc),now).isoformat()
                    cur=c.execute("""INSERT INTO tasks(fixture_id,provider_game_id,league_code,sport,home,away,league_name,kickoff,start_at,interval_minutes,next_check,ticket_json,created_at,created_for_parlay)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",(internal_id,fixture["provider_game_id"],fixture["league_code"],fixture["sport"],fixture["home"],fixture["away"],fixture["league_name"],kickoff,start.isoformat(),leg.interval_minutes,next_at,"[]",created_at))
                    current[internal_id]={"id":cur.lastrowid,"fixture_id":internal_id,"home":fixture["home"],"away":fixture["away"],"league_name":fixture["league_name"],"kickoff":kickoff,"status":"pending","enabled":1}
                else:
                    row=current[internal_id]
                    if row.get("status") in {"paused","stopped"}:
                        c.execute("UPDATE tasks SET status='pending',enabled=1,next_check=? WHERE id=?",(now.isoformat(),row["id"]))
                        row["status"]="pending";row["enabled"]=1;resumed.append(leg.fixture_id)
            cur=c.execute("""INSERT INTO parlay_tickets(pass_type,multiples,unit_stake,total_stake,declared_payout,status,created_at,updated_at)
                VALUES (?,?,?,?,?,'pending',?,?)""",(canonical,int(data.multiples),2.0,float(total),data.declared_payout,created_at,created_at))
            parlay_id=cur.lastrowid
            for index,leg in enumerate(data.legs):
                row=current[internal_ids[id(leg)]]
                validated=canonical_choices[id(leg)];first=validated[0]
                c.execute("""INSERT INTO parlay_legs(parlay_id,leg_index,fixture_id,sport,league_code,home,away,league_name,kickoff,market,selection,handicap,line,odds,selections_json)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(parlay_id,index,internal_ids[id(leg)],leg.sport,leg.league_code if leg.sport=="basketball" else None,
                    row["home"],row["away"],row.get("league_name"),row.get("kickoff"),first["market"],first["selection"],first.get("handicap"),first.get("line"),str(first["odds"]),json.dumps(validated,ensure_ascii=False,separators=(",",":"))))
    result=sync_parlay(parlay_id)
    if result:result["resumed_fixture_ids"]=resumed
    return result

@app.put("/api/parlays/{parlay_id}/odds")
def update_parlay_odds(parlay_id:int,data:ParlayOddsUpdateIn,_:str=Depends(auth)):
    if any(not math.isfinite(value) or value<1 for item in data.legs for value in item.odds):
        raise HTTPException(422,"每个SP必须是大于或等于1的有效数字")
    with TASK_LOCK:
        with conn() as c:
            parent=c.execute("SELECT status FROM parlay_tickets WHERE id=?",(parlay_id,)).fetchone()
            if not parent:raise HTTPException(404,"Parlay ticket not found")
            if parent["status"] in {"won","lost"}:
                raise HTTPException(409,"已结算的过关票不能修改SP")
            current=load_parlay(parlay_id)
            if current and evaluate_parlay(*current)["status"] in {"won","lost"}:
                raise HTTPException(409,"比赛已完成结算，不能修改过关票SP")
            legs=[dict(row) for row in c.execute(
                "SELECT * FROM parlay_legs WHERE parlay_id=? ORDER BY leg_index",(parlay_id,))]
            updates={item.leg_id:item.odds for item in data.legs}
            if len(updates)!=len(data.legs) or set(updates)!={int(leg["id"]) for leg in legs}:
                raise HTTPException(422,"SP修改数据必须包含这张过关票的全部比赛")
            for leg in legs:
                choices=_parlay_leg_choices(leg)
                odds=updates[int(leg["id"])]
                if len(odds)!=len(choices):
                    raise HTTPException(422,"每场比赛的SP数量必须与投注项数量一致")
                for choice,value in zip(choices,odds):choice["odds"]=float(value)
                c.execute("UPDATE parlay_legs SET odds=?,selections_json=? WHERE id=? AND parlay_id=?",
                    (str(choices[0]["odds"]),json.dumps(choices,ensure_ascii=False,separators=(",",":")),leg["id"],parlay_id))
            c.execute("UPDATE parlay_tickets SET updated_at=? WHERE id=?",
                (datetime.now(timezone.utc).isoformat(),parlay_id))
    result=sync_parlay(parlay_id,send_notice=False)
    return result or {"ok":True}

@app.post("/api/parlays/{parlay_id}/stop")
def stop_parlay(parlay_id:int,_:str=Depends(auth)):
    with TASK_LOCK:
        with conn() as c:
            row=c.execute("SELECT id FROM parlay_tickets WHERE id=?",(parlay_id,)).fetchone()
            if not row:raise HTTPException(404,"Parlay ticket not found")
            fixtures=[int(item[0]) for item in c.execute("SELECT fixture_id FROM parlay_legs WHERE parlay_id=?",(parlay_id,))]
            c.execute("UPDATE parlay_tickets SET status='stopped',updated_at=? WHERE id=?",(datetime.now(timezone.utc).isoformat(),parlay_id))
        stop_unused_parlay_watchers(fixtures)
    return {"ok":True,"status":"stopped"}

@app.delete("/api/parlays/{parlay_id}")
def delete_parlay(parlay_id:int,_:str=Depends(auth)):
    with TASK_LOCK:
        with conn() as c:
            fixtures=[int(item[0]) for item in c.execute("SELECT fixture_id FROM parlay_legs WHERE parlay_id=?",(parlay_id,))]
            cur=c.execute("DELETE FROM parlay_tickets WHERE id=?",(parlay_id,))
            if cur.rowcount==0:raise HTTPException(404,"Parlay ticket not found")
        stop_unused_parlay_watchers(fixtures)
    return {"ok":True,"deleted":parlay_id}

@app.post("/api/parlays/{parlay_id}/legs/{leg_id}/confirm-void")
def confirm_parlay_void(parlay_id:int,leg_id:int,data:ConfirmVoidIn,_:str=Depends(auth)):
    if not data.confirmed:raise HTTPException(422,"Confirm that the official lottery result marks this fixture invalid")
    with conn() as c:
        row=c.execute("SELECT id FROM parlay_legs WHERE id=? AND parlay_id=?",(leg_id,parlay_id)).fetchone()
        if not row:raise HTTPException(404,"Parlay leg not found")
        c.execute("UPDATE parlay_legs SET void_confirmed=1 WHERE id=?",(leg_id,))
        c.execute("UPDATE parlay_tickets SET status='pending',last_notified_state=NULL,updated_at=? WHERE id=?",(datetime.now(timezone.utc).isoformat(),parlay_id))
    result=sync_parlay(parlay_id)
    return result or {"ok":True}

def has_open_parlay_for_fixture(fixture_id):
    with conn() as c:
        return c.execute("""SELECT 1 FROM parlay_legs l JOIN parlay_tickets p ON p.id=l.parlay_id
            WHERE l.fixture_id=? AND p.status IN ('pending','review_required') LIMIT 1""",(fixture_id,)).fetchone() is not None

def stop_unused_parlay_watchers(fixture_ids):
    required=pending_parlay_fixture_ids()
    with conn() as c:
        for fixture_id in set(fixture_ids):
            if int(fixture_id) in required:continue
            task=c.execute("SELECT id,status,ticket_json,created_for_parlay FROM tasks WHERE fixture_id=?",(fixture_id,)).fetchone()
            if not task or not task["created_for_parlay"] or json.loads(task["ticket_json"] or "[]") or task["status"] not in {"pending","running","paused"}:
                continue
            c.execute("UPDATE tasks SET status='stopped',enabled=0 WHERE id=?",(task["id"],))

@app.post("/api/tasks")
def create_task(data:TaskIn,_:str=Depends(auth)):
    tickets=validate_tickets(data.tickets,data.sport)
    listed_scores=validate_listed_scores(data.listed_scores)
    if data.sport=="basketball":
        if listed_scores is not None or data.listed_scores_verified:raise HTTPException(422,"竞彩比分清单只适用于足球任务")
    else:validate_score_metadata(tickets,listed_scores,data.listed_scores_verified)
    try:
        start=datetime.fromisoformat(data.start_at)
        if start.tzinfo is None:raise ValueError()
    except ValueError:raise HTTPException(422,"start_at must include timezone offset")
    if data.sport=="basketball":
        league_code=data.league_code
        namespace=BALLDONTLIE_GAME_ID_BASE[league_code]
        if data.fixture_id>=namespace:raise HTTPException(422,"BallDontLie 比赛 ID 无效")
        payload=balldontlie_api(f"games/{data.fixture_id}",league_code=league_code)
        fixture=payload.get("data")
        if not isinstance(fixture,dict) or int(fixture.get("id",0))!=data.fixture_id:raise HTTPException(422,f"{league_code.upper()} 比赛无法在 BallDontLie 中核实")
        home=(fixture.get("home_team") or {}).get("full_name") or ""
        away=(fixture.get("visitor_team") or {}).get("full_name") or ""
        if home!=data.home or away!=data.away:raise HTTPException(422,f"{league_code.upper()} 比赛队伍与 BallDontLie 返回结果不一致")
        kickoff=_bdl_datetime(fixture.get("datetime") or fixture.get("date"))
        if kickoff is None:raise HTTPException(422,f"BallDontLie 尚未提供该 {league_code.upper()} 比赛的准确开赛时间")
        kickoff_value=kickoff.isoformat()
        league_name=("WNBA季后赛" if bool(fixture.get("postseason")) else "WNBA") if league_code=="wnba" else "NBA季后赛" if bool(fixture.get("postseason")) else "NBA杯" if fixture.get("ist_stage") else "NBA"
        sport="basketball"
        provider_game_id=str(data.fixture_id)
        internal_fixture_id=namespace+data.fixture_id
    else:
        # Confirm match identity from the provider; never trust just the browser's team names.
        rows=api("fixtures",{"id":data.fixture_id,"timezone":"Asia/Shanghai"})
        if len(rows)!=1:raise HTTPException(422,"Fixture not accessible")
        fixture=rows[0]
        home=fixture["teams"]["home"]["name"];away=fixture["teams"]["away"]["name"]
        league_name=(fixture.get("league") or {}).get("name")
        kickoff_value=fixture["fixture"]["date"]
        sport="football"
        provider_game_id=str(data.fixture_id)
        internal_fixture_id=data.fixture_id
        league_code=None
    now=datetime.now(timezone.utc).isoformat()
    next_at=max(start.astimezone(timezone.utc).isoformat(),now)
    with conn() as c:
        try:
            cur=c.execute("""INSERT INTO tasks(fixture_id,provider_game_id,league_code,sport,home,away,league_name,kickoff,start_at,interval_minutes,next_check,ticket_json,listed_scores_json,listed_scores_verified,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",(internal_fixture_id,provider_game_id,league_code,sport,home,away,league_name,kickoff_value,start.isoformat(),data.interval_minutes,next_at,json.dumps(tickets,ensure_ascii=False),json.dumps(listed_scores,ensure_ascii=False) if listed_scores is not None else None,int(data.listed_scores_verified),now))
        except sqlite3.IntegrityError:raise HTTPException(409,"Fixture already monitored")
    return {"id":cur.lastrowid,"home":home,"away":away,"sport":sport,"league_code":league_code}

@app.put("/api/tasks/{task_id}/tickets")
def update_tickets(task_id:int,data:list[Ticket]|TicketUpdateIn,_:str=Depends(auth)):
    tickets=data if isinstance(data,list) else data.tickets
    with TASK_LOCK:
        with conn() as c:
            existing=c.execute("SELECT sport,listed_scores_json,listed_scores_verified FROM tasks WHERE id=?",(task_id,)).fetchone()
            if not existing:raise HTTPException(404,"Task not found")
            values=validate_tickets(tickets,existing["sport"])
            if existing["sport"]=="basketball" and isinstance(data,TicketUpdateIn) and (data.listed_scores is not None or data.listed_scores_verified is True):
                raise HTTPException(422,"竞彩比分清单只适用于足球任务")
            if isinstance(data,list):
                listed_scores=json.loads(existing["listed_scores_json"]) if existing["listed_scores_json"] else None
                verified=bool(existing["listed_scores_verified"])
            else:
                if data.listed_scores is None:
                    listed_scores=json.loads(existing["listed_scores_json"]) if existing["listed_scores_json"] else None
                    verified=bool(existing["listed_scores_verified"]) if data.listed_scores_verified is None else data.listed_scores_verified
                else:
                    listed_scores=validate_listed_scores(data.listed_scores)
                    verified=bool(data.listed_scores_verified)
            validate_score_metadata(values,listed_scores,verified)
            c.execute("UPDATE tasks SET ticket_json=?,listed_scores_json=?,listed_scores_verified=?,created_for_parlay=CASE WHEN ?=1 THEN 0 ELSE created_for_parlay END WHERE id=?",
                (json.dumps(values,ensure_ascii=False),json.dumps(listed_scores,ensure_ascii=False) if listed_scores is not None else None,int(verified),int(bool(values)),task_id))
    return {"ok":True,"tickets":len(values)}

@app.put("/api/tasks/{task_id}/schedule")
def update_schedule(task_id:int,data:ScheduleUpdateIn,_:str=Depends(auth)):
    try:
        start=datetime.fromisoformat(data.start_at)
        if start.tzinfo is None:raise ValueError()
    except ValueError:raise HTTPException(422,"start_at must include timezone offset")
    start_utc=start.astimezone(timezone.utc)
    now=datetime.now(timezone.utc)
    with TASK_LOCK:
        with conn() as c:
            row=c.execute("SELECT status,enabled,next_check FROM tasks WHERE id=?",(task_id,)).fetchone()
            if not row:raise HTTPException(404,"Task not found")
            if row["status"] in {"finished","review_required"}:
                raise HTTPException(409,"Finished or review-required task schedule cannot be changed")
            status=row["status"]
            if status=="pending":
                next_check=max(start_utc,now)
            elif status=="running":
                if start_utc>now:
                    status="pending"
                    next_check=start_utc
                else:
                    next_check=max(_utc_datetime(row["next_check"]),now)
            else:
                # Paused or stopped tasks remain inactive until explicitly resumed.
                next_check=max(start_utc,now)
            c.execute("UPDATE tasks SET start_at=?,interval_minutes=?,next_check=?,status=? WHERE id=?",
                (start_utc.isoformat(),data.interval_minutes,next_check.isoformat(),status,task_id))
    return {"ok":True,"start_at":start_utc.isoformat(),"interval_minutes":data.interval_minutes,"status":status}

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id:int,_:str=Depends(auth)):
    with TASK_LOCK:
        with conn() as c:
            task=c.execute("SELECT fixture_id FROM tasks WHERE id=?",(task_id,)).fetchone()
            if not task:raise HTTPException(404,"Task not found")
            if has_open_parlay_for_fixture(int(task["fixture_id"])):
                raise HTTPException(409,"此比赛仍被未结算的过关票引用；请先停止或删除过关票")
            result=c.execute("DELETE FROM tasks WHERE id=?",(task_id,))
            if result.rowcount==0:raise HTTPException(404,"Task not found")
    return {"ok":True,"deleted":task_id}

@app.post("/api/tasks/{task_id}/{action}")
def task_action(task_id:int,action:str,_:str=Depends(auth)):
    if action not in {"pause","resume","stop"}:raise HTTPException(400,"Invalid action")
    with TASK_LOCK:
        with conn() as c:
            row=c.execute("SELECT status,start_at FROM tasks WHERE id=?",(task_id,)).fetchone()
            if not row:raise HTTPException(404,"Task not found")
            if row["status"] in {"finished","review_required"}:raise HTTPException(409,"Finished match cannot be resumed")
            fixture=c.execute("SELECT fixture_id FROM tasks WHERE id=?",(task_id,)).fetchone()[0]
            if action in {"pause","stop"} and has_open_parlay_for_fixture(int(fixture)):
                raise HTTPException(409,"此比赛仍被未结算的过关票引用；请先停止或删除过关票")
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

@app.get("/parlay-parser.js")
def parlay_parser(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("parlay-parser.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})

@app.get("/parlay-ui.js")
def parlay_ui(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("parlay-ui.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})

@app.get("/teams-map.js")
def teams_map(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("teams-map.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})

@app.get("/basketball-teams.js")
def basketball_teams(_:str=Depends(auth)):
    return FileResponse(Path(__file__).with_name("basketball-teams.js"),media_type="application/javascript",headers={"Cache-Control":"no-store"})

@lru_cache(maxsize=1)
def team_directory_by_id():
    source=Path(__file__).with_name("teams-map.js").read_text(encoding="utf-8").strip()
    prefix="globalThis.MatchMonitorTeamDirectory="
    if not source.startswith(prefix):
        return {}
    payload=source[len(prefix):].strip()
    if payload.endswith(";"):
        payload=payload[:-1]
    try:
        directory=json.loads(payload)
    except json.JSONDecodeError:
        return {}
    return directory if isinstance(directory,dict) else {}

def _team_logo_url_parts(logo_url):
    if not isinstance(logo_url,str) or len(logo_url)>2048:
        raise ValueError("invalid logo URL")
    parsed=urllib.parse.urlsplit(logo_url)
    try:
        port=parsed.port
    except ValueError as error:
        raise ValueError("invalid logo URL port") from error
    if parsed.scheme.lower()!="https" or not parsed.hostname or parsed.username or parsed.password or port not in (None,443):
        raise ValueError("logo URL must be a public HTTPS URL")
    host=parsed.hostname.rstrip(".")
    try:
        literal=ipaddress.ip_address(host)
    except ValueError:
        literal=None
    if literal is not None:
        if not literal.is_global:
            raise ValueError("team logo address is not public")
        host=literal.compressed
    else:
        try:
            host=host.encode("idna").decode("ascii").lower()
        except UnicodeError as error:
            raise ValueError("invalid logo hostname") from error
        if not host or len(host)>253 or any(not label or len(label)>63 or label.startswith("-") or label.endswith("-") or not all(ch.isalnum() or ch=="-" for ch in label) for label in host.split(".")):
            raise ValueError("invalid logo hostname")
    return parsed,host

def _resolve_public_team_logo_target(logo_url):
    parsed,host=_team_logo_url_parts(logo_url)
    try:
        literal=ipaddress.ip_address(host)
    except ValueError:
        literal=None
    if literal is not None:
        if not literal.is_global:
            raise ValueError("team logo address is not public")
        addresses=[literal.compressed]
    else:
        try:
            records=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        except OSError as error:
            raise RuntimeError("team logo hostname could not be resolved") from error
        addresses=[]
        for record in records:
            address=record[4][0].split("%",1)[0]
            try:
                parsed_address=ipaddress.ip_address(address)
            except ValueError as error:
                raise ValueError("invalid resolved team logo address") from error
            if not parsed_address.is_global:
                raise ValueError("team logo address is not public")
            if parsed_address.compressed not in addresses:
                addresses.append(parsed_address.compressed)
        if not addresses:
            raise RuntimeError("team logo hostname has no addresses")
    path=parsed.path or "/"
    if parsed.query:
        path+="?"+parsed.query
    return host,addresses[0],path

class _PinnedTeamLogoHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self,host,address,timeout=8):
        super().__init__(host,port=443,timeout=timeout,context=ssl.create_default_context())
        self.pinned_address=address

    def connect(self):
        self.sock=socket.create_connection((self.pinned_address,self.port),self.timeout,self.source_address)
        if self._tunnel_host:
            self._tunnel()
        self.sock=self._context.wrap_socket(self.sock,server_hostname=self.host)

def fetch_team_logo(logo_url):
    connection=None
    try:
        host,address,path=_resolve_public_team_logo_target(logo_url)
        connection=_PinnedTeamLogoHTTPSConnection(host,address,timeout=8)
        connection.request("GET",path,headers={"User-Agent":"MatchMonitor/1.0","Accept":"image/png"})
        upstream=connection.getresponse()
        if upstream.status!=200:
            raise HTTPException(status_code=502,detail="球队队徽服务未返回图片")
        content_type=upstream.getheader("Content-Type","").split(";",1)[0].strip().lower()
        if content_type!="image/png":
            raise HTTPException(status_code=502,detail="球队队徽服务返回了非PNG图片")
        if int(upstream.getheader("Content-Length","0") or 0)>2*1024*1024:
            raise HTTPException(status_code=502,detail="球队队徽图片超过大小限制")
        image=upstream.read(2*1024*1024+1)
        if len(image)>2*1024*1024:
            raise HTTPException(status_code=502,detail="球队队徽图片超过大小限制")
        if len(image)<8 or image[:8]!=b"\x89PNG\r\n\x1a\n":
            raise HTTPException(status_code=502,detail="球队队徽服务返回了无效PNG图片")
        return image
    except ValueError as error:
        raise HTTPException(status_code=404,detail="球队队徽地址无效或不安全") from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502,detail="暂时无法加载球队队徽") from error
    finally:
        if connection is not None:
            connection.close()

@app.get("/team-logo/{team_id}.png")
def team_logo(team_id:int, _:str=Depends(auth)):
    entry=team_directory_by_id().get(str(team_id))
    logo_url=entry.get("logo") if isinstance(entry,dict) else None
    try:
        _team_logo_url_parts(logo_url)
    except (TypeError,ValueError):
        raise HTTPException(status_code=404,detail="球队队徽不存在")
    image=fetch_team_logo(logo_url)
    return Response(image,media_type="image/png",headers={"Cache-Control":"private, max-age=86400","X-Content-Type-Options":"nosniff"})

@app.get("/brand-logo.webp")
def brand_logo(_:str=Depends(auth)):
    logo=Path(__file__).with_name("assets")/"match-monitor-logo.webp"
    if not logo.is_file():
        raise HTTPException(status_code=404,detail="网站标志图片不存在")
    return FileResponse(logo,media_type="image/webp",headers={"Cache-Control":"private, max-age=86400","X-Content-Type-Options":"nosniff"})
