// Roblox enums used by UI. Values match the Roblox API (needed for .rbxmx tokens and EnumItem.Value).
// Unknown enums/items are still accepted everywhere (they render as defaults); see literal.ts.

const seq = (names: string[], start = 0) => Object.fromEntries(names.map((n, i) => [n, start + i]));

const keyCodes: Record<string, number> = {
  Unknown: 0, Backspace: 8, Tab: 9, Clear: 12, Return: 13, Pause: 19, Escape: 27, Space: 32,
  QuotedDouble: 34, Hash: 35, Dollar: 36, Percent: 37, Ampersand: 38, Quote: 39, LeftParenthesis: 40,
  RightParenthesis: 41, Asterisk: 42, Plus: 43, Comma: 44, Minus: 45, Period: 46, Slash: 47,
  Zero: 48, One: 49, Two: 50, Three: 51, Four: 52, Five: 53, Six: 54, Seven: 55, Eight: 56, Nine: 57,
  Colon: 58, Semicolon: 59, LessThan: 60, Equals: 61, GreaterThan: 62, Question: 63, At: 64,
  LeftBracket: 91, BackSlash: 92, RightBracket: 93, Caret: 94, Underscore: 95, Backquote: 96,
  LeftCurly: 123, Pipe: 124, RightCurly: 125, Tilde: 126, Delete: 127,
  KeypadZero: 256, KeypadOne: 257, KeypadTwo: 258, KeypadThree: 259, KeypadFour: 260, KeypadFive: 261,
  KeypadSix: 262, KeypadSeven: 263, KeypadEight: 264, KeypadNine: 265, KeypadPeriod: 266, KeypadDivide: 267,
  KeypadMultiply: 268, KeypadMinus: 269, KeypadPlus: 270, KeypadEnter: 271, KeypadEquals: 272,
  Up: 273, Down: 274, Right: 275, Left: 276, Insert: 277, Home: 278, End: 279, PageUp: 280, PageDown: 281,
  NumLock: 300, CapsLock: 301, ScrollLock: 302, RightShift: 303, LeftShift: 304, RightControl: 305,
  LeftControl: 306, RightAlt: 307, LeftAlt: 308, RightMeta: 309, LeftMeta: 310, LeftSuper: 311, RightSuper: 312,
  ButtonX: 1000, ButtonY: 1001, ButtonA: 1002, ButtonB: 1003, ButtonR1: 1004, ButtonL1: 1005,
  ButtonR2: 1006, ButtonL2: 1007, ButtonR3: 1008, ButtonL3: 1009, ButtonStart: 1010, ButtonSelect: 1011,
  DPadLeft: 1012, DPadRight: 1013, DPadUp: 1014, DPadDown: 1015, Thumbstick1: 1016, Thumbstick2: 1017,
};
for (let i = 0; i < 26; i++) keyCodes[String.fromCharCode(65 + i)] = 97 + i;
for (let i = 1; i <= 15; i++) keyCodes['F' + i] = 281 + i;

