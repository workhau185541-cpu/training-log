'use strict';
(() => {
  if (top !== self) { document.body.replaceChildren(); return; }
  const el = Object.fromEntries(['home','screen','broker','status','open','connection','info','code','google','later','copy','sync','install','connectTitle'].map(id => [id,document.getElementById(id)]));
  const storagePrefix = 'training.fullscreen.';
  const cache = {
    read(key) {try {return JSON.parse(localStorage.getItem(storagePrefix + key));} catch (_) {return null;}},
    set(key, value) {try {localStorage.setItem(storagePrefix + key,JSON.stringify(value));} catch (_) {}},
    del(key) {try {localStorage.removeItem(storagePrefix + key);} catch (_) {}}
  };
  const msg = e => String(e && e.message || e || '連線失敗。');
  function localDate() {const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);}
  const bootKey='snapshot';
  let device = cache.read('device') || GoldTransfer.random(), linked = cache.read('linked') === true;
  cache.set('device',device);
  let channel=null, inUse=false, snapshot=null, firstInit=false, startup=false, preparing=false, polling=false;
  const liveCalls=new Map(), queue=[], callbacks=new Map();
  let pending=cache.read('transfer');
  if(pending && pending.device!==device){cache.del('transfer');pending=null;}
  function bar() {
    el.sync.hidden = !inUse || (!pending && !queue.length && !!channel);
    el.sync.textContent = pending ? '查看 Google 連線' : queue.length ? '同步 Google（'+queue.length+'）' : '連線至 Google';
  }
  function dialog(title,message) {
    el.connectTitle.textContent=title;
    el.info.textContent=message;
    el.code.hidden=el.google.hidden=el.copy.hidden=true;
    if(!el.connection.open)el.connection.showModal();
  }
  function clearTransfer(){pending=null;cache.del('transfer');bar();}
  function explain(e) {
    let s=msg(e);
    if(s.includes('ACCOUNT_MISMATCH'))s='請使用原先連結這部裝置的 Google 帳號。若要改用其他帳號，可在連線視窗選擇「更換帳號」。';
    el.status.textContent=s;
    dialog('Google 連線',s);
    if(s.includes('更換帳號')) showSwitch();
  }
  function showSwitch(){
    if(document.getElementById('changeAccount'))return;
    const b=document.createElement('button'); b.className='quiet'; b.id='changeAccount';b.textContent='更換帳號';
    b.onclick=()=>{if(!confirm('中止這部裝置目前的連線，重新選擇 Google 帳號？'))return;
      cache.del('linked');cache.del('device');cache.del(bootKey);cache.del('transfer');location.reload();};
    el.connection.append(b);
  }
  function finishRequest(id,success,value) {
    const cb=callbacks.get(id);callbacks.delete(id);
    if(cb)(success?cb.resolve:cb.reject)(success?value:new Error(msg(value)));
  }
  function acceptCalls(calls,result) {
    const out=new Map((result||[]).map(x=>[x.id,x]));
    for(const q of calls) {
      const r=out.get(q.id);
      if(r?.ok && r.value?.data && snapshot?.data) {
        Object.assign(snapshot.data,r.value.data);cache.set(bootKey,snapshot);
      }
      if(r?.ok && q.name==='getInitData' && snapshot){snapshot.data=r.value;snapshot.date=q.args[0];cache.set(bootKey,snapshot);}
      if(r?.ok && q.name==='resetAccount'){cache.del(bootKey);cache.del('linked');cache.del('device');}
      finishRequest(q.id,!!r?.ok,r?.ok?r.value:(r?.error||'未收到伺服器確認，請重新開啟課表核對。'));
    }
  }
  function live(q) {
    return new Promise((resolve,reject)=>{
      if(!channel)return reject(new Error('需要重新連線。'));
      const tag=GoldTransfer.random(16);
      const timeout=setTimeout(()=>{
        liveCalls.delete(tag);channel=null;bar();
        reject(new Error('Google 未回覆。若剛才有儲存，請先重新開啟課表核對結果。'));
      },70000);
      liveCalls.set(tag,{resolve,reject,timeout});
      try{channel.postMessage({...q,tag,device});}catch(e){clearTimeout(timeout);liveCalls.delete(tag);channel=null;bar();reject(e);}
    });
  }
  function isOurGoogleFrame(e){
    if(!/^https:\/\/(?:script\.google\.com|(?:[\w-]+\.)*googleusercontent\.com)$/.test(e.origin))return false;
    // Google's HtmlService uses nested frames. Check the originating WindowProxy against this broker.
    try {let w=e.source; for(let n=0;w&&n<8;n++){if(w===el.broker.contentWindow)return true;if(w===w.parent)break;w=w.parent;}}catch(_){}
    return false;
  }
  window.addEventListener('message',e=>{
    if(e.data?.type!=='training-gold/hello'||!isOurGoogleFrame(e))return;
    const pair=new MessageChannel();
    pair.port1.onmessage=({data})=>{
      if(data?.type==='ready'){channel=pair.port1;bar();if(!inUse && !pending && !startup)el.status.textContent='已連上 Google，可以開啟你的課表。';if(linked && !startup && !inUse && !pending)start();return;}
      const cb=liveCalls.get(data?.tag);if(!cb)return;
      clearTimeout(cb.timeout);liveCalls.delete(data.tag);
      if(data.ok)cb.resolve(data.value);else cb.reject(new Error(data.error));
    };
    e.source.postMessage({type:'training-gold/link',token:e.data.token},e.origin,[pair.port2]);
  });
  el.broker.src=GOLD_ACCOUNT+'?gold=bridge';

  function mount(view) {
    if(!view||typeof view.html!=='string'||!Array.isArray(view.data?.days)||typeof view.accountKey!=='string')throw new Error('Google 未傳回完整課表。');
    snapshot=view;firstInit=true;linked=true;inUse=true;
    cache.set('linked',true);cache.set(bootKey,view);
    const page=new DOMParser().parseFromString(view.html,'text/html');
    const adapter=page.createElement('script');adapter.src=new URL('./rpc.js',location.href).href;
    page.head.prepend(adapter);
    const base=page.querySelector('base');if(base)base.target='_blank';
    el.screen.srcdoc='<!doctype html>'+page.documentElement.outerHTML;
    el.home.hidden=true;el.screen.hidden=false;el.connection.close();bar();
  }
  function call(name,args) {
    if(name==='getInitData' && firstInit && snapshot?.date===args[0]){firstInit=false;return Promise.resolve(structuredClone(snapshot.data));}
    if(!channel && snapshot?.date===localDate() && name==='getLastWorkout' && args[1]===snapshot.date && snapshot.data.last && Object.hasOwn(snapshot.data.last,args[0])){
      return Promise.resolve(structuredClone(snapshot.data.last[args[0]]));
    }
    const q={name,args,id:GoldTransfer.random(16)};
    return new Promise((resolve,reject)=>{
      callbacks.set(q.id,{resolve,reject});
      if(channel && !pending) {
        live({kind:'calls',calls:[q]}).then(rows=>acceptCalls([q],rows),e=>finishRequest(q.id,false,msg(e)));
      } else {
        // Drafts are already saved locally by the training UI. Coalesce only the queued cloud backup.
        if(name==='saveDraft' || name==='saveSettings') {
          const last=queue[queue.length-1];
          if(last?.name===name) {
            if(name==='saveSettings')q.args=[Object.assign({},last.args[0],args[0])];
            queue.pop();const previous=callbacks.get(last.id);callbacks.delete(last.id);
            if(previous)callbacks.set(q.id,{resolve:v=>{previous.resolve(v);resolve(v);},reject:e=>{previous.reject(e);reject(e);}});
          }
        }
        queue.push(q);bar();
        if(!['saveDraft','saveSettings'].includes(name) && !pending && !preparing) openSync().catch(explain);
      }
    });
  }
  window.TrainingGold=Object.freeze({
    get accountKey(){return snapshot.accountKey;},
    url:new URL('./',location.href).href,call,report:explain
  });

  function showPending() {
    dialog(pending.kind==='boot'?'連結 Google 帳號':'同步訓練資料',pending.pin?
      '點「開啟 Google」連結課表，再點「返回 Training Log」。如果 iPhone 將兩個視窗分開，請使用下方的備用連線碼。':
      '點「開啟 Google」確認這次同步。完成後回到金色 Training Log 圖示。');
    if(pending.pin){
      el.code.textContent=pending.pin;el.code.hidden=false;el.copy.hidden=false;
    }
    el.google.href=GOLD_ACCOUNT+'?gold=connect#k='+pending.secret;el.google.hidden=false;
  }
  async function prepare(request) {
    if(preparing)return;
    preparing=true;dialog('Google 連線','正在準備這次連線…');
    try {
      const secret=GoldTransfer.random();
      const pin=request.enroll?String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0'):null;
      const expires=Date.now()+8*60000;
      await GoldTransfer.put(GOLD_RELAY,secret,'request',{...request,device,expires,
        pinHash:pin?await GoldTransfer.hash('pin/'+secret+'/'+pin):null});
      pending={kind:request.kind,device,secret,pin,expires,calls:request.calls||[]};
      cache.set('transfer',pending);showPending();bar();poll();
    } finally {preparing=false;}
  }
  async function poll() {
    if(!pending||polling||document.hidden)return;
    const p=pending;
    if(Date.now()>p.expires){
      clearTransfer();
      if(p.kind==='calls')for(const q of p.calls)finishRequest(q.id,false,'連線已過期，請先重新讀取以確認是否已儲存。');
      explain(new Error('連線已過期。請重新開啟課表；先前送出的儲存請在紀錄頁確認。'));return;
    }
    polling=true;
    try{
      let out=await GoldTransfer.get(GOLD_RELAY,p.secret,'response');
      if(out?.grant && /^[A-Za-z0-9_-]{43}$/.test(out.grant))out=await GoldTransfer.get(GOLD_RELAY,out.grant,'result');
      if(!out||p!==pending)return;
      clearTransfer();el.connection.close();
      if(!out.ok){for(const q of p.calls)finishRequest(q.id,false,out.error);explain(new Error(out.error));return;}
      if(p.kind==='boot')mount(out.value);
      else {acceptCalls(p.calls,out.value);if(!inUse)await start();}
    }catch(e){if(p===pending && el.connection.open)el.info.textContent='等候 Google 回覆中。可先回到此頁，系統會自動重試讀取。';}
    finally{polling=false;bar();}
  }
  async function openSync() {
    if(pending){showPending();poll();return;}
    if(!queue.length){await start();return;}
    const calls=queue.splice(0,24);
    if(channel){
      try{acceptCalls(calls,await live({kind:'calls',calls}));}catch(e){for(const q of calls)finishRequest(q.id,false,msg(e));throw e;}
    }else {
      try{await prepare({kind:'calls',calls});}catch(e){queue.unshift(...calls);throw e;}
    }
    bar();
  }
  async function start() {
    if(pending){showPending();poll();return;}
    if(startup||preparing)return;
    startup=true;el.open.disabled=true;el.status.textContent='正在讀取你的訓練課表…';
    const req={kind:'boot',date:localDate(),enroll:!linked};
    try {
      if(!channel)await new Promise(resolve=>setTimeout(resolve,1500));
      if(channel)mount(await live(req));
      else await prepare(req);
    }catch(e){explain(e);}finally{startup=false;el.open.disabled=false;}
  }
  el.open.onclick=start;el.sync.onclick=()=>openSync().catch(explain);
  el.later.onclick=()=>el.connection.close();
  el.connection.addEventListener('close',()=>{if(!inUse)el.status.textContent=pending?'正在等候 Google 確認。':'開啟你的訓練課表與紀錄。';});
  document.getElementById('cancel').onclick=()=>{
    if(!pending || !confirm('取消這次連線？已在 Google 確認的操作，請回到紀錄頁核對。'))return;
    for(const q of pending.calls)finishRequest(q.id,false,'連線已取消，請確認先前的操作結果。');
    clearTransfer();el.connection.close();
  };
  el.copy.onclick=async()=>{try{await navigator.clipboard.writeText(pending.pin);el.copy.textContent='已複製';}catch(_){el.code.focus();}};
  setInterval(poll,4500);addEventListener('focus',poll);document.addEventListener('visibilitychange',poll);
  if(navigator.standalone || matchMedia('(display-mode:standalone)').matches)el.install.hidden=true;
  if(pending){showPending();poll();}
  else if(linked) {
    const last=cache.read(bootKey);
    if(last) {
      const use=document.createElement('button');use.className='quiet';use.textContent='開啟這部裝置上次的課表';
      use.onclick=()=>{mount(last);el.sync.hidden=false;el.sync.textContent='重新同步 Google';};el.home.append(use);
    }
  }
})();
