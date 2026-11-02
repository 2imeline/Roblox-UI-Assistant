// Class hierarchy, Instance.new() defaults, and events for the Roblox classes the builder understands.
// Unknown classes are allowed: they behave as plain Instances that store any property.
import { parseLiteral } from './literal';
import type { Value } from './values';

interface ClassSpec { base?: string; props?: Record<string, string>; events?: string[]; noCreate?: boolean }

const GUI_OBJECT_PROPS: Record<string, string> = {
  Active: 'false', AnchorPoint: 'Vector2.new(0, 0)', AutomaticSize: 'Enum.AutomaticSize.None',
  BackgroundColor3: 'Color3.fromRGB(163, 162, 165)', BackgroundTransparency: '0',
  BorderColor3: 'Color3.fromRGB(27, 42, 53)', BorderMode: 'Enum.BorderMode.Outline', BorderSizePixel: '1',
  ClipsDescendants: 'false', Interactable: 'true', LayoutOrder: '0', Position: 'UDim2.new(0, 0, 0, 0)', Rotation: '0',
  Selectable: 'false', Size: 'UDim2.new(0, 0, 0, 0)', SizeConstraint: 'Enum.SizeConstraint.RelativeXY',
  Visible: 'true', ZIndex: '1',
};
const TEXT_PROPS = (text: string): Record<string, string> => ({
  FontFace: 'Font.new("rbxasset://fonts/families/LegacyArial.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal)',
  LineHeight: '1', MaxVisibleGraphemes: '-1', RichText: 'false', Text: JSON.stringify(text),
  TextColor3: 'Color3.fromRGB(27, 42, 53)', TextDirection: 'Enum.TextDirection.Auto', TextScaled: 'false', TextSize: '14',
  TextStrokeColor3: 'Color3.fromRGB(0, 0, 0)', TextStrokeTransparency: '1', TextTransparency: '0',
  TextTruncate: 'Enum.TextTruncate.None', TextWrapped: 'false',
  TextXAlignment: 'Enum.TextXAlignment.Center', TextYAlignment: 'Enum.TextYAlignment.Center',
});
const IMAGE_PROPS: Record<string, string> = {
  Image: '""', ImageColor3: 'Color3.fromRGB(255, 255, 255)', ImageRectOffset: 'Vector2.new(0, 0)',
  ImageRectSize: 'Vector2.new(0, 0)', ImageTransparency: '0', ResampleMode: 'Enum.ResamplerMode.Default',
  ScaleType: 'Enum.ScaleType.Stretch', SliceCenter: 'Rect.new(0, 0, 0, 0)', SliceScale: '1', TileSize: 'UDim2.new(1, 0, 1, 0)',
};
const BUTTON_PROPS: Record<string, string> = { AutoButtonColor: 'true', Modal: 'false', Selected: 'false', Style: 'Enum.ButtonStyle.Custom' };
const LAYOUT_PROPS: Record<string, string> = {
  FillDirection: 'Enum.FillDirection.Vertical', HorizontalAlignment: 'Enum.HorizontalAlignment.Left',
  SortOrder: 'Enum.SortOrder.LayoutOrder', VerticalAlignment: 'Enum.VerticalAlignment.Top',
};

