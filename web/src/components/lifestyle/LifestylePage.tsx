import { useParams } from "react-router-dom";
import { ProductListingPage } from "../shop/ProductListingPage";

/**
 * /lifestyle/:lifestyleSlug — a lifestyle is a first-class locked listing
 * context: the full existing filter engine (facets, sidebar, sort, pagination)
 * runs behind a `lifestyle` query, the meta + hero come from the real DB row,
 * and the category chips come from the live facet query inside that lifestyle.
 */
export function LifestylePage() {
  const { lifestyleSlug } = useParams();
  if (!lifestyleSlug) return null;
  return <ProductListingPage lifestyle={lifestyleSlug} />;
}