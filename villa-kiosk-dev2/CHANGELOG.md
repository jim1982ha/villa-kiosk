## 2.496.906

- **Pictures view waits for Settings' Save.** Turned on in Advanced Settings, then Back, it now lights Settings'
  Save: Save switches this device to the pictures, Cancel drops it. Before, Save stayed grey.

## 2.496.905

- **Pictures view's On / Off sits at the end of its line,** as Maintenance mode's does, instead of under its name.

## 2.496.904

- **The pictures switch is in Advanced Settings.** Advanced Settings › Villa › This device has a "Pictures view"
  switch: turn it on and press Save, and VESTA UI opens again showing the villa as pictures on this device. Turn it
  off and Save to go back to the 3D villa. The menu item from 2.496.903 is gone; "Show the 3D villa" stays in the menu
  of a device showing the pictures.
- **Switching the view works when the address asks for one.** If VESTA UI's address ended with "?view=3d", switching
  to the pictures did nothing: the page opened in 3D again. Switching now opens the page without it.

## 2.496.903

- **The villa pictures follow the 3D view more closely.** An LED strip now lights the floor along its whole length,
  as in the 3D view, instead of in a few spots. A ceiling fan turns at the speed it is set to, slow when it is slow.
  A fan that a profile may not see is drawn still for that profile, as its lamps and curtains already were. The
  Owner's computer makes the new pictures by itself the next time it opens VESTA UI.
- **Show the villa as pictures on any device.** The menu has a new item, "Show the villa as pictures", on a device
  that shows the 3D villa. "Show the 3D villa" in the same menu goes back.

## 2.496.902

- **A light that is on shows as in the 3D view on the villa pictures.** Each of its lamps now lights at its own place,
  a bright bulb with a soft pool of light around it, instead of one glow at the light's badge. The Owner's computer
  makes the new pictures by itself the next time it opens VESTA UI.

## 2.496.901

- **Each ceiling fan turns at its own place and size on the villa pictures.** Where one switch drives several fans
  (a terrace's), they were drawn as one big fan between them. Each fan is now drawn on its own, at its real size, as
  in the 3D view (2.496.900 drew every fan larger than its badge: undone). The Owner's computer makes the new
  pictures by itself the next time it opens VESTA UI.

## 2.496.900

- **A turning ceiling fan can be seen on the villa pictures.** Its blades were drawn at their real size, which on a TV
  is smaller than the fan's badge drawn over them, so they turned out of sight. They are now drawn around the badge.

## 2.496.899

- **A ceiling fan turns on the villa pictures.** The red circle is gone: the pictures are now made without the ceiling
  fans, and their blades are drawn at their real size, turning while the fan is on, as in the 3D view. A ventilation
  fan stays as it is in the picture and never turns. The Owner's computer makes the new pictures by itself the next
  time it opens VESTA UI.
- **The light of a lamp that is on is smaller**, a soft glow just around its place.

## 2.496.898

- **The villa pictures have a sky.** Around the floors, the sky now takes the colour of the moment: blue by day,
  warm at dusk and dawn, dark at night (and follows the Day or Night preview in Settings). The sun by day and the moon
  by night, in its real phase, sit where they really are, seen from above with north up. Nothing heavy is loaded.

## 2.496.897

- **A fan that is on and a drawn curtain now show on the villa pictures.** A fan that is on has a turning ring around
  its badge. The pictures are now made with every curtain open, and a curtain that is closed (or part-way) is drawn
  over them at its place, as the 3D view shows it. The Owner's computer makes the new pictures by itself the next
  time it opens VESTA UI.

## 2.496.896

- **A lamp that is on now shows on the villa pictures.** The pictures are taken with every lamp off, and nothing drew
  the lamps that are on over them. Each lamp that is on now shows as a warm pool of light at its place, as the 3D view
  lights it.

## 2.496.895

- **The villa pictures show the house larger.** They are now framed on the house instead of the whole plot, so each
  floor fills more of the screen. The next time the Owner opens VESTA UI on a computer, new pictures are made by
  themselves.
- **A room glow can be seen from across the room.** On the pictures, a room in use or needing attention now has a
  solid outline and a stronger colour.
- **The summary tiles stay before any pictures exist.** Until the first pictures are made, every device placed on the
  map counts, as before.
- **A way back to the 3D villa.** On a device that shows the pictures, the menu has "Show the 3D villa". It tries the
  3D villa on the next opening (it may be slow on that device).
- **A TV is recognised in more cases** (a browser that says "Smart TV").

## 2.496.894

- **The two floors sit side by side on a wide screen.** On a TV or a computer the pictures show 1F on the left and
  2F on the right, so each floor is larger. On a phone held upright they stay stacked, 2F over 1F.
- **No Display profile any more.** VESTA UI has its three profiles again: Owner, Facility Manager and Guest. A device
  that cannot show the 3D villa shows the pictures whichever profile is signed in, with that profile's usual rights.

## 2.496.893

- **A device too weak for the 3D villa shows pictures of it instead.** As VESTA UI opens, it checks the device first
  (a TV, a weak graphics chip, little memory, or a past crash or slow 3D load on that device). Such a device never
  loads the 3D villa: it shows a picture of each floor from above, 2F over 1F, with every badge live on it and rooms
  glowing as on the 3D map. Tapping a badge opens the device. Badges that would overlap become one group badge with
  a count. On a TV, the remote's arrows move between badges and OK opens one.
- **The pictures are made by themselves.** When the Owner opens VESTA UI on a computer or Android phone and leaves
  it still for a moment, it takes the pictures of both floors, by day and by night, and keeps them for every other
  device. A new model or a moved device makes new ones. Until the first set is made, the pictures screen says so.
- **New profile: Display.** It shows the villa and every device but switches nothing, opens no ticket and changes no
  setting. It needs no passcode, and opens only inside the villa's system. A device that shows the pictures opens
  as Display by itself.

## 2.496.892

- **Opening the villa can no longer crash a slow device twice.** If a device stopped in the middle of opening the 3D
  villa (it ran out of memory, or the whole device crashed), VESTA no longer tries again the next time it opens. It
  says so, with a "Try once more" button. Until now it took two such stops in a row within 90 seconds.
- **A device still opening the villa after 3 minutes stops trying.** It frees its memory at once instead of carrying
  on in the background, which is what crashed a TV.
- **Both cases report how far the device got** (Settings › Advanced › Device telemetry), even when the device
  crashed: it keeps its progress as it goes.

## 2.496.891

- **A device too slow for the 3D villa reports how far it got.** When the villa's model is still opening after 3
  minutes, the device now sends a report: how many shapes and textures it had opened, its graphics chip, and its
  processor and memory. It shows in Settings › Advanced › Device telemetry. This tells what to make lighter for a
  slow screen such as a TV.

## 2.496.890

- **A device too slow for the 3D villa says so.** When a device was still opening the villa's model after 3 minutes,
  it said the model was too heavy and offered to upload a lighter one. When the model is within the size limit, the
  device is what is too slow (a TV, for example) and another file would not help. It now says "This device is too
  slow to show the 3D villa", how long it tried, and that the villa opens on a faster device. No upload is offered.

## 2.496.889

- **Colours back as they were in 2.496.887.** Usual is green again and in use is red, on every device, in every
  theme and in the colour key. The red and green swap of 2.496.888 is undone.

## 2.496.888

- **Usual is red, in use is green.** The two colours are swapped everywhere at once: the status pills, the history
  bars, the switches and padlocks, the rooms and devices on the 3D map, and the colour key. A light off or a door
  locked is now red; a light on or a door unlocked is green. Green for "all well" does not change: the online dot, a
  check that passed, the "all well" strip and a recovery stay green.

## 2.496.887

- **A follow-up on an alert starts with ⚙️ alone.** A reminder, an escalation or a "still open" line used to start
  with ⚠️ ⚙️. It now starts with ⚙️ only, and ⚠️ is kept for a new alert. VESTA UI reads both marks the same way as
  before. A message from before this update that still starts with ⚠️ ⚙️ may show as new until its next step.

## 2.496.886

- **A device needing attention breathes smoothly inside a group too.** When it sat in a group of devices on the map,
  its badge flashed back to full brightness for an instant about twice a second while it faded in and out. It now
  breathes as smoothly as a badge on its own. The same goes for a room's count when that room is urgent.

## 2.496.885

- **A camera's siren or linked switch is plain while off.** The button beside the camera's arrows was filled green
  while the siren was off, which looked as if it were on. It now looks like the camera's other buttons while off, and
  is filled red only while the siren (or the linked switch) is on, or a linked door is unlocked.

## 2.496.884

- **A button that acts is in the colour of where it leads.** "Lock door" is green, the colour of locked; "Unlock door…"
  red, the colour of unlocked. "Turn off" is green and "Turn on" red, a blind's Close green and Open red (Stop stays
  plain), Play / Pause the colour of what it switches to, and the same for the buttons over a room or floor heading in
  a list. These buttons are drawn as before 2.496.883: a light tint with a coloured outline and coloured words, not a
  solid fill. A list's switch and padlock, and the chosen mode, speed or light colour, still show the state right now.

## 2.496.883

- **Every control of a device is filled in its state's colour.** In a device's window, the buttons now take the colour
  of the pill above them, the state right now: "Lock door" is red while the door is unlocked, "Unlock door…" green
  while it is locked; "Turn on" / "Turn off", a blind's Open, Stop and Close, Play / Pause and the chosen mode, speed or
  light colour follow the same rule. Their words and icon still say what a tap does. The buttons over a room or floor
  heading in a list do the same: red while any device in it is in use, green when all rest. The device's family colour
  stays on its icon only.

## 2.496.882

- **Switches and padlocks are filled in their state's colour.** A locked door's padlock is filled green, an unlocked
  one red; a switch that is off has a green track, on a red one, the white knob's position saying which. A camera's
  button for its linked device is filled the same way. This replaces 2.496.881's green outline, as you chose.

## 2.496.881

- **Switches and padlocks show their state's colour at rest too.** A locked door's padlock is now green, like its
  "Locked" pill and its history, drawn on the quiet background; unlocked, it stays filled red. A switch that is off has
  a green knob on the quiet track; on, the track is red. The same on a camera's button for its linked device: its icon
  is green at rest. The legend says so.

## 2.496.880

- **Room badges: the number's pill is centred.** On the map, the small rounded pill holding a room's device count sat
  a little high in its badge; it is now centred top to bottom, on every line of a badge that lists several rooms.

## 2.496.879

- **One colour code, the same everywhere.** Seven rules now decide every colour: a colour says what is true now, never
  what a tap will do; red means "in use" and nothing else; a control is quiet at rest; every part of a device says the
  same thing; what is urgent pulses wherever it shows; the brand green never reports a state; each theme uses its own
  shade of each colour. What you will see change:
  - **Switches and padlocks in lists:** a switch that is on is now red (it was green), off stays quiet. A padlock is
    quiet when the door is locked and red when it is unlocked. (2.496.878 wrongly said a critical door's padlock is
    amber: it is red like every unlocked door; its problem is the amber "!" on its badge.)
  - **Buttons in a device's window** ("Unlock door…", "Lock door", "Turn on", "Turn off", "Open", "Close") are plain
    now; the pill above them says the state in colour. Unlocking still asks first.
  - **Cockpit:** "on schedule", "pass" and other all-well strips use the status green; a ticket in progress and a
    watch are blue (in between).
  - **Errors** (an action that failed, an error line, extreme weather or UV, unusual energy use) are amber like every
    problem; the connection lost is grey. Delete and remove buttons are plain and still ask first.
  - **The legend** says exactly this, including that a critical door left unlocked is red as a door and amber in its
    "!".
  - **Room numbers on the map** pulse for an alarm or a critical device gone silent, as their badges do.
  - **A critical device that lost contact** is amber in its history bar too, and its 3D object pulses amber; a jammed
    or silent critical lock breathes amber in 3D.
  - **Dark and night themes:** the 3D villa, room glows, camera beams and room numbers use each theme's own shades.

## 2.496.878

- **A lock shows a padlock, not an on/off switch.** In every list of devices (a room, a floor, Locks, the search), a
  lock's switch is now a padlock: closed and green when the door is locked, open and red when it is unlocked (amber for
  a door on the critical list). Tapping it does what it shows: "Lock" at once, "Unlock…" only after you confirm. The
  same padlock and words appear for a lock linked to another device, in its window and on a camera's buttons. A room
  or floor heading over locks only shows a padlock too, "Lock" when one is unlocked and "Unlock…" when all are locked,
  still asked first.

## 2.496.877

- **Camera window: the two arrows that change camera sit together, and "Fit to screen" shows only when it helps.** On
  a phone held sideways, "Previous camera" is now right above "Next camera". "Fit to screen" now appears only when the
  stream's picture is smaller than the view in both directions; a picture that already fills the view one way looks the
  same either way, so the button is left out.
- **Guest profile: the microphone has its word too.** In the top bar, the microphone now reads "Voice" under its icon,
  like Search and Menu beside it.

## 2.496.876

- **A little less work on each update from the villa.** When readings arrive, the list of battery sensors is no longer
  rebuilt from every device; only the devices that just reported are looked at. Nothing changes on screen.

## 2.496.875

- **An object can no longer be hidden from its device's card; the unused code is removed.** Since 2.496.868 the
  "3D object" line of a device's card in Devices only offers the ✕ that gives a moved object back to the model's own
  device; the old way to hide an object, which no screen offered any more, is gone. An object hidden that way before
  still shows nothing on the map, and still appears, as "shows nothing yet", in the "Add a 3D object…" search of a
  device not on the map, where picking it shows that device on it again.

