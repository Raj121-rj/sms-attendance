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
 if(!u||!u.active)return bad(res,'कृपया दोबारा लॉगिन करें।',401);
 if(role&&u.role!==role)return bad(res,'आपको इसकी अनुमति नहीं है।',403);
 if(u.must_change&&!/^\/api\/(password|me)/.test(req.originalUrl))return bad(res,'पहले नया पासवर्ड बनाएँ।',403);
 req.u=u;next()}catch{bad(res,'कृपया दोबारा लॉगिन करें।',401)}};

app.use(express.json({limit:'10kb'}));
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next()});
app.use(express.static(path.join(__dirname,'public')));

app.post('/api/login',async(req,res)=>{
 const{username,password}=req.body||{},key=String(username||'').trim().toLowerCase(),f=(fails.get(key)||[]).filter(t=>Date.now()-t<9e5);
 if(f.length>=10)return bad(res,'बहुत अधिक प्रयास। कृपया 15 मिनट बाद दोबारा प्रयास करें।',429);
 const u=(await q('SELECT * FROM users WHERE username=$1',[key])).rows[0];
 if(!u||!u.active||!await bcrypt.compare(String(password||''),u.password_hash)){f.push(Date.now());fails.set(key,f);return bad(res,'यूज़रनेम या पासवर्ड गलत है।',401)}
 fails.delete(key);
 res.cookie('t',jwt.sign({id:u.id},SECRET,{expiresIn:'12h'}),{httpOnly:true,sameSite:'strict',secure:PROD,maxAge:432e5});
 await audit(u.id,'LOGIN');res.json({id:u.id,name:u.name,role:u.role,must_change:u.must_change})});
app.post('/api/logout',(req,res)=>{res.clearCookie('t');res.json({ok:1})});
app.get('/api/me',auth(),async(req,res)=>res.json({...req.u,today:(await q(NOW)).rows[0].d}));
app.post('/api/password',auth(),async(req,res)=>{const pw=String((req.body||{}).pw||'');
 if(pw.length<8||pw==='Admin@123'||pw==='Teacher@123')return bad(res,'कम से कम 8 अक्षर का नया पासवर्ड रखें (डिफ़ॉल्ट नहीं)।');
 await q('UPDATE users SET password_hash=$2,must_change=false WHERE id=$1',[req.u.id,await bcrypt.hash(pw,10)]);await audit(req.u.id,'PASSWORD_CHANGED');res.json({ok:1})});

