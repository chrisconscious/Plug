import { StoreHeader } from "../components/shop/StoreHeader";
import { PromoBanner } from "../components/promo-banner";
import { HeroCarousel } from "../components/hero-carousel";
import { CategoryCircles } from "../components/category-circles";
import { PremiumProducts } from "../components/premium-products";
import { ShopByLifestyle } from "../components/lifestyle/ShopByLifestyle";
import { ShopByBrands } from "../components/brand-carousel";
import { Footer } from "../components/footer";
export default function Index(){return <main className="min-h-screen selection:bg-black selection:text-white"><StoreHeader/><PromoBanner/><HeroCarousel/><CategoryCircles/><PremiumProducts/><ShopByLifestyle/><ShopByBrands/><Footer/></main>}
