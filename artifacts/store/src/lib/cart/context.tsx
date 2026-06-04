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
  | { type: "SET_SESSION"; sessionId: string }
  | { type: "ADD"; item: CartItem }
  | { type: "REMOVE"; product_id: string }
  | { type: "UPDATE_QTY"; product_id: string; quantity: number }
  | { type: "CLEAR" };

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "SET":
      return { ...state, items: action.items };
    case "SET_SESSION":
      return { ...state, sessionId: action.sessionId };
    case "ADD": {
      const existing = state.items.find((i) => i.product_id === action.item.product_id);
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
      return { ...state, items: state.items.filter((i) => i.product_id !== action.product_id) };
    case "UPDATE_QTY":
      if (action.quantity <= 0) {
        return { ...state, items: state.items.filter((i) => i.product_id !== action.product_id) };
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.product_id === action.product_id ? { ...i, quantity: action.quantity } : i
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
  getItemQty: (product_id: string) => number;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "cart_items";
const SESSION_KEY = "cart_session_id";

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [], sessionId: "" });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const raw: unknown[] = stored ? JSON.parse(stored) : [];
      // Validate each item from localStorage to prevent tampered data
      const items: CartItem[] = (Array.isArray(raw) ? raw : []).filter((item): item is CartItem => {
        if (!item || typeof item !== "object") return false;
        const i = item as Record<string, unknown>;
        if (typeof i.product_id !== "string" || !i.product_id) return false;
        if (typeof i.slug !== "string" || !i.slug) return false;
        if (typeof i.title !== "string" || !i.title) return false;
        if (typeof i.price !== "number" || i.price <= 0 || !isFinite(i.price)) return false;
        if (typeof i.quantity !== "number" || i.quantity <= 0 || i.quantity > 99 || !Number.isInteger(i.quantity)) return false;
        return true;
      });
      dispatch({ type: "SET", items });
    } catch {
      dispatch({ type: "SET", items: [] });
    }

    let sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = generateSessionId();
      localStorage.setItem(SESSION_KEY, sessionId);
    }
    dispatch({ type: "SET_SESSION", sessionId });
  }, []);

  useEffect(() => {
    if (state.items.length > 0 || localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
    }
  }, [state.items]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    dispatch({ type: "ADD", item: { ...item, quantity } });
  }, []);

  const removeItem = useCallback((product_id: string) => {
    dispatch({ type: "REMOVE", product_id });
  }, []);

  const updateQty = useCallback((product_id: string, quantity: number) => {
    dispatch({ type: "UPDATE_QTY", product_id, quantity });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  const getItemQty = useCallback((product_id: string) => {
    return state.items.find((i) => i.product_id === product_id)?.quantity ?? 0;
  }, [state.items]);

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = state.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider value={{
      items: state.items,
      sessionId: state.sessionId,
      itemCount,
      subtotal,
      addItem,
      removeItem,
      updateQty,
      getItemQty,
      clearCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
