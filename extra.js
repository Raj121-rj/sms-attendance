// v2 routes: leave/half-day, corrections, overrides, holidays, summary, records/CSV
module.exports=(app,{q,auth,bad,audit,note,NOW,cfg,h12,pool})=>{
const LG=require('./logic');
const D=/^\d{4}-\d{2}-\d{2}$/,mins=s=>+s.slice(0,2)*60+ +s.slice(3,5),
days=(a,b)=>{const r=[];for(let d=new Date(a+'T00:00:00Z'),e=new Date(b+'T00:00:00Z');d<=e;d.setUTCDate(d.getUTCDate()+1))r.push(d.toISOString().slice(0,10));return r},
hol=async()=>new Map((await q("SELECT to_char(date,'YYYY-MM-DD') d,working FROM holidays")).rows.map(r=>[r.d,r.working])),
off=(d,H)=>H.has(d)?!H.get(d):new Date(d+'T00:00:00Z').getUTCDay()===0,
txt=(v,n)=>String(v||'').trim().slice(0,n);

app.get('/api/summary',auth('teacher'),async(req,res)=>{kick();
 const{rows:[n]}=await q(NOW),id=req.u.id,S=await cfg(),m=n.d.slice(0,7),pd=new Date(m+'-01T00:00:00Z');pd.setUTCMonth(pd.getUTCMonth()-1);
 const mo=async x=>{const to=LG.addDays(LG.addDays(x+'-01',32).slice(0,8)+'01',-1);return LG.summarize(x+'-01',to,{...await data(id,x+'-01',to),today:n.d})},cur=await mo(m),prv=await mo(pd.toISOString().slice(0,7));
 res.json({ontime:cur.ontime,late:cur.late,absent:cur.absent,outmiss:cur.outmiss,half:cur.half,full:cur.leave_days,total_leave:cur.leave_total,late_total:cur.late_total,late_fmt:LG.fmtMin(cur.late_total),prev_ontime:prv.ontime,hm:n.hm,end:S.end,cut:h12(S.present_until),
  leaves:(await q("SELECT to_char(from_date,'YYYY-MM-DD') f,to_char(to_date,'YYYY-MM-DD') t,kind,status FROM leaves WHERE user_id=$1 ORDER BY id DESC LIMIT 8",[id])).rows,
  corr:(await q("SELECT to_char(date,'YYYY-MM-DD') d,status FROM corrections WHERE user_id=$1 ORDER BY id DESC LIMIT 8",[id])).rows,
  notes:(await q('SELECT msg FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 5',[id])).rows})});

app.post('/api/leave',auth('teacher'),async(req,res)=>{const B=req.body||{},t=B.to||B.from;
 if(!D.test(B.from)||!D.test(t)||t<B.from||!['full','half'].includes(B.kind)||!txt(B.reason,200)||(B.kind==='half'&&t!==B.from))return bad(res,'कृपया तारीख, प्रकार और कारण सही भरें (आधा दिन केवल एक तारीख का होता है)।');
 await q('INSERT INTO leaves(user_id,from_date,to_date,kind,reason,note) VALUES($1,$2,$3,$4,$5,$6)',[req.u.id,B.from,t,B.kind,txt(B.reason,200),txt(B.note,200)]);
 await note(`${req.u.name} ने ${B.kind==='half'?'आधे दिन':'छुट्टी'} का अनुरोध भेजा (${B.from}).`,req.u.id,'LEAVE_REQUESTED');res.json({ok:1})});
app.post('/api/correction',auth('teacher'),async(req,res)=>{const B=req.body||{};
 if(!D.test(B.date)||!txt(B.reason,300))return bad(res,'कृपया तारीख और कारण भरें।');
 await q('INSERT INTO corrections(user_id,date,reason) VALUES($1,$2,$3)',[req.u.id,B.date,txt(B.reason,300)]);
 await note(`${req.u.name} का उपस्थिति सुधार अनुरोध (${B.date}).`,req.u.id,'CORRECTION_REQUESTED');res.json({ok:1})});

app.get('/api/admin/requests',auth('admin'),async(req,res)=>res.json({
 leaves:(await q("SELECT l.id,u.name,to_char(l.from_date,'YYYY-MM-DD') f,to_char(l.to_date,'YYYY-MM-DD') t,l.kind,l.reason,l.note FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.status='Pending' ORDER BY l.id")).rows,
 corr:(await q("SELECT c.id,u.name,to_char(c.date,'YYYY-MM-DD') d,c.reason FROM corrections c JOIN users u ON u.id=c.user_id WHERE c.status='Pending' ORDER BY c.id")).rows}));
app.post('/api/admin/decide',auth('admin'),async(req,res)=>{const{type,id,ok}=req.body||{},tb=type==='leave'?'leaves':type==='corr'?'corrections':null;
 if(!tb||!Number.isInteger(id))return bad(res,'अमान्य अनुरोध।');
 const r=await q(`UPDATE ${tb} SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1 AND status='Pending' RETURNING user_id`,[id,ok?'Approved':'Rejected',req.u.id]);
 if(!r.rowCount)return bad(res,'यह अनुरोध पहले ही निपटाया जा चुका है।',409);
 await q('INSERT INTO notifications(msg,user_id) VALUES($1,$2)',[`आपका ${type==='leave'?'छुट्टी':'सुधार'} अनुरोध ${ok?'स्वीकृत':'अस्वीकृत'} हुआ।`,r.rows[0].user_id]);
 await audit(req.u.id,(type==='leave'?'LEAVE_':'CORRECTION_')+(ok?'APPROVED':'REJECTED'),'id '+id);res.json({ok:1})});
app.post('/api/admin/leave',auth('admin'),async(req,res)=>{const B=req.body||{},t=B.to||B.from;
 if(!Number.isInteger(B.user_id)||!D.test(B.from)||!D.test(t)||t<B.from||!['full','half'].includes(B.kind)||!txt(B.reason,200)||(B.kind==='half'&&t!==B.from))return bad(res,'कृपया सभी जानकारी सही भरें।');
 await q("INSERT INTO leaves(user_id,from_date,to_date,kind,reason,status,decided_by,decided_at) VALUES($1,$2,$3,$4,$5,'Approved',$6,now())",[B.user_id,B.from,t,B.kind,txt(B.reason,200),req.u.id]);
 await audit(req.u.id,'LEAVE_ADDED_BY_ADMIN',`${B.user_id} ${B.from} ${B.kind}`);res.json({ok:1})});

// Manual override: original + changed values + reason + admin are stored in attendance_changes (nothing is silently overwritten)
app.post('/api/admin/override',auth('admin'),async(req,res)=>{const B=req.body||{},R=/^([01]\d|2[0-3]):[0-5]\d$/,why=txt(B.reason,300);
 if(!Number.isInteger(B.user_id)||!D.test(B.date)||!why||!['On Time','Late','Absent'].includes(B.status)||(B.in&&!R.test(B.in))||(B.out&&!R.test(B.out)))return bad(res,'कृपया तारीख, स्थिति, समय (HH:MM) और कारण सही भरें।');
 const S=await cfg(),ts=async hm=>hm?(await q("SELECT (($1::date+$2::time) AT TIME ZONE 'Asia/Kolkata') t",[B.date,hm])).rows[0].t:null,
 old=(await q('SELECT id,in_time,out_time,status,late_min,half_reason FROM attendance WHERE user_id=$1 AND date=$2::date',[B.user_id,B.date])).rows[0]||null,
 inT=await ts(B.in),outT=await ts(B.out),late=B.status==='Late'&&B.in?Math.max(0,mins(B.in)-mins(S.present_until)):null;
 const nw=(await q(`INSERT INTO attendance(user_id,date,in_time,out_time,status,late_min) VALUES($1,$2::date,$3,$4,$5::text,$6::int) ON CONFLICT(user_id,date) DO UPDATE SET in_time=CASE WHEN $5::text='Absent' THEN NULL ELSE COALESCE($3,attendance.in_time) END,out_time=CASE WHEN $5::text='Absent' THEN NULL ELSE COALESCE($4,attendance.out_time) END,status=$5::text,late_min=$6::int,half_reason=NULL,updated_at=now() RETURNING id,in_time,out_time,status,late_min,half_reason`,[B.user_id,B.date,inT,outT,B.status,late])).rows[0];
 await q('INSERT INTO attendance_changes(attendance_id,user_id,date,original,changed,reason,admin_id) VALUES($1,$2,$3::date,$4,$5,$6,$7)',[nw.id,B.user_id,B.date,JSON.stringify(old),JSON.stringify(nw),why,req.u.id]);
 await audit(req.u.id,'ATTENDANCE_OVERRIDE',`${B.user_id} ${B.date}: ${why}`);res.json({ok:1})});

app.get('/api/admin/holidays',auth('admin'),async(req,res)=>res.json((await q("SELECT to_char(date,'YYYY-MM-DD') d,name,working FROM holidays ORDER BY date DESC LIMIT 60")).rows));
app.post('/api/admin/holidays',auth('admin'),async(req,res)=>{const B=req.body||{};
 if(!D.test(B.d)||(!B.del&&!txt(B.name,80)))return bad(res,'कृपया तारीख और नाम भरें।');
 if(B.del)await q('DELETE FROM holidays WHERE date=$1::date',[B.d]);else await q('INSERT INTO holidays VALUES($1::date,$2,$3) ON CONFLICT(date) DO UPDATE SET name=$2,working=$3',[B.d,txt(B.name,80),!!B.working]);
 await audit(req.u.id,'CALENDAR_CHANGED',B.d);res.json({ok:1})});

app.get('/api/admin/today',auth('admin'),async(req,res)=>{await kick();const{rows:[n]}=await q(NOW),S=await cfg(),o=off(n.d,await hol());
 const rows=(await q(`SELECT u.id,u.name,a.in_time,a.out_time,a.status,a.late_min,a.half_reason,EXISTS(SELECT 1 FROM leaves l WHERE l.user_id=u.id AND l.status='Approved' AND l.kind='full' AND $1::date BETWEEN l.from_date AND l.to_date) leave,EXISTS(SELECT 1 FROM leaves l WHERE l.user_id=u.id AND l.status='Approved' AND l.kind='half' AND l.from_date=$1::date) half FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date=$1::date WHERE u.role='teacher' AND u.active ORDER BY u.name`,[n.d])).rows;
 rows.forEach(r=>{r.outmiss=!!r.in_time&&!r.out_time&&n.hm>S.end;r.notmarked=!r.status&&!r.leave&&!r.half&&!o});
 res.json({d:n.d,off:o,fin:await finState(n,S),rows,notes:(await q('SELECT msg FROM notifications WHERE user_id IS NULL ORDER BY id DESC LIMIT 15')).rows})});

app.get('/api/admin/records',auth('admin'),async(req,res)=>{const{from,to,user,fmt}=req.query,u=user?+user:null;
 if(!D.test(from)||!D.test(to))return bad(res,'तारीख सही नहीं है।');
 const rows=(await q(`SELECT to_char(a.date,'YYYY-MM-DD') d,u.name,a.in_time,a.out_time,a.status,a.late_min,a.half_reason,a.user_id uid FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date BETWEEN $1::date AND $2::date AND ($3::int IS NULL OR u.id=$3::int) ORDER BY a.date DESC,u.name`,[from,to,u])).rows,
 leaves=(await q(`SELECT l.user_id uid,u.name,to_char(l.from_date,'YYYY-MM-DD') f,to_char(l.to_date,'YYYY-MM-DD') t,l.kind,l.reason FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.status='Approved' AND l.from_date<=$2::date AND l.to_date>=$1::date AND ($3::int IS NULL OR u.id=$3::int) ORDER BY l.from_date DESC`,[from,to,u])).rows;
 const{rows:[nw]}=await q(NOW),HH=await hol(),ids=new Set(rows.map(r=>r.uid).concat(leaves.map(l=>l.uid)));
 if(u)ids.add(u);else(await q("SELECT id FROM users WHERE role='teacher' AND active")).rows.forEach(r=>ids.add(r.id));
 const nm=new Map((await q('SELECT id,name FROM users WHERE id=ANY($1::int[])',[[...ids]])).rows.map(r=>[r.id,r.name])),
 sums=[...ids].map(id=>{const c={today:nw.d,H:HH,att:new Map(rows.filter(r=>r.uid===id).map(r=>[r.d,{status:r.status,in:r.in_time,out:r.out_time,late:r.late_min,reason:r.half_reason}])),full:new Set(),half:new Set()};
  for(const l of leaves.filter(l=>l.uid===id))for(const d of LG.range(l.f,l.t))if(d>=from&&d<=to&&!LG.isOff(d,HH))(l.kind==='half'?c.half:c.full).add(d);
  const s=LG.summarize(from,to,c);return{uid:id,name:nm.get(id)||'',...s,late_fmt:LG.fmtMin(s.late_total)}}).sort((a,b)=>a.name.localeCompare(b.name));
 
if(fmt==='pdf')return require('./pdf')(res,{rows,leaves,sums,from,to,who:u?(await q('SELECT name FROM users WHERE id=$1',[u])).rows[0]?.name:'',school:(await cfg()).school_name}).catch(e=>{console.error(e);bad(res,'PDF नहीं बन सका। कृपया दोबारा प्रयास करें या Admin से संपर्क करें।',500)});
 if(fmt!=='csv')return res.json({rows,leaves,sums});
 res.type('text/csv').attachment(`attendance-${from}_${to}.csv`).send(LG.csvText(rows,leaves,sums))});
// ---- v3: calendar, streak, sessions (rules live in logic.js) ----
const data=async(uid,from,to)=>{const H=await hol(),att=new Map((await q("SELECT to_char(date,'YYYY-MM-DD') d,status,in_time,out_time,late_min,half_reason FROM attendance WHERE user_id=$1 AND date BETWEEN $2::date AND $3::date",[uid,from,to])).rows.map(r=>[r.d,{status:r.status,in:r.in_time,out:r.out_time,late:r.late_min,reason:r.half_reason}])),full=new Set(),half=new Set();
 for(const l of(await q("SELECT kind,to_char(from_date,'YYYY-MM-DD') f,to_char(to_date,'YYYY-MM-DD') t FROM leaves WHERE user_id=$1 AND status='Approved' AND from_date<=$3::date AND to_date>=$2::date",[uid,from,to])).rows)
  for(const d of LG.range(l.f,l.t))if(d>=from&&d<=to&&!LG.isOff(d,H))(l.kind==='half'?half:full).add(d);
 return{H,att,full,half}};
app.get('/api/streak',auth('teacher'),async(req,res)=>{const{rows:[n]}=await q(NOW),s=(await q("SELECT to_char(start_date,'YYYY-MM-DD') s FROM sessions WHERE active").catch(()=>({rows:[]}))).rows[0]?.s,from=s&&s<=n.d?s:LG.addDays(n.d,-365);
 res.json(LG.streaks(from,n.d,{...await data(req.u.id,from,n.d),today:n.d}))});
const cal=async(uid,m)=>{if(!/^\d{4}-\d{2}$/.test(m||''))return null;
 const{rows:[n]}=await q(NOW),from=m+'-01',last=LG.addDays(LG.addDays(from,32).slice(0,8)+'01',-1),c={...await data(uid,from,last),today:n.d},
 hn=new Map((await q("SELECT to_char(date,'YYYY-MM-DD') d,name FROM holidays WHERE to_char(date,'YYYY-MM')=$1",[m])).rows.map(r=>[r.d,r.name])),
 ch=new Set((await q("SELECT DISTINCT to_char(date,'YYYY-MM-DD') d FROM attendance_changes WHERE user_id=$1 AND to_char(date,'YYYY-MM')=$2",[uid,m])).rows.map(r=>r.d));
 const days=LG.range(from,last).map(d=>{const a=c.att.get(d),code=LG.dayCode(d,c),rm=[];
  if(code==='off')rm.push(hn.get(d)?'अवकाश: '+hn.get(d):'रविवार');if(code==='outmiss')rm.push('OUT दर्ज नहीं');if(code==='half'&&a&&a.reason)rm.push(LG.reasonLabel(a.reason));if(ch.has(d))rm.push('Admin द्वारा सुधारा गया');
  return{d,code,in:a?.in||null,out:a?.out||null,late:a?.late||0,leave:c.full.has(d)?'full':c.half.has(d)?'half':null,remark:rm.join(' · ')}});
 const full=days.filter(x=>x.code==='leave').length,half=days.filter(x=>x.code==='half').length;
 return{month:m,days,full,half,total_leave:full+LG.halfToLeave(half)}};
app.get('/api/calendar',auth('teacher'),async(req,res)=>{const r=await cal(req.u.id,req.query.month);r?res.json(r):bad(res,'महीना सही नहीं है।')}); // staff: own data only
app.get('/api/admin/calendar',auth('admin'),async(req,res)=>{const u=+req.query.user,r=u>0?await cal(u,req.query.month):null;r?res.json(r):bad(res,'स्टाफ या महीना सही नहीं है।')});
app.get('/api/admin/sessions',auth('admin'),async(req,res)=>res.json((await q(`SELECT id,name,to_char(start_date,'YYYY-MM-DD') start,to_char(end_date,'YYYY-MM-DD') "end",active FROM sessions ORDER BY start_date`)).rows));
app.post('/api/admin/sessions',auth('admin'),async(req,res)=>{const B=req.body||{},name=txt(B.name,20);
 if(!name||!D.test(B.start)||!D.test(B.end)||B.end<=B.start)return bad(res,'सत्र का नाम और सही शुरू/अंतिम तारीख भरें।');
 if((await q('SELECT 1 FROM sessions WHERE start_date<=$2::date AND end_date>=$1::date',[B.start,B.end])).rowCount)return bad(res,'ये तारीखें किसी मौजूदा सत्र से मिलती हैं।',409);
 const r=await q('INSERT INTO sessions(name,start_date,end_date) VALUES($1,$2,$3) RETURNING id',[name,B.start,B.end]);
 await q('UPDATE attendance SET session_id=$1 WHERE session_id IS NULL AND date BETWEEN $2::date AND $3::date',[r.rows[0].id,B.start,B.end]);
 await audit(req.u.id,'SESSION_CREATED',name);res.json({ok:1})});
app.post('/api/admin/sessions/activate',auth('admin'),async(req,res)=>{const id=(req.body||{}).id;if(!Number.isInteger(id))return bad(res,'अमान्य अनुरोध।');
 if(!(await q('SELECT 1 FROM sessions WHERE id=$1',[id])).rowCount)return bad(res,'सत्र नहीं मिला।',404);
 await q('UPDATE sessions SET active=false WHERE active');await q('UPDATE sessions SET active=true WHERE id=$1',[id]);await audit(req.u.id,'SESSION_ACTIVATED','id '+id);res.json({ok:1})});
// ---- v4: automatic absent + permanent delete ----
// Finalization is idempotent: finalizations.date is a primary key, so a date can only be finalized once (a second run does nothing).
const finalize=async(date,source)=>{const c=await pool.connect();
 try{await c.query('BEGIN');
  const g=await c.query('INSERT INTO finalizations(date,source) VALUES($1::date,$2) ON CONFLICT(date) DO NOTHING RETURNING date',[date,source]);
  if(!g.rowCount){await c.query('ROLLBACK');return{date,already:true}}
  const ids=LG.toAbsent(date,{H:await hol(),staff:(await c.query("SELECT id FROM users WHERE role='teacher' AND active")).rows,
   hasAtt:new Set((await c.query('SELECT user_id FROM attendance WHERE date=$1::date',[date])).rows.map(r=>r.user_id)),
   onLeave:new Set((await c.query("SELECT user_id FROM leaves WHERE status='Approved' AND $1::date BETWEEN from_date AND to_date",[date])).rows.map(r=>r.user_id))});
  if(ids.length)await c.query("INSERT INTO attendance(user_id,date,status) SELECT unnest($1::int[]),$2::date,'Absent' ON CONFLICT(user_id,date) DO NOTHING",[ids,date]);
  await c.query('UPDATE finalizations SET marked=$2 WHERE date=$1::date',[date,ids.length]);await c.query('COMMIT');
  await note(`${date.split('-').reverse().join('/')}: अनुपस्थिति प्रक्रिया पूर्ण, ${ids.length} स्टाफ अनुपस्थित दर्ज।`,null,'AUTO_ABSENT');return{date,marked:ids.length}}
 catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}};
