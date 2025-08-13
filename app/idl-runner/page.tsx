"use client";
import { useState, useMemo } from "react";
import WalletCtx, { WalletUi } from "@/components/WalletProvider";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";

type Idl = anchor.Idl;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{display:"grid", gridTemplateColumns:"220px 1fr", gap:12, alignItems:"center"}}>
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export default function IdlRunner() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [programId, setProgramId] = useState<string>(process.env.NEXT_PUBLIC_PROGRAM_ID || "");
  const [idlText, setIdlText] = useState<string>("");
  const [idl, setIdl] = useState<Idl | null>(null);
  const [ixName, setIxName] = useState<string>("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>("");
  const [sig, setSig] = useState<string>("");

  const instructions = useMemo(() => idl?.instructions || [], [idl]);

  const loadIdlFromFile = async (file: File) => {
    const text = await file.text();
    setIdlText(text);
    try {
      const parsed = JSON.parse(text);
      setIdl(parsed);
      setIxName(parsed.instructions?.[0]?.name || "");
      setStatus("IDL loaded ✓");
    } catch (e:any) {
      setStatus("Invalid JSON: " + e.message);
    }
  };

  const loadIdlFromTextarea = () => {
    try {
      const parsed = JSON.parse(idlText);
      setIdl(parsed);
      setIxName(parsed.instructions?.[0]?.name || "");
      setStatus("IDL loaded ✓");
    } catch (e:any) {
      setStatus("Invalid JSON: " + e.message);
    }
  };

  const send = async () => {
    setStatus("Sending...");
    setSig("");
    try {
      if (!wallet.publicKey) throw new Error("Connect wallet first");
      if (!programId) throw new Error("Program ID required");
      if (!idl) throw new Error("Load IDL first");
      if (!ixName) throw new Error("Choose an instruction");

      const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
      anchor.setProvider(provider);
      const program = new anchor.Program(idl as anchor.Idl, provider, new PublicKey(programId));

      // Build args in the same order as IDL
      const ix = idl.instructions!.find(i => i.name === ixName)!;
      const argVals = (ix.args || []).map(a => {
        const raw = args[a.name];
        if (raw === undefined) throw new Error("Missing arg: " + a.name);
        const typeStr = JSON.stringify(a.type);
        if (typeStr.includes("u128") || typeStr.includes("i128") || typeStr.includes("u64") || typeStr.includes("i64")) {
          // @ts-ignore
          return new anchor.BN(raw);
        }
        if (typeStr === '"bool"') return raw === "true";
        return raw;
      });

      // Dynamic method call
      // @ts-ignore
      let builder = program.methods[ixName](...argVals);

      // Accounts
      const accMap: any = {};
      for (const acc of (ix.accounts || [])) {
        const v = accounts[acc.name];
        if (!v && acc.name === "systemProgram") {
          accMap[acc.name] = SystemProgram.programId;
          continue;
        }
        if (!v) throw new Error("Missing account: " + acc.name);
        accMap[acc.name] = new PublicKey(v);
      }

      const txSig = await builder.accounts(accMap).rpc();
      setSig(txSig);
      setStatus("Success ✓");
    } catch (e:any) {
      setStatus("Error: " + e.message);
    }
  };

  return (
    <WalletCtx>
      <div className="grid">
        <section className="card" style={{gridColumn:"1/-1"}}>
          <h2 style={{marginTop:0}}>IDL Runner (GUI)</h2>
          <p className="muted">Upload your Anchor IDL JSON, choose an instruction, fill accounts/args, connect Phantom, and send to Devnet.</p>
          <div style={{display:"flex", gap:12, alignItems:"center"}}>
            <WalletUi />
            <button className="btn" onClick={()=>navigator.clipboard.writeText(sig)} disabled={!sig}>Copy last tx</button>
            {sig && <a className="btn" href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer">View on Explorer</a>}
          </div>
        </section>

        <section className="card">
          <h3 style={{marginTop:0}}>1) Load IDL</h3>
          <Row label="Upload JSON">
            <input type="file" accept=".json,application/json" onChange={e=>{
              const f=e.target.files?.[0]; if (f) loadIdlFromFile(f);
            }} />
          </Row>
          <Row label="Or paste JSON">
            <textarea rows={6} value={idlText} onChange={e=>setIdlText(e.target.value)} placeholder="{ ... }"></textarea>
          </Row>
          <button className="btn" onClick={loadIdlFromTextarea}>Parse Pasted JSON</button>
          <p className="muted" style={{marginTop:8}}>{status}</p>
        </section>

        <section className="card">
          <h3 style={{marginTop:0}}>2) Program</h3>
          <Row label="Program ID">
            <input value={programId} onChange={e=>setProgramId(e.target.value)} placeholder="Your program id (Devnet)"/>
          </Row>
          <Row label="Instruction">
            <select value={ixName} onChange={e=>{
              setIxName(e.target.value);
              setArgs({}); setAccounts({});
            }}>
              {instructions.map(ix => <option key={ix.name} value={ix.name}>{ix.name}</option>)}
            </select>
          </Row>
        </section>

        <section className="card">
          <h3 style={{marginTop:0}}>3) Fill Inputs</h3>
          {idl && ixName && (()=>{
            const ix = idl.instructions!.find(i => i.name === ixName)!;
            return (
              <div className="grid">
                <div className="card">
                  <h4 style={{marginTop:0}}>Args</h4>
                  {(ix.args || []).length === 0 && <p className="muted">No args</p>}
                  {(ix.args || []).map(a => (
                    <Row key={a.name} label={`${a.name} (${JSON.stringify(a.type)})`}>
                      <input value={args[a.name]||""} onChange={e=>setArgs({...args,[a.name]:e.target.value})} placeholder="Enter value"/>
                    </Row>
                  ))}
                </div>
                <div className="card">
                  <h4 style={{marginTop:0}}>Accounts</h4>
                  {(ix.accounts || []).map(acc => (
                    <Row key={acc.name} label={`${acc.name} ${acc.isMut?"[mut]":""} ${acc.isSigner?"[signer]":""}`}>
                      <input value={accounts[acc.name]||""} onChange={e=>setAccounts({...accounts,[acc.name]:e.target.value})} placeholder={acc.name === "systemProgram" ? "autofilled" : "PublicKey"}/>
                    </Row>
                  ))}
                </div>
              </div>
            );
          })()}
        </section>

        <section className="card">
          <h3 style={{marginTop:0}}>4) Send</h3>
          <button className="btn btn-primary" onClick={send}>Send Transaction</button>
          <p className="muted" style={{marginTop:8}}>{sig ? `Signature: ${sig}` : ""}</p>
        </section>
      </div>
    </WalletCtx>
  );
}
