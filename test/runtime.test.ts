import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {OrderStore} from '../src/orders/store.js';
import {authorize} from '../src/lib/server.js';
import {protectTransaction,recoverTransaction} from '../src/orders/protectedTransaction.js';
const dirs:string[]=[],stores:OrderStore[]=[];
afterEach(()=>{delete (globalThis as {fairtickStore?:OrderStore}).fairtickStore;for(const s of stores.splice(0))if(s.db.open)s.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});vi.unstubAllEnvs();});
function setup(){vi.stubEnv('FAIRTICK_NETWORK','mainnet');const d=mkdtempSync(join(tmpdir(),'fairtick-runtime-'));dirs.push(d);const s=new OrderStore(join(d,'orders.db'));stores.push(s);return s;}
it('accepts valid hashed sessions, rejects expired/revoked/tampered cookies and cross-origin writes',()=>{
 const s=setup(),secret='synthetic-code-with-more-than-24-characters',token='ab'.repeat(32);vi.stubEnv('OPERATOR_SECRET',secret);vi.stubEnv('APP_ORIGIN','https://workspace.example');(globalThis as {fairtickStore?:OrderStore}).fairtickStore=s;
 const hash=createHash('sha256').update(token+secret).digest('hex'),now=Math.floor(Date.now()/1000);
 s.db.prepare('INSERT INTO operator_sessions VALUES(?,?)').run(hash,now+60);
 const request=(value=token,method='GET',origin='https://workspace.example')=>new Request('https://workspace.example/api/orders',{method,headers:{cookie:`fairtick_session=${value}`,origin}});
 expect(authorize(request())).toBe('operator');expect(()=>authorize(request('cd'.repeat(32)))).toThrow('UNAUTHORIZED');expect(()=>authorize(request(token,'POST','https://evil.example'))).toThrow('ORIGIN_MISMATCH');
 s.db.prepare('UPDATE operator_sessions SET expires_at=?').run(now-1);expect(()=>authorize(request())).toThrow('UNAUTHORIZED');s.db.prepare('DELETE FROM operator_sessions').run();expect(()=>authorize(request())).toThrow('UNAUTHORIZED');
});
it('encrypts signed payloads and rejects tampering or a different recovery key',()=>{
 vi.stubEnv('RH_TESTNET_PRIVATE_KEY','synthetic-recovery-key');const raw='0x123456abcdef',sealed=protectTransaction(raw);expect(sealed).not.toContain(raw);expect(recoverTransaction(sealed)).toBe(raw);
 const tampered=Buffer.from(sealed,'base64');tampered[13]=tampered[13]!^1;expect(()=>recoverTransaction(tampered.toString('base64'))).toThrow();vi.stubEnv('RH_TESTNET_PRIVATE_KEY','different-key');expect(()=>recoverTransaction(sealed)).toThrow();
});
it('retries missing inclusion evidence durably without mixing reorg block hashes',()=>{
 const s=setup();s.recordInclusionMeasurement('0xaa','0xbb',{referenceAtInclusion:null},1);s.recordInclusionMeasurement('0xaa','0xbb',{referenceAtInclusion:{round:'7'}},2);expect(s.inclusionMeasurement('0xaa','0xbb')).toEqual({referenceAtInclusion:{round:'7'}});expect(s.inclusionMeasurement('0xaa','0xcc')).toBeNull();
});
it('does not claim monitoring from stale or missing heartbeat',()=>{const s=setup();expect(s.workerHealth(1000).active).toBe(false);s.heartbeat(1000,true);expect(s.workerHealth(1001)).toMatchObject({active:true,executionEnabled:true});expect(s.workerHealth(1091)).toMatchObject({active:false,executionEnabled:false});});
