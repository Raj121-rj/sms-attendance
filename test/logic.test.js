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
