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
function moneyLineExcluded(line){
  return /(ポイント|合計P|今回P|前回累計|残高|お?預り|お?釣|釣銭|消費税|内税|外税|税率|登録番号|取引ID|受付番号|カードNo|TEL|電話|〒|レジ|バーコード|対象金額)/i.test(String(line||""));
}
function mergeOCRTexts(a,b){
  var seen={},out=[];
  [a,b].forEach(function(txt){normalize(txt).split("\n").forEach(function(line){var x=line.trim(),key=x.replace(/\s+/g,"").toLowerCase();if(!x||!key||seen[key])return;seen[key]=1;out.push(x)})});
  return out.join("\n");
}
function findCategoryPair(groupName,subName){
  var g=state.categories.find(function(x){return x.name===groupName}),s=g&&g.subs.find(function(x){return x.name===subName});
  return g&&s?{categoryId:g.id,subcategoryId:s.id,groupName:g.name,subName:s.name,label:g.name+" ＞ "+s.name}:null;
}


function receiptHeaderPattern(){
  return /(?:19|20)?\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{2,4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*時\s*\d{1,2}\s*分|\b\d{1,2}:\d{2}\b|[\(（][日月火水木金土][\)）]|(?:TEL|電話|〒|登録番号|取引ID|受付番号|レシート\s*No|伝票\s*No|カード\s*No|カード番号|店番号|店舗番号|店\s*[:：]|レジ\s*[:：]?|担当|係員|スタッフ|責任者|端末番号|バーコード|領収証|レシート|No[.．:]?\s*\d{3,})|(?:^|\s)\d{8,}(?:\s|$)/i;
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
  if(/総合計|合計|小計|税込|お支払|お?預り|お?釣|釣銭|消費税|内税|外税|税率|軽減税率|対象金額|ポイント|合計P/i.test(s))return"accounting";
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

  var dm=s.match(/^([0-9]{1,3})\s*([ぁ-んァ-ヶー一-龠].{3,})$/);
  if(dm&&!/^(?:[0-9]+(?:ml|l|g|kg)|7up)\b/i.test(s))s=dm[2].trim();
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
  if(/サイダー|スポーツ|紅茶|コーヒー|ジュース|ミルク|お茶|ウォーター|水|ぶどう|レモン/i.test(s))score+=12;
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
  });
}
function chooseItemsForSubtotal(rows,subtotal){
  rows=mergeProductRows(rows).filter(function(x){return x.total>0});
  subtotal=Number(subtotal||0);if(!subtotal||rows.length<2||rows.length>14)return{rows:rows,matched:false,sum:rows.reduce(function(a,x){return a+x.total},0)};
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
  var lines=normalize([text,extraText].filter(Boolean).join("\n")).split("\n").map(function(x){return ocrMoneyClean(x.trim())}).filter(Boolean),map={},subtotal=0,tax=0;
  function add(n,label,score,line){
    n=Number(n||0);if(!n||n>1000000)return;
    var x=map[n]||(map[n]={amount:n,score:0,occurrences:0,labels:{},lines:[]});
    x.score+=score;x.occurrences++;x.labels[label]=true;x.lines.push(line);
  }
  lines.forEach(function(line){
    if(/ポイント|合計P|今回P|前回累計|残高|登録番号|取引ID|受付番号|カード\s*No|カード番号|TEL|電話|〒|レジ|店番号|バーコード/i.test(line))return;
    var n=labeledMoney(line);if(!n)return;
    if(/小計/i.test(line)){subtotal=subtotal||n;add(n,"subtotal",30,line);return}
    if(/消費税|税額|内税|外税/i.test(line)){tax=tax||n;return}
    if(/お?預り|お?釣|釣銭/i.test(line))return;
    if(/お支払(?:い)?額|お買上(?:げ)?額|領収金額|総合計|税込合計|合計金額/i.test(line)){add(n,"total",100,line);return}
    if(/(?:^|[\s:：])合\s*計(?:[\s:：]|¥|\\|Y|[0-9]|$)/i.test(line)){add(n,"total",100,line);return}
    if(/含計|台計|合汁|合言十/i.test(line)){add(n,"fuzzyTotal",70,line);return}
    if(paymentFromText(line)){add(n,"payment",90,line);return}
    if(/現金|cash/i.test(line)){add(n,"cash",85,line);return}
  });
  var cand=Object.keys(map).map(function(k){return map[k]});
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
  var bad=/(総合計|合計|小計|税込|お支払|お?預り|お?釣|釣銭|消費税|内税|外税|税率|8\s*%|10\s*%|軽減税率|対象金額|ポイント|合計P|楽天\s*(?:pay|ペイ)|paypay|d払い|au\s*pay|クレジット|visa|master|jcb|amex|残高|receipt|領収|tel|電話|〒|登録番号|取引ID|受付番号|カード\s*no|カード番号|レジ|店番号|担当|日時|日付|バーコード)/i,out=[];
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
  function sameProductMatch(s){return ocrMoneyClean(s).match(/^(.{2,58}?[ぁ-んァ-ヶー一-龠A-Za-z][^¥￥]*?)\s+(?:¥|￥)?\s*([0-9]{1,7})\s*(?:円)?\s*(?:[A-Z※*])?\s*$/i)}
  function discountTotal(s){var x=ocrMoneyClean(s);if(!/値下|値引|割引|特価|sale/i.test(x))return 0;var nums=[],re=/(?:¥|￥)?\s*([0-9]{1,7})/g,m;while((m=re.exec(x)))nums.push(Number(m[1]||0));return nums.length?nums[nums.length-1]:0;}
  for(var i=0;i<lines.length;i++){
    var line=ocrMoneyClean(lines[i]);if(bad.test(line))continue;
    var next=i+1<lines.length?ocrMoneyClean(lines[i+1]):"",next2=i+2<lines.length?ocrMoneyClean(lines[i+2]):"";
    var linePrice=priceRowOf(line),nextPrice=priceRowOf(next),priceRow2=priceRowOf(next2),same=sameProductMatch(line),nextSame=sameProductMatch(next),nextDiscount=discountTotal(next);

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
function shopFromText(text){
  var lines=normalize(text).split("\n").map(function(x){return x.trim()}).filter(Boolean).slice(0,18),joined=lines.join(" ");
  if(/CREATE|クリエイト|ドラッグストア\s*クリエイト/i.test(joined))return"クリエイト";
  if(/\bSEIYU\b|西友/i.test(joined))return"西友";
  if(/マツモトキヨシ|マツキヨ/i.test(joined))return"マツモトキヨシ";
  if(/ウエルシア/i.test(joined))return"ウエルシア";
  if(/スギ薬局/i.test(joined))return"スギ薬局";
  var bad=/(領収|レシート|receipt|tel|電話|〒|登録番号|担当|レジ|日時|日付|合計|小計|お支払|現金|visa|master|jcb|ポイント|取引id|受付番号)/i;
  for(var i=0;i<lines.length;i++){var line=lines[i];if(line.length<2||line.length>45||bad.test(line)||/^\d[\d\s\/\-:.]*$/.test(line)||/^[¥\d,\s円]+$/.test(line))continue;if(/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(line))return line.replace(/^[*#\-=\s]+|[*#\-=\s]+$/g,"").trim()}
  return"";
}
function itemsFromText(text){
  return itemRowsFromText(text).map(function(x){return x.name});
}
function categorySuggestion(text,shop,itemRows){
  var raw=normalize(text).toLowerCase(),rows=Array.isArray(itemRows)?itemRows:[],names=rows.map(function(x){return x.name}).join(" ").toLowerCase();
  var coffee=/コーヒー|coffee|カフェラテ|cafe latte/i,drink=/サイダー|紅茶|スポーツドリンク|ラブズスポーツ|飲料|ジュース|コーラ|炭酸|緑茶|麦茶|ウーロン茶|午後の紅茶|ミネラルウォーター|お茶|オーレ|サワー/i;
  if(names&&coffee.test(names))return findCategoryPair("食費","コーヒー")||findCategoryPair("食費","飲み物");
  if(rows.length){
    var bev=rows.filter(function(x){return drink.test(x.name)}).length;
    if(bev>=Math.max(1,Math.ceil(rows.length*.6)))return findCategoryPair("食費","飲み物");
  }
  if(/スーパー|market|西友|seiyu/i.test(String(shop||"")))return findCategoryPair("食費","スーパー・食材");
  var rules=[
    ["食費","ラーメン・つけ麺・油そば",/ラーメン|らーめん|ramen|つけ麺|油そば/],
    ["医療・健康","薬品代",/医薬品|風邪薬|錠剤|カプセル|ロキソ|薬品/],
    ["娯楽","映画",/toho|シネマ|cinema|映画館|ムービー/],
    ["交通","ガソリン",/eneos|出光|apollostation|ガソリン|給油/],
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
function parseReceiptText(input,baseDate){
  var obj=input&&typeof input==="object"&&!Array.isArray(input)?input:null,raw=normalize(obj?obj.text:input),whole=normalize(obj&&obj.whole||""),shopText=normalize(obj&&obj.shopText||""),itemText=normalize(obj&&obj.itemText||""),paymentText=normalize(obj&&obj.paymentText||""),sections=obj&&obj.sections||{},top=normalize(sections.top||""),middle=normalize(sections.middle||""),bottom=normalize(sections.bottom||"");
  var shop=shopFromText(shopText)||shopFromText(top)||shopFromText(raw);
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

  var itemChoice=chooseItemsForSubtotal(initialRows,amountInfo.subtotal),rows=itemChoice.rows,items=rows.map(function(x){return x.name}),cat=categorySuggestion(raw,shop,rows);
  var itemSum=rows.reduce(function(a,x){return a+Number(x.total||0)},0),subtotalTaxMatch=!!(amountInfo.subtotal&&amountInfo.tax&&amountInfo.subtotal+amountInfo.tax===amount);
  return{rawText:raw,date:date,shop:shop,amount:amount,amountConfidence:amountInfo.confidence,amountScore:amountInfo.score,subtotal:amountInfo.subtotal,tax:amountInfo.tax,subtotalTaxMatch:subtotalTaxMatch,paymentCandidate:payment,categoryCandidate:cat,items:items,itemRows:rows,itemSum:itemSum,itemSubtotalMatch:!!(amountInfo.subtotal&&itemSum===amountInfo.subtotal),detail:items.length?items.slice(0,2).join("・")+(items.length>2?"ほか":""):(shop||"レシート購入"),ocrMeta:obj&&obj.meta||null};
}
function renderResult(p,errorText){
  var panel=document.getElementById("receiptOCRPanel");if(!panel)return;
  var cat=p.categoryCandidate,pay=p.paymentCandidate||"",items=(p.items||[]).join("\n"),rows=p.itemRows||[],meta=p.ocrMeta||null;
  var preview=previewUrl?'<img class="receipt-preview" src="'+e(previewUrl)+'" alt="撮影したレシートのプレビュー">':"";
  var metaHtml=meta?'<div class="receipt-ocr-meta">分割OCR '+e(meta.passes||"")+"回"+(Math.abs(Number(meta.skew||0))>=.3?" / 傾き補正 "+e(Number(meta.skew).toFixed(1))+"°":"")+'</div>':"";
  if(p.amountConfidence==="high")metaHtml+='<div class="receipt-ocr-meta">金額判定：高信頼'+(p.subtotalTaxMatch?" / 小計＋税一致":"")+(p.itemSubtotalMatch?" / 商品合計＝小計":"")+'</div>';
  var confidenceWarn=p.amountConfidence==="low"?'<div class="warning">金額候補の信頼度が低いため、合計金額を確認してください。</div>':"";
  var rowHtml=rows.length?'<div class="receipt-item-summary"><div class="small"><strong>商品解析</strong></div>'+rows.map(function(x){var tail="";if(x.qty>1)tail+="×"+x.qty;if(x.total)tail+=(tail?" = ":"= ")+yen(x.total);return'<div><span>'+e(x.name)+'</span><strong>'+e(tail.trim())+'</strong></div>'}).join("")+'</div>':"";
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
      '<label class="full">商品候補<textarea id="receiptItems" rows="3" placeholder="商品名を1行ずつ">'+e(items)+'</textarea></label>'+
    '</div>'+rowHtml+
    '<details class="details receipt-raw"><summary>OCR原文を確認</summary><textarea id="receiptRawText" rows="7">'+e(p.rawText||"")+'</textarea></details>'+
    '<div class="receipt-result-actions"><button type="button" id="receiptRetakeBtn" class="secondary">撮り直す</button><button type="button" id="receiptApplyBtn" class="primary">支出入力へ反映</button></div>'+
  '</div>';
  var ps=document.getElementById("receiptPayment");if(ps)ps.value=pay;
  var cs=document.getElementById("receiptCategory");if(cs&&cat)cs.value=cat.categoryId+"|||"+cat.subcategoryId;
  document.getElementById("receiptRetakeBtn").onclick=function(){var x=document.getElementById("receiptCameraInput");if(x)x.click()};
  document.getElementById("receiptApplyBtn").onclick=applyResult;
}
function applyResult(){
  var amount=Number(document.getElementById("receiptAmount")&&document.getElementById("receiptAmount").value||0);
  var date=document.getElementById("receiptDate")&&document.getElementById("receiptDate").value||defaultDate();
  var shop=document.getElementById("receiptShop")&&document.getElementById("receiptShop").value.trim()||"";
  var detail=document.getElementById("receiptDetail")&&document.getElementById("receiptDetail").value.trim()||"";
  var itemText=document.getElementById("receiptItems")&&document.getElementById("receiptItems").value||"";
  var items=itemText.split(/\n+/).map(function(x){return x.trim()}).filter(Boolean);
  var pay=document.getElementById("receiptPayment")&&document.getElementById("receiptPayment").value||"";
  var cat=document.getElementById("receiptCategory")&&document.getElementById("receiptCategory").value||"";
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
    {canvas:makeOCRSlice(gray,0,.18),mode:"7",label:"店名1"},
    {canvas:makeOCRSlice(binary,0,.18),mode:"7",label:"店名2"}
  ];
  var itemSlices=[
    {canvas:makeOCRSlice(gray,.12,.46),mode:"6",label:"商品1"},
    {canvas:makeOCRSlice(binary,.12,.46),mode:"6",label:"商品2"}
  ];
  var paymentSlices=[
    {canvas:makeOCRSlice(gray,.50,.84),mode:"6",label:"支払方法1"},
    {canvas:makeOCRSlice(binary,.50,.84),mode:"6",label:"支払方法2"},
    {canvas:makeOCRSlice(gray,.64,1),mode:"11",label:"支払方法3"},
    {canvas:makeOCRSlice(binary,.64,1),mode:"11",label:"支払方法4"}
  ];
  return{gray:gray,binary:binary,slices:slices,shopSlices:shopSlices,itemSlices:itemSlices,paymentSlices:paymentSlices,skew:skew,ratio:ratio};
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
  var full="",parts=[],sectionMap={top:"",middle:"",bottom:""};
  try{
    try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:"6"})}catch(_e){}
    ocrPassLabel="全体";
    var whole=await worker.recognize(bundle.gray||bundle),full=String(whole&&whole.data&&whole.data.text||"");
    for(var i=0;i<(bundle.slices||[]).length;i++){
      var sl=bundle.slices[i],num=i+1,total=bundle.slices.length;
      ocrPassLabel="分割 "+num+"/"+total;
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:sl.role==="middle"?"6":"11"})}catch(_e){}
      var ret=await worker.recognize(sl.canvas),txt=String(ret&&ret.data&&ret.data.text||"");
      parts.push(txt);
      if(sl.role==="top")sectionMap.top=mergeOCRTexts(sectionMap.top,txt);
      else if(sl.role==="bottom")sectionMap.bottom=mergeOCRTexts(sectionMap.bottom,txt);
      else sectionMap.middle=mergeOCRTexts(sectionMap.middle,txt);
    }
    var shopText="",shopPasses=0,shopParts=bundle.shopSlices||[];
    for(var si=0;si<shopParts.length;si++){
      var sp=shopParts[si];ocrPassLabel=sp.label||("店名"+(si+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:sp.mode||"7"})}catch(_e){}
      try{var sret=await worker.recognize(sp.canvas),stxt=String(sret&&sret.data&&sret.data.text||"");shopPasses++;shopText=mergeOCRTexts(shopText,stxt);if(shopFromText(shopText))break}catch(_e){}
    }
    var itemText="",itemPasses=0,itemParts=bundle.itemSlices||[];
    for(var ii=0;ii<itemParts.length;ii++){
      var ip=itemParts[ii];ocrPassLabel=ip.label||("商品"+(ii+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:ip.mode||"6"})}catch(_e){}
      try{var iret=await worker.recognize(ip.canvas),itxt=String(iret&&iret.data&&iret.data.text||"");itemPasses++;itemText=mergeOCRTexts(itemText,itxt)}catch(_e){}
    }
    var paymentText="",paymentPasses=0,paymentParts=bundle.paymentSlices||[];
    for(var pi=0;pi<paymentParts.length;pi++){
      var pp=paymentParts[pi];ocrPassLabel=pp.label||("支払方法"+(pi+1));
      try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:pp.mode||"11"})}catch(_e){}
      try{var pret=await worker.recognize(pp.canvas),ptxt=String(pret&&pret.data&&pret.data.text||"");paymentPasses++;paymentText=mergeOCRTexts(paymentText,ptxt);if(paymentFromText(paymentText))break}catch(_e){}
    }
    var merged=full;parts.forEach(function(x){merged=mergeOCRTexts(merged,x)});
    ocrPassLabel="";
    return{text:merged,whole:normalize(full),sections:{top:normalize(sectionMap.top),middle:normalize(sectionMap.middle),bottom:normalize(sectionMap.bottom)},shopText:normalize(shopText),itemText:normalize(itemText),paymentText:normalize(paymentText),meta:{passes:1+parts.length+shopPasses+itemPasses+paymentPasses,skew:Number(bundle.skew||0),ratio:Number(bundle.ratio||0)}};
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

  // V3.2.8.5.9 actual-device regression:
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

  return[
    ["receipt SEIYU date weekday correction test",ps.date==="2026-09-26"],
    ["receipt SEIYU total test",ps.amount===255&&ps.subtotal===237&&ps.tax===18&&ps.subtotalTaxMatch===true],
    ["receipt SEIYU shop supplemental OCR test",ps.shop==="西友"],
    ["receipt SEIYU payment test",ps.paymentCandidate==="rakutenpay"],
    ["receipt SEIYU product discount test",!!ps88&&ps88.name==="バナナオーレ"&&!!ps149&&ps149.name==="TRクリスプサワー"],
    ["receipt SEIYU item subtotal test",ps.itemSum===237&&ps.itemSubtotalMatch===true],
    ["receipt SEIYU category test",ps.categoryCandidate&&ps.categoryCandidate.groupName==="食費"&&ps.categoryCandidate.subName==="飲み物"],
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
  b.onclick=function(){if(base)base.call(this);var out=receiptTests(),pass=out.every(function(x){return x[1]}),box=document.getElementById("testResult");if(box)box.insertAdjacentHTML("beforeend",(pass?'<div class="success">V3.2.8.5.9 レシート機能テストもすべて合格しました。</div>':'<div class="errorbox">レシート機能テストに失敗があります。</div>')+out.map(function(x){return"<div>"+(x[1]?"✅":"❌")+" "+e(x[0])+"</div>"}).join(""))};
}
var body=document.getElementById("modalBody");
if(body){new MutationObserver(function(){enhance()}).observe(body,{childList:true,subtree:true})}
document.getElementById("modalClose")&&document.getElementById("modalClose").addEventListener("click",cleanupPreview);
document.getElementById("modalBack")&&document.getElementById("modalBack").addEventListener("click",function(ev){if(ev.target&&ev.target.id==="modalBack")cleanupPreview()});
window.addEventListener("beforeunload",cleanupPreview);
enhance();attachTests();
window.receiptFeature={parseReceiptText:parseReceiptText,amountFromText:amountFromText,dateFromText:dateFromText,paymentFromText:paymentFromText,categorySuggestion:categorySuggestion,tests:receiptTests};
})();