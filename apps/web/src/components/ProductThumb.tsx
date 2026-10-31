import { Apple, Home, Package, Shirt, Smartphone, Sparkles, type LucideIcon } from "lucide-react";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  garment: Shirt,
  footwear: Package,
  accessories: Sparkles,
  packaged_food: Apple,
  beverage: Apple,
  restaurant: Apple,
  electronics: Smartphone,
  cosmetics: Sparkles,
  general: Package,
  loose: Package,
  jewellery: Sparkles,
  pharmacy: Package,
};

const PALETTE = ["#d1fae5", "#dbeafe", "#fef3c7", "#fce7f3", "#ede9fe", "#fee2e2", "#e0f2fe", "#fef9c3"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function iconForCategory(category: string | null): LucideIcon {
  if (!category) return Package;
  return CATEGORY_ICONS[category.toLowerCase()] ?? Home;
}

interface ProductThumbProps {
  name: string;
  category: string | null;
  size?: number;
}

export function ProductThumb({ name, category, size = 36 }: ProductThumbProps) {
  const Icon = iconForCategory(category);
  const color = PALETTE[hashString(name) % PALETTE.length];
  return (
    <span className="product-thumb" style={{ width: size, height: size, background: color }} aria-hidden="true">
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </span>
  );
}
