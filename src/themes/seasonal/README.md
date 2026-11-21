# Seasonal themes

The seasonal system is intentionally code-defined: users can switch themes from
**Settings → Theme → Seasonal theme**, but adding or changing a theme is a
developer task. That keeps the payload small and stops arbitrary CSS/JS from
being injected at runtime.

## Current themes

| Theme        | When it runs     | Decorations                         |
| ------------ | ---------------- | ----------------------------------- |
| Autumn       | Sep 1 – Nov 30   | Falling leaves, golden motes        |
| Halloween    | Oct 1 – Oct 31   | Fog, bats, embers, spider webs      |
| Thanksgiving | Nov 1 – Nov 30   | Leaves, candlelight, wheat          |
| Christmas    | Dec 1 – Jan 6    | Snow, twinkles, hanging ornaments   |

Overlaps are resolved by `priority` in the theme config — Thanksgiving (30)
wins over Autumn (10) for November; Halloween (30) wins over Autumn in October.

`Always on` uses the theme picked in Settings. `Automatic` ignores the picker
and resolves the in-season theme from today's date.

## Per-theme palettes

Each theme ships a dark and a light surface. Under **Settings → Theme → Theme
palettes**, users can pick **Auto** (follow the app appearance), **Light**
(cream/frosted) or **Dark** (deep) for each theme independently. Defaults live
in `DEFAULT_UI_SETTINGS.seasonalPalettes`; existing users keep any value they
have already chosen, and new themes inherit future defaults automatically.

## Add a theme

1. Create `src/themes/seasonal/<id>/` with:
   - `config.ts` — id, label, description, date range and priority.
   - `theme.css` — the `!important` palette overrides and effect colours.
   - `<Name>Effects.tsx` — ambient glow, frame and decorations.
2. Register the config in `src/themes/registry.ts`.
3. Import the stylesheet in `src/main.tsx` (after `shared/effects.css`).
4. Add a `case` to `src/components/seasonal/SeasonalEffects.tsx`.
5. Reuse the shared primitives where possible:
   - `FallingLeaves` — leaves for autumn/Thanksgiving.
   - `RisingMotes` — embers or golden dust.
   - `shared/effects.css` — snow, twinkles, ornaments, bats, fog, motes,
     webs, wheat, reduced-motion handling.

The theme palette is written with `!important` because `applyUiSettings()`
places the normal theme variables inline on `<html>`. Seasonal CSS is loaded
after the base styles and only wins while `data-seasonal-theme` is present.
