# Wiki Site Engine

Motore condiviso per generare siti statici di consultazione da wiki Markdown con
frontmatter YAML e wikilink Obsidian.

Il motore contiene soltanto le funzioni comuni. Tassonomia, branding, filtri e
funzioni di dominio restano configurazioni o estensioni dei singoli progetti.

## Obiettivi della versione 1

- scansione configurabile delle pagine Markdown;
- parsing del frontmatter;
- risoluzione di wikilink, backlink e collegamenti non risolti;
- esclusione delle pagine con `pubblicazione: escluso`;
- validazione di campi obbligatori e valori ammessi;
- payload JSON stabile consumabile da siti completamente statici;
- test automatici indipendenti dai quattro vault reali.

## Uso previsto

```powershell
python -m wiki_site_engine build --config site-engine.json
```

Il collegamento ai progetti reali verrà introdotto soltanto dopo il test pilota su
`crescita-personale-ai`.


## Data di aggiornamento delle pagine

Il campo `updated` di ogni pagina (usato da «Aggiornate di recente» e dall'ordinamento «Più recenti») è la data **più recente** tra il campo di frontmatter `updated_field` (default `aggiornato`) e l'ultima modifica registrata da git: data dell'ultimo commit che ha toccato il file, oppure data del file se ha modifiche non committate. Così una nota riscritta senza ritoccare `aggiornato` sale comunque tra le più recenti, in modo uguale su tutti i siti.

Per usare solo il frontmatter, impostare `"updated_from_git": false` nel file di configurazione. Se il vault non è un repository git, vale solo il frontmatter.
