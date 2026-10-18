/** User-facing launchers. Installed once into a world, then dragged to the GM hotbar. */
export const MACRO_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'configure',
    name: 'LegendKeeper | Configure',
    command: 'game.modules.get("foundryvtt-legendkeeper")?.api?.configure();'
  }),
  Object.freeze({
    id: 'browse',
    name: 'LegendKeeper | Browse',
    command: 'game.modules.get("foundryvtt-legendkeeper")?.api?.open();'
  })
]);
