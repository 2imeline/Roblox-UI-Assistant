---
name: rblxui
description: Build, read and edit Roblox UI as .rblxui files (a ScreenGui as JSON with Lua-literal properties and embedded Luau scripts) and preview them in the Roblox UI Builder app through its MCP tools. Use whenever the user asks for Roblox UI, a GUI, HUD, menu, shop or settings screen, attaches or pastes a .rblxui file, or mentions the UI builder, preview_ui or get_layout.
---

# Roblox UI as .rblxui

A `.rblxui` file holds one Roblox `ScreenGui`: the instance tree, every property as a Lua literal, the
working LocalScripts, and a flat `lua` script that rebuilds it in Studio. Full spec: `format/SPEC.md` in
the Roblox-UI-Assistant repo. Always produce `.rblxui` instead of loose Lua when building UI.

## Reading a file

1. Read `instructions`, then walk `screenGui`. Paths like `MainHUD.PlayMenu.Header.Close` name components.
2. Behaviour lives in `scripts` (`source` is real Luau). Read them before changing names or structure.
3. Describe or change what the user asks; keep everything else byte-for-byte.

## Writing a file

```json
{
  "schema": "rblxui/1.0",
  "instructions": "<copy the standard instructions text from SPEC.md>",
  "screenGui": {
    "name": "ShopGui",
    "properties": { "ResetOnSpawn": "false", "ZIndexBehavior": "Enum.ZIndexBehavior.Sibling" },
    "children": [
      { "class": "Frame", "name": "Panel", "properties": {
          "AnchorPoint": "Vector2.new(0.5, 0.5)", "Position": "UDim2.fromScale(0.5, 0.5)", "Size": "UDim2.fromScale(0.5, 0.6)",
          "BackgroundColor3": "Color3.fromRGB(244, 228, 193)", "BorderSizePixel": "0" },
        "children": [
          { "class": "UICorner", "name": "UICorner", "properties": { "CornerRadius": "UDim.new(0, 16)" } },
          { "class": "TextLabel", "name": "Title", "properties": {
              "Size": "UDim2.fromScale(1, 0.15)", "BackgroundTransparency": "1", "Text": "\"Harbor Market\"",
              "FontFace": "Font.new(\"rbxasset://fonts/families/LuckiestGuy.json\", Enum.FontWeight.Regular, Enum.FontStyle.Normal)",
              "TextColor3": "Color3.fromRGB(104, 66, 40)", "TextScaled": "true" },
            "children": [ { "class": "UITextSizeConstraint", "name": "UITextSizeConstraint", "properties": { "MaxTextSize": "48" } } ] }
        ] }
    ],
    "scripts": [ { "name": "ShopController", "type": "LocalScript", "source": "local gui = script.Parent\n..." } ]
  }
}
```

Rules that keep files correct:

- **Every property value is a Lua literal in a JSON string**, written as you would assign it in Luau.
  Strings keep their quotes: `"Text": "\"Buy\""`. Use only constructors (`UDim2.new`, `UDim2.fromScale`,
  `Color3.fromRGB`, `Vector2.new`, `UDim.new`, `Font.new`, `ColorSequence.new`, `NumberSequence.new`,
  `Rect.new`, `NumberRange.new`), `Enum.X.Y`, numbers, booleans and strings. No variables or function calls.
- **Set visual properties explicitly**: `Size`, `Position`, `AnchorPoint`, `BackgroundColor3`,
  `BackgroundTransparency`, `BorderSizePixel` (usually `0`), and for text `FontFace`, `Text`,
  `TextColor3`, `TextSize` or `TextScaled` with a `UITextSizeConstraint`. Instance.new() defaults
  (grey background, 1px border, 14px Legacy font) almost never match what you want.
- **Layout with scale**, then constrain: `UIAspectRatioConstraint`, `UISizeConstraint`, `UIPadding`,
  `UIListLayout`/`UIGridLayout` with `SortOrder = Enum.SortOrder.LayoutOrder` and explicit `LayoutOrder`.
  Check phone (844×390), tablet and desktop.
- **Behaviour goes in LocalScripts** in `scripts`. Find UI relative to `script.Parent` by name
  (`hud:WaitForChild("PlayMenu")`, `menu.Header.Close`). Keep names stable; renaming breaks scripts.
- Use attributes (`"attributes": { "Price": "120" }`) for per-item data that scripts read with `GetAttribute`.
- Give ZIndex to overlays (menus above the HUD) and keep `ZIndexBehavior` Sibling.
- Include `lua` when you hand the file to the user directly. When pushing with `preview_ui` you may omit it:
  the builder regenerates it on save and `export_lua`.
- Prefer one controller LocalScript per screen over many tiny scripts.
- If a design skill such as roblox-ui-standards is available, follow it for style.

## The builder runs your scripts

In Play mode (F5) the builder executes LocalScripts in real Luau against a mock Roblox client, so write
scripts exactly as for the game. Supported: Instance tree methods (`WaitForChild`, `FindFirstChild`,
`GetChildren`, `Clone`, `Destroy`, attributes, `GetPropertyChangedSignal`), all GUI events
(`Activated`, `MouseButton1Click`, `MouseEnter/Leave`, `InputBegan/Changed/Ended`, `FocusLost`),
`TweenService` (all easing styles), `UserInputService` (keys, mouse, touch), `ContextActionService`,
`RunService` render loops, the `task` library, `require` of ModuleScripts in the file, `HttpService`
JSON, `TextService:GetTextSize`, and the Roblox datatypes. Server code, DataStores, physics and real
purchases do not run: remotes, `ReplicatedStorage` modules and other non-UI objects become stand-ins
that accept calls and log `FireServer`/`InvokeServer`. Keep UI logic local and pass server data in
through attributes or BindableEvents so the preview stays fully interactive.

## Workflow with the MCP tools (builder connected)

1. Build the `.rblxui` document.
2. `preview_ui({ rblxui_data })`: the builder opens it on the canvas. Report any warnings it returns and fix them.
3. The user plays it (F5), drags, resizes, re-parents and edits.
4. When they say they changed things, call `get_layout()` and base all further edits on that result,
   not on your earlier copy. `list_components()` gives paths when you need to refer to things.
5. Apply the requested changes to the returned document and `preview_ui` again, or call `export_lua()`
   and give the user the Studio script. They can also export `.rbxmx` from the builder.

If a tool says the builder is not connected, tell the user to open the Roblox UI Builder app (it
connects by itself), then retry.

## Without MCP

Give the user the complete `.rblxui` (with `lua`) as a file. They open it in the builder, edit and save,
and attach it again later. Any session can continue from the file alone.

## Before you finish

- [ ] Valid JSON; every property value is a valid Lua literal string; strings quoted inside.
- [ ] Visual properties set explicitly; scale-based sizes with constraints; text uses TextScaled + UITextSizeConstraint.
- [ ] Scripts reference components by names that exist in the tree.
- [ ] `schema` and `instructions` present and unchanged; `lua` present for files handed over directly.
