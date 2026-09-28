"use client";
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {useAuth} from '../context/AuthContext';
import {Header} from '../components/Header';
import {Footer} from '../components/Footer';
export default function Access(){const {login}=useAuth(),router=useRouter();const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await login(code.trim());setCode('');const next=new URLSearchParams(window.location.search).get('next');router.replace(next&&(next==='/app'||/^\/app\/[a-zA-Z0-9/_-]*$/.test(next))?next:'/app');}catch(e){setError(e instanceof Error?e.message:'Service unavailable.');}finally{setBusy(false);}}
 return <><Header/><main className="main-content"><div className="container access-panel"><h1>Owner sign-in</h1><p>This workspace is managed by its owner. Use the access code they provided.</p><p><Link href="/docs/self-hosting">Owner setup and access help</Link></p><form onSubmit={submit} className="card"><label htmlFor="access-code" className="form-label">Access code</label><input id="access-code" type="password" className="form-input" autoComplete="current-password" value={code} onChange={e=>setCode(e.target.value)} required/><p className="form-hint">The code is exchanged for an eight-hour session cookie. It is not saved in browser storage. If your session expired, sign in again.</p>{error&&<p role="alert">{error}</p>}<button className="btn btn-primary" disabled={busy||!code}>{busy?'Verifying access...':'Sign in'}</button></form><p><Link href="/tour">Explore the read-only product tour</Link></p></div></main><Footer/></>;
}
