// Worker di pdf.js con i polyfill caricati prima (Safari/iPadOS più vecchi non hanno alcune funzioni moderne).
// Riesporta WorkerMessageHandler: se il worker separato non parte, pdf.js carica questo file nella pagina ("fake worker").
import './polyfills.js';
export * from './lib/pdf.worker.min.mjs';