// ---- Teacher: mark IN / OUT (login + GPS + school QR, all checked here) ----
const mins=s=>+s.slice(0,2)*60+ +s.slice(3,5);
app.post('/api/mark',auth('teacher'),async(req,res)=>{
 const{type,lat,lng,acc,qr}=req.body||{},S=await cfg();
 if(!['in','out'].includes(type)||[lat,lng].some(v=>typeof v!=='number'||!isFinite(v)))return bad(res,'अमान्य अनुरोध।');
 const TY=type.toUpperCase();
 if(qr!=='SMSJ-'+TY+':'+S['qr_'+type+'_token'])return bad(res,`❌ यह ${TY} QR Code मान्य नहीं है।`);
 if(!+S.lat&&!+S.lng)return bad(res,'❌ विद्यालय का GPS स्थान अभी सेट नहीं है। कृपया Admin से कहें।');
 if(Number(acc)>200)return bad(res,'❌ GPS सटीक नहीं है। कृपया खुले स्थान पर जाकर दोबारा प्रयास करें।');
 if(hav(lat,lng,+S.lat,+S.lng)>+S.radius)return bad(res,'❌ आप विद्यालय की निर्धारित सीमा से बाहर हैं। कृपया विद्यालय परिसर में आकर पुनः प्रयास करें।');
 const{rows:[n]}=await q(NOW),id=req.u.id,A=Number(acc)||null;
 if(type==='in'){
  const lm=Math.max(0,mins(n.hm)-mins(S.present_until)),st=lm?'Late':'On Time';
  const r=await q('INSERT INTO attendance(user_id,date,in_time,status,late_min,in_lat,in_lng,in_acc,in_qr) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(user_id,date) DO NOTHING RETURNING in_time,status,late_min',[id,n.d,n.t,st,lm,lat,lng,A]);
  if(!r.rowCount){const x=(await q('SELECT in_time FROM attendance WHERE user_id=$1 AND date=$2::date',[id,n.d])).rows[0];return bad(res,x&&!x.in_time?'आज की उपस्थिति अनुपस्थित दर्ज हो चुकी है। कृपया Admin से संपर्क करें।':'आज की IN उपस्थिति पहले ही दर्ज हो चुकी है।',409)}
  const pv=(await q('SELECT in_time FROM attendance WHERE user_id=$1 AND date<$2::date AND in_time IS NOT NULL ORDER BY date DESC LIMIT 1',[id,n.d])).rows[0];
  await note(`${req.u.name} ने ${h12(n.hm)} पर IN दर्ज किया`+(lm?` — देर से (${lm} मिनट)।`:'।'),id,'ATTENDANCE_IN');
  return res.json({...r.rows[0],prev_in:pv?.in_time||null,cut:h12(S.present_until)})}
 if(S.allow_out!=='yes')return bad(res,'OUT उपस्थिति अभी बंद है।');
 const r=await q('UPDATE attendance SET out_time=$3,out_lat=$4,out_lng=$5,out_acc=$6,out_qr=true,updated_at=now() WHERE user_id=$1 AND date=$2::date AND in_time IS NOT NULL AND out_time IS NULL RETURNING in_time,out_time',[id,n.d,n.t,lat,lng,A]);
 if(!r.rowCount){const x=await q('SELECT 1 FROM attendance WHERE user_id=$1 AND date=$2::date AND in_time IS NOT NULL',[id,n.d]);return bad(res,x.rowCount?'आज की OUT उपस्थिति पहले ही दर्ज हो चुकी है।':'पहले IN उपस्थिति दर्ज करें।',409)}
 await note(`${req.u.name} ने ${h12(n.hm)} पर OUT दर्ज किया।`,id,'ATTENDANCE_OUT');res.json(r.rows[0])});
app.get('/api/history',auth('teacher'),async(req,res)=>{const{rows:[n]}=await q(NOW);
 res.json({today:n.d,rows:(await q("SELECT to_char(date,'YYYY-MM-DD') d,in_time,out_time,status,late_min FROM attendance WHERE user_id=$1 ORDER BY date DESC LIMIT 62",[req.u.id])).rows})});

