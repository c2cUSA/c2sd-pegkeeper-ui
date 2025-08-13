'use client';

/* 
  PegKeeper IDL Runner (Next.js App Router)
  - Works with @coral-xyz/anchor 0.28/0.29 2-arg Program(...) ctor
  - Sets (idl as any).address = programId
  - Phantom-only minimal wallet adapter (no extra libs)
  - Loads IDL from /idl/pegkeeper.json (put this file under /public/idl/pegkeeper.json)
*/

import React, { useEffect, useMemo, useState } from 'react';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey, ComputeBudgetProgram, Transaction } from '@solana/web3.js';

type IdlLike = anchor.Idl & { address?: string };

// --- tiny helpers ---
const toCamel = (s: string) =>
  s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/^([A-Z])/, (c) => c.toLowerCase());

const isBNType = (t?: string) => !!t && /(u64|i64|u128|i128|u256|i256)/i.test(t);

const parseArg = (raw: string, idlType?: string) => {
  // BN-ish → BN; bool → boolean; num → number; else string
  if (idlType?.toLowerCase() === 'bool') return raw === 'true' || raw === '1';
  if (isBNType(idlType)) return new anchor.BN(raw);
  if (/^(u8|u16|u32|i8|i16|i32|f32|f64)$/i.test(idlType || '')) return Number(raw);
  // default: return as string (often pubkeys or enums)
  return raw;
};

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: PublicKey;
      connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
      disconnect: () => Promise<void>;
      signTransaction: (tx: Transaction) => Promise<Transaction>;
      signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
    };
  }
}

