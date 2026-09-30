import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

const RETI_VIETATE = (() => {
  const reti = new BlockList();
  (
    [
      ["0.0.0.0", 8, "ipv4"],
      ["10.0.0.0", 8, "ipv4"],
      ["100.64.0.0", 10, "ipv4"], // CGNAT, usato anche da reti private di cloud
      ["127.0.0.0", 8, "ipv4"],
      ["169.254.0.0", 16, "ipv4"], // link-local, compreso l'endpoint dei metadati cloud
      ["172.16.0.0", 12, "ipv4"],
      ["192.168.0.0", 16, "ipv4"],
      ["::", 128, "ipv6"],
      ["::1", 128, "ipv6"],
      ["fc00::", 7, "ipv6"], // ULA: la rete interna di molte piattaforme (es. fd12:…)
      ["fe80::", 10, "ipv6"],
    ] as const
  ).forEach(([rete, prefisso, famiglia]) => reti.addSubnet(rete, prefisso, famiglia));
  return reti;
})();

const MAX_REDIRECT = 3;
export const DIMENSIONE_MASSIMA = 10 * 1024 * 1024;

/** Le uniche due cose che toccano il mondo esterno, iniettabili per i test. */
export type Dipendenze = {
  lookup: (host: string) => Promise<Array<{ address: string; family: number }>>;
  fetch: typeof fetch;
};

const dipendenzeReali: Dipendenze = {
  lookup: (host) => lookup(host, { all: true }),
  fetch: (...args) => fetch(...args),
};

/** Pura: un indirizzo IP risolto è una destinazione ammessa? */
export const indirizzoPubblico = (indirizzo: string, famiglia: number): boolean =>
  !RETI_VIETATE.check(indirizzo, famiglia === 6 ? "ipv6" : "ipv4");

/** Solo http(s), e solo se OGNI indirizzo a cui il nome risolve è pubblico. */
export const destinazioneAmmessa = async (
  url: URL,
  dip: Pick<Dipendenze, "lookup"> = dipendenzeReali,
): Promise<boolean> => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const indirizzi = await dip.lookup(url.hostname).catch(() => []);
  return (
    indirizzi.length > 0 &&
    indirizzi.every(({ address, family }) => indirizzoPubblico(address, family))
  );
};

export type OpzioniRisposta = {
  segnale?: AbortSignal;
  /** Opzioni passate a `fetch` (es. `cache` di Next). `redirect` e `signal` le decide la libreria. */
  init?: Omit<RequestInit, "redirect" | "signal">;
  dipendenze?: Dipendenze;
};

/**
 * La risposta, seguendo i redirect **uno alla volta**: ogni salto si ricontrolla. Lasciarli seguire
 * in automatico a `fetch` permetterebbe a un host pubblico di rimbalzare verso la rete interna.
 * `null` se la destinazione non è ammessa o i redirect sono troppi.
 */
export async function scaricaRisposta(
  url: URL,
  { segnale, init, dipendenze = dipendenzeReali }: OpzioniRisposta = {},
  salti = 0,
): Promise<Response | null> {
  if (salti > MAX_REDIRECT || !(await destinazioneAmmessa(url, dipendenze))) return null;

  const res = await dipendenze.fetch(url, { ...init, redirect: "manual", signal: segnale });
  const verso = res.headers.get("location");
  return verso && res.status >= 300 && res.status < 400
    ? scaricaRisposta(new URL(verso, url), { segnale, init, dipendenze }, salti + 1)
    : res;
}

/** Legge il corpo con un contatore: `content-length` può mancare o mentire. */
export async function leggiConLimite(res: Response, massimo: number): Promise<Buffer | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const pezzi: Uint8Array[] = [];
  let letti = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(pezzi);
    letti += value.byteLength;
    if (letti > massimo) {
      await reader.cancel();
      return null;
    }
    pezzi.push(value);
  }
}

export type OpzioniBuffer = {
  timeoutMs: number;
  /** Default 10 MB. */
  massimo?: number;
  dipendenze?: Dipendenze;
};

/** I byte del file, oppure `null` se la destinazione non è ammessa, la risposta non va o è troppo grande. */
export async function scaricaBuffer(
  grezzo: string,
  { timeoutMs, massimo = DIMENSIONE_MASSIMA, dipendenze = dipendenzeReali }: OpzioniBuffer,
): Promise<Buffer | null> {
  const url = (() => {
    try {
      return new URL(grezzo);
    } catch {
      return null;
    }
  })();
  if (!url) return null;

  const res = await scaricaRisposta(url, { segnale: AbortSignal.timeout(timeoutMs), dipendenze });
  const troppoGrande = Number(res?.headers.get("content-length") ?? 0) > massimo;
  return res && res.ok && !troppoGrande ? leggiConLimite(res, massimo) : null;
}
