"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { X, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useCart } from "@/lib/cart/context";

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  locale: string;
}

export default function CartDrawer({ open, onClose, locale }: CartDrawerProps) {
  const { items, subtotal, updateQty, removeItem, itemCount } = useCart();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <ShoppingBag size={20} />
            Cart
            {itemCount > 0 && (
              <span className="text-sm bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-medium">
                {itemCount}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <ShoppingBag size={48} className="text-muted-foreground/30" />
              <p className="text-muted-foreground">Your cart is empty</p>
              <button
                onClick={onClose}
                className="text-sm text-primary hover:underline"
              >
                Continue shopping
              </button>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li
                  key={item.product_id}
                  className="flex gap-3 p-3 rounded-xl border border-border"
                >
                  {/* Image */}
                  <Link
                    href={`/${locale}/products/${item.slug}`}
                    onClick={onClose}
                    className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0"
                  >
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.title}
                        width={64}
                        height={64}
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        ?
                      </div>
                    )}
                  </Link>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/${locale}/products/${item.slug}`}
                      onClick={onClose}
                      className="text-sm font-medium line-clamp-2 hover:text-primary transition"
                    >
                      {item.title}
                    </Link>
                    <p className="text-primary font-bold text-sm mt-1">
                      {item.price.toFixed(2)} AZN
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1 border border-border rounded-lg">
                        <button
                          onClick={() => updateQty(item.product_id, item.quantity - 1)}
                          className="w-7 h-7 flex items-center justify-center hover:bg-accent transition rounded-l-lg"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center text-xs font-medium">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQty(item.product_id, item.quantity + 1)}
                          className="w-7 h-7 flex items-center justify-center hover:bg-accent transition rounded-r-lg"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeItem(item.product_id)}
                        className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-border px-6 py-4 space-y-4">
            <div className="flex justify-between font-bold text-lg">
              <span>Subtotal</span>
              <span className="text-primary">{subtotal.toFixed(2)} AZN</span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Free delivery · Cash on delivery only
            </p>
            <Link
              href={`/${locale}/checkout`}
              onClick={onClose}
              className="block w-full text-center bg-primary text-primary-foreground font-semibold py-3 rounded-xl hover:bg-primary/90 transition"
            >
              Checkout ({subtotal.toFixed(2)} AZN)
            </Link>
            <button
              onClick={onClose}
              className="block w-full text-center text-sm text-muted-foreground hover:text-foreground transition"
            >
              Continue shopping
            </button>
          </div>
        )}
      </div>
    </>
  );
}