let lastKick=0,busyK=false;
const kick=async force=>{if(busyK||(!force&&Date.now()-lastKick<30000))return[];busyK=true;lastKick=Date.now();
 try{const{rows:[n]}=await q(NOW),S=await cfg(),dd=LG.dueDates(n.d,n.hm,S.end,S.auto_absent_from||n.d);if(!dd.length)return[];
  const done=new Set((await q("SELECT to_char(date,'YYYY-MM-DD') d FROM finalizations WHERE date>=$1::date",[dd[0]])).rows.map(r=>r.d)),out=[];
  for(const d of dd)if(!done.has(d))out.push(await finalize(d,force?'cron':'auto'));return out}
 catch(e){console.error('auto-absent failed:',e.message);return[]}finally{busyK=false}};
// Triggers: (1) external scheduler -> POST /api/cron/finalize, (2) any staff/admin dashboard load after closing, (3) in-process timer 12:00-17:59 IST while the server is awake
setInterval(()=>{const h=+new Date().toLocaleString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hour12:false});if(h>=12&&h<=17)kick()},120000);
const finState=async(n,S)=>{try{const t=(await q("SELECT ran_at,source,marked FROM finalizations WHERE date=$1::date",[n.d])).rows[0],l=(await q('SELECT ran_at,source FROM finalizations ORDER BY ran_at DESC LIMIT 1')).rows[0];
 return{done:!!t,today:t||null,last:l||null,due:n.hm>=S.end,off:off(n.d,await hol()),end:S.end}}catch{return null}};
