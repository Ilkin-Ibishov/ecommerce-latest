CREATE OR REPLACE FUNCTION public.search_products(query_text text, lang_code text)
 RETURNS TABLE(id uuid, title text, description text, price numeric, slug text, rank real)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    pt.title,
    pt.description,
    p.price,
    p.slug,
    ts_rank(pt.search_vector, plainto_tsquery('simple', query_text)) AS rank
  FROM products p
  JOIN product_translations pt ON pt.product_id = p.id AND pt.lang_code = search_products.lang_code
  WHERE
    pt.search_vector @@ plainto_tsquery('simple', query_text)
    OR pt.title ILIKE '%' || query_text || '%'
  ORDER BY rank DESC, p.sort_order ASC
  LIMIT 50;
END;
$function$;
