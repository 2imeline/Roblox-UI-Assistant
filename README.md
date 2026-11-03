# Roblox UI Builder

Claude builds Roblox UI, you see it and play with it in a visual builder, then you push it into Roblox Studio.
All of it travels in one file format, `.rblxui`, which bundles layout, styling and working Luau.

```
Claude ──MCP (stdio)──> mcp/server.mjs ──WebSocket (localhost)──> Builder app ──export──> Roblox Studio
                       preview_ui / get_layout / export_lua / list_components       .lua (command bar) or .rbxmx
```

| Piece | Where | What it is |
|---|---|---|
| `.rblxui` format | [`format/SPEC.md`](format/SPEC.md), [`format/rblxui.schema.json`](format/rblxui.schema.json) | JSON: the ScreenGui tree, properties as Lua literals, scripts, and a flat Studio script |
| Builder app | [`app/`](app) | Tauri desktop app (Windows .exe, macOS .app). Canvas, drag/resize, Explorer, Properties, device preview, Play mode that runs the UI's Luau |
| MCP server | [`mcp/`](mcp) | Lets Claude push UI to the canvas and read your edits back |
| Claude skill | [`skill/rblxui/SKILL.md`](skill/rblxui/SKILL.md) | Teaches Claude to read and write `.rblxui` and use the tools |
| Example | [`examples/MainHUD.rblxui`](examples/MainHUD.rblxui) | A full HUD: currency, camera toggle, play menu with tabs, market grid, settings sliders |

## Install

### 1. The builder app

