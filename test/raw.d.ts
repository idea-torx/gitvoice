/** Vite serves `?raw` imports as file contents — used by the CLI-coverage test. */
declare module "*?raw" {
  const content: string;
  export default content;
}
