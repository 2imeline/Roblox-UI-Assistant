# The `.rblxui` format (rblxui/1.0)

A `.rblxui` file is JSON with a custom extension. It carries one Roblox `ScreenGui`: the instance tree,
every property as a Lua literal, the working Luau scripts, and a flat command-bar script that rebuilds
it in Studio. Any Claude session, the builder app and Roblox Studio can use it without conversion.

JSON Schema: [`rblxui.schema.json`](rblxui.schema.json). Example: [`examples/MainHUD.rblxui`](../examples/MainHUD.rblxui).

## Top level

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `"rblxui/1.0"`. Readers accept any `rblxui/1.x` and warn on other versions. |
| `instructions` | recommended | Plain-English notes for whoever opens the file next (see [below](#the-instructions-field)). |
| `screenGui` | yes | The root component. Its `class` is always `ScreenGui` and may be omitted. |
| `lua` | recommended | The flat Studio command-bar script, generated from `screenGui`. |

Unknown top-level fields are preserved by the builder, so you can add your own (for example `"theme"`).

## Components

```json
{
  "class": "TextButton",
  "name": "PlayButton",
  "properties": { "Size": "UDim2.new(0, 200, 0, 50)", "Text": "\"Play\"", "Font": "Enum.Font.GothamBold" },
  "attributes": { "Price": "25" },
  "children": [ { "class": "UICorner", "name": "UICorner", "properties": { "CornerRadius": "UDim.new(0, 12)" } } ],
  "scripts": [ { "name": "PlayHandler", "type": "LocalScript", "source": "local button = script.Parent\n..." } ]
}
```

- `class`: the Roblox ClassName. Unknown classes are kept but not rendered.
- `name`: the instance Name. Names do not have to be unique, but scripts find things by name, so keep them stable.
- `children`: nested instances in Explorer order. The tree mirrors Explorer exactly (ScreenGui > Frame > TextButton > UICorner).
- `scripts`: `LocalScript`, `Script` or `ModuleScript` instances parented to this component, after its `children`.
  `source` is complete Luau. `enabled: false` disables a script.
- `properties` and `attributes`: see the next section. `Name`, `Parent` and `ClassName` are never properties here.

## Property values are Lua literals

Every value is a JSON string holding the expression you would write in Luau. Bare JSON numbers and
booleans are accepted as shorthand. Writers emit strings.

| Type | Literal |
|---|---|
| string | `"\"Play\""` (a Lua string, quotes included). For `Text`, `Image`, `PlaceholderText` and other string properties, a value that is not a valid literal is read as plain text, with a warning. |
| number | `"24"`, `"0.5"`, `"-100"`, `"math.huge"`, `"1/3"` |
| boolean | `"true"`, `"false"` |
| UDim2 | `UDim2.new(xs, xo, ys, yo)`, `UDim2.fromScale(x, y)`, `UDim2.fromOffset(x, y)`, and `+`/`-` between UDim2s |
| UDim | `UDim.new(scale, offset)` |
| Vector2 / Vector3 | `Vector2.new(x, y)`, `Vector2.zero`, `Vector2.one`, `Vector3.new(x, y, z)` |
| Color3 | `Color3.fromRGB(r, g, b)`, `Color3.new(r, g, b)`, `Color3.fromHex("#ff8800")`, `Color3.fromHSV(h, s, v)` |
| EnumItem | `Enum.Font.GothamBold`, `Enum.TextXAlignment.Left`, ... |
| Font | `Font.new("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Bold, Enum.FontStyle.Normal)`, `Font.fromName("Roboto")`, `Font.fromEnum(Enum.Font.Arcade)` |
| ColorSequence | `ColorSequence.new(c)`, `ColorSequence.new(c0, c1)`, `ColorSequence.new({ColorSequenceKeypoint.new(0, c), ...})` |
| NumberSequence | `NumberSequence.new(n)`, `NumberSequence.new(n0, n1)`, `NumberSequence.new({NumberSequenceKeypoint.new(t, v[, e]), ...})` |
| NumberRange / Rect | `NumberRange.new(min, max)`, `Rect.new(x0, y0, x1, y1)` |

Only these constructors and literals are accepted. Function calls, variables and comments are rejected,
so a file can never smuggle code into the generated Studio script. Writers re-serialize values in a
canonical form (`UDim2.fromScale(0.5, 0.5)` is written back as `UDim2.new(0.5, 0, 0.5, 0)`).

UDim offsets are integers in Roblox and are rounded. `Font` (the legacy enum) is stored as the
equivalent `FontFace`.

**Defaults:** an omitted property keeps its `Instance.new()` default. Roblox has changed some defaults
over time (border, colours, text size), so always write the visual properties you care about. The
exporters always write `BackgroundColor3`, `BorderSizePixel` and `Size`, plus `FontFace`, `Text`, `TextColor3`
and `TextSize` for text objects, so Studio matches the builder either way.

## The `lua` field

The flat script you paste into Studio's command bar (View > Command Bar). It builds the whole tree under
`StarterGui` and sets each script's `Source`. It is derived from `screenGui`; the builder regenerates it on
every save and `export_lua`. Its shape:

```lua
local n = {}
local function make(i, class, parent, props)
	local o = Instance.new(class)
	for k, v in props do o[k] = v end
	if props.CanvasPosition then o.CanvasPosition = props.CanvasPosition end
	n[i] = o
	if parent then o.Parent = n[parent] end
end
make(1, "ScreenGui", nil, { Name = "MainHUD", ResetOnSpawn = false })
make(2, "TextButton", 1, { Name = "PlayButton", Size = UDim2.new(0, 200, 0, 50), Text = "Play" })
make(3, "LocalScript", 2, { Name = "PlayHandler", Source = [==[
local button = script.Parent
]==] })
n[1].Parent = game:GetService("StarterGui")
```

To regenerate by hand: walk the tree depth-first; for each component emit one `make(index, class, parentIndex, { Name = ..., <property> = <literal>, ... })`
with the literals copied verbatim, then `n[index]:SetAttribute(name, literal)` for each attribute; scripts
become `make` calls with `Source = [==[\n<source>]==]` (add `=` signs until the closing bracket cannot
appear in the source). Parent the root to `StarterGui` last.

The builder also exports `.rbxmx` (a Roblox XML model you can drag into Studio) with the same content.
Attributes of type string, bool, number, UDim, UDim2, Color3, Vector2, Vector3, NumberRange and Rect are
included in `.rbxmx`; all types are included in the Lua.

## The `instructions` field

Every file should carry this text (the builder writes it). It is what lets a fresh Claude session pick the
file up cold:

> This is a .rblxui file (schema rblxui/1.0): one Roblox ScreenGui stored as JSON, with its working Luau.
> `screenGui` is the instance tree, in Explorer order. Every node has `class` (Roblox ClassName; the root is always ScreenGui), `name`, and optional `properties`, `attributes`, `children` and `scripts`.
> `properties` maps a Roblox property name to a Lua literal expression stored as a JSON string, written exactly as you would assign it in Luau: "UDim2.new(0.5, -100, 0.8, 0)", "Color3.fromRGB(30, 30, 40)", "Enum.Font.GothamBold", "Font.new(\"rbxasset://fonts/families/GothamSSm.json\", Enum.FontWeight.Bold, Enum.FontStyle.Normal)", "0.25", "true", and strings with their quotes: "\"Play\"". Omitted properties keep their Instance.new() defaults. `attributes` uses the same literal format.
> `scripts` lists LocalScript / Script / ModuleScript instances parented to that node; `source` is complete, working Luau. UI behaviour (buttons, menus, tabs, tweens, hover effects) lives in these scripts.
> `lua` is the flat, ready-to-paste Studio command-bar script that rebuilds this ScreenGui under StarterGui. It is derived from the tree: if you change the tree, regenerate `lua` by walking the tree depth-first and, for each node, emitting Instance.new(class), one assignment per property using the literal verbatim, then setting Parent; for each script, create it, set Source to its `source` in a long string, then set Parent.
> When editing: keep `schema` and `instructions` as they are, keep names stable so scripts keep finding their targets, and return the whole file.

## Layout of the file

Writers put each component's own fields on one line and nest `children` and `scripts` below it, so a
diff shows one line per changed component. Any valid JSON is accepted on read.

## Versioning

`rblxui/1.x` changes are additive: readers ignore what they do not know and keep unknown top-level
fields. A breaking change would be `rblxui/2.0`.
