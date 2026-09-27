"use strict";
(function(){
var OCR_URL="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
var previewUrl=null,busy=false,loadPromise=null,ocrPassLabel="",pendingReceipt=null;

function e(s){return String(s==null?"":s).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}
function captureHTML(){
  return '<div id="receiptFeatureBox" class="receipt-capture-box full">'+
    '<div class="receipt-capture-head"><div><strong>レシートから入力</strong><div class="small">撮影 → 範囲確認 → 分割OCR → 結果確認 → 支出入力へ反映</div></div></div>'+
    '<div class="receipt-guide"><strong>撮影のコツ</strong><span>レシート全体を画面内に入れ、できるだけ真上から。暗い場所・強い影・背景の映り込みを避けてください。</span></div>'+
    '<div class="receipt-capture-actions">'+
      '<button type="button" id="receiptCameraBtn" class="secondary receipt-camera-btn" aria-label="レシートをカメラで撮影">📷 レシートを撮影</button>'+
      '<button type="button" id="receiptGalleryBtn" class="secondary" aria-label="レシート画像を選択">🖼 画像を選ぶ</button>'+
    '</div>'+
    '<input id="receiptCameraInput" class="receipt-file-input" type="file" accept="image/*" capture="environment">'+
    '<input id="receiptGalleryInput" class="receipt-file-input" type="file" accept="image/*">'+
    '<div class="receipt-privacy-note">OCRエンジン・日本語データの読込には通信を使います。レシート画像そのものはGitHubや家計簿データへ保存しません。</div>'+
    '<div id="receiptOCRStatus" class="receipt-ocr-status" aria-live="polite"></div>'+
    '<div id="receiptOCRPanel"></div>'+
  '</div>';
}
function cleanupPreview(){
  if(previewUrl){try{URL.revokeObjectURL(previewUrl)}catch(_e){}previewUrl=null}
  pendingReceipt=null;
}
function setBusy(v,msg){
  busy=!!v;
  ["receiptCameraBtn","receiptGalleryBtn"].forEach(function(id){var x=document.getElementById(id);if(x)x.disabled=busy});
  var s=document.getElementById("receiptOCRStatus");if(s){s.classList.toggle("busy",busy);s.textContent=msg||""}
}
function progress(m){
  var p=Math.round(Number(m&&m.progress||0)*100);
  var map={"loading tesseract core":"OCRエンジンを読み込み中","initializing tesseract":"OCRを初期化中","loading language traineddata":"日本語データを読み込み中","initializing api":"文字認識を準備中","recognizing text":"レシートを読み取り中"};
  var label=map[m&&m.status]||"レシートを解析中";
  if(ocrPassLabel)label=ocrPassLabel+" "+label;
  setBusy(true,label+"…"+(p?" "+p+"%":""));
}
function loadOCR(){
  if(globalThis.Tesseract&&globalThis.Tesseract.createWorker)return Promise.resolve(globalThis.Tesseract);
  if(loadPromise)return loadPromise;
  loadPromise=new Promise(function(resolve,reject){
    var old=document.querySelector('script[data-receipt-ocr="tesseract"]');
    if(old){
      old.addEventListener("load",function(){globalThis.Tesseract&&globalThis.Tesseract.createWorker?resolve(globalThis.Tesseract):reject(new Error("OCRライブラリを利用できません"))},{once:true});
      old.addEventListener("error",function(){reject(new Error("OCRライブラリの読込に失敗しました"))},{once:true});
      return;
    }
    var s=document.createElement("script");
    s.src=OCR_URL;s.async=true;s.crossOrigin="anonymous";s.referrerPolicy="no-referrer";s.dataset.receiptOcr="tesseract";
    s.onload=function(){globalThis.Tesseract&&globalThis.Tesseract.createWorker?resolve(globalThis.Tesseract):reject(new Error("OCRライブラリを利用できません"))};
    s.onerror=function(){reject(new Error("OCRライブラリの読込に失敗しました。通信状態を確認してください。"))};
    document.head.appendChild(s);
  }).catch(function(err){loadPromise=null;throw err});
  return loadPromise;
}
function loadBitmap(file){
  if(globalThis.createImageBitmap)return createImageBitmap(file);
  var url=URL.createObjectURL(file);
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.onload=function(){URL.revokeObjectURL(url);resolve(img)};
    img.onerror=function(){URL.revokeObjectURL(url);reject(new Error("画像を開けませんでした"))};
    img.src=url;
  });
}

function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function sourceCanvasFromImage(img,maxSide,maxPixels){
  var w=Number(img.width||img.naturalWidth||0),h=Number(img.height||img.naturalHeight||0);
  if(!w||!h)throw new Error("画像サイズを取得できません");
  var scale=Math.min(1,(maxSide||2800)/Math.max(w,h));
  if(w*h*scale*scale>(maxPixels||6500000))scale=Math.sqrt((maxPixels||6500000)/(w*h));
  var cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale)),canvas=document.createElement("canvas");
  canvas.width=cw;canvas.height=ch;canvas.getContext("2d",{willReadFrequently:true}).drawImage(img,0,0,cw,ch);
  return canvas;
}
function detectReceiptBounds(canvas){
  var maxW=260,maxH=360,scale=Math.min(1,maxW/canvas.width,maxH/canvas.height),w=Math.max(40,Math.round(canvas.width*scale)),h=Math.max(40,Math.round(canvas.height*scale));
  var sm=document.createElement("canvas");sm.width=w;sm.height=h;var ctx=sm.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
  var im=ctx.getImageData(0,0,w,h),d=im.data,lum=new Float32Array(w*h),sum=0;
  for(var i=0,p=0;i<d.length;i+=4,p++){var mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]),l=.299*d[i]+.587*d[i+1]+.114*d[i+2];lum[p]=l;sum+=l}
  var mean=sum/(w*h),thr=clamp(mean+22,145,215),mask=new Uint8Array(w*h);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){var p=y*w+x,ii=p*4,mx=Math.max(d[ii],d[ii+1],d[ii+2]),mn=Math.min(d[ii],d[ii+1],d[ii+2]),chroma=mx-mn;if(lum[p]>=thr&&chroma<85)mask[p]=1}
  var seen=new Uint8Array(w*h),best=null,stack=[];
  for(var sy=0;sy<h;sy+=2)for(var sx=0;sx<w;sx+=2){
    var sp=sy*w+sx;if(!mask[sp]||seen[sp])continue;
    stack.length=0;stack.push(sp);seen[sp]=1;var minX=sx,maxX=sx,minY=sy,maxY=sy,count=0;
    while(stack.length){
      var p=stack.pop(),py=Math.floor(p/w),px=p-py*w;count++;if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;
      var ns=[p-1,p+1,p-w,p+w];
      for(var ni=0;ni<4;ni++){var np=ns[ni];if(np<0||np>=w*h||seen[np]||!mask[np])continue;var ny=Math.floor(np/w),nx=np-ny*w;if(Math.abs(nx-px)+Math.abs(ny-py)!==1)continue;seen[np]=1;stack.push(np)}
    }
    var bw=maxX-minX+1,bh=maxY-minY+1,area=bw*bh,fill=count/area,aspect=bh/Math.max(1,bw),cx=(minX+maxX)/2/w,cy=(minY+maxY)/2/h,centerPenalty=Math.abs(cx-.5)*1.6+Math.abs(cy-.5)*.35;
    if(area>w*h*.055&&bh>h*.28&&aspect>.9&&fill>.26){
      var score=area*(.7+Math.min(2.5,aspect)*.25)*fill*(1-clamp(centerPenalty,0,.65));
      if(!best||score>best.score)best={minX:minX,maxX:maxX,minY:minY,maxY:maxY,score:score};
    }
  }
  if(!best)return{x:.08,y:.03,w:.84,h:.94,detected:false};
  var padX=Math.max(3,(best.maxX-best.minX)*.045),padY=Math.max(3,(best.maxY-best.minY)*.025);
  var x1=clamp((best.minX-padX)/w,0,1),x2=clamp((best.maxX+padX)/w,0,1),y1=clamp((best.minY-padY)/h,0,1),y2=clamp((best.maxY+padY)/h,0,1);
  if(x2-x1<.22||y2-y1<.35)return{x:.08,y:.03,w:.84,h:.94,detected:false};
  return{x:x1,y:y1,w:x2-x1,h:y2-y1,detected:true};
}
function cropFromSliders(){
  if(!pendingReceipt)return null;
  var l=Number(document.getElementById("receiptCropLeft")?.value||0)/100,r=Number(document.getElementById("receiptCropRight")?.value||100)/100,t=Number(document.getElementById("receiptCropTop")?.value||0)/100,b=Number(document.getElementById("receiptCropBottom")?.value||100)/100;
  if(r-l<.08){r=Math.min(1,l+.08)}if(b-t<.12){b=Math.min(1,t+.12)}
  return{x:clamp(l,0,.92),y:clamp(t,0,.88),w:clamp(r-l,.08,1),h:clamp(b-t,.12,1)};
}
function setCropSliders(crop){
  var vals={receiptCropLeft:Math.round(crop.x*100),receiptCropRight:Math.round((crop.x+crop.w)*100),receiptCropTop:Math.round(crop.y*100),receiptCropBottom:Math.round((crop.y+crop.h)*100)};
  Object.keys(vals).forEach(function(id){var el=document.getElementById(id);if(el)el.value=String(vals[id])});
  pendingReceipt.crop=crop;drawCropPreview();
}
function drawCropPreview(){
  if(!pendingReceipt)return;
  var canvas=document.getElementById("receiptCropPreview"),src=pendingReceipt.source;if(!canvas||!src)return;
  var max=620,scale=Math.min(1,max/src.width),w=Math.max(1,Math.round(src.width*scale)),h=Math.max(1,Math.round(src.height*scale));
  canvas.width=w;canvas.height=h;var ctx=canvas.getContext("2d");ctx.drawImage(src,0,0,w,h);
  var crop=cropFromSliders()||pendingReceipt.crop;pendingReceipt.crop=crop;
  var x=crop.x*w,y=crop.y*h,cw=crop.w*w,ch=crop.h*h;
  ctx.save();ctx.fillStyle="rgba(0,0,0,.52)";ctx.fillRect(0,0,w,h);ctx.clearRect(x,y,cw,ch);ctx.drawImage(src,crop.x*src.width,crop.y*src.height,crop.w*src.width,crop.h*src.height,x,y,cw,ch);ctx.strokeStyle="#22c55e";ctx.lineWidth=Math.max(2,w/180);ctx.strokeRect(x+1,y+1,Math.max(1,cw-2),Math.max(1,ch-2));ctx.restore();
  var info=document.getElementById("receiptCropInfo");if(info)info.textContent="読み取り範囲："+Math.round(crop.w*100)+"% × "+Math.round(crop.h*100)+"%";
}
function renderCropConfirm(){
  var panel=document.getElementById("receiptOCRPanel");if(!panel||!pendingReceipt)return;
  panel.innerHTML='<div class="receipt-crop-card">'+
    '<div class="receipt-result-title"><strong>この範囲を読み取ります</strong><span class="small">緑の枠にレシートだけが入るよう調整してください。</span></div>'+
    '<canvas id="receiptCropPreview" class="receipt-crop-preview" aria-label="レシート読み取り範囲プレビュー"></canvas>'+
    '<div id="receiptCropInfo" class="small"></div>'+
    '<div class="receipt-crop-controls">'+
      '<label>左<input id="receiptCropLeft" type="range" min="0" max="90" step="1"></label>'+
      '<label>右<input id="receiptCropRight" type="range" min="10" max="100" step="1"></label>'+
      '<label>上<input id="receiptCropTop" type="range" min="0" max="88" step="1"></label>'+
      '<label>下<input id="receiptCropBottom" type="range" min="12" max="100" step="1"></label>'+
    '</div>'+
    '<div class="receipt-crop-actions"><button type="button" id="receiptAutoCropBtn" class="secondary">範囲を自動検出</button><button type="button" id="receiptFullCropBtn" class="secondary">画像全体を使う</button></div>'+
    '<div class="receipt-result-actions"><button type="button" id="receiptCropRetakeBtn" class="secondary">↻ 撮り直す</button><button type="button" id="receiptCropReadBtn" class="primary">この範囲で読み取る</button></div>'+
  '</div>';
  setCropSliders(pendingReceipt.crop);
  ["receiptCropLeft","receiptCropRight","receiptCropTop","receiptCropBottom"].forEach(function(id){document.getElementById(id).oninput=drawCropPreview});
  document.getElementById("receiptAutoCropBtn").onclick=function(){setCropSliders(pendingReceipt.detectedCrop)};
  document.getElementById("receiptFullCropBtn").onclick=function(){setCropSliders({x:0,y:0,w:1,h:1})};
  document.getElementById("receiptCropRetakeBtn").onclick=function(){var x=document.getElementById("receiptCameraInput");if(x)x.click()};
  document.getElementById("receiptCropReadBtn").onclick=readConfirmedReceipt;
}
function cropCanvas(source,crop){
  var sx=Math.round(crop.x*source.width),sy=Math.round(crop.y*source.height),sw=Math.max(1,Math.round(crop.w*source.width)),sh=Math.max(1,Math.round(crop.h*source.height));
  sx=clamp(sx,0,source.width-1);sy=clamp(sy,0,source.height-1);sw=Math.min(sw,source.width-sx);sh=Math.min(sh,source.height-sy);
  var out=document.createElement("canvas");out.width=sw;out.height=sh;out.getContext("2d",{willReadFrequently:true}).drawImage(source,sx,sy,sw,sh,0,0,sw,sh);return out;
}
function estimateSkew(canvas){
  var targetW=Math.min(360,canvas.width),scale=targetW/canvas.width,w=targetW,h=Math.max(40,Math.round(canvas.height*scale)),sm=document.createElement("canvas");sm.width=w;sm.height=h;var ctx=sm.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
  var d=ctx.getImageData(0,0,w,h).data,dark=[];for(var y=0;y<h;y+=2)for(var x=0;x<w;x+=2){var i=(y*w+x)*4,l=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(l<145)dark.push([x,y])}
  if(dark.length<120)return 0;
  function score(deg){var tan=Math.tan(deg*Math.PI/180),rows=new Uint16Array(h+40),off=20;for(var k=0;k<dark.length;k++){var pt=dark[k],yy=Math.round(pt[1]+tan*(pt[0]-w/2))+off;if(yy>=0&&yy<rows.length)rows[yy]++}var s=0;for(var j=0;j<rows.length;j++)s+=rows[j]*rows[j];return s}
  var base=score(0),best={a:0,s:base};for(var a=-4;a<=4;a+=1){var sc=score(a);if(sc>best.s)best={a:a,s:sc}}
  return best.s>base*1.025?best.a:0;
}
function rotateCanvas(canvas,deg){
  if(!deg||Math.abs(deg)<.3)return canvas;var rad=deg*Math.PI/180,w=canvas.width,h=canvas.height,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad)),nw=Math.ceil(w*c+h*s),nh=Math.ceil(w*s+h*c),out=document.createElement("canvas");out.width=nw;out.height=nh;var ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#fff";ctx.fillRect(0,0,nw,nh);ctx.translate(nw/2,nh/2);ctx.rotate(rad);ctx.drawImage(canvas,-w/2,-h/2);return out;
}
function makeOCRSlice(canvas,start,end){
  var sy=Math.floor(canvas.height*start),ey=Math.ceil(canvas.height*end),h=Math.max(1,ey-sy),out=document.createElement("canvas");out.width=canvas.width;out.height=h;out.getContext("2d").drawImage(canvas,0,sy,canvas.width,h,0,0,canvas.width,h);return out;
}
function makeOCRScaledSlice(canvas,start,end,scale){
  var src=makeOCRSlice(canvas,start,end),k=Math.max(1,Number(scale||1)),out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(src.width*k));out.height=Math.max(1,Math.round(src.height*k));
  var ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#fff";ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(src,0,0,out.width,out.height);return out;
}
function makeOCRRegion(canvas,x1,y1,x2,y2,scale){
  var sx=Math.max(0,Math.floor(canvas.width*x1)),sy=Math.max(0,Math.floor(canvas.height*y1)),ex=Math.min(canvas.width,Math.ceil(canvas.width*x2)),ey=Math.min(canvas.height,Math.ceil(canvas.height*y2));
  var sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy),k=Math.max(1,Number(scale||1)),out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(sw*k));out.height=Math.max(1,Math.round(sh*k));
  var ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#fff";ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(canvas,sx,sy,sw,sh,0,0,out.width,out.height);return out;
}
function makeOCRPixelRegion(canvas,x1,y1,x2,y2,scale){
  var sx=Math.max(0,Math.floor(x1)),sy=Math.max(0,Math.floor(y1)),ex=Math.min(canvas.width,Math.ceil(x2)),ey=Math.min(canvas.height,Math.ceil(y2));
  var sw=Math.max(1,ex-sx),sh=Math.max(1,ey-sy),k=Math.max(1,Number(scale||1)),out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(sw*k));out.height=Math.max(1,Math.round(sh*k));
  var ctx=out.getContext("2d",{willReadFrequently:true});ctx.fillStyle="#fff";ctx.fillRect(0,0,out.width,out.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";ctx.drawImage(canvas,sx,sy,sw,sh,0,0,out.width,out.height);return out;
}
function focusedTextVariant(canvas,x1,y1,x2,y2,scale,kind){
  var out=makeOCRPixelRegion(canvas,x1,y1,x2,y2,scale),ctx=out.getContext("2d",{willReadFrequently:true});
  try{
    var im=ctx.getImageData(0,0,out.width,out.height),d=im.data,hist=new Uint32Array(256),sum=0,count=out.width*out.height;
    for(var i=0;i<d.length;i+=4){
      var lum=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);hist[lum]++;sum+=lum;
      d[i]=d[i+1]=d[i+2]=lum;d[i+3]=255;
    }
    if(kind==="contrast"){
      var mean=count?sum/count:180;
      for(var j=0;j<d.length;j+=4){var v=clamp((d[j]-mean)*1.85+mean+8,0,255);d[j]=d[j+1]=d[j+2]=v}
    }else if(kind==="binary"){
      var total=count,sumAll=0;for(var h=0;h<256;h++)sumAll+=h*hist[h];
      var sumB=0,wB=0,maxVar=0,thr=178;
      for(var t=0;t<256;t++){wB+=hist[t];if(!wB)continue;var wF=total-wB;if(!wF)break;sumB+=t*hist[t];var mB=sumB/wB,mF=(sumAll-sumB)/wF,vv=wB*wF*(mB-mF)*(mB-mF);if(vv>maxVar){maxVar=vv;thr=t}}
      thr=clamp(thr+3,125,215);
      for(var q=0;q<d.length;q+=4){var bv=d[q]<thr?0:255;d[q]=d[q+1]=d[q+2]=bv}
    }else if(kind==="sharp"){
      var src=new Uint8ClampedArray(d),w=out.width,hh=out.height;
      for(var y=1;y<hh-1;y++)for(var x=1;x<w-1;x++){
        var p=(y*w+x)*4,c0=src[p],up=src[p-w*4],dn=src[p+w*4],lf=src[p-4],rt=src[p+4];
        var sv=clamp(c0*5-up-dn-lf-rt,0,255);d[p]=d[p+1]=d[p+2]=sv;
      }
    }
    ctx.putImageData(im,0,0);
  }catch(_e){}
  return out;
}
function ocrBlockLines(blocks){
  var out=[];
  (blocks||[]).forEach(function(block){
    (block&&block.paragraphs||[]).forEach(function(par){
      (par&&par.lines||[]).forEach(function(line){
        if(!line)return;
        var text=normalize(line.text||""),bbox=line.bbox||null,words=line.words||[];
        if(text&&bbox)out.push({text:text,bbox:bbox,words:words});
      });
    });
  });
  return out;
}
function bboxPad(bbox,w,h,xPad,yPad){
  if(!bbox)return null;
  var x0=clamp(Number(bbox.x0||0)-xPad,0,w),y0=clamp(Number(bbox.y0||0)-yPad,0,h);
  var x1=clamp(Number(bbox.x1||w)+xPad,0,w),y1=clamp(Number(bbox.y1||h)+yPad,0,h);
  if(x1-x0<8||y1-y0<6)return null;
  return{x0:x0,y0:y0,x1:x1,y1:y1};
}
function priceWordStart(words,value){
  value=Number(value||0);var best=null;
  (words||[]).forEach(function(word){
    var t=ocrMoneyClean(String(word&&word.text||"")),n=numberFromLine(t),b=word&&word.bbox;
    if(n===value&&b&&Number.isFinite(Number(b.x0))){if(best==null||Number(b.x0)<best)best=Number(b.x0)}
  });
  return best;
}
function anchoredProductLineFromBlocks(blocks,fullText,w,h){
  var amountInfo=analyzeAmount(fullText,""),target=Number(amountInfo.amount||0),discounts=receiptDiscountValues(fullText);
  if(!target||!discounts.values.length)return null;
  var lines=ocrBlockLines(blocks),candidates=[];
  lines.forEach(function(line){
    var txt=ocrMoneyClean(line.text),value=numberFromLine(txt),needed=value-target;
    if(!value||value<=target||needed<=0||discounts.values.indexOf(needed)<0)return;
    if(/総合計|合計金額|合計|小計|税込|消費税|内税|外税|お支払|現金|cash|お?預り|お?釣|値引|割引|クーポン|ポイント|アンケート/i.test(txt))return;
    var box=line.bbox||{},bh=Math.max(1,Number(box.y1||0)-Number(box.y0||0));
    var score=40+(discounts.counts[needed]||0)*20+productMeaningfulScore(txt);
    if(/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(txt))score+=20;
    if(value>=100&&value<=100000)score+=10;
    candidates.push({line:line,value:value,discount:needed,score:score,height:bh});
  });
  candidates.sort(function(a,b){return b.score-a.score||a.line.bbox.y0-b.line.bbox.y0});
  if(!candidates.length)return null;
  var best=candidates[0],line=best.line,padY=Math.max(5,Math.round(best.height*.50)),tightPadY=Math.max(2,Math.round(best.height*.18)),padX=Math.max(10,Math.round(w*.018));
  var fullBox=bboxPad(line.bbox,w,h,padX,padY),tightBox=bboxPad(line.bbox,w,h,padX,tightPadY);if(!fullBox||!tightBox)return null;
  var pw=priceWordStart(line.words,best.value),nameBox=null;
  if(pw!=null&&pw>tightBox.x0+30){
    var priceGap=Math.max(3,Math.round(w*.004));
    nameBox={x0:tightBox.x0,y0:tightBox.y0,x1:clamp(pw-priceGap,tightBox.x0+30,w),y1:tightBox.y1};
  }
  return{value:best.value,discount:best.discount,text:line.text,fullBox:fullBox,tightBox:tightBox,nameBox:nameBox};
}
function anchoredProductSlices(bundle,wholeResult,fullText){
  var blocks=wholeResult&&wholeResult.data&&wholeResult.data.blocks||[],canvas=bundle.gray,anchor=anchoredProductLineFromBlocks(blocks,fullText,canvas.width,canvas.height);
  if(!anchor)return{anchor:null,slices:[]};
  var out=[],b=anchor.fullBox;
  if(anchor.nameBox){
    var n=anchor.nameBox,base=bundle.base||canvas;
    out.push({canvas:makeOCRPixelRegion(base,n.x0,n.y0,n.x1,n.y1,5.0),mode:"7",label:"商品価格座標・名前カラー",anchorValue:anchor.value,appendPrice:true});
    out.push({canvas:focusedTextVariant(canvas,n.x0,n.y0,n.x1,n.y1,5.2,"contrast"),mode:"7",label:"商品価格座標・名前強調",anchorValue:anchor.value,appendPrice:true});
    out.push({canvas:focusedTextVariant(base,n.x0,n.y0,n.x1,n.y1,5.2,"binary"),mode:"7",label:"商品価格座標・名前二値",anchorValue:anchor.value,appendPrice:true});
    out.push({canvas:focusedTextVariant(canvas,n.x0,n.y0,n.x1,n.y1,5.0,"sharp"),mode:"13",label:"商品価格座標・名前シャープRaw",anchorValue:anchor.value,appendPrice:true});
  }
  out.push({canvas:makeOCRPixelRegion(canvas,b.x0,b.y0,b.x1,b.y1,4.2),mode:"7",label:"商品価格座標・全行",anchorValue:anchor.value,appendPrice:false});
  return{anchor:anchor,slices:out};
}
function normalizeAnchoredOCRText(text,anchorValue,appendPrice){
  var t=normalize(text).replace(/\n+/g," ").replace(/\s+/g," ").trim();
  if(!t)return"";
  if(appendPrice&&Number(anchorValue||0)>0&&numberFromLine(t)!==Number(anchorValue))t+=" ¥"+Number(anchorValue);
  return t;
}
function cleanFocusedProductName(text,anchorValue){
  var raw=normalize(text).replace(/\n+/g," ").replace(/\s+/g," ").trim();
  if(!raw)return"";
  var bracket=raw.match(/[【\[「『(（]\s*([^】\]」』)）]{2,42})\s*[】\]」』)）]/);
  var s=bracket?bracket[1]:raw;
  if(Number(anchorValue||0)>0){
    var value=String(Number(anchorValue)).replace(/\B(?=(\d{3})+(?!\d))/g,",");
    s=s.replace(new RegExp("(?:¥|￥|\\\\|Y)?\\s*"+value.replace(",","[,]?")+"(?:\\s*円)?","gi")," ");
    s=s.replace(new RegExp("(?:¥|￥|\\\\|Y)?\\s*"+String(Number(anchorValue))+"(?:\\s*円)?","gi")," ");
  }
  s=s.replace(/[【\[「『(（】\]」』)）]/g," ");
  s=s.replace(/^\s*(?:E|F|I|L|l|\||1)\s*(?=[ぁ-んァ-ヶ一-龠A-Za-z0-9])/i,"");
  s=s.replace(/^\s*[>＞\-—_・:：|]+\s*/,"");
  s=s.replace(/\s+(?:x|×)?\s*[0-9]{1,3}\s*$/i,"");
  s=s.replace(/\s+(?:欄夫を|欄夫|個夫を|個夫|様夫を|様夫)\s*$/,"");
  s=s.replace(/(?:セト)\s*$/,"セット");
  s=s.replace(/\s+/g," ").trim();
  s=normalizeProductName(s);
  return s.replace(/^\s*(?:E|F|I|L|l)\s*/i,"").replace(/\s+/g," ").trim();
}
function focusedProductNamePlausible(name){
  var s=normalizeProductName(name),hira=(s.match(/[ぁ-ん]/g)||[]).length,kata=(s.match(/[ァ-ヶー]/g)||[]).length,kanji=(s.match(/[一-龠]/g)||[]).length,latin=(s.match(/[A-Za-z]/g)||[]).length;
  if(!s||s.length<4||s.length>36)return false;
  if(/^(?:商品名要確認|商品|メニュー|セット)$/i.test(s))return false;
  if(/^(?:[0-9０-９])(?=[ぁ-んァ-ヶ一-龠])/.test(s)&&!/^(?:7UP|100%|24h)/i.test(s))return false;
  if(/(?:店舗|問い合わせ|領収|会員|合計|割引|クーポン|消費税|現金|お釣|アンケート)/i.test(s))return false;
  if(hira>=4&&kata<=2&&kanji===0&&latin===0)return false;
  if(kata+kanji+latin<3)return false;
  if(productMeaningfulScore(s)<22||isGarbageProductName(s))return false;
  return true;
}
function focusedProductCandidatePlausible(name){
  var s=normalizeProductName(name),jp=(s.match(/[ぁ-んァ-ヶ一-龠]/g)||[]).length,latin=(s.match(/[A-Za-z]/g)||[]).length;
  if(!s||s.length<3||s.length>40)return false;
  if(/(?:店舗|問い合わせ|領収|会員|合計|割引|クーポン|消費税|現金|お釣|アンケート|電話|レジ)/i.test(s))return false;
  if(/^(?:商品名要確認|商品|メニュー)$/i.test(s))return false;
  if(jp+latin<3)return false;
  if(productMeaningfulScore(s)<12)return false;
  return true;
}
function focusedProductNameNatural(name,context){
  var s=normalizeProductName(name),shop=String(context&&context.shop||"");
  if(!s)return false;
  if(/["'“”‘’<>={}^~]/.test(s))return false;
  if(/[ぁ-んァ-ヶ一-龠][0-9０-９][ぁ-んァ-ヶ一-龠]/.test(s))return false;
  if(/^[0-9０-９]+[ぁ-んァ-ヶ一-龠]/.test(s)&&!/^(?:7UP|100%|24h)/i.test(s))return false;
  if(/バーガーキング|burger\s*king/i.test(shop)){
    // "セット" alone is too generic to upgrade a noisy Burger King OCR to confirmed.
    if(!/(?:ワッパー|チーズ|バーガー|フライ|ドリンク|ナゲット|オニオン|アボカド|テリヤキ)/i.test(s))return false;
  }
  return true;
}
function focusedProductConsensus(entries,anchorValue,context){
  var normalized=(entries||[]).map(function(x){
    var raw=typeof x==="string"?x:String(x&&x.text||""),family=typeof x==="string"?"unknown":String(x&&x.family||x&&x.label||"unknown");
    return{raw:raw,name:cleanFocusedProductName(raw,anchorValue),family:family};
  }).filter(function(x){return !!x.name});
  var unique=[];
  normalized.forEach(function(x){if(!unique.some(function(u){return u.name===x.name}))unique.push(x)});
  if(!unique.length)return{attempted:false,accepted:false,name:"",candidateName:"",support:0,familySupport:0,score:0,candidates:[],confidenceLevel:"low",rejectionReason:"empty_after_cleanup",value:Number(anchorValue||0),rawProductLine:"",normalizedProductLine:""};
  var scored=unique.map(function(entry){
    var name=entry.name,support=0,sum=0,peers=0,maxSim=0,families={};
    normalized.forEach(function(other){
      var sim=productSimilarity(name,other.name);
      if(other.name!==name){sum+=sim;peers++;if(sim>maxSim)maxSim=sim}
      if(sim>=.58){support++;families[other.family]=1}
    });
    var avg=peers?sum/peers:0,strict=focusedProductNamePlausible(name),candidate=focusedProductCandidatePlausible(name),natural=focusedProductNameNatural(name,context);
    var familySupport=Object.keys(families).length,leadingDigit=/^[0-9０-９]/.test(name)?-18:0;
    var score=productMeaningfulScore(name)+support*10+familySupport*22+avg*20+leadingDigit+(strict?16:0)+(natural?14:-24)+(candidate?5:0);
    return{raw:entry.raw,name:name,support:support,familySupport:familySupport,avg:avg,maxSim:maxSim,score:score,strict:strict,natural:natural,candidate:candidate};
  }).sort(function(a,b){return b.familySupport-a.familySupport||b.support-a.support||b.score-a.score||b.avg-a.avg});
  var best=scored[0],confirmed=!!best&&best.strict&&best.natural&&best.familySupport>=2&&best.maxSim>=.58;
  var candidateBest=scored.find(function(x){return x.candidate})||null;
  var candidateName=!confirmed&&candidateBest?candidateBest.name:"";
  var confidence=confirmed?"high":candidateName?"medium":"low",reason="no_consensus";
  if(confirmed)reason="accepted_as_confirmed";
  else if(best&&best.familySupport<2)reason="same_source_family_only";
  else if(best&&!best.natural)reason="unnatural_name";
  else if(candidateName)reason=(unique.length===1?"single_candidate_only":"accepted_as_candidate");
  else if(best&&best.name.length<3)reason="too_short";
  else if(best)reason="too_noisy";
  return{
    attempted:true,accepted:confirmed,name:confirmed?best.name:"",candidateName:candidateName,
    support:best?best.support:0,familySupport:best?best.familySupport:0,score:best?best.score:0,
    candidates:scored.slice(0,3).map(function(x){return x.name}),
    confidenceLevel:confidence,rejectionReason:reason,value:Number(anchorValue||0),
    rawProductLine:best?best.raw:"",normalizedProductLine:best?best.name:""
  };
}
async function prepareImage(file){
  if(!file)throw new Error("画像が選択されていません");
  if(String(file.type||"").indexOf("image/")!==0)throw new Error("画像ファイルを選んでください");
  if(Number(file.size||0)>25*1024*1024)throw new Error("画像が大きすぎます。25MB以下の画像を使用してください");
  setBusy(true,"撮影画像を確認用に準備しています…");
  var img=await loadBitmap(file),source=sourceCanvasFromImage(img,2800,6500000);
  try{if(img.close)img.close()}catch(_e){}
  var detected=detectReceiptBounds(source);
  pendingReceipt={source:source,crop:{x:detected.x,y:detected.y,w:detected.w,h:detected.h},detectedCrop:{x:detected.x,y:detected.y,w:detected.w,h:detected.h},detected:detected.detected};
  cleanupPreview();
  pendingReceipt={source:source,crop:{x:detected.x,y:detected.y,w:detected.w,h:detected.h},detectedCrop:{x:detected.x,y:detected.y,w:detected.w,h:detected.h},detected:detected.detected};
  var blob=await new Promise(function(resolve){source.toBlob(resolve,"image/jpeg",.88)});if(blob)previewUrl=URL.createObjectURL(blob);
  setBusy(false,detected.detected?"レシート範囲を自動検出しました。緑の枠を確認してください。":"自動検出が不確実です。緑の枠を調整してください。");
  renderCropConfirm();
  return pendingReceipt;
}
function normalize(text){return String(text||"").replace(/\r/g,"").replace(/[￥]/g,"¥").replace(/[，]/g,",").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim()}
function numberFromLine(line){
  var s=ocrMoneyClean(line),re=/(?:¥|\\|Y)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,7})(?:\s*円)?/g,m,vals=[];
  while((m=re.exec(s))){var n=Number(m[1].replace(/,/g,""));if(Number.isFinite(n)&&n>0&&n<=1000000)vals.push(n)}
  return vals.length?vals[vals.length-1]:0;
}
function ocrMoneyClean(line){
  var s=String(line||"").replace(/[￥]/g,"¥").replace(/[，]/g,",").replace(/[．。]/g,".");
  s=s.replace(/([0-9])[OoＯ](?=[0-9])/g,"$10").replace(/([0-9])[Il｜](?=[0-9])/g,"$11");
  s=s.replace(/([0-9])\.([0-9]{3})(?![0-9])/g,"$1,$2");
  return s;
}
function isChangeCueText(text){
  return /(?:お\s*(?:釣|つ|的)\s*り?|釣銭)/i.test(normalize(text));
}
function receiptCashSummary(text){
  var tender=0,change=0;
  normalize(text).split("\n").forEach(function(raw){
    var line=ocrMoneyClean(String(raw||"").trim()),n=numberFromLine(line);if(!n)return;
    if(/(?:現金|cash|お?預り|預り|預かり)/i.test(line))tender=tender||n;
    if(isChangeCueText(line))change=change||n;
  });
  return{tender:tender,change:change};
}
function taxAmountFromLine(line){
  var s=ocrMoneyClean(String(line||""));
  if(!/(?:消費税|税額|内税|外税|税\s*[0-9])/i.test(s))return 0;
  var m=s.match(/(?:消費税|税額|内税|外税|税)\s*[:：]?\s*(?:¥|￥|\\|Y)?\s*([0-9]{1,7})(?!\s*[%％])/i);
  if(m){
    var n=Number(m[1]||0);
    if(n>0&&n<=1000000)return n;
  }
  // A rate statement such as "8%対象(軽減税率・外税)" is not a tax amount.
  if(/(?:8|10)\s*[%％]/i.test(s))return 0;
  return 0;
}
function moneyLineExcluded(line){
  return /(ポイント|合計P|今回P|前回累計|残高|お?預り|お\s*(?:釣|つ|的)\s*り?|釣銭|消費税|内税|外税|税率|登録番号|取引ID|受付番号|カードNo|TEL|電話|〒|レジ|バーコード|対象金額)/i.test(String(line||""));
}
function mergeOCRTexts(a,b){
  var seen={},out=[];
  [a,b].forEach(function(txt){normalize(txt).split("\n").forEach(function(line){var x=line.trim(),key=x.replace(/\s+/g,"").toLowerCase();if(!x||!key||seen[key])return;seen[key]=1;out.push(x)})});
  return out.join("\n");
}
function maskReceiptDebugText(text){
  var s=String(text||"");
  s=s.replace(/((?:メンバーシップ|会員)\s*(?:会員)?番号\s*[:：]?\s*)[A-Za-z0-9-]{5,}/gi,"$1[マスク]");
  s=s.replace(/((?:アンケートコード|取引ID|承認番号|伝票番号|受付番号|カード番号)\s*[:：]?\s*)[A-Za-z0-9-]{5,}/gi,"$1[マスク]");
  s=s.replace(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g,"[電話番号マスク]");
  s=s.replace(/\[(?:POS|レジ)[A-Za-z0-9-]{4,}\]/gi,"[レシート番号マスク]");
  s=s.replace(/\b(?:\d[ -]?){10,}\b/g,function(m){return /\d{10,}/.test(m.replace(/\D/g,""))?"[番号マスク]":m});
  return s;
}
function findCategoryPair(groupName,subName){
  var g=state.categories.find(function(x){return x.name===groupName}),s=g&&g.subs.find(function(x){return x.name===subName});
  return g&&s?{categoryId:g.id,subcategoryId:s.id,groupName:g.name,subName:s.name,label:g.name+" ＞ "+s.name}:null;
}


