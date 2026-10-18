declare module "*.md?raw" {
  const contenido: string;
  export default contenido;
}

/** `import.meta.glob` de Vite, que las pruebas usan para listar docs/ y data/. */
interface ImportMeta {
  glob<T = unknown>(
    patron: string,
    opciones?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
