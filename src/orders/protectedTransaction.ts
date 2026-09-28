import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
// Worker-only key material. Ciphertext is safe to store with the private database,
// but neither ciphertext nor plaintext belongs in browser responses or exports.
function key(){const secret=process.env.RH_TESTNET_PRIVATE_KEY;if(!secret)throw new Error('RECOVERY_KEY_UNAVAILABLE');return createHash('sha256').update('fairtick-signed-v1:'+secret).digest();}
export function protectTransaction(raw:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);return Buffer.concat([iv,c.update(raw,'utf8'),c.final(),c.getAuthTag()]).toString('base64');}
export function recoverTransaction(value:string):`0x${string}`{const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8') as `0x${string}`;}