Download it from [the latest release](https://github.com/2imeline/Roblox-UI-Assistant/releases/latest):
`Roblox UI Builder_x.y.z_x64-setup.exe` for Windows, `Roblox UI Builder_x.y.z_universal.dmg` for macOS.

You only download it once. **Check for updates** in the toolbar installs newer releases and restarts the app.
Updates are signed, and the app refuses any update that is not.

The builds are not code-signed yet. On macOS, right-click the app and choose **Open** the first time.
On Windows, choose **More info > Run anyway** in SmartScreen.

To build it yourself (Node 22+ and Rust stable; on Linux also the [Tauri system packages](https://v2.tauri.app/start/prerequisites/)):

```bash
cd app
npm install
npm run tauri build
```

The browser version needs no Rust. It has everything except native file dialogs, and the canvas shows
`rbxassetid` images only in the desktop app:

```bash
cd app
npm install
npm run dev
```

Then open http://localhost:1420.

### 2. The MCP server

```bash
cd mcp
npm install
```

**Claude desktop app:** add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), with your own path:

```json
{
  "mcpServers": {
    "rblxui": {
      "command": "node",
      "args": ["/absolute/path/to/Roblox-UI-Assistant/mcp/server.mjs"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add rblxui -- node /absolute/path/to/Roblox-UI-Assistant/mcp/server.mjs
```

The builder connects to the server by itself; the toolbar shows **Claude connected**. If the app is
installed in the default location, `preview_ui` starts it when it is not running. Set `RBLXUI_BUILDER`
to the app path if you installed it elsewhere, and `RBLXUI_PORT` (default 47811) to change the port.
Several Claude sessions can use the builder at once.

### 3. The skill

Claude Code: copy `skill/rblxui` to `~/.claude/skills/rblxui` (or `.claude/skills/rblxui` in your game's repo).
claude.ai and the desktop app: zip the `skill/rblxui` folder and upload it under Settings > Capabilities > Skills.

## Workflow

1. Ask Claude: "build me a shop UI with 6 items, dark theme".
2. Claude writes the `.rblxui` and calls `preview_ui`; it opens on the canvas.
3. Press **F5** to play it: buttons, tabs, tweens, sliders and text boxes run their real scripts. Press F5 again to stop.
4. Drag, resize, re-parent in the Explorer, edit properties. Tell Claude "I moved some things, update it".
5. Claude calls `get_layout`, makes its changes on top of yours, and pushes again.
6. Export: **Export .lua** (paste into Studio's command bar, View > Command Bar) or **Export .rbxmx** (drag into Studio).
   The ScreenGui lands in StarterGui with its scripts.

Without MCP, Claude hands you the `.rblxui` file; open it in the builder (or drop it on the window), edit,
save, and attach it again later. Any Claude session can continue from the file alone.

## Using the builder

| | |
|---|---|
| Click | Select at the current level (first click selects the top-level component) |
| Double-click | Select one level deeper |
| Alt/Ctrl+click | Select the innermost object under the pointer |
| Drag / handles | Move / resize. Scale or offset is kept, whichever the property already uses. Inside a UIListLayout/UIGridLayout, dragging reorders (LayoutOrder) |
| Arrow keys | Nudge 1px (Shift: 10px) |
| Delete, Ctrl+D | Delete, duplicate |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+O, Ctrl+S, Ctrl+Shift+S | Open, save, save as |
| F5 | Play / stop |

The palette adds new components (click to add to the selection, or drag onto the canvas). **In this file**
lists every component; drag one onto the canvas to duplicate it. The device menu switches between desktop,
laptop, tablet and phone sizes, with the Roblox topbar and phone safe areas. The Output panel shows
`print`, `warn`, script errors with their line numbers, and warnings from opening files.

## Play mode: what runs

Scripts run in real Luau (WebAssembly, same language as Roblox) against a mock Roblox client: the
instance API, events and signals, `TweenService`, `UserInputService`, `ContextActionService`, `RunService`,
`task`, attributes, `require` for ModuleScripts in the file, `HttpService` JSON, `TextService`, and the
Roblox datatypes. Anything outside the UI (remotes, server modules, workspace parts) becomes a stand-in
that accepts calls, so UI code keeps working; `FireServer` calls are logged. Runaway loops stop after
5 seconds with Roblox's "Script timeout" error instead of freezing the app. Changes scripts make while
playing are thrown away when you stop, like in Studio.

While playing, the Explorer shows the running game. Click **Inspect** (or Alt+click the canvas) to select
anything on screen, including UI your scripts build at runtime. The Properties panel then edits it live and
shows which script line created it, which helps when a game builds its UI in code. Live edits are discarded
on Stop.

## Fidelity notes

The canvas reproduces Roblox's layout rules (scale/offset, AnchorPoint, SizeConstraint, AutomaticSize,
UIPadding, UIListLayout including Wraps, UIGridLayout, UIAspectRatioConstraint, UISizeConstraint, UIScale,
ScrollingFrame canvases) and paints UICorner, UIStroke, UIGradient, borders, transparency, rotation,
ClipsDescendants, CanvasGroup, TextScaled, RichText, text stroke, truncation, MaxVisibleGraphemes, and
images with Fit/Crop/Tile/Slice, ImageRect and ImageColor3. Known differences:

- **Fonts:** Gotham and Builder Sans are proprietary, so the builder uses Montserrat and Inter. Bodoni,
  Garamond, Highway and SciFi fall back to generic serif/sans. The other Roblox families are the real
  open-source fonts.
- **Images:** with a Roblox Open Cloud API key (toolbar **Image key**: create one at create.roblox.com >
  Open Cloud > API Keys with the `legacy-asset:manage` permission and accepted IP `0.0.0.0/0`), the desktop
  app downloads your images at full size, private ones included. Roblox only accepts keys made for a user
  account, so group-owned images need a key from a group member who can access them. Without a key,
  images come from Roblox's public thumbnail service: only public images show, capped at 420×420, so
  9-slice margins are approximate. Unresolvable images show a red hatch in edit mode.
- **Not rendered:** UIFlexItem/flex alignment, UIPageLayout, UITableLayout, ViewportFrame and VideoFrame
  content, BillboardGui/SurfaceGui. ZIndexBehavior Global is drawn like Sibling.
- AutoButtonColor hover/press shading is an approximation.

## Development

```bash
cd app
npm test
```

Runs the format, layout and Luau runtime tests, including a play-through of the example HUD.

```bash
cd app
npm run typecheck
```

```bash
cd mcp
npm test
```

```
app/src/core      format: datatypes, Lua literal parser, classes/defaults, .rblxui IO, layout, Lua and .rbxmx export
app/src/render    DOM renderer, fonts, rich text, text measurement, image resolution
app/src/runtime   Luau runtime: prelude.luau (mock Roblox API) + runtime.ts (JS host, input, tweens)
app/src/editor    React panels, canvas interaction, undo store, file IO, MCP bridge
app/src-tauri     desktop shell: file dialogs, file association, single instance
mcp/server.mjs    MCP stdio server + localhost WebSocket for the builder
```

### Publishing a release

1. Raise `version` in `app/src-tauri/tauri.conf.json` (and to match, in `app/package.json` and `app/src-tauri/Cargo.toml`).
2. Commit, then push a tag with that version (`git tag v0.2.0 && git push origin v0.2.0`), or run the
   "Test and build" workflow from the Actions tab with **release** ticked; it creates the tag itself.

CI builds Windows and macOS, signs the update packages, and publishes the release with `latest.json`, which
installed apps read when you click Check for updates. Signing needs the repository secret
`TAURI_SIGNING_PRIVATE_KEY` (from `npx tauri signer generate`; its public key is in `tauri.conf.json`). Keep that
key safe: if it is lost, installed apps cannot update and everyone has to download the app again.

`UPDATE_EXAMPLE=1 npm test` in `app/` rewrites `examples/MainHUD.rblxui` in canonical form after you edit it.

### Design choices that differ from the original plan

- The Luau runtime runs inside the app's webview (Luau compiled to WebAssembly), not in the Rust backend.
  Scripts touch UI properties constantly, and keeping the VM next to the instance tree avoids a
  process round trip per property access. It also lets the browser version play UIs.
- The MCP server hosts the localhost WebSocket and the builder connects to it, the reverse of the plan.
  This needs no networking code in the app, works in the browser version, and lets several Claude
  sessions share one builder.
- The plan's "does not run Lua scripts" note conflicts with its Phase 3. The builder follows Phase 3:
  editing is static and scripts run in Play mode.

### Security

The WebSocket only listens on 127.0.0.1 and refuses connections from web pages (it checks the Origin
header), so a website cannot read or push your UI. Property values are parsed as literals only, so
exported Studio scripts never contain code that came from a property. Rich text is rendered from a
tag whitelist into text nodes; file contents never become HTML.
