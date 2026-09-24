"use strict";
(function(){
var OCR_URL="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
var previewUrl=null,busy=false,loadPromise=null,ocrPassLabel="";

function e(s){return String(s==null?"":s).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}
function captureHTML(){
  return '<div id="receiptFeatureBox" class="receipt-capture-box full">'+
    '<div class="receipt-capture-head"><div><strong>レシートから入力</strong><div class="small">撮影または画像を選択 → 読み取り結果を確認 → 支出入力へ反映</div></div></div>'+
    '<div class="receipt-capture-actions">'+
      '<button type="button" id="receiptCameraBtn" class="secondary receipt-camera-btn" aria-label="レシートをカメラで撮影">📷 レシートを撮影</button>'+
      '<button type="button" id="receiptGalleryBtn" class="secondary" aria-label="レシート画像を選択">画像を選ぶ</button>'+
    '</div>'+
    '<input id="receiptCameraInput" class="receipt-file-input" type="file" accept="image/*" capture="environment">'+
    '<input id="receiptGalleryInput" class="receipt-file-input" type="file" accept="image/*">'+
    '<div class="receipt-privacy-note">OCRエンジン・日本語データの読込には通信を使います。レシート画像そのものはGitHubや家計簿データへ保存しません。</div>'+
    '<div id="receiptOCRStatus" class="receipt-ocr-status" aria-live="polite"></div>'+
    '<div id="receiptOCRPanel"></div>'+
  '</div>';
}
function cleanupPreview(){if(previewUrl){try{URL.revokeObjectURL(previewUrl)}catch(_e){}previewUrl=null}}
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
async function prepareImage(file){
  if(!file)throw new Error("画像が選択されていません");
  if(String(file.type||"").indexOf("image/")!==0)throw new Error("画像ファイルを選んでください");
  if(Number(file.size||0)>25*1024*1024)throw new Error("画像が大きすぎます。25MB以下の画像を使用してください");
  setBusy(true,"画像を読み込んでいます…");
  var img=await loadBitmap(file),w=Number(img.width||img.naturalWidth||0),h=Number(img.height||img.naturalHeight||0);
  if(!w||!h)throw new Error("画像サイズを取得できません");
  var ratio=h/w,maxPixels=5500000,maxDim=4600,targetWidth=ratio>=2?1100:Math.max(900,Math.min(1400,w));
  var scale=Math.max(1,targetWidth/w);
  scale=Math.min(scale,3,maxDim/Math.max(w,h));
  if(w*h*scale*scale>maxPixels)scale=Math.sqrt(maxPixels/(w*h));
  scale=Math.max(.5,scale);
  var cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
  var base=document.createElement("canvas");base.width=cw;base.height=ch;
  var bctx=base.getContext("2d",{willReadFrequently:true});bctx.drawImage(img,0,0,cw,ch);
  try{if(img.close)img.close()}catch(_e){}
  cleanupPreview();
  var pblob=await new Promise(function(resolve){base.toBlob(resolve,"image/jpeg",.9)});
  if(pblob)previewUrl=URL.createObjectURL(pblob);

  setBusy(true,"縦長レシートを読みやすく補正しています…");
  var gray=document.createElement("canvas");gray.width=cw;gray.height=ch;
  var gctx=gray.getContext("2d",{willReadFrequently:true});gctx.drawImage(base,0,0);
  var binary=document.createElement("canvas");binary.width=cw;binary.height=ch;
  var tctx=binary.getContext("2d",{willReadFrequently:true});
  try{
    var im=gctx.getImageData(0,0,cw,ch),d=im.data,hist=new Uint32Array(256),contrast=1.32;
    for(var i=0;i<d.length;i+=4){
      var lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];
      var v=Math.max(0,Math.min(255,(lum-128)*contrast+138));
      d[i]=d[i+1]=d[i+2]=v;hist[Math.round(v)]++;
    }
    gctx.putImageData(im,0,0);
    var total=cw*ch,sumAll=0;for(var hidx=0;hidx<256;hidx++)sumAll+=hidx*hist[hidx];
    var sumB=0,wB=0,maxVar=0,threshold=180;
    for(var th=0;th<256;th++){
      wB+=hist[th];if(!wB)continue;
      var wF=total-wB;if(!wF)break;
      sumB+=th*hist[th];
      var mB=sumB/wB,mF=(sumAll-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);
      if(between>maxVar){maxVar=between;threshold=th}
    }
    threshold=Math.max(145,Math.min(210,threshold+10));
    var bim=new ImageData(new Uint8ClampedArray(d),cw,ch),bd=bim.data;
    for(var j=0;j<bd.length;j+=4){var bv=bd[j]<threshold?0:255;bd[j]=bd[j+1]=bd[j+2]=bv;bd[j+3]=255}
    tctx.putImageData(bim,0,0);
  }catch(_e){
    tctx.drawImage(gray,0,0);
  }
  return{gray:gray,binary:binary,width:cw,height:ch,scale:scale};
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
function itemRowsFromText(text){
  var lines=normalize(text).split("\n").map(function(x){return x.trim()}).filter(Boolean),bad=/(合計|小計|お支払|お?預り|お?釣|消費税|内税|外税|税率|ポイント|残高|visa|master|jcb|楽天ペイ|現金|receipt|領収|tel|電話|〒|登録番号|取引ID|受付番号|カードno|レジ|担当|日時|日付|合計P)/i,out=[];
  function cleanName(s){return String(s||"").replace(/^[◎○●※*#\-=\s]+|[*#\-=\s]+$/g,"").replace(/\s{2,}/g," ").trim()}
  function validName(s){return s&&s.length>=2&&s.length<=48&&/[ぁ-んァ-ヶ一-龠A-Za-z]/.test(s)&&!bad.test(s)}
  function add(name,unit,qty,total){name=cleanName(name);if(!validName(name))return;if(out.some(function(x){return x.name===name&&x.total===total}))return;out.push({name:name,unitPrice:Number(unit||0),qty:Number(qty||1),total:Number(total||0)})}
  for(var i=0;i<lines.length;i++){
    var line=ocrMoneyClean(lines[i]);if(bad.test(line))continue;
    var next=i+1<lines.length?ocrMoneyClean(lines[i+1]):"";
    var priceRow=next.match(/^\s*@?\s*([0-9]{1,6})\s+(?:[x×]\s*)?([0-9]{1,3})\s+(?:¥\s*)?([0-9]{1,7})\s*$/i);
    if(validName(cleanName(line))&&priceRow){add(line,priceRow[1],priceRow[2],priceRow[3]);i++;continue}
    var same=line.match(/^(.{2,48}?[ぁ-んァ-ヶ一-龠A-Za-z][^¥]*?)\s+(?:¥\s*)?([0-9]{1,7})\s*$/);
    if(same){
      var nm=cleanName(same[1]);
      if(!/@\s*[0-9]/.test(nm)&&validName(nm)){add(nm,0,1,same[2]);continue}
    }
  }
  return out.slice(0,12);
}

function dateFromText(text,baseDate){
  var t=normalize(text),base=new Date(String(baseDate||defaultDate())+"T12:00:00");
  t=t.replace(/([0-9])[OoＯ](?=[0-9年月日\/\-.])/g,"$10").replace(/([0-9])[Il｜](?=[0-9年月日\/\-.])/g,"$11");
  function make(y,m,d){var dt=new Date(y,m-1,d);if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==d)return"";return dstr(dt)}
  var full=[/((?:19|20)\d{2})[\/\-.年]\s*(\d{1,2})[\/\-.月]\s*(\d{1,2})日?/,/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/];
  for(var i=0;i<full.length;i++){var m=t.match(full[i]);if(m){var v=make(Number(m[1]),Number(m[2]),Number(m[3]));if(v)return v}}
  var short=t.match(/(?:^|\D)(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:\D|$)/);
  if(short){var sv=make(2000+Number(short[1]),Number(short[2]),Number(short[3]));if(sv)return sv}
  var md=t.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*日|(?:^|\D)(\d{1,2})[\/\-](\d{1,2})(?:\D|$)/);
  if(md){var mo=Number(md[1]||md[3]),da=Number(md[2]||md[4]),y=base.getFullYear(),mv=make(y,mo,da);if(mv&&new Date(mv+"T12:00:00")>new Date(base.getTime()+172800000))mv=make(y-1,mo,da);if(mv)return mv}
  return baseDate||defaultDate();
}
function amountFromText(text){
  var lines=normalize(text).split("\n").map(function(x){return ocrMoneyClean(x.trim())}).filter(Boolean),cand=[];
  function push(line,idx,score,label){
    if(moneyLineExcluded(line))return;
    var n=numberFromLine(line);if(n)cand.push({n:n,score:score-idx/100,label:label});
  }
  lines.forEach(function(line,idx){
    if(moneyLineExcluded(line))return;
    if(/お支払(?:い)?額|お買上(?:げ)?額|領収金額|総合計|税込合計|合計金額/i.test(line))push(line,idx,230,"total");
    else if(/(?:^|[\s:：])合\s*計(?:[\s:：]|¥|\\|Y|[0-9]|$)/i.test(line))push(line,idx,225,"total");
    else if(/含計|台計|合汁|合言十/i.test(line))push(line,idx,205,"fuzzy-total");
    if(/楽天\s*(?:pay|ペイ)|paypay|d払い|au\s*pay|visa|mastercard|master\s*card|\bjcb\b|amex|クレジット|カード決済/i.test(line))push(line,idx,215,"payment");
    if(/小計/i.test(line))push(line,idx,90,"subtotal");
  });
  if(cand.length){
    var freq={};cand.forEach(function(x){freq[x.n]=(freq[x.n]||0)+1});
    cand.forEach(function(x){x.score+=(freq[x.n]-1)*4});
    cand.sort(function(a,b){return b.score-a.score});
    return cand[0].n;
  }
  var fb=[];lines.forEach(function(line){if(moneyLineExcluded(line)||/\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(line))return;var n=numberFromLine(line);if(n>=10)fb.push(n)});
  return fb.length?Math.max.apply(null,fb):0;
}
function paymentFromText(text){
  var t=normalize(text).toLowerCase();
  if(/楽天\s*(?:pay|ペイ)/i.test(t))return"rakutenpay";
  if(/pasmo/i.test(t))return"pasmo";
  if(/suica|交通系\s*ic|交通系ic|icカード/i.test(t))return"pasmo";
  if(/visa|master\s*card|mastercard|\bjcb\b|amex|american express|クレジット|カード決済|card payment/i.test(t))return"credit";
  if(/現金|cash/i.test(t))return"wallet";
  return"";
}
function shopFromText(text){
  var lines=normalize(text).split("\n").map(function(x){return x.trim()}).filter(Boolean).slice(0,18),joined=lines.join(" ");
  if(/CREATE|クリエイト|ドラッグストア\s*クリエイト/i.test(joined))return"クリエイト";
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
  var coffee=/コーヒー|coffee|カフェラテ|cafe latte/i,drink=/サイダー|紅茶|スポーツドリンク|ラブズスポーツ|飲料|ジュース|コーラ|炭酸|緑茶|麦茶|ウーロン茶|午後の紅茶|ミネラルウォーター|お茶/i;
  if(names&&coffee.test(names))return findCategoryPair("食費","コーヒー")||findCategoryPair("食費","飲み物");
  if(rows.length){
    var bev=rows.filter(function(x){return drink.test(x.name)}).length;
    if(bev>=Math.max(1,Math.ceil(rows.length*.6)))return findCategoryPair("食費","飲み物");
  }
  if(/スーパー|market/i.test(String(shop||"")))return findCategoryPair("食費","スーパー・食材");
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
function parseReceiptText(text,baseDate){
  var raw=normalize(text),rows=itemRowsFromText(raw),items=rows.map(function(x){return x.name}),shop=shopFromText(raw),cat=categorySuggestion(raw,shop,rows);
  return{rawText:raw,date:dateFromText(raw,baseDate||defaultDate()),shop:shop,amount:amountFromText(raw),paymentCandidate:paymentFromText(raw),categoryCandidate:cat,items:items,itemRows:rows,detail:items.length?items.slice(0,2).join("・")+(items.length>2?"ほか":""):(shop||"レシート購入")};
}
function renderResult(p,errorText){
  var panel=document.getElementById("receiptOCRPanel");if(!panel)return;
  var cat=p.categoryCandidate,pay=p.paymentCandidate||"",items=(p.items||[]).join("\n"),rows=p.itemRows||[];
  var preview=previewUrl?'<img class="receipt-preview" src="'+e(previewUrl)+'" alt="撮影したレシートのプレビュー">':"";
  var rowHtml=rows.length?'<div class="receipt-item-summary"><div class="small"><strong>商品解析</strong></div>'+rows.map(function(x){var tail="";if(x.qty>1)tail+=" ×"+x.qty;if(x.total)tail+=" = "+yen(x.total);return'<div><span>'+e(x.name)+'</span><strong>'+e(tail.trim())+'</strong></div>'}).join("")+'</div>':"";
  panel.innerHTML='<div class="receipt-result-card">'+preview+
    '<div class="receipt-result-title"><strong>レシート読み取り結果</strong><span class="small">確認・修正してから支出入力へ反映してください。</span></div>'+
    (errorText?'<div class="warning">'+e(errorText)+' 手入力で補完できます。</div>':"")+
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
async function runOCR(bundle){
  await loadOCR();setBusy(true,"OCRを初期化しています…");
  var worker=await globalThis.Tesseract.createWorker(["jpn","eng"],1,{logger:progress});
  try{
    try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:"6"})}catch(_e){}
    ocrPassLabel="①標準補正";
    var a=await worker.recognize(bundle.gray||bundle),textA=String(a&&a.data&&a.data.text||"");
    ocrPassLabel="②白黒補正";
    try{await worker.setParameters({preserve_interword_spaces:"1",tessedit_pageseg_mode:"11"})}catch(_e){}
    var b=await worker.recognize(bundle.binary||bundle.gray||bundle),textB=String(b&&b.data&&b.data.text||"");
    ocrPassLabel="";
    return mergeOCRTexts(textA,textB);
  }finally{ocrPassLabel="";try{await worker.terminate()}catch(_e){}}
}
async function handleFile(file){
  if(busy||!file)return;
  var panel=document.getElementById("receiptOCRPanel");if(panel)panel.innerHTML="";
  try{
    var canvas=await prepareImage(file),raw=await runOCR(canvas),parsed=parseReceiptText(raw,document.getElementById("txDate")&&document.getElementById("txDate").value||defaultDate());
    setBusy(false,raw.trim()?"読み取りが完了しました。結果を確認してください。":"文字を十分に読み取れませんでした。手入力で補完できます。");
    renderResult(parsed,raw.trim()?"":"OCRで文字を十分に読み取れませんでした。");
  }catch(err){
    setBusy(false,"レシートの読み取りに失敗しました。");
    renderResult({rawText:"",date:document.getElementById("txDate")&&document.getElementById("txDate").value||defaultDate(),shop:"",amount:0,paymentCandidate:"",categoryCandidate:null,items:[],detail:""},err&&err.message||"レシートの読み取りに失敗しました。");
  }finally{busy=false}
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
  return[
    ["receipt image input test",captureHTML().indexOf('accept="image/*"')>=0&&captureHTML().indexOf('capture="environment"')>=0],
    ["receipt OCR parser test",!!p&&typeof p==="object"&&!!p3],
    ["receipt total detection test",p.amount===636&&p2.amount===940&&p3.amount===897],
    ["receipt date detection test",p.date==="2026-09-24"&&p3.date==="2026-09-24"],
    ["receipt payment detection test",p.paymentCandidate==="credit"&&p2.paymentCandidate==="wallet"&&p3.paymentCandidate==="rakutenpay"],
    ["receipt shop detection test",p3.shop==="クリエイト"],
    ["receipt item row test",p3.itemRows.length>=3&&p3.itemRows.some(function(x){return /サイダー/.test(x.name)&&x.qty===2&&x.total===198})&&p3.itemRows.some(function(x){return /午後の紅茶/.test(x.name)&&x.qty===6&&x.total===474})],
    ["receipt category suggestion test",p.categoryCandidate&&p.categoryCandidate.groupName==="食費"&&p.categoryCandidate.subName==="スーパー・食材"&&p3.categoryCandidate&&p3.categoryCandidate.groupName==="食費"&&p3.categoryCandidate.subName==="飲み物"],
    ["receipt points excluded test",p3.amount!==831&&p3.amount!==730&&p3.amount!==738],
    ["receipt preview only test",state.transactions.length===before],
    ["receipt no auto-save test",state.transactions.length===before]
  ];
}
function attachTests(){
  var b=document.getElementById("selfTest");if(!b||b.dataset.receiptWrapped)return;
  var base=b.onclick;b.dataset.receiptWrapped="1";
  b.onclick=function(){if(base)base.call(this);var out=receiptTests(),pass=out.every(function(x){return x[1]}),box=document.getElementById("testResult");if(box)box.insertAdjacentHTML("beforeend",(pass?'<div class="success">V3.2.8.5.1 レシート機能テストもすべて合格しました。</div>':'<div class="errorbox">レシート機能テストに失敗があります。</div>')+out.map(function(x){return"<div>"+(x[1]?"✅":"❌")+" "+e(x[0])+"</div>"}).join(""))};
}
var body=document.getElementById("modalBody");
if(body){new MutationObserver(function(){enhance()}).observe(body,{childList:true,subtree:true})}
document.getElementById("modalClose")&&document.getElementById("modalClose").addEventListener("click",cleanupPreview);
document.getElementById("modalBack")&&document.getElementById("modalBack").addEventListener("click",function(ev){if(ev.target&&ev.target.id==="modalBack")cleanupPreview()});
window.addEventListener("beforeunload",cleanupPreview);
enhance();attachTests();
window.receiptFeature={parseReceiptText:parseReceiptText,amountFromText:amountFromText,dateFromText:dateFromText,paymentFromText:paymentFromText,categorySuggestion:categorySuggestion,tests:receiptTests};
})();