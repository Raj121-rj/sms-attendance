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
 if(c.half.has(d))return'half';
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
  if(a&&a.in){if(a.status==='On Time'){cur++;best=Math.max(best,cur)}else cur=0;continue}
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