export const ENUMS: Record<string, Record<string, number>> = {
  AnimationPriority: seq(['Idle', 'Movement', 'Action', 'Core']),
  ApplyStrokeMode: seq(['Contextual', 'Border']),
  AspectType: seq(['FitWithinMaxSize', 'ScaleWithParentSize']),
  AutomaticSize: seq(['None', 'X', 'Y', 'XY']),
  BorderMode: seq(['Outline', 'Middle', 'Inset']),
  BorderStrokePosition: seq(['Outer', 'Center', 'Inner']),
  ButtonStyle: seq(['Custom', 'RobloxButtonDefault', 'RobloxButton', 'RobloxRoundButton', 'RobloxRoundDefaultButton', 'RobloxRoundDropdownButton']),
  CameraMode: seq(['Classic', 'LockFirstPerson']),
  CameraType: seq(['Fixed', 'Attach', 'Watch', 'Track', 'Follow', 'Custom', 'Scriptable', 'Orbital']),
  ContextActionResult: seq(['Sink', 'Pass']),
  CoreGuiType: seq(['PlayerList', 'Health', 'Backpack', 'Chat', 'All', 'EmotesMenu', 'SelfView', 'Captures']),
  DominantAxis: seq(['Width', 'Height']),
  EasingDirection: seq(['In', 'Out', 'InOut']),
  EasingStyle: seq(['Linear', 'Sine', 'Back', 'Quad', 'Quart', 'Quint', 'Bounce', 'Elastic', 'Exponential', 'Circular', 'Cubic']),
  ElasticBehavior: seq(['WhenScrollable', 'Always', 'Never']),
  FillDirection: seq(['Horizontal', 'Vertical']),
  Font: {
    ...seq(['Legacy', 'Arial', 'ArialBold', 'SourceSans', 'SourceSansBold', 'SourceSansLight', 'SourceSansItalic',
      'Bodoni', 'Garamond', 'Cartoon', 'Code', 'Highway', 'SciFi', 'Arcade', 'Fantasy', 'Antique', 'SourceSansSemibold',
      'Gotham', 'GothamMedium', 'GothamBold', 'GothamBlack', 'AmaticSC', 'Bangers', 'Creepster', 'DenkOne', 'Fondamento',
      'FredokaOne', 'GrenzeGotisch', 'IndieFlower', 'JosefinSans', 'Jura', 'Kalam', 'LuckiestGuy', 'Merriweather',
      'Michroma', 'Nunito', 'Oswald', 'PatrickHand', 'PermanentMarker', 'Roboto', 'RobotoCondensed', 'RobotoMono',
      'Sarpanch', 'SpecialElite', 'TitilliumWeb', 'Ubuntu', 'BuilderSans', 'BuilderSansMedium', 'BuilderSansBold',
      'BuilderSansExtraBold', 'Arimo', 'ArimoBold']),
    Unknown: 100,
  },
  FontStyle: seq(['Normal', 'Italic']),
  FontWeight: { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 },
  FrameStyle: seq(['Custom', 'ChatBlue', 'RobloxSquare', 'RobloxRound', 'ChatGreen', 'ChatRed', 'DropShadow']),
  HorizontalAlignment: seq(['Center', 'Left', 'Right']),
  KeyCode: keyCodes,
  LineJoinMode: seq(['Round', 'Bevel', 'Miter']),
  MouseBehavior: seq(['Default', 'LockCenter', 'LockCurrentPosition']),
  PlaybackState: seq(['Begin', 'Delayed', 'Playing', 'Paused', 'Completed', 'Cancelled']),
  ResamplerMode: seq(['Default', 'Pixelated']),
  ScaleType: seq(['Stretch', 'Slice', 'Tile', 'Fit', 'Crop']),
  ScreenInsets: seq(['None', 'DeviceSafeInsets', 'CoreUISafeInsets', 'TopbarSafeInsets']),
  ScreenOrientation: seq(['LandscapeLeft', 'LandscapeRight', 'LandscapeSensor', 'Portrait', 'Sensor']),
  ScrollBarInset: seq(['None', 'ScrollBar', 'Always']),
  ScrollingDirection: { X: 1, Y: 2, XY: 4 },
  SelectionBehavior: seq(['Escape', 'Stop']),
  SizeConstraint: seq(['RelativeXY', 'RelativeXX', 'RelativeYY']),
  SortOrder: seq(['Name', 'Custom', 'LayoutOrder']),
  StartCorner: seq(['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']),
  TextDirection: seq(['Auto', 'LeftToRight', 'RightToLeft']),
  TextTruncate: seq(['None', 'AtEnd', 'SplitWord']),
  TextXAlignment: seq(['Left', 'Right', 'Center']),
  TextYAlignment: seq(['Top', 'Center', 'Bottom']),
  UserInputState: seq(['Begin', 'Change', 'End', 'Cancel', 'None']),
  UserInputType: {
    MouseButton1: 0, MouseButton2: 1, MouseButton3: 2, MouseWheel: 3, MouseMovement: 4, Touch: 7, Keyboard: 8,
    Focus: 9, Accelerometer: 10, Gyro: 11, Gamepad1: 12, TextInput: 20, InputMethod: 21, None: 22,
  },
  VerticalAlignment: seq(['Center', 'Top', 'Bottom']),
  VerticalScrollBarPosition: seq(['Right', 'Left']),
  ZIndexBehavior: seq(['Global', 'Sibling']),
};

