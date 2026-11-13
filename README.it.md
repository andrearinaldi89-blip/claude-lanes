# metodo

**Un flusso di lavoro di revisione e sviluppo per Claude Code: una sessione che rivede, più sessioni di codice in cloni separati, e hook che fanno rispettare le regole.**

Traduzione breve del [README inglese](README.md), che è il testo di riferimento.

## Il problema

- Le sessioni lunghe di Claude Code scivolano: la stessa prova si ripete, il lavoro di due compiti finisce nella stessa conversazione, e una regola ricordata a parole si dimentica alla compattazione successiva.
- Più sessioni in parallelo sullo stesso repository si sovrascrivono, e una sessione chiusa per la memoria lascia lavoro in background che nessuno risveglia.
- metodo sposta le regole dalla memoria agli hook: girano che qualcuno se ne ricordi o no.

## Che cosa dà

La guardia (comandi che si rimpiangono), il controllo della consegna, l'orientamento all'avvio, il pannello dei binari (`/lanes-status`), la pulizia di chiusura, il protocollo dei passaggi (Prompt → Piano → Consegna → Chiusura) e, in più e a scelta, un registro delle decisioni che conserva il *perché*.

## Installazione

```bash
claude plugin marketplace add andrearinaldi89-blip/claude-lanes && claude plugin install metodo@metodo
```

Poi si copia `templates/metodo.json` in `.claude/metodo.json` e si segue «Adopt it in a project» nel README inglese.

## Che cosa funziona dove

Il nocciolo (hook, skill, modelli, script) funziona da terminale e su Linux. La coordinazione fra sessioni (messaggi, pannello, risveglio) richiede Claude Code desktop e, per ora, macOS. In cloud (Claude Code sul web) ogni sessione ha il suo container: il revisore apre una sessione di codice per ogni lavoro, sul suo branch, il lavoro passa da `origin`, e alla chiusura la sessione si archivia (con la conferma del proprietario) invece di pulirsi; la guardia blocca un secondo prompt alla stessa sessione e un'archiviazione prima della «Chiusura…».

Contatto: GitHub Discussions di questo repository. Licenza: [MIT](LICENSE).
