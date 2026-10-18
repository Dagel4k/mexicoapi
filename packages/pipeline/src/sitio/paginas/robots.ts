/** Los rastreadores no gastan cuota del Worker en `/v1` ni bajan el SQLite de `/descargas`. */
export const ROBOTS = "User-agent: *\nAllow: /\nDisallow: /v1\nDisallow: /descargas/\n";
