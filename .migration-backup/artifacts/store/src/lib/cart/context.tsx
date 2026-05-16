"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";

export interface CartItem {
  product_id: string;
  slug: string;
  title: string;
  price: number;
  image: string | null;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  sessionId: string;
}

type CartAction =
  | { type: "SET"; items: CartItem[] }
  | { type: "ADD"; item: CartItem }
  | { type: "REMOVE"; product_id: string }
  | { type: "UPDATE_QTY"; product_id: string; quantity: number }
  | { type: "CLEAR" };

function generateSessionId(): string {
  return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const existing = localStorage.getItem("cart_session_id");
  if (existing) return existing;
  const id = generateSessionId();
  localStorage.setItem("cart_session_id", id);
  return id;
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "SET":
      return { ...state, items: action.items };
    case "ADD": {
      const existing = state.items.find(
        (i) => i.product_id === action.item.product_id
      );
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.product_id === action.item.product_id
              ? { ...i, quantity: i.quantity + action.item.quantity }
              : i
          ),
        };
      }
      return { ...state, items: [...state.items, action.item] };
    }
    case "REMOVE":
      return {
        ...state,
        items: state.items.filter((i) => i.product_id !== action.product_id),
      };
    case "UPDATE_QTY":
      if (action.quantity <= 0) {
        return {
          ...state,
          items: state.items.filter((i) => i.product_id !== action.product_id),
        };
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.product_id === action.product_id
            ? { ...i, quantity: action.quantity }
            : i
        ),
      };
    case "CLEAR":
      return { ...state, items: [] };
    default:
      return state;
  }
}

interface CartContextValue {
  items: CartItem[];
  sessionId: string;
  itemCount: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (product_id: string) => void;
  updateQty: (product_id: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "cart_items";

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    sessionId: "ssr",
  });

  // Hydrate from localStorage on mount
  useEffect(() => {
    getOrCreateSessionId();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const items: CartItem[] = stored ? JSON.parse(stored) : [];
      dispatch({ type: "SET", items });
    } catch {
      dispatch({ type: "SET", items: [] });
    }
  }, []);

  // Persist to localStorage on every change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    }
  }, [state.items]);

  const sessionId =
    typeof window !== "undefined"
      ? getOrCreateSessionId()
      : "ssr";

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity">, quantity = 1) => {
      dispatch({ type: "ADD", item: { ...item, quantity } });
    },
    []
  );

  const removeItem = useCallback((product_id: string) => {
    dispatch({ type: "REMOVE", product_id });
  }, []);

  const updateQty = useCallback((product_id: string, quantity: number) => {
    dispatch({ type: "UPDATE_QTY", product_id, quantity });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = state.items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0
  );

  return (
    <CartContext.Provider
      value={{
        items: state.items,
        sessionId,
        itemCount,
        subtotal,
        addItem,
        removeItem,
        updateQty,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
