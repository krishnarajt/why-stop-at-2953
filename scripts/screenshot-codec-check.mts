import { encodeCodewords, decodeCodewords, bytesToSymbols, symbolsToBytes, crc32, blockPlan, BLOCK_DATA, BLOCK_TOTAL } from "@/lib/screenshot/codec";

let fail = 0;
const ok = (n: string, c: boolean) => { console.log((c?"✓":"✗")+" "+n); if(!c) fail++; };

// bit-pack round trip across awkward lengths
for (const len of [1, 2, 3, 7, 187, 255, 1000]) {
  const b = new Uint8Array(len); for(let i=0;i<len;i++) b[i]=(i*131+7)&0xff;
  const sym = bytesToSymbols(b);
  ok(`symbols max<8 (len=${len})`, sym.every(s=>s<8));
  const back = symbolsToBytes(sym, len);
  ok(`bitpack roundtrip len=${len}`, back.every((v,i)=>v===b[i]));
}

// RS multi-block + interleave: corrupt up to 34 codewords per block, expect recovery
for (const nBlocks of [1, 3, 12]) {
  const plan = blockPlan(nBlocks);
  const payload = new Uint8Array(plan.dataBytes);
  let s=99; for(let i=0;i<payload.length;i++){ s=(s*1103515245+12345)&0x7fffffff; payload[i]=s&0xff; }
  const cw = encodeCodewords(payload, nBlocks);
  ok(`codeword len nBlocks=${nBlocks}`, cw.length===plan.codewordBytes);
  // corrupt 34 codewords in each block (interleaved positions j*nBlocks+b)
  const recv = Uint8Array.from(cw);
  for (let b=0;b<nBlocks;b++) for (let e=0;e<34;e++){ const j=e; recv[j*nBlocks+b] ^= 0xA5||1; recv[j*nBlocks+b]=(recv[j*nBlocks+b]+1)&0xff; }
  const dec = decodeCodewords(recv, nBlocks);
  ok(`RS recovered ${nBlocks} blocks w/ 34 err each`, dec.every((v,i)=>v===payload[i]));
  // beyond capacity should throw
  let threw=false;
  const recv2 = Uint8Array.from(cw);
  for (let e=0;e<40;e++){ recv2[e*nBlocks+0]=(recv2[e*nBlocks+0]+1)&0xff; }
  try { decodeCodewords(recv2, nBlocks); } catch { threw=true; }
  ok(`RS throws past capacity (block0, nBlocks=${nBlocks})`, threw);
}

// crc32 known vector: "123456789" => 0xCBF43926
ok("crc32 check vector", crc32(new TextEncoder().encode("123456789"))===0xCBF43926);

console.log(fail===0 ? "\nALL PASS" : `\n${fail} FAIL`);
process.exit(fail?1:0);