## 2.496.874

- **Screens change layout at fewer widths.** The app now switches between its phone, sideways-phone, small-tablet,
  desktop and wide layouts at five fixed screen widths instead of eight. Only screens between 481 and 640 pixels wide
  (a narrow computer window, rarely a phone) and between 1001 and 1023 look different:
  - 481 to 640 wide: the Weather window shows its phone tiles (smaller dials, temperature across the width), the
    Energy window its ranked rows, Map colours & keys one column, two side-by-side settings stack, and an announcement's
    text is a size smaller, as a phone already shows them.
  - 1001 to 1023 wide: the top bar sits a little closer to the edges, as it already did up to 1000.
  Phones, iPads and wall tablets look exactly as before.

## 2.496.873

- **Nothing changes on screen.** A badge's reading line (a device group's readings joined, "24°C  ·  58%", and cut
  with "…" when it would not fit) is now its own small piece that a check runs with real values. The badges read
  exactly as before.

## 2.496.872

- **Small buttons are easier to hit with a finger.** Every choice and tab (Settings, the Cockpit, a device's modes and
  speeds, On | Off), a chart's 1h · 24h · 1w pills, its two range handles and its "from 0" mark, a row's switch and,
  on a tablet, the buttons over the villa now answer a tap anywhere in a 44px square around them. They look exactly
  as before. The rows of the top-right menu are 2px taller, for the same reason.

## 2.496.871

- **Smoother moves over the villa.** While you turn, pan or walk, the frosted buttons and bars over the villa keep
  their colour but drop their blur, so the screen has less to redraw on each frame. The moment the view is still,
  the frosted look is back: at rest nothing changes.

## 2.496.870

- **The villa's first screen has less to read before it starts.** Settings, Advanced Settings and the Cockpit are now
  read the first time you open one, not while the villa loads. The first opening of each shows a short spinner;
  after that they open as before, also without a network.

## 2.496.869

- **Camera on a phone held sideways: every button fits.** When the buttons do not fit in one column down the right
  edge, they now take a second (or third) column, so the arrows, the siren, the sound, Fit to screen and Close are
  always on screen. Close stays at the top right. The column starts below the buttons at the top right (Open Ticket)
  instead of covering them. Every button stays large enough to tap.

## 2.496.868

- **A device's "3D object" line is clearer.** On each device card in Devices, the left box shows the object's own
  name "in the 3D model", greyed: it cannot be changed. Hover it to read which device it showed originally. The right
  box says which device drives that object: when the object was moved to this device, this device is shown there
  with an ✕ that gives the object back to the model's own device; otherwise it reads "Uses the model's own device"
  and a search lets you pick another one.

## 2.496.867

- **Camera: "Fit to screen".** A new button in the camera's bottom row makes the picture as large as the screen
  allows, its shape kept, so a small stream no longer sits small in the middle of a black area. Press it again
  ("Actual size") to go back. This device remembers the choice for every camera. Pinch and zoom work as before.

## 2.496.866

- **Each screen's load time and smoothness are kept in the villa's system.** The "VESTA UI devices" sensor, which
  already lists each screen's 3D drawing facts, now also shows for each one how long the villa took to appear the
  last time it opened, and how smooth the last moves of the view were (typical and worst frame time, frames a
  second). Nothing to export or set up.

## 2.496.865

- **Search.** A magnifier in the top bar (beside the gear on a phone, before the Cockpit on a larger screen) opens
  one box that finds rooms, devices and scenes. A room has a "Go" button that flies there, as in Rooms; a device has
  its usual switch, which still asks before unlocking a door or switching a device set to ask first; a scene asks
  before it runs. Each profile only sees what it may control: no siren is ever listed, nor a scene that only starts
  an automation.
- **Every search box finds each typed word on its own**, so "master AC" finds the master bedroom's AC, in either
  order.

## 2.496.864

- **The Guest profile's top bar has a word under each icon**: Comfort, Lights, Network, Access, Help, Smaller,
  Bigger, Cockpit and Account, and Menu on a phone. The bar is a little taller for it, and the floor buttons and the
  notices sit just below it. The Owner and Operations profiles keep the bar as it was.

## 2.496.863

- **"Show the tips again" in Map colours & keys.** The window opened by the "?" now has a button at the bottom left
  that opens the Quick tips card shown at the first sign-in. On a phone it shows as a light bulb.

## 2.496.862

- **The bottom bar's tiles keep their own colour when something needs attention.** "Door Lock: Unlocked" now keeps
  the purple of doors and cameras, with the small amber "!" in its icon's corner that the map's badges wear, and its
  amber underline. Before, the whole icon turned amber and looked like the Lights tile.

## 2.496.861

- **Less work on every live update.** The camera, lock, blind, fan and media controls, the scene buttons and the 3D
  view's live feed are no longer redrawn each time a device in the villa reports a change; they still act the
  same. Nothing on screen changes.

## 2.496.860

- **Behind the scenes: one list decides what is drawn over what.** Every layer of the screen (the bars, windows,
  questions, tips, notices) now takes its place from one named list, so a new window or tip is placed against the
  others in one spot. Nothing on screen moves or changes.

## 2.496.859

- **The update notes are shorter.** The list of changes shown with an update now keeps the changes from 2.496.700
  on; the older ones are kept in the project's changelog archive. Nothing in the VESTA UI changes.

## 2.496.858

- **The (?) pill of a device's live card names what made it.** A card for a device that is offline, no longer in
  the villa's system, partly not answering or showing an alarm now reads: "Created by the VESTA UI's own live device
  check."

## 2.496.857

- **The camera's siren button shows its command on its way.** After you confirm "Sound siren", or press it to stop
  the siren, the button shows the same waiting sign as the camera's move buttons until the siren reports its new
  state. If the villa's system refuses the command, the waiting sign stops at once. Sounding the siren still asks
  first, every time.

## 2.496.856

- **The (?) pill on an issue card now says only who made the card.** It no longer repeats the problem or says when
  the card goes away or is checked again (the card's words and its next-check pill already say that). A device that
  is offline, no longer in the villa's system, partly not answering or showing an alarm reads: "Shown by VESTA from
  this device's live state in the villa's system, not opened by a person or an automation."

## 2.496.855

- **Logout shows a power sign.** In the menu, the "Logout" line now has a power icon like the other lines' icons,
  instead of the profile's round badge. The badge at the top right of the bar stays as it was.
- **On a phone, Settings comes first in the gear menu**, right above Cockpit. Larger screens keep their menu as it was.

## 2.496.854

- **Every issue card says what made it.** A small (?) pill now sits just left of the "next check" pill. Hover it, or
  tap it on a tablet or phone, to read where the card came from: the villa's automation that raised the alert (its
  name and its id), VESTA's maintenance check that found it (for example "Missing device", PM-MISSING), the person
  who opened it in the Cockpit, a guest's report, a chat, an overdue task, or a device the villa's system reports
  offline right now. When nothing tells, it says "Source not recorded."
- The automation and the check are named once the VESTA Agent's next update is installed; until then an alert's
  card says which automation sent it was not recorded.

## 2.496.852

- **One upload button.** It reads "Upload Model" on the no-model screen and in Advanced Settings, and a failed upload
  shows one red line in both places.
- **Buttons answer the mouse the same way.** "Unlock door…" and a blind's Open/Close brighten in their own colour; a
  few icon buttons (a task's pencil, the photo viewer's ✕ and arrows, the rooms menu's ✕) now show their name.
- **The villa's shared settings are checked when saved**: a number out of range is kept at the nearest allowed value.
- Behind the scenes: every door of the VESTA UI's server is checked in one place, and every button is one definition.

## 2.496.851

- **The upper terrace's highlight sits on its deck.** Its floor was read 12 cm low, on a surface under the deck.
- Behind the scenes, no change to the lights: the villa's plan and every lamp's light are each worked out in one
  place, the same on every screen and in the test renderer.

## 2.496.850

- **A lamp over a tub lights the floor round it.** Where a lamp hangs over a tub or another low object, its light on
  the floor was laid at the object's height: a disc floating over the pebbles and glowing inside the tub. It now lies
  on the floor around, wherever the object is moved; a lamp over a step still lights the step.

## 2.496.849

- **A visit's photos in time order.** A photo whose time the villa wrote in another time zone no longer jumps ahead of
  earlier ones: a Parking photo of 12:20 stood before two of 12:19.

## 2.496.848

- **A visit's photos fill the space beside the large one.** On a card in the Messages and the Cockpit, the small
  photos now sit in two rows to the right of the large photo, then in full rows under it.
- **Every notice has its ✕ on its title's line.** It sat halfway down a notice with a photo or buttons; it is now in
  the top right corner, beside the title, on every notice.

## 2.496.847

- **Lamp light reaches the garden on every device.** An area's floor height was measured at the middle of its
  outline; a garden drawn round the house has its middle on the house, and read 2.1 m up. The lamps of a terrace then
  stopped at the edge of the lawn. The height is now measured inside the area.
- **A closed curtain stops the lamps' light.** With a curtain closed, the room's light no longer falls on the terrace
  or garden through the window; open it, and the light passes again. Half-open counts as open.

## 2.496.846

- **Lamp light reaches the lawn beside a terrace.** The light on the floor stopped in a straight line where a deck
  meets the garden around it. It now carries on over the grass.
- **Every room is drawn whole when it is highlighted.** A room whose outline repeats a corner, or has a corner in the
  middle of a straight wall, lost part of its highlight (a small room could lose almost all of it).

## 2.496.845

- **Lamp light crosses into an area with no wall in between.** Where the plan draws two areas side by side with no
  wall (a terrace and its patio, a kitchen and the living room), a lamp's light on the floor stopped at a straight
  line between them. It now carries on into the next area, and still stops at walls and doorways.

## 2.496.844

- **Lamp light lands where the lamp is.** The villa's rooms were placed up to 40 cm off their real walls, so a lamp's
  light on the floor stopped short of one wall and spilled past another, sometimes through a doorway into the next
  room. The rooms now sit on their real walls.
- **A lamp made of several parts lights like one lamp.** Such a lamp shone two or three times brighter than its
  neighbours.
- **A wall light lights the room it faces**, not the room behind its wall.
- **A lamp over a bath or a low step lights the floor**, not a sheet floating at the height of what is under it.
- **LED strips light an even line.** A strip lit the floor as three spots, bright in the middle; its light is now
  spread evenly along its whole length, and a longer strip gives more light.
- **Every glass pane shows from both sides.** A pane drawn with one side only disappeared when seen from behind, so
  some panes looked tinted and others empty.

## 2.496.843

- **See-through pictures stay see-through in the villa.** A picture with clear parts (hanging plants, a leaf, a net)
  was drawn as a solid panel. Its clear parts now show what is behind them, as in the plan the villa comes from.

## 2.496.842

- **A notification's title and what happened now come first, its photos under them.** With many camera photos, the
  title and the line saying what happened sat at the very bottom of the notification. They are now at its top, for
  every notification that carries photos.

## 2.496.841

- **A device that needs attention now blinks inside a group too.** On its own, its badge fades in and out; drawn as
  one of the icons in a group, it stood still. Its icon in the group now blinks the same way.

## 2.496.840

- **The small round marks on a badge's corners are no longer cut off.** The "?", "z" and linked-device circles stand
  a little outside the badge's square, and on the map the badge or its group card cut away the part that stood
  outside (a flat edge at the top or right). They are now drawn whole.

## 2.496.839

- **A 3D model too heavy to load gets its own screen.** Instead of "Loading the villa…" for ever, the VESTA UI says
  "This 3D model is too heavy to load", with its size and the 60 MB limit, and the owner can upload a lighter one
  right there. It knows the size before downloading anything, so a slow connection never triggers it. After an
  upload the villa reloads once.

## 2.496.838

- **No visible change.** Which rooms each lamp lights now has one owner in the code, which keeps itself right after a
  settings sync in any order. The bug where a lamp lit the next room through the wall after a sync can no longer come
  back unnoticed: a check now fails before a release instead.

## 2.496.837

- **The top bar stays while the villa loads.** "Loading the villa…" used to cover the whole screen, so a model that
  never finished left no way to Settings and its Upload Model button. The top bar and the floor buttons now stay
  visible above it: the round badge's menu, Settings and Upload Model work while a model loads.

## 2.496.836

- **A switch to remove the 3D model, on the add-on's Configuration page.** "Remove the 3D model at the next start":
  turn it on, save, then start or restart VESTA. The uploaded model and its room data are deleted, the switch turns
  itself off, and every device shows the upload screen. It is the way out when a model never finishes loading, since
  the loading screen covers Settings and its Upload button.

## 2.496.835

- **Villa lighting's Night is night at every hour.** Set to Night around sunset (or Day around dawn), the villa stayed
  in daylight or twilight: the setting followed how far the real sun was from the horizon, and at sunset that is
  almost nothing. Night now always gives the full night look, and Day a clear daytime look; Auto still follows the sun.

## 2.496.834

- **Villa lighting sits on its name's line on a phone.** In Settings, the three Villa lighting buttons (day, night,
  automatic) now stay at the right of their name, as compact as the Interface buttons in the header, instead of a
  wide bar on a line of their own.

## 2.496.833

- **No visible change.** The step that gives each light its room back after a settings sync moved into the lights'
  own code, where the render checks reach it.

## 2.496.832

