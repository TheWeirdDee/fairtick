"use client";
import Link from 'next/link';
import {useAuth} from '../context/AuthContext';
export function RuntimeNotice(){const {health:h}=useAuth();return <aside className="notice notice-info runtime-notice"><div>{h?<><strong>{h.networkLabel}.</strong> {h.marketData==='TESTNET_MOCK'?'FairTick mock tokens, operator-set price and controlled liquidity.':'Configured market sources; availability is checked per order.'} {h.worker?.active?(h.worker.executionEnabled?'Worker online; testnet signing enabled.':'Worker online; monitoring only.'):'No recent worker heartbeat; monitoring availability unconfirmed.'}</>:'Environment status unavailable.'} <Link href="/docs/networks">Environment details</Link></div></aside>;}