function receiptHeaderPattern(){
  return /営業時間|営業\s*時間|(?:19|20)?\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{2,4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*時\s*\d{1,2}\s*分|\b\d{1,2}:\d{2}\b|[\(（][日月火水木金土][\)）]|(?:TEL|電話|〒|登録番号|取引ID|受付番号|レシート\s*No|伝票\s*No|カード\s*No|カード番号|店番号|店舗番号|店\s*[:：]|レジ\s*[:：]?|担当|係員|スタッフ|責任者|端末番号|バーコード|領収証|レシート|No[.．:]?\s*\d{3,})|(?:^|\s)\d{8,}(?:\s|$)/i;
}
function stripReceiptHeaderNoise(name){
  var original=String(name||""),s=original.normalize?original.normalize("NFKC"):original,hadHeader=receiptHeaderPattern().test(s);
  s=s.replace(/(?:19|20)?\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*(?:[\(（][日月火水木金土][\)）])?/g," ");
  s=s.replace(/\d{2,4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/g," ");
  s=s.replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g," ");
  s=s.replace(/\d{1,2}\s*時\s*\d{1,2}\s*分/g," ");
  s=s.replace(/\d{1,2}:\d{2}/g," ");
  s=s.replace(/[\(（][日月火水木金土][\)）]/g," ");
  s=s.replace(/(?:TEL|電話|〒|登録番号|取引ID|受付番号|レシート\s*No|伝票\s*No|カード\s*No|カード番号|店番号|店舗番号|店\s*[:：]|レジ\s*[:：]?|担当|係員|スタッフ|責任者|端末番号|バーコード|No[.．:]?)\s*[A-Za-z0-9\-:：.]*/gi," ");
  s=s.replace(/(?:^|\s)\d{8,}(?=\s|$)/g," ");
  s=s.replace(/(^|\s)#?\d{3,6}(?=\s+[A-Za-zぁ-んァ-ヶ一-龠])/g,"$1");
  s=s.replace(/^\s*[#※*・.,、。，_\-]+\s*/,"");
  if(hadHeader){
    s=s.replace(/^\s*[ぁ-んァ-ヶ一-龠]{1,2}\s+(?=[A-Za-z]{2,}\b)/,"");
    s=s.replace(/^\s*[ぁ-んァ-ヶ一-龠]{1,2}(?=[A-Za-z]{2,}\b)/,"");
  }
  s=s.replace(/\s+/g," ").trim();
  return s;
}
function isReceiptHeaderLine(line){
  var s=normalize(line);
  if(!s)return true;
  if(receiptHeaderPattern().test(s))return true;
  if(/^\s*#?\d{3,6}\s*$/.test(s))return true;
  if(/(?:^|\s)#\d{3,8}(?:\s|$)/.test(s))return true;
  var digits=(s.match(/\d/g)||[]).length,letters=(s.match(/[ぁ-んァ-ヶ一-龠A-Za-z]/g)||[]).length;
  if(digits>=8&&letters<3)return true;
  return false;
}
function classifyReceiptLine(line){
  var s=normalize(line);
  if(!s)return"empty";
  if(/楽天\s*(?:pay|ペイ|べイ|へイ)|rakuten\s*pay|(?:^|\s)r\s*pay(?:\s|$)|paypay|d払い|au\s*pay|クレジット|visa|master\s*card|mastercard|\bjcb\b|amex|現金|cash/i.test(s))return"payment";
  if(/総合計|合計|小計|税込|お支払|お?預り|お\s*(?:釣|つ|的)\s*り?|釣銭|消費税|内税|外税|税率|軽減税率|対象金額|ポイント|合計P|値引|割引|クーポン/i.test(s))return"accounting";
  if(/^\s*[@＠]?\s*\d{1,6}\s+(?:[x×]\s*)?\d{1,3}\s+(?:¥\s*)?\d{1,7}\s*$/i.test(ocrMoneyClean(s)))return"quantity";
  if(isReceiptHeaderLine(s))return"header";
  return"product";
}
function productSourceText(text){
  return normalize(text).split("\n").map(function(line){
    var s=line.trim();
    if(!s)return"";
    var kind=classifyReceiptLine(s);
    if(kind==="payment"||kind==="accounting")return"";
    if(kind==="header"){
      var stripped=stripReceiptHeaderNoise(s);
      var core=stripped.replace(/[0-9０-９.,．\s¥￥@*_#\-＝=]/g,"");
      if(core.length<2||!/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(stripped))return"";
      return stripped;
    }
    return s;
  }).filter(Boolean).join("\n");
}
function paymentFromSources(bottom,raw,whole){
  return paymentFromText(bottom)||paymentFromText(raw)||paymentFromText(whole);
}
function normalizeProductName(name){
  var raw=String(name||""),s=stripReceiptHeaderNoise(raw);
  s=s.normalize?s.normalize("NFKC"):s;
  s=s.replace(/[\r\n]+/g," ").replace(/[◎○●※◆◇■□★☆⑧⑩⑨⑦⑥⑤④③②①]+/g," ");
  s=s.replace(/[＠@*#]+/g," ").replace(/[_＿]+/g," ").replace(/[＝=]+$/g," ");
  s=s.replace(/^\s*[^ぁ-んァ-ヶー一-龠A-Za-z0-9]+/,"");
  s=s.replace(/[^ぁ-んァ-ヶー一-龠A-Za-z0-9%.\- ]+$/,"");
  s=s.replace(/\s+/g," ").trim();

  // Actual-device OCR can glue quantity / price / tax markers to the product name.
  // Example: "CCケーブル 3A、 1 ¥1004%" -> "C-Cケーブル 3A".
  s=s.replace(/[、,]\s*[0-9]{1,3}\s*(?:¥|￥|\\|Y)\s*[0-9]{2,7}(?:\s*(?:外|内|軽|[0-9]{1,2}%))?\s*$/i,"");
  s=s.replace(/\s+[0-9]{1,3}\s+(?:¥|￥|\\|Y)\s*[0-9]{2,7}(?:\s*(?:外|内|軽|[0-9]{1,2}%))?\s*$/i,"");
  s=s.replace(/^CC(?=\s*ケーブル|ケーブル)/i,"C-C");
  s=s.replace(/^C\s+C(?=\s*ケーブル|ケーブル)/i,"C-C");
  s=s.replace(/^C\s*[-‐‑‒–—]\s*C(?=\s*ケーブル|ケーブル)/i,"C-C");
  s=s.replace(/^C-C\s+ケーブル/i,"C-Cケーブル");
  s=s.replace(/\s+/g," ").trim();

  var dm=s.match(/^([0-9]{1,3})\s*([ぁ-んァ-ヶー一-龠].{3,})$/);
  if(dm&&!/^(?:[0-9]+(?:ml|l|g|kg)|7up)\b/i.test(s))s=dm[2].trim();
  s=s.replace(/^(?:[Xx※*#]\s*)?\d{1,3}\s*[「『\[\(（]?\s*(?=[A-Za-zぁ-んァ-ヶー一-龠])/,"");
  s=s.replace(/^\d{1,3}\s+(?=[A-Za-z]{1,8}\b)/,"");

  s=s.replace(/^\s*[ぁ-んァ-ヶ]{1,2}\s*(?=キリン|LDC|UCC|AGF|BOSS)/i,"");
  s=s.replace(/^\s*[A-Za-z]{1,2}\s+(?=[ぁ-んァ-ヶ一-龠])/,"");
  s=s.replace(/^\s*[ぁ-んァ-ヶ一-龠々0-9\-]{2,24}(?:市|区|町|村|丁目|番地?)\s+(?=(?:[A-Z]{2,6}\b|キリン|サントリー|アサヒ|コカ.?コーラ|伊藤園|明治|森永|グリコ|カルビー))/i,"");
  s=s.replace(/(\d+(?:\.\d+)?)\s*(?:し|I|l|｜)$/i,"$1L");
  s=s.replace(/(\d+)\s*m\s*(?:し|I|l|｜)$/i,"$1ml");
  s=s.replace(/スポポーツ/g,"スポーツ").replace(/紅\s+茶/g,"紅茶").replace(/白\s+ぶどう/g,"白ぶどう");
  s=s.replace(/([ぁ-んァ-ヶ一-龠])\s+([ぁ-んァ-ヶ一-龠]{1,2})(?=\s|$)/g,function(_m,a,b){
    return /^(?:茶|ーツ|料|乳|糖|味)$/.test(b)?a+b:a+" "+b;
  });
  s=s.replace(/[.,、。，・@*_＝=]+$/g,"").replace(/^[.,、。，・@*_＝=]+/g,"").replace(/\s+/g," ").trim();
  return canonicalizeBrandTokens(s);
}

function editDistance(a,b){
  a=String(a||"").toLowerCase();b=String(b||"").toLowerCase();
  var prev=new Array(b.length+1),cur=new Array(b.length+1);
  for(var j=0;j<=b.length;j++)prev[j]=j;
  for(var i=1;i<=a.length;i++){
    cur[0]=i;
    for(var k=1;k<=b.length;k++)cur[k]=Math.min(cur[k-1]+1,prev[k]+1,prev[k-1]+(a[i-1]===b[k-1]?0:1));
    var t=prev;prev=cur;cur=t;
  }
  return prev[b.length];
}
function canonicalizeBrandTokens(name){
  var brands=["LDC","UCC","AGF","BOSS"],parts=String(name||"").split(/\s+/);
  return parts.map(function(part){
    if(/^C[-‐‑‒–— ]?C$/i.test(part))return"C-C";
    if(/[ぁ-んァ-ヶ一-龠]/.test(part))return part;
    var clean=part.replace(/[^A-Za-z0-9]/g,"");
    if(clean.length<2||clean.length>5)return part;
    var best=null,dist=99;
    brands.forEach(function(b){var d=editDistance(clean,b);if(d<dist){dist=d;best=b}});
    if(best&&dist<=1&&/[A-Za-z]/.test(clean))return best;
    return part;
  }).join(" ").replace(/\s+/g," ").trim();
}
function productTokens(name){
  var s=normalizeProductName(name).toLowerCase();
  return s.split(/[\s・･/]+/).map(function(x){return x.replace(/[^ぁ-んァ-ヶ一-龠a-z0-9.%\-]/g,"")}).filter(function(x){return x.length>=2&&!/^\d+$/.test(x)});
}
function productMeaningfulScore(name){
  var s=normalizeProductName(name),tokens=productTokens(s),jp=(s.match(/[ぁ-んァ-ヶ一-龠]/g)||[]).length,latin=(s.match(/[A-Za-z]/g)||[]).length,score=0;
  score+=Math.min(26,s.length);
  score+=Math.min(24,jp*1.5);
  score+=Math.min(12,tokens.length*4);
  if(/LDC|UCC|AGF|BOSS|キリン|サントリー|アサヒ|コカ.?コーラ|伊藤園/i.test(s))score+=14;
  if(/サイダー|スポーツ|紅茶|コーヒー|ジュース|ミルク|お茶|ウォーター|水|ぶどう|レモン|オーレ|サワー/i.test(s))score+=12;
  if(/(.)\1{2,}|(?:ピ|ビ|ペ|ベ){4,}|(?:ホ|水|沙){4,}/.test(s))score-=24;
  if(/[A-Za-z]{3,}\s+[ァ-ヶー]{4,}/.test(s)&&!/TR\s*クリスプサワー/i.test(s))score-=8;
  if(/^[A-Za-z]{1,3}\s*[,、.]?\s*\d+$/i.test(s)||(/^[A-Za-z]{1,3}\b/i.test(s)&&jp===0&&tokens.length<=2))score-=45;
  if(/^[0-9]{1,3}\s*[ぁ-んァ-ヶ一-龠]/.test(s))score-=25;
  if(latin<=3&&jp===0&&tokens.length<=1)score-=25;
  return score;
}
function tokenSupportScore(name,candidates){
  var toks=productTokens(name),score=0;
  toks.forEach(function(t){
    var count=0;
    (candidates||[]).forEach(function(c){if(productTokens(c.name).some(function(x){return x===t||x.includes(t)||t.includes(x)}))count++});
    if(count>=2)score+=Math.min(12,(count-1)*4);
  });
  return score;
}
function joinProductNameParts(a,b){
  a=normalizeProductName(a);b=normalizeProductName(b);if(!a)return b;if(!b)return a;
  var bm=b.match(/^([ぁ-んァ-ヶ一-龠]{1,2})(?:\s+(.+))?$/);
  if(bm&&/[ぁ-んァ-ヶ一-龠]$/.test(a)){
    var joined=a+bm[1]+(bm[2]?" "+bm[2]:"");
    return normalizeProductName(joined);
  }
  if(/^[ァ-ヶー]{1,3}$/.test(b)&&/[ァ-ヶー]$/.test(a))return normalizeProductName(a+b);
  return normalizeProductName(a+" "+b);
}
function chooseBestNameForCandidates(candidates){
  candidates=(candidates||[]).filter(function(x){return x&&x.name});
  if(!candidates.length)return"";
  var scored=candidates.map(function(x){
    var name=normalizeProductName(x.name),quality=productMeaningfulScore(name)+tokenSupportScore(name,candidates);
    var sims=0;for(var i=0;i<candidates.length;i++)if(candidates[i]!==x)sims+=productSimilarity(name,candidates[i].name);
    quality+=sims*8;
    return{name:name,score:quality};
  }).sort(function(a,b){return b.score-a.score||b.name.length-a.name.length});
  return scored[0].name;
}
function isGarbageProductName(name){
  var s=normalizeProductName(name),jp=(s.match(/[ぁ-んァ-ヶ一-龠]/g)||[]).length;
  if(!s||s.length<2)return true;
  if(/^[A-Za-z]{1,3}\s*[,、.]?\s*\d+$/i.test(s))return true;
  if(/^[A-Za-z]{1,3}$/i.test(s))return true;
  if(jp===0&&productMeaningfulScore(s)<10)return true;
  return false;
}
function productKey(name){
  return normalizeProductName(name).toLowerCase().replace(/[\s・･._\-]/g,"").replace(/[^\u3040-\u30ff\u3400-\u9fffA-Za-z0-9]/g,"");
}
function charBigrams(s){
  s=productKey(s);var out={};if(s.length<2){if(s)out[s]=1;return out}
  for(var i=0;i<s.length-1;i++)out[s.slice(i,i+2)]=1;return out;
}
function productSimilarity(a,b){
  var x=productKey(a),y=productKey(b);if(!x||!y)return 0;if(x===y)return 1;if(x.includes(y)||y.includes(x))return Math.min(x.length,y.length)/Math.max(x.length,y.length);
  var A=charBigrams(x),B=charBigrams(y),ak=Object.keys(A),bk=Object.keys(B),hit=0;ak.forEach(function(k){if(B[k])hit++});
  return ak.length+bk.length?2*hit/(ak.length+bk.length):0;
}
var RECEIPT_PRODUCT_DICT_KEY="okozukaiReceiptProductDictionaryV1";
function merchantShopKey(shop){
  var s=String(shop||"").normalize?String(shop||"").normalize("NFKC"):String(shop||"");
  s=s.toLowerCase().replace(/\s+/g,"");
  if(/バーガーキング|burgerking/.test(s))return"burgerking";
  if(/マクドナルド|mcdonald/.test(s))return"mcdonalds";
  if(/モスバーガー|mosburger/.test(s))return"mosburger";
  if(/ケンタッキー|kfc/.test(s))return"kfc";
  if(/ダイソー|daiso/.test(s))return"daiso";
  if(/西友|seiyu/.test(s))return"seiyu";
  return s.replace(/(?:店|支店|店舗)$/,"").slice(0,48);
}
function loadLearnedProductDictionary(){
  try{
    var x=JSON.parse(localStorage.getItem(RECEIPT_PRODUCT_DICT_KEY)||"[]");
    return Array.isArray(x)?x:[];
  }catch(_e){return[]}
}
function saveLearnedProductDictionary(rows){
  try{localStorage.setItem(RECEIPT_PRODUCT_DICT_KEY,JSON.stringify((rows||[]).slice(-60)))}catch(_e){}
}
function rememberVerifiedProduct(shop,name,price){
  var key=merchantShopKey(shop),n=normalizeProductName(name),p=Number(price||0);
  if(!key||!n||n==="商品名要確認"||n.length<2)return;
  var rows=loadLearnedProductDictionary(),hit=rows.find(function(x){return x.shopKey===key&&productKey(x.name)===productKey(n)});
  if(hit){
    hit.name=n;hit.lastUsed=Date.now();if(p>0){hit.priceHints=Array.isArray(hit.priceHints)?hit.priceHints:[];if(hit.priceHints.indexOf(p)<0)hit.priceHints.push(p);hit.priceHints=hit.priceHints.slice(-6)}
  }else rows.push({shopKey:key,name:n,priceHints:p>0?[p]:[],source:"learned",lastUsed:Date.now()});
  saveLearnedProductDictionary(rows);
}
function mergeMerchantDictionaryEntries(learned,builtIn){
  var out=[],seen={};
  (learned||[]).concat(builtIn||[]).forEach(function(x){
    if(!x||!x.name)return;
    var k=productKey(x.name);if(!k||seen[k])return;seen[k]=1;out.push(x);
  });
  return out;
}
function merchantDictionarySourceLabel(source){
  return source==="learned"?"確認済み学習候補":"内蔵辞書候補";
}
function learnedProductsForShop(shop){
  var key=merchantShopKey(shop);
  return loadLearnedProductDictionary().filter(function(x){return x&&x.shopKey===key&&x.name}).sort(function(a,b){return Number(b.lastUsed||0)-Number(a.lastUsed||0)});
}
function removeLearnedProduct(shop,name){
  var key=merchantShopKey(shop),pk=productKey(name),rows=loadLearnedProductDictionary(),before=rows.length;
  rows=rows.filter(function(x){return !(x&&x.shopKey===key&&productKey(x.name)===pk)});
  if(rows.length!==before)saveLearnedProductDictionary(rows);
  return rows.length!==before;
}
function learnedDictionaryListHTML(shop){
  var rows=learnedProductsForShop(shop);
  if(!rows.length)return'<div class="small">この店舗の確認済み学習データはまだありません。</div>';
  return rows.map(function(x){
    var prices=(x.priceHints||[]).filter(function(n){return Number(n)>0}).map(function(n){return yen(Number(n))}).join(" / ");
    return'<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line,rgba(255,255,255,.10))"><div style="min-width:0"><strong style="display:block;overflow-wrap:anywhere">'+e(x.name)+'</strong><span class="small">'+e(prices?("価格履歴 "+prices):"価格履歴なし")+'</span></div><button type="button" class="secondary receipt-learned-delete" data-name="'+e(encodeURIComponent(x.name))+'" style="min-height:40px;padding:8px 12px;white-space:nowrap">削除</button></div>';
  }).join("");
}
function learnedDictionaryManagerHTML(shop){
  var rows=learnedProductsForShop(shop);
  if(!rows.length)return"";
  return'<details class="details receipt-learned-manager"><summary>学習辞書を管理（'+rows.length+'件）</summary><div class="small" style="margin:8px 0">確認した商品名はこの端末内だけに保存されます。誤って学習した項目は削除できます。</div><div id="receiptLearnedDictionaryList">'+learnedDictionaryListHTML(shop)+'</div></details>';
}
function bindLearnedDictionaryManager(shop){
  var root=document.getElementById("receiptLearnedDictionaryList");if(!root)return;
  [].slice.call(root.querySelectorAll(".receipt-learned-delete")).forEach(function(btn){
    btn.onclick=function(){
      var name="";try{name=decodeURIComponent(btn.getAttribute("data-name")||"")}catch(_e){}
      if(!name)return;
      if(typeof confirm==="function"&&!confirm("学習辞書から「"+name+"」を削除しますか？"))return;
      removeLearnedProduct(shop,name);
      var current=document.getElementById("receiptLearnedDictionaryList");
      if(current)current.innerHTML=learnedDictionaryListHTML(shop);
      bindLearnedDictionaryManager(shop);
    };
  });
}
function merchantProductDictionary(shop){
  var key=merchantShopKey(shop),learned=[],builtIn=[];
  loadLearnedProductDictionary().forEach(function(x){
    if(x&&x.shopKey===key&&x.name)learned.push({name:x.name,aliases:[x.name],priceHints:Array.isArray(x.priceHints)?x.priceHints:[],source:"learned",lastUsed:Number(x.lastUsed||0)});
  });
  // Built-in entries are limited to products verified from the user's own test receipts.
  if(key==="burgerking"){
    builtIn.push({name:"ワッパーチーズセット",aliases:["ワッパーチーズセット","ワッパー チーズ セット","ワッパーチーズ"],priceHints:[1090],source:"verified_sample"});
  }
  return mergeMerchantDictionaryEntries(learned,builtIn);
}
function merchantProductInferenceFromDictionary(dict,ocrCandidates,receiptText,originalPrice){
  dict=Array.isArray(dict)?dict:[];var price=Number(originalPrice||0);
  if(!dict.length)return null;
  var observed=[];
  (ocrCandidates||[]).forEach(function(x){
    var n=cleanFocusedProductName(typeof x==="string"?x:x&&x.text,price);if(n)observed.push(n);
  });
  normalize(receiptText).split("\n").forEach(function(line){
    if(price&&numberFromLine(line)!==price)return;
    var n=cleanFocusedProductName(line,price);if(n)observed.push(n);
  });
  var uniq=[];observed.forEach(function(n){if(uniq.indexOf(n)<0)uniq.push(n)});
  var hasSet=uniq.some(function(x){return /セット/.test(x)}),scored=dict.map(function(entry){
    var names=[entry.name].concat(entry.aliases||[]),bestSim=0,bestObserved="";
    uniq.forEach(function(obs){names.forEach(function(n){var sim=productSimilarity(obs,n);if(sim>bestSim){bestSim=sim;bestObserved=obs}})});
    var exactPrice=price>0&&(entry.priceHints||[]).indexOf(price)>=0;
    var nameHasSet=/セット/.test(entry.name),score=Math.round(bestSim*42)+(exactPrice?44:0)+(hasSet&&nameHasSet?10:0)+(entry.source==="learned"?10:0);
    return{name:entry.name,score:score,textSimilarity:bestSim,priceMatch:exactPrice,source:entry.source,bestObserved:bestObserved};
  }).sort(function(a,b){
    var as=a.source==="learned"?1:0,bs=b.source==="learned"?1:0;
    return b.score-a.score||bs-as||b.textSimilarity-a.textSimilarity;
  });
  var best=scored[0];if(!best)return null;
  var samePrice=scored.filter(function(x){return x.priceMatch}).length;
  var setConsistent=hasSet&&/セット/.test(best.name);
  // Same-price inference is only surfaced when the price points to a unique dictionary item
  // and OCR at least weakly resembles it. If several dictionary items share the price,
  // text similarity must discriminate them.
  if(best.priceMatch){
    if(samePrice===1){
      if(best.textSimilarity<.10&&!setConsistent)return null;
    }else if(best.textSimilarity<.36)return null;
  }else if(best.textSimilarity<.48)return null;
  if(best.score<55)return null;
  var autoConfirmEligible=best.source==="learned"&&best.priceMatch&&samePrice===1&&best.textSimilarity>=.18;
  return{name:best.name,score:best.score,textSimilarity:best.textSimilarity,priceMatch:best.priceMatch,source:best.source,bestObserved:best.bestObserved,alternatives:scored.slice(0,3).map(function(x){return x.name}),confirmed:false,autoConfirmEligible:autoConfirmEligible,samePriceMatches:samePrice};
}
function merchantProductInference(shop,ocrCandidates,receiptText,originalPrice){
  return merchantProductInferenceFromDictionary(merchantProductDictionary(shop),ocrCandidates,receiptText,originalPrice);
}
function productNameQuality(name){
  var raw=String(name||""),s=normalizeProductName(raw),score=productMeaningfulScore(s),noise=(raw.match(/[@*#_⑧=＝、，]/g)||[]).length;
  score-=noise*4;
  if(/[ぁ-んァ-ヶ一-龠]/.test(s))score+=8;
  if(receiptHeaderPattern().test(raw))score-=85;
  if(/(?:^|\s)#?\d{4}(?:\s|$)/.test(raw))score-=35;
  if(/対象|ポイント|合計|小計|税|取引|受付|レジ/i.test(s))score-=60;
  if(isGarbageProductName(s))score-=40;
  return score;
}
function mergeProductRows(rows){
  rows=(rows||[]).map(function(row){
    return{name:normalizeProductName(row.name),rawName:row.rawName||row.name,unitPrice:Number(row.unitPrice||0),qty:Number(row.qty||1),total:Number(row.total||0),quality:Number(row.quality||productNameQuality(row.rawName||row.name)),sourceIndex:Number(row.sourceIndex||0),sourcePriority:Number(row.sourcePriority||1)};
  }).filter(function(x){return x.name});

  var groups=[];
  rows.forEach(function(row){
    var best=-1,bestScore=-1;
    for(var i=0;i<groups.length;i++){
      var g=groups[i],sameTotal=row.total&&g.total&&row.total===g.total,qtyCompatible=row.qty===g.qty||row.qty===1||g.qty===1;
      if(!sameTotal||!qtyCompatible)continue;
      var sim=Math.max.apply(null,g.candidates.map(function(c){return productSimilarity(row.name,c.name)}).concat([0]));
      var garbage=isGarbageProductName(row.name),groupHasGood=g.candidates.some(function(c){return !isGarbageProductName(c.name)});
      var numericGroup=garbage&&groupHasGood;
      var score=sim+(numericGroup?.35:0)+(row.sourcePriority>=3?.04:0);
      if(score>bestScore&&(sim>=.28||numericGroup)){best=i;bestScore=score}
    }
    if(best<0)groups.push({total:row.total,qty:row.qty,unitPrice:row.unitPrice,candidates:[row]});
    else{
      var g=groups[best];g.candidates.push(row);
      if(g.qty===1&&row.qty>1)g.qty=row.qty;
      if(!g.unitPrice&&row.unitPrice)g.unitPrice=row.unitPrice;
    }
  });

  for(var gi=groups.length-1;gi>=0;gi--){
    var g=groups[gi],bestName=chooseBestNameForCandidates(g.candidates),gScore=productMeaningfulScore(bestName);
    if(gScore>=15)continue;
    var target=-1,targetScore=-999;
    for(var gj=0;gj<groups.length;gj++){
      if(gj===gi)continue;
      var h=groups[gj],qtyOk=g.qty===h.qty||g.qty===1||h.qty===1;
      if(g.total!==h.total||!qtyOk)continue;
      var hName=chooseBestNameForCandidates(h.candidates),hs=productMeaningfulScore(hName);
      if(hs>targetScore){targetScore=hs;target=gj}
    }
    if(target>=0&&targetScore>=gScore+18){
      groups[target].candidates=groups[target].candidates.concat(g.candidates);
      if(groups[target].qty===1&&g.qty>1)groups[target].qty=g.qty;
      if(!groups[target].unitPrice&&g.unitPrice)groups[target].unitPrice=g.unitPrice;
      groups.splice(gi,1);
    }
  }

  return groups.map(function(g){
    var name=chooseBestNameForCandidates(g.candidates),bestCandidate=g.candidates.slice().sort(function(a,b){
      return (b.quality+b.sourcePriority*8)-(a.quality+a.sourcePriority*8);
    })[0];
    if(bestCandidate&&productMeaningfulScore(bestCandidate.name)>=productMeaningfulScore(name)-2)name=bestCandidate.name;
    var quality=productMeaningfulScore(name)+tokenSupportScore(name,g.candidates);
    return{name:name,unitPrice:g.unitPrice,qty:g.qty,total:g.total,quality:quality,candidateCount:g.candidates.length};
  }).filter(function(x){return !isChangeCueText(String(x.name||""));});
}
function chooseItemsForSubtotal(rows,subtotal,receiptTotal,receiptDiscount){
  rows=mergeProductRows(rows).filter(function(x){return x.total>0&&!isChangeCueText(String(x.name||""))});
  subtotal=Number(subtotal||0);receiptTotal=Number(receiptTotal||0);receiptDiscount=Number(receiptDiscount||0);
  var maxItem=receiptTotal>0?receiptTotal:(subtotal>0?subtotal:0);
  if(maxItem>0)rows=rows.filter(function(x){return Number(x.total||0)<=maxItem});
  var fullSum=rows.reduce(function(a,x){return a+Number(x.total||0)},0);
  if(subtotal&&receiptDiscount>0&&fullSum===subtotal+receiptDiscount)return{rows:rows,matched:true,preDiscount:true,sum:fullSum,discount:receiptDiscount};
  if(!subtotal||rows.length<2||rows.length>14)return{rows:rows,matched:false,sum:fullSum};
  var n=rows.length,best=null,max=1<<n;
  for(var mask=1;mask<max;mask++){
    var sum=0,quality=0,count=0;
    for(var i=0;i<n;i++)if(mask&(1<<i)){sum+=rows[i].total;quality+=Number(rows[i].quality||0);count++}
    if(sum!==subtotal)continue;
    var score=quality+count*8;
    if(!best||score>best.score)best={mask:mask,score:score,count:count};
  }
  if(!best)return{rows:rows,matched:false,sum:rows.reduce(function(a,x){return a+x.total},0)};
  var picked=[];for(var j=0;j<n;j++)if(best.mask&(1<<j))picked.push(rows[j]);
  return{rows:picked,matched:true,sum:subtotal};
}
function labeledMoney(line){
  var n=numberFromLine(line);return n>0?n:0;
}
function analyzeAmount(text,extraText){
  var allText=normalize([text,extraText].filter(Boolean).join("\n")),lines=allText.split("\n").map(function(x){return ocrMoneyClean(x.trim())}).filter(Boolean),map={},subtotal=0,tax=0,taxIncluded=false;
  function add(n,label,score,line){
    n=Number(n||0);if(!n||n>1000000)return;
    var x=map[n]||(map[n]={amount:n,score:0,occurrences:0,labels:{},lines:[]});
    x.score+=score;x.occurrences++;x.labels[label]=true;x.lines.push(line);
  }
  lines.forEach(function(line){
    if(/ポイント|合計P|今回P|前回累計|残高|登録番号|取引ID|受付番号|カード\s*No|カード番号|TEL|電話|〒|レジ|店番号|バーコード/i.test(line))return;
    var n=labeledMoney(line);if(!n)return;
    if(/小計/i.test(line)){subtotal=subtotal||n;add(n,"subtotal",30,line);return}
    var explicitTax=taxAmountFromLine(line);
    if(explicitTax){
      tax=tax||explicitTax;
      if(/内税|内消費税/i.test(line))taxIncluded=true;
      return;
    }
    if(/消費税|税額|内税|外税|税率/i.test(line)){
      if(/内税|内消費税/i.test(line))taxIncluded=true;
      return;
    }
    if(/お?預り|お?釣(?:り)?|お?つり|釣銭/i.test(line))return;
    if(/お支払(?:い)?額|お買上(?:げ)?額|領収金額|総合計|税込合計|合計金額/i.test(line)){add(n,"total",100,line);return}
    if(/合\s*計/i.test(line)&&!/割引前\s*合\s*計|値引前\s*合\s*計|小\s*計/i.test(line)){add(n,"total",110,line);return}
    if(/含計|台計|合汁|合言十/i.test(line)){add(n,"fuzzyTotal",70,line);return}
    if(paymentFromText(line)&&!/現金|cash/i.test(line)){add(n,"payment",90,line);return}
    // Cash tendered is not the purchase total. It is only the amount handed to the cashier.
    if(/現金|cash/i.test(line))return;
  });
  if(subtotal&&tax&&!taxIncluded){
    add(subtotal+tax,"derivedTotal",140,"subtotal+tax");
  }
  var cand=Object.keys(map).map(function(k){return map[k]}),cash=receiptCashSummary(allText);
  if(cash.tender&&cash.change&&cash.tender>cash.change)add(cash.tender-cash.change,"cashReconciled",130,"tender-change");
  cand=Object.keys(map).map(function(k){return map[k]});
  cand.forEach(function(x){
    if(x.occurrences>=3)x.score+=60;else if(x.occurrences>=2)x.score+=40;
    if(x.labels.total&&x.labels.payment)x.score+=60;
    if(subtotal&&tax&&subtotal+tax===x.amount){x.score+=60;x.labels.subtotalTaxMatch=true}
  });
  cand.forEach(function(short){
    var s=String(short.amount);
    cand.forEach(function(long){
      if(short===long||long.amount<=short.amount)return;
      var l=String(long.amount);
      if(l.length>s.length&&(l.startsWith(s)||l.endsWith(s))&&long.score>=short.score){short.score-=55;short.labels.truncatedAgainst=long.amount}
    })
  });
  cand.sort(function(a,b){return b.score-a.score||b.occurrences-a.occurrences||b.amount-a.amount});
  var best=cand[0]||null,confidence="low";
  if(best){
    if(best.score>=180||(best.labels.total&&best.labels.payment)||best.labels.subtotalTaxMatch)confidence="high";
    else if(best.score>=100)confidence="medium";
  }
  return{amount:best?best.amount:0,confidence:confidence,score:best?best.score:0,subtotal:subtotal,tax:tax,candidates:cand};
}
function itemRowsFromText(text,sourcePriority){
  var lines=normalize(text).split("\n").map(function(x){return x.trim()}).filter(Boolean),priority=Number(sourcePriority||1);
  var bad=/(総合計|合計|小計|税込|お支払|お?預り|お\s*(?:釣|つ|的)\s*り?|釣銭|消費税|内税|外税|税率|8\s*%|10\s*%|軽減税率|対象金額|ポイント|合計P|値引|割引|クーポン|楽天\s*(?:pay|ペイ)|paypay|d払い|au\s*pay|クレジット|visa|master|jcb|amex|残高|receipt|領収|tel|電話|〒|登録番号|取引ID|受付番号|伝票番号|承認番号|決済手段|取引内容|ご利用金額|カード\s*no|カード番号|レジ|店番号|担当|日時|日付|営業時間|営業\s*時間|バーコード|QR|LINEスタンプ|ハッピープライス|公式通販|オンラインショップ)/i,out=[];
  function cleanName(s){return normalizeProductName(s)}
  function validName(s,total,raw){
    if(!s||s.length<2||s.length>58||bad.test(s)||!/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(s))return false;
    if(/[=＝]{1,}/.test(s)&&!/1[.．]5\s*L/i.test(s))return false;
    if(Number(total||0)>0&&Number(total)<10)return false;
    if(isReceiptHeaderLine(raw)&&!/[A-Za-zぁ-んァ-ヶ一-龠]{3,}/.test(stripReceiptHeaderNoise(raw)))return false;
    var core=s.replace(/[0-9０-９.,．\s¥￥@*_#\-＝=]/g,"");
    return core.length>=2&&!isGarbageProductName(s);
  }
  function add(name,unit,qty,total,sourceIndex){
    var rawName=String(name||""),clean=cleanName(rawName);unit=Number(unit||0);qty=Number(qty||1);total=Number(total||0);
    if(!validName(clean,total,rawName))return;
    out.push({name:clean,rawName:rawName,unitPrice:unit,qty:qty,total:total,quality:productNameQuality(rawName)+priority*10,sourceIndex:Number(sourceIndex||0),sourcePriority:priority});
  }
  function priceRowOf(s){return ocrMoneyClean(s).match(/^\s*[@＠]?\s*([0-9]{1,6})\s+(?:[x×]\s*)?([0-9]{1,3})\s+(?:¥\s*)?([0-9]{1,7})\s*(?:[A-Z※*])?\s*$/i)}
  function quantitySummary(s){
    var x=ocrMoneyClean(s);
    if(!/(?:コ|個).{0,5}(?:[xX×]|メX|Xメ).{0,6}(?:単|単価)/i.test(x))return null;
    var nums=(x.match(/[0-9]{1,7}/g)||[]).map(Number);
    if(nums.length<3)return null;
    var q=nums[0],unit=nums[1],total=nums[nums.length-1];
    if(q<2||q>99||unit<=0||total<=0||q*unit!==total)return null;
    return{qty:q,unit:unit,total:total};
  }
  function sameProductMatch(s){return ocrMoneyClean(s).match(/^(.{2,58}?[ぁ-んァ-ヶー一-龠A-Za-z][^¥￥]*?)\s+(?:¥|￥)?\s*([0-9]{1,7})\s*(?:円)?\s*(?:外|内|軽|[A-Z※*])?\s*$/i)}
  function productQtyPriceMatch(s){return ocrMoneyClean(s).match(/^(.{2,58}?[ぁ-んァ-ヶー一-龠A-Za-z][^¥￥]*?)[\s,、]+([0-9]{1,3})\s+(?:¥|￥)\s*([0-9]{1,7})\s*(?:円)?\s*(?:外|内|軽|[A-Z※*])?\s*$/i)}
  function discountTotal(s){var x=ocrMoneyClean(s);if(!/値下|値引|割引|特価|sale/i.test(x))return 0;var nums=[],re=/(?:¥|￥)?\s*([0-9]{1,7})/g,m;while((m=re.exec(x)))nums.push(Number(m[1]||0));return nums.length?nums[nums.length-1]:0;}
  for(var i=0;i<lines.length;i++){
    var line=ocrMoneyClean(lines[i]);if(bad.test(line))continue;
    var prev=i>0?ocrMoneyClean(lines[i-1]):"",next=i+1<lines.length?ocrMoneyClean(lines[i+1]):"",next2=i+2<lines.length?ocrMoneyClean(lines[i+2]):"";
    var qtySummary=quantitySummary(line);
    if(qtySummary&&prev&&!bad.test(prev)&&!isReceiptHeaderLine(prev)&&validName(cleanName(prev),qtySummary.total,prev)){
      add(prev,qtySummary.unit,qtySummary.qty,qtySummary.total,i-1);continue;
    }
    var linePrice=priceRowOf(line),nextPrice=priceRowOf(next),priceRow2=priceRowOf(next2),qtySame=productQtyPriceMatch(line),same=sameProductMatch(line),nextSame=sameProductMatch(next),nextDiscount=discountTotal(next);
    if(qtySame){
      var qname=cleanName(qtySame[1]),qqty=Number(qtySame[2]||1),qtotal=Number(qtySame[3]||0);
      if(validName(qname,qtotal,qtySame[1])){add(qtySame[1],qqty?Math.round(qtotal/qqty):0,qqty,qtotal,i);continue}
    }
    if(nextDiscount&&validName(cleanName(line),nextDiscount,line)){add(line,0,1,nextDiscount,i);continue}
    if(validName(cleanName(line),nextPrice&&nextPrice[3],line)&&nextPrice){add(line,nextPrice[1],nextPrice[2],nextPrice[3],i);continue}

    if(priceRow2&&!linePrice&&!nextPrice&&!same&&!nextSame&&!bad.test(next)&&!isReceiptHeaderLine(line)&&!isReceiptHeaderLine(next)){
      var joined=joinProductNameParts(line,next);
      if(validName(joined,priceRow2[3],line+" "+next))add(joined,priceRow2[1],priceRow2[2],priceRow2[3],i);
    }

    if(same){
      var nm=cleanName(same[1]),amt=Number(same[2]);
      if(!/[@＠]\s*[0-9]/.test(nm)&&validName(nm,amt,same[1]))add(same[1],0,1,amt,i);
    }
  }
  return out.slice(0,36);
}

function dateFromText(text,baseDate,emptyOnMissing){
  var t=normalize(text),base=new Date(String(baseDate||defaultDate())+"T12:00:00");
  t=t.replace(/([0-9])[OoＯ](?=[0-9年月日\/\-.])/g,"$10").replace(/([0-9])[Il｜](?=[0-9年月日\/\-.])/g,"$11");
  function make(y,m,d){var dt=new Date(y,m-1,d);if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==d)return"";return dstr(dt)}
  function weekdayAdjusted(y,m,d,src){
    var wd={"日":0,"月":1,"火":2,"水":3,"木":4,"金":5,"土":6},wm=String(src||"").match(/[（(]\s*([日月火水木金土])\s*[)）]/);
    if(!wm)return y;
    var wanted=wd[wm[1]],baseYear=base.getFullYear(),years=[y,baseYear,y-1,y+1],seen={};
    for(var wi=0;wi<years.length;wi++){var yy=years[wi];if(seen[yy])continue;seen[yy]=1;var dt=new Date(yy,m-1,d);if(dt.getFullYear()===yy&&dt.getMonth()===m-1&&dt.getDate()===d&&dt.getDay()===wanted&&Math.abs(yy-baseYear)<=1)return yy}
    return y;
  }
  var full=[/((?:19|20)\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})日?/,/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/];
  for(var i=0;i<full.length;i++){var m=t.match(full[i]);if(m){var yy=weekdayAdjusted(Number(m[1]),Number(m[2]),Number(m[3]),t),v=make(yy,Number(m[2]),Number(m[3]));if(v)return v}}
  var short=t.match(/(?:^|\D)(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\D|$)/);
  if(short){var sv=make(2000+Number(short[1]),Number(short[2]),Number(short[3]));if(sv)return sv}
  var md=t.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*日|(?:^|\D)(\d{1,2})[\/\-](\d{1,2})(?:\D|$)/);
  if(md){var mo=Number(md[1]||md[3]),da=Number(md[2]||md[4]),y=base.getFullYear(),mv=make(y,mo,da);if(mv&&new Date(mv+"T12:00:00")>new Date(base.getTime()+172800000))mv=make(y-1,mo,da);if(mv)return mv}
  return emptyOnMissing?"":(baseDate||defaultDate());
}
function amountFromText(text){
  return analyzeAmount(text,"").amount;
}
function paymentFromText(text){
  var original=normalize(text),nfkc=original.normalize?original.normalize("NFKC"):original;
  var compact=nfkc.replace(/[\s　._\-・:：/]+/g,""),t=nfkc.toLowerCase(),tc=compact.toLowerCase();
  if(/楽天\s*(?:pay|ペイ|べイ|へイ)/i.test(nfkc)||/楽天(?:pay|ペイ|べイ|へイ)/i.test(compact)||/rakuten\s*pay/i.test(t)||/rakutenpay/i.test(tc))return"rakutenpay";
  if(/楽\s*天\s*(?:p\s*a\s*y|ペ\s*イ|べ\s*イ|へ\s*イ)/i.test(nfkc))return"rakutenpay";
  if(/(?:^|[^a-z])r\s*pay(?:[^a-z]|$)/i.test(nfkc)||/(?:^|[^a-z])rpay(?:[^a-z]|$)/i.test(tc))return"rakutenpay";
  var alphaTokens=(tc.match(/[a-z]{3,12}/g)||[]);
  for(var ai=0;ai<alphaTokens.length;ai++){
    var at=alphaTokens[ai];
    if(editDistance(at,"rpay")<=1||editDistance(at,"rakutenpay")<=1)return"rakutenpay";
  }
  if(/楽[天大夭夫][ペベべヘへ]イ/.test(compact))return"rakutenpay";
  if(/pasmo/i.test(t)||/pasmo/i.test(tc))return"pasmo";
  if(/suica|交通系\s*ic|交通系ic|icカード/i.test(t))return"pasmo";
  if(/visa|master\s*card|mastercard|\bjcb\b|amex|american express|クレジット|カード決済|card payment/i.test(t))return"credit";
  if(/現金|cash|お\s*預り|お\s*釣り|釣銭/i.test(nfkc))return"wallet";
  return"";
}
function normalizeDaisoBranch(name){
  var s=String(name||"").normalize?String(name||"").normalize("NFKC"):String(name||"");
  s=s.replace(/\s+/g,"").trim();
  if(/^ダイソー立川神町店$/.test(s))return"ダイソー立川幸町店";
  return s;
}
function normalizeKnownShopName(shop){
  var s=String(shop||"").normalize?String(shop||"").normalize("NFKC"):String(shop||"");
  s=s.replace(/\s+/g,"").trim();
  if(/^バーガーキング/.test(s)){
    s=s.replace(/[趾址庖占后苫]$/,"店");
    var m=s.match(/^(バーガーキング)(.{2,24})$/);
    if(m&&!/店$/.test(s)&&/(?:口|駅|前|町|通り|モール|センター)[^店]?$/.test(m[2]))s=s.replace(/.$/,"店");
  }
  if(/^オーケー/.test(s)){
    s=s.replace(/^オーケー(?:ストア)?/,"オーケー");
    s=s.replace(/立川若華町店$/,"立川若葉町店");
  }
  return s;
}
function bestShopFromSources(sources){
  var candidates=[];
  (sources||[]).forEach(function(src,idx){
    var txt=normalize(src);if(!txt)return;
    [shopFromText(txt,true),shopFromText(txt,false)].forEach(function(v,kind){
      v=normalizeKnownShopName(v);if(!v)return;
      var score=(kind===0?50:10)+(idx===0?12:idx===1?9:idx===2?6:3);
      if(/^(?:バーガーキング|ダイソー|西友|オーケー|クリエイト|マツモトキヨシ|ウエルシア|スギ薬局)/.test(v))score+=35;
      if(/店$/.test(v))score+=12;
      if(/[趾址庖占后苫]$/.test(v))score-=25;
      candidates.push({name:v,score:score});
    });
  });
  // Cross-pass fusion: one OCR pass may read the brand while another reads the branch correctly.
  var joined=normalize((sources||[]).filter(Boolean).join("\n"));
  var hasBK=/(?:バーガーキング|バーガーキンク|ガーキンク|burger\s*king)/i.test(joined);
  if(hasBK){
    var branchMatches=joined.match(/(?:立川|新宿|池袋|渋谷|秋葉原|横浜|大宮|町田|八王子)[ぁ-んァ-ヶ一-龠A-Za-z0-9]{0,14}(?:店|趾|址|庖|占|后|苫)/g)||[];
    if(branchMatches.length){
      branchMatches=branchMatches.map(function(x){return x.replace(/[趾址庖占后苫]$/,"店")}).sort(function(a,b){return b.length-a.length});
      candidates.push({name:"バーガーキング"+branchMatches[0],score:130});
    }
  }
  candidates.sort(function(a,b){return b.score-a.score||b.name.length-a.name.length});
  return candidates.length?normalizeKnownShopName(candidates[0].name):"";
}
function shopFromText(text,knownOnly){
  var lines=normalize(text).split("\n").map(function(x){return x.trim()}).filter(Boolean).slice(0,18),joined=lines.join(" ");
  if(/CREATE|クリエイト|ドラッグストア\s*クリエイト/i.test(joined))return"クリエイト";
  if(/オーケー|Everyday\s*Low\s*Price/i.test(joined)){
    for(var oi=0;oi<lines.length;oi++){
      var ol=(lines[oi].normalize?lines[oi].normalize("NFKC"):lines[oi]).replace(/\s+/g,"");
      var om=ol.match(/オーケー(?:ストア)?(.{2,24}?店)/);
      if(om)return normalizeKnownShopName("オーケー"+om[1]);
      if(/^オーケー(?:ストア)?$/.test(ol)&&lines[oi+1]){
        var on=(lines[oi+1].normalize?lines[oi+1].normalize("NFKC"):lines[oi+1]).replace(/\s+/g,"");
        if(/^[ぁ-んァ-ヶ一-龠A-Za-z0-9]{2,24}店$/.test(on))return normalizeKnownShopName("オーケー"+on);
      }
    }
    var oj=joined.replace(/\s+/g,"").match(/オーケー(?:ストア)?([ぁ-んァ-ヶ一-龠A-Za-z0-9]{2,24}?店)/);
    return normalizeKnownShopName(oj?"オーケー"+oj[1]:"オーケー");
  }
  // Known restaurant brand + branch normalization. OCR often mangles the final 店 glyph.
  if(/バーガーキング|burger\s*king/i.test(joined)){
    for(var bi=0;bi<lines.length;bi++){
      var bl=(lines[bi].normalize?lines[bi].normalize("NFKC"):lines[bi]).replace(/\s+/g,"");
      var bm=bl.match(/(?:バーガーキング|BURGERKING)([^\n]{2,24})/i);
      if(bm){
        var branch=String(bm[1]||"").replace(/^[^ぁ-んァ-ヶ一-龠A-Za-z0-9]+|[^ぁ-んァ-ヶ一-龠A-Za-z0-9]+$/g,"");
        branch=branch.replace(/[趾址庖占后苫]$/,"店");
        if(branch&&!/店$/.test(branch)&&/(?:口|駅|前|町|通り|モール|センター).?$/.test(branch))branch=branch.replace(/.$/,"")+"店";
        if(branch)return"バーガーキング"+branch;
      }
    }
    return"バーガーキング";
  }
  var daisoBranch="";
  for(var di=0;di<lines.length;di++){
    var dl=(lines[di].normalize?lines[di].normalize("NFKC"):lines[di]).replace(/\s+/g,"").replace(/^[^ダ]*?(?=ダイソー)/,"");
    var dm=dl.match(/(ダイソー[^\n]{1,24}?店)/);
    if(dm){daisoBranch=normalizeDaisoBranch(dm[1]);break}
  }
  if(daisoBranch)return daisoBranch;
  if(/\bDAISO\b|ダイソー|だんぜん!?\s*ダイソー/i.test(joined))return"ダイソー";
  if(/\bSEIYU\b|西友/i.test(joined))return"西友";
  if(/(?:登録番号\s*)?T?\s*8011503002037/i.test(joined.replace(/[\s-]/g,"")))return"西友";
  var shopTokens=(joined.toUpperCase().match(/[A-Z0-9]{4,8}/g)||[]);
  for(var sti=0;sti<shopTokens.length;sti++){
    var st=shopTokens[sti].replace(/1/g,"I").replace(/5/g,"S").replace(/0/g,"O");
    if(editDistance(st,"SEIYU")<=1)return"西友";
  }
  if(/マツモトキヨシ|マツキヨ/i.test(joined))return"マツモトキヨシ";
  if(/ウエルシア/i.test(joined))return"ウエルシア";
  if(/スギ薬局/i.test(joined))return"スギ薬局";
  if(knownOnly)return"";
  var bad=/(領収|レシート|receipt|tel|電話|〒|登録番号|担当|レジ|日時|日付|合計|小計|お支払|現金|visa|master|jcb|ポイント|取引id|受付番号)/i;
  for(var i=0;i<lines.length;i++){
    var line=lines[i],digits=(line.match(/\d/g)||[]).length,letters=(line.match(/[A-Za-z]/g)||[]).length;
    if(line.length<2||line.length>45||bad.test(line)||digits>=5||/[A-Za-z]{3,}\d{4,}/.test(line)||/^\d[\d\s\/\-:.]*$/.test(line)||/^[¥\d,\s円]+$/.test(line))continue;
    if(letters>=4&&digits>=2&&digits>=letters)continue;
    if(/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(line))return line.replace(/^[*#\-=\s]+|[*#\-=\s]+$/g,"").trim();
  }
  return"";
}
function itemsFromText(text){
  return itemRowsFromText(text).map(function(x){return x.name});
}
function itemCategorySuggestion(name,shop){
  var n=normalizeProductName(name);
  var snack=/クリスプ|チップス|スナック|ポテト|クッキー|ビスケット|クラッカー|チョコ|グミ|キャンディ|飴|せんべい|煎餅|菓子|プレッツェル|コーンスナック/i;
  var coffee=/コーヒー|coffee|カフェラテ|cafe latte/i;
  var drink=/サイダー|紅茶|スポーツドリンク|ラブズスポーツ|飲料|ジュース|コーラ|炭酸|緑茶|麦茶|ウーロン茶|午後の紅茶|ミネラルウォーター|お茶|オーレ|ミルク|ウォーター|水\b/i;
  if(snack.test(n))return findCategoryPair("食費","お菓子")||findCategoryPair("食費","スイーツ");
  if(coffee.test(n))return findCategoryPair("食費","コーヒー")||findCategoryPair("食費","飲み物");
  if(drink.test(n))return findCategoryPair("食費","飲み物");
  var one=categorySuggestion("",shop,[{name:n}]);
  return one||findCategoryPair("食費","スーパー・食材")||null;
}
function allocateReceiptRows(rows,subtotal,tax,total,shop){
  rows=(rows||[]).filter(function(x){return Number(x.total||0)>0&&!isChangeCueText(String(x.name||""))}).map(function(x){return Object.assign({},x)});
  var originalSum=rows.reduce(function(a,x){return a+Number(x.total||0)},0),target=Number(total||0),netTarget=Number(subtotal||0),taxTarget=Number(tax||0);
  if(!rows.length)return[];
  if(!target)target=netTarget+taxTarget||originalSum;
  if(!netTarget)netTarget=Math.min(originalSum,target);
  // A receipt-wide discount can make product-price sum exceed the subtotal.
  // Allocate that discount first, then allocate tax, using largest remainder.
  var discountTotal=Math.max(0,originalSum-netTarget);
  if(originalSum<netTarget||netTarget>target)return[];
  function proportional(total,weights){
    var sum=weights.reduce(function(a,n){return a+n},0),parts=weights.map(function(w,i){var raw=sum?total*w/sum:0,f=Math.floor(raw);return{index:i,value:f,fraction:raw-f}}),used=parts.reduce(function(a,x){return a+x.value},0),remain=total-used;
    parts.slice().sort(function(a,b){return b.fraction-a.fraction||weights[b.index]-weights[a.index]}).forEach(function(x){if(remain>0){parts[x.index].value++;remain--}});
    return parts.map(function(x){return x.value});
  }
  var originals=rows.map(function(x){return Number(x.total||0)}),discounts=proportional(discountTotal,originals);
  var nets=originals.map(function(n,i){return Math.max(0,n-discounts[i])});
  var derivedTax=Math.max(0,target-netTarget);
  if(!taxTarget||netTarget+taxTarget!==target)taxTarget=derivedTax;
  var taxes=proportional(taxTarget,nets);
  return rows.map(function(row,i){
    var cat=itemCategorySuggestion(row.name,shop);
    return{index:i,name:row.name,originalNet:originals[i],discount:discounts[i],net:nets[i],extra:taxes[i],gross:nets[i]+taxes[i],categoryId:cat&&cat.categoryId||"",subcategoryId:cat&&cat.subcategoryId||"",categoryLabel:cat&&cat.label||""};
  });
}
function categorySuggestion(text,shop,itemRows){
  var raw=normalize(text).toLowerCase(),rows=Array.isArray(itemRows)?itemRows:[],names=rows.map(function(x){return x.name}).join(" ").toLowerCase();
  var coffee=/コーヒー|coffee|カフェラテ|cafe latte/i,drink=/サイダー|紅茶|スポーツドリンク|ラブズスポーツ|飲料|ジュース|コーラ|炭酸|緑茶|麦茶|ウーロン茶|午後の紅茶|ミネラルウォーター|お茶|オーレ/i;
  if(names&&coffee.test(names))return findCategoryPair("食費","コーヒー")||findCategoryPair("食費","飲み物");
  if(rows.length){
    var bev=rows.filter(function(x){return drink.test(x.name)}).length;
    if(bev>=Math.max(1,Math.ceil(rows.length*.6)))return findCategoryPair("食費","飲み物");
  }
  if(/バーガーキング|burger\s*king|マクドナルド|mos\s*burger|モスバーガー|ケンタッキー|kfc/i.test(String(shop||"")+" "+raw))return findCategoryPair("食費","外食")||findCategoryPair("食費","スーパー・食材");
  if(/スーパー|market|西友|seiyu|オーケー|(?:^|\s)ok(?:\s|$)/i.test(String(shop||"")))return findCategoryPair("食費","スーパー・食材");
  var rules=[
    ["食費","ラーメン・つけ麺・油そば",/ラーメン|らーめん|ramen|つけ麺|油そば/],
    ["医療・健康","薬品代",/医薬品|風邪薬|錠剤|カプセル|ロキソ|薬品/],
    ["娯楽","映画",/toho|シネマ|cinema|映画館|ムービー/],
    ["交通","ガソリン",/eneos|出光|apollostation|ガソリン|給油/],
    ["デジタル・IT","スマホ用品",/USB\s*[- ]?C|TYPE\s*[- ]?C|C\s*[- ]?C\s*ケーブル|充電\s*ケーブル|スマホ\s*ケーブル|ケーブル\s*3A/i],
    ["デジタル・IT","PC用品",/キーボード|マウス|usb|pc用品|パソコン用品/],
    ["食費","コーヒー",/コーヒー|coffee|カフェラテ/],
    ["食費","飲み物",/サイダー|紅茶|スポーツドリンク|ラブズスポーツ|飲料|ジュース|コーラ|炭酸|緑茶|麦茶|ウーロン茶|午後の紅茶|ミネラルウォーター/],
    ["食費","スーパー・食材",/スーパー|market|食材|牛乳|野菜|精肉|鮮魚|豆腐|卵|たまご/],
    ["食費","冷凍食品",/冷凍|フローズン/],
    ["食費","スイーツ",/ケーキ|プリン|シュークリーム|スイーツ|洋菓子|和菓子/],
    ["娯楽","本",/書店|書籍|文庫|新書/]
  ];
  for(var i=0;i<rules.length;i++){var r=rules[i];if(r[2].test(names+" "+raw)){var hit=findCategoryPair(r[0],r[1]);if(hit)return hit}}
  return null;
}

function hasFinalAmountCue(text){
  return /(お支払(?:い)?額|お買上(?:げ)?額|領収金額|総合計|税込合計|合計金額|(?:^|[\s:：])合\s*計(?:[\s:：]|¥|\\|Y|[0-9]|$)|楽天\s*(?:pay|ペイ)|paypay|d払い|au\s*pay|visa|mastercard|master\s*card|\bjcb\b|amex|クレジット|カード決済)/im.test(normalize(text));
}
function uniqueItemRows(rows){
  return mergeProductRows(rows);
}
function recoverSingleItemRow(texts,subtotal,amount){
  subtotal=Number(subtotal||0);amount=Number(amount||0);
  var all=normalize((texts||[]).filter(Boolean).join("\n"));
  if(!subtotal||!all)return null;
  var oneItem=/(?:小計|計)\s*1\s*点|1\s*点\s*(?:小計|¥|￥)/i.test(all);
  if(!oneItem)return null;
  var bad=/(総合計|合計|小計|税込|お支払|消費税|税額|税抜対象額|対象金額|楽天\s*(?:pay|ペイ)|決済手段|ご利用金額|登録番号|伝票番号|承認番号|レジ|TEL|電話|DAISO|ダイソー|領収|QR|LINE|ハッピープライス|オンライン)/i;
  var lines=all.split("\n").map(function(x){return x.trim()}).filter(Boolean),candidates=[];
  lines.forEach(function(line,i){
    if(bad.test(line))return;
    var raw=ocrMoneyClean(line);
    var stripped=raw
      .replace(/[\s,、]+[0-9]{1,3}\s*(?:¥|￥|\\|Y)?\s*[0-9]{2,7}\s*(?:円)?\s*(?:外|内|軽|[A-Z※*])?\s*$/i,"")
      .replace(/\s+(?:¥|￥|\\|Y)\s*[0-9]{2,7}\s*(?:円)?\s*(?:外|内|軽|[A-Z※*])?\s*$/i,"")
      .replace(/\s+[0-9]{2,7}\s*(?:外|内|軽)\s*$/i,"")
      .trim();
    var name=normalizeProductName(stripped);
    if(!name||isGarbageProductName(name))return;
    var keyword=/ケーブル|USB|TYPE\s*[- ]?C|C\s*[- ]?C|充電|アダプタ|イヤホン|電池|文具|ケース/i.test(name);
    var score=productMeaningfulScore(name)+(keyword?45:0);
    if(/ケーブル\s*3A/i.test(name))score+=20;
    if(/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(name))candidates.push({name:name,score:score,index:i});
  });
  candidates.sort(function(a,b){return b.score-a.score||a.index-b.index});
  var best=candidates[0];
  if(!best||best.score<18)return null;
  return{name:best.name,rawName:best.name,unitPrice:subtotal,qty:1,total:subtotal,quality:best.score+30,sourceIndex:best.index,sourcePriority:5,recovered:true};
}
function discountAmountFromLine(line){
  var s=ocrMoneyClean(String(line||"")),m=s.match(/(?:値引|割引|クーポン)[^0-9\n]{0,12}(?:¥|￥|\\|Y)?\s*-?\s*([0-9]{1,7})/i);
  if(!m)return 0;
  var n=Number(m[1]||0);return n>0&&n<=100000?n:0;
}
function receiptDiscountValues(text){
  var counts={},values=[];
  normalize(text).split("\n").forEach(function(line){
    if(!/値引|割引|クーポン/i.test(line))return;
    var n=discountAmountFromLine(line);
    if(n>0&&n<=100000){counts[n]=(counts[n]||0)+1;if(values.indexOf(n)<0)values.push(n)}
  });
  values.sort(function(a,b){return (counts[b]||0)-(counts[a]||0)||a-b});
  return{values:values,counts:counts};
}
function receiptDiscountAmount(text,expected){
  var info=receiptDiscountValues(text),want=Number(expected||0);
  if(want&&info.values.indexOf(want)>=0)return want;
  return info.values.length?info.values[0]:0;
}
function receiptOriginalPriceCandidates(text,target,discountInfo){
  target=Number(target||0);discountInfo=discountInfo||{values:[],counts:{}};
  var bad=/(?:総合計|合計金額|合計|小計|税込|消費税|内税|外税|お支払|現金|cash|お?預り|預かり|お?釣|お?つり|釣銭|値引|割引|クーポン|ポイント|アンケート|以上の商品購入)/i;
  var map={};
  normalize(text).split("\n").forEach(function(raw){
    var line=ocrMoneyClean(String(raw||"").trim());if(!line||bad.test(line))return;
    var n=numberFromLine(line),needed=Number(n||0)-target;
    if(n>target&&needed>0&&discountInfo.values.indexOf(needed)>=0){
      var key=String(n);if(!map[key])map[key]={value:n,count:0,discount:needed};
      map[key].count++;
    }
  });
  return Object.keys(map).map(function(k){return map[k]}).sort(function(a,b){
    var ad=discountInfo.counts[a.discount]||0,bd=discountInfo.counts[b.discount]||0;
    return bd-ad||b.count-a.count||a.value-b.value;
  });
}
function discountedRowByStructure(rows,text,amount){
  var target=Number(amount||0),info=receiptDiscountValues(text);
  if(!target||!info.values.length)return null;
  var merged=mergeProductRows(rows).filter(function(x){
    var original=Number(x.total||0),needed=original-target;
    return original>target&&needed>0&&info.values.indexOf(needed)>=0;
  });
  if(merged.length){
    merged.sort(function(a,b){
      var da=(info.counts[Number(a.total||0)-target]||0),db=(info.counts[Number(b.total||0)-target]||0);
      return db-da||Number(b.quality||0)-Number(a.quality||0);
    });
    var best=merged[0],original=Number(best.total||0),discount=original-target,name=normalizeProductName(best.name);
    var weak=isGarbageProductName(name)||productMeaningfulScore(name)<24;
    return{name:weak?"商品名要確認":name,rawName:name,unitPrice:original,qty:1,total:target,originalTotal:original,discount:discount,discounted:true,lowConfidence:weak,quality:Number(best.quality||0)};
  }
  // Even when product-name OCR is unusable, preserve a mathematically verified
  // price/discount/total relationship directly from receipt text.
  var priceCandidates=receiptOriginalPriceCandidates(text,target,info);
  // Synthetic single-item recovery is safe only when exactly one original-price
  // relationship explains the receipt total. Ambiguous multi-price receipts stay unresolved.
  if(priceCandidates.length!==1)return null;
  var pc=priceCandidates[0];
  return{name:"商品名要確認",rawName:"",unitPrice:pc.value,qty:1,total:target,originalTotal:pc.value,discount:pc.discount,discounted:true,lowConfidence:true,synthetic:true,quality:0};
}
function recoverDiscountedStructure(rows,text,amount){
  var row=discountedRowByStructure(rows,text,amount);
  if(!row)return null;
  // Recovery mode is intentionally conservative: preserve the accounting structure
  // while refusing to present a weak OCR string as a confirmed product name.
  if(productMeaningfulScore(row.rawName||row.name)<30){row.name="商品名要確認";row.lowConfidence=true}
  return row;
}
function discountedSingleItem(rows,text,amount){
  var row=discountedRowByStructure(rows,text,amount);
  if(!row||row.lowConfidence)return null;
  return row;
}
function receiptTenderedAmount(text,total){
  total=Number(total||0);var vals=[];
  normalize(text).split("\n").forEach(function(line){
    line=ocrMoneyClean(line.trim());if(!line)return;
    if(!/(?:現金|cash|お?預り|預り|預かり)/i.test(line))return;
    var n=numberFromLine(line);if(n>=total&&n<=1000000)vals.push(n);
  });
  vals.sort(function(a,b){return a-b});return vals[0]||0;
}
function removeDerivedChangeRows(rows,text,total){
  rows=(rows||[]).slice();total=Number(total||0);
  var tender=receiptTenderedAmount(text,total),change=tender>total?tender-total:0;
  if(!change)return rows;
  // Only remove the derived change when the receipt itself contains a change cue.
  // This avoids deleting a legitimate product that merely has the same price.
  var hasChangeCue=isChangeCueText(text);
  if(!hasChangeCue)return rows;
  return rows.filter(function(x){return Number(x.total||0)!==change&&!isChangeCueText(String(x.name||""))});
}
function parseReceiptText(input,baseDate){
  var obj=input&&typeof input==="object"&&!Array.isArray(input)?input:null,raw=normalize(obj?obj.text:input),whole=normalize(obj&&obj.whole||""),shopText=normalize(obj&&obj.shopText||""),itemText=normalize(obj&&obj.itemText||""),paymentText=normalize(obj&&obj.paymentText||""),sections=obj&&obj.sections||{},top=normalize(sections.top||""),middle=normalize(sections.middle||""),bottom=normalize(sections.bottom||"");
  var shop=bestShopFromSources([shopText,top,raw,whole]);
  if(/^ダイソー/.test(shop)){
    var daisoDetailed=shopFromText([shopText,top,raw,whole].filter(Boolean).join("\n"),true);
    if(/^ダイソー.+店$/.test(daisoDetailed))shop=normalizeDaisoBranch(daisoDetailed);
    else shop=normalizeDaisoBranch(shop);
  }
  var date=dateFromText(top,baseDate||defaultDate(),true)||dateFromText(raw,baseDate||defaultDate());
  var amountInfo=analyzeAmount(raw,[bottom,paymentText].filter(Boolean).join("\n")),amount=amountInfo.amount;
  var payment=paymentFromText(paymentText)||paymentFromSources(bottom,raw,whole);

  // Product extraction is deliberately separate from payment/header parsing.
  // Middle-section candidates get the strongest priority. Whole/raw are fallback
  // sources only after receipt header/payment/summary rows are removed.
  var initialRows=[];
  if(itemText)initialRows=initialRows.concat(itemRowsFromText(productSourceText(itemText),4));
  if(middle)initialRows=initialRows.concat(itemRowsFromText(productSourceText(middle),3));
  if(whole)initialRows=initialRows.concat(itemRowsFromText(productSourceText(whole),2));
  initialRows=initialRows.concat(itemRowsFromText(productSourceText(raw),1));

  var receiptAllText=[itemText,middle,whole,raw,paymentText,bottom].filter(Boolean).join("\n");
  var discounted=discountedSingleItem(initialRows,receiptAllText,amount)||recoverDiscountedStructure(initialRows,receiptAllText,amount);
  var focusConsensus=obj&&obj.meta&&obj.meta.focusConsensus||null,productAnchor=obj&&obj.meta&&obj.meta.productAnchor||null,dictionaryInference=obj&&obj.meta&&obj.meta.dictionaryInference||null;
  if(discounted&&productAnchor&&Number(discounted.originalTotal||0)===Number(productAnchor.value||0)){
    if(focusConsensus&&focusConsensus.accepted&&focusConsensus.name){
      discounted.name=focusConsensus.name;discounted.rawName=focusConsensus.name;discounted.lowConfidence=false;discounted.candidateOnly=false;discounted.candidateSource="ocr";discounted.quality=Math.max(90,Number(discounted.quality||0)+50);
    }else if(dictionaryInference&&dictionaryInference.name){
      var learnedAutoConfirmed=!!dictionaryInference.autoConfirmEligible&&dictionaryInference.source==="learned"&&amountInfo.confidence==="high"&&Number(discounted.originalTotal||0)===Number(productAnchor.value||0);
      discounted.name=dictionaryInference.name;discounted.rawName=dictionaryInference.name;discounted.lowConfidence=!learnedAutoConfirmed;discounted.candidateOnly=!learnedAutoConfirmed;discounted.candidateSource=dictionaryInference.source||"verified_sample";discounted.autoConfirmed=learnedAutoConfirmed;discounted.quality=learnedAutoConfirmed?Math.max(92,Number(discounted.quality||0)+55):Math.max(50,Number(discounted.quality||0));
    }else if(focusConsensus&&focusConsensus.candidateName){
      discounted.name=focusConsensus.candidateName;discounted.rawName=focusConsensus.candidateName;discounted.lowConfidence=true;discounted.candidateOnly=true;discounted.candidateSource="ocr";discounted.quality=Math.max(35,Number(discounted.quality||0));
    }else{
      discounted.name="商品名要確認";discounted.lowConfidence=true;discounted.candidateOnly=false;discounted.candidateSource="";
    }
  }
  initialRows=initialRows.filter(function(x){return !isChangeCueText(String(x.name||""));});
  // Structural change detection: if tender - total equals a parsed row, it is change even when OCR mangles its label.
  initialRows=removeDerivedChangeRows(initialRows,receiptAllText,amount);
  var receiptWideDiscount=receiptDiscountAmount(receiptAllText),itemChoice=discounted?{rows:[discounted],matched:true,sum:amount}:chooseItemsForSubtotal(initialRows,amountInfo.subtotal,amount,receiptWideDiscount),rows=itemChoice.rows;
  if(!rows.length&&amountInfo.subtotal){
    var recoveredSingle=recoverSingleItemRow([itemText,middle,whole,raw],amountInfo.subtotal,amount);
    if(recoveredSingle)rows=[recoveredSingle];
  }
  // Final guard: payment/change lines must never survive into visible product candidates.
  rows=rows.filter(function(x){return !isChangeCueText(String(x.name||""));});
  rows=removeDerivedChangeRows(rows,receiptAllText,amount);
  // Never expose a product set whose sum exceeds the confirmed receipt total.
  if(amount>0&&rows.reduce(function(a,x){return a+Number(x.total||0)},0)>amount)rows=[];
  // If OCR produced only a weak gibberish item, do not pretend it is a reliable product name.
  if(rows.length===1&&productMeaningfulScore(rows[0].name)<15&&!rows[0].lowConfidence)rows=[];
  var items=rows.map(function(x){return x.name}),reliableRows=rows.filter(function(x){return !x.lowConfidence}),cat=categorySuggestion(raw,shop,reliableRows);
  var productLowConfidence=rows.some(function(x){return !!x.lowConfidence});
  var productReadFailed=(!items.length||productLowConfidence)&&!!amount;
  var detailFallback=shop||"レシート購入";
  if(productReadFailed&&/(?:バーガーキング|burger\s*king|マクドナルド|モスバーガー|ケンタッキー|kfc)/i.test(String(shop||"")))detailFallback=shop+"・外食";
  var detailProductAllowed=items.length&&!productLowConfidence&&(!focusConsensus||!focusConsensus.attempted||focusConsensus.accepted&&focusConsensus.confidenceLevel==="high");
  var itemSum=rows.reduce(function(a,x){return a+Number(x.total||0)},0),subtotalTaxMatch=!!(amountInfo.subtotal&&amountInfo.tax&&amountInfo.subtotal+amountInfo.tax===amount);
  var splitRows=productLowConfidence?[]:allocateReceiptRows(rows,amountInfo.subtotal,amountInfo.tax,amount,shop);
  var diag=obj&&obj.diagnostics||[];var diagnosticText=diag.map(function(d,i){return"--- PASS "+(i+1)+" / "+d.label+" ---\n"+(d.text||"(空)")}).join("\n\n");
  var debugText=maskReceiptDebugText([diagnosticText,raw?"--- 統合OCR ---\n"+raw:"",shopText?"--- 店名専用OCR統合 ---\n"+shopText:"",itemText?"--- 商品専用OCR統合 ---\n"+itemText:"",paymentText?"--- 支払専用OCR統合 ---\n"+paymentText:""].filter(Boolean).join("\n\n"));
  var dictionaryAutoConfirmed=!!(dictionaryInference&&dictionaryInference.name&&rows.some(function(x){return !!x.autoConfirmed&&x.name===dictionaryInference.name}));
  var candidateStatus=focusConsensus&&focusConsensus.accepted?"confirmed":dictionaryAutoConfirmed?"confirmed":dictionaryInference&&dictionaryInference.name?"candidate":focusConsensus&&focusConsensus.candidateName?"candidate":"unresolved";
  var candidateSource=focusConsensus&&focusConsensus.accepted?"ocr":dictionaryAutoConfirmed?"learned":dictionaryInference&&dictionaryInference.name?(dictionaryInference.source||"verified_sample"):focusConsensus&&focusConsensus.candidateName?"ocr":"";
  var candidateList=dictionaryInference&&dictionaryInference.name?[dictionaryInference.name].concat(dictionaryInference.alternatives||[]):focusConsensus&&focusConsensus.candidates||[];
  candidateList=candidateList.filter(function(x,i,a){return x&&a.indexOf(x)===i}).slice(0,3);
  return{rawText:raw,debugText:debugText,date:date,shop:shop,amount:amount,amountConfidence:amountInfo.confidence,amountScore:amountInfo.score,subtotal:amountInfo.subtotal,tax:amountInfo.tax,subtotalTaxMatch:subtotalTaxMatch,paymentCandidate:payment,categoryCandidate:cat,items:items,itemRows:rows,splitRows:splitRows,itemSum:itemSum,itemSubtotalMatch:!!(amountInfo.subtotal&&itemSum===amountInfo.subtotal),detail:detailProductAllowed?items.slice(0,2).join("・")+(items.length>2?"ほか":""):detailFallback,productReadFailed:productReadFailed,productLowConfidence:productLowConfidence,productCandidateStatus:candidateStatus,productCandidateSource:candidateSource,productCandidateAutoConfirmed:dictionaryAutoConfirmed,productCandidates:candidateList,productCandidateReason:dictionaryAutoConfirmed?"learned_auto_confirmed":dictionaryInference&&dictionaryInference.name?"merchant_dictionary":focusConsensus&&focusConsensus.rejectionReason||"",discount:receiptDiscountAmount(receiptAllText),tendered:receiptTenderedAmount(receiptAllText,amount),ocrMeta:obj&&obj.meta||null};
}
function renderResult(p,errorText){
  var panel=document.getElementById("receiptOCRPanel");if(!panel)return;
  var cat=p.categoryCandidate,pay=p.paymentCandidate||"",items=(p.items||[]).join("\n"),rows=p.itemRows||[],splitRows=p.splitRows||[],meta=p.ocrMeta||null;
  var preview=previewUrl?'<img class="receipt-preview" src="'+e(previewUrl)+'" alt="撮影したレシートのプレビュー">':"";
  var metaHtml=meta?'<div class="receipt-ocr-meta">分割OCR '+e(meta.passes||"")+"回"+(Math.abs(Number(meta.skew||0))>=.3?" / 傾き補正 "+e(Number(meta.skew).toFixed(1))+"°":"")+(meta.productAnchor?" / 商品価格座標 "+e(yen(meta.productAnchor.value)):"")+'</div>':"";
  if(p.amountConfidence==="high")metaHtml+='<div class="receipt-ocr-meta">金額判定：高信頼'+(p.subtotalTaxMatch?" / 小計＋税一致":"")+(p.itemSubtotalMatch?" / 商品合計＝小計":"")+'</div>';
  var confidenceWarn=p.amountConfidence==="low"?'<div class="warning">金額候補の信頼度が低いため、合計金額を確認してください。</div>':"";
  if(p.productCandidateAutoConfirmed){
    confidenceWarn+='<div class="success">✓ 学習済み商品として自動確認しました：'+e((p.items&&p.items[0])||"")+'</div>';
  }else if(p.productReadFailed){
    if(p.productCandidateStatus==="candidate"&&p.productCandidateSource==="learned")confidenceWarn+='<div class="warning">学習済み候補です。商品名だけ確認してください。</div>';
    else if(p.productCandidateStatus==="candidate"&&p.productCandidateSource==="verified_sample")confidenceWarn+='<div class="warning">辞書候補です。商品名だけ確認してください。</div>';
    else if(p.productCandidateStatus==="candidate")confidenceWarn+='<div class="warning">OCR候補です。商品名だけ確認してください。</div>';
    else confidenceWarn+='<div class="warning">商品名を確定できませんでした。金額計算は保持しています。</div>';
  }
  var rowHtml=rows.length?'<div class="receipt-item-summary"><div class="small"><strong>商品解析</strong></div>'+rows.map(function(x){var tail="";if(x.discounted&&x.originalTotal&&x.discount)tail=yen(x.originalTotal)+" − 値引 "+yen(x.discount)+" ＝ "+yen(x.total);else{if(x.qty>1)tail+="×"+x.qty;if(x.total)tail+=(tail?" = ":"= ")+yen(x.total)}var label=x.candidateOnly?(x.candidateSource==="learned"?"学習済み候補: ":x.candidateSource==="verified_sample"?"辞書候補: ":"OCR候補: "):x.autoConfirmed?"学習済み商品: ":"";return'<div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px"><span style="width:100%;overflow-wrap:anywhere">'+e(label+x.name)+'</span><strong style="width:100%;line-height:1.5">'+e(tail.trim())+'</strong></div>'}).join("")+'</div>':"";
  var splitHtml=splitRows.length>=2?'<div class="receipt-item-summary" id="receiptSplitBox"><label style="display:flex;gap:8px;align-items:center;margin-bottom:10px"><input id="receiptSplitEnabled" type="checkbox" checked style="width:auto;min-height:auto"><strong>商品ごとにカテゴリを振り分ける</strong></label><div class="small" style="margin-bottom:10px">値引きと税を按分し、税込合計が '+e(yen(p.amount||0))+' になるよう調整します。</div>'+splitRows.map(function(x,i){var calc=x.discount>0?'商品 '+yen(x.originalNet)+' − 割引 '+yen(x.discount)+' ＋ 税 '+yen(x.extra)+' ＝ 税込 ':'商品 '+yen(x.net)+' ＋ 税 '+yen(x.extra)+' ＝ 税込 ';return'<div style="display:flex;flex-direction:column;gap:8px;padding:12px 0;border-top:'+(i?'1px solid var(--line,rgba(255,255,255,.10))':'0')+'"><strong style="font-size:1.02em;line-height:1.45">'+e(x.name)+'</strong><div class="small" style="line-height:1.55">'+e(calc)+'<strong>'+e(yen(x.gross))+'</strong></div><select class="receipt-split-category" data-index="'+i+'" style="width:100%">'+categoryOptions(x.categoryId,x.subcategoryId)+'</select></div>'}).join("")+'</div>':"";
  panel.innerHTML='<div class="receipt-result-card">'+preview+
    '<div class="receipt-result-title"><strong>レシート読み取り結果</strong><span class="small">確認・修正してから支出入力へ反映してください。</span>'+metaHtml+'</div>'+
    (errorText?'<div class="warning">'+e(errorText)+' 手入力で補完できます。</div>':"")+confidenceWarn+
    '<div class="form-grid receipt-result-grid">'+
      '<label>日付<input id="receiptDate" type="date" max="'+dstr(now())+'" value="'+e(p.date||defaultDate())+'"></label>'+
      '<label>合計金額<input id="receiptAmount" type="number" inputmode="numeric" min="1" value="'+(p.amount||"")+'" placeholder="読み取れない場合は入力"></label>'+
      '<label class="full">店名<input id="receiptShop" value="'+e(p.shop||"")+'" placeholder="読み取れない場合は入力"></label>'+
      '<label>支払方法候補<select id="receiptPayment"><option value="">未判定</option>'+acctOptions(function(a){return isExpensePaymentAccount(a)},pay)+'</select></label>'+
      '<label>カテゴリ候補<select id="receiptCategory"><option value="">未判定</option>'+categoryOptions(cat&&cat.categoryId||"",cat&&cat.subcategoryId||"")+'</select></label>'+
      '<label class="full">内容<input id="receiptDetail" value="'+e(p.detail||"")+'"></label>'+
      '<label class="full">商品候補<textarea id="receiptItems" rows="3" placeholder="商品名を1行ずつ">'+e(items)+'</textarea>'+(p.productCandidateStatus==="candidate"&&p.productCandidates&&p.productCandidates.length?'<span class="small" style="display:block;margin-top:6px;line-height:1.5">'+e(p.productCandidateSource==="learned"?"学習済み候補: ":p.productCandidateSource==="verified_sample"?"辞書候補: ":"OCR候補: ")+e(p.productCandidates[0])+'</span><label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="receiptCandidateConfirm" type="checkbox" style="width:auto;min-height:auto"'+(p.productCandidateSource==="learned"?" checked":"")+'>この商品名を確認しました</label>':"")+'</label>'+
    '</div>'+rowHtml+splitHtml+
    '<details class="details receipt-raw"><summary>OCR原文を確認</summary><textarea id="receiptRawText" rows="10">'+e(p.debugText||p.rawText||"")+'</textarea></details>'+learnedDictionaryManagerHTML(p.shop||"")+
    '<div class="receipt-result-actions"><button type="button" id="receiptRetakeBtn" class="secondary">撮り直す</button><button type="button" id="receiptApplyBtn" class="primary">支出入力へ反映</button></div>'+
  '</div>';
  var ps=document.getElementById("receiptPayment");if(ps)ps.value=pay;
  var panelData=document.getElementById("receiptOCRPanel");if(panelData){panelData.dataset.splitRows=JSON.stringify(splitRows);panelData.dataset.productCandidateStatus=p.productCandidateStatus||"";panelData.dataset.productCandidateSource=p.productCandidateSource||"";panelData.dataset.productCandidateAutoConfirmed=p.productCandidateAutoConfirmed?"1":"";panelData.dataset.productOriginalPrice=String(rows[0]&&Number(rows[0].originalTotal||rows[0].unitPrice||0)||0)}
  var itemArea=document.getElementById("receiptItems");if(itemArea)itemArea.dataset.initialValue=items;
  var cs=document.getElementById("receiptCategory"),splitToggle=document.getElementById("receiptSplitEnabled"),fallbackCat=cat?cat.categoryId+"|||"+cat.subcategoryId:"";
  function syncOverallCategoryDisplay(){
    if(!cs)return;
    var first=cs.options&&cs.options[0];
    if(splitToggle&&splitToggle.checked&&splitRows.length>=2){
      if(first)first.textContent="商品別振り分け";
      cs.value="";
    }else{
      if(first)first.textContent="未判定";
      cs.value=fallbackCat;
    }
  }
  if(splitToggle)splitToggle.onchange=syncOverallCategoryDisplay;
  syncOverallCategoryDisplay();
  bindLearnedDictionaryManager(p.shop||"");
  document.getElementById("receiptRetakeBtn").onclick=function(){var x=document.getElementById("receiptCameraInput");if(x)x.click()};
  document.getElementById("receiptApplyBtn").onclick=applyResult;
}
function applyResult(){
  var amount=Number(document.getElementById("receiptAmount")&&document.getElementById("receiptAmount").value||0);
  var date=document.getElementById("receiptDate")&&document.getElementById("receiptDate").value||defaultDate();
  var shop=document.getElementById("receiptShop")&&document.getElementById("receiptShop").value.trim()||"";
  var detail=document.getElementById("receiptDetail")&&document.getElementById("receiptDetail").value.trim()||"";
  var itemArea=document.getElementById("receiptItems"),itemText=itemArea&&itemArea.value||"";
  var items=itemText.split(/\n+/).map(function(x){return x.trim()}).filter(Boolean);
  var resultPanel=document.getElementById("receiptOCRPanel"),candidateStatus=resultPanel&&resultPanel.dataset.productCandidateStatus||"",candidateAutoConfirmed=!!(resultPanel&&resultPanel.dataset.productCandidateAutoConfirmed==="1"),candidateConfirmed=candidateAutoConfirmed||(!!document.getElementById("receiptCandidateConfirm")&&document.getElementById("receiptCandidateConfirm").checked);
  var candidateEdited=!!itemArea&&String(itemArea.dataset.initialValue||"").trim()!==itemText.trim();
  if(candidateStatus==="candidate"&&!candidateConfirmed&&!candidateEdited){
    alert("商品名候補を確認してチェックするか、商品名を修正してから反映してください。");
    return;
  }
  var pay=document.getElementById("receiptPayment")&&document.getElementById("receiptPayment").value||"";
  var cat=document.getElementById("receiptCategory")&&document.getElementById("receiptCategory").value||"";
  if(items.length===1&&((candidateConfirmed&&!candidateAutoConfirmed)||candidateEdited)){
    var learnedPrice=Number(resultPanel&&resultPanel.dataset.productOriginalPrice||0);
    rememberVerifiedProduct(shop,items[0],learnedPrice);
  }
  var splitEnabled=!!document.getElementById("receiptSplitEnabled")&&document.getElementById("receiptSplitEnabled").checked,splitPlan=null;
  if(splitEnabled){
    try{
      var panel=document.getElementById("receiptOCRPanel"),baseRows=JSON.parse(panel&&panel.dataset.splitRows||"[]");
      var sels=[].slice.call(document.querySelectorAll(".receipt-split-category"));
      baseRows.forEach(function(x,i){var v=sels[i]&&sels[i].value||"";var parts=v.split("|||");x.categoryId=parts[0]||"";x.subcategoryId=parts[1]||""});
      if(baseRows.length>=2&&baseRows.reduce(function(a,x){return a+Number(x.gross||0)},0)===amount)splitPlan={enabled:true,total:amount,rows:baseRows};
    }catch(_e){}
  }
  var hidden=document.getElementById("receiptSplitPlan");if(hidden)hidden.remove();
  if(splitPlan){hidden=document.createElement("input");hidden.type="hidden";hidden.id="receiptSplitPlan";hidden.value=JSON.stringify(splitPlan);document.getElementById("txForm").appendChild(hidden)}
  if(amount>0)document.getElementById("txAmount").value=String(amount);
  if(date)document.getElementById("txDate").value=date;
  document.getElementById("txShop").value=shop;
  document.getElementById("txDetail").value=detail;
  document.getElementById("txItem").value=items.join(" / ");
  if(pay){setPayment(pay);renderReserveBox(null)}
  if(cat)document.getElementById("txCategory").value=cat;
  var det=document.querySelector("#txForm details.details");if(det)det.open=true;
  validateTx();
  var panel=document.getElementById("receiptOCRPanel");if(panel)panel.innerHTML='<div class="success">✓ レシート内容を支出入力へ反映しました。内容を確認して「登録する」を押してください。</div>';
  setBusy(false,"");
  var amountEl=document.getElementById("txAmount");if(amountEl)amountEl.scrollIntoView({behavior:"smooth",block:"center"});
}

function buildOCRBundle(){
  if(!pendingReceipt)throw new Error("読み取る画像がありません");
  var crop=cropFromSliders()||pendingReceipt.crop,rawCrop=cropCanvas(pendingReceipt.source,crop),skew=estimateSkew(rawCrop),deskewed=rotateCanvas(rawCrop,skew);
  var ratio=deskewed.height/deskewed.width,targetWidth=ratio>2?1200:Math.max(1000,Math.min(1400,deskewed.width)),scale=Math.max(1,targetWidth/deskewed.width),maxPixels=6500000,maxDim=5200;
  scale=Math.min(scale,3.2,maxDim/Math.max(deskewed.width,deskewed.height));if(deskewed.width*deskewed.height*scale*scale>maxPixels)scale=Math.sqrt(maxPixels/(deskewed.width*deskewed.height));scale=Math.max(.7,scale);
  var w=Math.max(1,Math.round(deskewed.width*scale)),h=Math.max(1,Math.round(deskewed.height*scale)),base=document.createElement("canvas");base.width=w;base.height=h;base.getContext("2d",{willReadFrequently:true}).drawImage(deskewed,0,0,w,h);
  var gray=document.createElement("canvas");gray.width=w;gray.height=h;var gctx=gray.getContext("2d",{willReadFrequently:true});gctx.drawImage(base,0,0);
  var binary=document.createElement("canvas");binary.width=w;binary.height=h;var bctx=binary.getContext("2d",{willReadFrequently:true});
  try{
    var im=gctx.getImageData(0,0,w,h),d=im.data,hist=new Uint32Array(256),contrast=1.34;
    for(var i=0;i<d.length;i+=4){var lum=.299*d[i]+.587*d[i+1]+.114*d[i+2],v=clamp((lum-128)*contrast+142,0,255);d[i]=d[i+1]=d[i+2]=v;hist[Math.round(v)]++}
    gctx.putImageData(im,0,0);var total=w*h,sumAll=0;for(var hi=0;hi<256;hi++)sumAll+=hi*hist[hi];var sumB=0,wB=0,maxVar=0,thr=180;
    for(var th=0;th<256;th++){wB+=hist[th];if(!wB)continue;var wF=total-wB;if(!wF)break;sumB+=th*hist[th];var mB=sumB/wB,mF=(sumAll-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);if(between>maxVar){maxVar=between;thr=th}}
    thr=clamp(thr+8,140,210);var bd=new Uint8ClampedArray(d);for(var j=0;j<bd.length;j+=4){var bv=bd[j]<thr?0:255;bd[j]=bd[j+1]=bd[j+2]=bv;bd[j+3]=255}bctx.putImageData(new ImageData(bd,w,h),0,0);
  }catch(_e){bctx.drawImage(gray,0,0)}
  var count=ratio>=3.2?4:ratio>=2?3:2,overlap=.055,slices=[];
  for(var s=0;s<count;s++){var st=Math.max(0,s/count-overlap),en=Math.min(1,(s+1)/count+overlap),role=s===0?"top":s===count-1?"bottom":"middle";slices.push({role:role,index:s,canvas:makeOCRSlice(binary,st,en)})}
  var shopSlices=[
    {canvas:makeOCRRegion(base,.24,.005,.72,.085,5),mode:"7",label:"店名ロゴ中央1",whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"},
    {canvas:makeOCRRegion(gray,.22,.005,.74,.10,4),mode:"8",label:"店名ロゴ中央2",whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"},
    {canvas:makeOCRRegion(binary,.20,.005,.76,.11,3),mode:"11",label:"店名ロゴ中央3",whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"},
    {canvas:makeOCRRegion(gray,.14,0,.86,.17,2),mode:"11",label:"店名ロゴ広域",whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"}
  ];
  // Use overlapping bands instead of assuming every receipt has products at 17-31%.
  // Different receipt layouts place items at very different vertical positions.
  var itemSlices=[
    {canvas:makeOCRScaledSlice(base,.10,.34,2.4),mode:"6",label:"商品上段カラー"},
    {canvas:makeOCRScaledSlice(gray,.10,.34,2.4),mode:"6",label:"商品上段グレー"},
    {canvas:makeOCRScaledSlice(binary,.10,.34,2.2),mode:"6",label:"商品上段二値"},
    {canvas:makeOCRScaledSlice(gray,.22,.52,2.3),mode:"6",label:"商品中段グレー"},
    {canvas:makeOCRScaledSlice(binary,.22,.52,2.1),mode:"6",label:"商品中段二値"},
    {canvas:makeOCRScaledSlice(gray,.34,.66,2),mode:"11",label:"商品下段広域"},
    {canvas:makeOCRSlice(gray,.08,.68),mode:"11",label:"商品全域フォールバック"}
  ];
  var paymentSlices=[
    {canvas:makeOCRSlice(gray,.50,.84),mode:"6",label:"支払方法1"},
    {canvas:makeOCRSlice(binary,.50,.84),mode:"6",label:"支払方法2"},
    {canvas:makeOCRSlice(gray,.64,1),mode:"11",label:"支払方法3"},
    {canvas:makeOCRSlice(binary,.64,1),mode:"11",label:"支払方法4"}
  ];
  return{base:base,gray:gray,binary:binary,slices:slices,shopSlices:shopSlices,itemSlices:itemSlices,paymentSlices:paymentSlices,skew:skew,ratio:ratio};
}
async function readConfirmedReceipt(){
  if(busy||!pendingReceipt)return;
  try{
    setBusy(true,"選択範囲をOCR用に補正しています…");
    var bundle=buildOCRBundle(),ocr=await runOCR(bundle),parsed=parseReceiptText(ocr,document.getElementById("txDate")&&document.getElementById("txDate").value||defaultDate());
    var raw=typeof ocr==="string"?ocr:ocr.text||"";
    setBusy(false,raw.trim()?"分割OCRが完了しました。結果を確認してください。":"文字を十分に読み取れませんでした。手入力で補完できます。");
    renderResult(parsed,raw.trim()?"":"OCRで文字を十分に読み取れませんでした。");
  }catch(err){
    setBusy(false,"レシートの読み取りに失敗しました。");
    renderResult({rawText:"",date:document.getElementById("txDate")&&document.getElementById("txDate").value||defaultDate(),shop:"",amount:0,paymentCandidate:"",categoryCandidate:null,items:[],itemRows:[],detail:""},err&&err.message||"レシートの読み取りに失敗しました。");
  }finally{busy=false}
}
async function runOCR(bundle){
  await loadOCR();setBusy(true,"OCRを初期化しています…");
  var worker=await globalThis.Tesseract.createWorker(["jpn","eng"],1,{logger:progress});
  var full="",parts=[],sectionMap={top:"",middle:"",bottom:""},diagnostics=[];
  try{
    try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:"6"})}catch(_e){}
    ocrPassLabel="全体";
    var whole=await worker.recognize(bundle.gray||bundle,{}, {text:true,blocks:true}),full=String(whole&&whole.data&&whole.data.text||"");diagnostics.push({label:"全体",text:normalize(full)});
    var anchored=anchoredProductSlices(bundle,whole,full),anchorMeta=anchored.anchor||null;
    for(var i=0;i<(bundle.slices||[]).length;i++){
      var sl=bundle.slices[i],num=i+1,total=bundle.slices.length;
      ocrPassLabel="分割 "+num+"/"+total;
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:sl.role==="middle"?"6":"11"})}catch(_e){}
      var ret=await worker.recognize(sl.canvas),txt=String(ret&&ret.data&&ret.data.text||"");
      parts.push(txt);diagnostics.push({label:sl.label||("分割 "+num),text:normalize(txt)});
      if(sl.role==="top")sectionMap.top=mergeOCRTexts(sectionMap.top,txt);
      else if(sl.role==="bottom")sectionMap.bottom=mergeOCRTexts(sectionMap.bottom,txt);
      else sectionMap.middle=mergeOCRTexts(sectionMap.middle,txt);
    }
    var shopText="",shopPasses=0,shopParts=bundle.shopSlices||[];
    var earlyShop=bestShopFromSources([sectionMap.top,full]),knownBrandEarly=/(?:バーガーキング|DAISO|ダイソー|SEIYU|西友|CREATE|クリエイト|マクドナルド|モスバーガー|ケンタッキー)/i.test(String(earlyShop||""));
    if(knownBrandEarly)shopText=earlyShop;
    else for(var si=0;si<shopParts.length;si++){
      var sp=shopParts[si];ocrPassLabel=sp.label||("店名"+(si+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:sp.mode||"7",tessedit_char_whitelist:sp.whitelist||""})}catch(_e){}
      try{var sret=await worker.recognize(sp.canvas),stxt=String(sret&&sret.data&&sret.data.text||"");shopPasses++;diagnostics.push({label:sp.label||("店名"+(si+1)),text:normalize(stxt)});shopText=mergeOCRTexts(shopText,stxt)}catch(_e){}
    }
    try{await worker.setParameters({tessedit_char_whitelist:""})}catch(_e){}
    var shopHint=bestShopFromSources([shopText,sectionMap.top,full]),focusEntries=[];
    if(anchorMeta&&anchorMeta.text)focusEntries.push({family:"whole",label:"全体座標行",text:anchorMeta.text});
    var dictionaryInference=merchantProductInference(shopHint,focusEntries,full,anchorMeta&&anchorMeta.value||0);
    var itemText="",itemPasses=0,itemParts=dictionaryInference?[]:(bundle.itemSlices||[]);
    if(dictionaryInference&&anchorMeta&&anchorMeta.text)itemText=anchorMeta.text;
    for(var ii=0;ii<itemParts.length;ii++){
      var ip=itemParts[ii];ocrPassLabel=ip.label||("商品"+(ii+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:ip.mode||"6",tessedit_char_whitelist:""})}catch(_e){}
      try{var iret=await worker.recognize(ip.canvas),itxt=String(iret&&iret.data&&iret.data.text||"");itemPasses++;diagnostics.push({label:ip.label||("商品"+(ii+1)),text:normalize(itxt)});itemText=mergeOCRTexts(itemText,itxt)}catch(_e){}
    }
    if(anchorMeta&&anchorMeta.value){
      normalize(itemText).split("\n").forEach(function(line){
        if(numberFromLine(line)===Number(anchorMeta.value))focusEntries.push({family:"item",label:"商品帯OCR",text:line});
      });
    }
    if(!dictionaryInference)dictionaryInference=merchantProductInference(shopHint,focusEntries,[itemText,full].filter(Boolean).join("\n"),anchorMeta&&anchorMeta.value||0);
    if(dictionaryInference){
      diagnostics.push({label:"店舗別商品辞書",text:
        "suggestion: "+dictionaryInference.name+"\n"+
        "score: "+dictionaryInference.score+"\n"+
        "priceMatch: "+dictionaryInference.priceMatch+"\n"+
        "textSimilarity: "+dictionaryInference.textSimilarity.toFixed(2)+"\n"+
        "source: "+merchantDictionarySourceLabel(dictionaryInference.source)+"\n"+
        "autoConfirmEligible: "+!!dictionaryInference.autoConfirmEligible+"\n"+
        "samePriceMatches: "+Number(dictionaryInference.samePriceMatches||0)+"\n"+
        "observed: "+(dictionaryInference.bestObserved||"(なし)")
      });
    }
    var focusParts=dictionaryInference?[]:(anchored&&anchored.slices||[]);
    for(var li=0;li<focusParts.length;li++){
      var lp=focusParts[li];ocrPassLabel=lp.label||("商品価格座標再OCR"+(li+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:lp.mode||"7",tessedit_char_whitelist:""})}catch(_e){}
      try{
        var lret=await worker.recognize(lp.canvas),ltxt=String(lret&&lret.data&&lret.data.text||""),normalizedFocus=normalizeAnchoredOCRText(ltxt,lp.anchorValue,lp.appendPrice);
        itemPasses++;diagnostics.push({label:lp.label||("商品価格座標再OCR"+(li+1)),text:normalizedFocus||normalize(ltxt)});
        if(normalizedFocus)focusEntries.push({family:"focused",label:lp.label||"",text:normalizedFocus});
      }catch(_e){}
    }
    var focusConsensus=focusedProductConsensus(focusEntries,anchorMeta&&anchorMeta.value||0,{shop:shopHint});
    if(focusConsensus.attempted){
      diagnostics.push({label:"商品名合意判定",text:
        "rawProductLine: "+(anchorMeta&&anchorMeta.text||focusConsensus.rawProductLine||"(なし)")+"\n"+
        "normalizedProductLine: "+(focusConsensus.normalizedProductLine||"(なし)")+"\n"+
        "bestProductCandidate: "+(focusConsensus.name||focusConsensus.candidateName||"(なし)")+"\n"+
        "consensusSupport: "+focusConsensus.support+"\n"+
        "independentSourceSupport: "+focusConsensus.familySupport+"\n"+
        "confidenceLevel: "+focusConsensus.confidenceLevel+"\n"+
        "rejectionReason: "+focusConsensus.rejectionReason+"\n"+
        "candidates: "+(focusConsensus.candidates.join(" | ")||"(なし)")
      });
      if(focusConsensus.accepted)itemText=mergeOCRTexts(itemText,focusConsensus.name+" ¥"+focusConsensus.value);
    }
    var paymentText="",paymentPasses=0,paymentParts=bundle.paymentSlices||[];
    var earlyPaymentText=[sectionMap.bottom,full].filter(Boolean).join("\n"),earlyPayment=paymentFromText(sectionMap.bottom)||paymentFromText(full);
    if(earlyPayment)paymentText=earlyPaymentText;
    else for(var pi=0;pi<paymentParts.length;pi++){
      var pp=paymentParts[pi];ocrPassLabel=pp.label||("支払方法"+(pi+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:pp.mode||"11"})}catch(_e){}
      try{var pret=await worker.recognize(pp.canvas),ptxt=String(pret&&pret.data&&pret.data.text||"");paymentPasses++;diagnostics.push({label:pp.label||("支払方法"+(pi+1)),text:normalize(ptxt)});paymentText=mergeOCRTexts(paymentText,ptxt);if(paymentFromText(paymentText))break}catch(_e){}
    }
    var merged=full;parts.forEach(function(x){merged=mergeOCRTexts(merged,x)});
    ocrPassLabel="";
    return{text:merged,whole:normalize(full),sections:{top:normalize(sectionMap.top),middle:normalize(sectionMap.middle),bottom:normalize(sectionMap.bottom)},shopText:normalize(shopText),itemText:normalize(itemText),paymentText:normalize(paymentText),diagnostics:diagnostics,meta:{passes:1+parts.length+shopPasses+itemPasses+paymentPasses,skew:Number(bundle.skew||0),ratio:Number(bundle.ratio||0),productAnchor:anchorMeta?{value:anchorMeta.value,discount:anchorMeta.discount,text:anchorMeta.text}:null,focusConsensus:focusConsensus,dictionaryInference:dictionaryInference}};
  }finally{ocrPassLabel="";try{await worker.terminate()}catch(_e){}}
}
async function handleFile(file){
  if(busy||!file)return;
  var panel=document.getElementById("receiptOCRPanel");if(panel)panel.innerHTML="";
  try{await prepareImage(file)}
  catch(err){setBusy(false,"画像の準備に失敗しました。");if(panel)panel.innerHTML='<div class="errorbox">'+e(err&&err.message||"画像を読み込めませんでした。")+'</div>';busy=false}
}
function bindBox(){
  var cam=document.getElementById("receiptCameraInput"),gal=document.getElementById("receiptGalleryInput");
  var cb=document.getElementById("receiptCameraBtn"),gb=document.getElementById("receiptGalleryBtn");
  if(cb)cb.onclick=function(){if(cam)cam.click()};
  if(gb)gb.onclick=function(){if(gal)gal.click()};
  function bind(input){if(!input)return;input.onchange=async function(ev){var f=ev.target.files&&ev.target.files[0];ev.target.value="";if(f)await handleFile(f)}}
  bind(cam);bind(gal);
}
function enhance(){
  var form=document.getElementById("txForm"),type=document.getElementById("txType"),id=document.getElementById("txId");
  if(!form||!type||type.value!=="expense"||(id&&id.value)||document.getElementById("receiptFeatureBox"))return;
  var q=form.querySelector(".quick-amounts"),anchor=q&&q.parentElement;
  if(anchor)anchor.insertAdjacentHTML("afterend",captureHTML());else form.insertAdjacentHTML("afterbegin",captureHTML());
  bindBox();
}
function receiptTests(){
  var sample="○○スーパー\n2026/09/24\n牛乳 238\n冷凍餃子 398\n小計 636\n合計 636\nVISA";
  var before=state.transactions.length,p=parseReceiptText(sample,"2026-09-24");
  var p2=parseReceiptText("○○店\n2026/09/24\n商品 940\n合計 940\nお預り 1000\nお釣り 60\n現金","2026-09-24");
  var createSample="薬 CREATE\nドラッグストア クリエイト\n2026年09月24日(木)17時12分 #0716\n◎LDC サイダー 1.5L\n@99 2 198\n◎キリン ラブズスポーツ 159\n◎キリン 午後の紅茶 白ぶどう\n@79 6 474\n9点 小計 ¥831\n合計 ¥897\n(含む消費税等 ¥66)\n楽天ペイ ¥897\n取引ID 2135820260924171249034600030716\nポイント対象金額 ¥831\n前回累計ポイント 730P\n今回ポイント 8P\n合計P 738P";
  var p3=parseReceiptText(createSample,"2026-09-24");

  var noisyText="薬 CREATE\nドラッグストア クリエイト\n2026年09月24日(木)17時12分\n92キリン ラブズスポーツ. 159\njia、2 198\n8 キリン 午後の紅茶 白ぶどう\n@79 6 474\n@LbC_ サイダー 1.5L\n@99 2 198\nぷぷキリン ラブズスポポーツ 159\n@キリン 午後の紅茶 白ぶどう\n@79 6 474\n小計 ¥831\n合計 89\n含む消費税等 ¥66\n楽天ペイ ¥897\nポイント対象金額 ¥831\n前回累計ポイント 730P\n今回ポイント 8P\n合計P 738P";
  var noisyObj={text:noisyText,sections:{
    top:"薬 CREATE\nドラッグストア クリエイト\n2026年09月24日(木)17時12分",
    middle:"92キリン ラブズスポーツ. 159\njia、2 198\n8 キリン 午後の紅茶 白ぶどう\n@79 6 474\n@LbC_ サイダー 1.5L\n@99 2 198\nぷぷキリン ラブズスポポーツ 159\n@キリン 午後の紅茶 白ぶどう\n@79 6 474",
    bottom:"小計 ¥831\n合計 89\n含む消費税等 ¥66\n楽天ペイ ¥897\n前回累計ポイント 730P\n合計P 738P"
  },whole:noisyText,meta:{passes:5,skew:.8,ratio:4}};
  var p4=parseReceiptText(noisyObj,"2026-09-24"),names=p4.itemRows.map(function(x){return x.name}),joined=names.join("|");
  var row159=p4.itemRows.find(function(x){return x.total===159}),row198=p4.itemRows.find(function(x){return x.total===198}),row474=p4.itemRows.find(function(x){return x.total===474});

  // V3.2.8.5.13 actual-device regression:
  // bottom/raw can miss Rakuten Pay while whole OCR still sees it, and the 198-yen
  // product can be fused to a date/time/register header.
  var deviceRaw="薬 CREATE\nドラッグストア クリエイト\n2026年09月24日(木)17時12分\n92キリン ラブズスポーツ. 159\n8 キリン 午後の紅茶 白ぶどう\n@79 6 474\n弓26年09月24日(木)17時12分 0716 LDC サイダー 1.5L\n@99 2 198\n小計 ¥831\n含む消費税等 ¥66\n合計 ¥897";
  var deviceObj={text:deviceRaw,whole:deviceRaw+"\n楽 天 ペ イ ¥897",sections:{
    top:"薬 CREATE\nドラッグストア クリエイト\n2026年09月24日(木)17時12分",
    middle:"92キリン ラブズスポーツ. 159\n8 キリン 午後の紅茶 白ぶどう\n@79 6 474\n弓26年09月24日(木)17時12分 0716 LDC サイダー 1.5L\n@99 2 198",
    bottom:"小計 ¥831\n含む消費税等 ¥66\n合計 ¥897"
  },meta:{passes:5,skew:.6,ratio:4}};
  var p5=parseReceiptText(deviceObj,"2026-09-24"),n5=p5.itemRows.map(function(x){return x.name}),j5=n5.join("|"),r198=p5.itemRows.find(function(x){return x.total===198}),r159=p5.itemRows.find(function(x){return x.total===159}),r474=p5.itemRows.find(function(x){return x.total===474});

  var paymentVariants=["楽天Pay","楽天ペイ","楽天 Pay","楽天PAY","Rakuten Pay","R Pay","Ｒ　Ｐａｙ","楽 天 ペ イ"].every(function(x){return paymentFromText(x+" ¥897")==="rakutenpay"});
  var paymentNegative=paymentFromText("PayPay ¥897")!=="rakutenpay"&&paymentFromText("d払い ¥897")!=="rakutenpay";
  var headerStress="2026/09/24 17:12 レジ03 No.1234 担当001 4901234567890 LDC サイダー 1.5L";
  var headerClean=stripReceiptHeaderNoise(headerStress);

  var localityCapacity=normalizeProductName("小平中島町 LDC サイダー 1.5し");
  var paymentFuzzy=["R Pey","R Pak","Rakuten Pey"].every(function(x){return paymentFromText(x+" ¥897")==="rakutenpay"});
  var paymentDedicated=parseReceiptText({text:"合計 ¥897",whole:"合計 ¥897",paymentText:"R Pey ¥897",sections:{bottom:"合計 ¥897"}},"2026-09-24");

  var paymentJapaneseFuzzy=["楽大ペイ","楽天ベイ","楽天へイ","楽夭ペイ"].every(function(x){return paymentFromText(x+" ¥897")==="rakutenpay"});
  var paymentJapaneseNegative=paymentFromText("天気ペイ ¥897")!=="rakutenpay"&&paymentFromText("楽園ペイ ¥897")!=="rakutenpay";

  var seiyuNoisy="Ismwu\n東大和\n2025年 9月26日 (土) 10:59\nFRkk kfopk ホホ 984\n8Y 2点 18\nできき上 265\n沙水沙水 ホ水水水 kkx 984\n小計 2点 ¥237";
  var seiyuObj={text:seiyuNoisy,whole:seiyuNoisy,shopText:"SEIYU",itemText:"※90 バナナオーレ\n値下(元 ¥139) ¥88C\n※01 TRクリスプサワー ¥149C",paymentText:"楽天ベイ ¥255",sections:{top:"Ismwu\n東大和\n2025年 9月26日 (土) 10:59",middle:"FRkk kfopk ホホ 984\n8Y 2点 18",bottom:"小計 2点 ¥237\n消費税額 8% 2点 ¥18"},meta:{passes:9,skew:0,ratio:4}};
  var ps=parseReceiptText(seiyuObj,"2026-09-26"),ps88=ps.itemRows.find(function(x){return x.total===88}),ps149=ps.itemRows.find(function(x){return x.total===149});

  var seiyuWeakObj={text:"SE1YU\n2025年 9月26日 (土) 10:59\n小計 2点 ¥237\n8Y 2点 ¥18",whole:"SE1YU\n小計 2点 ¥237\n8Y 2点 ¥18",shopText:"SE1YU",itemText:"※90 バナナオーレ\n値下(元 ¥139) ¥88C\n※01 TRクリスプサワー ¥149C",paymentText:"楽天ベイ",sections:{top:"SE1YU\n2025年 9月26日 (土) 10:59",middle:"",bottom:"小計 2点 ¥237\n8Y 2点 ¥18"},meta:{passes:12,skew:0,ratio:4}};
  var psw=parseReceiptText(seiyuWeakObj,"2026-09-26");

  var observed510Shop=shopFromText("EIRES18011503002037",false);
  var observed510Code=normalizeProductName('X01「TRクリスプサワー');
  var observed510Good=productMeaningfulScore("バナナオーレ");
  var observed510Bad=productMeaningfulScore("テニーコ ピピビピピムて");
  var observed510Obj={text:"2026年9月26日(土)\n小計 ¥237\n8Y 2点 ¥18",whole:"",shopText:"SEIYU",itemText:"X01「TRクリスプサワー ¥149C\nバナナオーレ\n値下(元 ¥139) ¥88C\nテニーコ ピピビピピムて ¥88C",paymentText:"楽天ペイ",sections:{top:"2026年9月26日(土)",middle:"",bottom:"小計 ¥237\n8Y 2点 ¥18"},meta:{passes:16,skew:0,ratio:4}};
  var p510=parseReceiptText(observed510Obj,"2026-09-26"),p51088=p510.itemRows.find(function(x){return x.total===88}),p510149=p510.itemRows.find(function(x){return x.total===149});

  var splitCats=allocateReceiptRows([{name:"TRクリスプサワー",total:149},{name:"バナナオーレ",total:88}],237,18,255,"西友");
  var splitSnack=splitCats.find(function(x){return /クリスプ/.test(x.name)}),splitDrink=splitCats.find(function(x){return /オーレ/.test(x.name)});

  var seiyuRegShop=shopFromText("東大和\n登録番号 T8011503002037\n電話 042-349-3738",false);

  var daisoObj={
    text:"だんぜん!ダイソー\nDAISO\nダイソー立川幸町店\n2026年09月26日(土)17:54\nC-Cケーブル 3A、1 ¥100外\n小計 1点 ¥100\n10%税抜対象額 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110\n登録番号 T7240001022681\n伝票番号 P20260926175419\nご利用金額 ¥110",
    whole:"だんぜん!ダイソー\nDAISO\nダイソー立川幸町店\nC-Cケーブル 3A、1 ¥100外\n合計 ¥110\n楽天ペイ ¥110",
    shopText:"だんぜん!ダイソー\nDAISO",
    itemText:"レツ 貴 ¥9999939\nハーバハーーールー人及A1 ¥1008\nC-Cケーブル 3A、1 ¥100外",
    paymentText:"決済手段 楽天ペイ\nご利用金額 ¥110",
    sections:{top:"だんぜん!ダイソー\nDAISO\nダイソー立川幸町店\n2026年09月26日(土)17:54",middle:"C-Cケーブル 3A、1 ¥100外",bottom:"小計 1点 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110"},
    meta:{passes:14,skew:0,ratio:4}
  };
  var pd=parseReceiptText(daisoObj,"2026-09-26"),pd100=pd.itemRows.find(function(x){return x.total===100});

  var daisoActualObj={
    text:"だんぜん!ダイソー\nDAISO\nダイソー立川神町店\n2026年09月26日(土)17:54\nC-C ケーブル 3A\n小計 1点 ¥100\n10%税抜対象額 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110",
    whole:"DAISO\nダイソー立川神町店\nC-C ケーブル 3A\n小計 1点 ¥100\n合計 ¥110\n楽天ペイ ¥110",
    shopText:"だんぜん!ダイソー\nDAISO",
    itemText:"C-C ケーブル 3A",
    paymentText:"楽天ペイ ¥110",
    sections:{top:"DAISO\nダイソー立川神町店\n2026年09月26日(土)17:54",middle:"C-C ケーブル 3A",bottom:"小計 1点 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110"},
    meta:{passes:14,skew:0,ratio:4}
  };
  var pda=parseReceiptText(daisoActualObj,"2026-09-26"),pdaRow=pda.itemRows[0]||null;

  var bkRegressionObj={
    text:"バーガーキング立川北口趾\n2026-09-27 10:28:26\nE 【りのたかセト】 1 ¥1,090\nクーポン割引 ¥-250\nE >Sフレンチフライ 1 ¥0\n合計金額 ¥840\n(内 消費税 ¥76)\n[ 現金 ] ¥1,000\n[ お釣 ] ¥160",
    whole:"ガーキンク立川北口店\nE 【7の7ーたがセト】 ¥1,090\nクーポン割引 ¥-250\n合計金額 ¥840\n[ 現金 ] ¥1,000\n[ お釣 ] ¥160",
    shopText:"",
    itemText:"E 【りのたかセト】 1 ¥1,090\nクーポン割引 ¥-250\nE 【9のアーたかセト】 1 ¥1,090\nクーポン割引 ¥-230",
    paymentText:"[ 現金 ] ¥1,000\n[ お釣 ] ¥160",
    sections:{top:"ガーキンク立川北口店\n2026-09-27 10:28:26",middle:"E 【りのたかセト】 1 ¥1,090\nクーポン割引 ¥-250",bottom:"合計金額 ¥840\n[ 現金 ] ¥1,000\n[ お釣 ] ¥160"},
    meta:{passes:16,skew:0,ratio:4}
  };
  var pbk=parseReceiptText(bkRegressionObj,"2026-09-27"),pbkRow=pbk.itemRows[0]||null;
  var bkCoordBlocks=[{paragraphs:[{lines:[{text:"E 【りのたかセト】 1 ¥1,090",bbox:{x0:80,y0:620,x1:900,y1:660},words:[
    {text:"E",bbox:{x0:80,y0:620,x1:110,y1:660}},
    {text:"【りのたかセト】",bbox:{x0:120,y0:620,x1:560,y1:660}},
    {text:"1",bbox:{x0:620,y0:620,x1:650,y1:660}},
    {text:"¥1,090",bbox:{x0:720,y0:620,x1:900,y1:660}}
  ]}]}]}];
  var bkCoord=anchoredProductLineFromBlocks(bkCoordBlocks,"クーポン割引 ¥-250\n合計金額 ¥840",1000,1800);
  var badFocusConsensus=focusedProductConsensus([
    {family:"focused",text:"E 【7のたかセト】 欄夫を ¥1,090"},
    {family:"focused",text:"E 【りのたかセト】 ¥1,090"},
    {family:"focused",text:"E 【9のアーたかセト】 ¥1,090"},
    {family:"focused",text:"E 【7のたかセト】 ¥1,090"}
  ],1090,{shop:"バーガーキング立川北口店"});
  var goodFocusConsensus=focusedProductConsensus([
    {family:"whole",text:"E 【ワッパーチーズセット】 ¥1,090"},
    {family:"item",text:"【ワッパーチーズセット】 ¥1,090"},
    {family:"focused",text:"ワッパーチーズセット ¥1,090"}
  ],1090,{shop:"バーガーキング立川北口店"});
  var maskedDebug=maskReceiptDebugText("メンバーシップ会員番号 0000154697\n店舗 042-512-9717\nアンケートコード 7010-3903-0077-2123");
  var ambiguousDiscount=discountedRowByStructure([],"商品A ¥1,090\nクーポン割引 ¥-250\n商品B ¥1,070\nクーポン割引 ¥-230\n合計 ¥840",840);
  var bkDictionarySuggestion=merchantProductInference("バーガーキング立川北口店",[
    {text:"E 【りの\"-たかセト】 1 ¥1,090"},
    {text:"E 【ワのアーたかセト】 1 ¥1,090"}
  ],"クーポン割引 ¥-250\n合計 ¥840",1090);
  var bkDictionaryWrongPrice=merchantProductInference("バーガーキング立川北口店",[
    {text:"E 【りの\"-たかセト】 1 ¥980"}
  ],"合計 ¥980",980);

  var mergedDictPriority=mergeMerchantDictionaryEntries(
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット"],priceHints:[1090],source:"learned"}],
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット"],priceHints:[1090],source:"verified_sample"}]
  );
  var pureBkSuggestion=merchantProductInferenceFromDictionary(
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット","ワッパー チーズ セット"],priceHints:[1090],source:"verified_sample"}],
    [{text:"E 【りの\"-たかセト】 1 ¥1,090"},{text:"E 【ワのアーたかセト】 1 ¥1,090"}],
    "クーポン割引 ¥-250\n合計 ¥840",1090
  );
  var pureBkWrongSamePrice=merchantProductInferenceFromDictionary(
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット"],priceHints:[1090],source:"verified_sample"}],
    [{text:"E 【フィッシュバーガー】 1 ¥1,090"}],
    "合計 ¥1,090",1090
  );
  var learnedAutoConfirm=merchantProductInferenceFromDictionary(
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット"],priceHints:[1090],source:"learned"}],
    [{text:"E 【りの\"-たかセト】 1 ¥1,090"}],
    "クーポン割引 ¥-250\n合計 ¥840",1090
  );
  var builtInNoAutoConfirm=merchantProductInferenceFromDictionary(
    [{name:"ワッパーチーズセット",aliases:["ワッパーチーズセット"],priceHints:[1090],source:"verified_sample"}],
    [{text:"E 【りの\"-たかセト】 1 ¥1,090"}],
    "クーポン割引 ¥-250\n合計 ¥840",1090
  );

  var daiso522Name=normalizeProductName("CCケーブル 3A、 1 ¥1004%");
  var daiso522Obj={
    text:"DAISO\nダイソー立川幸町店\n2026年09月26日(土)17:54\nCCケーブル 3A、 1 ¥1004%\n小計 1点 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110",
    whole:"DAISO\nダイソー立川幸町店\nCCケーブル 3A、 1 ¥1004%\n小計 1点 ¥100\n合計 ¥110\n楽天ペイ ¥110",
    shopText:"DAISO",
    itemText:"CCケーブル 3A、 1 ¥1004%",
    paymentText:"楽天ペイ ¥110",
    sections:{top:"DAISO\nダイソー立川幸町店\n2026年09月26日(土)17:54",middle:"CCケーブル 3A、 1 ¥1004%",bottom:"小計 1点 ¥100\n10%税額 ¥10\n合計 ¥110\n楽天ペイ ¥110"},
    meta:{passes:14,skew:0,ratio:4}
  };
  var p522=parseReceiptText(daiso522Obj,"2026-09-26"),p522Row=p522.itemRows[0]||null;

  return[
    ["receipt Burger King bad focused OCR not auto-confirmed test",badFocusConsensus.attempted===true&&badFocusConsensus.accepted===false],
    ["receipt Burger King same-family OCR stays medium test",badFocusConsensus.confidenceLevel==="medium"&&!!badFocusConsensus.candidateName&&badFocusConsensus.familySupport===1&&badFocusConsensus.rejectionReason==="same_source_family_only"],
    ["receipt Burger King focused cleanup test",cleanFocusedProductName("E 【7のたかセト】 欄夫を ¥1,090",1090)==="7のたかセット"],
    ["receipt Burger King good independent-source consensus acceptance test",goodFocusConsensus.accepted===true&&goodFocusConsensus.name==="ワッパーチーズセット"&&goodFocusConsensus.familySupport>=2],
    ["receipt debug privacy mask test",maskedDebug.indexOf("0000154697")<0&&maskedDebug.indexOf("042-512-9717")<0&&maskedDebug.indexOf("7010-3903-0077-2123")<0],
    ["receipt ambiguous synthetic discount recovery rejected test",ambiguousDiscount===null],
    ["receipt Burger King merchant dictionary suggestion test",!!bkDictionarySuggestion&&bkDictionarySuggestion.name==="ワッパーチーズセット"&&bkDictionarySuggestion.confirmed===false&&bkDictionarySuggestion.priceMatch===true],
    ["receipt Burger King merchant dictionary price guard test",bkDictionaryWrongPrice===null],
    ["receipt learned dictionary priority test",mergedDictPriority.length===1&&mergedDictPriority[0].source==="learned"],
    ["receipt pure merchant dictionary suggestion test",!!pureBkSuggestion&&pureBkSuggestion.name==="ワッパーチーズセット"&&pureBkSuggestion.confirmed===false],
    ["receipt merchant dictionary same-price text guard test",pureBkWrongSamePrice===null],
    ["receipt learned candidate auto-confirm eligibility test",!!learnedAutoConfirm&&learnedAutoConfirm.autoConfirmEligible===true&&learnedAutoConfirm.source==="learned"],
    ["receipt built-in dictionary never auto-confirms test",!!builtInNoAutoConfirm&&builtInNoAutoConfirm.autoConfirmEligible===false],
    ["receipt Burger King price-coordinate anchor test",!!bkCoord&&bkCoord.value===1090&&bkCoord.discount===250&&!!bkCoord.nameBox&&bkCoord.nameBox.x1<900],
    ["receipt Burger King branch fusion test",pbk.shop==="バーガーキング立川北口店"],
    ["receipt Burger King total/payment test",pbk.amount===840&&pbk.paymentCandidate==="wallet"],
    ["receipt Burger King structural item recovery test",!!pbkRow&&pbkRow.total===840&&pbkRow.originalTotal===1090&&pbkRow.discount===250],
    ["receipt Burger King weak-name safeguard test",!!pbkRow&&pbkRow.name==="商品名要確認"],
    ["receipt DAISO 5.22 exact product-name cleanup test",daiso522Name==="C-Cケーブル 3A"],
    ["receipt DAISO 5.22 exact device row test",p522.itemRows.length===1&&!!p522Row&&p522Row.name==="C-Cケーブル 3A"&&p522Row.total===100],
    ["receipt DAISO 5.22 exact device detail test",p522.detail==="C-Cケーブル 3A"],
    ["receipt DAISO C-C token safeguard test",normalizeProductName("C-C ケーブル 3A")==="C-Cケーブル 3A"],
    ["receipt DAISO actual 神→幸 branch correction test",pda.shop==="ダイソー立川幸町店"],
    ["receipt DAISO actual single-item recovery test",pda.itemRows.length===1&&!!pdaRow&&/C-C\s*ケーブル\s*3A/i.test(pdaRow.name)&&pdaRow.total===100],
    ["receipt DAISO actual detail recovery test",/C-C\s*ケーブル\s*3A/i.test(pda.detail)],
    ["receipt DAISO actual no split test",pda.splitRows.length===1],
    ["receipt DAISO shop branch test",pd.shop==="ダイソー立川幸町店"],
    ["receipt DAISO accounting test",pd.date==="2026-09-26"&&pd.amount===110&&pd.subtotal===100&&pd.tax===10&&pd.paymentCandidate==="rakutenpay"],
    ["receipt DAISO rejects over-total fake items test",pd.itemRows.length===1&&!!pd100],
    ["receipt DAISO C-C cable product test",!!pd100&&/C-Cケーブル\s*3A/i.test(pd100.name)&&pd100.total===100],
    ["receipt DAISO single item no split test",pd.splitRows.length===1],
    ["receipt DAISO cable category test",pd.categoryCandidate&&pd.categoryCandidate.groupName==="デジタル・IT"&&pd.categoryCandidate.subName==="スマホ用品"],
    ["receipt SEIYU registration fingerprint test",seiyuRegShop==="西友"],
    ["receipt item category snack test",splitSnack&&/お菓子|スイーツ/.test(splitSnack.categoryLabel)],
    ["receipt item category drink test",splitDrink&&/飲み物/.test(splitDrink.categoryLabel)],
    ["receipt split tax allocation total test",splitCats.reduce(function(a,x){return a+x.gross},0)===255],
    ["receipt split tax allocation expected test",splitSnack&&splitDrink&&splitSnack.gross===160&&splitDrink.gross===95],
    ["receipt 5.10 digit-heavy SEIYU recovery test",observed510Shop==="西友"],
    ["receipt 5.10 X01 product-code cleanup test",observed510Code==="TRクリスプサワー"],
    ["receipt 5.10 product quality prefers natural beverage test",observed510Good>observed510Bad],
    ["receipt 5.10 alternate product candidate selection test",!!p51088&&p51088.name==="バナナオーレ"&&!!p510149&&p510149.name==="TRクリスプサワー"],
    ["receipt 5.10 preserved accounting test",p510.amount===255&&p510.paymentCandidate==="rakutenpay"&&p510.date==="2026-09-26"],
    ["receipt 5.10 category after name recovery test",p510.categoryCandidate&&p510.categoryCandidate.groupName==="食費"&&p510.categoryCandidate.subName==="スーパー・食材"],
    ["receipt SEIYU weak payment amount derived total test",psw.amount===255&&psw.subtotal===237&&psw.tax===18&&psw.subtotalTaxMatch===true],
    ["receipt SEIYU fuzzy logo test",psw.shop==="西友"],
    ["receipt SEIYU weak payment detection test",psw.paymentCandidate==="rakutenpay"],
    ["receipt SEIYU weak item/category test",psw.itemRows.length===2&&psw.itemSum===237&&psw.categoryCandidate&&psw.categoryCandidate.subName==="スーパー・食材"],
    ["receipt debug supplemental OCR test",/店名専用OCR/.test(psw.debugText)&&/商品専用OCR/.test(psw.debugText)&&/支払専用OCR/.test(psw.debugText)],
    ["receipt SEIYU date weekday correction test",ps.date==="2026-09-26"],
    ["receipt SEIYU total test",ps.amount===255&&ps.subtotal===237&&ps.tax===18&&ps.subtotalTaxMatch===true],
    ["receipt SEIYU shop supplemental OCR test",ps.shop==="西友"],
    ["receipt SEIYU payment test",ps.paymentCandidate==="rakutenpay"],
    ["receipt SEIYU product discount test",!!ps88&&ps88.name==="バナナオーレ"&&!!ps149&&ps149.name==="TRクリスプサワー"],
    ["receipt SEIYU item subtotal test",ps.itemSum===237&&ps.itemSubtotalMatch===true],
    ["receipt SEIYU category test",ps.categoryCandidate&&ps.categoryCandidate.groupName==="食費"&&ps.categoryCandidate.subName==="スーパー・食材"],
    ["receipt supplemental OCR isolation test",!ps.items.some(function(x){return /楽天|0984|ポイント|取引ID|FRkk|kkx/i.test(x)})],
    ["receipt Japanese fuzzy Rakuten Pay test",paymentJapaneseFuzzy],
    ["receipt Japanese fuzzy negative test",paymentJapaneseNegative],
    ["receipt locality and capacity cleanup test",localityCapacity==="LDC サイダー 1.5L"],
    ["receipt fuzzy Rakuten Pay OCR test",paymentFuzzy],
    ["receipt dedicated payment OCR fallback test",paymentDedicated.paymentCandidate==="rakutenpay"],
    ["receipt payment variants test",paymentVariants],
    ["receipt payment negative test",paymentNegative],
    ["receipt header long-number cleanup test",headerClean==="LDC サイダー 1.5L"],
    ["receipt capacity preserve test",normalizeProductName("LDC サイダー 1.5L")==="LDC サイダー 1.5L"],
    ["receipt image input test",captureHTML().indexOf('accept="image/*"')>=0&&captureHTML().indexOf('capture="environment"')>=0],
    ["receipt crop confirmation test",captureHTML().indexOf("範囲確認")>=0&&typeof detectReceiptBounds==="function"&&typeof readConfirmedReceipt==="function"],
    ["receipt OCR parser test",!!p&&typeof p==="object"&&!!p3],
    ["receipt total detection test",p.amount===636&&p2.amount===940&&p3.amount===897&&p4.amount===897&&p5.amount===897],
    ["receipt 89 vs 897 score test",p4.amount===897&&p4.amount!==89&&p4.amountConfidence==="high"],
    ["receipt leading digit cleanup test",!!row159&&row159.name==="キリン ラブズスポーツ"&&!!row474&&row474.name==="キリン 午後の紅茶 白ぶどう"],
    ["receipt bad short-name rejection test",!/\bjia\b/i.test(joined)],
    ["receipt best same-price name test",!!row198&&row198.name==="LDC サイダー 1.5L"&&row198.qty===2&&row198.total===198],
    ["receipt product duplicate merge test",p4.itemRows.filter(function(x){return x.total===159}).length===1&&p4.itemRows.filter(function(x){return x.total===198}).length===1&&p4.itemRows.filter(function(x){return x.total===474}).length===1],
    ["receipt final product count test",p4.itemRows.length===3],
    ["receipt product totals test",!!row159&&row159.total===159&&!!row198&&row198.total===198&&!!row474&&row474.qty===6&&row474.total===474],
    ["receipt item subtotal consistency test",p4.itemSum===831&&p4.itemSubtotalMatch===true],
    ["receipt subtotal tax consistency test",p4.subtotal===831&&p4.tax===66&&p4.subtotalTaxMatch===true],
    ["receipt date detection test",p4.date==="2026-09-24"&&p5.date==="2026-09-24"],
    ["receipt shop detection test",p4.shop==="クリエイト"&&p5.shop==="クリエイト"],
    ["receipt payment detection test",p4.paymentCandidate==="rakutenpay"],
    ["receipt payment whole fallback test",p5.paymentCandidate==="rakutenpay"],
    ["receipt header-date product cleanup test",!/(?:2026|26年|09月24日|17時12分|0716)/.test(j5)],
    ["receipt header-noise LDC recovery test",!!r198&&r198.name==="LDC サイダー 1.5L"&&r198.qty===2&&r198.total===198],
    ["receipt actual-device three products test",p5.itemRows.length===3&&!!r159&&r159.name==="キリン ラブズスポーツ"&&!!r474&&r474.name==="キリン 午後の紅茶 白ぶどう"&&r474.qty===6],
    ["receipt actual-device item subtotal test",p5.itemSum===831&&p5.itemSubtotalMatch===true],
    ["receipt actual-device subtotal tax test",p5.subtotal===831&&p5.tax===66&&p5.subtotalTaxMatch===true],
    ["receipt category suggestion test",p5.categoryCandidate&&p5.categoryCandidate.groupName==="食費"&&p5.categoryCandidate.subName==="飲み物"],
    ["receipt detail header-free test",!/(?:2026|26年|09月24日|17時12分|0716)/.test(p5.detail)],
    ["receipt item list header-free test",p5.items.length===3&&!p5.items.some(function(x){return /(?:2026|26年|09月24日|17時12分|0716)/.test(x)})],
    ["receipt preview only test",state.transactions.length===before],
    ["receipt no auto-save test",state.transactions.length===before]
  ];
}
function attachTests(){
  var b=document.getElementById("selfTest");if(!b||b.dataset.receiptWrapped)return;
  var base=b.onclick;b.dataset.receiptWrapped="1";
  b.onclick=function(){if(base)base.call(this);var out=receiptTests(),pass=out.every(function(x){return x[1]}),box=document.getElementById("testResult");if(box)box.insertAdjacentHTML("beforeend",(pass?'<div class="success">v3.42 レシート機能テストもすべて合格しました。</div>':'<div class="errorbox">レシート機能テストに失敗があります。</div>')+out.map(function(x){return"<div>"+(x[1]?"✅":"❌")+" "+e(x[0])+"</div>"}).join(""))};
}
var body=document.getElementById("modalBody");
if(body){new MutationObserver(function(){enhance()}).observe(body,{childList:true,subtree:true})}
document.getElementById("modalClose")&&document.getElementById("modalClose").addEventListener("click",cleanupPreview);
document.getElementById("modalBack")&&document.getElementById("modalBack").addEventListener("click",function(ev){if(ev.target&&ev.target.id==="modalBack")cleanupPreview()});
window.addEventListener("beforeunload",cleanupPreview);
enhance();attachTests();
window.receiptFeature={parseReceiptText:parseReceiptText,amountFromText:amountFromText,dateFromText:dateFromText,paymentFromText:paymentFromText,categorySuggestion:categorySuggestion,tests:receiptTests};
})();