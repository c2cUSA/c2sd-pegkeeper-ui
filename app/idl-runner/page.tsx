// app/idl-runner/page.tsx
// -------------------------------------------------------------
// Minimal IDL Runner for PegKeeper
// Works with Phantom or any window.solana wallet.
// Falls back to read-only mode if no wallet is connected.
// We intentionally disable TS checking to avoid provider/IDL
// type friction during first deploy.
// -------------------------------------------------------------
// @ts-nocheck

"use client";

import React, { useEffect, useMemo, useState } from "react";

// lazy pick anchor (supports either package name)
let anchor: any = null;
try {
  // most modern projects
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  anchor = require("@coral-xyz/anchor");
} catch {
  // older template fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  anchor = require("@project-serum/anchor");
}
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

// --- ENV / Defaults ---
const DEFAULT_RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const DEFAULT_PROGRAM_ID =
  process.env.NEXT_PUBLIC_PROGRAM_ID || ""; // you can set this in Vercel env

// small helper wallet that lets us construct a Provider in read-only mode
class ReadonlyWallet {
  public publicKey = null;
  async signTransaction(tx: Transaction) {
    throw new Error("Readonly wallet cannot sign");
  }
  async signAllTransactions(txs: Transaction[]) {
    throw new Error("Readonly wallet cannot sign");
  }
}

export default function IdlRunnerPage() {
  const [rpc, setRpc] = useState(DEFAULT_RPC);
  const [programId, setProgramId] = useState(DEFAULT_PROGRAM_ID);
  const [idl, setIdl] = useState<any>(null);
  const [program, setProgram] = useState<any>(null);
  const [ixName, setIxName] = useState<string>("");
  const [argsJson, setArgsJson] = useState<string>("[]");
  const [accountsJson, setAccountsJson] = useState<string>("{}");
  const [log, setLog] = useState<string>("");

  const connection = useMemo(() => new Connection(rpc, "confirmed"), [rpc]);

  // load IDL from /public/idl/pegkeeper.json
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/idl/pegkeeper.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch IDL");
        const json = await res.json();
        setIdl(json);
        if (!ixName && json?.instructions?.length) {
          setIxName(json.instructions[0].name);
        }
        setLog((l) => l + "✅ IDL loaded from /idl/pegkeeper.json\n");
      } catch (e: any) {
        setLog((l) => l + `❌ IDL load error: ${e?.message || e}\n`);
      }
    })();
  }, []);

  // build Anchor provider + program whenever idl / rpc / programId changes
  useEffect(() => {
    (async () => {
      if (!idl) return;
      try {
        const wallet =
          (globalThis as any)?.window?.solana && (globalThis as any).window.solana.isPhantom
            ? (globalThis as any).window.solana
            : new ReadonlyWallet();

        const provider = new anchor.AnchorProvider(connection, wallet as any, {
          commitment: "confirmed",
        });
        anchor.setProvider(provider);

        if (!programId) {
          setLog((l) => l + "ℹ️  Program ID is empty. Set it to enable calls.\n");
          setProgram(null);
          return;
        }

        const program = new anchor.Program(
          idl,
          new PublicKey(programId),
          provider
        );
        setProgram(program);
        setLog((l) => l + "✅ Program constructed\n");
      } catch (e: any) {
        setProgram(null);
        setLog((l) => l + `❌ Program init error: ${e?.message || e}\n`);
      }
    })();
  }, [idl, rpc, programId, connection]);

  const onConnect = async () => {
    try {
      if ((window as any).solana?.connect) {
        await (window as any).solana.connect();
        setLog((l) => l + "🔑 Wallet connected\n");
      } else {
        setLog(
          (l) =>
            l +
            "⚠️ No wallet found. Install Phantom or similar for signing.\n"
        );
      }
    } catch (e: any) {
      setLog((l) => l + `❌ Wallet connect error: ${e?.message || e}\n`);
    }
  };

  const simulate = async () => {
    if (!program || !idl) return;
    try {
      const ixDef = idl.instructions.find((i: any) => i.name === ixName);
      if (!ixDef) throw new Error("Instruction not found in IDL");

      const args = JSON.parse(argsJson || "[]");
      const accts = JSON.parse(accountsJson || "{}");

      const m = (program as any).methods[ixName](...args);
      const builder = m.accounts(accts);
      const sim = await builder.simulate(); // anchor >=0.28
      setLog(
        (l) =>
          l +
          `🧪 Simulated OK\n  logs: ${
            sim?.events ? JSON.stringify(sim.events) : "(no events)"
          }\n`
      );
    } catch (e: any) {
      setLog((l) => l + `❌ Sim error: ${e?.message || e}\n`);
    }
  };

  const send = async () => {
    if (!program || !idl) return;
    try {
      const walletPk = (program.provider.wallet as any)?.publicKey;
      if (!walletPk) {
        setLog(
          (l) =>
            l +
            "⚠️ Read-only mode: connect a wallet to send a transaction.\n"
        );
        return;
      }

      const ixDef = idl.instructions.find((i: any) => i.name === ixName);
      if (!ixDef) throw new Error("Instruction not found in IDL");

      const args = JSON.parse(argsJson || "[]");
      const accts = JSON.parse(accountsJson || "{}");

      const m = (program as any).methods[ixName](...args).accounts(accts);
      // prefer confirmed & skip preflight for “windowed” ops (optional)
      const sig = await m.rpc({
        skipPreflight: true,
        commitment: "confirmed",
      });
      setLog((l) => l + `✅ Sent: https://solscan.io/tx/${sig}?cluster=devnet\n`);
    } catch (e: any) {
      setLog((l) => l + `❌ Send error: ${e?.message || e}\n`);
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      <h1>PegKeeper IDL Runner</h1>

      <div style={{ display: "grid", gap: 12 }}>
        <label>
          RPC URL
          <input
            value={rpc}
            onChange={(e) => setRpc(e.target.value)}
            style={{ width: "100%" }}
            placeholder="https://api.devnet.solana.com"
          />
        </label>

        <label>
          Program ID
          <input
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            style={{ width: "100%" }}
            placeholder="Paste your PROGRAM_ID"
          />
        </label>

        <div>
          <button onClick={onConnect}>Connect Wallet</button>
        </div>

        <label>
          Instruction
          <select
            value={ixName}
            onChange={(e) => setIxName(e.target.value)}
            style={{ width: "100%" }}
          >
            {idl?.instructions?.map((i: any) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Args (JSON array in IDL order)
          <textarea
            rows={3}
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            placeholder='e.g. ["1000000"]'
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </label>

        <label>
          Accounts (JSON map)
          <textarea
            rows={5}
            value={accountsJson}
            onChange={(e) => setAccountsJson(e.target.value)}
            placeholder='e.g. {"config":"...", "admin":"..."}'
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={simulate}>Simulate</button>
          <button onClick={send}>Send</button>
        </div>

        <pre
          style={{
            background: "#0f172a",
            color: "#e2e8f0",
            padding: 12,
            borderRadius: 8,
            minHeight: 160,
            whiteSpace: "pre-wrap",
          }}
        >
          {log || "Logs will appear here…"}
        </pre>

        <p style={{ fontSize: 12, color: "#64748b" }}>
          Tip: put your <code>pegkeeper.json</code> IDL in{" "}
          <code>public/idl/pegkeeper.json</code>. Set{" "}
          <code>NEXT_PUBLIC_PROGRAM_ID</code> and{" "}
          <code>NEXT_PUBLIC_RPC_URL</code> in Vercel.
        </p>
      </div>
    </div>
  );
}
