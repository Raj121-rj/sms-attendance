const t=require('node:test'),a=require('node:assert/strict'),L=require('../logic');
const E=(today='2026-10-20')=>({today,H:new Map(),att:new Map(),full:new Set(),half:new Set()});
const rec=(c,d,status,out=true)=>c.att.set(d,{status,in:status==='Absent'?null:'t',out:out?'t':null,late:0});
t('1 half day = 0.5 leave; 2 = 1; 4 = 2',()=>{a.equal(L.halfToLeave(1),0.5);a.equal(L.halfToLeave(2),1);a.equal(L.halfToLeave(4),2)});
t('streak: 3 on-time days = 3',()=>{const c=E();['05','06','07'].forEach(x=>rec(c,'2026-10-'+x,'On Time'));a.deepEqual(L.streaks('2026-10-05','2026-10-07',c),{current:3,best:3})});
t('late resets; Sunday, holiday and approved leave do not break',()=>{const c=E();
 ['05','06','07'].forEach(x=>rec(c,'2026-10-'+x,'On Time'));rec(c,'2026-10-08','Late');a.equal(L.streaks('2026-10-05','2026-10-08',c).current,0);
 ['09','10','12'].forEach(x=>rec(c,'2026-10-'+x,'On Time'));   // 11th is a Sunday
 c.H.set('2026-10-13',false);rec(c,'2026-10-14','On Time');   // 13th school holiday
 c.full.add('2026-10-15');rec(c,'2026-10-16','On Time');       // 15th approved leave
 a.deepEqual(L.streaks('2026-10-05','2026-10-16',c),{current:5,best:5})});
t('past working day without IN resets; today before IN does not',()=>{const c=E();rec(c,'2026-10-05','On Time');rec(c,'2026-10-07','On Time');
 a.deepEqual(L.streaks('2026-10-05','2026-10-07',c),{current:1,best:1});
 const d=E();rec(d,'2026-10-05','On Time');a.deepEqual(L.streaks('2026-10-05','2026-10-06',d),{current:1,best:1})});
t('half day counts only with an on-time IN',()=>{const c=E();rec(c,'2026-10-05','On Time');c.half.add('2026-10-06');
 a.deepEqual(L.streaks('2026-10-05','2026-10-07',c),{current:1,best:1});          // half day, no IN: neutral
 rec(c,'2026-10-06','On Time');a.equal(L.streaks('2026-10-05','2026-10-07',c).current,2);
 rec(c,'2026-10-06','Late');a.equal(L.streaks('2026-10-05','2026-10-07',c).current,0)});
t('absent resets the streak',()=>{const c=E();rec(c,'2026-10-05','On Time');rec(c,'2026-10-06','Absent');a.equal(L.streaks('2026-10-05','2026-10-06',c).current,0)});
t('calendar codes',()=>{const c=E('2026-10-20');const A=(d,s,o)=>rec(c,d,s,o);
 A('2026-10-05','On Time');A('2026-10-06','Late');A('2026-10-07','On Time',false);A('2026-10-08','Absent');c.full.add('2026-10-09');c.half.add('2026-10-10');c.H.set('2026-10-13',false);
 const k=d=>L.dayCode(d,c);
 a.equal(k('2026-10-05'),'on');a.equal(k('2026-10-06'),'late');a.equal(k('2026-10-07'),'outmiss');a.equal(k('2026-10-08'),'absent');
 a.equal(k('2026-10-09'),'leave');a.equal(k('2026-10-10'),'half');a.equal(k('2026-10-11'),'off');a.equal(k('2026-10-13'),'off');
 a.equal(k('2026-10-14'),'none');a.equal(k('2026-10-21'),'future');
 c.att.set('2026-10-20',{status:'On Time',in:'t',out:null,late:0});a.equal(k('2026-10-20'),'on');   // today, OUT still pending
 c.H.set('2026-10-18',true);a.equal(k('2026-10-18'),'none')})  // special working Sunday
t('academic sessions do not mix or overlap',()=>{const s1={start:'2026-04-01',end:'2027-03-31'},s2={start:'2027-04-01',end:'2028-03-31'};
 a.ok(L.inSession('2026-10-05',s1));a.ok(!L.inSession('2026-10-05',s2));a.ok(L.inSession('2027-04-02',s2));a.ok(!L.overlaps(s1,s2));a.ok(L.overlaps(s1,{start:'2027-03-01',end:'2027-05-01'}))});
t('auto absent cases A-F',()=>{const H=new Map(),staff=[1,2,3,4,5].map(id=>({id})),hasAtt=new Set([2]),onLeave=new Set([3,4]),f=d=>L.toAbsent(d,{staff,hasAtt,onLeave,H});
 a.deepEqual(f('2026-10-20'),[1,5]);          // A: no IN, no leave -> Absent. B: id 2 has IN (OUT missing) -> not Absent. C/D: leave / half-day -> not Absent
 a.deepEqual(f('2026-10-18'),[]);              // E: Sunday
 H.set('2026-10-20',false);a.deepEqual(f('2026-10-20'),[]);   // F: school holiday
 H.set('2026-10-18',true);a.deepEqual(f('2026-10-18'),[1,5])}); // special working Sunday
