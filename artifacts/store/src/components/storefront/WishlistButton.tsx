import { useState, useEffect } from "react";
import { Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/api";

interface Props {
  productId: string;
  onAuthRequired: () => void;
  className?: string;
}

export function WishlistButton({ productId, onAuthRequired, className = "" }: Props) {
  const [wishlisted, setWishlisted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }: any) => {
      if (!session || cancelled) { setChecked(true); return; }
      try {
        const res = await fetch(apiUrl("/wishlist"), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const items = await res.json();
          if (!cancelled) {
            setWishlisted(items.some((i: any) => i.product_id === productId));
          }
        }
      } catch {}
      if (!cancelled) setChecked(true);
    });
    return () => { cancelled = true; };
  }, [productId]);

  const toggle = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { onAuthRequired(); return; }
    setLoading(true);
    try {
      if (wishlisted) {
        await fetch(apiUrl(`/wishlist/${productId}`), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        setWishlisted(false);
      } else {
        await fetch(apiUrl("/wishlist"), {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ product_id: productId }),
        });
        setWishlisted(true);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={loading || !checked}
      title={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      className={`flex items-center justify-center border border-border rounded-xl transition hover:bg-accent disabled:opacity-50 ${className}`}
    >
      <Heart
        size={18}
        className={wishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground"}
      />
    </button>
  );
}
