# UI translations

English strings in `src/locales/en.json` are the source of truth. Reviewed locale resources live in `src/locales/<locale>.json`; generated translations fill missing entries in `src/generatedTranslations.ts`. The app imports both statically, so language changes do not make network requests and work offline. Edit the English source and run the generator to create translations for new or changed strings.

To see how many strings are missing without contacting a provider:

```sh
node scripts/generate-translations.mjs --dry-run
```

To generate the missing strings with an OpenAI-compatible chat completions endpoint:

```sh
TRANSLATION_API_KEY=... npm run translations:generate
```

Optional environment variables:

- `TRANSLATION_API_URL`: chat completions URL (defaults to OpenAI's `/v1/chat/completions`)
- `TRANSLATION_MODEL`: model name (defaults to `gpt-4o-mini`)
- `OPENAI_API_KEY`: accepted as an alternative to `TRANSLATION_API_KEY`

The generator preserves `{placeholders}`, caches source and translated text in `src/translation-cache.json`, and writes the bundled fallback to `src/generatedTranslations.ts`. Review generated strings before shipping. Add or edit reviewed translations in the locale JSON files to override generated fallback strings.
