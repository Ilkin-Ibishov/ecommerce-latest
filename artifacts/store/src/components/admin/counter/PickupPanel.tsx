import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { adminFetch, adminJson } from "@/lib/admin-fetch";

interface Reservation {
  id: string;
  reservation_number: string;
  customer_name: string;
  customer_phone: string;
  agreed_price: number;
  paid_amount: number;
  quantity: number;
  product_title?: string | null;
}

// Deposit pick-up at the till: its own transaction through fulfil_reservation, not a line in
// a counter sale (M3 spec §8, §16.7).
export function PickupPanel() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Reservation[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const search = async () => {
    setMessage(null);
    const res = await adminFetch(apiUrl(`/admin/reservations?status=active&search=${encodeURIComponent(query.trim())}`));
    setFound(res.ok ? await res.json() : []);
  };

  const fulfil = async (r: Reservation) => {
    const balance = Math.max(0, Number(r.agreed_price) - Number(r.paid_amount));
    if (!confirm(`${r.customer_name}: qalıq ${balance.toFixed(2)} AZN alınsın və mal təhvil verilsin?`)) return;
    try {
      await adminJson(apiUrl(`/admin/reservations/${r.id}/fulfil`), {
        method: "POST",
        body: JSON.stringify({ final_payment: balance }),
      });
      setMessage(`${r.reservation_number} təhvil verildi.`);
      setFound((list) => list.filter((x) => x.id !== r.id));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <section aria-labelledby="pickup-title" className="rounded-xl border border-border p-4">
      <h2 id="pickup-title" className="mb-2 font-semibold">Depozitli malın təhvili</h2>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
          placeholder="Rezerv nömrəsi və ya telefon" aria-label="Rezerv nömrəsi və ya telefon"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button type="button" onClick={() => void search()} disabled={!query.trim()}
          className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium disabled:opacity-50">Axtar</button>
      </div>
      {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      <ul className="mt-2 space-y-2">
        {found.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-2 text-sm">
            <span>
              <strong>{r.reservation_number}</strong> · {r.customer_name} · {r.product_title ?? ""} × {r.quantity}
              <br />Qalıq: {Math.max(0, Number(r.agreed_price) - Number(r.paid_amount)).toFixed(2)} AZN
            </span>
            <button type="button" onClick={() => void fulfil(r)}
              className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground">Təhvil ver</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
