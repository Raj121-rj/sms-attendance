// A4 PDF report (PDFKit). Hindi needs a Devanagari TTF in ./fonts (Noto Sans Devanagari preferred, FreeSans bundled). Without any font file the PDF still works with English labels.
const fs=require('fs'),path=require('path');
module.exports=async(res,{rows,leaves,from,to,who,school})=>{
 const PDF=require('pdfkit'),ff=['NotoSansDevanagari-Regular.ttf','FreeSans.ttf'].map(f=>path.join(__dirname,'fonts',f)).find(fs.existsSync),hi=!!ff,X=(h,e)=>hi?h:e,
 tm=t=>t?new Date(t).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).toUpperCase():'—',dm=d=>d.split('-').reverse().join('/'),
 ST={'On Time':X('समय पर','On Time'),'Late':X('देर से','Late'),'Absent':X('अनुपस्थित','Absent')},
 W=[58,118,58,58,66,50,115],LW=[118,110,90,205],HD=[X('तारीख','Date'),X('नाम','Name'),'IN','OUT',X('स्थिति','Status'),X('देर (मि.)','Late (min)'),X('टिप्पणी','Remarks')],
 doc=new PDF({size:'A4',margin:36,bufferPages:true});
 if(hi)doc.registerFont('F',ff);doc.font(hi?'F':'Helvetica');
 res.type('application/pdf').attachment(`attendance-${from}_${to}.pdf`);doc.pipe(res);
 doc.fontSize(15).text(school||'S.M.S. Jain Public Sr. Sec. School, Momasar',{align:'center'});
 doc.fontSize(11).text(X('उपस्थिति रिपोर्ट','Attendance Report')+': '+dm(from)+' – '+dm(to)+(who?' · '+who:''),{align:'center'});
 let y=doc.y+10;
 const row=(c,w)=>{let x=36;c.forEach((t,i)=>{doc.text(String(t??''),x+2,y,{width:w[i]-4,height:12,ellipsis:true});x+=w[i]})},
 head=(c,w)=>{doc.fontSize(9);row(c,w);doc.moveTo(36,y+13).lineTo(559,y+13).stroke();y+=18},
 nl=(c,w)=>{if(y>780){doc.addPage();y=36;if(c)head(c,w)}};
 head(HD,W);
 for(const r of rows){nl(HD,W);row([dm(r.d),r.name,tm(r.in_time),tm(r.out_time),ST[r.status]||r.status,r.late_min||'',r.in_time&&!r.out_time?X('OUT दर्ज नहीं','OUT not recorded'):''],W);y+=16}
 if(!rows.length){doc.text(X('इस अवधि में कोई उपस्थिति रिकॉर्ड नहीं।','No attendance records.'),38,y);y+=16}
 if(leaves.length){y+=10;nl();doc.fontSize(11).text(X('छुट्टी / आधा दिन (1 आधा दिन = 0.5 छुट्टी)','Leave / Half Day (1 half day = 0.5 leave)'),36,y);y+=18;doc.fontSize(9);
  for(const l of leaves){nl();row([l.name,dm(l.f)+(l.t!==l.f?' – '+dm(l.t):''),l.kind==='half'?X('आधा दिन (0.5)','Half day (0.5)'):X('छुट्टी','Leave'),l.reason],LW);y+=16}}
 const n=doc.bufferedPageRange().count;
 for(let i=0;i<n;i++){doc.switchToPage(i);doc.page.margins.bottom=0;doc.fontSize(8).text(`${i+1}/${n} · ${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}`,36,812,{width:523,align:'right'})}
 doc.end();
};
