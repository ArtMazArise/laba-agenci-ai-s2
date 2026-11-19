"use client";

import { useState } from "react";

export default function LogoutButton({ beforeLogout }: { beforeLogout: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function leave() {
    if (pending) return;
    setPending(true);
    setError("");
    beforeLogout();
    try {
      const response = await fetch("/api/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.replace("/");
    } catch { setError("Nie udało się wyjść. Spróbuj ponownie."); setPending(false); }
  }
  return <div className="logout-area"><button className="secondary-button" onClick={() => void leave()} disabled={pending}>{pending ? "Wychodzę…" : "Wyjdź"}</button>{error && <p role="alert">{error}</p>}</div>;
}
