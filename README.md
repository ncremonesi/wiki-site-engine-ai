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

