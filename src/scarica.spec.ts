import {
  destinazioneAmmessa,
  indirizzoPubblico,
  leggiConLimite,
  scaricaBuffer,
  scaricaRisposta,
  type Dipendenze,
} from "./scarica";

describe("indirizzoPubblico", () => {
  it.each([
    ["127.0.0.1", 4],
    ["10.1.2.3", 4],
    ["172.16.0.1", 4],
    ["192.168.1.1", 4],
    ["169.254.169.254", 4],
    ["100.64.0.1", 4],
    ["0.0.0.0", 4],
    ["::1", 6],
    ["fd12:3456::1", 6],
    ["fe80::1", 6],
  ])("%s è una rete vietata", (indirizzo, famiglia) => {
    expect(indirizzoPubblico(indirizzo, famiglia)).toBe(false);
  });

  it.each([
    ["8.8.8.8", 4],
    ["93.184.216.34", 4],
    ["2606:4700::1111", 6],
  ])("%s è pubblico", (indirizzo, famiglia) => {
    expect(indirizzoPubblico(indirizzo, famiglia)).toBe(true);
  });
});

/** Un mondo finto: i nomi risolvono come dice la tabella, le risposte le detta chi scrive il test. */
const mondo = (
  nomi: Record<string, string[]>,
  risposte: Record<string, () => Response>,
): Dipendenze & { richieste: string[] } => {
  const richieste: string[] = [];
  return {
    richieste,
    lookup: async (host) =>
      (nomi[host] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    fetch: (async (url: URL) => {
      richieste.push(String(url));
      return (risposte[String(url)] ?? (() => new Response("", { status: 404 })))();
    }) as unknown as typeof fetch,
  };
};

const corpo = (n: number) => new Response(new Uint8Array(n), { status: 200 });
const rimbalzo = (verso: string) => new Response(null, { status: 302, headers: { location: verso } });

describe("destinazioneAmmessa", () => {
  it("rifiuta protocolli diversi da http(s) e nomi che non risolvono", async () => {
    const dip = mondo({ "example.com": ["93.184.216.34"] }, {});
    expect(await destinazioneAmmessa(new URL("file:///etc/passwd"), dip)).toBe(false);
    expect(await destinazioneAmmessa(new URL("https://non-esiste.example.com/"), dip)).toBe(false);
    expect(await destinazioneAmmessa(new URL("https://example.com/"), dip)).toBe(true);
  });

  it("basta un indirizzo privato fra quelli risolti per rifiutare", async () => {
    const dip = mondo({ "misto.example.com": ["93.184.216.34", "10.0.0.5"] }, {});
    expect(await destinazioneAmmessa(new URL("https://misto.example.com/"), dip)).toBe(false);
  });
});

describe("scaricaRisposta", () => {
  it("non contatta una destinazione privata", async () => {
    const dip = mondo({ "interno.example.com": ["10.0.0.5"] }, {});
    expect(await scaricaRisposta(new URL("https://interno.example.com/x"), { dipendenze: dip })).toBeNull();
    expect(dip.richieste).toEqual([]);
  });

  it("segue i redirect uno alla volta e ricontrolla ogni salto", async () => {
    const dip = mondo(
      { "pubblico.example.com": ["93.184.216.34"], "interno.example.com": ["10.0.0.5"] },
      { "https://pubblico.example.com/a": () => rimbalzo("https://interno.example.com/segreto") },
    );
    expect(await scaricaRisposta(new URL("https://pubblico.example.com/a"), { dipendenze: dip })).toBeNull();
    expect(dip.richieste).toEqual(["https://pubblico.example.com/a"]);
  });

  it("segue un redirect verso un altro host pubblico", async () => {
    const dip = mondo(
      { "a.example.com": ["93.184.216.34"], "b.example.com": ["93.184.216.35"] },
      {
        "https://a.example.com/x": () => rimbalzo("https://b.example.com/y"),
        "https://b.example.com/y": () => corpo(3),
      },
    );
    const res = await scaricaRisposta(new URL("https://a.example.com/x"), { dipendenze: dip });
    expect(res?.status).toBe(200);
  });

  it("si ferma dopo troppi redirect", async () => {
    const dip = mondo(
      { "loop.example.com": ["93.184.216.34"] },
      { "https://loop.example.com/": () => rimbalzo("https://loop.example.com/") },
    );
    expect(await scaricaRisposta(new URL("https://loop.example.com/"), { dipendenze: dip })).toBeNull();
    expect(dip.richieste.length).toBe(4);
  });
});

describe("leggiConLimite", () => {
  it("legge il corpo sotto il tetto", async () => {
    expect((await leggiConLimite(corpo(10), 100))?.length).toBe(10);
  });

  it("si ferma oltre il tetto anche se content-length manca", async () => {
    expect(await leggiConLimite(corpo(200), 100)).toBeNull();
  });
});

describe("scaricaBuffer", () => {
  const dip = (risposta: () => Response) =>
    mondo({ "cdn.example.com": ["93.184.216.34"] }, { "https://cdn.example.com/f.png": risposta });

  it("restituisce i byte", async () => {
    const buffer = await scaricaBuffer("https://cdn.example.com/f.png", {
      timeoutMs: 1000,
      dipendenze: dip(() => corpo(7)),
    });
    expect(buffer?.length).toBe(7);
  });

  it("null per URL non validi, risposte non ok e content-length oltre il tetto", async () => {
    const opzioni = { timeoutMs: 1000, massimo: 100 };
    expect(await scaricaBuffer("non un url", { ...opzioni, dipendenze: dip(() => corpo(1)) })).toBeNull();
    expect(
      await scaricaBuffer("https://cdn.example.com/f.png", {
        ...opzioni,
        dipendenze: dip(() => new Response("no", { status: 500 })),
      }),
    ).toBeNull();
    expect(
      await scaricaBuffer("https://cdn.example.com/f.png", {
        ...opzioni,
        dipendenze: dip(() => new Response(new Uint8Array(1), { headers: { "content-length": "5000" } })),
      }),
    ).toBeNull();
  });

  it("il tetto è configurabile", async () => {
    const grande = dip(() => corpo(150));
    expect(await scaricaBuffer("https://cdn.example.com/f.png", { timeoutMs: 1000, massimo: 100, dipendenze: grande })).toBeNull();
    expect(
      (await scaricaBuffer("https://cdn.example.com/f.png", { timeoutMs: 1000, massimo: 200, dipendenze: grande }))?.length,
    ).toBe(150);
  });
});
