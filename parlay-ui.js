(function (root) {
  "use strict";
  const core = root.MatchMonitorCore;
  if (!core) return;
  const $ = core.$;
  const DRAFT_OPTIONS = core.getOptions();
  const MARKETS = core.getMarkets();
  const FOOTBALL_MARKETS=Object.keys(DRAFT_OPTIONS);
  const BASKETBALL_OPTIONS={
    basketball_result:["胜","负"],
    basketball_handicap:["胜","负"],
    basketball_total:["大","小"],
    basketball_margin:["主胜1-5分","主胜6-10分","主胜11-15分","主胜16-20分","主胜21-25分","主胜26+分","客胜1-5分","客胜6-10分","客胜11-15分","客胜16-20分","客胜21-25分","客胜26+分"]
  };
  const BASKETBALL_MARKETS=Object.keys(BASKETBALL_OPTIONS);
  const COMBO_SIZES = {
    2:{1:[2],3:[1,2]},3:{1:[3],3:[2],4:[2,3],7:[1,2,3]},
    4:{1:[4],4:[3],5:[3,4],6:[2],11:[2,3,4],15:[1,2,3,4]},
    5:{1:[5],5:[4],6:[4,5],10:[3],16:[3,4,5],20:[2,3],26:[2,3,4,5],31:[1,2,3,4,5]},
    6:{1:[6],6:[5],7:[5,6],15:[4],20:[3],22:[4,5,6],35:[3,4],42:[3,4,5,6],50:[2,3,4],57:[2,3,4,5,6],63:[1,2,3,4,5,6]},
    7:{1:[7],7:[6],8:[6,7],21:[5],35:[4],56:[3],120:[2,3,4,5,6,7],127:[1,2,3,4,5,6,7]},
    8:{1:[8],8:[7],9:[7,8],28:[6],56:[5],70:[4],247:[2,3,4,5,6,7,8],255:[1,2,3,4,5,6,7,8]}
  };
  const PASS_OPTIONS = new Set(Object.entries(COMBO_SIZES).flatMap(([n,modes])=>Object.keys(modes).map(mode=>`${n}串${mode}`)));
  let legs = [];
  let bindingIndex = null;
  let submitting = false;

  const money = value => "¥" + Number(value || 0).toFixed(2);
  const roundTicket = value => Math.round(value * 100 + 1e-8) / 100;
  const field = (label, control) => { const box=document.createElement("label");box.className="parlay-field";box.append(document.createTextNode(label),control);return box; };
  const input = (type,value,attrs={}) => { const el=document.createElement("input");el.type=type;if(value!==undefined&&value!==null)el.value=value;for(const [key,val] of Object.entries(attrs))el.setAttribute(key,val);return el; };
  const select = (values,value) => { const el=document.createElement("select");for(const item of values){const option=document.createElement("option");option.value=item;option.textContent=item;el.append(option)}if(values.includes(value))el.value=value;return el; };

  function splitPass(value) { const m=String(value||"").match(/^(\d+)串(\d+)$/);return m?{legs:Number(m[1]),mode:Number(m[2])}:null; }
  function combinations(count,sizes) {
    const out=[];
    const walk=(size,start,chosen)=>{if(chosen.length===size){out.push([...chosen]);return}for(let i=start;i<count;i++){chosen.push(i);walk(size,i+1,chosen);chosen.pop()}};
    for(const size of sizes||[])walk(size,0,[]);
    return out;
  }
  function optionsFor(market) { return DRAFT_OPTIONS[market]||BASKETBALL_OPTIONS[market]||[]; }
  function marketOptionsFor(sport) { return sport==="basketball"?BASKETBALL_MARKETS:FOOTBALL_MARKETS; }
  function fixtureKey(item) { const sport=item.sport||"football",league=sport==="basketball"?(item.league_code||"nba"):"football";return `${sport}:${league}:${Number(item.provider_id??item.fixture_id??item.id)}`; }
  function validBasketballLine(value) { const n=Number(value);return Number.isFinite(n)&&Math.abs(n*2-Math.round(n*2))<1e-8&&Math.abs(Math.round(n*2))%2===1; }
  function defaultMarket(sport) { return sport==="basketball"?"basketball_result":"match_result"; }
  function legTitle(leg,index) { return `第${index+1}腿${leg.home||leg.away?` · ${leg.home||"待绑定主队"} vs ${leg.away||"待绑定客队"}`:" · 尚未绑定比赛"}`; }
  function addBlankLeg() { const sport=$("sport").value==="basketball"?"basketball":"football";legs.push({fixture_id:null,sport,league_code:sport==="basketball"?$("basketballLeague").value:null,home:"",away:"",league_name:null,kickoff:null,market:defaultMarket(sport),selection:"胜",odds:"",handicap:null,line:null});renderLegs(); }

  function updateTotals() {
    const pass=splitPass($("parlayPassType").value),multiples=Number($("parlayMultiples").value||1);
    const modeSizes=pass&&COMBO_SIZES[pass.legs]?.[pass.mode],count=pass&&modeSizes?modeSizes.reduce((sum,size)=>sum+choose(pass.legs,size),0):0;
    const expected=count*2*multiples;
    const entered=Number($("parlayDeclaredTotal").value);
    const combos=pass&&pass.legs===legs.length?combinations(legs.length,modeSizes):[];
    let max=0,oddsReady=combos.length>0;
    if(oddsReady){for(const combo of combos){let product=2;for(const index of combo){const odds=Number(legs[index]?.odds);if(!Number.isFinite(odds)||odds<1){oddsReady=false;break}product*=odds}if(!oddsReady)break;max+=roundTicket(product)*multiples}}
    const warnings=[];
    if(!legs.length)warnings.push("新增比赛腿，逐场设置投注玩法、SP并搜索绑定比赛。");
    else if(!pass||pass.legs!==legs.length)warnings.push(`过关方式要求 ${pass?.legs||"?"} 场，当前有 ${legs.length} 场；请调整比赛腿或过关方式。`);
    else warnings.push(`${count} 个组合 · 应投 ${money(expected)}${entered&&Math.abs(entered-expected)>0.009?` · 票面金额不符（应为 ${money(expected)}）`:""}${oddsReady?` · 最高返奖试算 ${money(max)}`:" · 请补齐各腿SP"}`);
    const payout=Number($("parlayDeclaredPayout").value);
    if(payout&&oddsReady&&Math.abs(payout-max)>0.009)warnings.push(`票面奖金 ${money(payout)} 与当前SP试算 ${money(max)} 不一致，请核对SP、过关方式及倍数。`);
    const sameSport=new Set(legs.filter(leg=>leg.fixture_id).map(leg=>leg.sport||"football")).size<=1;
    if(!sameSport)warnings.push("一张竞彩过关票不能混合足球和篮球比赛。");
    $("parlayCalc").textContent=warnings.join(" ");
    const validLeg=leg=>{
      if(!leg.fixture_id||!Number.isFinite(Number(leg.odds))||Number(leg.odds)<1)return false;
      if((leg.sport||"football")==="basketball"){
        if(!BASKETBALL_MARKETS.includes(leg.market))return false;
        if(leg.market==="basketball_handicap")return validBasketballLine(leg.handicap);
        if(leg.market==="basketball_total")return validBasketballLine(leg.line);
        return true;
      }
      if(!FOOTBALL_MARKETS.includes(leg.market))return false;
      return leg.market!=="handicap"||(Number.isInteger(Number(leg.handicap))&&Math.abs(Number(leg.handicap))<=9);
    };
    const ready=legs.length>=2&&legs.length<=8&&pass&&pass.legs===legs.length&&Number.isInteger(multiples)&&multiples>0&&sameSport&&legs.every(validLeg)&&(!entered||Math.abs(entered-expected)<=0.009);
    $("createParlay").disabled=!ready||submitting;
  }
  function choose(n,k){if(k<0||k>n)return 0;k=Math.min(k,n-k);let out=1;for(let i=1;i<=k;i++)out=out*(n-k+i)/i;return Math.round(out)}

  function renderLegs() {
    const host=$("parlayLegs");host.replaceChildren();
    $("parlayLegCount").textContent=`${legs.length} 场`;
    legs.forEach((leg,index)=>{
      const box=document.createElement("section");box.className="parlay-leg";
      const head=document.createElement("div");head.className="row parlay-leg-head";
      const title=document.createElement("strong");title.textContent=legTitle(leg,index);
      const actions=document.createElement("div");actions.className="actions";
      const bind=document.createElement("button");bind.type="button";bind.className="subtle";bind.textContent=leg.fixture_id?"重新绑定比赛":"搜索并绑定比赛";bind.onclick=()=>{
        bindingIndex=index;$("sport").value=leg.sport||"football";if(leg.sport==="basketball")$("basketballLeague").value=leg.league_code||"nba";core.updateSportInputs?.();const search=$("search");search.value=leg.home||"";$("parlayImportStatus").textContent=`正在为第${index+1}腿查找比赛；选择日期并搜索后，点击对应比赛的“绑定到第${index+1}腿”。`;
        $("fixtureSearch").scrollIntoView({behavior:"smooth",block:"start"});search.focus();
      };
      const remove=document.createElement("button");remove.type="button";remove.className="danger";remove.textContent="删除本腿";remove.onclick=()=>{legs.splice(index,1);if(bindingIndex===index)bindingIndex=null;else if(bindingIndex>index)bindingIndex--;renderLegs()};
      actions.append(bind,remove);head.append(title,actions);box.append(head);
      const matchup=document.createElement("p");matchup.className="notice parlay-match";matchup.textContent=leg.fixture_id?`${leg.home} vs ${leg.away} · ${leg.league_name||"赛事"} · 北京时间 ${core.formatKickoffBeijing(leg.kickoff)}`:"请通过上方比赛搜索绑定真实比赛，文字识别不会自动猜测 fixture。";box.append(matchup);
      const sport=leg.sport||"football",grid=document.createElement("div");grid.className="parlay-leg-fields";
      const availableMarkets=marketOptionsFor(sport);if(!availableMarkets.includes(leg.market)){leg.market=defaultMarket(sport);leg.selection=optionsFor(leg.market)[0]||""}
      const market=select(availableMarkets,leg.market);for(const option of market.options)option.textContent=MARKETS[option.value];market.onchange=()=>{leg.market=market.value;leg.selection=optionsFor(leg.market)[0]||"";leg.handicap=null;leg.line=null;renderLegs()};grid.append(field("玩法",market));
      const selections=optionsFor(leg.market);const selection=select(selections,leg.selection);selection.onchange=()=>{leg.selection=selection.value;updateTotals()};grid.append(field("投注项",selection));
      const odds=input("number",leg.odds,{min:"1",step:"0.001",placeholder:"SP"});odds.oninput=()=>{leg.odds=odds.value;updateTotals()};grid.append(field("SP（票面赔率）",odds));
      if(leg.market==="handicap"){const handicap=input("number",leg.handicap,{min:"-9",max:"9",step:"1"});handicap.oninput=()=>{leg.handicap=Number(handicap.value)};grid.append(field("主队让球",handicap))}
      if(leg.market==="basketball_handicap"){const handicap=input("number",leg.handicap,{step:"0.5",placeholder:"如 -3.5"});handicap.oninput=()=>{leg.handicap=Number(handicap.value);updateTotals()};grid.append(field("主队让分（票面值）",handicap))}
      if(leg.market==="basketball_total"){const line=input("number",leg.line,{step:"0.5",min:"0",placeholder:"如 165.5"});line.oninput=()=>{leg.line=Number(line.value);updateTotals()};grid.append(field("预设总分（票面值）",line))}
      box.append(grid);host.append(box);
    });
    updateTotals();
  }

  function addFixture(item) {
    const targetIndex=bindingIndex!==null?bindingIndex:legs.findIndex(leg=>!leg.fixture_id&&leg.home&&leg.away);
    const identity=fixtureKey(item),sport=item.sport||"football";
    if(legs.some((leg,index)=>leg.fixture_id&&fixtureKey(leg)===identity&&index!==targetIndex)){ $("parlayError").textContent="同一场比赛不能重复添加为多个比赛腿。";return; }
    if(legs.some((leg,index)=>leg.fixture_id&&index!==targetIndex&&(leg.sport||"football")!==sport)){ $("parlayError").textContent="竞彩过关票不能混合足球和篮球比赛，请先删除其他运动项目的比赛腿。";return; }
    const fixture={fixture_id:Number(item.provider_id??item.id),sport,league_code:sport==="basketball"?(item.league_code||"nba"):null,
      home:item.home,away:item.away,league_name:item.league_name||null,kickoff:item.kickoff||null};
    if(targetIndex>=0&&legs[targetIndex]){
      const leg=legs[targetIndex],oldSport=leg.sport||"football";Object.assign(leg,fixture);
      if(oldSport!==sport||!marketOptionsFor(sport).includes(leg.market)){leg.market=defaultMarket(sport);leg.selection=optionsFor(leg.market)[0]||"胜";leg.handicap=null;leg.line=null}
    }else legs.push({...fixture,market:defaultMarket(sport),selection:"胜",odds:"",handicap:null,line:null});
    bindingIndex=null;$("parlayError").textContent="";$("parlayImportStatus").textContent=`已绑定：${item.home} vs ${item.away}。请核对玩法、投注项和SP。`;renderLegs();
  }

  function importText() {
    const parsed=root.MatchMonitorParlayParser.parseParlayText($("parlayText").value);
    if(parsed.passType&&PASS_OPTIONS.has(parsed.passType))$("parlayPassType").value=parsed.passType;
    else if(parsed.passType)parsed.warnings.push(`当前暂不支持 ${parsed.passType}，请在下拉框中选择有效过关方式。`);
    if(parsed.multiples)$("parlayMultiples").value=String(parsed.multiples);
    if(parsed.total!==null)$("parlayDeclaredTotal").value=String(parsed.total);
    if(parsed.payout!==null)$("parlayDeclaredPayout").value=String(parsed.payout);
    legs=parsed.legs.map(leg=>({...leg,fixture_id:null,sport:leg.sport||($("sport").value==="basketball"?"basketball":"football"),league_code:leg.league_code||($("basketballLeague").value||"nba"),handicap:leg.handicap??null,line:leg.line??null}));bindingIndex=null;$("parlayError").textContent="";renderLegs();
    $("parlayImportStatus").textContent=parsed.warnings.length?parsed.warnings.join(" "): `识别到 ${legs.length} 条比赛腿。请逐条搜索并绑定实际比赛，再核对玩法和SP。`;
  }

  async function loadParlays() {
    const host=$("parlayTickets");
    try { const items=await core.req("/api/parlays");host.replaceChildren();for(const item of items)renderTicket(host,item); }
    catch(error){host.textContent="过关票接口尚不可用：请先将独立后台升级到包含过关票监测的版本。原有单场监测继续可用。";host.title=error.message||"";}
  }
  function renderTicket(host,ticket) {
    const box=document.createElement("article");box.className="parlay-ticket";
    const top=document.createElement("div");top.className="row";
    const title=document.createElement("strong");title.textContent=`${ticket.pass_type} · ${ticket.multiples}倍 · ${ticket.combination_count}注`;
    const badge=document.createElement("span");badge.className="pill";badge.textContent=ticket.status_cn;
    top.append(title,badge);box.append(top);
    const totals=document.createElement("p");totals.className="notice";totals.textContent=`总投入 ${money(ticket.total_stake)}${ticket.declared_payout?` · 票面最高奖 ${money(ticket.declared_payout)}${ticket.payout_matches_ticket===false?"（与当前SP不符）":""}`:""} · 已确认返奖 ${money(ticket.payout)} · ${ticket.net===null?`待结算${ticket.max_possible_payout===null?"":`，最高可能返奖 ${money(ticket.max_possible_payout)}`}`:`净利润 ${ticket.net>=0?"+":""}${money(ticket.net)}`}`;box.append(totals);
    for(const leg of ticket.legs||[]){const row=document.createElement("p");row.className="parlay-ticket-leg";const ticketLine=leg.market==="handicap"?`（让球 ${leg.handicap}）`:leg.market==="basketball_handicap"?`（让分 ${Number(leg.handicap)>0?"+":""}${leg.handicap}）`:leg.market==="basketball_total"?`（总分 ${leg.line}）`:"",home=leg.home_cn?`${leg.home_cn} ${leg.home}`:leg.home,away=leg.away_cn?`${leg.away_cn} ${leg.away}`:leg.away;row.append(document.createTextNode(`${leg.league_code?leg.league_code.toUpperCase()+" · ":""}${home} ${leg.score||"VS"} ${away} · ${leg.market_label} ${leg.selection}${ticketLine} · SP ${Number(leg.odds).toFixed(3)} · `));if(leg.state==="won"||leg.state==="lost"){const result=document.createElement("span");result.className=`parlay-result-badge parlay-result-${leg.state}`;result.textContent=leg.status_cn;row.append(result)}else row.append(document.createTextNode(leg.status_cn));box.append(row);
      const activation=document.createElement("p");activation.className="small";activation.textContent=leg.monitor_start_at?`首次激活监测（北京时间）：${core.formatKickoffBeijing(leg.monitor_start_at)}`:"首次激活监测时间：等待后台计划";box.append(activation);
      const matchStatus=String(leg.match_status||"").toLowerCase(),voidStatus=["canc","abd","awd","wo","canceled","abandoned"].some(value=>matchStatus.includes(value));if(leg.state==="review_required"&&voidStatus){const confirmVoid=document.createElement("button");confirmVoid.type="button";confirmVoid.className="subtle";confirmVoid.textContent="确认该场官方无效";confirmVoid.onclick=async()=>{if(!confirm("请先核对官方出票/开奖信息。确定这场按竞彩规则作无效场次处理？"))return;try{await core.req(`/api/parlays/${ticket.id}/legs/${leg.id}/confirm-void`,{method:"POST",body:JSON.stringify({confirmed:true})});await loadParlays()}catch(error){alert(error.message)}};box.append(confirmVoid)}
    }
    const comboTable=document.createElement("div");comboTable.className="parlay-combinations";
    const table=document.createElement("table");table.className="parlay-combo-table";table.innerHTML="<thead><tr><th>过关组合</th><th>状态</th><th>投入</th><th>返奖</th></tr></thead>";
    const body=document.createElement("tbody");for(const combo of ticket.combinations||[]){const tr=document.createElement("tr");for(const value of [`组合 ${combo.number}（${combo.legs.map(item=>item.home).join(" + ")}）`,combo.status_cn,money(combo.stake),combo.payout===null?"待结算":money(combo.payout)]){const td=document.createElement("td");td.textContent=value;tr.append(td)}body.append(tr)}table.append(body);comboTable.append(table);box.append(comboTable);
    const actions=document.createElement("div");actions.className="actions";const stop=document.createElement("button");stop.type="button";stop.className="subtle";stop.textContent="停止过关监测";stop.disabled=["stopped","won","lost"].includes(ticket.status);stop.onclick=async()=>{if(!confirm("停止这张过关票的监测？共享的单场监测任务仍会保留。"))return;try{await core.req(`/api/parlays/${ticket.id}/stop`,{method:"POST"});await loadParlays()}catch(error){alert(error.message)}};const remove=document.createElement("button");remove.type="button";remove.className="danger";remove.textContent="删除过关票";remove.onclick=async()=>{if(!confirm("删除这张过关票记录？比赛监测任务不会删除。"))return;try{await core.req(`/api/parlays/${ticket.id}`,{method:"DELETE"});await loadParlays()}catch(error){alert(error.message)}};actions.append(stop,remove);box.append(actions);host.append(box);
  }

  $("parseParlayText").addEventListener("click",importText);
  $("clearParlayText").addEventListener("click",()=>{$("parlayText").value="";legs=[];bindingIndex=null;$("parlayDeclaredTotal").value="";$("parlayDeclaredPayout").value="";$("parlayMultiples").value="1";$("parlayPassType").value="2串1";$("parlayImportStatus").textContent="已清空票面文字和待核对比赛腿。";renderLegs()});
  $("addParlayLeg").addEventListener("click",addBlankLeg);
  $("createParlay").addEventListener("click",async()=>{
    const pass=splitPass($("parlayPassType").value),multiples=Number($("parlayMultiples").value),total=Number($("parlayDeclaredTotal").value||0);
    try{
      if(!pass||legs.length!==pass.legs)throw Error("过关方式场次数与比赛腿数量必须一致。");
      if(legs.some(leg=>!leg.fixture_id||!Number.isFinite(Number(leg.odds))||Number(leg.odds)<1))throw Error("请为每条比赛腿绑定比赛并填入有效SP。");
      if(new Set(legs.map(leg=>leg.sport||"football")).size!==1)throw Error("一张竞彩过关票不能混合足球和篮球比赛。");
      if(new Set(legs.map(fixtureKey)).size!==legs.length)throw Error("同一场比赛不能重复作为多个比赛腿。");
      if(legs.some(leg=>leg.market==="handicap"&&(!Number.isInteger(Number(leg.handicap))||Math.abs(Number(leg.handicap))>9)))throw Error("让球数必须是 -9 到 9 的整数。");
      if(legs.some(leg=>leg.market==="basketball_handicap"&&!validBasketballLine(leg.handicap)))throw Error("竞彩篮球让分须按票面填写半分值，例如 -3.5。");
      if(legs.some(leg=>leg.market==="basketball_total"&&!validBasketballLine(leg.line)))throw Error("竞彩篮球大小分须按票面填写半分值，例如 165.5。");
      const modeCount=COMBO_SIZES[pass.legs]?.[pass.mode];if(!modeCount)throw Error("暂不支持此过关方式。");
      const comboCount=modeCount.reduce((sum,size)=>sum+choose(pass.legs,size),0),expected=comboCount*2*multiples;
      if(total&&Math.abs(total-expected)>0.009)throw Error(`票面总金额为 ${money(total)}，按当前方式和倍数应为 ${money(expected)}。`);
      submitting=true;updateTotals();$("parlayError").textContent="正在创建过关监测…";
      const result=await core.req("/api/parlays",{method:"POST",body:JSON.stringify({pass_type:$("parlayPassType").value,multiples,unit_stake:2,declared_total:total||expected,declared_payout:Number($("parlayDeclaredPayout").value)||null,legs:legs.map(leg=>({fixture_id:leg.fixture_id,sport:leg.sport||"football",...(leg.sport==="basketball"?{league_code:leg.league_code||"nba"}:{}),market:leg.market,selection:leg.selection,odds:Number(leg.odds),...(["handicap","basketball_handicap"].includes(leg.market)?{handicap:Number(leg.handicap)}:{}),...(leg.market==="basketball_total"?{line:Number(leg.line)}:{})}))})});
      legs=[];bindingIndex=null;$("parlayError").textContent=result.resumed_fixture_ids?.length?`过关票已创建；已恢复 ${result.resumed_fixture_ids.length} 个共用比赛监测任务。`:"过关票已创建，赛果将由对应比赛监测任务自动更新。";renderLegs();await loadParlays();
    }catch(error){$("parlayError").textContent=error.message||String(error)}finally{submitting=false;updateTotals()}
  });
  $("refreshParlays").addEventListener("click",loadParlays);
  for(const id of ["parlayPassType","parlayMultiples","parlayDeclaredTotal","parlayDeclaredPayout"])$(id).addEventListener("input",updateTotals);
  for(const id of ["parlayPassType","parlayMultiples","parlayDeclaredTotal","parlayDeclaredPayout"])$(id).addEventListener("change",updateTotals);
  root.MatchMonitorParlayUI={addFixture,loadParlays,bindLeg(index){bindingIndex=index},get bindLegIndex(){return bindingIndex}};
  renderLegs();loadParlays();setInterval(loadParlays,30000);
})(globalThis);