const FAMILY = (n: string) => `rbxasset://fonts/families/${n}.json`;

/** Legacy Enum.Font → FontFace (family, weight, style). */
export const FONT_ENUM_FACE: Record<string, [string, number, 'Normal' | 'Italic']> = {
  Legacy: [FAMILY('LegacyArial'), 400, 'Normal'],
  Arial: [FAMILY('Arial'), 400, 'Normal'],
  ArialBold: [FAMILY('Arial'), 700, 'Normal'],
  SourceSans: [FAMILY('SourceSansPro'), 400, 'Normal'],
  SourceSansBold: [FAMILY('SourceSansPro'), 700, 'Normal'],
  SourceSansSemibold: [FAMILY('SourceSansPro'), 600, 'Normal'],
  SourceSansLight: [FAMILY('SourceSansPro'), 300, 'Normal'],
  SourceSansItalic: [FAMILY('SourceSansPro'), 400, 'Italic'],
  Bodoni: [FAMILY('AccanthisADFStd'), 400, 'Normal'],
  Garamond: [FAMILY('Guru'), 400, 'Normal'],
  Cartoon: [FAMILY('ComicNeueAngular'), 400, 'Normal'],
  Code: [FAMILY('Inconsolata'), 400, 'Normal'],
  Highway: [FAMILY('HighwayGothic'), 400, 'Normal'],
  SciFi: [FAMILY('Zekton'), 400, 'Normal'],
  Arcade: [FAMILY('PressStart2P'), 400, 'Normal'],
  Fantasy: [FAMILY('Balthazar'), 400, 'Normal'],
  Antique: [FAMILY('SpecialElite'), 400, 'Normal'],
  Gotham: [FAMILY('GothamSSm'), 400, 'Normal'],
  GothamMedium: [FAMILY('GothamSSm'), 500, 'Normal'],
  GothamBold: [FAMILY('GothamSSm'), 700, 'Normal'],
  GothamBlack: [FAMILY('GothamSSm'), 900, 'Normal'],
  BuilderSans: [FAMILY('BuilderSans'), 400, 'Normal'],
  BuilderSansMedium: [FAMILY('BuilderSans'), 500, 'Normal'],
  BuilderSansBold: [FAMILY('BuilderSans'), 700, 'Normal'],
  BuilderSansExtraBold: [FAMILY('BuilderSans'), 800, 'Normal'],
  Arimo: [FAMILY('Arimo'), 400, 'Normal'],
  ArimoBold: [FAMILY('Arimo'), 700, 'Normal'],
};
for (const n of ['AmaticSC', 'Bangers', 'Creepster', 'DenkOne', 'Fondamento', 'FredokaOne', 'GrenzeGotisch', 'IndieFlower',
  'JosefinSans', 'Jura', 'Kalam', 'LuckiestGuy', 'Merriweather', 'Michroma', 'Nunito', 'Oswald', 'PatrickHand',
  'PermanentMarker', 'Roboto', 'RobotoCondensed', 'RobotoMono', 'Sarpanch', 'SpecialElite', 'TitilliumWeb', 'Ubuntu']) {
  FONT_ENUM_FACE[n] = [FAMILY(n), 400, 'Normal'];
}

export const enumValue = (e: string, n: string): number | undefined => ENUMS[e]?.[n];
export const enumNameOf = (e: string, value: number): string | undefined =>
  Object.entries(ENUMS[e] ?? {}).find(([, v]) => v === value)?.[0];