const SPECS: Record<string, ClassSpec> = {
  Instance: { props: { Archivable: 'true' }, events: ['Changed', 'ChildAdded', 'ChildRemoved', 'DescendantAdded', 'DescendantRemoving', 'AncestryChanged', 'Destroying', 'AttributeChanged'], noCreate: true },
  GuiBase2d: { base: 'Instance', props: { AutoLocalize: 'true' }, noCreate: true },
  GuiObject: {
    base: 'GuiBase2d', props: GUI_OBJECT_PROPS, noCreate: true,
    events: ['MouseEnter', 'MouseLeave', 'MouseMoved', 'MouseWheelForward', 'MouseWheelBackward', 'InputBegan', 'InputChanged', 'InputEnded', 'TouchTap', 'TouchLongPress', 'TouchPan', 'SelectionGained', 'SelectionLost'],
  },
  Frame: { base: 'GuiObject', props: { Style: 'Enum.FrameStyle.Custom' } },
  CanvasGroup: { base: 'GuiObject', props: { GroupColor3: 'Color3.fromRGB(255, 255, 255)', GroupTransparency: '0' } },
  ScrollingFrame: {
    base: 'GuiObject', props: {
      AutomaticCanvasSize: 'Enum.AutomaticSize.None', CanvasPosition: 'Vector2.new(0, 0)', CanvasSize: 'UDim2.new(0, 0, 2, 0)',
      ElasticBehavior: 'Enum.ElasticBehavior.WhenScrollable', HorizontalScrollBarInset: 'Enum.ScrollBarInset.None',
      ScrollBarImageColor3: 'Color3.fromRGB(255, 255, 255)', ScrollBarImageTransparency: '0', ScrollBarThickness: '12',
      ScrollingDirection: 'Enum.ScrollingDirection.XY', ScrollingEnabled: 'true', VerticalScrollBarInset: 'Enum.ScrollBarInset.None',
      VerticalScrollBarPosition: 'Enum.VerticalScrollBarPosition.Right',
    },
  },
  TextLabel: { base: 'GuiObject', props: TEXT_PROPS('Label') },
  GuiButton: { base: 'GuiObject', props: BUTTON_PROPS, noCreate: true, events: ['Activated', 'MouseButton1Click', 'MouseButton1Down', 'MouseButton1Up', 'MouseButton2Click', 'MouseButton2Down', 'MouseButton2Up'] },
  TextButton: { base: 'GuiButton', props: TEXT_PROPS('Button') },
  ImageButton: { base: 'GuiButton', props: { ...IMAGE_PROPS, HoverImage: '""', PressedImage: '""' } },
  TextBox: {
    base: 'GuiObject', props: {
      ...TEXT_PROPS(''), ClearTextOnFocus: 'true', MultiLine: 'false', PlaceholderColor3: 'Color3.fromRGB(178, 178, 178)',
      PlaceholderText: '""', TextEditable: 'true', CursorPosition: '1',
    }, events: ['FocusLost', 'Focused', 'ReturnPressedFromOnScreenKeyboard'],
  },
  ImageLabel: { base: 'GuiObject', props: IMAGE_PROPS },
  ViewportFrame: { base: 'GuiObject', props: { Ambient: 'Color3.fromRGB(200, 200, 200)', ImageColor3: 'Color3.fromRGB(255, 255, 255)', ImageTransparency: '0' } },
  VideoFrame: { base: 'GuiObject', props: { Video: '""', Looped: 'false', Playing: 'false', Volume: '1' } },
  LayerCollector: { base: 'GuiBase2d', props: { Enabled: 'true', ResetOnSpawn: 'true', ZIndexBehavior: 'Enum.ZIndexBehavior.Sibling' }, noCreate: true },
  ScreenGui: {
    base: 'LayerCollector', props: {
      DisplayOrder: '0', IgnoreGuiInset: 'false', ScreenInsets: 'Enum.ScreenInsets.CoreUISafeInsets', ClipToDeviceSafeArea: 'true',
    },
  },
  UIBase: { base: 'Instance', noCreate: true },
  UIComponent: { base: 'UIBase', noCreate: true },
  UICorner: { base: 'UIComponent', props: { CornerRadius: 'UDim.new(0, 8)' } },
  UIStroke: {
    base: 'UIComponent', props: {
      ApplyStrokeMode: 'Enum.ApplyStrokeMode.Contextual', Color: 'Color3.fromRGB(0, 0, 0)', Enabled: 'true',
      LineJoinMode: 'Enum.LineJoinMode.Round', Thickness: '1', Transparency: '0',
    },
  },
  UIGradient: {
    base: 'UIComponent', props: {
      Color: 'ColorSequence.new(Color3.fromRGB(255, 255, 255))', Enabled: 'true', Offset: 'Vector2.new(0, 0)', Rotation: '0',
      Transparency: 'NumberSequence.new(0)',
    },
  },
  UIPadding: { base: 'UIComponent', props: { PaddingBottom: 'UDim.new(0, 0)', PaddingLeft: 'UDim.new(0, 0)', PaddingRight: 'UDim.new(0, 0)', PaddingTop: 'UDim.new(0, 0)' } },
  UIScale: { base: 'UIComponent', props: { Scale: '1' } },
  UIConstraint: { base: 'UIComponent', noCreate: true },
  UIAspectRatioConstraint: { base: 'UIConstraint', props: { AspectRatio: '1', AspectType: 'Enum.AspectType.FitWithinMaxSize', DominantAxis: 'Enum.DominantAxis.Width' } },
  UISizeConstraint: { base: 'UIConstraint', props: { MaxSize: 'Vector2.new(math.huge, math.huge)', MinSize: 'Vector2.new(0, 0)' } },
  UITextSizeConstraint: { base: 'UIConstraint', props: { MaxTextSize: '100', MinTextSize: '1' } },
  UILayout: { base: 'UIComponent', noCreate: true },
  UIGridStyleLayout: { base: 'UILayout', props: LAYOUT_PROPS, noCreate: true },
  UIListLayout: { base: 'UIGridStyleLayout', props: { Padding: 'UDim.new(0, 0)', Wraps: 'false' } },
  UIGridLayout: {
    base: 'UIGridStyleLayout', props: {
      FillDirection: 'Enum.FillDirection.Horizontal', CellPadding: 'UDim2.new(0, 5, 0, 5)', CellSize: 'UDim2.new(0, 100, 0, 100)',
      FillDirectionMaxCells: '0', StartCorner: 'Enum.StartCorner.TopLeft',
    },
  },
  LuaSourceContainer: { base: 'Instance', props: { Source: '""' }, noCreate: true },
  BaseScript: { base: 'LuaSourceContainer', props: { Enabled: 'true' }, noCreate: true },
  LocalScript: { base: 'BaseScript' },
  Script: { base: 'BaseScript' },
  ModuleScript: { base: 'LuaSourceContainer' },
  Folder: { base: 'Instance' },
  Configuration: { base: 'Instance' },
  ValueBase: { base: 'Instance', noCreate: true },
  StringValue: { base: 'ValueBase', props: { Value: '""' } },
  NumberValue: { base: 'ValueBase', props: { Value: '0' } },
  IntValue: { base: 'ValueBase', props: { Value: '0' } },
  BoolValue: { base: 'ValueBase', props: { Value: 'false' } },
  Color3Value: { base: 'ValueBase', props: { Value: 'Color3.fromRGB(0, 0, 0)' } },
  Vector3Value: { base: 'ValueBase', props: { Value: 'Vector3.new(0, 0, 0)' } },
  ObjectValue: { base: 'ValueBase', props: { Value: 'nil' } },
  BindableEvent: { base: 'Instance', events: ['Event'] },
  BindableFunction: { base: 'Instance' },
  RemoteEvent: { base: 'Instance', events: ['OnClientEvent'] },
  UnreliableRemoteEvent: { base: 'Instance', events: ['OnClientEvent'] },
  RemoteFunction: { base: 'Instance' },
  Sound: {
    base: 'Instance', props: { SoundId: '""', Volume: '0.5', Looped: 'false', Playing: 'false', PlaybackSpeed: '1', TimePosition: '0', IsPlaying: 'false' },
    events: ['Played', 'Ended', 'Stopped', 'Paused', 'Resumed', 'Loaded'],
  },
  Model: { base: 'Instance' },
  Part: { base: 'Instance' },
  Humanoid: {
    base: 'Instance', props: { Health: '100', MaxHealth: '100', WalkSpeed: '16', JumpPower: '50', JumpHeight: '7.2', DisplayName: '""' },
    events: ['HealthChanged', 'Died', 'StateChanged', 'Running', 'Jumping'],
  },
  Camera: { base: 'Instance', props: { FieldOfView: '70', ViewportSize: 'Vector2.new(1920, 1080)', CameraType: 'Enum.CameraType.Custom' } },
  Player: {
    base: 'Instance', props: { UserId: '1', DisplayName: '"Player"', CameraMode: 'Enum.CameraMode.Classic', CameraMaxZoomDistance: '128', CameraMinZoomDistance: '0.5', AccountAge: '365' },
    events: ['CharacterAdded', 'CharacterRemoving', 'Chatted', 'Idled'], noCreate: true,
  },
  PlayerMouse: { base: 'Instance', props: { X: '0', Y: '0', ViewSizeX: '0', ViewSizeY: '0', Icon: '""' }, events: ['Move', 'Button1Down', 'Button1Up', 'Button2Down', 'Button2Up', 'WheelForward', 'WheelBackward', 'Idle'], noCreate: true },
  Tween: { base: 'Instance', props: { PlaybackState: 'Enum.PlaybackState.Begin' }, events: ['Completed'], noCreate: true },
  // Services (created by the runtime; methods live in the Luau prelude)
  DataModel: { base: 'Instance', noCreate: true },
  Players: { base: 'Instance', events: ['PlayerAdded', 'PlayerRemoving'], noCreate: true },
  RunService: { base: 'Instance', events: ['RenderStepped', 'Heartbeat', 'Stepped', 'PreRender', 'PreSimulation', 'PostSimulation'], noCreate: true },
  UserInputService: {
    base: 'Instance', props: { TouchEnabled: 'false', KeyboardEnabled: 'true', MouseEnabled: 'true', GamepadEnabled: 'false', MouseBehavior: 'Enum.MouseBehavior.Default', MouseIconEnabled: 'true', MouseDeltaSensitivity: '1' },
    events: ['InputBegan', 'InputChanged', 'InputEnded', 'TouchStarted', 'TouchMoved', 'TouchEnded', 'TouchTap', 'LastInputTypeChanged', 'WindowFocused', 'WindowFocusReleased', 'TextBoxFocused', 'TextBoxFocusReleased', 'JumpRequest'],
    noCreate: true,
  },
  GuiService: { base: 'Instance', props: { MenuIsOpen: 'false', SelectedObject: 'nil', AutoSelectGuiEnabled: 'true' }, events: ['MenuOpened', 'MenuClosed'], noCreate: true },
  ContextActionService: { base: 'Instance', noCreate: true },
  MarketplaceService: { base: 'Instance', events: ['PromptProductPurchaseFinished', 'PromptGamePassPurchaseFinished', 'PromptPurchaseFinished'], noCreate: true },
};

