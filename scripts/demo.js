// TEST ONLY. node scripts/demo.js create|remove  (needs DATABASE_URL). The demo account is labelled DEMO001 / "(TEST)" so it cannot be mistaken for real staff.
require('dotenv').config();const{Pool}=require('pg'),bcrypt=require('bcryptjs');
const DB=process.env.DATABASE_URL||'',pool=new Pool({connectionString:DB,ssl:/localhost|127\.0\.0\.1/.test(DB)?false:{rejectUnauthorized:false}}),PW='Demo@2026-test',q=(s,p)=>pool.query(s,p);
(async()=>{const a=process.argv[2];
 if(a==='create'){await q("INSERT INTO users(staff_code,name,username,password_hash,role,must_change) VALUES('DEMO001','Demo Teacher (TEST)','demo.teacher',$1,'teacher',false) ON CONFLICT(username) DO NOTHING",[await bcrypt.hash(PW,10)]);console.log('Demo staff: demo.teacher /',PW,'  (TEST ONLY. Remove with: npm run demo:remove)')}
 else if(a==='remove'){const u=(await q("SELECT id FROM users WHERE staff_code='DEMO001' AND username='demo.teacher'")).rows[0];
  if(u){for(const t of['attendance_changes','attendance','leaves','corrections','notifications','audit_logs'])await q(`DELETE FROM ${t} WHERE user_id=$1`,[u.id]);
   await q("DELETE FROM notifications WHERE msg LIKE 'Demo Teacher (TEST)%'");await q('DELETE FROM users WHERE id=$1',[u.id])}
  console.log('Demo account and its test data removed. Real staff and attendance were not touched.')}
 else console.log('Usage: node scripts/demo.js create|remove');
 await pool.end()})().catch(e=>{console.error(e.message);process.exit(1)});