app.post('/api/cron/finalize',async(req,res)=>{const k=Buffer.from(process.env.CRON_SECRET||''),h=Buffer.from(String(req.headers['x-cron-secret']||''));
 if(k.length<16)return bad(res,'CRON_SECRET is not configured.',503);
 if(k.length!==h.length||!require('crypto').timingSafeEqual(k,h))return bad(res,'Forbidden.',403);
 res.json({ok:1,results:await kick(true)})});
app.post('/api/admin/finalize',auth('admin'),async(req,res)=>{const{rows:[n]}=await q(NOW),S=await cfg(),d=(req.body||{}).date||n.d;
 if(!D.test(d)||d>n.d||d<LG.addDays(n.d,-31))return bad(res,'तारीख सही नहीं है (पिछले 31 दिन तक)।');
 if(d===n.d&&n.hm<S.end)return bad(res,'आज की प्रक्रिया विद्यालय बंद होने के समय के बाद ही चल सकती है।');
 const r=await finalize(d,'admin');await audit(req.u.id,'FINALIZE_RUN',d);res.json(r)});
// Permanent delete = erase login + profile; history stays under an anonymous placeholder so no record is orphaned. Archived teachers only.
app.post('/api/admin/staff/:id/delete',auth('admin'),async(req,res)=>{const id=+req.params.id;
 if((req.body||{}).confirm!=='DELETE')return bad(res,'पुष्टि के लिए DELETE लिखना आवश्यक है।');
 const u=(await q('SELECT id,name,role,active,staff_code FROM users WHERE id=$1',[id])).rows[0];
 if(!u||u.staff_code.startsWith('DELETED-'))return bad(res,'स्टाफ नहीं मिला।',404);
 if(u.role!=='teacher'||id===req.u.id)return bad(res,'इस खाते को हटाया नहीं जा सकता।',403);
 if(u.active)return bad(res,'पहले स्टाफ को संग्रहीत (Archive) करें, फिर स्थायी रूप से हटाएँ।',409);
 await q(`WITH d AS (DELETE FROM notifications WHERE user_id=$1 OR (user_id IS NULL AND starts_with(msg,$3::text))) UPDATE users SET name=$2,staff_code='DELETED-'||id,username='deleted-'||id,mobile=NULL,password_hash='!',active=false,must_change=true WHERE id=$1`,[id,'हटाया गया स्टाफ #'+id,u.name+' ']);
 await audit(req.u.id,'STAFF_DELETED','id '+id);res.json({ok:1})});
// ---- v5: staff date-range summary (own data only) ----
app.get('/api/my/range',auth('teacher'),async(req,res)=>{const{from,to}=req.query;
 if(!D.test(from||'')||!D.test(to||'')||to<from||to>LG.addDays(from,400))return bad(res,'तारीख सही नहीं है (अधिकतम 400 दिन)।');
 const{rows:[n]}=await q(NOW),c={...await data(req.u.id,from,to),today:n.d},s=LG.summarize(from,to,c);
 res.json({rows:(await q("SELECT to_char(date,'YYYY-MM-DD') d,in_time,out_time,status,late_min,half_reason FROM attendance WHERE user_id=$1 AND date BETWEEN $2::date AND $3::date ORDER BY date DESC",[req.u.id,from,to])).rows,summary:{...s,late_fmt:LG.fmtMin(s.late_total)}})});
};