t('finalization due only after closing and never before go-live',()=>{
 a.deepEqual(L.dueDates('2026-10-20','13:29','13:30','2026-10-18'),['2026-10-18','2026-10-19']);
 a.deepEqual(L.dueDates('2026-10-20','13:30','13:30','2026-10-18'),['2026-10-18','2026-10-19','2026-10-20']);
 a.deepEqual(L.dueDates('2026-10-20','13:29','13:30','2026-10-20'),[]);a.deepEqual(L.dueDates('2026-10-20','14:00','13:30','2026-10-20'),['2026-10-20']);
 a.deepEqual(L.dueDates('2026-10-20','15:00','13:30','2026-10-21'),[])});
const fs=require('node:fs');const HD='11:00',CUT='07:20';
t('cases 1-5: IN rules with Half Day Time 11:00',()=>{const f=x=>L.classifyIn(x,CUT,HD);
 a.equal(f('07:15').status,'On Time');a.equal(f('07:25').status,'Late');a.equal(f('07:25').late_min,5);
 a.equal(f('10:59').status,'Late');a.equal(f('11:00').status,'Late');            // exactly the Half Day Time is not "after"
 const x=f('11:01');a.equal(x.status,'Half Day');a.equal(x.reason,'late_in');a.equal(x.late_min,221);   // late minutes are kept
 a.equal(f('11:30').status,'Half Day');a.equal(f('11:30').late_min,250)});
t('cases 6-8: OUT rules',()=>{const inn=L.classifyIn('07:20',CUT,HD);a.equal(inn.status,'On Time');const o=h=>L.applyOut(inn,h,HD);
 a.equal(o('10:59').status,'Half Day');a.equal(o('10:59').reason,'early_out');a.equal(o('11:00').status,'On Time');a.equal(o('10:30').status,'Half Day');
 const late=L.classifyIn('07:25',CUT,HD);a.equal(L.applyOut(late,'13:30',HD).status,'Late');a.equal(L.applyOut(late,'10:30',HD).late_min,5);
 const both=L.applyOut(L.classifyIn('11:20',CUT,HD),'10:00',HD);a.equal(both.status,'Half Day');a.equal(both.reason,'both')});   // both conditions -> still one status
t('case 9-11: leave beats half day; absent rules unaffected by Half Day',()=>{const c=E('2026-10-20');c.full.add('2026-10-14');
 a.equal(L.dayCode('2026-10-14',c),'leave');                                                      // approved leave, no attendance -> LEAVE
 c.att.set('2026-10-15',{status:'Half Day',in:'t',out:'t',late:221,reason:'late_in'});a.equal(L.dayCode('2026-10-15',c),'half');
 c.full.add('2026-10-15');a.equal(L.dayCode('2026-10-15',c),'leave');                             // leave wins over an automatic half day
 a.deepEqual(L.toAbsent('2026-10-20',{staff:[{id:1},{id:2}],hasAtt:new Set([2]),onLeave:new Set(),H:new Map()}),[1])});  // 1: no IN/leave -> Absent; 2: Half Day IN row -> not Absent
t('cases 12-13: Total Late Time = SUM of the selected range',()=>{const c=E('2026-10-31');
 [['01',15],['02',20],['05',10],['07',25],['20',5]].forEach(([d,m])=>c.att.set('2026-10-'+d,{status:'Late',in:'t',out:'t',late:m}));
 c.att.set('2026-10-21',{status:'Half Day',in:'t',out:'t',late:221,reason:'late_in'});
 const s1=L.summarize('2026-10-01','2026-10-15',c),s2=L.summarize('2026-10-01','2026-10-31',c);
 a.equal(s1.late_total,70);a.equal(L.fmtMin(s1.late_total),'1 hr 10 min');a.equal(s1.late,4);
 a.equal(s2.late_total,296);a.equal(s2.half,1);a.equal(s2.late,5);
 a.deepEqual([0,35,59,60,70,120,125].map(L.fmtMin),['0 min','35 min','59 min','1 hr','1 hr 10 min','2 hr','2 hr 5 min'])});
t('summary: leave excluded, half = auto + approved counted once per date, OUT missing',()=>{const c=E('2026-10-20');
 c.att.set('2026-10-05',{status:'On Time',in:'t',out:'t',late:0});c.att.set('2026-10-06',{status:'Late',in:'t',out:null,late:9});
 c.att.set('2026-10-07',{status:'Half Day',in:'t',out:'t',late:0,reason:'early_out'});c.half.add('2026-10-07');c.half.add('2026-10-08');
 c.full.add('2026-10-09');c.att.set('2026-10-09',{status:'Late',in:'t',out:'t',late:30});
 const s=L.summarize('2026-10-05','2026-10-10',c);
 a.deepEqual({on:s.ontime,late:s.late,half:s.half,leave:s.leave_days,out:s.outmiss,lt:s.late_total,wd:s.working_days,tl:s.leave_total},{on:1,late:1,half:2,leave:1,out:1,lt:9,wd:6,tl:2})});
t('streak: half day from early OUT keeps an on-time IN; late-IN half day resets',()=>{const c=E();
 c.att.set('2026-10-05',{status:'On Time',in:'t',out:'t',late:0});c.att.set('2026-10-06',{status:'Half Day',in:'t',out:'t',late:0,reason:'early_out'});
 a.equal(L.streaks('2026-10-05','2026-10-06',c).current,2);
 c.att.set('2026-10-06',{status:'Half Day',in:'t',out:'t',late:221,reason:'late_in'});a.equal(L.streaks('2026-10-05','2026-10-06',c).current,0)});
t('case 14: staff summary, staff range and admin report all use the same LG.summarize',()=>{const x=fs.readFileSync(__dirname+'/../extra.js','utf8');a.ok((x.match(/LG\.summarize/g)||[]).length>=3)});
