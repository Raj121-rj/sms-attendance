const t=require('node:test'),a=require('node:assert/strict'),L=require('../logic'),Module=require('module');
const rows=[{d:'2026-10-01',name:'Sunil Ji Sir',in_time:'2026-10-01T02:02:00.000Z',out_time:'2026-10-01T07:58:00.000Z',status:'Late',late_min:12,half_reason:null,uid:1},
 {d:'2026-10-02',name:'Sunil Ji Sir',in_time:'2026-10-02T05:50:00.000Z',out_time:null,status:'Half Day',late_min:221,half_reason:'late_in',uid:1}],
 sums=[{name:'Sunil Ji Sir',ontime:0,late:1,half:1,leave_days:0,absent:0,late_fmt:'3 hr 53 min'}];
t('case 15a: CSV keeps its columns and daily late minutes, adds Half Day reason + Total Late Time',()=>{const c=L.csvText(rows,[],sums).replace('\ufeff','').split('\n');
 a.equal(c[0],'"Date","Staff Name","IN Time","OUT Time","Status","Late Minutes","Remarks"');
 a.ok(c[1].includes('"12"')&&c[1].includes('देर से')&&c[1].includes('7:32 AM'));
 a.ok(c[2].includes('आधा दिन')&&c[2].includes('"221"')&&c[2].includes('Late IN')&&c[2].includes('OUT दर्ज नहीं'));
 const all=c.join('\n');a.ok(all.includes('Total Late Time')&&all.includes('3 hr 53 min'))});
t('case 15b: PDF builder runs (stubbed PDFKit) with Half Day reason and Total Late Time',async()=>{const texts=[];
 class Fake{constructor(){this.y=50;this.page={margins:{}}}registerFont(){return this}font(){return this}fontSize(){return this}text(s){texts.push(String(s));return this}moveTo(){return this}lineTo(){return this}stroke(){return this}addPage(){return this}pipe(){return this}end(){}bufferedPageRange(){return{count:1}}switchToPage(){return this}}
 const o=Module._load;Module._load=function(r,...x){return r==='pdfkit'?Fake:o.call(this,r,...x)};
 try{await require('../pdf')({type(){return this},attachment(){return this}},{rows,leaves:[],sums,from:'2026-10-01',to:'2026-10-31',who:'',school:'S'})}finally{Module._load=o}
 const all=texts.join('|');a.ok(all.includes('Late IN'));a.ok(all.includes('Total Late Time')||all.includes('कुल देर का समय'));a.ok(all.includes('3 hr 53 min'))});
