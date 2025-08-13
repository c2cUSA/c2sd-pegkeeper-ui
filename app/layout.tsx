export const metadata = { title: "C2SD PegKeeper", description: "GUI IDL Runner" };
import "../styles/globals.css";
import Image from "next/image";
import Link from "next/link";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{borderBottom: "1px solid #202020"}}>
          <div className="container" style={{display:"flex", gap:16, alignItems:"center"}}>
            <Image src="/logo.svg" alt="C2C" width={36} height={36}/>
            <div style={{fontWeight:700, letterSpacing:0.3}}>C2SD PegKeeper</div>
            <nav style={{marginLeft:"auto", display:"flex", gap:16}}>
              <Link href="/">Dashboard</Link>
              <Link href="/idl-runner">IDL Runner</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