- **Home Assistant shows how each screen draws the lights.** A new sensor, "VESTA UI devices", lists every phone,
  tablet and computer that opened VESTA in the last two weeks: its graphics chip, VESTA's version on it, and whether
  each light was held to its room there. Whoever helps with the villa can read it without asking you for an export.
  Nothing changes on screen.

## 2.496.831

- **On a phone or tablet, lights stay in their room too.** The room each light keeps to was worked out with numbers a
  phone's graphics chip shortens, so on a phone the living room light still lit the bedroom's walls and the rails of
  its beds, while a computer showed it right. Phones now work it out in full.

## 2.496.830

- **Lights stay in their room after a settings sync.** When VESTA picked up a change from another device (a sync it
  does by itself), every light lost its room until VESTA was opened again: the living room light lit the bedroom's
  curtains and walls through the wall, while a freshly opened VESTA looked right. Each light now keeps its room.

## 2.496.829

- **The tops of the walls around a lit room stay dark on the other side.** With the living room light on, the top of
  the wall between it and the bedroom, the bedroom's other wall tops and the rails of the beds against that wall
  lit up, so the bedroom looked partly lit from above. A wall's top, or anything against it facing up, now takes a
  light only when every room around it is lit by it; a tall bookcase inside the lit room keeps its light, and the
  staircase's steps are lit as before.

## 2.496.828

- **A light no longer reaches past the wall onto what stands against it.** The living room light still lit the heads
  of the beds in the bedroom next to it, through the wall they stand against; a room's outline drawn a little across
  a wall no longer lends it the next room's light either.

## 2.496.827

- **A light stays in its room.** A light that is on no longer lights the room behind a wall: the corridor light
  upstairs left the bathroom beside it lit, and the living room lights the bedroom next to it. Rooms open onto each
  other, like the living room and the kitchen, still share their light, and a light still lights the garden around it.
  VESTA finds the walls in the villa model by itself, once per model on each device; after that, opening VESTA
  takes no longer than before.

## 2.496.826

- **Lights light the room on a Mac in Chrome too.** In Chrome on a Mac, a light that was on lit the floor under it
  but nothing standing in the room: the steps, the furniture, the walls and the plants stayed dark, so the stairs
  light seemed to light nothing at all. They now take the light as they do on a phone or a tablet.

## 2.496.825

- **The stairs light lights the stairs again.** Switched on, the lights along a staircase now light the steps under
  and around them, up to the landing, and nothing else. Before, part of them were taken for lights of the room built
  under the stairs: they laid a bright patch on the floor below, in that room, while the steps stayed
  dark. Their light also stops a little under the steps, so the room under the stairs stays dark through them. A light
  hanging down the stairwell from the floor above lights the steps under it and the floor above as well.
- **A light alone in its room or garden lights the ground as far as its light goes.** Switched on, the entrance light
  now lights the path under it and along it, as far out as it lights the hedge beside it; before, only a small circle
  under the lamp was lit and the rest of the path stayed dark next to bright plants. The same goes for a bathroom with
  a single ceiling light. It still stops at the walls. Rooms with several lights look as before.

## 2.496.824

- **Access control is purple again.** Locks, cameras, motion and the other access control devices wear a purple that
  sits with the other families' tones, in place of the bright pink. Purple is free since alarms became amber, so it no
  longer means anything but this family.

## 2.496.823

- **Purple is gone: amber means "needs attention", pulsing means "act now".** An open fault, an alarm (a leak, smoke,
  a jammed lock, a low battery) and a critical device that has gone silent are all marked in amber now, on the map's
  badges, the room numbers, the status pills, the Cockpit and the top bar. What must be acted on now (an alarm, a
  critical device silent) pulses: its badge on the map, its room's glow, its status pill, its icon in the Cockpit and
  the top bar's alert button. An open fault stays amber and still. If your device asks for reduced motion, nothing
  pulses and the amber stays. "Map colours & keys" says it the same way. Errors of the app itself stay red.
- The tests load their path setting once for the whole run (nothing changes on screen).

## 2.496.822

- **An expired remote sign-in has one way back in.** When VESTA is opened from its internet address and the sign-in
  that protects that address has expired, the profiles and the passcode pad now say "Your remote access sign-in has
  expired." with a **Sign in again** button, instead of "Couldn't reach the passcode service". The button opens the
  address afresh, so the sign-in page appears and brings you straight back to VESTA: no more deleting the app,
  clearing its data and installing it again. With no connection at all, the message stays "couldn't reach".

## 2.496.821

- **Error messages are red again.** Since the status colours were swapped, the lines that say something went wrong
  ("Couldn't load the passcode settings…", a save that failed, a wrong passcode) and the notices for a failed save or
  a model that could not be refreshed were drawn in the alarm purple. They now use the app's red for errors
  everywhere; purple stays the colour of a device's alarm.

## 2.496.820

- **The Cockpit counts only updates someone can install.** Some devices and apps only report that a newer version
  exists, without any way to install it from the villa's system (a media server whose new version comes with its app's
  own update): they no longer raise the Cockpit's updates count, which nothing could clear. Firmware and app updates
  that can be installed are counted as before.

## 2.496.819

- **Furniture is lit point by point, without light patches.** Chairs, stools, rails, cabinets and other small
  furniture can now carry their light on every point of their shape instead of taking it from the light image, so the
  dark and light patches on them go away when the villa's model is baked that way. They darken at night like the
  walls, and a lit lamp brightens them as it does the walls. Older models look exactly as before.

## 2.496.818

- **One blue entry in the Legend.** "Moving" and "Partially open" are now one entry, "In between": a device moving
  (opening, closing, locking, arming), or a curtain, blind or shutter partly open. A curtain's history still names its
  state "Partially open".

## 2.496.817

- **Curtains, blinds and shutters show "Partially open".** A cover open part of the way now has its own state, in the
  blue of a moving device: in its window's pill ("Partially open (47%)"), in its history bar and its key, and in the
  Legend. Fully open stays red and closed green.
- **The colour of a moving device is now a clear blue.** "Unlocking", "Locking", a curtain moving, the presence's
  "Waiting for indoor quiet" and now "Partially open" were a teal close to the green of "Locked"; they are now plainly
  blue, in light and dark themes.
- **"Confirm" sits beside "Cancel".** When a door asks "Unlock …?", or any device asks before switching, the red
  button now says just "Confirm" and stays on the same line as "Cancel", on a phone too.

## 2.496.816

- **A critical door left unlocked is red like any unlocked door, and still raises its alarm.** Its window's pill, its
  history bar and its 3D colour are now the same red as every unlocked door. Its alarm is unchanged: it still opens its
  card in the Cockpit's Open issues, warns in the villa's health, fails "Doors locked" in the Recap and shows the alarm
  mark on its badge, all in the alarm purple.
- **The alarm purple is one colour everywhere.** Overdue and never-recorded maintenance, the Cockpit's alarm cards, the
  Recap's failed checks, the map and the badges all take it from the same single definition.

## 2.496.815

- **New status colours.** A device's usual state (off, closed, locked, no motion, disarmed) is now green; on or doing
  something (on, open, unlocked, motion seen, playing, armed) is red; an alarm (a leak, smoke, a jammed lock, a critical
  device gone silent) is purple. Amber (an open fault), grey (no contact) and the empty track are unchanged. It applies
  everywhere a state shows: the pills, the history bars and their keys, the buttons ("Turn off" and "Lock door" green,
  "Turn on" and "Unlock door…" red), the 3D objects and room glows, the badges' marks, the room chips' numbers and +N
  pills, the Cockpit and the Legend.
- **Locks follow the same colours as every device.** Locked is green and unlocked red, for every lock. A critical door
  left unlocked is still an alarm (purple), as before.

## 2.496.814

- **The last devices leave the Others family.** A TV or media server is now in comfort, a voice assistant in network,
  the villa's "empty" presence in security, a pump's warning sensors (overcurrent and the like) in energy, and a video
  recorder's disk or recording errors in network. A family you picked by hand for a device still wins.

## 2.496.813

- **An open room chip stays open.** A shared chip opened with its +N pill could fold back by itself less than a second
  later, with the mouse still. It now stays open until you tap its "−", tap elsewhere on the map, move the camera or
  change floor.
- **One colour per state in every device window.** The state pill, the history bar, its legend and the button now
  always agree. A lock locked is green and unlocked amber, or red for a critical lock, like its "Unlock door…" button
  ("Lock door" is green). A fan's, light's or switch's "Off" is purple again in its history bar (2.496.810 had made it
  the family's colour), matching its "Turn off" button. An air conditioner's chosen mode is in that mode's colour, as
  in its history bar.
- **"Show all" sits right under the list.** In "Also on this device" and every list ending in "Show all" or "Show
  fewer", the empty space above that line is gone.
- **The Cockpit button opens on Inbox, Issues.** Opened from the top bar it always starts on Issues; links that open a
  ticket or a device's issue still go straight there.
- **Leak and smoke sensors are security devices.** Water leak, smoke, gas and carbon monoxide sensors, a siren's
  switch and a camera's sound detection now belong to the security family (the shield); a bore's or pump's switch to
  energy, a network switch to network.
- **A family with nothing in it has no button.** In the top bar, a family's button shows only while at least one device
  belongs to it; it comes back by itself when one does. Its list closes if its last device leaves.
- **The bottom bar follows the top bar's order.** Its tiles now go comfort (Weather, then AC), lights, energy, then
  locks, with Scenes always last.
- **Settings comes before Rooms** in the menu under your profile letter: Settings, Rooms, Log out.

## 2.496.812

- **A linked device's bar lines up with the chart above it.** In a device window with a chart and a linked device (a
  pump and its relay, for example), the linked device's bar now starts and ends exactly under the chart's plot, past the
  numbers and the slider on its left, over the same period. The same moment is at the same place in both, on every
  screen size and for every period (1h to 1y), so you can see at a glance that the relay was on while the pump ran.
  While a value filter is set, the chart shows only the hours it keeps, so the bar under it no longer matches it hour
  for hour; clear the filter to compare.
- **The chart's filter takes the device's colour.** The slider beside a chart, its knobs, the small button under it,
  the filter pill above the chart ("≥ 0 W · 10 of 167 hours") and the marks of the hours it keeps now use the device
  family's colour, like the chart's line. The period buttons and the window's other buttons stay green.

## 2.496.811

- **The villa's "Empty" button is no longer purple.** Under the floor buttons on the left, the house icon of an empty
  villa is now drawn in the same colour as the other buttons there, in light and dark themes. "In" (someone there)
  stays green and an unknown presence stays grey.

## 2.496.810

- **A device's reading and history are in its family's colour.** In a device's window, the big value, its history
  chart (line, shading and the numbers beside it, in the larger chart too) and its history bar now use the colour of
  the device's family, the same colour as its icon and its button in the top bar: blue for energy, green for network,
  orange for comfort, and so on. They were purple. Red, amber and grey keep their meaning, and devices in Others keep
  purple.
- **The linked device sits under the history.** In every device window, a linked device that can be switched (such as
  an access point's LED) now sits below the history, where a camera shows its motion sensor: its switch and name,
  then its own history bar over the same period. It used to sit above the reading.

## 2.496.809

- **An open room chip no longer covers anything.** When you tap a chip's +N pill, the full list now gets its own room on
  the map: the chips and device badges around it move aside, or join its list when there is no room for them, instead
  of being covered. If the list does not fit, it moves a little further or spreads into columns. Folding it puts
  everything back as it was.
- **Room chips are exactly as wide as the space kept for them.** Chips were drawn a few pixels wider than the space
  set aside, so two chips side by side could touch. Their width is now measured from the text itself, so neighbouring
  chips, their +N pills and device badges always keep a gap.

## 2.496.808

- **Room chips no longer have a light border.** A room chip drew a thick light border when something in the room was
  on; device badges have no such border, so room chips now never draw it, whatever is on. The number's colour still
  says whether the room is all right. The "Which room?" list and the Legend no longer show or describe that border.

## 2.496.807

- **A shared room chip is one line again, with a small +N on its edge.** When rooms share a chip, it shows only the
  busiest room, as a single line like any room's chip, and a small pill on its bottom edge says how many other rooms
  it holds, for example "+1" or "+7". Tap the pill to see every room; it then reads "−", tap it to fold the chip again
  (or tap anywhere else on the map, or move the camera). The pill takes the colour of anything wrong in the rooms it
  hides: red first, then amber, then grey, and green when all is well. The "N more" line is gone, so chips take less
  room on the map. The Legend describes the pill.

## 2.496.806

- **A shared room chip now shows one room and a + button.** As soon as two or more rooms share a chip, it shows only
  the busiest room, then a line such as "1 more" or "8 more" with the + button. Everything else works as in 2.496.805:
  tap the line to see every room, and the + takes the colour of anything hidden that needs a look.
- **The + and − are centred in their circle.** They are now drawn exactly in the middle instead of sitting off-centre.
- **"All right" is green.** The number on a room chip, and the + and − buttons when nothing is wrong, are green instead
  of purple, so with amber, grey and red they read like a traffic light. The Legend says "Green number". A device's
  own usual state stays purple.

## 2.496.805

- **A shared room chip shows two rooms and a + button.** When many rooms share one chip on the map, it now lists only
  the two busiest rooms, then a line such as "7 more" with a + button. Tap that line to see every room, drawn over the
  map around it; tap "Show less", anywhere else on the map, or move the camera to fold it again. If one of the hidden
  rooms needs attention, has a problem or has lost contact with a device, the + button takes that room's colour (red
  first, then amber, then grey), so nothing is hidden by folding. Tapping a room's line still goes to that room. A
  chip of three rooms or fewer is unchanged.

