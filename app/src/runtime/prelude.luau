--!nocheck
-- Mock Roblox client API for the builder. Runs once per play session inside the Luau VM.
-- The instance tree lives in JS; this file provides Instance proxies, Roblox datatypes, signals,
-- the task scheduler and service methods. Values cross the boundary as primitives or "\1TAG|a|b..." strings.
local H, CLASSES, ENUMS, INIT = ...

local rawtypeof = typeof
local split, sub, byte, find = string.split, string.sub, string.byte, string.find
local tconcat, tclone, tfind, tremove, tunpack, tpack = table.concat, table.clone, table.find, table.remove, table.unpack, table.pack

local now = INIT.now
local startClock = INIT.now
local epochOffset = INIT.epochOffset

local G = {}
for k, v in getfenv(0) do G[k] = v end

-- ========== formatting & errors ==========
local function fmt(...)
	local n = select("#", ...)
	local t = table.create(n)
	for i = 1, n do t[i] = tostring((select(i, ...))) end
	return tconcat(t, " ")
end

local function report(err, co)
	H.log("error", tostring(err), co and debug.traceback(co) or debug.traceback())
end

-- ========== scheduler ==========
local sleeping = {}
local deferred = {}

local function resumeThread(co, ...)
	if coroutine.status(co) ~= "suspended" then return end
	local ok, err = coroutine.resume(co, ...)
	if not ok then report(err, co) end
end

local function spawnfn(fn, ...)
	local co = coroutine.create(fn)
	resumeThread(co, ...)
	return co
end

local function flushDeferred()
	for _ = 1, 10 do
		if #deferred == 0 then return end
		local list = deferred
		deferred = {}
		for _, d in list do resumeThread(d[1], tunpack(d[2], 1, d[2].n)) end
	end
	if #deferred > 0 then
		H.log("warn", "task.defer: too many re-entrant deferrals, the rest were dropped")
		deferred = {}
	end
end

local task = {}
function task.spawn(f, ...)
	if type(f) == "thread" then resumeThread(f, ...) return f end
	return spawnfn(f, ...)
