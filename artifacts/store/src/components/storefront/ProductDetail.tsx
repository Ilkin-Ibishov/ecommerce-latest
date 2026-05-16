import { useState } from "react";
import { ShoppingCart, Heart, Minus, Plus, Check, MessageSquare } from "lucide-react";
import { useCart } from "@/lib/cart/context";

interface Props {
  product: any;
  images: any[];
  translation: { title: string; description: string | null };
  comments: any[];
  locale: string;
}

export default function ProductDetail({ product, images, translation, comments, locale }: Props) {
  const [mainImage, setMainImage] = useState(images[0] ?? null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem } = useCart();

  const handleAddToCart = () => {
    addItem({
      product_id: product.id,
      slug: product.slug,
      title: translation.title,
      price: product.price,
      image: images[0]?.url ?? null,
    }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const inStock = product.stock > 0;

  return (
    <div className="container mx-auto px-4 py-8">
      <nav className="text-sm text-muted-foreground mb-6">
        <a href={`/${locale}`} className="hover:text-foreground">Home</a>
        <span className="mx-2">/</span>
        <a href={`/${locale}/products`} className="hover:text-foreground">Products</a>
        <span className="mx-2">/</span>
        <span className="text-foreground">{translation.title}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-16">
        <div className="space-y-3">
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-muted border border-border">
            {mainImage ? (
              <img src={mainImage.url} alt={mainImage.alt_text ?? translation.title}
                className="object-contain w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">No image</div>
            )}
            {product.is_on_sale && (
              <span className="absolute top-3 left-3 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full">SALE</span>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((img: any) => (
                <button key={img.id} onClick={() => setMainImage(img)}
                  className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition ${mainImage?.id === img.id ? "border-primary" : "border-border hover:border-primary/50"}`}>
                  <img src={img.url} alt={img.alt_text ?? ""} className="object-cover w-full h-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{translation.title}</h1>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-3xl font-bold text-primary">{product.price.toFixed(2)} AZN</span>
              {product.is_deal_of_day && (
                <span className="text-xs bg-orange-100 text-orange-600 font-semibold px-2 py-1 rounded-full">🔥 Deal of the Day</span>
              )}
            </div>
          </div>

          <div>
            {inStock ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                In Stock
                {product.stock < 10 && <span className="text-orange-500">— only {product.stock} left</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                Out of Stock
              </span>
            )}
          </div>

          {inStock && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Quantity</span>
              <div className="flex items-center gap-1 border border-border rounded-lg">
                <button onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-9 h-9 flex items-center justify-center hover:bg-accent transition rounded-l-lg">
                  <Minus size={14} />
                </button>
                <span className="w-10 text-center text-sm font-medium">{qty}</span>
                <button onClick={() => setQty(Math.min(product.stock, qty + 1))}
                  className="w-9 h-9 flex items-center justify-center hover:bg-accent transition rounded-r-lg">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleAddToCart} disabled={!inStock}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition text-sm ${added ? "bg-green-500 text-white" : inStock ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed"}`}>
              {added ? <><Check size={18} />Added to Cart</> : <><ShoppingCart size={18} />{inStock ? "Add to Cart" : "Out of Stock"}</>}
            </button>
            <button className="w-12 h-12 flex items-center justify-center border border-border rounded-xl hover:bg-accent transition">
              <Heart size={18} />
            </button>
          </div>

          <div className="bg-secondary rounded-xl p-4 text-sm">
            <p className="font-medium mb-1">💰 Cash on Delivery</p>
            <p className="text-muted-foreground">Pay in AZN when your order arrives. No card needed.</p>
          </div>

          {translation.description && (
            <div>
              <h3 className="font-semibold mb-2">Description</h3>
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{translation.description}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-10">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <MessageSquare size={20} />
          Reviews ({comments.length})
        </h2>
        {comments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No reviews yet. Be the first to leave a review after purchasing.</p>
        ) : (
          <div className="space-y-4">
            {comments.map((c: any) => (
              <div key={c.id} className="bg-secondary/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{c.users?.full_name ?? "Anonymous"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-muted-foreground">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
