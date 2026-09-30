/**
 * `@printee-network/safe-fetch`
 *
 * Scaricare un file da un URL deciso da altri (un utente, un fornitore, un feed) **senza fare da
 * sonda per la rete interna**. Accettare ogni `http(s)://` e seguire i redirect in automatico
 * permette SSRF verso i servizi privati, anche passando da un redirect di un host pubblico; leggere
 * tutto il corpo in memoria permette a una risposta enorme di esaurirla.
 *
 * Non è un'allowlist di host (i fornitori hanno i loro CDN, una lista incompleta romperebbe proprio
 * quello dimenticato): si vieta ciò che non è mai una destinazione legittima, cioè la rete privata.
 * Resta aperto il DNS rebinding fra risoluzione e connessione; chiuderlo richiederebbe di
 * connettersi all'IP risolto.
 *
 * **Cosa NON c'è dentro, di proposito:** nessun controllo sul contenuto (tipo di file, immagine o
 * no): spetta a chi scarica, che sa cosa si aspetta.
 */
export {
  DIMENSIONE_MASSIMA,
  destinazioneAmmessa,
  indirizzoPubblico,
  leggiConLimite,
  scaricaBuffer,
  scaricaRisposta,
} from "./scarica";
export type { Dipendenze, OpzioniBuffer, OpzioniRisposta } from "./scarica";
