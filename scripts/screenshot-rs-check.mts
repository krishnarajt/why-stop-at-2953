import { rsEncode, rsDecode } from "@/lib/screenshot/gf256";
function test(k: number, nsym: number, errs: number) {
  const data = new Uint8Array(k); for (let i=0;i<k;i++) data[i]=(i*73+5)&0xff;
  const enc = rsEncode(data, nsym);
  const recv = Uint8Array.from(enc);
  for (let e=0;e<errs;e++){ const p=(e*17+1)%enc.length; recv[p]=(recv[p]+1+e)&0xff; }
  try {
    const dec = rsDecode(recv, nsym);
    const okk = dec.length===k && dec.every((v,i)=>v===data[i]);
    console.log(`k=${k} nsym=${nsym} errs=${errs}: ${okk?"OK":"WRONG DATA"}`);
  } catch(e:any) { console.log(`k=${k} nsym=${nsym} errs=${errs}: THREW ${e.message}`); }
}
// clean
test(187,68,0);
test(20,10,0);
test(20,10,1);
test(20,10,2);
test(20,10,5);
test(187,68,1);
test(187,68,10);
test(187,68,34);
