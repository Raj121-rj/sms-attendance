// v2 routes: leave/half-day, corrections, overrides, holidays, summary, records/CSV
module.exports=(app,{q,auth,bad,audit,note,NOW,cfg,h12})=>{
const D=/^\d{4}-\d{2}-\d{2}$/,mins=s=>+s.slice(0,2)*60+ +s.slice(3,5),
days=(a,b)=>{const r=[];for(let d=new Date(a+'T00:00:00Z'),e=new Date(b+'T00:00:00Z');d<=e;d.setUTCDate(d.getUTCDate()+1))r.push(d.toISOString().slice(0,10));return r},
hol=async()=>new Map((await q("SELECT to_char(date,'YYYY-MM-DD') d,working FROM holidays")).rows.map(r=>[r.d,r.working])),
off=(d,H)=>H.has(d)?!H.get(d):new Date(d+'T00:00:00Z').getUTCDay()===0,
txt=(v,n)=>String(v||'').trim().slice(0,n);

app.get('/api/summary',auth('teacher'),async(req,res)=>{
 const{rows:[n]}=await q(NOW),id=req.u.id,m=n.d.slice(0,7),H=await hol(),S=await cfg(),pd=new Date(m+'-01T00:00:00Z');pd.setUTCMonth(pd.getUTCMonth()-1);
 const cnt=async mo=>{const r=(await q("SELECT status,count(*)::int c,(count(*) FILTER(WHERE in_time IS NOT NULL AND out_time IS NULL AND date<$3::date))::int om FROM attendance WHERE user_id=$1 AND to_char(date,'YYYY-MM')=$2 GROUP BY status",[id,mo,n.d])).rows,g=s=>r.find(x=>x.status===s)?.c||0;return{ontime:g('On Time'),late:g('Late'),absent:g('Absent'),outmiss:r.reduce((a,x)=>a+x.om,0)}};
 let full=0,half=0;
 for(const l of(await q("SELECT kind,to_char(from_date,'YYYY-MM-DD') f,to_char(to_date,'YYYY-MM-DD') t FROM leaves WHERE user_id=$1 AND status='Approved' AND to_char(from_date,'YYYY-MM')<=$2 AND to_char(to_date,'YYYY-MM')>=$2",[id,m])).rows)
  for(const d of days(l.f,l.t))if(d.startsWith(m)&&!off(d,H))l.kind==='half'?half++:full++;
 res.json({...await cnt(m),prev_ontime:(await cnt(pd.toISOString().slice(0,7))).ontime,full,half,total_leave:full+half*0.5,hm:n.hm,end:S.end,cut:h12(S.present_until),
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
 old=(await q('SELECT id,in_time,out_time,status,late_min FROM attendance WHERE user_id=$1 AND date=$2::date',[B.user_id,B.date])).rows[0]||null,
 inT=await ts(B.in),outT=await ts(B.out),late=B.status==='Late'&&B.in?Math.max(0,mins(B.in)-mins(S.present_until)):null;
 const nw=(await q(`INSERT INTO attendance(user_id,date,in_time,out_time,status,late_min) VALUES($1,$2::date,$3,$4,$5::text,$6::int) ON CONFLICT(user_id,date) DO UPDATE SET in_time=CASE WHEN $5::text='Absent' THEN NULL ELSE COALESCE($3,attendance.in_time) END,out_time=CASE WHEN $5::text='Absent' THEN NULL ELSE COALESCE($4,attendance.out_time) END,status=$5::text,late_min=$6::int,updated_at=now() RETURNING id,in_time,out_time,status,late_min`,[B.user_id,B.date,inT,outT,B.status,late])).rows[0];
 await q('INSERT INTO attendance_changes(attendance_id,user_id,date,original,changed,reason,admin_id) VALUES($1,$2,$3::date,$4,$5,$6,$7)',[nw.id,B.user_id,B.date,JSON.stringify(old),JSON.stringify(nw),why,req.u.id]);
 await audit(req.u.id,'ATTENDANCE_OVERRIDE',`${B.user_id} ${B.date}: ${why}`);res.json({ok:1})});

app.get('/api/admin/holidays',auth('admin'),async(req,res)=>res.json((await q("SELECT to_char(date,'YYYY-MM-DD') d,name,working FROM holidays ORDER BY date DESC LIMIT 60")).rows));
app.post('/api/admin/holidays',auth('admin'),async(req,res)=>{const B=req.body||{};
 if(!D.test(B.d)||(!B.del&&!txt(B.name,80)))return bad(res,'कृपया तारीख और नाम भरें।');
 if(B.del)await q('DELETE FROM holidays WHERE date=$1::date',[B.d]);else await q('INSERT INTO holidays VALUES($1::date,$2,$3) ON CONFLICT(date) DO UPDATE SET name=$2,working=$3',[B.d,txt(B.name,80),!!B.working]);
 await audit(req.u.id,'CALENDAR_CHANGED',B.d);res.json({ok:1})});

app.get('/api/admin/today',auth('admin'),async(req,res)=>{const{rows:[n]}=await q(NOW),S=await cfg(),o=off(n.d,await hol());
 const rows=(await q(`SELECT u.id,u.name,a.in_time,a.out_time,a.status,a.late_min,EXISTS(SELECT 1 FROM leaves l WHERE l.user_id=u.id AND l.status='Approved' AND l.kind='full' AND $1::date BETWEEN l.from_date AND l.to_date) leave,EXISTS(SELECT 1 FROM leaves l WHERE l.user_id=u.id AND l.status='Approved' AND l.kind='half' AND l.from_date=$1::date) half FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date=$1::date WHERE u.role='teacher' AND u.active ORDER BY u.name`,[n.d])).rows;
 rows.forEach(r=>{r.outmiss=!!r.in_time&&!r.out_time&&n.hm>S.end;r.notmarked=!r.status&&!r.leave&&!r.half&&!o});
 res.json({d:n.d,off:o,rows,notes:(await q('SELECT msg FROM notifications WHERE user_id IS NULL ORDER BY id DESC LIMIT 15')).rows})});

app.get('/api/admin/records',auth('admin'),async(req,res)=>{const{from,to,user,fmt}=req.query,u=user?+user:null;
 if(!D.test(from)||!D.test(to))return bad(res,'तारीख सही नहीं है।');
 const rows=(await q(`SELECT to_char(a.date,'YYYY-MM-DD') d,u.name,a.in_time,a.out_time,a.status,a.late_min FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date BETWEEN $1::date AND $2::date AND ($3::int IS NULL OR u.id=$3::int) ORDER BY a.date DESC,u.name`,[from,to,u])).rows,
 leaves=(await q(`SELECT u.name,to_char(l.from_date,'YYYY-MM-DD') f,to_char(l.to_date,'YYYY-MM-DD') t,l.kind,l.reason FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.status='Approved' AND l.from_date<=$2::date AND l.to_date>=$1::date AND ($3::int IS NULL OR u.id=$3::int) ORDER BY l.from_date DESC`,[from,to,u])).rows;
 if(fmt!=='csv')return res.json({rows,leaves});
 const tm=t=>t?new Date(t).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).toUpperCase():'',L={'On Time':'समय पर','Late':'देर से','Absent':'अनुपस्थित'},c=v=>'"'+String(v??'').replace(/"/g,'""')+'"',
 lines=[['Date','Staff Name','IN Time','OUT Time','Status','Late Minutes','Remarks']].concat(rows.map(r=>[r.d,r.name,tm(r.in_time),tm(r.out_time),L[r.status]||r.status,r.late_min||'',r.in_time&&!r.out_time?'OUT दर्ज नहीं':'']),leaves.map(l=>[l.f+(l.t!==l.f?' → '+l.t:''),l.name,'','',l.kind==='half'?'आधा दिन (0.5)':'छुट्टी','',l.reason]));
 res.type('text/csv').attachment(`attendance-${from}_${to}.csv`).send('\ufeff'+lines.map(r=>r.map(c).join(',')).join('\n'))});
};
