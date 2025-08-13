import Link from "next/link";

function EnvRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <>
      <div className="muted">{label}</div>
      <div><code>{value || "—"}</code></div>
    </>
  );
}

export default function Page() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  const deployedAt = new Date().toISOString();

  return (
    <div className="grid">
      <section className="card" style={{gridColumn:"1/-1"}}>
        <h1 style={{margin:"0 0 8px 0"}}>PegKeeper UI</h1>
        <p className="muted" style={{marginTop:0}}>Go to <Link href="/idl-runner">IDL Runner</Link> to interact with your Anchor program on Devnet.</p>
        <div className="kvs" style={{marginTop:12}}>
          <EnvRow label="Commit" value={commit} />
          <EnvRow label="Branch" value={branch} />
          <EnvRow label="Deployed" value={deployedAt} />
        </div>
      </section>
    </div>
  );
}