export interface ClassInfo { name: string; base?: string; defaults: Map<string, Value>; events: string[]; creatable: boolean }

export const CLASSES = new Map<string, ClassInfo>();
for (const [name, s] of Object.entries(SPECS)) {
  const defaults = new Map<string, Value>();
  for (const [k, lit] of Object.entries(s.props ?? {})) defaults.set(k, parseLiteral(lit));
  CLASSES.set(name, { name, base: s.base, defaults, events: s.events ?? [], creatable: !s.noCreate });
}

export function chain(cls: string): ClassInfo[] {
  const out: ClassInfo[] = [];
  for (let c = CLASSES.get(cls) ?? CLASSES.get('Instance'); c; c = c.base ? CLASSES.get(c.base) : undefined) out.push(c);
  return out;
}

export const isA = (cls: string, base: string) => cls === base || chain(cls).some((c) => c.name === base) || base === 'Instance';

const defaultCache = new Map<string, Map<string, Value>>();
/** All known properties of a class with their defaults, base-class props first. */
export function defaultsOf(cls: string): Map<string, Value> {
  let m = defaultCache.get(cls);
  if (!m) {
    m = new Map();
    for (const c of chain(cls).reverse()) for (const [k, v] of c.defaults) m.set(k, v);
    defaultCache.set(cls, m);
  }
  return m;
}

