import { URL_API } from "@mexicoapi/core/problemas";

/**
 * Los rastreadores no gastan cuota del Worker en `/v1` ni bajan el SQLite de `/descargas`. El
 * sitemap va con URL absoluta, la de la API pública, como la canónica de cada página.
 */
export const ROBOTS = `User-agent: *
Allow: /
Disallow: /v1
Disallow: /descargas/

Sitemap: ${URL_API}/sitemap.xml
`;
