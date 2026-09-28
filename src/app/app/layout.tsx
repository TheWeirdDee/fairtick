"use client";
import {useEffect} from 'react';
import {useRouter,usePathname} from 'next/navigation';
import {useAuth} from '../context/AuthContext';
import {Header} from '../components/Header';
import {Footer} from '../components/Footer';
import {RuntimeNotice} from '../components/RuntimeNotice';
export default function AppLayout({children}:{children:React.ReactNode}){const {isAuthenticated,loading}=useAuth(),router=useRouter(),path=usePathname();useEffect(()=>{if(!loading&&!isAuthenticated)router.replace('/access?next='+encodeURIComponent(path));},[loading,isAuthenticated,path,router]);if(loading||!isAuthenticated)return <main className="container"><p role="status">Loading workspace...</p></main>;return <><Header isAppShell/><main className="main-content"><div className="container"><RuntimeNotice/>{children}</div></main><Footer/></>;}