export const eventsOf = (cls: string) => chain(cls).flatMap((c) => c.events);
export const isGuiObject = (cls: string) => isA(cls, 'GuiObject');
export const isScript = (cls: string) => isA(cls, 'LuaSourceContainer');
export const isTextObject = (cls: string) => cls === 'TextLabel' || cls === 'TextButton' || cls === 'TextBox';
export const isImageObject = (cls: string) => cls === 'ImageLabel' || cls === 'ImageButton';
export const isButton = (cls: string) => isA(cls, 'GuiButton');
export const isKnownClass = (cls: string) => CLASSES.has(cls);

/** Properties always written by the Lua/.rbxmx exporters even when unset, so Studio matches the builder regardless of Roblox's current defaults. */
export function pinnedProps(cls: string): string[] {
  const out: string[] = [];
  if (isGuiObject(cls)) out.push('BackgroundColor3', 'BorderSizePixel', 'Size');
  if (isTextObject(cls)) out.push('FontFace', 'Text', 'TextColor3', 'TextSize');
  if (cls === 'ScreenGui') out.push('ZIndexBehavior');
  if (cls === 'UIListLayout' || cls === 'UIGridLayout') out.push('SortOrder');
  return out;
}

/** Inspector grouping. */
export function groupOf(prop: string): string {
  if (/^(AnchorPoint|Position|Size|SizeConstraint|AutomaticSize|Rotation|LayoutOrder|ZIndex)$/.test(prop)) return 'Layout';
  if (/^(Text|Font|LineHeight|RichText|MaxVisibleGraphemes|Placeholder|ClearTextOnFocus|MultiLine|CursorPosition)/.test(prop)) return 'Text';
  if (/^(Image|ScaleType|Slice|TileSize|ResampleMode|HoverImage|PressedImage)/.test(prop)) return 'Image';
  if (/^(Canvas|ScrollBar|Scrolling|ElasticBehavior|AutomaticCanvasSize|HorizontalScrollBarInset|VerticalScrollBar)/.test(prop)) return 'Scrolling';
  if (/^(Background|Border|Visible|ClipsDescendants|GroupColor3|GroupTransparency|Style)$/.test(prop) || /^Background|^Border/.test(prop)) return 'Appearance';
  if (/^(Active|AutoButtonColor|Selectable|Selected|Modal|Interactable|Enabled|ResetOnSpawn|DisplayOrder|IgnoreGuiInset|ZIndexBehavior|ScreenInsets|ClipToDeviceSafeArea|AutoLocalize|Archivable)$/.test(prop)) return 'Behavior';
  return 'Properties';
}

/** Roblox's built-in palette in the Explorer "insert" menu, used by the builder palette. */
export const PALETTE_GUI = ['Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'ImageButton', 'TextBox', 'ScrollingFrame', 'CanvasGroup'];
export const PALETTE_MODIFIERS = ['UICorner', 'UIStroke', 'UIGradient', 'UIPadding', 'UIListLayout', 'UIGridLayout', 'UIAspectRatioConstraint', 'UISizeConstraint', 'UITextSizeConstraint', 'UIScale'];
