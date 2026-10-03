// Safari exposes the WebExtension API as `browser`; Chrome as `chrome`.
const ext = globalThis.browser ?? globalThis.chrome;

// Toolbar button and Alt+R both ask the page's drawer to toggle.
function toggle(tab) {
  if (!tab?.id) return;
  ext.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {
    // Not a TI Assistant tab, so there's no drawer to talk to.
  });
}

ext.action.onClicked.addListener(toggle);

ext.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-drawer") return;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});