export default function IdlRunnerPage() {
  // ---------- defaults ----------
  const [rpc, setRpc] = useState<string>(
    process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  );
  const [programId, setProgramId] = useState<string>(
    process.env.NEXT_PUBLIC_PROGRAM_ID || '' // you can prefill if you like
  );

  // Loaded IDL
  const [idl, setIdl] = useState<IdlLike | null>(null);

  // UI: instructions, args, accounts
  const [ixName, setIxName] = useState<string>('');
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [acctValues, setAcctValues] = useState<Record<string, string>>({});

  // Wallet & status
  const [walletPk, setWalletPk] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [log, setLog] = useState<string>('');

  // Load IDL from /public/idl/pegkeeper.json
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/idl/pegkeeper.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`IDL fetch failed: ${res.status}`);
        const json = (await res.json()) as IdlLike;
        setIdl(json);
        if (json.instructions?.length) setIxName(json.instructions[0].name);
      } catch (e: any) {
        setLog(`❌ Failed to load IDL: ${e?.message || String(e)}`);
      }
    })();
  }, []);

  const connection = useMemo(() => new Connection(rpc, 'confirmed'), [rpc]);

  const connectPhantom = async () => {
    try {
      if (!window.solana?.isPhantom) {
        setLog('❌ Phantom wallet not found. Please install Phantom.');
        return;
      }
      const resp = await window.solana.connect();
      setWalletPk(resp.publicKey.toBase58());
      setLog(`✅ Connected: ${resp.publicKey.toBase58()}`);
    } catch (e: any) {
      setLog(`❌ Connect failed: ${e?.message || String(e)}`);
    }
  };

  const disconnectPhantom = async () => {
    try {
      if (window.solana?.disconnect) await window.solana.disconnect();
      setWalletPk('');
      setLog('👋 Disconnected');
    } catch (e: any) {
      setLog(`⚠️ Disconnect error: ${e?.message || String(e)}`);
    }
  };

  const runInstruction = async () => {
    if (!idl) return setLog('❌ IDL not loaded');
    if (!programId) return setLog('❌ Set Program ID');
    if (!window.solana?.publicKey) return setLog('❌ Connect Phantom first');

    setBusy(true);
    setLog('⏳ Building transaction…');

    try {
      // Provider (Phantom as wallet)
      const wallet = {
        publicKey: window.solana.publicKey!,
        signTransaction: window.solana.signTransaction!,
        signAllTransactions: window.solana.signAllTransactions || (async (txs: Transaction[]) => {
          const signed = [];
          for (const tx of txs) signed.push(await window.solana!.signTransaction(tx));
          return signed;
        }),
      } as any;

      const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
      });
      anchor.setProvider(provider);

      // 2-arg Program: set idl.address first
      (idl as any).address = programId;
      const program = new anchor.Program(idl as anchor.Idl, provider);

      // Build args list following the IDL order
      const ix = idl.instructions?.find((i: any) => i.name === ixName);
      if (!ix) throw new Error(`Instruction ${ixName} not found in IDL`);

      const argsOrdered = (ix.args || []).map((a: any) =>
        parseArg(argValues[a.name] ?? '', a.type?.defined ?? a.type?.type ?? a.type)
      );

      // Accounts object from user input
      const accounts: Record<string, PublicKey> = {};
      (ix.accounts || []).forEach((a: any) => {
        const v = acctValues[a.name];
        if (!v) throw new Error(`Missing account pubkey for '${a.name}'`);
        accounts[a.name] = new PublicKey(v);
      });

      // Construct RPC call
      // Prefer program.methods.<camelCase>(...args).accounts(accounts).preInstructions([...]).rpc()
      const mName = toCamel(ixName);
      const m = (program.methods as any)[mName];
      if (typeof m !== 'function') {
        throw new Error(`Method program.methods.${mName} not found. Check IDL names.`);
      }

      // (optional) tip priority fee to make inclusion more reliable
      const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 });

      // Anchor .rpc() supports .preInstructions([...])
      const txSig = await m(...argsOrdered).accounts(accounts).preInstructions([cuPriceIx]).rpc({
        skipPreflight: true, // matches your hotfix guidance
        maxRetries: 3,
      });

      setLog(`✅ Sent: https://explorer.solana.com/tx/${txSig}?cluster=${
        rpc.includes('devnet') ? 'devnet' : rpc.includes('testnet') ? 'testnet' : 'mainnet'
      }`);
    } catch (e: any) {
      setLog(`❌ Run failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // form builders from IDL
  const currentIx = useMemo(
    () => idl?.instructions?.find((i: any) => i.name === ixName),
    [idl, ixName]
  );

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4">PegKeeper — IDL Runner</h1>

      {/* RPC & Program */}
      <div className="grid gap-3 mb-4">
        <label className="grid">
          <span className="text-sm">RPC URL</span>
          <input
            className="border rounded px-3 py-2"
            value={rpc}
            onChange={(e) => setRpc(e.target.value)}
            placeholder="https://api.devnet.solana.com"
          />
        </label>
        <label className="grid">
          <span className="text-sm">Program ID</span>
          <input
            className="border rounded px-3 py-2"
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            placeholder="Cf1aW47o... (your program)"
          />
        </label>
      </div>

      {/* Wallet */}
      <div className="flex items-center gap-3 mb-6">
        {walletPk ? (
          <>
            <span className="text-green-700 text-sm">Connected: {walletPk.slice(0, 8)}…{walletPk.slice(-6)}</span>
            <button
              className="border px-3 py-2 rounded"
              onClick={disconnectPhantom}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button className="border px-3 py-2 rounded" onClick={connectPhantom}>
            Connect Phantom
          </button>
        )}
      </div>

      {/* Instruction selector */}
      <div className="grid gap-3 mb-4">
        <label className="grid">
          <span className="text-sm">Instruction</span>
          <select
            className="border rounded px-3 py-2"
            value={ixName}
            onChange={(e) => setIxName(e.target.value)}
          >
            {idl?.instructions?.map((i: any) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Dynamic args */}
      {currentIx && currentIx.args?.length > 0 && (
        <div className="border rounded p-3 mb-4">
          <div className="font-semibold mb-2">Arguments</div>
          <div className="grid md:grid-cols-2 gap-3">
            {currentIx.args.map((a: any) => (
              <label className="grid" key={a.name}>
                <span className="text-xs opacity-70">
                  {a.name} <em className="opacity-60">({typeof a.type === 'string' ? a.type : a.type?.defined || a.type?.type || 'unknown'})</em>
                </span>
                <input
                  className="border rounded px-3 py-2"
                  value={argValues[a.name] ?? ''}
                  onChange={(e) =>
                    setArgValues((s) => ({ ...s, [a.name]: e.target.value }))
                  }
                  placeholder="value…"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Dynamic accounts */}
      {currentIx && currentIx.accounts?.length > 0 && (
        <div className="border rounded p-3 mb-6">
          <div className="font-semibold mb-2">Accounts (Pubkeys)</div>
          <div className="grid md:grid-cols-2 gap-3">
            {currentIx.accounts.map((a: any) => (
              <label className="grid" key={a.name}>
                <span className="text-xs opacity-70">
                  {a.name} {a.isMut ? ' (mut)' : ''} {a.isSigner ? ' (signer)' : ''}
                </span>
                <input
                  className="border rounded px-3 py-2"
                  value={acctValues[a.name] ?? ''}
                  onChange={(e) =>
                    setAcctValues((s) => ({ ...s, [a.name]: e.target.value }))
                  }
                  placeholder="PublicKey (e.g., 9x...Ab)"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Run */}
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={runInstruction}
          className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Run Instruction'}
        </button>
      </div>

      {/* Log */}
      <pre className="mt-6 whitespace-pre-wrap text-sm p-3 border rounded bg-gray-50">
        {log || 'Logs will appear here…'}
      </pre>
    </div>
  );
}
