# @printee-network/safe-fetch

Download di file da URL esterni **senza fare da sonda per la rete interna**: blocco delle reti
private (loopback, link-local, ULA…), redirect seguiti uno alla volta e ricontrollati, tetto di
dimensione e timeout. Non guarda il contenuto: il controllo sul tipo di file spetta a chi lo usa.

Si installa da GitHub a tag: `github:Printee-Network/safe-fetch#vX.Y.Z`.

## Uso

```ts
import { scaricaBuffer, scaricaRisposta } from "@printee-network/safe-fetch";

// I byte, o null se la destinazione non è ammessa / la risposta non va / è troppo grande.
const byte = await scaricaBuffer("https://example.com/foto.jpg", { timeoutMs: 15_000, massimo: 10 * 1024 * 1024 });

// La risposta (per chi la inoltra in streaming): stessi controlli su destinazione e redirect.
const risposta = await scaricaRisposta(new URL("https://example.com/foto.jpg"), { init: { cache: "no-store" } });
```

| Esportazione | Cosa fa |
|---|---|
| `scaricaBuffer` | scarica e legge il corpo con un tetto (default 10 MB) e un timeout |
| `scaricaRisposta` | la `Response`, con i redirect seguiti uno alla volta e ricontrollati (massimo 3) |
| `leggiConLimite` | legge il corpo contando i byte: `content-length` può mancare o mentire |
| `destinazioneAmmessa`, `indirizzoPubblico` | le regole: solo http(s), e nessun indirizzo risolto in una rete privata |

Resta aperto il DNS rebinding fra risoluzione e connessione.

## Repository pubblico

Questo repository è pubblico: serve a installarlo senza credenziali nei processi di build.
**Niente domini, URL, nomi di servizi interni o segreti**, né nel codice né nei commenti né nei test:
solo valori fittizi (`example.com`, `127.0.0.1`).
