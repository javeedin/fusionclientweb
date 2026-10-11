// Vite asset URL imports, e.g. import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
declare module '*?url' {
  const src: string;
  export default src;
}
