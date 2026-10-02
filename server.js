require('dotenv').config();
const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),QR=require('qrcode'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const SECRET=process.env.JWT_SECRET,PROD=process.env.NODE_ENV==='production',DB=process.env.DATABASE_URL||'';
if(!SECRET||SECRET.length<32||!DB){console.error('Set DATABASE_URL and JWT_SECRET (32+ chars) in .env');process.exit(1)}
const pool=new Pool({connectionString:DB,ssl:/localhost|127\.0\.0\.1/.test(DB)?false:{rejectUnauthorized:false}});
const q=(s,p)=>pool.query(s,p),app=express(),fails=new Map(),bad=(res,e,c=400)=>res.status(c).json({e});
// Official time = database clock, shown/classified in IST
const NOW="SELECT now() t,to_char(now() AT TIME ZONE 'Asia/Kolkata','HH24:MI') hm,to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') d";
const cfg=async()=>Object.fromEntries((await q('SELECT k,v FROM settings')).rows.map(r=>[r.k,r.v]));
const audit=(u,a,d)=>q('INSERT INTO audit_logs(user_id,action,detail) VALUES($1,$2,$3)',[u,a,d||'']);
const note=async(m,u,a)=>{await q('INSERT INTO notifications(msg) VALUES($1)',[m]);await audit(u,a,m)};
const h12=s=>{const[h,m]=s.split(':');return(h%12||12)+':'+m+(h<12?' AM':' PM')};
const hav=(a,b,c,d)=>{const r=x=>x*Math.PI/180,p=r(c-a),l=r(d-b),h=Math.sin(p/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(l/2)**2;return 12742000*Math.asin(Math.sqrt(h))};
const auth=role=>async(req,res,next)=>{try{
 const t=(req.headers.cookie||'').match(/(?:^|;\s*)t=([^;]+)/)?.[1],p=jwt.verify(t,SECRET),
 u=(await q('SELECT id,name,role,active,must_change FROM users WHERE id=$1',[p.id])).rows[0];
 if(!u||!u.active)return bad(res,'Please login again.',401);
 if(role&&u.role!==role)return bad(res,'Not allowed.',403);
 if(u.must_change&&!/^\/api\/(password|me)/.test(req.originalUrl))return bad(res,'Please set a new password first.',403);
 req.u=u;next()}catch{bad(res,'Please login again.',401)}};

app.use(express.json({limit:'10kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next()});
app.use(express.static(path.join(__dirname,'public')));

app.post('/api/login',async(req,res)=>{
 const{username,password}=req.body||{},key=String(username||'').trim().toLowerCase(),f=(fails.get(key)||[]).filter(t=>Date.now()-t<9e5);
 if(f.length>=10)return bad(res,'Too many attempts. Please try again after 15 minutes.',429);
 const u=(await q('SELECT * FROM users WHERE username=$1',[key])).rows[0];
 if(!u||!u.active||!await bcrypt.compare(String(password||''),u.password_hash)){f.push(Date.now());fails.set(key,f);return bad(res,'Wrong username or password.',401)}
 fails.delete(key);
 res.cookie('t',jwt.sign({id:u.id},SECRET,{expiresIn:'12h'}),{httpOnly:true,sameSite:'strict',secure:PROD,maxAge:432e5});
 await audit(u.id,'LOGIN');res.json({id:u.id,name:u.name,role:u.role,must_change:u.must_change})});
app.post('/api/logout',(req,res)=>{res.clearCookie('t');res.json({ok:1})});
app.get('/api/me',auth(),(req,res)=>res.json(req.u));
app.post('/api/password',auth(),async(req,res)=>{const pw=String((req.body||{}).pw||'');
 if(pw.length<8||pw==='Admin@123'||pw==='Teacher@123')return bad(res,'Use a new password of at least 8 characters (not the default).');
 await q('UPDATE users SET password_hash=$2,must_change=false WHERE id=$1',[req.u.id,await bcrypt.hash(pw,10)]);await audit(req.u.id,'PASSWORD_CHANGED');res.json({ok:1})});

// ---- Teacher: mark IN / OUT (login + GPS + school QR, all checked here) ----
app.post('/api/mark',auth('teacher'),async(req,res)=>{
 const{type,lat,lng,acc,qr}=req.body||{},S=await cfg();
 if(!['in','out'].includes(type)||[lat,lng].some(v=>typeof v!=='number'||!isFinite(v)))return bad(res,'Invalid request.');
 if(qr!=='SMSJ:'+S.qr_token)return bad(res,'Invalid school QR. Please scan the QR displayed in the school office.');
 if(!+S.lat&&!+S.lng)return bad(res,'School location is not set yet. Please ask the admin.');
 if(Number(acc)>200)return bad(res,'GPS is not accurate enough. Please go outside and try again.');
 if(hav(lat,lng,+S.lat,+S.lng)>+S.radius)return bad(res,'Attendance cannot be marked. You are outside the school attendance area.');
 const{rows:[n]}=await q(NOW),id=req.u.id,A=Number(acc)||null;
 if(type==='in'){
  const st=n.hm<=S.present_until?'Present':n.hm<=S.late_until?'Late':'Half Day';
  const r=await q('INSERT INTO attendance(user_id,date,in_time,status,in_lat,in_lng,in_acc,in_qr) VALUES($1,$2::date,$3,$4,$5,$6,$7,true) ON CONFLICT(user_id,date) DO NOTHING RETURNING in_time,status',[id,n.d,n.t,st,lat,lng,A]);
  if(!r.rowCount)return bad(res,'IN attendance has already been recorded today.',409);
  await note(`${req.u.name} marked IN at ${h12(n.hm)}`+(st==='Present'?'.':` — ${st.toUpperCase()}.`),id,'ATTENDANCE_IN');
  return res.json(r.rows[0])}
 if(S.allow_out!=='yes')return bad(res,'OUT attendance is turned off.');
 const r=await q('UPDATE attendance SET out_time=$3,out_lat=$4,out_lng=$5,out_acc=$6,out_qr=true,updated_at=now() WHERE user_id=$1 AND date=$2::date AND out_time IS NULL RETURNING in_time,out_time',[id,n.d,n.t,lat,lng,A]);
 if(!r.rowCount){const x=await q('SELECT 1 FROM attendance WHERE user_id=$1 AND date=$2::date',[id,n.d]);return bad(res,x.rowCount?'OUT attendance has already been recorded today.':'Please mark IN attendance first.',409)}
 await note(`${req.u.name} marked OUT at ${h12(n.hm)}.`,id,'ATTENDANCE_OUT');res.json(r.rows[0])});
app.get('/api/history',auth('teacher'),async(req,res)=>{const{rows:[n]}=await q(NOW);
 res.json({today:n.d,rows:(await q("SELECT to_char(date,'YYYY-MM-DD') d,in_time,out_time,status FROM attendance WHERE user_id=$1 ORDER BY date DESC LIMIT 62",[req.u.id])).rows})});

// ---- Admin ----
app.get('/api/admin/today',auth('admin'),async(req,res)=>{const{rows:[n]}=await q(NOW),S=await cfg();
 const{rows}=await q(`SELECT u.id,u.name,a.in_time,a.out_time,a.status FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date=$1::date WHERE u.role='teacher' AND u.active ORDER BY u.name`,[n.d]);
 rows.forEach(r=>{r.status=r.status||(n.hm>S.end?'Absent':'Not Marked')});
 res.json({d:n.d,rows,notes:(await q('SELECT msg FROM notifications ORDER BY id DESC LIMIT 15')).rows})});
app.get('/api/admin/staff',auth('admin'),async(req,res)=>res.json((await q('SELECT id,staff_code,name,mobile,username,role,active FROM users ORDER BY role,name')).rows));
app.post('/api/admin/staff',auth('admin'),async(req,res)=>{const B=req.body||{},s=k=>String(B[k]||'').trim().slice(0,80),pw=String(B.password||'');
 if(!s('name')||!s('staff_code')||!s('username')||pw.length<8)return bad(res,'Name, Staff ID, username and a password of 8+ characters are required.');
 await q('INSERT INTO users(staff_code,name,mobile,username,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[s('staff_code').toUpperCase(),s('name'),s('mobile'),s('username').toLowerCase(),await bcrypt.hash(pw,10),'teacher']);
 await audit(req.u.id,'STAFF_CREATED',s('username'));res.json({ok:1})});
app.post('/api/admin/staff/:id',auth('admin'),async(req,res)=>{const B=req.body||{},id=+req.params.id;
 if(B.active!==undefined){if(id===req.u.id)return bad(res,'You cannot disable yourself.');
  await q('UPDATE users SET active=$2 WHERE id=$1',[id,!!B.active]);await audit(req.u.id,B.active?'STAFF_ENABLED':'STAFF_DISABLED','id '+id)}
 if(B.password){if(String(B.password).length<8)return bad(res,'Password must be at least 8 characters.');
  await q('UPDATE users SET password_hash=$2,must_change=true WHERE id=$1',[id,await bcrypt.hash(String(B.password),10)]);await audit(req.u.id,'PASSWORD_RESET','id '+id)}
 res.json({ok:1})});
const KEYS=['school_name','start','present_until','late_until','end','lat','lng','radius','allow_out'];
app.get('/api/admin/settings',auth('admin'),async(req,res)=>{const S=await cfg();delete S.qr_token;res.json(S)});
app.post('/api/admin/settings',auth('admin'),async(req,res)=>{const B=req.body||{};
 for(const k of KEYS){const v=String(B[k]??'').trim().slice(0,100);if(!v)continue;
  if(/^(start|end|present_until|late_until)$/.test(k)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return bad(res,'Time must look like 07:30 (24-hour).');
  if(/^(lat|lng|radius)$/.test(k)&&!isFinite(v))return bad(res,'Latitude, longitude and radius must be numbers.');
  if(k==='allow_out'&&!['yes','no'].includes(v))continue;
  await q('INSERT INTO settings VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=$2',[k,v])}
 await audit(req.u.id,'SETTINGS_CHANGED');res.json({ok:1})});
app.get('/api/admin/qr',auth('admin'),async(req,res)=>res.json({img:await QR.toDataURL('SMSJ:'+(await cfg()).qr_token,{width:640,margin:2})}));
app.post('/api/admin/qr/new',auth('admin'),async(req,res)=>{
 await q("UPDATE settings SET v=$1 WHERE k='qr_token'",[crypto.randomBytes(24).toString('hex')]);await audit(req.u.id,'QR_REGENERATED');res.json({ok:1})});
app.get('/api/admin/report',auth('admin'),async(req,res)=>{const m=req.query.month;if(!/^\d{4}-\d{2}$/.test(m))return bad(res,'Bad month.');
 const{rows}=await q(`SELECT u.staff_code,u.name,count(*) FILTER(WHERE a.status='Present') p,count(*) FILTER(WHERE a.status='Late') l,count(*) FILTER(WHERE a.status='Half Day') h,round((sum(extract(epoch FROM a.out_time-a.in_time))/3600)::numeric,1) hrs FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND to_char(a.date,'YYYY-MM')=$1 WHERE u.role='teacher' GROUP BY u.id ORDER BY u.name`,[m]);
 const c=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 res.type('text/csv').attachment(`attendance-${m}.csv`).send('\ufeff'+['Staff ID,Name,Present,Late,Half Day,Total IN hours'].concat(rows.map(r=>[r.staff_code,r.name,r.p,r.l,r.h,r.hrs].map(c).join(','))).join('\n'))});

app.use((e,req,res,next)=>{console.error(e);e.code==='23505'?bad(res,'That Staff ID or username already exists.',409):bad(res,'Server error. Please try again.',500)});

async function init(){
 await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
 const def={school_name:'S.M.S. Jain Public Sr. Sec. School, Momasar',start:'07:15',present_until:'07:30',late_until:'09:00',end:'13:30',lat:'0',lng:'0',radius:'100',allow_out:'yes',qr_token:crypto.randomBytes(24).toString('hex')};
 for(const[k,v]of Object.entries(def))await q('INSERT INTO settings VALUES($1,$2) ON CONFLICT DO NOTHING',[k,v]);
 if(!(await q('SELECT 1 FROM users LIMIT 1')).rowCount){ // DEMO DATA: default passwords must be changed at first login
  const A=await bcrypt.hash('Admin@123',10),T=await bcrypt.hash('Teacher@123',10);
  for(const[c,n,u,h,r]of [['ADMIN','School Admin','admin',A,'admin'],['STAFF001','Sunil Ji Sir','sunil',T],['STAFF002','Manoj Ji Sir','manoj',T],['STAFF003','Jagdish Ji','jagdish',T],['STAFF004','Kuldeep Ji Sir','kuldeep',T],['STAFF005','Lalchand Ji Sir','lalchand',T]])
   await q('INSERT INTO users(staff_code,name,username,password_hash,role) VALUES($1,$2,$3,$4,$5)',[c,n,u,h,r||'teacher'])}}
init().then(()=>app.listen(process.env.PORT||3000,()=>console.log('Attendance app running'))).catch(e=>{console.error(e);process.exit(1)});
