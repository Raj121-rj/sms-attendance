// Pure attendance rules (no DB, no I/O). Used by the routes and unit-tested in test/logic.test.js.
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const range=(a,b)=>{const r=[];for(let d=a;d<=b;d=addDays(d,1))r.push(d);return r};
// H = Map(date -> isWorking) from the school calendar. Off day = Sunday or holiday, unless marked as a special working day.
const isOff=(d,H)=>H.has(d)?!H.get(d):new Date(d+'T00:00:00Z').getUTCDay()===0;
const halfToLeave=h=>h*0.5; // 1 half day = 0.5 leave (2 = 1, 4 = 2). Attendance/leave record only; no payroll.
const inSession=(d,s)=>d>=s.start&&d<=s.end;
const overlaps=(a,b)=>a.start<=b.end&&a.end>=b.start;
// c = {today, H, att: Map(date -> {status,in,out,late}), full: Set(dates), half: Set(dates)}  (full/half = approved leave on working days)
function dayCode(d,c){ // calendar colour for one date
 const a=c.att.get(d);
 if(!a&&isOff(d,c.H))return'off';
 if(d>c.today)return'future';
 if(a&&a.status==='Absent')return'absent';
 if(c.full.has(d))return'leave';
 if(c.half.has(d)||(a&&a.status==='Half Day'))return'half';
 if(a&&a.in)return !a.out&&d<c.today?'outmiss':a.status==='Late'?'late':'on';
 return'none'; // not marked: never auto-converted to Absent
}
// Punctuality streak (personal only), counted over working days from `from` to `today`:
//  +1      On Time IN
//  reset   Late IN, Absent, or a past working day with no IN
//  neutral Sundays/holidays (unless special working day), approved full leave without IN,
//          half-day leave without IN (a half day only counts if the IN itself was On Time), today before IN
function streaks(from,today,c){
 let cur=0,best=0;
 for(const d of range(from,today)){
  const a=c.att.get(d);
  if(!a&&isOff(d,c.H))continue;
  if(a&&a.status==='Absent'){cur=0;continue}
  if(c.full.has(d)&&!(a&&a.in))continue;
  if(a&&a.in){if(a.status==='On Time'||(a.status==='Half Day'&&!a.late)){cur++;best=Math.max(best,cur)}else cur=0;continue}
  if(c.half.has(d))continue;
  if(d<today)cur=0;
 }
 return{current:cur,best};
}
module.exports={addDays,range,isOff,halfToLeave,inSession,overlaps,dayCode,streaks};
// ---- v4: automatic absent ----
// Who is auto-marked Absent for `date`: active staff with no attendance row (IN/Late/OUT-missing all count as attendance)
// and no approved leave/half-day, on a working day (never Sundays, holidays or non-working days).
const toAbsent=(date,{staff,hasAtt,onLeave,H})=>isOff(date,H)?[]:staff.map(s=>s.id).filter(id=>!hasAtt.has(id)&&!onLeave.has(id));
// Dates due for finalization: past days inside the catch-up window (never before the go-live `floor`), plus today once closing time (hm >= end) has passed.
const dueDates=(today,hm,end,floor,back=3)=>{const f=addDays(today,-back),r=range(f>floor?f:floor,addDays(today,-1));if(hm>=end&&today>=floor)r.push(today);return r};
Object.assign(module.exports,{toAbsent,dueDates});
// ---- v5: Half Day Time + Total Late Time ----
const mins=s=>+s.slice(0,2)*60+ +s.slice(3,5);
// IN rule (IST, minute precision). IN strictly after the Half Day Time `half` -> 'Half Day'. Late minutes (vs the on-time cutoff `cut`) are always kept.
const classifyIn=(hm,cut,half)=>{const late=Math.max(0,mins(hm)-mins(cut));return mins(hm)>mins(half)?{status:'Half Day',late_min:late,reason:'late_in'}:{status:late?'Late':'On Time',late_min:late,reason:null}};
// OUT rule: OUT strictly before `half` -> 'Half Day'. Still ONE status/record ('both' only records that both conditions held). Approved leave is decided earlier and is never converted.
const applyOut=(cur,outHm,half)=>mins(outHm)<mins(half)?{...cur,status:'Half Day',reason:cur.reason==='late_in'?'both':'early_out'}:cur;
const reasonLabel=r=>({late_in:'Late IN',early_out:'Early OUT',both:'Late IN + Early OUT'})[r]||'';
const fmtMin=n=>{n=Math.max(0,Math.round(n||0));const h=Math.floor(n/60),m=n%60;return h?(m?`${h} hr ${m} min`:`${h} hr`):`${n} min`};
// Summary of one person for [from,to]. Priority per date: Leave > Half Day > On Time/Late > Absent. Total Late Time = SUM(late_min) of the days in range (kept on Half Day days too, ignored on leave days).
const summarize=(from,to,c)=>{const s={working_days:0,ontime:0,late:0,half:0,leave_days:0,absent:0,outmiss:0,none:0,late_total:0};
 for(const d of range(from,to)){const k=dayCode(d,c),a=c.att.get(d);
  if(k==='off'||k==='future')continue;
  s.working_days++;
  if(k==='leave')s.leave_days++;
  else if(k==='half')s.half++;
  else if(k==='absent')s.absent++;
  else if(a&&a.in){a.status==='Late'?s.late++:s.ontime++}
  else s.none++;
  if(a&&a.in&&!a.out&&d<c.today)s.outmiss++;
  if(a&&a.in&&k!=='leave')s.late_total+=a.late||0;
 }
 s.leave_total=s.leave_days+halfToLeave(s.half);return s};
const STL={'On Time':'समय पर','Late':'देर से','Half Day':'आधा दिन','Absent':'अनुपस्थित'},
tmIST=t=>t?new Date(t).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).toUpperCase():'';
// CSV: existing 7 columns unchanged; a per-staff summary block (with Total Late Time) is appended after a blank line.
function csvText(rows,leaves,sums){const c=v=>'"'+String(v??'').replace(/"/g,'""')+'"',rm=r=>[r.in_time&&!r.out_time?'OUT दर्ज नहीं':'',reasonLabel(r.half_reason)].filter(Boolean).join(' · ');
 const L=[['Date','Staff Name','IN Time','OUT Time','Status','Late Minutes','Remarks']].concat(rows.map(r=>[r.d,r.name,tmIST(r.in_time),tmIST(r.out_time),STL[r.status]||r.status,r.late_min||'',rm(r)]),leaves.map(l=>[l.f+(l.t!==l.f?' → '+l.t:''),l.name,'','',l.kind==='half'?'आधा दिन (0.5)':'छुट्टी','',l.reason]));
 const S=sums&&sums.length?[[],['Summary','Staff Name','On Time','Late','Half Day','Leave','Absent','Total Late Time']].concat(sums.map(s=>['',s.name,s.ontime,s.late,s.half,s.leave_days,s.absent,s.late_fmt])):[];
 return'\ufeff'+L.concat(S).map(r=>r.map(c).join(',')).join('\n')}
Object.assign(module.exports,{mins,classifyIn,applyOut,reasonLabel,fmtMin,summarize,csvText});