## 2.496.804

- **A chosen device now looks chosen.** In Advanced Settings, Villa presence (and every field linking one device, such
  as a 3D object's linked device) showed the chosen sensor's name in the same dim grey as the "Search…" hint, so it
  looked as if nothing was set. It is now written in the normal text colour, behind a link mark; the search icon and
  the grey come back only while you search for another one.

## 2.496.803

- **Room chips stay on the map you can see.** Zoomed out, a chip could run off the top of the screen, sit under the
  top bar, the bottom bar or the floor buttons on the left, or hang off a side of the screen. Every room chip is now
  kept fully inside the visible map, moved only as far as it needs to be.
- **A long shared chip uses columns.** When many rooms share one chip and their lines would be taller than the map, the
  lines are laid out in two or more columns, each read top to bottom. Tapping a line in any column still goes to that
  room.
- **Room chips no longer cover device badges.** A chip drawn over the corner of a group of device badges is now moved
  just clear of it, so every badge and group stays visible and tappable.
- **A device with dead parts names every one of them, and says the device still works.** A camera card read "4 parts
  unavailable" and nothing more; it now reads, for example, "Person detection, Cell motion detection, Motion alarm and
  Move to preset not answering, the device itself works", in the Cockpit and in the monthly recap.

## 2.496.802

- **"Asleep between reports" is now "Unavailable by design", for parts too.** A camera's control it never uses, such as
  "Move to Preset" with no preset saved, made the camera "partly unavailable". Put it on this list in Advanced Settings
  and the camera reads as working again: no card, no grey "?", nothing in the Recap. Battery sensors that sleep
  between reports stay on it as before.

## 2.496.801

- **A shared room chip lists every room.** Zoomed out, rooms too close together share one chip, which read "Living
  Room +1" with one number for all. It now shows one line per room, each with that room's own name and its own
  number, coloured for that room (purple all right, grey no contact, amber a fault, red act now), busiest room first.
  The chip's border still says whether something in any of them is on. Tap a line to go to that room; press and hold
  the chip to choose among them, as before. The map legend says so.
- **Access control devices are now raspberry pink.** Their purple was almost the purple of a room or device that is all
  right, so a lit camera or lock looked like a status. The family now has its own pink on its badges, its top-bar icon
  and the legend; every status colour stays as it was.

## 2.496.800

- **The monthly recap names a device with a dead part.** Its "Device availability" section counted only devices that
  were offline, so it could say all was well while the weekly Recap said "1 device partly unavailable". It now lists
  each such device with the parts that stopped answering, in Open issues' words ("Person detection unavailable"). The
  device still counts as reporting, since it answers.

## 2.496.799

- **A critical door left unlocked is red everywhere.** Its window and its 3D object were red, but its badge on the map
  showed the plain "in use" dot, its room's number stayed calm, Open issues had no card and the top bar was not red.
  Now its badge wears the red "!", its room's number turns red, Open issues shows its card ("Unlocked", in red), the
  top bar turns red and the Recap's "Doors locked" says Fail (as it now does for a jammed lock). An ordinary door left
  unlocked stays calm, as before.
- **A critical device with a dead part is red too.** A critical camera whose motion detection stopped answering had a
  red bar in its window but a grey "?" on its badge and a grey card. Its badge now shows the red "?", and its card and
  its room's number are red.
- **A hidden device stays quiet on the 3D map.** A device hidden in the villa's system no longer pulses, glows or turns
  red or amber on the map; a hidden lock keeps its resting colour.
- **A dead part counts in the Recap, and for every profile.** "All devices reporting" now says "1 device partly
  unavailable" when Open issues shows such a card, where it said "Every configured device is reporting". A profile
  that only sees what is on the map now gets that card too (the map already showed it the "?"), and the faults about
  a part of a device it can open.
- **"Also on this device" lists exactly the parts that are checked.** A battery listed there that stops answering now
  gets its card and the "?" on the badge, like any other part. A device you placed on the map on its own is no longer
  listed under another device's window: it has its own badge.
- **A ticket about a hidden device is filed the same way everywhere.** The Recap no longer shows a pill naming a device
  hidden in the villa's system, nor a "faults" link that opened nothing; Open issues, Watch, Closed and Tickets all
  give it its own card under "Other".
- **Pointing a device at another entity takes everything with it.** When a device on the map is moved to another
  entity in Advanced Settings, its group, the devices linked to it and its place under "Asleep between reports" now
  follow, so no "Missing" card is left behind, its group's readings stay on its card and a linked badge's pill keeps
  working.

## 2.496.798

- **A device on the critical list is red the same way in every window.** A critical lock unlocked or out of contact
  was red, but a critical sensor out of contact, a lost reading under "Also on this device", a blind's pill and the
  camera's bar for its lost motion sensor could stay grey or amber. Now every pill of a critical device's window turns
  red when it needs a look or loses contact, by one rule, as its badge and its 3D object already did.
- **A device split into two of your groups keeps its other parts with the right one.** When one physical device is
  shown as two groups on the map (a weather station's indoor and outdoor readings), its parts that are not on the map
  (its battery, a rain gauge) went to whichever group's name came first in the alphabet, so a dead rain gauge could
  show on the indoor card. They now go to the group on the same module in the villa's system, else to the group listed
  first in Advanced Settings, and renaming a device no longer moves them. The same goes for which device a suggested
  group stands under: the one you added first.
- **A hidden device's tickets match Open issues.** The Tickets tab now gives each ticket about a device hidden in the
  villa's system its own card, under "Other", opening nothing, as Open issues does, and the Tickets count agrees.

## 2.496.797

- **A device that works but has a dead part now says so.** A camera that streams while its person detection has been
  unavailable for days showed nothing anywhere. Its card in Open issues now reads "Person detection unavailable" in
  the grey of lost contact, with the time it went; its window shows the grey warning sign, its badge on the map the
  grey "?" and its room's number turns grey, while the camera itself still reads as working. Parts the villa's system
  files as settings or diagnostics, parts someone hid and parts switched off make no noise.
- **A hidden device no longer hides VESTA's findings about it.** A device hidden in the villa's system still has no
  card, badge or window sign, but a fault or a late task about it is no longer dropped: it is its own card in Open
  issues, Watch and Closed, under "Other". A finding that exists because the device is hidden (an automation still
  watching a hidden, offline device) is now seen.

## 2.496.796

- **Every device window shows its state the same way.** A light, a fan, a switch, a TV and an A/C now show a state pill
  at the top ("On", "Off", "Cool"), as a lock and a blind already did, drawn once for every window by the same piece.
  Their big button now says what a tap does ("Turn off", "Turn on"), in the colour of where it leads, as "Unlock
  door…" does.
- **One pill style everywhere.** Every pill has the same size (a sensor's was larger), and only an alarm or lost
  contact is in capitals ("LEAK DETECTED", "UNAVAILABLE"); every other state is written as it is said ("Locked",
  "Open", "On"). The lock's pill said "LOCKED" beside a blind's "Open".

## 2.496.795

- **A button that moves a device wears the colour of where it leads.** "Unlock door…" is now the amber of "unlocked"
  (red for a door on the villa's critical list), "Lock door" the purple of "locked", and a blind's Open and Close the
  green of "open" and the purple of "closed"; Stop, which leads to no state, is plain. They wore the app's green
  (which says "on" everywhere else) and the device's category colour (an identity, never a state). The rule lives in
  the one colour table, for every device's buttons.

## 2.496.794

- **Purple and green swapped, everywhere at once.** A device in its usual state (a light off, a curtain closed, locked,
  no motion, the villa empty) is now purple, and a device on or in use (a light on, a curtain open, motion seen, someone
  home) is green, on every screen: pills, history bars, the On button, the 3D map, the room chips' "all right" number
  and the legend. It was one change in the one colour table.
- **A motion sensor's 3D object pulses again while it sees someone.** Since the colour code made a detection "on,
  nothing wrong" instead of red, its object stayed still; it now pulses in its state colour (green for a detection, red
  for a leak or smoke).

## 2.496.793

- **One colour code for every status, on every screen.** Each colour now says one thing, in the state pill, the history
  bars, the On button, the 3D map, the Cockpit, the presence tile and the camera timeline:
  - **green**: the device answers and is in its usual state (a light off, a curtain closed, locked, motion clear, the
    villa empty);
  - **purple**: on, doing something, nothing wrong (a light on, a curtain open, a door open, someone home, a camera's
    motion);
  - **teal**: moving (opening, closing, locking; the villa waiting for indoor quiet);
  - **amber**: needs a look (a door unlocked); **red**: an alarm (a leak, a jammed lock, a critical door unlocked);
  - **light grey**: contact lost, a plain colour now; **the empty track**: nothing to show (history not kept, no value).
  Stripes only mark a period of a history bar that mixed states. The big On button follows the state (purple on, green
  off) instead of the device's category colour, and a leak's room glows red while a room in use glows purple. The
  colours live in one table that every screen reads, and a check refuses a new screen that paints a status by itself.

## 2.496.792

- **Curtains and fans use the lock's colours.** A curtain opening or closing, and a fan turning, are the teal a lock
  has while it locks. A closed curtain and a fan that is off are now purple (the locks' own colour, shut as a locked
  door is), no longer the dark grey that sat too close to the grey of "Unavailable" in their history.

## 2.496.791

- **After the villa's system restarts, devices no longer stay frozen until the page is reloaded.** On 13/11 a restart
  left every device as it was at 14:47: the weather station, back at 14:48, still read "Unavailable since 14:47" five
  minutes later. After reconnecting, the Kiosk now checks that the villa's system took back its request for every
  change (it asks again, then reconnects), and a connection that carries no change at all for 5 minutes is taken for
  dead and opened afresh, which reads every state again.
- **One setting for both apps:** that 5 minutes is the time both the Kiosk and the VESTA Agent let the villa's system
  settle after a restart. The Agent uses it to say nothing is "missing" while the villa's system is still loading.

## 2.496.790

- **Uploading a model no longer pushes Advanced Settings down with a green band.** "Uploaded 17.9 MB → villa.glb with
  its room data. Reloading…" appeared as a line above the Villa tab's settings. The Upload Model button now says
  "Uploaded, reloading…" for a few seconds, as it already says "Uploading… 42%" and "Retrying (2 of 5)…". Only a
  refused or failed upload, whose reason you need to read, still shows a line.

## 2.496.789

- **A problem right again stays on Watch while the fault records are still loading.** Just after the page opened, a
  fault that had come right (or was held because it was expected) could leave Open issues without appearing on Watch,
  until the fault records arrived. It now shows on Watch straight away, with the same words.
- **Behind the scenes:** a fault's place (Open issues, Watch, Closed), the head of a card, and what each card button
  does are now each worked out in one place, for the Inbox, the notice and the Tickets tab alike. Nothing else changes
  on screen.

## 2.496.788

- **A screen that cannot start 3D is no longer told it "ran out of memory".** When the browser refused 3D (WebGL
  blocked or missing), two reloads in a row turned its own message into "The device most likely ran out of memory".
  Each opening now ends its own attempt, whatever happens to it; only a page killed while loading counts towards that
  message.
- **A model with a missing image says which one when it fails to load.** In place of "/textures/364/source: Failed
  to find index", the error names the material whose image is missing, as the upload already does.
- **Nothing can stop the page by talking to a 3D model being closed.** The "Cannot read properties of null" error
  fixed for one case in 2.496.785 can no longer happen from any other: once a model is closed, anything still asking
  it something is simply ignored.

## 2.496.787

- **"Open issues" counts the villa's own alerts.** While the VESTA Agent was away, a visit alert showed its card under
  Open issues, but the heading said 0 with "Nothing needs attention." right above it, and the top bar's Cockpit button
  showed no number. The heading, the Issues filter, the top bar and the menu's "Cockpit (N)" now count the same list.

## 2.496.786

- **A 3D model with a missing image is refused at upload, with the reason.** One texture written without its picture
  makes the 3D view refuse the whole model, and every tablet then failed to load the villa. Settings › 3D model now
  says which material's image is missing and uploads nothing; the model in use stays.
- **A model that fails to load is no longer called "out of memory".** After two failed loads with their own error
  (a broken model, a refused download), the third opening said "The device most likely ran out of memory". Only a
  load that never got to report anything counts towards that message now; otherwise the real error is shown again.

## 2.496.785

- **Reloading the 3D model no longer stops with "Cannot read properties of null (reading 'setDeviceMarks')".** When
  a reload also changed what the map marks (a model just edited), the page could still talk to the model being
  closed for a moment and stop with that error. The old model is now let go in the same step that starts the reload.

## 2.496.784

- **Advanced Settings › Devices, "3D object": the search says when an object was re-mapped.** When a 3D object
  of the model shows a device other than the one it is named after, the search next to it now reads
  "Re-mapped to this device · search to point it at another entity…"; otherwise "Search to point it at another entity…".
- **Escape leaves FPS mode.** In FPS mode, Escape goes back to the overview when no window, menu or field is open;
  with one open, Escape closes that first, as before.
- **FPS mode stands a little lower.** The default eye height is now 1.60 m (it was 1.70 m). A tablet whose
  Settings › Eye height slider was moved keeps its own height.

## 2.496.783

- **FPS mode opens looking straight ahead.** Switching to FPS, arriving in a room or starting the walk no longer
  tilts the view slightly down at the floor; it faces the same way as before, level. Dragging still tilts it as you like.
- **Advanced Settings › Devices, "3D object": says what it is, on the same line.** Each object of the 3D model now
  shows a small cube before its name, so `camera.storage_room` no longer reads as a second device: hovering it says
  "3D object of the model, named camera.storage_room: it shows Tapo Storage Room HD Stream (camera.tapo_…) here."
  The search next to it says what it moves: "Point camera.storage_room at another entity…". The "Add a 3D object…"
  search shows the same cube before each object.

## 2.496.782

What you will see, in the Cockpit's Messages:
- **An expected "has not run" alert waits on Watch.** When VESTA holds a "has not run" alert because it is expected
  (a pump that only runs when people are in, while the villa is empty), its card is on Watch with VESTA's reason, in
  place of Open issues. Nobody is asked about it, it is not counted in the top bar and its device has no amber mark.
- It stays there until VESTA says otherwise: if the device still has not run once people have been back long enough,
  it is an open issue again and the facility manager is asked as usual. While VESTA is offline it is an open issue,
  as before.
- Needs VESTA Agent 0.12.503 or later.

## 2.496.781

What you will see, in the Cockpit's Messages:
- **A problem that is right again moves to Watch at once.** When VESTA sees that what an alert reported is over (a
  door locked again, a device back online, a temperature back in range), the card leaves Open issues and goes to
  Watch straight away. It says what the device reads ("Locked since 01:29") and when VESTA closes it ("Closes 01:41").
  Before, it stayed in Open issues for those 10 minutes.
- While it is on Watch it is not counted in the top bar, and its device has no amber mark on the map and no warning
  in its window: nothing is left to do.
- If it goes wrong again before then, it is back in Open issues as the same alert, at VESTA's next look. At the time
  on the card VESTA closes it as before ("Cleared … Watch 1h" on Telegram), and the card stays on Watch for that hour.
- Telegram is unchanged.

## 2.496.780

What you will see, in Advanced Settings › Devices:
- **A device on the map can be given another entity**: the search beside its 3D object now lists the villa's entities
  (type "tapo" to find them). Picking one asks first, then moves the device's 3D objects and settings (type,
  category, label, linked entity) to that entity, and the list shows it under its new name. For a device renamed in
  the villa's system.
- **A device not on the map finds the model's objects**: its 3D object search lists the objects that already show a
  device first (for example "camera.storage_room", "shows Storage Room, moves it here"), then the objects that show
  nothing.
- A device on the map with no 3D object yet keeps the object search, so it can still be given one.

## 2.496.778

What you will see:
- **Every window's first line starts at the same distance under its header or its tabs, and its last line ends at the
  same distance over its buttons.** Side by side they differed: a form's first field and a tab's first card began
  8px under the line, a device's state 16, the air conditioning's temperature 20, a section's heading 32 (40 for
  Advanced Settings' device list); a device window ended 30px over its buttons, a form 12. It is 16px everywhere
  now, from one rule.
- So: Settings, each Cockpit tab, the forms, Weather, Energy and the fan and TV windows start 8px lower; Map colours
  & keys and Settings' Messages tab start 16px higher, Advanced Settings' Devices tab 24px higher; device windows are
  14px shorter.
- **A window's large reading is one line everywhere**: a sensor's value, a device's state in words and the air
  conditioning's "Current" temperature sit at the same distances (each window had its own).
- The Cockpit's Inbox: the filter buttons start where every window's first line does, and still stay in view over
  the cards that scroll.

## 2.496.777

What you will see:
- **Advanced Settings, a device's card: Type, Category, Label and a light's Intensity each have an (i) after their
  name.** It says what the field is for. This was said only when a mouse rested on the box, which a finger never
  sees.
- **A light's Intensity shows its value as Settings' sliders do**, at the right of its track.
- **A slider's bar ends where the boxes above and under it end**, in every window (it stopped 2px short at each end).
- **Put right from the last update:** in Energy, "kWh" at the right of "Today, hour by hour" was drawn larger and
  white in 2.496.776. It is the small grey line again.
- Nothing else looks different: names in the code that nothing read, and a rule for a button state that no longer
  exists, are removed.

## 2.496.776

What you will see:
- **The small grey line that adds a detail is one look everywhere.** The note beside Save, the second line of a
  choice when you search for a device, "linked entity" under a name in a device's window, a device's id when it
  cannot be reached, the note under a chart, the lines under each name in the Legend, and the notes in Facility's
  Spend and Readiness were written in three sizes. They are one size and one grey. Three were a little smaller
  (the search results, "linked entity", a device's id) and one a little larger (Spend's notes).
- **A chart's key (what each colour is) is one row everywhere**: in Weather, in Energy and under a device's
  history. Under a device's history its words are now grey like the others (they were white), and on a narrow
  screen the key wraps instead of running off the edge.

## 2.496.775

What you will see:
- **Every box you type or pick in is one box.** A question's answer, a form's field ("Report a problem", "Open a
  ticket", a visit, a cost), a device's card in Advanced Settings, a search box, a number with its unit, a choice
  list and "Ask VESTA" were seven looks: heights from 36 to 46, two corners, with or without an edge, two text
  sizes. They are now the same height, corner, edge and text everywhere. The most visible change is in Advanced
  Settings: a device card's fields are a little taller and have the edge every other box has.
- **A field's name sits the same distance above its box in every form.** In "Report a problem" and the Facility
  forms some names touched their box while others kept a gap, and the fields were unevenly spaced. Settings'
  "Dashboard title", a question's answer and the villa's Latitude and Longitude are named the same way.
- **The captions in a device's window ("Mode", "Fan speed", "Position", "Last 24 hours") are the size of every
  other caption.** The last update said captions were one look; these were still drawn larger. They are now.
- Sliders, the tick box on a device's card and the colour pickers look as before.
- Each of these is written once, so a later change to a box or to a field's name shows in every window at once.

## 2.496.774

What you will see:
- **Every window's header is the same height.** A window with only a title, a device's window, the Cockpit and
  Settings had headers of four heights (a few pixels apart), so the tabs and the first line under them sat at
  different places from one window to the next. They are now one height, on a phone and on a wide screen.
- **A long window title is cut with "…" on one line** in every window (a chart's window, "Open a ticket") as it
  already was in a device's window; under a mouse it says itself whole.
- **The small capitals are two looks, not nine.** The heading over a group of lines ("Dashboard title" in Settings,
  "Also on this device" in a device's window, "Scenes for this room" and "Not on the map" in a room's list) is one
  look everywhere. The small caption over one value, control or chart ("Fan speed", "Today, hour by hour", a settings
  card's "Linked entity", the room over a device window's title, the bottom bar's "Lights") is the other.
  "Not on the map" keeps its colour, and its explanation is behind an (i) beside it.
- Nothing else changed. Each of these is now written once, so a later change to a header, a heading or a caption
  shows in every window at once.

## 2.496.773

What you will see:
- **An alert's notice over the villa looks like its card.** It was a bell, a title and a line in the app's green, so
  an alarm and a doorbell looked the same. It now shows what the alert's Cockpit card shows at its top: its icon, its
  name ("#91-P2"), the device, the time, then its state first ("New alert", "Reminder sent 14:25, waiting for
  someone") followed by its first words, all in the colour of its severity (red, amber). A device with several
  problems shows the alert's own state, not "2 problems".
- A doorbell, an approval and any message that is not an alert keep the bell. So does an alert during the moment the
  Cockpit has no card for it yet: the notice then turns into the card's top by itself.
- **Full screen, and on every card, the status is labelled.** The last line was a bare line under the words; it now
  sits under "Status:", with the earlier steps above it, as the Inbox card shows them.
- Nothing else changed: the photo, the buttons, the ✕ and how long a notice stays are as before.

## 2.496.772

What you will see:
- Four lists were reached only by holding a button, which nobody finds on a phone. Each now also has something to
  press, and every hold still works:
  - **Rooms**: a "Rooms" line in the menu (the gear's menu on a phone, the profile's menu on a wide screen). It opens
    the Rooms window. In the dial that opens when a floor button is held, the fixed button reads "All rooms" (it said
    "Manage rooms", and only the owner manages rooms there).
  - **A room's devices**: in the Rooms window, each room has a small list button in its corner. It opens the list of
    that room's devices (the list a hold on the room's group on the map opens). A room with no device has no button.
    The owner's bin sits beside it.
  - **A category's devices**: in "Map colours & keys" (the ? button), each category has a list button that opens
    its list, as holding the category's icon in the top bar does.
  - **Choosing a camera**: a list button beside the camera arrows opens the list of cameras, as holding the Next
    arrow does.
- Nothing else changed.

## 2.496.771

What you will see:
- A press that did nothing says so in plain words, naming the device: "Living room AC did not respond. Try again."
  It was the connection's own wording ("Not connected", "No answer from the server") and named nothing. It is the
  red notice under the top bar, it stays as long as the other notices and has its ✕. Several devices at once (a
  list's "turn all off") read "Kitchen light and 2 others did not respond."
- A command this profile may not send still says exactly that ("This profile may not send this command.").
- Every command button shows that the press landed, as the power button does (it dims and brightens until the
  device answers): Play / Pause, a blind's Open, Stop and Close, an AC's mode and fan speed, a fan's speed and
  preset, a camera's turn buttons, a list's "turn all on / off". The selected mode or speed stays what the device
  reports: nothing is guessed.
- With "reduce motion" set on the device, the waiting sign stays (a slow fade, nothing moves); it used to vanish.
- The camera's siren button is untouched: it asks first, as before.
- Nothing else changed.

## 2.496.770

What you will see:
- A device that does not answer says since when: its window reads "UNAVAILABLE SINCE 14:05" (the day too when it is
  not today), with an (i) beside it. A tap on the (i) says why there are no controls; that was a text only a mouse
  could read. After the villa's system restarts, the time is the restart's.
- In a category's or a room's device list, "Not on the map" and "Missing" each have an (i) that says what they mean,
  on a tap. The "Missing" text had a garbled sentence: rewritten.
- The Cockpit's updates count (top right) is a button: a tap opens the list of what has an update waiting. It was
  only shown under a mouse. It looks like a device window's header buttons.
- A device window's state pill is one pill everywhere: the lock's, the blind's, a sensor's, a grouped device's and
  the lost-contact one sit on the same line at the same distance from what follows. In a grouped device's window the
  pill is the same size as the others (it was larger and wrapped onto two lines sooner).
- "Nothing here" lines ("Nothing needs attention.", "No tasks yet.", "No report yet.", "Nothing recorded.") sit at
  one distance under their title in every list; some were tight against it, others 23 px lower.
- Nothing else changed.

## 2.496.769

What you will see:
- "Back" is one button everywhere: the round grey button with its arrow and its word. A data window's History
  (Weather, Energy) had a square tile with a bare arrow, a device window's header a smaller pill of its own, and the
  PIN pad a grey text link ("← Profiles"): the PIN pad's is now the same button, top left, saying where it returns.
- Under a mouse, every text that appears is the app's own small dark card, at once: the top bar's buttons, the
  camera view's, a device window's, Settings' and the Rooms window's. About seventy of them were still the browser's
  grey box that comes after a second. It also follows the keyboard's focus. A finger never brings one up.
- A name that fits no longer repeats itself under the mouse: a window's title or a reading's name shows its tip only
  when it is cut short.
- Nothing else changed.

## 2.496.768

What you will see:
- A lone icon to press is now one quiet icon everywhere in a window: a card's remove (the bin in its strip), the ✕ of
  a pill ("Pool pump ✕"), the ✕ that empties a search field or a device field, the (i), a chart's enlarge, the ✕ of a
  notice and of the note in a window's footer, and Listen beside VESTA's answer. They were eight looks: a black
  plate here, a ringed circle there, from 18 to 32 px. Under a mouse each one now names itself in the app's own tip.
- A button without its word is the worded button, round: the bin at the end of a card's buttons, a schedule's
  pencil, "all on / all off" in a category's list and a device window's header buttons.
- A button over a photo or a video is one look, dark with a thin white line: the camera view's buttons (they were
  frosted grey at the bottom and dark at the top), the photo viewer's close and arrows, the ✕ on a photo's
  thumbnail and the bin on a room's card. A camera's lit button stays green, a sounding siren's red.
- Nothing else changed: every button does what it did, and the siren still asks before it sounds.

## 2.496.767

What you will see:
- A save that did not happen says so, in one place: a red notice at the top of the screen, over any open window, with
  its own ✕. It stays as long as it is true. Five cases were silent or said only in one window: a shared change the
  server refuses (said in Advanced Settings, not in Settings), a Cockpit save made with no connection, this device's
  own settings that its storage refuses, a card's delete that failed ("Not deleted: the server could not be
  reached, nothing was changed. Try again."), and a number that is none.
- A number that is none names its field and what it needs: letters typed in Latitude give "Latitude" needs a number:
  the one before was kept. The same for the days records are kept and a notice's seconds. Save then keeps the window
  open, so the field can be corrected.
- A half-filled form is no longer lost to a touch outside. "Report a problem", "Open a ticket" and every Cockpit form
  ask "Discard what you typed?" with Keep and Discard, on a touch outside, Escape, Back and the Cockpit's Close. A
  form with nothing typed closes at once, and a form's own Cancel asks nothing.

## 2.496.766

What you will see:
- Every worded button is now one button: a soft grey pill, green for the main answer, red for one that cannot be
  taken back. A window's footer had pills while the same Cancel and Save in a Cockpit form, a question asked in
  place ("Unlock Front door?") and every "Add", "Copy", "Record spend" or "Reload" were outlined boxes. A cover's
  Open, Stop and Close are three alike, in the device's colour.
- Cancel and the answer are the same pair everywhere: the ✕ and "Cancel", then a check and the answer's own words
  ("Save task", "Unlock", "Send report"), on the right. In a window's footer, at the end of a Cockpit form, in a
  question asked in place and in the question box. On a phone Cancel is the round ✕ alone.
- The answer greys while it is on its way ("Saving…", "Sending…") everywhere, so a second press cannot send twice.
- What went wrong is one red line, the same size everywhere. In a window it stands on its own line just above the
  footer's buttons: a refused Save in Settings was amber words squeezed beside Cancel and Save.

## 2.496.765

What you will see:
- Every "choose one of several" is now one control with one look: a soft track, the chosen one tinted green. The
  Cockpit's tabs (Inbox, Tickets, Schedule…) and Settings' tabs were solid green rectangles; the Inbox's Issues,
  Notifications and Reports were outlined pills; a schedule's "How often" and a device's modes and speeds (air
  conditioner, fan) were buttons of their own; the weather's and the energy's periods another kind. They are all
  the same control as Settings' choices now, so a change to its look changes all of them at once.
- The Inbox's filters say their count as the tabs do: "Issues (6)", and "Notifications" in full on every phone.
- A window with nothing to save closes with the same button shape as Save and Cancel: "✕ Close" on a wide screen,
  the round ✕ on a phone (the Cockpit had a word pill where Settings had round buttons).

## 2.496.764

What you will see:
- The Rooms window: "Add room here" and a room's bin are the owner's alone. Anyone else sees the rooms and goes to
  them; a room they added stayed on their device only, or was replaced later with no word.
- A bin asks before it deletes: a task's bin on the Cockpit's Today and Schedule tabs ("Remove this task?
  Completions already logged against it are kept."), a saved document's ("Delete this saved report?"), and
  "Clear" in Advanced Settings' telemetry ("Erase every event?"). One press deleted, with nothing to take it back.

## 2.496.763

What you will see:
- In Settings and Advanced Settings, with a search list, an (i) or an "Add" box open, Escape or the phone's Back
  closes only that box. It closed the window too, and in Settings that is Cancel: every change made on every tab
  was undone by a key pressed to close a list.
- After closing such a box, the next Back is no longer ignored (it took two presses to close the window).
- A camera that cannot connect shows "Try again" under "Camera stream unavailable.": the only way out was to close
  the window and open it again.
- On a phone, a thumb that lands on a chart still scrolls the window (Weather, Energy, a device's history): up and
  down scrolls, sideways reads the chart.
- "Upload Model", on the screen shown when the villa's model is missing, opens Advanced Settings, where the upload
  button is (it opened Settings on General, which has none).
- The Energy window's notes about a device with no upstream device or no meter say where to set it: in the villa's
  system, in its energy settings.

## 2.496.762

What you will see:
- Cockpit › Spend: the month's entries are pages of ten, newest first, with the count and arrows under them; the
  saved documents under "Monthly document" are pages of ten too.
- A Cockpit form's Save greys and says "Saving…" while the record goes, on every form (a ticket, a task, a
  spend entry): pressing twice can no longer save it twice.
- "Report a problem" and a ticket's stage window have Cancel and the action grouped at the bottom right, like
  Settings and every other window.
- A guest adding several photos to a report keeps the ones that went through when one fails, and reads "Couldn't
  add that photo." for the one that did not; Send waits while a photo is going.
- With a keyboard: Enter or Space on a Cockpit card opens it (holding the key still asks for the erase code);
  "Add photo" in a guest's report can be reached and pressed.
- For a screen reader: the Cockpit and Advanced Settings windows are announced by the title they show, the camera
  window's Close is named, the "How often" choices say which one is picked, the passcode screen's line is read once.
- Nothing else changes on screen: the photo upload, the bin button and a form's "saving" are each written once.

## 2.496.761

What you will see:
- The VESTA UI no longer calls itself "the kiosk" or "the add-on". The first screen asks "Who's using VESTA?"; a
  save that did not go through says "the server" ("Couldn't save to the server, the change is only on this
  device."); the Cockpit's table of how a problem becomes a fault says "raised in the VESTA UI".
- Cockpit › Spend: the month is spelled out ("November 2026") in the Month list and in "No spend recorded for…".
- Cockpit › Schedule: a task's card says how often in the words you picked ("Monthly", "Every 3 months"), no longer
  "every 30 days"; the monthly document says the same.
- Durations are written one way everywhere: a wrong passcode says "locked for 5min", a chart's title "5min avg",
  the rain chart "No rain in the last 7d".
- The first-time tips name the right buttons: hold a floor button for its rooms; on a phone the "?" is in the menu,
  beside Label size.
- A device that is no longer in the villa's system says "it was removed from the villa's system, or renamed".
- Settings: the small "Interface" label and section summaries are the same grey as every other quiet text; a
  guest's "Thank you, that's been reported" tick is the status table's green.
- Nothing else changes on screen: about 500 lines no screen used any more were removed.

## 2.496.760

What you will see:
- Nothing changes in what you see; a visit's alert card in the VESTA UI now shows VESTA's one list of the visit's
  photos, the same as Telegram's, never mixed with the villa's own messages' photos. Other alerts, and a visit before
  VESTA takes it over, show the villa's photos as before.

## 2.496.759

What you will see:
- The VESTA UI no longer says "tablet" for itself: a setting for the screen you hold says "this device" ("Full
  screen on this device", "Language on this device"), one for every screen says "every device", and a save that
  clashed says "another device".

## 2.496.758

What you will see:
- Nothing changes on screen. A wording rule is added: the app is called VESTA, never "the tablet".

## 2.496.757

What you will see:
- The tablet pops an alert's card up only when the alert rings on Telegram: its first message, a stronger signal
  and the one reminder. A later step (an escalation, a repeat, a close) changes the card quietly (needs the VESTA
  Agent's update too).

## 2.496.756

What you will see:
- A visit's card on the tablet shows the camera pictures VESTA took when it offered the siren, as Telegram's picture
  does (needs the VESTA Agent's update too).

## 2.496.755

What you will see:
- Nothing changes on the tablet; fewer checks before each release.

## 2.496.754

What you will see:
- Nothing changes on the tablet. The working rules start again from a short list of your product decisions.

## 2.496.753

What you will see:
- Nothing changes on the tablet. The working rules are shorter: the steps that slowed every fix are removed.

## 2.496.752

What you will see:
- Nothing changes on the tablet; releases are simpler and faster.

## 2.496.751

What you will see:
- The changes of 2.496.750 (one card for a visit, whoever tells it), which were not published: a check of the build failed on the build server's clock. Nothing else changes.

## 2.496.750

What you will see:
- A visit told by the villa itself (VESTA stopped) now shows exactly the card VESTA shows for it: the device's name, its room, the visit's first time, "New alert" with "monitoring until" at its right, the visit's words and photos, and the villa's four buttons. Only the alert number is missing, as the villa gives none. Its colour is now the same amber as VESTA's card.
- Once the updated Presence Guard blueprint is saved on the villa, its card is drawn from what the villa sends for it, no longer from its message's text. Cards kept before, and visits sent before that save, still show as they do today.

## 2.496.749

What you will see:
- A visit's card (Issues, Watch, Closed) shows the photo of the strongest moment first and about twice as large, with its camera and time under it; the other photos follow in time order, smaller, wrapping as before. A tap still opens any photo full size. The pop-up keeps its small photos, and a card with no strongest photo (an older card, a single photo) looks as before.

## 2.496.748

What you will see:
- During a visit (activity while the villa is empty), the camera or sensor where it was seen no longer wears the amber "!" on the map or in its window: nothing is wrong with it. It shows its usual look, the detection's plain purple pill while it sees someone. The visit's card stays in the Cockpit.
- A device with a fault on its detection or its sensor shows one amber "!" (top right), no longer a second one bottom right.

## 2.496.747

What you will see:
- Nothing changes on the tablet: the villa's doorbell and presence messages now send their pictures the new way only, and the app no longer reads the old single-picture way for a new message. Cards kept before still show their picture.

## 2.496.746

What you will see:
- While VESTA Agent is off, the villa's own visit card under Closed can be erased like every other closed card: hold it, enter the superadmin code, and it goes.
- A visit card kept before the last update shows the time the visit was first sent (07:09), no longer the time it closed (07:16).
- With the updated Presence Guard blueprint pasted on the villa, a visit that ends says "Cleared at 07:16." on Telegram and on the tablet, the time only, as its other lines, no longer the full date.

## 2.496.743

What you will see:
- While VESTA Agent is off, the villa's own visit card is named by the device that matters most ("Test door"), with the alert's words under it, and tapping the name opens that device. An owner or facility manager now gets the same buttons as on VESTA's card: Done, Not a problem, Open Ticket, Need help. A press reaches the villa at once: its Telegram messages say "Done in the Cockpit at 09:20 (Owner)", lose their buttons and the visit closes on Done or Not a problem, as a press on Telegram does. This starts once the updated Presence Guard blueprint is pasted on the villa; before that the card looks as today, without buttons.

## 2.496.742

What you will see:
- While VESTA Agent is off, the villa's own visit card looks like VESTA's card of a visit: the alert's siren icon, the time the visit was first sent (it no longer changes to the time someone answered), the room line, the visit's lines under "Status:", "New alert" as its state with "monitoring until 08:54" in the pill at its right. Once answered or over, it says "Resolved", and the answer ("Done on Telegram on 07/11/2026 08:53 (Jm)") is its line naming who closed it. It has no number chip and no buttons: the villa does not number alerts, and its buttons are on Telegram.

## 2.496.741

What you will see:
- Nothing on the tablet. Updates are prepared faster: the step that proved each test could fail is gone, and the rulebook every helper reads is cut to your product decisions and the facts about the villa.

## 2.496.740

What you will see:
- While VESTA Agent is off, a visit the villa announces shows under Issues as an alert's card, the same card as every alert: its state first, every line of its story and every photo (tap one for full size), brought up to date at each step, then under Closed once the villa ends it. It no longer sits under Notifications as a bell with its first line only. When VESTA takes the visit over, its card replaces this one.

## 2.496.739

What you will see:
- A card on the Watch list always shows its state and its (i), also in the moment before VESTA says when it closes it ("Closes within 5min").
- With VESTA Agent 0.12.472, a visit closed on the tablet (Done, Not a problem or any other answer) goes straight to Closed.
- While a visit is open, its card says "monitoring until 06:40" beside its state, in place of "next check within 5min"; the time moves later at each new sign, and reads "08/11 09:20" when it falls on another day.

## 2.496.738

What you will see:
- Pressing Done on an issue card closes it at once, as Not a problem does. It no longer asks "Done? VESTA checks it again before it closes." first. A ticket's "No action needed" still asks, since it records that nothing was done.

## 2.496.737

What you will see:
- Under Cockpit › Inbox › Issues › Closed, a closed card no longer wears the green check of the Watch list: it shows where its problem came from (the alert's siren, the moon of the maintenance check…) in grey. Cards under Watch keep their green check.
- Under an issue whose VESTA message is not on the tablet, the short story of what was sent gives each line its time alone on the alert's own day ("Alert sent (to: Facility Manager) · 05:14"), and "08/11 09:20" for a line of another day, as Telegram does.

What to check: Cockpit › Inbox › Issues › Closed: no closed card shows the green check; Watch: its cards still do.

## 2.496.736

What you will see:
- Nothing changes on the tablet. Updates reach the store faster: fewer checks are repeated on the developer's computer before an update is sent, and the store's build still runs every check before it offers the update.

What to check: nothing on the tablet.

## 2.496.735

What you will see:
- Under Cockpit › Inbox › Issues › Closed, pressing and holding a closed alert's card (for example "#134-P1 Test door") now asks for the superadmin code and erases it, with VESTA's message of it, like every other card there. Before, holding it did nothing.

What to check: unfold Closed, press and hold a closed alert's card: the superadmin code is asked; after it, the card goes and does not come back as a separate message card.

## 2.496.734

What you will see:
- Under Cockpit › Inbox › Issues › Closed, an alert VESTA handled (a visit drill, a parking alert) now shows the same card as every other one: the alert's name ("#133-P1") and the device's name at the top with the time, "Cleared" as its first line, the room under it, then VESTA's words, the photos and the Status. Before, it showed a different card: a bell, "#133-P1 (closed)" with no device name, no state and no room.
- The photos of such an alert are the ones VESTA's message holds, in one row, each with its camera and the time it was taken; a tap opens it full size.

What to check: open Cockpit › Inbox › Issues and unfold Closed. Each closed alert card starts with its "#n-P1" chip and the device's name ("Test door"), then "Cleared". After the next visit drill ends, its closed card shows every photo of the visit in a row, each named with its camera and time. The drills that ended before you installed 2.496.733 (#127 to #133) keep what the older version had kept, one photo or none, under the time of their end: their other photos were never copied to the tablet.

## 2.496.733

What you will see:
- A visit of the villa's presence alert that VESTA closed goes straight to Closed on the tablet. Before, a closed visit could sit under Watch for about ten minutes with no "Closes" line, while another one was already under Closed.

What to check: after the next visit drill ends ("Cleared on …: no further signal for 5min" on Telegram), open the tablet's Cockpit: the visit's card is under Closed at once, never under Watch. This needs the VESTA Agent update of the same evening.

## 2.496.732

What you will see:
- Settings › Messages › Who gets the messages: each chat's card now shows its id after its name, in grey: "Fabien (notify.fabien)". On a phone the id may go to the next line after the name; it is never cut inside a word.
- Taking a chat off a list, or adding one, now waits for Save like every other setting. The card goes (or comes) at once and Save turns green; Save writes the list to the villa, Cancel puts it back as it was. Before, the list was written at once and Save stayed grey, so you could not tell it was saved.
- A chat's language waits for Save too, and Cancel puts it back. A chat taken off every list still loses its language, and Cancel brings both back.
- If the villa cannot take the list, Settings stays open and says so above Save ("The Owner's list could not be saved: try again."); press Save again, or Cancel.
- Cancel no longer says "Who gets the messages was already saved": nothing in Settings or Advanced Settings is saved before Save any more.

What to check: on the tablet, open Settings › Messages, take a chat off a list. Save should turn green. Press Cancel and open Settings again: the chat is still there. Take it off again and press Save: it stays off.

## 2.496.731

What you will see:
- A notification's photos are now a row of small pictures, each with the camera's name and the time under it ("Parking · 18:34"). The main photo comes first. Tap a picture to see it full size; the arrows show the others, and the ✕ closes it.
- This is ready for the coming "one visit, one story" alerts: the villa will send one notification per visit with a photo from every camera that saw it, and the tablet will show all of them on the one card, updated at each step instead of a new card each time.
- VESTA's card of an alert shows every photo of the villa's messages it replaces, not only the last one.
- The same row is on the notice that pops up, on the full screen (the main photo large, the others under it), on the Cockpit's cards (Inbox, Watch, Closed, Open issues) and in VESTA's conversation.
- A doorbell ring still shows its one photo, as large as before, and photos already on the tablet from before this version still show. Their time is shown under them; they have no camera name.

What to check: on the tablet, open an alert or a doorbell ring in the Cockpit that has a photo. You should see the photo with its time under it; tap it and it opens full size.

## 2.496.730

What you will see:
- Advanced Settings › Devices: each device's "3D object" field is now the first field of its card, right under the line with its id, above Type. The "not on the map" cards show it at the same place.
- A device's window: the small wrench button beside Edit is now the Cockpit's own "Open Ticket" button, with the same wrench icon and words as on the Cockpit's cards. It opens the same "Open a ticket" form for this device. The camera's window shows it too.
- The counts after a section's title ("5 on the map · 1 not on the map" in Devices) are now a small switch like On | Off, the list shown filled. Tap the other one to see its list.
- Grouped devices: its title says "1 group · 15 suggested" as the same switch. Tap "suggested" to see the suggested groups, each with Create this group; the search narrows the list shown. The separate "15 suggested groups" button beside "Show fewer" is gone.
- Every card in Settings and Advanced Settings removes with the same bin at the right of its title band. Devices asleep between reports and the chats of Who gets the messages showed an ✕ there. Each bin's tooltip still says what it does ("Take … off Asleep between reports").
- Shorter (i) texts: Devices now says "Every device the 3D villa can show, with its settings. Pick a list above; type in the search to find a device, or to prepare one whose 3D object is not in the model yet." Grouped devices, Asleep between reports, Device telemetry, Maintenance records, Full-screen announcements, Who gets the messages, Map look and the Upload Model / Log Out All (i) are two sentences at most too.

## 2.496.729

What you will see:
- Advanced Settings › Devices: every device's card has a new last field, "3D object". It shows the objects of the 3D model that show this device, whether the object is named after the device or was linked by hand. Each object has an ✕ to take it off the device, and "Add a 3D object…" searches the model's objects: those that show nothing yet come first, and one already showing another device says which, and moves here when you pick it.
- An object taken off with its ✕ shows nothing on the map, even when its name matches the device. Add it again to bring the device back on it.
- The Devices title now has two counts, "on the map" and "not on the map". Tap one to see that list. "Not on the map" lists the devices no 3D object shows, each as the same card with an empty "3D object" field. Pick an object and the device moves to the map.
- The search above the list also prepares a device whose 3D object is not in the model yet: type its entity id and pick "Prepare".
- The pencil after a device's id and the "· 3D object: …" text are gone.
- Advanced Settings › Villa: the "Bound 3D objects" section is gone. Everything it did is now on each device's card.
- A search list opened inside a card (a 3D object, a group's members, a linked entity) is no longer cut off at the bottom of the card.

What to check: on the tablet, each device still shows on the same object of the map as before. Devices' "not on the map" count should match the old "not shown" count.

## 2.496.728

What you will see:
- Advanced Settings › Villa › Bound 3D objects: a 3D object bound to nothing shows its friendly name in its header and its id under it, like every other card (its header showed the raw id).
- Devices: a 3D object whose entity is gone ("No such entity") is named the same way.

## 2.496.727

What you will see:
- Every card for a device in Settings and Advanced Settings (a group, a bound 3D object, an entity no object shows, a device asleep between reports, a device in Devices) has the same layout: the entity's friendly name in its header, its id alone on the line under it, then its fields.
- The long line under the name is gone: no "Other", no "primary (keeps the map badge)" (the section's (i) says it), no "3D object: …".
- A suggested group is named after its first device, its two ids under it joined by "+".

## 2.496.726

What you will see:
- Advanced Settings › Villa › Bound 3D objects: each bound object's card looks like a device's card in Devices. Its name, then its room, its id and its 3D object on one line, then one field, "Bound to", with the search that changes it on the same line. The sentence "… is bound to …" is gone.
- An object bound to nothing has the field "Bind to", an entity no object shows has the field "3D object", each name in the same column as a device's "Linked entity".
- Grouped devices: a group's members and "Add another entity…" sit in a field named "Members", in that same column.
- Every field of every Settings and Advanced Settings card is now drawn the same way, so the names and the boxes line up on every card.

## 2.496.725

What you will see:
- The remove icons' tooltips each name what they remove, in the screen's own words: "Delete the announcement
  <announcement>" (it said "Delete this announcement"), "Take <device> off Asleep between reports" (it said "off the
  Asleep list", a name the screen does not show).

## 2.496.724

What you will see:
- Settings and Advanced Settings: a card's remove is no longer a word in the bar at its bottom. It is now a small icon at
  the right of the card's top band: a bin when it deletes the thing, an ✕ when it takes it off a list or undoes a link.
  Hovering it says what it does:
  - a device group: bin, "Delete the group <its main device>";
  - a device's card in Devices: bin, "Remove <device>'s settings" (a device the 3D model names still has none);
  - a full-screen announcement: bin, "Delete this announcement";
  - a chat in Who gets the messages: ✕, "Take <chat> off the Owner's list" (or the Facility Manager's);
  - a device in Asleep between reports: ✕, "Take <device> off the Asleep list";
  - a bound 3D object: ✕, "Unbind <object> from <device>".
- These cards have no bottom bar any more, as nothing is left in it. Bind, Create this group and Point it there stay in
  their bar. Each remove acts at once, as before.

## 2.496.723

What you will see:
- Advanced Settings › Devices › Grouped devices: one search field instead of two ("Search groups, or a device to
  group…"). Typing narrows the groups below and lists the matching devices: one already grouped says "In group …"
  (tap it to see that group, marked), another says "Create a group" (tap it to make the group with it as the main
  device). Typing a device's exact id offers "Create a group with …" first, Enter picks it. When no group matches,
  the list says "No group has '…'" with a button to create one. Clearing the field shows every group again.
- Asleep between reports works the same way ("Search, or a device to add…"): "On the list" or "Add to the list".
  Auto-detected entity settings has the same field, which only narrows the list ("Search by id, label or room…").
  Villa › Bound 3D objects too ("Search objects, or a device to prepare…"): it narrows the list shown, and offers
  "Prepare it" or "Already in Devices"; the separate Add button is gone.
- The list under a search field is now solid, so the cards behind it no longer show through.
- On a phone, a device card's tick box now sits on the same line as its id and pencil, with "Confirm before toggling"
  on the line under them.
- In every settings card (a device's, an announcement's, a chat's) the fields now all start at the same place, the
  names in one column on the left. On a phone each name sits above its field. A chat's field is now called
  "Language".
- Inbox: a card whose problem is only seen live (a device "Unavailable" with no VESTA fault) now has a pill at the
  right of its first line, "checked live"; hovering it says the tablet watches it all the time and the card goes as
  soon as the device is back to normal. On a card that also has a VESTA fault, the card keeps the fault's next check,
  and the live problem's own line shows "checked live".
- Inbox on a phone: the Issues · Notifications · Reports bar now has a solid background across the whole width, so
  the cards no longer show above or beside it while you scroll.

## 2.496.722

What you will see:
- Settings › Messages: in each announcement's card and each chat's card, the field ("On screen" 10s, "Language VESTA
  writes in") now fills the card's width beside its name, and the name stays on one line. On a phone the field goes
  under its name, as wide as the card. The same for every field inside a settings card (a device's fields too).

## 2.496.721

What you will see:
- Every card (Cockpit, Settings, Advanced Settings) has a clearer edge and a faint shadow under it, in light and dark,
  so each card stands apart from the next.
- "next check within 5min" is now a small pill with its refresh icon at the right of the card's first line (under the
  time in the band), no longer on the line with the room. Hovering or tapping it still says when, as before.
- Every open fault now says where it stands on its first line. A fault nobody has handled yet (a maintenance check's
  finding, for example) says "New fault" in amber; before, its card started with its room. A card holding several
  problems says it on each problem's line too.
- Advanced Settings › Devices: each device card always shows its fields (no arrow to open it), and the room line under
  its name is gone. On a phone, "Confirm before toggling" and its On | Off sit on their own line under the id; on a
  computer they stay on the id's line.
- Advanced Settings › Villa › Bound 3D objects: a bound object's card is named after the device it shows (its room and
  id under the name, as on Asleep between reports), says "Lamp_Kitchen is bound to Terrace Lamp", then the search to
  change it, and "Unbind" along the bottom. An object bound to nothing is named after the object, with the search and
  "Bind".

## 2.496.720

What you will see:
- Settings and Advanced Settings now show each of their lists as the same cards as the Cockpit: a band on top with
  the thing's name (and its icon), a quiet line under it, its fields, and its buttons along the bottom edge with their
  words, the main one first in green.
- Devices: each device is a card named as the villa shows it, its room on the quiet line; the line with its box, its
  id, "Confirm before toggling", the pencil and the arrow is unchanged inside it. Its bin is now "Remove" along the
  bottom. A 3D object whose device no longer exists is a card saying "No such entity" (its (i) says why), with
  "Point it there" along the bottom.
- Grouped devices: each group is a card named after its main device, with the group icon; its id and "primary (keeps the
  map badge)" on the quiet line; its members and "Add another entity…" inside; "Remove group" along the bottom.
  Each suggested group is a card too, with "Create this group" along the bottom.
- Asleep between reports: "Add a device…" on top, then a card per device with "Take off the list" along the bottom.
- Villa › Bound 3D objects: the line "1 bound object > 3 unbound objects > 1 entity not shown" under the title is
  gone. The counts in the title ("4 bound · 829 unbound · 88 not shown") are now the way to open each list: tap one
  and its list shows below, the one shown underlined in green; bound objects first. Each bound object is a card
  ("Bound to …" on its quiet line, its entity's search box, "Unbind" along the bottom). An unbound object is a card
  where you pick an entity, then tap "Bind". An entity not shown on the map is a card where you pick one of the
  unbound 3D objects, then tap "Bind". Each list shows its first few, then pages of ten.
- Settings › Messages: each full-screen announcement is a card with its time on screen ("10s") and "Remove"; each chat
  under Owner and Facility Manager is a card with "Language VESTA writes in" and "Remove".
- Advanced Settings › System › Device telemetry: each line now starts with its time, then its kind (freeze still in
  red), the device, then the text, with the times and kinds lined up in columns. On a phone the time, kind and device
  are on the first line and the text under it.
- Everything else (the On | Off switches, sliders and setting lines, Days records are kept) is unchanged.

## 2.496.719

What you will see:
- Every source icon on a card now explains itself. Hover it with a mouse, or tap it on a phone or the iPad, and a
  small card opens with that icon's own line of the table in the (i) beside OPEN ISSUES: its icon and name ("Live",
  "Alert", "Maintenance check", "Owner"…), then "What it is", "Appears" and "Goes", word for word as the table says
  them, with VESTA's own times.
- This works on every icon: the ones at the top of an Inbox card, the one beside each problem of a card holding
  several, a ticket's icon in Tickets, the icons in the Recap's "Check the faults" line, and the green check of a
  card on the Watch list ("On watch"). A card with two icons has two cards, one for each.
- Tapping an icon only opens its explanation: it never opens or erases the card under it. A tap anywhere else, or
  Escape, closes it.

## 2.496.718

What you will see:
- Nothing new on screen. The rule behind 2.496.717 is now written in the project's shared rules: a drop seen on a
  finer chart always shows on the coarser ones, however short, so a later change cannot hide it again.

## 2.496.717

What you will see:
- A short drop that shows on a device's 24h chart now also marks its hour on the week chart and its day on the month
  chart, with the same words: "Unavailable at 06:58, for 10s", or "Unavailable 3 times, 50s in all, the first at …"
  when there were several. Until now a drop of a few seconds or a minute or two showed on the 24h chart only. This is
  the same on the Weather window's charts, and on a device's charts of values drawn from its changes.
- A drop of under a second (the villa's system reloading a virtual device) marks its hour and its day too, said
  "under 1s", as on the 24h chart.
- The week and month charts show their line at once, as before; the striped hours or days appear a moment later. A
  second opening of the same chart, or the month after the week, is quicker: only today is read again.
- Drops older than the villa's system keeps every change (Settings › System, "Days records are kept") still show only
  when they lasted long enough to leave a gap in the averages, said "Unavailable at least once that day": nothing else
  is kept for them. The chart's (i) no longer says "Outages under 5min may not show".

## 2.496.716

What you will see:
- Settings and Advanced Settings look the same everywhere, on a phone as on a laptop. Every setting's name stays on
  one line ("Night dimming", "Full screen on this tablet", "Maintenance mode"), its icon, name and (i) at the left and
  its control at the right.
- Every slider shows its value at the end of its name's line, the track under it (beside the track where three
  sliders share a laptop line). Every multiplier reads the same way: "0.50×", "1.00×"; the eye height "1.70 m".
- Every On | Off, Map look's Icon | Card, Villa lighting's icons and the Interface theme are the same size of
  control, and an On | Off is the same width on every line.
- Grouped devices, Asleep between reports and Bound 3D objects open like the Cockpit's sections: a chevron before the
  title, what they hold after it. Their lists and "Show all, … more" open the same way, with no box around them.
- Settings › Messages: each list's "+ Add" sits at the right of its title's line; the announcements' table heads read
  "Announcement" and "Time", each time shows as "10s" in one box, and the ✕ to take one off is a small round button.
- Advanced Settings' Upload Model and Log Out All sit in one rounded group like the Interface theme in Settings; the
  telemetry's buttons too. Its times read as everywhere else, on the villa's clock: "05/11/2026 17:55:13".
- A device's name in Devices breaks only after a "." or "_", never in the middle of a word.
- Villa: the latitude and longitude show 6 decimals; "Set North" is the same light button as the others. System: "Days
  records are kept" with its number at the right (the full sentence is in the section's (i)).

## 2.496.715

What you will see:
- An alert's card in the Inbox says where the alert stands in its first line, like every other card: "New alert",
  "Reminder sent", the same words as the Status on Telegram, in the card's colour (with the device's own state before
  it when there is one: "Missing · New alert"). That line was empty, and the Status sat as a small line at the bottom
  of the card; it is no longer repeated there. On the Watch list the first line still says when it closes.

## 2.496.714

What you will see:
- The Energy window's week and month charts name their days as every other chart does: "04/11" under the bars and
  "04/11/2026" for the busiest day (they said "Wed 4", which named no month).

## 2.496.713

What you will see:
- Every card's buttons in one order, on the tablet as on Telegram: Done · Not a problem · Open Ticket · Need help (on a
  phone: Done · Ignore · Ticket · Help). A ticket's card: Close · No action needed · Need help.
- A device's chart says an outage the same way at every range (1h, 24h, 1w, 1m, 1y): the step's value first, then when
  and how long ("Unavailable at 06:58, for 10s", or "Unavailable 3 times, 50s in all, the first at 06:58"), then its
  time. "Unavailable at least once that hour" is said only where the villa's system no longer keeps the detail
  (older than about 10 days). On the 24h chart, a five-minute step with a short drop keeps its line and its value.
- A chart's heading is always on one line: the device window is a little wider, and on a phone the heading leaves out
  "Last 24 hours" (the pressed "24h" says it; its (i) still says it). A silent device's "Last report …" is a line under
  the heading.
- One date format everywhere: "Due 31/01/2020" on a task, "04/11/2026 09:00" in a chart's tooltip, "29/10" under a
  week's chart, times as "08:56".
- A saved Recap snapshot says its moment once, in its band (no "Saved …" beside it).

## 2.496.712

What you will see:
- Every card names its thing in its coloured band at the top: the device, the ticket, the task, the Recap check, the
  saved document, the spend, with the time at the right. A long name takes two lines at most, then "…". The device's
  name still opens the device.
- The first line inside the card says where it stands, in bold and in the band's colour: "Reopened", "Ticket in
  progress", "Resolved", "Overdue", "Pass", "2 problems", or on Watch "Closes 15:06" with its (i). A card with nothing to
  say about its state starts straight with its details.
- A notification or a report is named in its band by the first sentence of its title ("The Example House, devices
  offline on 04/11/2026 08:56"); the rest of the title ("All back to normal.") is its first line. Telegram is unchanged.
- Spend: the month's money and the spend entries come first, under Spend settings; then a "Monthly recap" section with
  the Month, its recap buttons, the recap and the saved recaps.
- Recap: "Save snapshot" moved from the verdict at the top to its own row at the right, after the last check and just
  above the saved snapshots.

## 2.496.711

What you will see:
- A ticket's card no longer says "next check within …": someone is on it. The fault's own card in the Inbox still says
  when VESTA looks again.
- On the Schedule tab, "Maintenance schedule" is folded at first, like "Recent work": tap its name to see the tasks and
  "Add a task".
- In Recap, "All devices reporting" has no "View unavailable devices" button any more: the word "devices" in its line
  ("3 devices offline or not reporting") is a link that opens the same list, like "faults" and "tickets" on the faults
  and tickets check.

## 2.496.710

What you will see:
- A maintenance task looks the same on the Schedule tab as on Today: a late task is red with "Overdue" in its band on
  both (the Schedule tab showed it grey, with no state), a paused one says "Paused", and both say who did it last
  ("Last done by Wayan, on …").
- A spend entry names its device the way a ticket does: underlined, first on the quiet line under its title (it was a
  chip beside the title). Tap it to open the device.
- In Recap, each check says "Pass", "Warning" or "Fail" in its coloured band, and its button ("View unavailable
  devices", "View doors" …) sits in the bar at the bottom, like every other card's buttons, instead of beside its title.
  A passing check is green, like a task on schedule.

## 2.496.709

What you will see:
- An alert's number ("#91-P1") is said once on its card: in the coloured band on top. The words under it no longer
  start with "#91-P1 · …" or "#100-P1 (existing)"; they say what is wrong, then VESTA's message.
- The number in the band is written as Telegram writes it, priority included ("#7-P1"), even for an older alert the
  tablet knew only as "#7".
- A ticket from an alert now shows its number in the band too, as its Inbox card does, and its title is only what is
  wrong.
- Two alerts that say the same words on one device stay two lines, each with its own number.
- Nothing else changes on screen: the card of a ticket holding several faults is now drawn by the same piece as every
  other card.

## 2.496.708

What you will see:
- Every card in the Cockpit has a new look, the same on every tab (Inbox, Tickets, Schedule, Recap and Spend). On top, a coloured band says where it stands: red when you must act now, amber for a fault or
  a late task, green when someone is handling it, grey when it is quiet or closed. The band holds the source icons, the
  alert's number (for example "#91-P1"), the state ("Reopened", "Ticket in progress", "Unavailable") and, at its right,
  the time. It always stays on one line.
- Under it: the name of the device or the ticket, then one quiet line with the room and when VESTA checks again (for a
  ticket, the device's name first, underlined: tap it to open the device), then the words, then who moved it last
  ("Opened by Wayan", "By VESTA Agent", "Done by Wayan") without repeating the state or the time.
- The buttons now form one bar along the bottom of the card, all the same width and easy to tap. The main action is
  always first and in green: Done on an issue, Close on a ticket. On a phone the buttons show one word (Help, Ignore,
  Ticket, Dismiss), on a computer the full words. A ticket's report is in the same bar.
- Pressing Done (or No action needed on a ticket) shows the question on its own line, with Done first and Cancel second.
- A device with several problems says "2 problems" on top; each problem then has its own small header (its icon, its
  state, its time), its words and its own buttons.
- A card on Watch says "Closes 15:06" on top, with its (i), and who closed it under its name.
- Open issues are listed red first, then amber, then grey, then what is being handled.
- The light theme uses the same look, in lighter colours.

## 2.496.707

What you will see:
- Cockpit › Spend makes the monthly recap: one document with the month's spend, maintenance, faults, devices and
  readiness. The spend statement was the recap's spend section on its own; it is gone, and "Generate recap" sits
  beside the Month. Saved statements are listed with the saved recaps. The Month opens on the month running and
  also offers the one just finished.
- Cockpit › Recap: the readiness checks are always shown under the verdict (they no longer fold). "Villa occupied
  since …" is no longer shown there. The faults and tickets check names its devices as pills, each device once, like
  All devices reporting. In its line, "faults" opens Inbox › Open issues on those devices, and "tickets" opens the
  Tickets tab.

## 2.496.706

What you will see:
- A device's chart over 1h or 24h: an outage is striped like on 1w, 1m and 1y (it was a faint grey band, hard to
  see), and its tooltip's key is that stripe, not the line's green dot. Its (i) says "Striped: unavailable at least
  once in those 5min."
- Advanced Settings › Devices: "Confirm before toggling" never drops to a second line. Every device keeps one line:
  its name (2 lines at most), the toggle, the pencil and the chevron. On a narrow screen the toggle shows its shield
  and On | Off without its words (the words still show on hover and are read aloud).

## 2.496.705

What you will see:
- A chart's (i) is short: "Daily averages. Striped: unavailable at least once that day. Outages under 5min may not
  show. Before 26 Oct: only whole-hour outages show." (the same on every chart, in its own steps).
- A striped step's tooltip says "Unavailable at least once that day" (or hour, or week), with its day once, under
  it. Its key is the striped swatch the chart draws, no longer the line's green dot; an outage's grey band is keyed
  grey too.
- Advanced Settings › Devices: the pencil and the fold chevron sit on the device's first line, at its right, and
  "Confirm before toggling" on the line under it. A long id (with its "3D object: …") takes at most 2 lines; the
  whole text shows on hover. On a wide screen the row keeps one line.

## 2.496.704

What you will see:
- A device's charts over a week or a month: a sensor the villa's system keeps no averages of (a template sensor) no
  longer has a whole hour, or a whole day, striped "Unavailable" each time the villa's system reloads its virtual
  devices (a drop of a fraction of a second). Its steps are striped by the same rule as every other sensor's: an
  outage that lasted a whole five minutes.
- The (i) of a month's or a year's chart of such a sensor says "Before 26 Oct, the villa's system no longer keeps its
  readings.", as the chart draws, instead of "only an outage of a whole hour shows".
- The (i) of the 1h and 24h charts says the grey band covers each 5min in which the device was unavailable, however
  briefly, and that its tooltip says how long. It said "at its real length" over a band 5min wide for a 0.46s drop.

## 2.496.702

What you will see:
- A device's charts over a week, a month or a year: a device listed under "Asleep between reports" no longer has every
  hour or day striped "Unavailable during this …": its sleep is not an outage, and its line holds across it, as its
  24h chart already did.
- A sensor the villa's system keeps no averages of shows an outage on its week, month or year chart as every other
  device does: the step striped, its line drawn through, "Unavailable during this hour". It was a plain grey band, the
  line broken, with a span of times.
- An outage on a chart of several days says its day once: "Unavailable · 3 Nov, 06:13–06:40 (27min)", no longer
  "3 Nov, 06:13–3 Nov, 06:40".
- The (i) of the Energy and rain charts says what they draw for a step with no total: a grey band, "No reading". It
  said "left empty".

## 2.496.701

What you will see:
- Cockpit › Inbox: a device whose ticket is in progress no longer offers "Not a problem" (it closed the ticket as
  "Not a problem while it lasts"). Its card offers Done, Need help and Edit Ticket, as the Tickets tab does.
- Cockpit cards: a Need help pressed is said once, in the card's pill ("Need help asked by Owner, on …"). The line
  "🆘 Need help asked … (Owner)" above the buttons shows only when something moved the card after the Need help.
- Inbox › Closed and Tickets › Closed tell a closed record the same way, in the same pill: "Done by JM, on …",
  "No action needed by Owner, on …", "Not a problem by Owner, on …", or "Cleared on …" when VESTA cleared it itself.
  A ticket still adds its stage ("· Resolved"). On the Watch list, a Close in the Cockpit now says "No action needed on …
  (Owner)" instead of "Cleared on … (Owner)".
- Reopen follows one rule on both Closed sections: it is offered when nothing will check the record again (closed
  as "Not a problem while it lasts", or a ticket a person opened), and never on a fault VESTA checks.
- Ask VESTA: after "New conversation", an answer from before no longer comes back when VESTA tidies it (removes its
  Continue button after a press, or at its start).
- A device's chart over a week, a month or a year: an hour, a day or a week in which the device was unavailable
  for part of the time is striped grey, the same stripes as a state band's, its line drawn through. Its tooltip says
  "Unavailable during this hour" (day, week). The same on the Weather window's charts.
- Every chart's title has an (i) saying what the chart shows and what it may not: every reading on 1h and 24h, and on
  longer ranges that an outage shorter than 5min may not show, with the date before which only longer outages show.
- A chart's tooltip for a short drop says "Unavailable at 13:40, under 1s" (or "for 4s") instead of
  "Unavailable · 13:40–13:40 (1s)"; on a chart of several days, it names the day.
- Nothing else changes on the cards: each card's state pills stand where they stood, on a laptop and on a phone.

## 2.496.700

What you will see:
- A device that sleeps between reports and whose last report is older than the villa keeps (10 days) now draws
  "No longer kept" across its history band, instead of "Not enough history yet" as if it had just been added.

---

Older changes (before 2.496.700) are in the repository's changelog-archive/CHANGELOG.md.
