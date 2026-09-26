import { StoreHeader } from "../components/shop/StoreHeader";
import { PromoBanner } from "../components/promo-banner";
import { HeroCarousel } from "../components/hero-carousel";
import { CategoryCircles } from "../components/category-circles";
import { LatestDrop } from "../components/latest-drop";
import { ShopByLifestyle } from "../components/lifestyle/ShopByLifestyle";
import { ShopByBrands } from "../components/brand-carousel";
import { Footer } from "../components/footer";
export default function Index(){return <main className="min-h-screen selection:bg-black selection:text-white"><StoreHeader/><PromoBanner/><HeroCarousel/><CategoryCircles/><LatestDrop/><ShopByLifestyle/><ShopByBrands/><Footer/></main>}
