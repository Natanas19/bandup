"use client";

import { useEffect, useState } from "react";

export default function DebugMobilePage() {
  const [status, setStatus] = useState("JavaScript ainda não executou");
  const [clickWorked, setClickWorked] = useState(false);

  useEffect(() => {
    setStatus("JavaScript executou");
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="status">{status}</p>
      <button
        type="button"
        onClick={() => setClickWorked(true)}
        className="rounded-lg bg-violet-700 px-4 py-2 font-semibold text-white"
      >
        Testar clique
      </button>
      {clickWorked && <p>Clique funcionou</p>}
    </main>
  );
}
