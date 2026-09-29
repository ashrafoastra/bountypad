"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { announceXSession } from "@/lib/auth";
import { Crosses, XIcon } from "@/components/ui";

/**
 * Where "Log in with X" lands. The API has already verified the account with X; this page trades
 * the one-time code for the session cookie, then goes back to where the login started.
 */
export default function Page() {
  return <Suspense><XReturn /></Suspense>;
}

function XReturn() {
  const q = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = q.get("code"), error = q.get("error"), platform = q.get("platform");
    if (error) return setMsg({ ok: false, text: error });
    if (platform) return setMsg({ ok: true, text: `Platform account @${platform} connected. Launch posts and receipts will be published from it.` });
    if (!code) return setMsg({ ok: false, text: "Nothing to finish here." });
    api<{ x: { username: string }; returnTo: string }>("/api/auth/x/complete", { method: "POST", json: { code } })
      .then((r) => { announceXSession(); setMsg({ ok: true, text: `Logged in as @${r.x.username}` }); router.replace(r.returnTo || "/claim"); })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [q, router]);

  return (
    <div className="max-w-lg mx-auto frame p-8 sm:p-10 flex flex-col items-center text-center gap-5 mt-10">
      <Crosses />
      <span className="w-12 h-12 border border-line-2 flex items-center justify-center"><XIcon size={20} /></span>
      {!msg ? (
        <><div className="text-[20px]">Confirming your X account…</div><span className="live-dot" /></>
      ) : (
        <>
          <div className={`text-[20px] ${msg.ok ? "" : "text-red"}`}>{msg.ok ? msg.text : "X login didn't complete"}</div>
          {!msg.ok && <p className="text-mute text-sm">{msg.text}</p>}
          <Link href="/claim" className="btn btn-outline">Back to Claim</Link>
        </>
      )}
    </div>
  );
}
