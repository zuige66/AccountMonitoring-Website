const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s); let raw, days=7, calCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1), historyTab='closed';
document.body.dataset.view='overview';
initPnlPage();
const money=(n,sign=false)=>`${sign&&n>0?'+':''}${Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})} U`;
const num=n=>Number(n||0).toLocaleString('zh-CN',{maximumFractionDigits:4});
const cls=n=>Number(n)>=0?'positive':'negative';
async function load(){const button=$('#refresh');if(button.disabled)return;button.classList.add('loading');button.disabled=true;button.setAttribute('aria-busy','true');$('#syncText').textContent='正在刷新…';try{const r=await fetch('/api/dashboard',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);raw=d;render();renderForecastMetrics();renderSettlements();renderLiquidationPrices();renderClosedPositions();renderAnalytics();renderCalendar();renderContractPnls();$('#notice').classList.add('hidden')}catch(e){$('#syncText').textContent='刷新失败';$('#notice').textContent=`无法读取数据：${e.message}`;$('#notice').classList.remove('hidden')}finally{button.classList.remove('loading');button.disabled=false;button.removeAttribute('aria-busy')}}
function render(){const p=raw.positions,a=raw.account,unreal=a.unrealised??p.reduce((s,x)=>s+x.unrealisedPnl,0),real=a.realised??0,margin=a.margin??p.reduce((s,x)=>s+x.margin,0),equity=a.equity??a.wallet+unreal;$('#equity').textContent=money(equity);$('#wallet').textContent=money(a.wallet);$('#available').textContent=money(a.available);$('#unrealised').textContent=money(unreal,true);$('#unrealised').className=cls(unreal);$('#realised').textContent=money(real,true);$('#realised').className=cls(real);$('#realisedDetail').textContent='平仓盈亏＋手续费＋资金费';$('#margin').textContent=money(margin);$('#marginRate').textContent=`占资产 ${equity?(margin/equity*100).toFixed(1):0}%`;$('#unrealRoe').textContent=`持仓回报 ${margin?(unreal/margin*100).toFixed(2):0}%`;$('#positionCount').textContent=p.length;$('#mode').textContent=raw.mode==='demo'?'演示数据':'实时数据';$('#syncText').textContent=raw.mode==='demo'?'演示模式':'实时同步';$('#updated').textContent=`最后更新 ${new Date(raw.updatedAt).toLocaleString('zh-CN')}`;$('#positionRows').innerHTML=p.map(x=>`<tr><td><div class="coin"><span class="coin-icon">${x.contract.slice(0,2)}</span>${x.contract.replace('_',' / ')}</div></td><td><span class="side ${x.side}">${x.side==='long'?'做多':'做空'}</span>${x.leverage||'全仓'}×</td><td>${num(Math.abs(x.size))}</td><td>${money(x.entryPrice)}</td><td>${money(x.markPrice)}</td><td class="${cls(x.unrealisedPnl)}"><b>${money(x.unrealisedPnl,true)}</b></td><td class="${cls(x.roe)}"><b>${x.roe>0?'+':''}${x.roe.toFixed(2)}%</b></td><td>${money(x.liqPrice)}</td></tr>`).join('');renderChart();renderRisk(equity,margin);spark()}
function renderForecastMetrics(){
  const available=$('#available'),margin=$('#margin');
  const rawToday=Number(raw.account.todayPnl||0),today=Math.abs(rawToday)<0.005?0:rawToday,series=raw.series||[],cutoff=Date.now()-30*86400000;
  const first=series.findIndex(point=>point.time>=cutoff);
  const sample=first<0?series:series.slice(Math.max(0,first-1));
  const daily=sample.slice(1).map((point,index)=>Number(point.pnl)-Number(sample[index].pnl));
  const average=daily.length?daily.reduce((sum,value)=>sum+value,0)/daily.length:today;
  const capital=Math.abs(Number(raw.account.wallet||raw.account.equity||0));
  const monthly=capital?average*30/capital*100:0;
  const annual=capital?average*365/capital*100:0;
  const realised=Number(raw.account.realised||0);
  const initialCapital=capital-realised;
  const totalRate=initialCapital>0?realised/initialCapital*100:0;
  const todayCard=available.closest('.metric'),forecastCard=margin.closest('.metric');
  todayCard.querySelector('.metric-icon').textContent='↗';
  todayCard.querySelector(':scope > span').textContent='今日收益';
  available.textContent=money(today,true);available.className=cls(today);
  todayCard.querySelector('small').textContent='今日已实现净收益';
  forecastCard.querySelector('.metric-icon').textContent='%';
  forecastCard.classList.add('forecast-toggle');
  forecastCard.tabIndex=0;forecastCard.setAttribute('role','button');
  forecastCard.dataset.monthly=monthly;forecastCard.dataset.annual=annual;forecastCard.dataset.totalRate=totalRate;forecastCard.dataset.sampleDays=daily.length||1;
  if(!forecastCard.dataset.period)forecastCard.dataset.period='month';
  if(!forecastCard.dataset.toggleBound){
    const cycle=['month','annual','total'];
    const toggle=()=>{const idx=cycle.indexOf(forecastCard.dataset.period);forecastCard.dataset.period=cycle[(idx+1)%cycle.length];updateForecastCard(forecastCard)};
    forecastCard.onclick=toggle;
    forecastCard.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle()}};
    forecastCard.dataset.toggleBound='true';
  }
  updateForecastCard(forecastCard);
}
function updateForecastCard(card){
  const period=card.dataset.period,rate=Number(period==='annual'?card.dataset.annual:period==='total'?card.dataset.totalRate:card.dataset.monthly),value=card.querySelector('#margin');
  const labels={month:'预估月收益率',annual:'预估年收益率',total:'当前总收益率'};
  card.querySelector(':scope > span').textContent=labels[period];
  value.textContent=`${rate>0?'+':''}${rate.toFixed(2)}%`;value.className=cls(rate);
  const hints={month:`点击查看年化/总收益预估 · 近 ${card.dataset.sampleDays} 天均值`,annual:`点击查看总收益/月度预估 · 近 ${card.dataset.sampleDays} 天均值`,total:`点击查看月度/年化预估 · 近 ${card.dataset.sampleDays} 天均值`};
  card.querySelector('#marginRate').textContent=hints[period];
  card.setAttribute('aria-label',`${labels[period]} ${rate.toFixed(2)}%，点击切换`);
}
function visible(){const s=raw.series||[];let out;if(days==='all')out=s;else if(days===1)out=raw.intradaySeries||s.slice(-2);else{const cutoff=Date.now()-days*86400000,first=s.findIndex(x=>x.time>=cutoff);out=first<=0?s:s.slice(Math.max(0,first-1))}renderDateAxis(out);return out}
function renderDateAxis(series){const wrap=$('.chart-wrap');let axis=$('#chartDates');if(!axis){axis=document.createElement('div');axis.id='chartDates';axis.className='chart-dates';wrap.insertAdjacentElement('afterend',axis)}if(!series.length){axis.innerHTML='<span>暂无日期数据</span>';return}const count=Math.min(5,series.length),indexes=[...new Set(Array.from({length:count},(_,i)=>Math.round(i*(series.length-1)/Math.max(1,count-1))))];axis.innerHTML=indexes.map(i=>{const d=new Date(series[i].time),sameYear=d.getFullYear()===new Date().getFullYear(),label=sameYear?`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`:`${String(d.getFullYear()).slice(2)}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;return `<span style="left:${i/(series.length-1||1)*100}%">${label}</span>`}).join('')}
function renderChart(){const s=visible(),first=s[0]?.pnl||0,last=s.at(-1)?.pnl||0,change=last-first;const capital=Math.abs(Number(raw.account.wallet||0));$('#periodPnl').textContent=money(change,true);$('#periodPnl').className=cls(change);$('#periodRate').textContent=`${change>=0?'↗':'↘'} ${capital?Math.abs(change/capital*100).toFixed(2):'0.00'}%`;const c=$('#pnlChart'),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1;c.width=rect.width*dpr;c.height=rect.height*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);const w=rect.width,h=rect.height,pad=12,vals=s.map(a=>a.pnl),min=Math.min(...vals,0),max=Math.max(...vals,1),px=i=>pad+i*(w-pad*2)/Math.max(1,s.length-1),py=v=>h-pad-(v-min)/(max-min||1)*(h-pad*2);x.strokeStyle='#ebe8ef';x.lineWidth=1;for(let i=1;i<5;i++){x.beginPath();x.moveTo(0,i*h/5);x.lineTo(w,i*h/5);x.stroke()}const grad=x.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(101,85,143,.25)');grad.addColorStop(1,'rgba(101,85,143,0)');x.beginPath();s.forEach((a,i)=>i?x.lineTo(px(i),py(a.pnl)):x.moveTo(px(i),py(a.pnl)));x.lineTo(px(s.length-1),h);x.lineTo(px(0),h);x.closePath();x.fillStyle=grad;x.fill();x.beginPath();s.forEach((a,i)=>i?x.lineTo(px(i),py(a.pnl)):x.moveTo(px(i),py(a.pnl)));x.strokeStyle='#65558f';x.lineWidth=2.5;x.lineCap='round';x.lineJoin='round';x.stroke();c.onmousemove=e=>{const i=Math.round((e.offsetX-pad)/(w-pad*2)*(s.length-1)),a=s[Math.max(0,Math.min(s.length-1,i))];const t=$('#tooltip');t.style.display='block';t.style.left=`${Math.min(e.offsetX+10,w-110)}px`;t.style.top=`${Math.max(5,e.offsetY-35)}px`;t.textContent=`${new Date(a.time).toLocaleDateString()} · ${money(a.pnl,true)}`};c.onmouseleave=()=>$('#tooltip').style.display='none'}
function renderRisk(equity,margin){const s=raw.series||[],dds=s.map(x=>x.drawdown||0),maxDd=Math.min(...dds,0),daily=s.slice(1).map((x,i)=>x.pnl-s[i].pnl),wins=daily.filter(x=>x>0).length,loss=Math.abs(daily.filter(x=>x<0).reduce((a,b)=>a+b,0)),gain=daily.filter(x=>x>0).reduce((a,b)=>a+b,0),score=Math.min(99,Math.round((margin/(equity||1))*70+Math.abs(maxDd)*3));$('#score').textContent=score;$('#riskRing').style.background=`conic-gradient(${score<35?'#14865a':'#a96817'} 0 ${score}%,#e8e7ec ${score}% 100%)`;$('#maxDd').textContent=`${maxDd.toFixed(2)}%`;$('#maxDd').className='negative';$('#winDays').textContent=`${wins} / ${daily.length} 天`;$('#profitFactor').textContent=loss?(gain/loss).toFixed(2):'—';$('#dayDelta').textContent=`今日 ${money(raw.account.todayPnl||0,true)}`}
function spark(){const s=(raw.series||[]).slice(-10),v=s.map(x=>x.pnl),min=Math.min(...v),max=Math.max(...v),pts=v.map((a,i)=>`${i*100/(v.length-1)},${55-(a-min)/(max-min||1)*45}`).join(' ');$('#spark').innerHTML=`<svg viewBox="0 0 100 60" preserveAspectRatio="none"><polyline fill="none" stroke="white" stroke-width="2" points="${pts}"/></svg>`}
function renderCalendar(){
  if(!raw)return;
  const series=raw.series||[],daily=new Map(),lastPnl=Number(series.at(-1)?.pnl||0);
  const capitalBase=Number(raw.account.wallet||0)-lastPnl;
  for(let index=1;index<series.length;index++){
    const point=series[index],previous=series[index-1],date=new Date(point.time);
    const key=`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const pnl=Number(point.pnl)-Number(previous.pnl),startBalance=capitalBase+Number(previous.pnl);
    const existing=daily.get(key)||{pnl:0,startBalance};
    existing.pnl+=pnl;existing.rate=existing.startBalance?existing.pnl/Math.abs(existing.startBalance)*100:0;
    daily.set(key,existing);
  }
  const y=calCursor.getFullYear(),m=calCursor.getMonth(),daysInMonth=new Date(y,m+1,0).getDate();
  const offset=(new Date(y,m,1).getDay()+6)%7,today=new Date();
  $('.calendar-head p').textContent='每日交易净收益及收益率，包含手续费与资金费';
  $('#calMonth').textContent=`${y}年 ${String(m+1).padStart(2,'0')}月`;
  const cells=Array.from({length:offset},()=>'<div class="calendar-day blank"></div>');
  for(let day=1;day<=daysInMonth;day++){
    const result=daily.get(`${y}-${m}-${day}`),has=result!==undefined,rawValue=result?.pnl||0,value=Math.abs(rawValue)<0.005?0:rawValue;
    const type=!has||value===0?'flat':value>0?'gain':'loss';
    const isToday=y===today.getFullYear()&&m===today.getMonth()&&day===today.getDate();
    const normalizedRate=Math.abs(result?.rate||0)<0.005?0:result.rate;
    const rate=has?`${normalizedRate>0?'+':''}${normalizedRate.toFixed(2)}%`:'';
    cells.push(`<div class="calendar-day ${type}${isToday?' today':''}"><span class="date">${day}</span><div class="calendar-result"><strong>${has?money(value,true):'—'}</strong>${has?`<small class="calendar-rate">${rate}</small>`:''}</div></div>`);
  }
  $('#calendarGrid').innerHTML=cells.join('');
}
function renderSettlements(){const cards=$('#settlementCards'),p=raw.positions||[];if(!p.length){cards.innerHTML='<article class="settlement-card"><h3>当前没有持仓</h3></article>';return}cards.innerHTML=p.map(x=>{const move=(x.markPrice-x.entryPrice)/(x.entryPrice||1)*(x.side==='long'?1:-1)*100,liq=x.liqPrice?Math.abs(x.markPrice-x.liqPrice)/(x.markPrice||1)*100:null,quality=Math.max(4,Math.min(100,50+move*8));return `<article class="settlement-card"><div class="settlement-top"><div class="settlement-symbol"><span class="coin-icon">${x.contract.slice(0,2)}</span><div><h3>${x.contract.replace('_',' / ')}</h3><small><span class="side ${x.side}">${x.side==='long'?'做多':'做空'}</span>${x.leverage||'全仓'}× · ${num(Math.abs(x.size))} 张</small></div></div><div class="settlement-pnl ${cls(x.unrealisedPnl)}"><strong>${money(x.unrealisedPnl,true)}</strong><small>当前预计结算盈亏</small></div></div><div class="settlement-stats"><div class="settlement-stat"><span>仓位价值</span><b>${money(x.value)}</b></div><div class="settlement-stat"><span>初始保证金</span><b>${money(x.initialMargin||x.margin)}</b></div><div class="settlement-stat"><span>强平距离</span><b>${liq==null?'—':liq.toFixed(2)+'%'}</b></div><div class="settlement-stat"><span>开仓价格</span><b>${money(x.entryPrice)}</b></div><div class="settlement-stat"><span>标记价格</span><b>${money(x.markPrice)}</b></div><div class="settlement-stat"><span>持仓回报</span><b class="${cls(x.roe)}">${x.roe>0?'+':''}${x.roe.toFixed(2)}%</b></div></div><div class="quality-bar"><i style="width:${quality}%"></i></div></article>`}).join('')}
function renderContractPnls(){
  const calendar=$('.pnl-calendar');
  if(!calendar)return;
  let section=$('#contractPnlSection');
  if(!section){
    section=document.createElement('section');
    section.id='contractPnlSection';
    section.className='panel contract-pnl-section';
    calendar.insertAdjacentElement('afterend',section);
  }
  const rows=raw.contractPnls||[];
  section.innerHTML=`<div class="contract-pnl-head"><div><h2>币种盈亏</h2><p>按合约币种汇总历史流水与当前未实现盈亏</p></div><span>${rows.length} 个币种</span></div><div class="contract-pnl-grid">${rows.length?rows.map(item=>`<article class="contract-pnl-card"><div class="contract-pnl-top"><div class="contract-symbol"><span class="coin-icon">${item.contract.slice(0,2)}</span><div><h3>${item.contract.replace('_',' / ')}</h3><p>${item.activePositions?`${item.activePositions} 个当前仓位`:'当前无持仓'}</p></div></div><div class="contract-total ${cls(item.totalPnl)}"><span>综合盈亏</span><strong>${money(item.totalPnl,true)}</strong><div class="contract-breakdown"><span>已实现盈亏 <b class="${cls(item.realisedNet)}">${money(item.realisedNet,true)}</b></span><span>浮动盈亏 <b class="${cls(item.unrealised)}">${money(item.unrealised,true)}</b></span></div></div></div><div class="contract-pnl-stats"><div><span>平仓盈亏</span><b class="${cls(item.closePnl)}">${money(item.closePnl,true)}</b></div><div><span>手续费</span><b class="${cls(item.fees)}">${money(item.fees,true)}</b></div><div><span>资金费</span><b class="${cls(item.funding)}">${money(item.funding,true)}</b></div></div></article>`).join(''):'<div class="contract-pnl-empty">暂无币种盈亏数据</div>'}</div>`;
}
function renderLiquidationPrices(){
  const positions=raw.positions||[];
  $$('#settlementCards .settlement-card').forEach((card,index)=>{
    const stat=[...card.querySelectorAll('.settlement-stat')].find(item=>item.querySelector('span')?.textContent==='强平距离');
    if(!stat)return;
    stat.querySelector('span').textContent='强平价格';
    const liqPrice=Number(positions[index]?.liqPrice||0);
    stat.querySelector('b').textContent=liqPrice>0?money(liqPrice):'—';
  });
}
function renderClosedPositions(){
  const closedList=$('#closedPositionList'),openList=$('#openPositionList'),rows=raw.closedPositions||[],openRows=raw.openPositions||[];
  if(!closedList)return;
  closedList.classList.toggle('hidden',historyTab!=='closed');
  openList.classList.toggle('hidden',historyTab!=='opened');
  if(historyTab==='closed'){
    $('#historyCount').textContent=`${rows.length} 条记录`;
    if(!rows.length){closedList.innerHTML='<div class="closed-empty">暂无历史平仓记录</div>';return}
    closedList.innerHTML=rows.map(x=>{
      const hasPnl=x.pnl!==null&&x.pnl!==undefined;
      const time=new Date(x.time).toLocaleString('zh-CN',{hour12:false});
      return `<article class="closed-position-row"><div class="closed-main"><span class="coin-icon">${x.contract.slice(0,2)}</span><div><h3>${x.contract.replace('_',' / ')}</h3><p>${time} · ${x.role==='maker'?'挂单成交':x.role==='taker'?'吃单成交':'混合成交'}</p></div></div><div class="closed-tags"><span class="side ${x.side}">${x.side==='long'?'平多':'平空'}</span><span class="close-status ${x.status}">${x.status==='closed'?'完全平仓':'部分平仓'}</span></div><div class="closed-stat"><span>平仓数量</span><b>${num(x.closedSize)} 张</b></div><div class="closed-stat"><span>平仓均价</span><b>${money(x.closePrice)}</b></div><div class="closed-stat"><span>平仓盈亏</span><b class="${hasPnl?cls(x.pnl):''}">${hasPnl?money(x.pnl,true):'—'}</b></div><div class="closed-stat"><span>手续费</span><b class="negative">${money(x.fee)}</b></div><div class="closed-stat net"><span>扣费后盈亏</span><b class="${hasPnl?cls(x.netPnl):''}">${hasPnl?money(x.netPnl,true):'—'}</b></div></article>`
    }).join('')
  }else{
    $('#historyCount').textContent=`${openRows.length} 条记录`;
    if(!openRows.length){openList.innerHTML='<div class="closed-empty">暂无历史开仓记录</div>';return}
    openList.innerHTML=openRows.map(x=>{
      const time=new Date(x.time).toLocaleString('zh-CN',{hour12:false});
      return `<article class="closed-position-row"><div class="closed-main"><span class="coin-icon">${x.contract.slice(0,2)}</span><div><h3>${x.contract.replace('_',' / ')}</h3><p>${time} · ${x.role==='maker'?'挂单成交':x.role==='taker'?'吃单成交':'混合成交'}</p></div></div><div class="closed-tags"><span class="side ${x.side}">${x.side==='long'?'做多':'做空'}</span>${x.leverage?`<span class="close-status opened">${x.leverage}×</span>`:''}<span class="close-status opened">开仓</span></div><div class="closed-stat"><span>开仓数量</span><b>${num(x.openedSize)} 张</b></div><div class="closed-stat"><span>开仓均价</span><b>${money(x.openPrice)}</b></div><div class="closed-stat"><span>保证金</span><b>${x.margin!=null?money(x.margin):'—'}</b></div><div class="closed-stat"><span>手续费</span><b class="negative">${money(x.fee)}</b></div></article>`
    }).join('')
  }
}
function renderAnalytics(){const p=raw.positions||[],s=raw.series||[],daily=s.slice(1).map((x,i)=>x.pnl-s[i].pnl),wins=daily.filter(x=>x>0).length,winRate=daily.length?wins/daily.length*100:0,gross=p.reduce((a,x)=>a+Math.abs(x.value),0),net=p.reduce((a,x)=>a+(x.side==='long'?x.value:-x.value),0),exposure=gross?net/gross*100:0,moves=p.map(x=>(x.markPrice-x.entryPrice)/(x.entryPrice||1)*(x.side==='long'?1:-1)*100),avgMove=moves.length?moves.reduce((a,b)=>a+b,0)/moves.length:0,dd=Math.min(0,...s.map(x=>x.drawdown||0)),contracts=[...new Set(p.map(x=>x.contract))],hedged=contracts.some(c=>p.some(x=>x.contract===c&&x.side==='long')&&p.some(x=>x.contract===c&&x.side==='short')),positive=(raw.account.realised||0)>=0,score=Math.max(0,Math.min(100,Math.round(55+(positive?12:-12)+(avgMove>0?10:-8)+(Math.abs(exposure)<35?10:0)-Math.abs(dd)*2))),grade=score>=80?'A':score>=65?'B':score>=50?'C':'D',bias=Math.abs(exposure)<15?'接近市场中性':exposure>0?'净多头暴露':'净空头暴露';$('#analysisHero').innerHTML=`<div class="analysis-grade">${grade}</div><div><h3>${hedged?'对冲型量化结构':'方向型量化结构'} · ${bias}</h3><p>${hedged?'当前同一合约同时持有多空方向，能够降低单边行情暴露，但要确认双边手续费与资金费不会持续侵蚀策略优势。':'当前仓位主要依赖单边方向判断，策略表现会更直接地受到趋势和入场时机影响。'} 当前逐笔流水累计净收益为 ${money(raw.account.realised,true)}。</p></div><div class="analysis-score"><strong>${score}</strong><small>综合策略评分</small></div>`;const entryText=avgMove>0?`平均入场后有利移动 ${avgMove.toFixed(2)}%，当前进场位置整体有效。可以继续观察盈利仓位是否按照预设规则退出，避免回吐。`:`平均入场后不利移动 ${Math.abs(avgMove).toFixed(2)}%，当前入场位置偏早或信号确认不足。建议检查触发信号与实际成交之间的延迟。`,hedgeText=hedged?`当前多空净暴露为 ${exposure.toFixed(1)}%，对冲程度较高。若这是网格或双向策略，需要重点监控双边总手续费和资金费。`:`当前净暴露为 ${exposure.toFixed(1)}%，方向集中度较高。单边信号失效时，账户回撤可能放大。`,sampleText=daily.length<10?`目前仅有 ${daily.length} 个交易日样本，胜率和回撤尚不足以稳定评价策略，建议至少积累 20—30 个交易日再比较参数。`:`已有 ${daily.length} 个交易日样本，可开始按周比较收益稳定性和参数漂移。`;$('#analysisCards').innerHTML=`<article class="analysis-card"><span class="tag">ENTRY</span><h3>进场位置</h3><p>${entryText}</p><div class="analysis-number ${cls(avgMove)}">${avgMove>0?'+':''}${avgMove.toFixed(2)}%</div></article><article class="analysis-card"><span class="tag">EXPOSURE</span><h3>多空结构</h3><p>${hedgeText}</p><div class="analysis-number">${money(gross)}</div><p>当前总名义仓位</p></article><article class="analysis-card"><span class="tag">PERFORMANCE</span><h3>收益稳定性</h3><p>${sampleText}</p><div class="analysis-number ${cls(raw.account.realised)}">${winRate.toFixed(0)}%</div><p>盈利日占比 · ${wins}/${daily.length} 天</p></article><article class="analysis-card"><span class="tag">RISK</span><h3>回撤与风险</h3><p>历史可查询区间最大回撤为 ${dd.toFixed(2)}%。${Math.abs(dd)<5?'当前回撤温和，但仍需为极端行情设置硬性风险上限。':'回撤已经较明显，建议复核仓位上限和连续亏损后的降频机制。'}</p><div class="analysis-number ${dd<0?'negative':''}">${dd.toFixed(2)}%</div></article>`}
function initPnlPage(){
  const overviewNav=$('.nav[data-view="overview"]');
  if(!overviewNav||$('.nav[data-view="pnl"]'))return;
  const nav=document.createElement('button');
  nav.className='nav';nav.dataset.view='pnl';nav.innerHTML='<span>↗</span><em>盈亏</em>';
  overviewNav.insertAdjacentElement('afterend',nav);
  const overview=$('.page-view[data-page="overview"]'),calendar=$('.pnl-calendar');
  const page=document.createElement('section');
  page.className='page-view hidden pnl-page';page.dataset.page='pnl';
  if(calendar)page.appendChild(calendar);
  overview.insertAdjacentElement('afterend',page);
}
function switchPage(view){document.body.dataset.view=view;$$('.page-view').forEach(x=>x.classList.toggle('hidden',x.dataset.page!==view));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$('#pageTitle').textContent={overview:'资产总览',pnl:'盈亏分析',positions:'仓位结算',analytics:'策略分析'}[view];window.scrollTo(0,0);if(view==='overview'&&raw)setTimeout(renderChart,20);if(view==='pnl'&&raw){renderCalendar();renderContractPnls()}}
function initRail(){const rail=$('.rail'),saved=Number(localStorage.getItem('gateRailWidth')||220);document.documentElement.style.setProperty('--rail-width',`${Math.max(180,Math.min(380,saved))}px`);$('#railToggle').onclick=()=>{rail.classList.toggle('collapsed');document.documentElement.style.setProperty('--rail-width',rail.classList.contains('collapsed')?'76px':`${Number(localStorage.getItem('gateRailWidth')||220)}px`)};$('#railResize').onmousedown=e=>{e.preventDefault();rail.classList.add('resizing');document.body.classList.add('dragging');const move=ev=>{const w=Math.max(180,Math.min(380,ev.clientX));document.documentElement.style.setProperty('--rail-width',`${w}px`);localStorage.setItem('gateRailWidth',w)};const up=()=>{rail.classList.remove('resizing');document.body.classList.remove('dragging');removeEventListener('mousemove',move);removeEventListener('mouseup',up)};addEventListener('mousemove',move);addEventListener('mouseup',up)}}
$$('.seg button').forEach(b=>b.onclick=()=>{$$('.seg button').forEach(x=>x.classList.remove('active'));b.classList.add('active');days=b.dataset.days==='all'?'all':+b.dataset.days;renderChart()});$$('.nav').forEach(b=>b.onclick=()=>switchPage(b.dataset.view));$$('.history-tab').forEach(b=>b.onclick=()=>{$$('.history-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');historyTab=b.dataset.history;renderClosedPositions()});$('.text-btn').onclick=()=>switchPage('positions');$('#calPrev').onclick=()=>{calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()-1,1);renderCalendar()};$('#calNext').onclick=()=>{calCursor=new Date(calCursor.getFullYear(),calCursor.getMonth()+1,1);renderCalendar()};$('#refresh').onclick=load;addEventListener('resize',()=>raw&&!$('[data-page="overview"]').classList.contains('hidden')&&renderChart());initRail();load();setInterval(load,60000);
