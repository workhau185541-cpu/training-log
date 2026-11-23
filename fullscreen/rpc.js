// The original authenticated UI runs in a document owned by this site's origin.
(() => {
  const api = parent.TrainingGold;
  // The original client uses unqualified storage keys. Isolate it per account and per preview.
  const store = window.localStorage, prefix = 'training.fullscreen.account.' + api.accountKey + '.';
  Object.defineProperty(window, 'localStorage', {value:{
    getItem: key => store.getItem(prefix + key),
    setItem: (key,value) => store.setItem(prefix + key,value),
    removeItem: key => store.removeItem(prefix + key),
    clear() { for(const key of Object.keys(store)) if(key.startsWith(prefix)) store.removeItem(key); }
  }});
  function runner(yes, no, userObject) {
    return new Proxy({}, {get(_target, method) {
      if(method === 'withSuccessHandler')return fn => runner(fn,no,userObject);
      if(method === 'withFailureHandler')return fn => runner(yes,fn,userObject);
      if(method === 'withUserObject')return obj => runner(yes,no,obj);
      if(typeof method !== 'string' || method === 'then')return undefined;
      return (...args) => { api.call(method,args).then(
        value=>{if(yes)yes(value,userObject);}, error=>{if(no)no(error,userObject);else api.report(error);}); };
    }});
  }
  window.google = {script:{run:runner()}};
  window.addEventListener('DOMContentLoaded',()=>{
    if(typeof window.shareMessage === 'function')window.shareMessage = () =>
      'Training Log 全螢幕測試版\n' + api.url + '\n用 Safari 開啟後，點「分享」→「加入主畫面」，再從金色圖示開啟。';
  });
})();