end
function task.defer(f, ...)
	local co = type(f) == "thread" and f or coroutine.create(f)
	deferred[#deferred + 1] = { co, tpack(...) }
	H.wake(0)
	return co
end
function task.delay(t, f, ...)
	t = math.max(tonumber(t) or 0, 0)
	local co = type(f) == "thread" and f or coroutine.create(f)
	now = H.now()
	sleeping[#sleeping + 1] = { co = co, at = now + t, args = tpack(...) }
	H.wake(t)
	return co
end
function task.wait(t)
	t = math.max(tonumber(t) or 0, 0)
	if not coroutine.isyieldable() then error("attempt to yield across metamethod/C-call boundary", 2) end
	now = H.now()
	sleeping[#sleeping + 1] = { co = coroutine.running(), at = now + t, start = now }
	H.wake(t)
	return coroutine.yield()
end
function task.cancel(co)
	for i = #sleeping, 1, -1 do if sleeping[i].co == co then tremove(sleeping, i) end end
	for i = #deferred, 1, -1 do if deferred[i][1] == co then tremove(deferred, i) end end
	if coroutine.status(co) == "suspended" then coroutine.close(co) end
end
function task.synchronize() end
function task.desynchronize() end

-- ========== signals ==========
local SignalMT = { __type = "RBXScriptSignal" }
SignalMT.__index = SignalMT
local ConnMT = { __type = "RBXScriptConnection" }
ConnMT.__index = ConnMT
SignalMT.__tostring = function() return "Signal" end
ConnMT.__tostring = function() return "Connection" end

local Signals = {} -- id -> key -> signal

local function newSignal(id, key)
	return setmetatable({ _id = id, _key = key, _conns = {}, _waiting = {} }, SignalMT)
end

local function signalOf(id, key)
	local s = Signals[id]
	if not s then s = {} Signals[id] = s end
	local sig = s[key]
	if not sig then sig = newSignal(id, key) s[key] = sig end
	return sig
end

local function listen(sig)
	-- A new RunService listener must start the frame loop, which otherwise only runs while timers are due.
	if sig._id == INIT.runService then H.wake(0) end
	if sig._id and not sig._listened then
		sig._listened = true
		H.listen(sig._id, sig._key)
	end
end

function SignalMT:Connect(fn)
	if type(fn) ~= "function" then error("Attempt to connect failed: Passed value is not a function", 2) end
	local c = setmetatable({ Connected = true, _fn = fn, _sig = self }, ConnMT)
	self._conns[#self._conns + 1] = c
	listen(self)
	return c
end
SignalMT.connect = SignalMT.Connect
SignalMT.ConnectParallel = SignalMT.Connect
function SignalMT:Once(fn)
	local c
	c = self:Connect(function(...) c:Disconnect() fn(...) end)
	return c
end
function SignalMT:Wait()
	if not coroutine.isyieldable() then error("attempt to yield across metamethod/C-call boundary", 2) end
	listen(self)
	self._waiting[#self._waiting + 1] = coroutine.running()
	return coroutine.yield()
end
SignalMT.wait = SignalMT.Wait
function SignalMT:_fire(...)
	local conns = self._conns
	if #conns > 0 then
		for _, c in tclone(conns) do
			if c.Connected then spawnfn(c._fn, ...) end
		end
	end
	local w = self._waiting
	if #w > 0 then
		self._waiting = {}
		for _, co in w do resumeThread(co, ...) end
	end
end
function ConnMT:Disconnect()
	if not self.Connected then return end
	self.Connected = false
	local conns = self._sig._conns
	local i = tfind(conns, self)
	if i then tremove(conns, i) end
end
ConnMT.disconnect = ConnMT.Disconnect

-- ========== datatypes ==========
local function typeName(v)
	local mt = getmetatable(v)
	return type(mt) == "table" and rawget(mt, "__type") or nil
end

local function dtype(name)
	local mt = { __type = name }
	mt.__index = mt
	mt.__newindex = function(_, k) error(tostring(k) .. " cannot be assigned to", 2) end
	return mt
end

local function round(x) return math.floor(x + 0.5) end

-- UDim
local UDimMT = dtype("UDim")
local function newUDim(s, o) return setmetatable({ Scale = tonumber(s) or 0, Offset = round(tonumber(o) or 0) }, UDimMT) end
UDimMT.__eq = function(a, b) return a.Scale == b.Scale and a.Offset == b.Offset end
UDimMT.__add = function(a, b) return newUDim(a.Scale + b.Scale, a.Offset + b.Offset) end
UDimMT.__sub = function(a, b) return newUDim(a.Scale - b.Scale, a.Offset - b.Offset) end
UDimMT.__unm = function(a) return newUDim(-a.Scale, -a.Offset) end
UDimMT.__tostring = function(a) return a.Scale .. ", " .. a.Offset end
function UDimMT.Lerp(a, b, t) return newUDim(a.Scale + (b.Scale - a.Scale) * t, a.Offset + (b.Offset - a.Offset) * t) end
local UDim = { new = newUDim }

-- UDim2
local UDim2MT = dtype("UDim2")
local function newUDim2(xs, xo, ys, yo)
	if typeName(xs) == "UDim" then
		local x, y = xs, xo
		return setmetatable({ X = x, Y = y, Width = x, Height = y }, UDim2MT)
	end
	local x, y = newUDim(xs, xo), newUDim(ys, yo)
	return setmetatable({ X = x, Y = y, Width = x, Height = y }, UDim2MT)
end
UDim2MT.__eq = function(a, b) return a.X == b.X and a.Y == b.Y end
UDim2MT.__add = function(a, b) return newUDim2(a.X + b.X, a.Y + b.Y) end
UDim2MT.__sub = function(a, b) return newUDim2(a.X - b.X, a.Y - b.Y) end
UDim2MT.__unm = function(a) return newUDim2(-a.X, -a.Y) end
UDim2MT.__tostring = function(a) return "{" .. tostring(a.X) .. "}, {" .. tostring(a.Y) .. "}" end
function UDim2MT.Lerp(a, b, t) return newUDim2(a.X:Lerp(b.X, t), a.Y:Lerp(b.Y, t)) end
local UDim2 = {
	new = newUDim2,
	fromScale = function(x, y) return newUDim2(x, 0, y, 0) end,
	fromOffset = function(x, y) return newUDim2(0, x, 0, y) end,
}

-- Vector2
local Vector2MT = dtype("Vector2")
local function newV2(x, y)
	x, y = tonumber(x) or 0, tonumber(y) or 0
	return setmetatable({ X = x, Y = y, x = x, y = y, Magnitude = math.sqrt(x * x + y * y) }, Vector2MT)
end
local function v2op(op)
	return function(a, b)
		if type(a) == "number" then return newV2(op(a, b.X), op(a, b.Y)) end
		if type(b) == "number" then return newV2(op(a.X, b), op(a.Y, b)) end
		return newV2(op(a.X, b.X), op(a.Y, b.Y))
	end
end
Vector2MT.__add = v2op(function(a, b) return a + b end)
Vector2MT.__sub = v2op(function(a, b) return a - b end)
Vector2MT.__mul = v2op(function(a, b) return a * b end)
Vector2MT.__div = v2op(function(a, b) return a / b end)
Vector2MT.__idiv = v2op(function(a, b) return a // b end)
Vector2MT.__unm = function(a) return newV2(-a.X, -a.Y) end
Vector2MT.__eq = function(a, b) return a.X == b.X and a.Y == b.Y end
Vector2MT.__tostring = function(a) return a.X .. ", " .. a.Y end
Vector2MT.__index = function(self, k)
	if k == "Unit" then local m = rawget(self, "Magnitude") return m == 0 and newV2(0, 0) or newV2(self.X / m, self.Y / m) end
	return Vector2MT[k]
end
function Vector2MT.Lerp(a, b, t) return newV2(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t) end
function Vector2MT.Dot(a, b) return a.X * b.X + a.Y * b.Y end
function Vector2MT.Cross(a, b) return a.X * b.Y - a.Y * b.X end
function Vector2MT.Min(a, b) return newV2(math.min(a.X, b.X), math.min(a.Y, b.Y)) end
function Vector2MT.Max(a, b) return newV2(math.max(a.X, b.X), math.max(a.Y, b.Y)) end
function Vector2MT.Abs(a) return newV2(math.abs(a.X), math.abs(a.Y)) end
function Vector2MT.Floor(a) return newV2(math.floor(a.X), math.floor(a.Y)) end
function Vector2MT.Ceil(a) return newV2(math.ceil(a.X), math.ceil(a.Y)) end
function Vector2MT.Sign(a) return newV2(math.sign(a.X), math.sign(a.Y)) end
function Vector2MT.Angle(a, b, signed)
	local ang = math.atan2(a:Cross(b), a:Dot(b))
	return signed and ang or math.abs(ang)
end
function Vector2MT.FuzzyEq(a, b, eps) eps = eps or 1e-5 return math.abs(a.X - b.X) <= eps and math.abs(a.Y - b.Y) <= eps end
local Vector2 = { new = newV2, zero = newV2(0, 0), one = newV2(1, 1), xAxis = newV2(1, 0), yAxis = newV2(0, 1) }

-- Vector3 (minimal, for InputObject.Position and camera code)
local Vector3MT = dtype("Vector3")
local function newV3(x, y, z)
	x, y, z = tonumber(x) or 0, tonumber(y) or 0, tonumber(z) or 0
	return setmetatable({ X = x, Y = y, Z = z, x = x, y = y, z = z, Magnitude = math.sqrt(x * x + y * y + z * z) }, Vector3MT)
end
local function v3op(op)
	return function(a, b)
		if type(a) == "number" then return newV3(op(a, b.X), op(a, b.Y), op(a, b.Z)) end
		if type(b) == "number" then return newV3(op(a.X, b), op(a.Y, b), op(a.Z, b)) end
		return newV3(op(a.X, b.X), op(a.Y, b.Y), op(a.Z, b.Z))
	end
end
Vector3MT.__add = v3op(function(a, b) return a + b end)
Vector3MT.__sub = v3op(function(a, b) return a - b end)
Vector3MT.__mul = v3op(function(a, b) return a * b end)
Vector3MT.__div = v3op(function(a, b) return a / b end)
Vector3MT.__unm = function(a) return newV3(-a.X, -a.Y, -a.Z) end
Vector3MT.__eq = function(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end
Vector3MT.__tostring = function(a) return a.X .. ", " .. a.Y .. ", " .. a.Z end
Vector3MT.__index = function(self, k)
	if k == "Unit" then local m = rawget(self, "Magnitude") return m == 0 and newV3(0, 0, 0) or newV3(self.X / m, self.Y / m, self.Z / m) end
	return Vector3MT[k]
end
function Vector3MT.Lerp(a, b, t) return a + (b - a) * t end
function Vector3MT.Dot(a, b) return a.X * b.X + a.Y * b.Y + a.Z * b.Z end
function Vector3MT.Cross(a, b) return newV3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X) end
local Vector3 = { new = newV3, zero = newV3(0, 0, 0), one = newV3(1, 1, 1), xAxis = newV3(1, 0, 0), yAxis = newV3(0, 1, 0), zAxis = newV3(0, 0, 1) }

-- Color3
local Color3MT = dtype("Color3")
local function newC3(r, g, b) return setmetatable({ R = tonumber(r) or 0, G = tonumber(g) or 0, B = tonumber(b) or 0, r = tonumber(r) or 0, g = tonumber(g) or 0, b = tonumber(b) or 0 }, Color3MT) end
Color3MT.__eq = function(a, b) return a.R == b.R and a.G == b.G and a.B == b.B end
Color3MT.__tostring = function(a) return a.R .. ", " .. a.G .. ", " .. a.B end
function Color3MT.Lerp(a, b, t) return newC3(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t) end
local function toHSV(c)
	local r, g, b = c.R, c.G, c.B
	local mx, mn = math.max(r, g, b), math.min(r, g, b)
	local d = mx - mn
	local h = 0
	if d > 0 then
		if mx == r then h = ((g - b) / d) % 6 elseif mx == g then h = (b - r) / d + 2 else h = (r - g) / d + 4 end
		h /= 6
	end
	return h, mx == 0 and 0 or d / mx, mx
end
Color3MT.ToHSV = toHSV
function Color3MT.ToHex(c)
	return string.format("%02X%02X%02X", round(c.R * 255), round(c.G * 255), round(c.B * 255))
end
local function fromHSV(h, s, v)
	local i = math.floor(h * 6)
	local f = h * 6 - i
	local p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
	i = i % 6
	if i == 0 then return newC3(v, t, p) elseif i == 1 then return newC3(q, v, p) elseif i == 2 then return newC3(p, v, t)
	elseif i == 3 then return newC3(p, q, v) elseif i == 4 then return newC3(t, p, v) end
	return newC3(v, p, q)
end
local Color3 = {
	new = newC3,
	fromRGB = function(r, g, b) return newC3((tonumber(r) or 0) / 255, (tonumber(g) or 0) / 255, (tonumber(b) or 0) / 255) end,
	fromHSV = fromHSV,
	toHSV = toHSV,
	fromHex = function(hex)
		hex = tostring(hex):gsub("^#", "")
		if #hex == 3 then hex = hex:gsub(".", "%0%0") end
		local n = tonumber(hex, 16)
		if #hex ~= 6 or not n then error("Unable to convert characters to hex value", 2) end
		return newC3(bit32.rshift(n, 16) / 255, bit32.band(bit32.rshift(n, 8), 255) / 255, bit32.band(n, 255) / 255)
	end,
}

-- Rect, NumberRange
local RectMT = dtype("Rect")
local function newRect(a, b, c, d)
	if typeName(a) == "Vector2" then a, b, c, d = a.X, a.Y, b.X, b.Y end
	local mn, mx = newV2(a, b), newV2(c, d)
	return setmetatable({ Min = mn, Max = mx, Width = mx.X - mn.X, Height = mx.Y - mn.Y }, RectMT)
end
RectMT.__eq = function(a, b) return a.Min == b.Min and a.Max == b.Max end
RectMT.__tostring = function(a) return tostring(a.Min) .. ", " .. tostring(a.Max) end
local Rect = { new = newRect }

local NumberRangeMT = dtype("NumberRange")
local function newNR(a, b) return setmetatable({ Min = tonumber(a) or 0, Max = tonumber(b or a) or 0 }, NumberRangeMT) end
NumberRangeMT.__eq = function(a, b) return a.Min == b.Min and a.Max == b.Max end
NumberRangeMT.__tostring = function(a) return a.Min .. " " .. a.Max end
local NumberRange = { new = newNR }

-- Sequences
local CSKMT = dtype("ColorSequenceKeypoint")
local NSKMT = dtype("NumberSequenceKeypoint")
local CSMT = dtype("ColorSequence")
local NSMT = dtype("NumberSequence")
local function newCSK(t, c) return setmetatable({ Time = t, Value = c }, CSKMT) end
local function newNSK(t, v, e) return setmetatable({ Time = t, Value = v, Envelope = e or 0 }, NSKMT) end
local ColorSequence = {
	new = function(a, b)
		if typeName(a) == "Color3" then return setmetatable({ Keypoints = { newCSK(0, a), newCSK(1, b or a) } }, CSMT) end
		if type(a) ~= "table" or #a < 2 then error("ColorSequence.new: expected at least 2 keypoints", 2) end
		return setmetatable({ Keypoints = tclone(a) }, CSMT)
	end,
}
local NumberSequence = {
	new = function(a, b)
		if type(a) == "number" then return setmetatable({ Keypoints = { newNSK(0, a), newNSK(1, b or a) } }, NSMT) end
		if type(a) ~= "table" or #a < 2 then error("NumberSequence.new: expected at least 2 keypoints", 2) end
		return setmetatable({ Keypoints = tclone(a) }, NSMT)
	end,
}
CSMT.__tostring = function(s) local t = {} for _, k in s.Keypoints do t[#t + 1] = k.Time .. " " .. tostring(k.Value) end return tconcat(t, " ") end
NSMT.__tostring = function(s) local t = {} for _, k in s.Keypoints do t[#t + 1] = k.Time .. " " .. k.Value end return tconcat(t, " ") end

-- Enums
local EnumItemMT = { __type = "EnumItem" }
EnumItemMT.__index = EnumItemMT
EnumItemMT.__tostring = function(e) return "Enum." .. e._enum .. "." .. e.Name end
function EnumItemMT.IsA(e, name) return e._enum == name end
local EnumMT = { __type = "Enum" }
local Enums = {}
local function enumOf(name)
	local e = Enums[name]
	if e then return e end
	e = setmetatable({ _name = name, _items = {}, _next = 0 }, EnumMT)
	Enums[name] = e
	local data = ENUMS[name]
	if data then
		for item, value in data do
			e._items[item] = setmetatable({ Name = item, Value = value, EnumType = e, _enum = name }, EnumItemMT)
		end
	end
	return e
end
EnumMT.__index = function(e, k)
	if k == "GetEnumItems" then
		return function(self)
			local list = {}
			for _, it in rawget(self, "_items") do list[#list + 1] = it end
			table.sort(list, function(a, b) return a.Value < b.Value end)
			return list
		end
	elseif k == "FromName" then
		return function(self, n) return rawget(self, "_items")[n] end
	elseif k == "FromValue" then
		return function(self, v) for _, it in rawget(self, "_items") do if it.Value == v then return it end end return nil end
	end
	local items = rawget(e, "_items")
	local it = items[k]
	if not it then
		-- Enums outside the builder's table are synthesized so gameplay-side code keeps running.
		it = setmetatable({ Name = k, Value = -1, EnumType = e, _enum = rawget(e, "_name") }, EnumItemMT)
		items[k] = it
	end
	return it
end
EnumMT.__tostring = function(e) return rawget(e, "_name") end
local Enum = setmetatable({}, {
	__index = function(_, k)
		if k == "GetEnums" then return function() local t = {} for n in ENUMS do t[#t + 1] = enumOf(n) end return t end end
		return enumOf(k)
	end,
	__newindex = function() error("Enum cannot be modified", 2) end,
})

-- Font
local FontMT = dtype("Font")
local WEIGHTS = { [100] = "Thin", [200] = "ExtraLight", [300] = "Light", [400] = "Regular", [500] = "Medium", [600] = "SemiBold", [700] = "Bold", [800] = "ExtraBold", [900] = "Heavy" }
local function newFont(family, weight, style)
	weight = weight or Enum.FontWeight.Regular
	if type(weight) == "number" then weight = Enum.FontWeight[WEIGHTS[weight] or "Regular"] end
	style = style or Enum.FontStyle.Normal
	return setmetatable({ Family = tostring(family), Weight = weight, Style = style, Bold = weight.Value >= 600 }, FontMT)
end
FontMT.__eq = function(a, b) return a.Family == b.Family and a.Weight == b.Weight and a.Style == b.Style end
FontMT.__tostring = function(f) return "Font { Family = " .. f.Family .. ", Weight = " .. f.Weight.Name .. ", Style = " .. f.Style.Name .. " }" end
local Font = {
	new = newFont,
	fromName = function(name, w, s) return newFont("rbxasset://fonts/families/" .. tostring(name) .. ".json", w, s) end,
	fromId = function(id, w, s) return newFont("rbxassetid://" .. tostring(id), w, s) end,
	fromEnum = function(e)
		local f = INIT.fontFaces[e.Name]
		if not f then error("Font.fromEnum: unsupported font " .. tostring(e), 2) end
		return newFont(f[1], f[2], Enum.FontStyle[f[3]])
	end,
}

-- TweenInfo
local TweenInfoMT = dtype("TweenInfo")
local function enumArg(enumName, v, default)
	if v == nil then return Enum[enumName][default] end
	if type(v) == "string" then return Enum[enumName][v] end
	return v
end
local TweenInfo = {
	new = function(time, style, dir, rep, reverses, delay)
		return setmetatable({
			Time = tonumber(time) or 1,
			EasingStyle = enumArg("EasingStyle", style, "Quad"),
			EasingDirection = enumArg("EasingDirection", dir, "Out"),
			RepeatCount = tonumber(rep) or 0,
			Reverses = reverses == true,
			DelayTime = tonumber(delay) or 0,
		}, TweenInfoMT)
	end,
}
TweenInfoMT.__tostring = function(t) return "Time:" .. t.Time .. " DelayTime:" .. t.DelayTime .. " RepeatCount:" .. t.RepeatCount .. " Reverses:" .. tostring(t.Reverses) .. " EasingDirection:" .. t.EasingDirection.Name .. " EasingStyle:" .. t.EasingStyle.Name end

-- CFrame / BrickColor / Random / DateTime: minimal stand-ins for UI code that touches them.
local CFrameMT = dtype("CFrame")
local function newCF(x, y, z)
	if typeName(x) == "Vector3" then x, y, z = x.X, x.Y, x.Z end
	local p = newV3(x, y, z)
	return setmetatable({ Position = p, p = p, X = p.X, Y = p.Y, Z = p.Z, LookVector = newV3(0, 0, -1), RightVector = newV3(1, 0, 0), UpVector = newV3(0, 1, 0) }, CFrameMT)
end
CFrameMT.__mul = function(a, b)
	if typeName(b) == "Vector3" then return a.Position + b end
	return newCF(a.Position + b.Position)
end
CFrameMT.__add = function(a, b) return newCF(a.Position + b) end
CFrameMT.__sub = function(a, b) return newCF(a.Position - b) end
CFrameMT.__tostring = function(c) return tostring(c.Position) .. ", 1, 0, 0, 0, 1, 0, 0, 0, 1" end
function CFrameMT.Inverse(c) return newCF(-c.Position) end
function CFrameMT.Lerp(a, b, t) return newCF(a.Position:Lerp(b.Position, t)) end
function CFrameMT.ToWorldSpace(a, b) return a * b end
function CFrameMT.ToObjectSpace(a, b) return newCF(b.Position - a.Position) end
function CFrameMT.GetComponents(c) return c.X, c.Y, c.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1 end
local CFrame = {
	new = newCF, identity = newCF(0, 0, 0),
	Angles = function() return newCF(0, 0, 0) end, fromEulerAnglesXYZ = function() return newCF(0, 0, 0) end,
	fromOrientation = function() return newCF(0, 0, 0) end, lookAt = function(at) return newCF(at) end,
	fromMatrix = function(p) return newCF(p) end,
}

local BrickColorMT = dtype("BrickColor")
local BRICK = { White = { 242, 243, 243 }, Black = { 27, 42, 53 }, ["Really red"] = { 255, 0, 0 }, ["Bright red"] = { 196, 40, 28 }, ["Bright green"] = { 75, 151, 75 }, ["Bright blue"] = { 13, 105, 172 }, ["Bright yellow"] = { 245, 205, 48 }, ["Bright orange"] = { 218, 133, 65 }, ["Medium stone grey"] = { 163, 162, 165 }, ["Really black"] = { 17, 17, 17 }, Lime = { 0, 255, 0 }, ["Institutional white"] = { 248, 248, 248 } }
local function newBrick(name)
	name = BRICK[name] and name or "Medium stone grey"
	local c = BRICK[name]
	return setmetatable({ Name = name, Color = Color3.fromRGB(c[1], c[2], c[3]), Number = 194 }, BrickColorMT)
end
BrickColorMT.__tostring = function(b) return b.Name end
local BrickColor = { new = newBrick, White = function() return newBrick("White") end, Black = function() return newBrick("Black") end, Red = function() return newBrick("Bright red") end, random = function() return newBrick("Medium stone grey") end }

local RandomMT = dtype("Random")
local function newRandom(seed)
	local state = math.floor(tonumber(seed) or (H.now() * 1e6)) % 2147483647
	if state <= 0 then state += 2147483646 end
	return setmetatable({ _s = { state } }, RandomMT)
end
local function nextRaw(r) local s = r._s s[1] = (s[1] * 16807) % 2147483647 return s[1] / 2147483647 end
function RandomMT.NextNumber(r, a, b) a, b = a or 0, b or 1 return a + (b - a) * nextRaw(r) end
function RandomMT.NextInteger(r, a, b) return math.floor(a + (b - a + 1) * nextRaw(r)) end
function RandomMT.Shuffle(r, t) for i = #t, 2, -1 do local j = r:NextInteger(1, i) t[i], t[j] = t[j], t[i] end end
function RandomMT.Clone(r) return setmetatable({ _s = { r._s[1] } }, RandomMT) end
local Random = { new = newRandom }

local DateTimeMT = dtype("DateTime")
local function newDT(ms) return setmetatable({ UnixTimestampMillis = ms, UnixTimestamp = ms // 1000 }, DateTimeMT) end
function DateTimeMT.ToIsoDate(d) return os.date("!%Y-%m-%dT%H:%M:%SZ", d.UnixTimestamp) end
function DateTimeMT.FormatLocalTime(d, f) return os.date("%c", d.UnixTimestamp) end
function DateTimeMT.FormatUniversalTime(d, f) return os.date("!%c", d.UnixTimestamp) end
function DateTimeMT.ToLocalTime(d) return os.date("*t", d.UnixTimestamp) end
function DateTimeMT.ToUniversalTime(d) return os.date("!*t", d.UnixTimestamp) end
local DateTime = {
	now = function() return newDT(math.floor((epochOffset + H.now()) * 1000)) end,
	fromUnixTimestamp = function(s) return newDT(math.floor(s * 1000)) end,
	fromUnixTimestampMillis = newDT,
}

-- ========== instances ==========
local IdOf = setmetatable({}, { __mode = "k" })
local Proxies = setmetatable({}, { __mode = "v" })
local ClassOf = {}
local Callbacks = {}
local InstanceMT = { __type = "Instance" }

local function wrap(id, cls)
	local p = Proxies[id]
	if p then return p end
	if cls then ClassOf[id] = cls end
	p = setmetatable({}, InstanceMT)
	IdOf[p] = id
	Proxies[id] = p
	return p
end

-- Anything: stand-in for game objects outside this UI (remotes, modules, workspace parts...).
local AnyMT = { __type = "Instance" }
local noted = {}
local function anything(path)
	local root = split(path, ".")[1] .. "." .. (split(path, ".")[2] or "")
	if not noted[root] then
		noted[root] = true
		H.log("info", path .. " is not part of this UI; the builder uses a stand-in object for it")
	end
	return setmetatable({ _path = path }, AnyMT)
end
local function anyConn() return setmetatable({ Connected = true, _sig = { _conns = {} } }, ConnMT) end
AnyMT.__index = function(self, k)
	local path = rawget(self, "_path")
	if k == "Connect" or k == "Once" or k == "ConnectParallel" then return function() return anyConn() end end
	if k == "Name" then local parts = split(path, ".") return parts[#parts] end
	if k == "Parent" or k == "Value" then return nil end
	if k == "IsA" then return function() return false end end
	if k == "GetChildren" or k == "GetDescendants" then return function() return {} end end
	if k == "FindFirstChild" then return function() return nil end end
	if k == "WaitForChild" then return function(_, n) return anything(path .. "." .. tostring(n)) end end
	return anything(path .. "." .. tostring(k))
end
AnyMT.__newindex = function() end
AnyMT.__call = function(self, _, ...)
	local parts = split(rawget(self, "_path"), ".")
	local method = parts[#parts]
	if method == "FireServer" or method == "InvokeServer" then
		table.remove(parts)
		H.log("info", tconcat(parts, ".") .. ":" .. method .. "(" .. fmt(...) .. ") — no server in the builder")
	end
	return nil
end
AnyMT.__tostring = function(self) return rawget(self, "_path") end

-- ---- value codec (must match runtime/codec.ts) ----
local function n2s(x) return tostring(x) end

local function enc(v)
	local t = type(v)
	if t == "string" then
		if byte(v, 1) == 1 then return "\1s|" .. v end
		return v
	end
	if t ~= "table" then
		if t == "function" or t == "thread" or t == "userdata" then return "\1?|" .. t end
		return v
	end
	local id = IdOf[v]
	if id then return "\1I|" .. id end
	local ty = typeName(v)
	if ty == "UDim2" then return "\1U2|" .. n2s(v.X.Scale) .. "|" .. v.X.Offset .. "|" .. n2s(v.Y.Scale) .. "|" .. v.Y.Offset end
	if ty == "UDim" then return "\1U|" .. n2s(v.Scale) .. "|" .. v.Offset end
	if ty == "Vector2" then return "\1V2|" .. n2s(v.X) .. "|" .. n2s(v.Y) end
	if ty == "Color3" then return "\1C3|" .. n2s(v.R) .. "|" .. n2s(v.G) .. "|" .. n2s(v.B) end
	if ty == "EnumItem" then return "\1E|" .. v._enum .. "|" .. v.Name end
	if ty == "Vector3" then return "\1V3|" .. n2s(v.X) .. "|" .. n2s(v.Y) .. "|" .. n2s(v.Z) end
	if ty == "Rect" then return "\1R|" .. n2s(v.Min.X) .. "|" .. n2s(v.Min.Y) .. "|" .. n2s(v.Max.X) .. "|" .. n2s(v.Max.Y) end
	if ty == "NumberRange" then return "\1NR|" .. n2s(v.Min) .. "|" .. n2s(v.Max) end
	if ty == "Font" then return "\1F|" .. v.Family .. "|" .. v.Weight.Value .. "|" .. v.Style.Name end
	if ty == "ColorSequence" then
		local p = { "\1CS" }
		for _, k in v.Keypoints do p[#p + 1] = n2s(k.Time) p[#p + 1] = n2s(k.Value.R) p[#p + 1] = n2s(k.Value.G) p[#p + 1] = n2s(k.Value.B) end
		return tconcat(p, "|")
	end
	if ty == "NumberSequence" then
		local p = { "\1NS" }
		for _, k in v.Keypoints do p[#p + 1] = n2s(k.Time) p[#p + 1] = n2s(k.Value) p[#p + 1] = n2s(k.Envelope) end
		return tconcat(p, "|")
	end
	if rawget(v, "_path") and getmetatable(v) == AnyMT then return "\1?|stub" end
	return "\1?|" .. (ty or "table")
end

local NOOP = function() end

local function dec(v)
	if type(v) ~= "string" or byte(v, 1) ~= 1 then return v end
	local bar = find(v, "|", 1, true)
	local tag = sub(v, 2, (bar or 0) - 1)
	if tag == "x" then error(sub(v, 4), 3) end
	if tag == "s" then return sub(v, 4) end
	if tag == "N" then return NOOP end
	if tag == "A" then return anything(sub(v, 4)) end
	local p = split(sub(v, bar + 1), "|")
	if tag == "I" then return wrap(tonumber(p[1]), p[2]) end
	if tag == "U2" then return newUDim2(tonumber(p[1]), tonumber(p[2]), tonumber(p[3]), tonumber(p[4])) end
	if tag == "U" then return newUDim(tonumber(p[1]), tonumber(p[2])) end
	if tag == "V2" then return newV2(tonumber(p[1]), tonumber(p[2])) end
	if tag == "C3" then return newC3(tonumber(p[1]), tonumber(p[2]), tonumber(p[3])) end
	if tag == "E" then return Enum[p[1]][p[2]] end
	if tag == "V3" then return newV3(tonumber(p[1]), tonumber(p[2]), tonumber(p[3])) end
	if tag == "R" then return newRect(tonumber(p[1]), tonumber(p[2]), tonumber(p[3]), tonumber(p[4])) end
	if tag == "NR" then return newNR(tonumber(p[1]), tonumber(p[2])) end
	if tag == "F" then return newFont(p[1], tonumber(p[2]), Enum.FontStyle[p[3]]) end
	if tag == "CS" then
		local k = {}
		for i = 1, #p, 4 do k[#k + 1] = newCSK(tonumber(p[i]), newC3(tonumber(p[i + 1]), tonumber(p[i + 2]), tonumber(p[i + 3]))) end
		return setmetatable({ Keypoints = k }, CSMT)
	end
	if tag == "NS" then
		local k = {}
		for i = 1, #p, 3 do k[#k + 1] = newNSK(tonumber(p[i]), tonumber(p[i + 1]), tonumber(p[i + 2])) end
		return setmetatable({ Keypoints = k }, NSMT)
	end
	if tag == "L" then
		local list = {}
		for i = 1, #p - 1, 2 do list[#list + 1] = wrap(tonumber(p[i]), p[i + 1]) end
		return list
	end
	if tag == "IO" then
		-- InputObject: KeyCode|UserInputType|UserInputState|px|py|pz|dx|dy|dz
		return setmetatable({
			KeyCode = Enum.KeyCode[p[1]], UserInputType = Enum.UserInputType[p[2]], UserInputState = Enum.UserInputState[p[3]],
			Position = newV3(tonumber(p[4]), tonumber(p[5]), tonumber(p[6])), Delta = newV3(tonumber(p[7]), tonumber(p[8]), tonumber(p[9])),
		}, { __type = "InputObject", __index = { IsModifierKeyDown = function() return false end }, __tostring = function() return "InputObject" end })
	end
	return nil
end

local function decAll(...)
	local n = select("#", ...)
	if n == 0 then return end
	if n == 1 then return dec((...)) end
	local t = tpack(...)
	for i = 1, n do t[i] = dec(t[i]) end
	return tunpack(t, 1, n)
end

local function encArgs(...)
	local n = select("#", ...)
	local t = table.create(n)
	for i = 1, n do t[i] = enc((select(i, ...))) end
	return tunpack(t, 1, n)
end

local function idOf(self, method)
	local id = IdOf[self]
	if not id then error("Expected ':' not '.' calling member function " .. method, 3) end
	return id
end

local function jsMethod(name)
	return function(self, ...)
		return dec(H.call(idOf(self, name), name, encArgs(...)))
	end
end

-- ---- methods by class (JS-backed unless written here) ----
local Methods = {}
local function M(cls, t) Methods[cls] = t end

local Tags = setmetatable({}, { __mode = "k" })
local TagSignals = {}
local function tagSignal(tag, kind)
	local key = kind .. ":" .. tag
	TagSignals[key] = TagSignals[key] or newSignal(nil, key)
	return TagSignals[key]
end

M("Instance", {
	FindFirstChild = jsMethod("FindFirstChild"), FindFirstChildOfClass = jsMethod("FindFirstChildOfClass"),
	FindFirstChildWhichIsA = jsMethod("FindFirstChildWhichIsA"), FindFirstAncestor = jsMethod("FindFirstAncestor"),
	FindFirstAncestorOfClass = jsMethod("FindFirstAncestorOfClass"), FindFirstAncestorWhichIsA = jsMethod("FindFirstAncestorWhichIsA"),
	FindFirstDescendant = jsMethod("FindFirstDescendant"), GetChildren = jsMethod("GetChildren"), GetDescendants = jsMethod("GetDescendants"),
	IsA = jsMethod("IsA"), IsDescendantOf = jsMethod("IsDescendantOf"), IsAncestorOf = jsMethod("IsAncestorOf"),
	Clone = jsMethod("Clone"), ClearAllChildren = jsMethod("ClearAllChildren"), GetFullName = jsMethod("GetFullName"),
	GetAttribute = jsMethod("GetAttribute"), SetAttribute = jsMethod("SetAttribute"), GetDebugId = jsMethod("GetDebugId"),
	Destroy = function(self)
		local id = idOf(self, "Destroy")
		H.call(id, "Destroy")
		Callbacks[id] = nil
	end,
	Remove = function(self) self.Parent = nil end,
	GetAttributes = function(self)
		local t = {}
		local names = H.call(idOf(self, "GetAttributes"), "GetAttributeNames")
		if names ~= "" then for _, n in split(names, "\0") do t[n] = self:GetAttribute(n) end end
		return t
	end,
	GetPropertyChangedSignal = function(self, prop) return signalOf(idOf(self, "GetPropertyChangedSignal"), "prop:" .. tostring(prop)) end,
	GetAttributeChangedSignal = function(self, name) return signalOf(idOf(self, "GetAttributeChangedSignal"), "attr:" .. tostring(name)) end,
	WaitForChild = function(self, name, timeout)
		local id = idOf(self, "WaitForChild")
		local c = self:FindFirstChild(name)
		if c then return c end
		if H.call(id, "IsOutsideUI") then return anything(self:GetFullName() .. "." .. tostring(name)) end
		if not coroutine.isyieldable() then error("attempt to yield across metamethod/C-call boundary", 2) end
		local co, done, conn = coroutine.running(), false, nil
		local function finish(v)
			if done then return end
			done = true
			conn:Disconnect()
			resumeThread(co, v)
		end
		conn = self.ChildAdded:Connect(function(child) if child.Name == name then finish(child) end end)
		if timeout then task.delay(timeout, finish, nil) end
		task.delay(5, function()
			if not done then H.log("warn", "Infinite yield possible on '" .. self:GetFullName() .. ":WaitForChild(\"" .. tostring(name) .. "\")'") end
		end)
		return coroutine.yield()
	end,
	HasTag = function(self, tag) return Tags[self] ~= nil and Tags[self][tag] == true end,
	AddTag = function(self, tag) Tags[self] = Tags[self] or {} if not Tags[self][tag] then Tags[self][tag] = true tagSignal(tag, "add"):_fire(self) end end,
	RemoveTag = function(self, tag) if Tags[self] and Tags[self][tag] then Tags[self][tag] = nil tagSignal(tag, "remove"):_fire(self) end end,
	GetTags = function(self) local t = {} for k in Tags[self] or {} do t[#t + 1] = k end return t end,
})
Methods.Instance.findFirstChild = Methods.Instance.FindFirstChild
Methods.Instance.isA = Methods.Instance.IsA
Methods.Instance.destroy = Methods.Instance.Destroy
Methods.Instance.clone = Methods.Instance.Clone
Methods.Instance.getChildren = Methods.Instance.GetChildren

local TweenService -- set after services exist

local LegacyTweens = {}
local function legacyTween(self, goals, dir, style, time, override, cb)
	local id = idOf(self, "TweenPosition")
	local active = LegacyTweens[id]
	if active and active.PlaybackState == Enum.PlaybackState.Playing then
		if not override then return false end
		active:Cancel()
	end
	local tw = TweenService:Create(self, TweenInfo.new(time or 1, enumArg("EasingStyle", style, "Quad"), enumArg("EasingDirection", dir, "Out")), goals)
	LegacyTweens[id] = tw
	if type(cb) == "function" then tw.Completed:Connect(cb) end
	tw:Play()
	return true
end

M("GuiObject", {
	TweenPosition = function(self, pos, dir, style, time, override, cb) return legacyTween(self, { Position = pos }, dir, style, time, override, cb) end,
	TweenSize = function(self, size, dir, style, time, override, cb) return legacyTween(self, { Size = size }, dir, style, time, override, cb) end,
	TweenSizeAndPosition = function(self, size, pos, dir, style, time, override, cb) return legacyTween(self, { Size = size, Position = pos }, dir, style, time, override, cb) end,
})
M("TextBox", { CaptureFocus = jsMethod("CaptureFocus"), ReleaseFocus = jsMethod("ReleaseFocus"), IsFocused = jsMethod("IsFocused") })
M("Tween", { Play = jsMethod("Play"), Pause = jsMethod("Pause"), Cancel = jsMethod("Cancel") })
M("DataModel", {
	GetService = jsMethod("GetService"), FindService = jsMethod("FindService"),
	IsLoaded = function() return true end, BindToClose = NOOP,
})
M("Player", {
	GetMouse = jsMethod("GetMouse"),
	Kick = function(_, msg) H.log("info", "Player:Kick(" .. tostring(msg) .. ")") end,
	IsInGroup = function() return false end, GetRankInGroup = function() return 0 end, GetRoleInGroup = function() return "Guest" end,
	GetFriendsOnline = function() return {} end, LoadCharacter = NOOP, GetJoinData = function() return {} end,
	IsFriendsWith = function() return false end, HasAppearanceLoaded = function() return true end,
})
M("Humanoid", {
	TakeDamage = function(self, n) self.Health = math.max(0, self.Health - (tonumber(n) or 0)) end,
	ChangeState = NOOP, GetState = function() return Enum.HumanoidStateType.Running end, MoveTo = NOOP, Move = NOOP,
	EquipTool = NOOP, UnequipTools = NOOP, SetStateEnabled = NOOP,
	LoadAnimation = function() return setmetatable({}, { __index = function(_, k) if k == "Stopped" or k == "Ended" or k == "KeyframeReached" then return newSignal(nil, k) end return NOOP end }) end,
})
M("Sound", {
	Play = function(self) self.Playing = true signalOf(IdOf[self], "Played"):_fire(self.SoundId) end,
	Stop = function(self) self.Playing = false signalOf(IdOf[self], "Stopped"):_fire(self.SoundId) end,
	Pause = function(self) self.Playing = false signalOf(IdOf[self], "Paused"):_fire(self.SoundId) end,
	Resume = function(self) self.Playing = true signalOf(IdOf[self], "Resumed"):_fire(self.SoundId) end,
})
M("BindableEvent", { Fire = function(self, ...) signalOf(idOf(self, "Fire"), "Event"):_fire(...) end })
M("BindableFunction", {
	Invoke = function(self, ...)
		local cb = Callbacks[idOf(self, "Invoke")]
		cb = cb and cb.OnInvoke
		if not cb then error("OnInvoke is not set for " .. self:GetFullName(), 2) end
		return cb(...)
	end,
})
local function remoteLog(self, method, ...) H.log("info", self:GetFullName() .. ":" .. method .. "(" .. fmt(...) .. ") — no server in the builder") end
M("RemoteEvent", { FireServer = function(self, ...) remoteLog(self, "FireServer", ...) end })
M("UnreliableRemoteEvent", { FireServer = function(self, ...) remoteLog(self, "FireServer", ...) end })
M("RemoteFunction", { InvokeServer = function(self, ...) remoteLog(self, "InvokeServer", ...) return nil end })

-- ---- member lookup ----
local memberCache = {}
local function membersOf(cls)
	local m = memberCache[cls]
	if m then return m end
	m = {}
	local chain = {}
	local c = cls
	while c do
		table.insert(chain, 1, c)
		local info = CLASSES[c]
		c = info and info.base or (c ~= "Instance" and "Instance" or nil)
	end
	for _, name in chain do
		local info = CLASSES[name]
		if info then for _, ev in info.events do m[ev] = true end end
		for k, f in Methods[name] or {} do m[k] = f end
	end
	memberCache[cls] = m
	return m
end

InstanceMT.__index = function(self, key)
	local id = IdOf[self]
	local member = membersOf(ClassOf[id] or "Instance")[key]
	if member ~= nil then
		if member == true then return signalOf(id, key) end
		return member
	end
	local cb = Callbacks[id]
	if cb and cb[key] ~= nil then return cb[key] end
	local v = H.get(id, key)
	if type(v) == "string" and byte(v, 1) == 1 then
		if sub(v, 2, 2) == "x" then error(sub(v, 4), 2) end
		return dec(v)
	end
	return v
end
InstanceMT.__newindex = function(self, key, value)
	local id = IdOf[self]
	if type(value) == "function" and (key == "OnInvoke" or key == "OnClientInvoke" or key == "OnServerInvoke" or key == "ProcessReceipt") then
		Callbacks[id] = Callbacks[id] or {}
		Callbacks[id][key] = value
		return
	end
	local err = H.set(id, key, enc(value))
	if err then error(err, 2) end
end
InstanceMT.__tostring = function(self) return H.get(IdOf[self], "Name") end
InstanceMT.__metatable = "The metatable is locked"

local function typeofValue(v)
	if type(v) == "table" then
		if IdOf[v] or getmetatable(v) == AnyMT then return "Instance" end
		local ty = typeName(v)
		if ty then return ty end
	end
	return rawtypeof(v)
end

-- ---- services ----
local game = wrap(INIT.game, "DataModel")
local function service(name) return game:GetService(name) end
TweenService = service("TweenService")
local UIS = service("UserInputService")
local RunService = service("RunService")
local Players = service("Players")
local LocalPlayer = wrap(INIT.player, "Player")

local function serviceMethods(cls, t) Methods[cls] = t memberCache = {} end

serviceMethods("TweenService", {
	Create = function(_, inst, info, goals)
		local id = IdOf[inst]
		if not id then error("Unable to cast value to Object", 2) end
		if typeName(info) ~= "TweenInfo" then error("Unable to cast to TweenInfo", 2) end
		if type(goals) ~= "table" then error("Unable to cast to Dictionary", 2) end
		local flat = {}
		for k, v in goals do flat[#flat + 1] = k flat[#flat + 1] = enc(v) end
		return dec(H.call(INIT.tweenService, "Create", id, info.Time, info.EasingStyle.Name, info.EasingDirection.Name, info.RepeatCount, info.Reverses, info.DelayTime, tunpack(flat)))
	end,
	GetValue = function(_, alpha, style, dir) return H.call(INIT.tweenService, "GetValue", alpha, enumArg("EasingStyle", style, "Quad").Name, enumArg("EasingDirection", dir, "Out").Name) end,
})

local RenderBindings = {}
serviceMethods("RunService", {
	IsClient = function() return true end, IsServer = function() return false end, IsStudio = function() return false end,
	IsRunning = function() return true end, IsRunMode = function() return false end, IsEdit = function() return false end,
	BindToRenderStep = function(self, name, _priority, fn)
		if RenderBindings[name] then RenderBindings[name]:Disconnect() end
		RenderBindings[name] = self.RenderStepped:Connect(fn)
	end,
	UnbindFromRenderStep = function(_, name) if RenderBindings[name] then RenderBindings[name]:Disconnect() RenderBindings[name] = nil end end,
})

local CASBound = {}
serviceMethods("UserInputService", {
	GetMouseLocation = jsMethod("GetMouseLocation"), IsKeyDown = jsMethod("IsKeyDown"), IsMouseButtonPressed = jsMethod("IsMouseButtonPressed"),
	GetFocusedTextBox = jsMethod("GetFocusedTextBox"), GetLastInputType = jsMethod("GetLastInputType"),
	GetKeysPressed = function() return {} end, GetGamepadConnected = function() return false end, GetConnectedGamepads = function() return {} end,
	GetMouseDelta = function() return Vector2.zero end, GetStringForKeyCode = function(_, kc) return kc.Name end,
	GetNavigationGamepads = function() return {} end, GetSupportedGamepadKeyCodes = function() return {} end,
})
serviceMethods("GuiService", {
	GetGuiInset = jsMethod("GetGuiInset"), IsTenFootInterface = function() return false end,
	OpenBrowserWindow = NOOP, AddSelectionParent = NOOP, RemoveSelectionGroup = NOOP, Select = NOOP, CloseInspectMenu = NOOP,
})
serviceMethods("Players", {
	GetPlayers = function() return { LocalPlayer } end,
	GetPlayerFromCharacter = function(_, ch) return ch == LocalPlayer.Character and LocalPlayer or nil end,
	GetPlayerByUserId = function(_, id) return id == LocalPlayer.UserId and LocalPlayer or nil end,
	GetUserThumbnailAsync = function(_, id) return "rbxthumb://type=AvatarHeadShot&id=" .. tostring(id) .. "&w=150&h=150", true end,
	GetNameFromUserIdAsync = function() return LocalPlayer.Name end, GetUserIdFromNameAsync = function() return LocalPlayer.UserId end,
	GetHumanoidDescriptionFromUserId = NOOP,
})
serviceMethods("ContextActionService", {
	BindAction = function(_, name, fn, _touch, ...)
		CASBound[name] = { fn = fn, inputs = { ... }, priority = 0 }
		for _, ev in { "InputBegan", "InputChanged", "InputEnded" } do listen(signalOf(INIT.uis, ev)) end
	end,
	BindActionAtPriority = function(self, name, fn, touch, priority, ...)
		self:BindAction(name, fn, touch, ...)
		CASBound[name].priority = priority or 0
	end,
	UnbindAction = function(_, name) CASBound[name] = nil end,
	UnbindAllActions = function() CASBound = {} end,
	GetAllBoundActionInfo = function() local t = {} for k in CASBound do t[k] = {} end return t end,
	GetBoundActionInfo = function(_, name) return CASBound[name] and {} or nil end,
	SetTitle = NOOP, SetDescription = NOOP, SetImage = NOOP, SetPosition = NOOP, GetButton = NOOP,
})

-- JSON for HttpService
local function jsonEncode(v, seen)
	local t = type(v)
	if t == "nil" then return "null" end
	if t == "boolean" then return tostring(v) end
	if t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then return "null" end
		return (v == math.floor(v) and math.abs(v) < 1e15) and string.format("%d", v) or string.format("%.14g", v)
	end
	if t == "string" then
		return '"' .. v:gsub('[%c"\\]', function(c)
			local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
			return map[c] or string.format("\\u%04x", byte(c))
		end) .. '"'
	end
	if t ~= "table" then error("Cannot encode " .. t .. " in JSON", 3) end
	seen = seen or {}
	if seen[v] then error("Cannot encode cyclic table in JSON", 3) end
	seen[v] = true
	local out = {}
	if #v > 0 or next(v) == nil then
		for _, x in ipairs(v) do out[#out + 1] = jsonEncode(x, seen) end
		seen[v] = nil
		return "[" .. tconcat(out, ",") .. "]"
	end
	for k, x in v do out[#out + 1] = jsonEncode(tostring(k)) .. ":" .. jsonEncode(x, seen) end
	seen[v] = nil
	return "{" .. tconcat(out, ",") .. "}"
end
local function jsonDecode(s)
	local i = 1
	local function ws() i = find(s, "[^ \t\r\n]", i) or #s + 1 end
	local value
	local function str()
		local out, j = {}, i + 1
		while true do
			local c = sub(s, j, j)
			if c == "" then error("Can't parse JSON", 4) end
			if c == '"' then i = j + 1 return tconcat(out) end
			if c == "\\" then
				local e = sub(s, j + 1, j + 1)
				local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
				if e == "u" then out[#out + 1] = utf8.char(tonumber(sub(s, j + 2, j + 5), 16)) j += 6
				else out[#out + 1] = map[e] or e j += 2 end
			else out[#out + 1] = c j += 1 end
		end
	end
	function value()
		ws()
		local c = sub(s, i, i)
		if c == "{" then
			i += 1 local t = {} ws()
			if sub(s, i, i) == "}" then i += 1 return t end
			while true do
				ws() local k = str() ws() i += 1
				t[k] = value() ws()
				local d = sub(s, i, i) i += 1
				if d == "}" then return t end
				if d ~= "," then error("Can't parse JSON", 3) end
			end
		elseif c == "[" then
			i += 1 local t = {} ws()
			if sub(s, i, i) == "]" then i += 1 return t end
			while true do
				t[#t + 1] = value() ws()
				local d = sub(s, i, i) i += 1
				if d == "]" then return t end
				if d ~= "," then error("Can't parse JSON", 3) end
			end
		elseif c == '"' then return str()
		elseif sub(s, i, i + 3) == "true" then i += 4 return true
		elseif sub(s, i, i + 4) == "false" then i += 5 return false
		elseif sub(s, i, i + 3) == "null" then i += 4 return nil
		end
		local num = string.match(s, "^-?%d+%.?%d*[eE]?[-+]?%d*", i)
		if not num or num == "" then error("Can't parse JSON", 3) end
		i += #num
		return tonumber(num)
	end
	local ok, v = pcall(value)
	if not ok then error("Can't parse JSON", 2) end
	return v
end
local function guid(braces)
	local r = Random.new()
	local g = string.gsub("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx", "[xy]", function(c)
		local v = c == "x" and r:NextInteger(0, 15) or r:NextInteger(8, 11)
		return string.format("%X", v)
	end)
	return braces == false and g or "{" .. g .. "}"
end
serviceMethods("HttpService", {
	JSONEncode = function(_, v) return jsonEncode(v) end, JSONDecode = function(_, s) return jsonDecode(s) end,
	GenerateGUID = function(_, b) return guid(b) end,
	UrlEncode = function(_, s) return (tostring(s):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", byte(c)) end)) end,
	GetAsync = function() error("Http requests can only be executed by game server", 2) end,
	PostAsync = function() error("Http requests can only be executed by game server", 2) end,
	RequestAsync = function() error("Http requests can only be executed by game server", 2) end,
})
serviceMethods("TextService", { GetTextSize = jsMethod("GetTextSize") })
serviceMethods("MarketplaceService", {
	PromptProductPurchase = function(_, _p, id) H.log("info", "MarketplaceService:PromptProductPurchase(" .. tostring(id) .. ") — purchase prompts don't open in the builder") end,
	PromptGamePassPurchase = function(_, _p, id) H.log("info", "MarketplaceService:PromptGamePassPurchase(" .. tostring(id) .. ") — purchase prompts don't open in the builder") end,
	PromptPurchase = function(_, _p, id) H.log("info", "MarketplaceService:PromptPurchase(" .. tostring(id) .. ")") end,
	PromptPremiumPurchase = NOOP, PromptSubscriptionPurchase = NOOP, PromptBundlePurchase = NOOP,
	UserOwnsGamePassAsync = function() return false end, PlayerOwnsAsset = function() return false end, PlayerOwnsBundle = function() return false end,
	GetProductInfo = function(_, id) return { Name = "Product " .. tostring(id), Description = "", PriceInRobux = 0, IconImageAssetId = 0, AssetId = id, ProductId = id, IsForSale = true } end,
	IsPlayerSubscribed = function() return false end,
})
serviceMethods("TeleportService", {
	Teleport = function(_, place) H.log("info", "TeleportService:Teleport(" .. tostring(place) .. ") — teleports are disabled in the builder") end,
	TeleportAsync = function(_, place) H.log("info", "TeleportService:TeleportAsync(" .. tostring(place) .. ")") end,
	TeleportToPlaceInstance = NOOP, SetTeleportGui = NOOP, GetLocalPlayerTeleportData = NOOP, GetArrivingTeleportGui = NOOP,
})
serviceMethods("Debris", { AddItem = function(_, item, t) task.delay(tonumber(t) or 10, function() if item.Parent ~= nil then item:Destroy() end end) end })
serviceMethods("CollectionService", {
	GetTagged = function() return {} end, HasTag = function(_, i, t) return i:HasTag(t) end, AddTag = function(_, i, t) i:AddTag(t) end,
	RemoveTag = function(_, i, t) i:RemoveTag(t) end, GetTags = function(_, i) return i:GetTags() end, GetAllTags = function() return {} end,
	GetInstanceAddedSignal = function(_, tag) return tagSignal(tag, "add") end,
	GetInstanceRemovedSignal = function(_, tag) return tagSignal(tag, "remove") end,
})
serviceMethods("StarterGui", { SetCore = NOOP, GetCore = NOOP, SetCoreGuiEnabled = NOOP, GetCoreGuiEnabled = function() return true end })
serviceMethods("SoundService", { PlayLocalSound = NOOP, SetListener = NOOP })
serviceMethods("PolicyService", {
	GetPolicyInfoForPlayerAsync = function()
		return { AreAdsAllowed = true, ArePaidRandomItemsRestricted = false, AllowedExternalLinkReferences = {}, IsPaidItemTradingAllowed = true, IsSubjectToChinaPolicies = false, IsContentSharingAllowed = true }
	end,
})
serviceMethods("LocalizationService", { GetTranslatorForPlayerAsync = function() return setmetatable({}, { __index = function() return function(_, s) return s end end }) end, GetCountryRegionForPlayerAsync = function() return "US" end })
serviceMethods("SocialService", { PromptGameInvite = NOOP, CanSendGameInviteAsync = function() return false end })
serviceMethods("BadgeService", { UserHasBadgeAsync = function() return false end, GetBadgeInfoAsync = function() return { Name = "Badge", Description = "", IconImageId = 0, IsEnabled = true } end })
serviceMethods("ContentProvider", { PreloadAsync = function(_, list, cb) if type(cb) == "function" then for _, x in list do cb(tostring(x), Enum.AssetFetchStatus.Success) end end end })

-- ========== globals ==========
local function makeTick() return epochOffset + H.now() end
local loopCounter = 0
local function rbxc()
	loopCounter += 1
	if loopCounter >= 20000 then
		loopCounter = 0
		if H.chk() then error("Script timeout: exhausted allowed execution time", 2) end
	end
end

local Modules = {}
local function requireModule(m)
	if type(m) == "number" then error("require(assetId) can't load packages in the builder; include the ModuleScript in your .rblxui", 2) end
	if getmetatable(m) == AnyMT then return m end
	local id = IdOf[m]
	if not id then error("Attempted to call require with invalid argument(s).", 2) end
	local rec = Modules[id]
	if rec then
		if rec.loading then error("Requested module was required recursively", 2) end
		return rec.value
	end
	if ClassOf[id] ~= "ModuleScript" and not m:IsA("ModuleScript") then error("Attempted to call require with invalid argument(s).", 2) end
	rec = { loading = true }
	Modules[id] = rec
	local fn = H.call(id, "LoadModule")
	if type(fn) == "string" then Modules[id] = nil error(dec(fn), 2) end
	local results = tpack(pcall(fn))
	-- Forget a failed module so the next require reports its real error again.
	if not results[1] then Modules[id] = nil error(results[2], 0) end
	rec.loading = false
	if results.n ~= 2 then Modules[id] = nil error("Module code did not return exactly one value", 2) end
	rec.value = results[2]
	return rec.value
end

local Gshared = {}
local Gglobal = {}
local Workspace = service("Workspace")

local globals = {
	game = game, Game = game, workspace = Workspace, Workspace = Workspace,
	Instance = {
		new = function(cls, parent)
			-- Who asked for it: the calling line, plus the first line in another script so a shared helper
			-- (a UI kit's make function) doesn't hide which screen created the element.
			local origin, first
			for lvl = 2, 12 do
				local src, line = debug.info(lvl, "sl")
				if not src then break end
				if line and line > 0 then
					local name = string.gsub(src, "^[=@]", "")
					local here = `{string.match(name, "([^%.]+%.[^%.]+)$") or name}:{line}`
					if not first then first, origin = src, here
					elseif src ~= first then origin = `{origin} ← {here}` break end
				end
			end
			local inst = dec(H.call(INIT.game, "CreateInstance", tostring(cls), origin))
			if parent ~= nil then inst.Parent = parent end
			return inst
		end,
		fromExisting = function(i) return i:Clone() end,
	},
	Enum = Enum, UDim = UDim, UDim2 = UDim2, Vector2 = Vector2, Vector3 = Vector3, Color3 = Color3, Rect = Rect,
	NumberRange = NumberRange, ColorSequence = ColorSequence, ColorSequenceKeypoint = { new = newCSK },
	NumberSequence = NumberSequence, NumberSequenceKeypoint = { new = newNSK }, Font = Font, TweenInfo = TweenInfo,
	CFrame = CFrame, BrickColor = BrickColor, Random = Random, DateTime = DateTime,
	task = task,
	wait = function(t) local e = task.wait(math.max(tonumber(t) or 0, 0.029)) return e, now - startClock end,
	spawn = function(f) task.defer(f) end,
	delay = function(t, f) task.delay(t, f) end,
	tick = makeTick, time = function() return H.now() - startClock end, elapsedTime = function() return H.now() - startClock end,
	typeof = typeofValue,
	print = function(...) H.log("out", fmt(...)) end,
	warn = function(...) H.log("warn", fmt(...)) end,
	require = requireModule,
	shared = Gshared, _G = Gglobal,
	settings = function() return setmetatable({}, { __index = function() return setmetatable({}, { __index = function() return NOOP end }) end }) end,
	UserSettings = function() return setmetatable({}, { __index = function(_, k) if k == "GetService" then return function() return setmetatable({}, { __index = function() return 1 end }) end end return NOOP end }) end,
	__rbxc = rbxc,
}
for k, v in globals do G[k] = v end
G.loadstring = nil
G.getfenv, G.setfenv = getfenv, setfenv

local GMT = { __index = G }

-- ========== entry points (called from JS) ==========
local api = {}

function api.env(scriptId, cls)
	return setmetatable({ script = wrap(scriptId, cls) }, GMT)
end

function api.run(fn)
	spawnfn(fn)
	flushDeferred()
end

local function casDispatch(key, input, gp)
	if input.KeyCode == nil then return end
	local state = key == "InputBegan" and Enum.UserInputState.Begin or key == "InputEnded" and Enum.UserInputState.End or Enum.UserInputState.Change
	for name, b in CASBound do
		for _, want in b.inputs do
			if want == input.KeyCode or want == input.UserInputType then
				spawnfn(b.fn, name, state, input)
				break
			end
		end
	end
end

function api.fire(id, key, ...)
	if id == INIT.uis and next(CASBound) and (key == "InputBegan" or key == "InputEnded" or key == "InputChanged") then
		local input, gp = dec((...)), select(2, ...)
		casDispatch(key, input, gp)
		local s = Signals[id]
		local sig = s and s[key]
		if sig then sig:_fire(input, gp) end
		flushDeferred()
		return
	end
	local s = Signals[id]
	local sig = s and s[key]
	if sig then sig:_fire(decAll(...)) end
	flushDeferred()
end

function api.step(t, dt)
	now = t
	local run = Signals[INIT.runService]
	if run then
		if run.PreRender then run.PreRender:_fire(dt) end
		if run.RenderStepped then run.RenderStepped:_fire(dt) end
	end
	if #sleeping > 0 then
		local list = sleeping
		sleeping = {}
		for _, s in list do
			if s.at <= now then
				if s.args then resumeThread(s.co, tunpack(s.args, 1, s.args.n))
				else resumeThread(s.co, now - s.start) end
			else
				sleeping[#sleeping + 1] = s
			end
		end
	end
	if run then
		if run.Stepped then run.Stepped:_fire(now - startClock, dt) end
		if run.Heartbeat then run.Heartbeat:_fire(dt) end
		if run.PostSimulation then run.PostSimulation:_fire(dt) end
	end
	flushDeferred()
	local nextAt = math.huge
	for _, s in sleeping do if s.at < nextAt then nextAt = s.at end end
	local frames = false
	if run then
		for _, k in { "RenderStepped", "Heartbeat", "Stepped", "PreRender", "PostSimulation" } do
			if run[k] and (#run[k]._conns > 0 or #run[k]._waiting > 0) then frames = true end
		end
	end
	return nextAt == math.huge and -1 or math.max(0, nextAt - now), frames
end

-- Destroyed instances drop their connections like in Roblox.
function api.dropped(id)
	Signals[id] = nil
	Callbacks[id] = nil
end

return api
