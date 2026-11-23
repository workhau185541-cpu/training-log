// This code runs in the two browser windows. The relay has neither the key nor the plaintext.
const GoldTransfer = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  function encode(bytes) {
    let s = '';
    for (let p = 0; p < bytes.length; p += 8192) s += String.fromCharCode(...bytes.subarray(p, p + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(s) {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  }
  const random = (n = 32) => encode(crypto.getRandomValues(new Uint8Array(n)));
  async function hash(s) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
    return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  }
  async function keyFor(secret) {
    return crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt','decrypt']);
  }
  async function relay(url, body) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 40000);
    try {
      const r = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit',
        referrerPolicy: 'no-referrer', cache: 'no-store', body: JSON.stringify(body), signal: ac.signal });
      if (!r.ok) throw new Error('連線服務暫時無法使用。');
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function put(url, secret, side, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(secret);
    let data = enc.encode(JSON.stringify(value)), zipped = 0;
    if (typeof CompressionStream === 'function' && data.length > 3000) {
      data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      zipped = 1;
    }
    const aes = { name:'AES-GCM', iv, additionalData:enc.encode(side + zipped) };
    const cipher = new Uint8Array(await crypto.subtle.encrypt(aes, key, data));
    const box = new Uint8Array(13 + cipher.length);
    box[0] = zipped; box.set(iv,1); box.set(cipher,13);
    await relay(url, { op:'put', id:await hash(side + '/' + secret), box:encode(box) });
  }
  async function get(url, secret, side) {
    const address = await hash(side + '/' + secret);
    const result = await relay(url, { op:'get', id:address });
    if (result.pending) return null;
    const box = decode(result.box);
    const options = { name:'AES-GCM', iv:box.slice(1,13), additionalData:enc.encode(side + box[0]) };
    const plain = await crypto.subtle.decrypt(options, await keyFor(secret), box.slice(13));
    const data = box[0] === 1
      ? await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : plain;
    return JSON.parse(dec.decode(data));
  }
  return {random,hash,put,get};
})();