// ---- Admin ----
app.get('/api/admin/staff',auth('admin'),async(req,res)=>res.json((await q("SELECT id,staff_code,name,mobile,username,role,active FROM users WHERE staff_code NOT LIKE 'DELETED-%' ORDER BY role,name")).rows));
app.post('/api/admin/staff',auth('admin'),async(req,res)=>{const B=req.body||{},s=k=>String(B[k]||'').trim().slice(0,80),pw=String(B.password||'');
 if(!s('name')||!s('staff_code')||!s('username')||pw.length<8)return bad(res,'नाम, Staff ID, यूज़रनेम और 8+ अक्षर का पासवर्ड आवश्यक है।');
 await q('INSERT INTO users(staff_code,name,mobile,username,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[s('staff_code').toUpperCase(),s('name'),s('mobile'),s('username').toLowerCase(),await bcrypt.hash(pw,10),'teacher']);
 await audit(req.u.id,'STAFF_CREATED',s('username'));res.json({ok:1})});
app.post('/api/admin/staff/:id',auth('admin'),async(req,res)=>{const B=req.body||{},id=+req.params.id;
 if(B.active!==undefined){if(id===req.u.id)return bad(res,'आप स्वयं को निष्क्रिय नहीं कर सकते।');
  await q('UPDATE users SET active=$2 WHERE id=$1',[id,!!B.active]);await audit(req.u.id,B.active?'STAFF_ENABLED':'STAFF_DISABLED','id '+id)}
 if(B.password){if(String(B.password).length<8)return bad(res,'पासवर्ड कम से कम 8 अक्षर का होना चाहिए।');
  await q('UPDATE users SET password_hash=$2,must_change=true WHERE id=$1',[id,await bcrypt.hash(String(B.password),10)]);await audit(req.u.id,'PASSWORD_RESET','id '+id)}
 res.json({ok:1})});
const KEYS=['school_name','start','present_until','late_until','end','lat','lng','radius','allow_out'];
app.get('/api/admin/settings',auth('admin'),async(req,res)=>{const S=await cfg();delete S.qr_token;delete S.qr_in_token;delete S.qr_out_token;res.json(S)});
app.post('/api/admin/settings',auth('admin'),async(req,res)=>{const B=req.body||{};
 for(const k of KEYS){const v=String(B[k]??'').trim().slice(0,100);if(!v)continue;
  if(/^(start|end|present_until|late_until)$/.test(k)&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return bad(res,'समय 07:30 जैसे 24-घंटे प्रारूप में लिखें।');
  if(/^(lat|lng|radius)$/.test(k)&&!isFinite(v))return bad(res,'Latitude, longitude और दूरी संख्या में होनी चाहिए।');
  if(k==='allow_out'&&!['yes','no'].includes(v))continue;
  await q('INSERT INTO settings VALUES($1,$2) ON CONFLICT(k) DO UPDATE SET v=$2',[k,v])}
 await audit(req.u.id,'SETTINGS_CHANGED');res.json({ok:1})});
app.get('/api/admin/qr',auth('admin'),async(req,res)=>{const S=await cfg(),o={width:640,margin:2};res.json({in:await QR.toDataURL('SMSJ-IN:'+S.qr_in_token,o),out:await QR.toDataURL('SMSJ-OUT:'+S.qr_out_token,o)})});
app.post('/api/admin/qr/new',auth('admin'),async(req,res)=>{const t=(req.body||{}).type;if(!['in','out'].includes(t))return bad(res,'अमान्य अनुरोध।');
 await q('UPDATE settings SET v=$1 WHERE k=$2',[crypto.randomBytes(24).toString('hex'),`qr_${t}_token`]);await audit(req.u.id,'QR_REGENERATED',t);res.json({ok:1})});
require('./extra')(app,{q,auth,bad,audit,note,NOW,cfg,h12,pool});
app.use((e,req,res,next)=>{console.error(e);e.code==='23505'?bad(res,'यह Staff ID या यूज़रनेम पहले से मौजूद है।',409):bad(res,'कुछ तकनीकी समस्या आ गई है। कृपया दोबारा प्रयास करें या Admin से संपर्क करें।',500)});

async function init(){
 await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
 for(const m of['003_sessions.sql','004_finalize.sql'])try{await pool.query(fs.readFileSync(path.join(__dirname,'migrations',m),'utf8'))}catch(e){console.error('Migration '+m+' failed (related feature is disabled):',e.message)}
 const def={school_name:'S.M.S. Jain Public Sr. Sec. School, Momasar',start:'07:15',present_until:'07:20',late_until:'09:00',end:'13:30',lat:'0',lng:'0',radius:'100',allow_out:'yes',qr_in_token:crypto.randomBytes(24).toString('hex'),qr_out_token:crypto.randomBytes(24).toString('hex')};
 for(const[k,v]of Object.entries(def))await q('INSERT INTO settings VALUES($1,$2) ON CONFLICT DO NOTHING',[k,v]);
 await q("UPDATE settings SET v='07:20' WHERE k='present_until' AND v='07:30'");
 if(!(await q('SELECT 1 FROM users LIMIT 1')).rowCount){ // DEMO DATA: default passwords must be changed at first login
  const A=await bcrypt.hash('Admin@123',10),T=await bcrypt.hash('Teacher@123',10);
  for(const[c,n,u,h,r]of [['ADMIN','School Admin','admin',A,'admin'],['STAFF001','Sunil Ji Sir','sunil',T],['STAFF002','Manoj Ji Sir','manoj',T],['STAFF003','Jagdish Ji','jagdish',T],['STAFF004','Kuldeep Ji Sir','kuldeep',T],['STAFF005','Lalchand Ji Sir','lalchand',T]])
   await q('INSERT INTO users(staff_code,name,username,password_hash,role) VALUES($1,$2,$3,$4,$5)',[c,n,u,h,r||'teacher'])}}
init().then(()=>app.listen(process.env.PORT||3000,()=>console.log('Attendance app running'))).catch(e=>{console.error(e);process.exit(1)});
