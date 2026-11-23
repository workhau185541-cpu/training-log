'use strict';
(async()=>{
  if(top!==self)return;
  const params=new URLSearchParams(location.hash.slice(1)), secret=params.get('s'),grant=params.get('g');
  history.replaceState(null,'',location.pathname);
  const message=document.getElementById('feedback'), form=document.getElementById('verify'),back=document.getElementById('back');
  try{
    if(![secret,grant].every(x=>typeof x==='string' && /^[A-Za-z0-9_-]{43}$/.test(x)))throw Error('請從 Training Log 開始連線。');
    let saved=null;
    try{saved=JSON.parse(localStorage.getItem('training.fullscreen.transfer'));}catch(_){}
    const req=await GoldTransfer.get(GOLD_RELAY,secret,'request');
    if(req?.kind!=='boot'||!req.enroll||Date.now()>req.expires)throw Error('這次連線已過期，請從 Training Log 重新開啟。');
    const local=saved?.secret===secret && saved.device===req.device;
    async function approve(){
      await GoldTransfer.put(GOLD_RELAY,secret,'response',{grant});
      form.hidden=true;
      if(local){location.replace('./');return;}
      message.textContent='已連結。請回到主畫面，點金色 Training Log 圖示開啟課表。';
    }
    if(local){await approve();return;}
    message.textContent='iPhone 在另一個視窗完成了 Google 登入。請輸入剛才金色圖示內顯示的備用連線碼，將課表送回那部裝置。';
    form.hidden=false;
    form.onsubmit=async e=>{
      e.preventDefault();const button=form.querySelector('button');if(button.disabled)return;
      if(await GoldTransfer.hash('pin/'+secret+'/'+document.getElementById('digits').value)!==req.pinHash){
        message.textContent='連線碼不相符，請核對金色圖示內的數字。';return;
      }
      button.disabled=true;try{await approve();}catch(err){message.textContent=err.message;button.disabled=false;}
    };
  }catch(e){message.textContent=String(e.message||e);back.hidden=false;}
})();
