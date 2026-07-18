'use strict';

/**
 * Decide whether a helper key event satisfies the configured hotkey.
 *
 * The helper reports {vk, down, held} where `held` is the REAL physical state
 * of every watched key at event time. A hotkey {vk, mods} matches when its
 * trigger key goes DOWN while every modifier in `mods` is physically held.
 * Pure function; tested in test/hotkey-match-test.js.
 */

/**
 * @param {{vk:number, down:boolean, held:number[]|null}} ev
 * @param {{vk:number, mods:number[]}} hotkey
 * @returns {boolean}
 */
function matches(ev, hotkey) {
  if (!ev || !hotkey) return false;
  if (!ev.down) return false;
  if ((ev.vk | 0) !== (hotkey.vk | 0)) return false;
  const mods = Array.isArray(hotkey.mods) ? hotkey.mods : [];
  if (!mods.length) return true;
  const held = Array.isArray(ev.held) ? ev.held : [];
  for (let i = 0; i < mods.length; i++) {
    if (held.indexOf(mods[i] | 0) === -1) return false;
  }
  return true;
}

/** The full VK set the helper must watch for a hotkey (trigger + mods). */
function watchSet(hotkey, extra) {
  const out = [];
  function add(vk) {
    vk = vk | 0;
    if (vk > 0 && out.indexOf(vk) === -1) out.push(vk);
  }
  if (hotkey) {
    add(hotkey.vk);
    const mods = Array.isArray(hotkey.mods) ? hotkey.mods : [];
    for (let i = 0; i < mods.length; i++) add(mods[i]);
  }
  if (Array.isArray(extra)) {
    for (let j = 0; j < extra.length; j++) add(extra[j]);
  }
  return out;
}

module.exports = { matches, watchSet };
